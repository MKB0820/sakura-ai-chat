import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { archiveHasFiles, deleteArchive, isArchiveSupported, rebuildArchive } from '@/lib/archive'

const UNSUPPORTED = () =>
  Response.json(
    { error: '当前运行环境（Cloudflare Workers）不支持本地文件存档。', unsupported: true },
    { status: 501 },
  )

export const dynamic = 'force-dynamic'

const patchSchema = z.object({
  archiveEnabled: z.boolean().optional(),
  autoRead: z.boolean().optional(),
  exportNow: z.boolean().optional(),
})

async function ownedConversation(id: string, userId: string) {
  return prisma.conversation.findFirst({
    where: { id, userId },
    select: { id: true, archiveEnabled: true },
  })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isArchiveSupported()) return UNSUPPORTED()

  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  const { id } = await params
  const conversation = await ownedConversation(id, session.user.id)
  if (!conversation) {
    return Response.json({ error: '对话不存在。' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: '请求格式不正确。' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: '参数不合法。' }, { status: 400 })
  }

  const { archiveEnabled, autoRead, exportNow } = parsed.data
  const enabling = archiveEnabled === true && !conversation.archiveEnabled

  let rebuilt = 0
  // Enabling late backfills from the message log; exportNow forces a rewrite.
  if (enabling || exportNow) {
    rebuilt = await rebuildArchive(id)
  }

  await prisma.conversation.update({
    where: { id },
    data: {
      ...(archiveEnabled !== undefined ? { archiveEnabled } : {}),
      ...(autoRead !== undefined ? { autoRead } : {}),
    },
  })

  return Response.json({ ok: true, rebuilt })
}

/** 「立即读取」: mark the conversation so the next reply reads the archive once. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isArchiveSupported()) return UNSUPPORTED()

  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  const { id } = await params
  const conversation = await ownedConversation(id, session.user.id)
  if (!conversation) {
    return Response.json({ error: '对话不存在。' }, { status: 404 })
  }
  if (!(await archiveHasFiles(id))) {
    return Response.json({ error: '该对话还没有存档文件，请先开启存档。' }, { status: 400 })
  }

  await prisma.conversation.update({
    where: { id },
    data: { needsArchiveRead: true },
  })

  return Response.json({ ok: true })
}

/** 「删除文件」: removes the archive folder, keeps the conversation. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!isArchiveSupported()) return UNSUPPORTED()

  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  const { id } = await params
  const conversation = await ownedConversation(id, session.user.id)
  if (!conversation) {
    return Response.json({ error: '对话不存在。' }, { status: 404 })
  }

  await deleteArchive(id)
  await prisma.conversation.update({
    where: { id },
    data: { archivedTurns: 0, lastInjectTurn: 0, needsArchiveRead: false },
  })

  return Response.json({ ok: true })
}
