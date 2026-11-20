import { promises as fs } from 'node:fs'
import type { Dirent } from 'node:fs'
import path from 'node:path'
import { prisma } from '@/lib/db'
import { getPersona } from '@/lib/personas'

/**
 * Local conversation archive: one folder per conversation with
 *   transcript.md   human-readable log
 *   context.jsonl   one JSON record per message
 *   meta.json       conversation info and archive state
 *
 * Server-only module. Everything here is best-effort: a failing disk must not
 * break chatting, so callers wrap writes in try/catch.
 */

export const DEFAULT_ARCHIVE_ROOT = path.join(process.cwd(), 'archives')

/** A model-side archive digest is injected every this many archived turns. */
export const ARCHIVE_INJECT_EVERY_TURNS = 20

const DIGEST_CHAR_BUDGET = 8000
const DIGEST_ENTRY_MAX_CHARS = 1200
const DIGEST_MAX_ENTRIES = 60

const KEY_ROOT = 'archiveRoot'
const KEY_DEFAULT_ON = 'archiveDefaultOn'

export type ArchiveEntry = {
  index: number
  turn: number
  role: 'user' | 'assistant'
  messageId: string
  createdAt: string
  content: string
}

export type ArchiveMeta = {
  version: 1
  conversationId: string
  title: string
  personaId: string
  personaName: string
  createdAt: string
  updatedAt: string
  messageCount: number
  turnCount: number
  /** Records in context.jsonl (kept even after the chat context is cleared). */
  archiveEntries: number
  lastMessageAt: string | null
  files: string[]
}

// ---------------------------------------------------------------- settings

export async function getArchiveRoot(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: KEY_ROOT } })
  return row?.value?.trim() || DEFAULT_ARCHIVE_ROOT
}

export async function getArchiveDefaultOn(): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: KEY_DEFAULT_ON } })
  return row ? row.value === 'true' : true
}

async function setSetting(key: string, value: string) {
  await prisma.setting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  })
}

export async function setArchiveRoot(root: string) {
  await setSetting(KEY_ROOT, root)
}

export async function setArchiveDefaultOn(enabled: boolean) {
  await setSetting(KEY_DEFAULT_ON, enabled ? 'true' : 'false')
}

// ------------------------------------------------------------------- paths

export function conversationDir(root: string, conversationId: string) {
  return path.join(root, conversationId)
}

export function resolveArchivePath(input: string) {
  const trimmed = input.trim()
  return path.resolve(trimmed.startsWith('~') ? trimmed.replace(/^~/, process.env.USERPROFILE ?? '') : trimmed)
}

export async function archiveHasFiles(conversationId: string): Promise<boolean> {
  try {
    await fs.access(path.join(conversationDir(await getArchiveRoot(), conversationId), 'meta.json'))
    return true
  } catch {
    return false
  }
}

// -------------------------------------------------------------- formatting

function transcriptHeader(meta: Pick<ArchiveMeta, 'title' | 'personaName' | 'createdAt'>) {
  return (
    `# ${meta.title}\n\n` +
    `> 人设：${meta.personaName} · 对话创建于 ${meta.createdAt} · 由樱语 Sakura Chat 自动归档\n\n---\n\n`
  )
}

function transcriptSection(entry: ArchiveEntry) {
  const who = entry.role === 'user' ? '用户' : '助手'
  return `## ${entry.index} · ${who}\n\n> ${entry.createdAt}\n\n${entry.content}\n\n`
}

function toEntry(
  index: number,
  role: 'user' | 'assistant',
  content: string,
  messageId: string,
  createdAt: Date | string,
): ArchiveEntry {
  return {
    index,
    turn: Math.ceil(index / 2),
    role,
    messageId,
    createdAt: typeof createdAt === 'string' ? createdAt : createdAt.toISOString(),
    content,
  }
}

// ---------------------------------------------------------------- metadata

/** Reads context.jsonl, skipping torn lines instead of failing. */
async function readArchiveEntries(dir: string): Promise<ArchiveEntry[]> {
  try {
    const raw = await fs.readFile(path.join(dir, 'context.jsonl'), 'utf8')
    const entries: ArchiveEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const parsed = JSON.parse(line) as ArchiveEntry
        if (parsed && typeof parsed.index === 'number' && typeof parsed.content === 'string') {
          entries.push(parsed)
        }
      } catch {
        // torn line
      }
    }
    return entries
  } catch {
    return []
  }
}

async function writeMetaFile(dir: string, meta: ArchiveMeta) {
  const target = path.join(dir, 'meta.json')
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
  await fs.rename(tmp, target)
}

/** Rewrites meta.json from the database so it always matches the chat state. */
export async function refreshArchiveMeta(conversationId: string) {
  const root = await getArchiveRoot()
  const dir = conversationDir(root, conversationId)
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      title: true,
      personaId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { messages: true } },
      messages: {
        select: { role: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })
  if (!conversation) return

  const assistantCount = await prisma.message.count({
    where: { conversationId, role: 'assistant' },
  })
  const archiveEntries = (await readArchiveEntries(dir)).length
  const persona = getPersona(conversation.personaId)
  const meta: ArchiveMeta = {
    version: 1,
    conversationId,
    title: conversation.title,
    personaId: conversation.personaId,
    personaName: `${persona.emoji} ${persona.name}`,
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    messageCount: conversation._count.messages,
    turnCount: assistantCount,
    archiveEntries,
    lastMessageAt: conversation.messages[0]?.createdAt.toISOString() ?? null,
    files: ['transcript.md', 'context.jsonl', 'meta.json'],
  }
  await fs.mkdir(dir, { recursive: true })
  await writeMetaFile(dir, meta)
}

// ------------------------------------------------------------------ writes

/**
 * Syncs the archive from the database without losing existing records.
 * Used when archiving is enabled late and for「立即导出」: every message that
 * is not in context.jsonl yet is appended, so history submitted before the
 * switch was on is included while earlier archive-only entries survive a
 * cleared chat context.
 */
export async function rebuildArchive(conversationId: string): Promise<number> {
  const root = await getArchiveRoot()
  const dir = conversationDir(root, conversationId)

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { title: true, personaId: true, createdAt: true },
  })
  if (!conversation) return 0

  const messages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, createdAt: true },
  })

  await fs.mkdir(dir, { recursive: true })
  const existing = await readArchiveEntries(dir)
  const known = new Set(existing.map((entry) => entry.messageId))

  let lastIndex = existing.reduce((max, entry) => Math.max(max, entry.index), 0)
  const appended: ArchiveEntry[] = []
  for (const message of messages) {
    if (known.has(message.id)) continue
    lastIndex += 1
    appended.push(
      toEntry(
        lastIndex,
        message.role === 'assistant' ? 'assistant' : 'user',
        message.content,
        message.id,
        message.createdAt,
      ),
    )
  }

  const transcriptPath = path.join(dir, 'transcript.md')
  const transcriptExists = await fs
    .access(transcriptPath)
    .then(() => true)
    .catch(() => false)
  if (!transcriptExists) {
    const persona = getPersona(conversation.personaId)
    await fs.writeFile(
      transcriptPath,
      transcriptHeader({
        title: conversation.title,
        personaName: `${persona.emoji} ${persona.name}`,
        createdAt: conversation.createdAt.toISOString(),
      }),
      'utf8',
    )
  }

  if (appended.length > 0) {
    await fs.appendFile(transcriptPath, appended.map(transcriptSection).join(''), 'utf8')
    await fs.appendFile(
      path.join(dir, 'context.jsonl'),
      appended.map((entry) => `${JSON.stringify(entry)}\n`).join(''),
      'utf8',
    )
  }

  await refreshArchiveMeta(conversationId)

  const total = [...existing, ...appended]
  await prisma.conversation.update({
    where: { id: conversationId },
    data: {
      archivedTurns: total.filter((entry) => entry.role === 'assistant').length,
    },
  })

  return appended.length
}

/**
 * Appends one saved message to the archive. Called after a message row is
 * committed, so the files and the database stay in step.
 */
export async function appendToArchive(params: {
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  messageId: string
  createdAt: Date
}): Promise<void> {
  const root = await getArchiveRoot()
  const dir = conversationDir(root, params.conversationId)
  await fs.mkdir(dir, { recursive: true })

  const transcriptPath = path.join(dir, 'transcript.md')
  const exists = await fs
    .access(transcriptPath)
    .then(() => true)
    .catch(() => false)
  if (!exists) {
    const conversation = await prisma.conversation.findUnique({
      where: { id: params.conversationId },
      select: { title: true, personaId: true, createdAt: true },
    })
    const persona = getPersona(conversation?.personaId)
    await fs.writeFile(
      transcriptPath,
      transcriptHeader({
        title: conversation?.title ?? '对话',
        personaName: `${persona.emoji} ${persona.name}`,
        createdAt: (conversation?.createdAt ?? params.createdAt).toISOString(),
      }),
      'utf8',
    )
  }

  // Numbering follows the archive, not the chat, so clearing the context and
  // continuing does not restart the sequence or collide with old records.
  const existing = await readArchiveEntries(dir)
  const nextIndex = existing.reduce((max, entry) => Math.max(max, entry.index), 0) + 1

  const entry = toEntry(
    nextIndex,
    params.role,
    params.content,
    params.messageId,
    params.createdAt,
  )
  await fs.appendFile(transcriptPath, transcriptSection(entry), 'utf8')
  await fs.appendFile(
    path.join(dir, 'context.jsonl'),
    `${JSON.stringify(entry)}\n`,
    'utf8',
  )
  await refreshArchiveMeta(params.conversationId)
}

// ------------------------------------------------------------------- read

export type ArchiveDigest = {
  text: string
  selected: number
  total: number
}

/**
 * Picks archive records that are outside the model's current context window
 * and formats them as a system-prompt section.
 */
export async function buildArchiveDigest(
  conversationId: string,
  excludeMessageIds: Set<string>,
): Promise<ArchiveDigest | null> {
  const root = await getArchiveRoot()
  const file = path.join(conversationDir(root, conversationId), 'context.jsonl')
  let raw = ''
  try {
    raw = await fs.readFile(file, 'utf8')
  } catch {
    return null
  }

  const entries: ArchiveEntry[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as ArchiveEntry
      if (parsed && typeof parsed.content === 'string' && !excludeMessageIds.has(parsed.messageId)) {
        entries.push(parsed)
      }
    } catch {
      // Skip a torn line rather than failing the request.
    }
  }
  if (entries.length === 0) return null

  const head = entries.slice(0, 2)
  const tail: ArchiveEntry[] = []
  let chars = head.reduce((sum, entry) => sum + entry.content.length, 0)
  for (let i = entries.length - 1; i >= 2; i--) {
    const entry = entries[i]
    const cost = Math.min(entry.content.length, DIGEST_ENTRY_MAX_CHARS)
    if (chars + cost > DIGEST_CHAR_BUDGET) break
    if (tail.length >= DIGEST_MAX_ENTRIES) break
    chars += cost
    tail.unshift(entry)
  }

  const selected = [...head, ...tail]
  const omitted = entries.length - selected.length
  const lines = selected.map((entry) => {
    const who = entry.role === 'user' ? '用户' : '助手'
    const content =
      entry.content.length > DIGEST_ENTRY_MAX_CHARS
        ? `${entry.content.slice(0, DIGEST_ENTRY_MAX_CHARS)}…（下略）`
        : entry.content
    return `[第 ${entry.turn} 轮 · ${who}] ${content}`
  })

  const text =
    `## 历史存档（自动读取）\n` +
    `以下是从本对话的本地存档中读回的历史记录，它们不在当前上下文中。请把它们当作已经发生过的对话，保持连贯；` +
    `除非用户要求，不要逐条复述这些内容。\n\n` +
    lines.join('\n\n') +
    (omitted > 0 ? `\n\n（另有 ${omitted} 条更早记录因长度限制未列出）` : '')

  return { text, selected: selected.length, total: entries.length }
}

// ----------------------------------------------------------------- manage

export async function deleteArchive(conversationId: string): Promise<void> {
  const root = await getArchiveRoot()
  await fs.rm(conversationDir(root, conversationId), { recursive: true, force: true })
}

/** Moves every conversation folder from one root to another. */
export async function moveArchives(fromRoot: string, toRoot: string): Promise<number> {
  if (path.resolve(fromRoot) === path.resolve(toRoot)) return 0
  let entries: Dirent[]
  try {
    entries = await fs.readdir(fromRoot, { withFileTypes: true })
  } catch {
    return 0
  }
  await fs.mkdir(toRoot, { recursive: true })
  let moved = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const source = path.join(fromRoot, entry.name)
    const target = path.join(toRoot, entry.name)
    try {
      await fs.access(target)
      continue // Never overwrite an existing archive in the destination.
    } catch {
      // Target does not exist — safe to move.
    }
    try {
      await fs.rename(source, target)
    } catch {
      await fs.cp(source, target, { recursive: true })
      await fs.rm(source, { recursive: true, force: true })
    }
    moved++
  }
  return moved
}
