import { z } from 'zod'
import { promises as fs } from 'node:fs'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  archiveHasFiles,
  getArchiveDefaultOn,
  getArchiveRoot,
  moveArchives,
  resolveArchivePath,
  setArchiveDefaultOn,
  setArchiveRoot,
} from '@/lib/archive'

export const dynamic = 'force-dynamic'

const settingsSchema = z.object({
  root: z.string().trim().min(1).optional(),
  moveExisting: z.boolean().optional(),
  defaultOn: z.boolean().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  const [root, defaultOn, conversations] = await Promise.all([
    getArchiveRoot(),
    getArchiveDefaultOn(),
    prisma.conversation.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      take: 100,
      select: {
        id: true,
        title: true,
        personaId: true,
        archiveEnabled: true,
        autoRead: true,
        archivedTurns: true,
        needsArchiveRead: true,
        _count: { select: { messages: true } },
      },
    }),
  ])

  const withFiles = await Promise.all(
    conversations.map(async (conversation) => ({
      id: conversation.id,
      title: conversation.title,
      personaId: conversation.personaId,
      archiveEnabled: conversation.archiveEnabled,
      autoRead: conversation.autoRead,
      archivedTurns: conversation.archivedTurns,
      needsArchiveRead: conversation.needsArchiveRead,
      messageCount: conversation._count.messages,
      hasFiles: await archiveHasFiles(conversation.id),
    })),
  )

  return Response.json({ root, defaultOn, conversations: withFiles })
}

export async function PATCH(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: '请求格式不正确。' }, { status: 400 })
  }

  const parsed = settingsSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: '参数不合法。' }, { status: 400 })
  }

  let moved = 0
  let root: string | null = null

  if (parsed.data.root) {
    const nextRoot = resolveArchivePath(parsed.data.root)
    try {
      await fs.mkdir(nextRoot, { recursive: true })
      await fs.access(nextRoot, fs.constants.W_OK)
    } catch {
      return Response.json({ error: `目录不可写：${nextRoot}` }, { status: 400 })
    }

    const previousRoot = await getArchiveRoot()
    if (parsed.data.moveExisting) {
      try {
        moved = await moveArchives(previousRoot, nextRoot)
      } catch (error) {
        console.error('[archive] move failed:', error)
        return Response.json({ error: '迁移已有存档失败。' }, { status: 500 })
      }
    }
    await setArchiveRoot(nextRoot)
    root = nextRoot
  }

  if (parsed.data.defaultOn !== undefined) {
    await setArchiveDefaultOn(parsed.data.defaultOn)
  }

  return Response.json({
    ok: true,
    root: root ?? (await getArchiveRoot()),
    defaultOn: await getArchiveDefaultOn(),
    moved,
  })
}
