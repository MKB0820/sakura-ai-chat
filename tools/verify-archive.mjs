// End-to-end checks for the local conversation archive:
// files, per-conversation switches, late backfill, auto read-back, directory
// change, deletion and per-user isolation.
// Needs the mock API (tools/mock-deepseek.mjs) and the app on port 3000.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://127.0.0.1:3000'
let failures = 0

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server did not start')
}

const cookieHeader = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')

function absorb(jar, res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';')
    const i = pair.indexOf('=')
    const name = pair.slice(0, i)
    const value = pair.slice(i + 1)
    if (!value) delete jar[name]
    else jar[name] = value
  }
}

async function login(email, password) {
  const jar = {}
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  absorb(jar, csrfRes)
  const { csrfToken } = await csrfRes.json()
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({ csrfToken, email, password }),
    redirect: 'manual',
  })
  absorb(jar, res)
  return jar
}

const json = (jar, url, method, body) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

const readJsonl = async (file) => {
  try {
    const raw = await fs.readFile(file, 'utf8')
    return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line))
  } catch {
    return []
  }
}

const exists = async (p) =>
  fs
    .access(p)
    .then(() => true)
    .catch(() => false)

async function chat(jar, conversationId, text) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
    body: JSON.stringify({
      conversationId,
      messages: [{ id: `u-${Date.now()}`, role: 'user', parts: [{ type: 'text', text }] }],
    }),
  })
  const raw = await res.text()
  let reply = ''
  let metadata = null
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const event = JSON.parse(payload)
      if (event.type === 'text-delta') reply += event.delta
      if (event.type === 'finish') metadata = event.messageMetadata
    } catch {
      /* keep-alive */
    }
  }
  return { status: res.status, reply, metadata }
}

await waitForServer()

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' }),
})

const emailA = 'archive-a@test.local'
const emailB = 'archive-b@test.local'
const password = 'password123'
for (const email of [emailA, emailB]) {
  await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
}
const jarA = await login(emailA, password)
const jarB = await login(emailB, password)

const initial = await (await json(jarA, '/api/archive', 'GET')).json()
const originalRoot = initial.root
check('archive root is a folder path', path.isAbsolute(originalRoot), originalRoot)
check('new-conversation default is on', initial.defaultOn === true)

// --- create conversation; archive inherits the master switch --------------
const created = await (await json(jarA, '/api/conversations', 'POST', {})).json()
const convId = created.id
const row0 = (await (await json(jarA, '/api/archive', 'GET')).json()).conversations.find(
  (c) => c.id === convId,
)
check('new conversation has archive on', row0?.archiveEnabled === true)
check('new conversation has auto-read on', row0?.autoRead === true)

const dir = path.join(originalRoot, convId)
const transcriptPath = path.join(dir, 'transcript.md')
const jsonlPath = path.join(dir, 'context.jsonl')
const metaPath = path.join(dir, 'meta.json')

// --- messages are mirrored to disk ---------------------------------------
await json(jarA, `/api/conversations/${convId}/messages`, 'POST', {
  role: 'user',
  content: '第一条用户消息：请记住樱花是粉色的。',
})
await json(jarA, `/api/conversations/${convId}/messages`, 'POST', {
  role: 'assistant',
  content: '第一条助手回复：好的，已记住樱花是粉色的。',
  usage: { inputTokens: 50, outputTokens: 20 },
})

check('conversation folder exists', await exists(dir))
const transcript1 = await fs.readFile(transcriptPath, 'utf8').catch(() => '')
check('transcript has header', transcript1.startsWith('# '), transcript1.slice(0, 20))
check('transcript has readable entries', transcript1.includes('第一条用户消息') && transcript1.includes('第一条助手回复'))

let entries = await readJsonl(jsonlPath)
check('jsonl has two records', entries.length === 2, `got ${entries.length}`)
check('jsonl indices and roles', entries[0]?.index === 1 && entries[0]?.role === 'user' && entries[1]?.index === 2 && entries[1]?.role === 'assistant')

const meta1 = JSON.parse(await fs.readFile(metaPath, 'utf8').catch(() => '{}'))
check('meta.json describes the conversation', meta1.conversationId === convId && meta1.messageCount === 2 && meta1.turnCount === 1, JSON.stringify({ messageCount: meta1.messageCount, turnCount: meta1.turnCount }))
check('meta.json counts archive records', meta1.archiveEntries === 2)

// --- switching archive off stops writes and keeps files -------------------
await json(jarA, `/api/archive/${convId}`, 'PATCH', { archiveEnabled: false })
await json(jarA, `/api/conversations/${convId}/messages`, 'POST', {
  role: 'user',
  content: '关闭存档后的用户消息。',
})
await json(jarA, `/api/conversations/${convId}/messages`, 'POST', {
  role: 'assistant',
  content: '关闭存档后的助手回复。',
  usage: { inputTokens: 60, outputTokens: 25 },
})
entries = await readJsonl(jsonlPath)
check('archive off stops writing', entries.length === 2, `got ${entries.length}`)
check('archive off keeps existing files', await exists(transcriptPath))

// --- turning it back on backfills what was missed -------------------------
const enable = await (
  await json(jarA, `/api/archive/${convId}`, 'PATCH', { archiveEnabled: true })
).json()
check('enabling backfills missed messages', enable.rebuilt === 2, `rebuilt ${enable.rebuilt}`)
entries = await readJsonl(jsonlPath)
check('backfilled records appended', entries.length === 4 && entries[3]?.index === 4)
check('backfilled transcript content', (await fs.readFile(transcriptPath, 'utf8')).includes('关闭存档后的助手回复'))

// --- manual read injects the archive into the system prompt ---------------
const mark = await json(jarA, `/api/archive/${convId}`, 'POST')
check('manual read accepted', mark.status === 200)
const manual = await chat(jarA, convId, '请回顾一下我们聊过什么。')
check('manual read reports injected records', (manual.metadata?.archiveInjected ?? 0) >= 4, `injected ${manual.metadata?.archiveInjected}`)
check('digest reaches the model', manual.reply.includes('历史存档（自动读取）'))
check('digest carries old content', manual.reply.includes('第一条用户消息'))

const afterManual = await prisma.conversation.findUnique({
  where: { id: convId },
  select: { needsArchiveRead: true },
})
check('manual read flag consumed', afterManual?.needsArchiveRead === false)

// --- clearing the context triggers another read-back ----------------------
await json(jarA, `/api/conversations/${convId}/messages`, 'DELETE')
const afterClear = await prisma.conversation.findUnique({
  where: { id: convId },
  select: { needsArchiveRead: true, autoRead: true },
})
check('clear marks archive for read-back', afterClear?.needsArchiveRead === true)
const cleared = await chat(jarA, convId, '上下文刚被清空，你还记得吗？')
check('read-back after clear', (cleared.metadata?.archiveInjected ?? 0) >= 4 && cleared.reply.includes('历史存档'))
check('archive survives a context clear', (await readJsonl(jsonlPath)).length === 4)

// --- numbering continues after a clear (no duplicate indices) -------------
await json(jarA, `/api/conversations/${convId}/messages`, 'POST', {
  role: 'user',
  content: '清空后的新消息。',
})
await json(jarA, `/api/conversations/${convId}/messages`, 'POST', {
  role: 'assistant',
  content: '清空后的新回复。',
  usage: { inputTokens: 40, outputTokens: 15 },
})
entries = await readJsonl(jsonlPath)
const indices = entries.map((entry) => entry.index)
check('archive numbering stays unique', entries.length === 6 && new Set(indices).size === 6, indices.join(','))
check('numbering continues after clear', entries[5]?.index === 6)

// --- periodic trigger every 20 turns --------------------------------------
const before = await prisma.conversation.findUnique({
  where: { id: convId },
  select: { archivedTurns: true, lastInjectTurn: true },
})
await prisma.conversation.update({
  where: { id: convId },
  // Simulate 20 archived turns since the last read-back.
  data: { archivedTurns: (before?.lastInjectTurn ?? 0) + 20 },
})
const periodic = await chat(jarA, convId, '每二十轮的自动读取测试。')
check('periodic read-back fires', (periodic.metadata?.archiveInjected ?? 0) > 0, `injected ${periodic.metadata?.archiveInjected}`)

// --- per-user isolation ---------------------------------------------------
check('B cannot toggle A archive', (await json(jarB, `/api/archive/${convId}`, 'PATCH', { autoRead: false })).status === 404)
check('B cannot mark A archive read', (await json(jarB, `/api/archive/${convId}`, 'POST')).status === 404)
check('B cannot delete A archive files', (await json(jarB, `/api/archive/${convId}`, 'DELETE')).status === 404)
const bList = await (await json(jarB, '/api/archive', 'GET')).json()
check('B archive list excludes A', !bList.conversations.some((c) => c.id === convId))

// --- master switch for future conversations -------------------------------
await json(jarA, '/api/archive', 'PATCH', { defaultOn: false })
const created2 = await (await json(jarA, '/api/conversations', 'POST', {})).json()
const row2 = (await (await json(jarA, '/api/archive', 'GET')).json()).conversations.find(
  (c) => c.id === created2.id,
)
check('master switch applies to new conversations', row2?.archiveEnabled === false && row2?.autoRead === false)
await json(jarA, '/api/archive', 'PATCH', { defaultOn: true })

// --- change save location with move ---------------------------------------
const tempRoot = path.join(os.tmpdir(), `sakura-archive-test-${Date.now()}`)
const moved = await (
  await json(jarA, '/api/archive', 'PATCH', { root: tempRoot, moveExisting: true })
).json()
check('directory change accepted', moved.root === tempRoot, JSON.stringify(moved))
check('existing archives moved', moved.moved >= 1 && (await exists(path.join(tempRoot, convId))) && !(await exists(dir)))

// --- delete files keeps the conversation ----------------------------------
await json(jarA, `/api/archive/${convId}`, 'DELETE')
check('delete files removes folder', !(await exists(path.join(tempRoot, convId))))
const page = await fetch(`${BASE}/chat/${convId}`, {
  headers: { Cookie: cookieHeader(jarA) },
  redirect: 'manual',
})
check('conversation survives file deletion', page.status === 200)

// --- cleanup --------------------------------------------------------------
await json(jarA, '/api/archive', 'PATCH', { root: originalRoot })
for (const id of [convId, created2.id]) {
  await fetch(`${BASE}/api/conversations/${id}`, {
    method: 'DELETE',
    headers: { Cookie: cookieHeader(jarA) },
  })
  await fs.rm(path.join(originalRoot, id), { recursive: true, force: true }).catch(() => {})
}
await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {})
await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB] } } })
await prisma.$disconnect()

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
