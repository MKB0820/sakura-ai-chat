import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { appendToArchive } from '@/lib/archive'

const bodySchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(50_000),
  // Provider-reported usage, only meaningful for assistant replies.
  usage: z
    .object({
      inputTokens: z.number().int().min(0).max(10_000_000),
      outputTokens: z.number().int().min(0).max(10_000_000),
    })
    .optional(),
})

const DEFAULT_TITLE = '新对话'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: '请求格式不正确。' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: '消息内容不合法。' }, { status: 400 })
  }

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, title: true, archiveEnabled: true },
  })
  if (!conversation) {
    return Response.json({ error: '对话不存在。' }, { status: 404 })
  }

  // Message index in the conversation, used for archive numbering.
  const existingCount = await prisma.message.count({
    where: { conversationId: conversation.id },
  })

  const isAssistant = parsed.data.role === 'assistant'
  const saved = await prisma.message.create({
    data: {
      userId: session.user.id,
      conversationId: conversation.id,
      role: parsed.data.role,
      content: parsed.data.content,
      inputTokens: isAssistant ? (parsed.data.usage?.inputTokens ?? null) : null,
      outputTokens: isAssistant ? (parsed.data.usage?.outputTokens ?? null) : null,
    },
    select: { id: true, createdAt: true },
  })

  // Name the conversation after its first user message, and bump its position
  // in the sidebar. Persona is untouched here by design.
  const isFirstMessage =
    conversation.title === DEFAULT_TITLE &&
    parsed.data.role === 'user' &&
    existingCount === 0

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      updatedAt: new Date(),
      ...(isFirstMessage
        ? { title: parsed.data.content.replace(/\s+/g, ' ').slice(0, 24) }
        : {}),
    },
  })

  // Mirror the message into the local archive. Best-effort: a disk failure
  // must not fail the chat itself.
  if (conversation.archiveEnabled) {
    try {
      await appendToArchive({
        conversationId: conversation.id,
        role: parsed.data.role,
        content: parsed.data.content,
        messageId: saved.id,
        createdAt: saved.createdAt,
      })
      if (isAssistant) {
        await prisma.conversation.update({
          where: { id: conversation.id },
          data: { archivedTurns: { increment: 1 } },
        })
      }
    } catch (error) {
      console.error('[archive] append failed:', error)
    }
  }

  return Response.json({ ok: true, id: saved.id, createdAt: saved.createdAt }, { status: 201 })
}

/** Clears the chat history only. The conversation (and its persona) survives. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  const { id } = await params

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, archiveEnabled: true, autoRead: true },
  })
  if (!conversation) {
    return Response.json({ error: '对话不存在。' }, { status: 404 })
  }

  const result = await prisma.message.deleteMany({
    where: { conversationId: conversation.id, userId: session.user.id },
  })

  // Clearing the context is one of the moments the archive reads back in.
  if (conversation.archiveEnabled && conversation.autoRead) {
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { needsArchiveRead: true },
    })
  }

  return Response.json({ ok: true, deleted: result.count })
}
