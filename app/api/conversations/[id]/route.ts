import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { deleteArchive } from '@/lib/archive'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  const { id } = await params

  // deleteMany keeps the userId predicate in the WHERE clause, so one user can
  // never delete another's conversation.
  const result = await prisma.conversation.deleteMany({
    where: { id, userId: session.user.id },
  })

  if (result.count === 0) {
    return Response.json({ error: '对话不存在。' }, { status: 404 })
  }

  // The conversation is gone from the panel, so its folder would be orphaned.
  try {
    await deleteArchive(id)
  } catch (error) {
    console.error('[archive] delete on conversation removal failed:', error)
  }

  return Response.json({ ok: true })
}
