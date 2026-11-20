import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { conversationDir, getArchiveRoot } from '@/lib/archive'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  conversationId: z.string().optional(),
})

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    // An empty body opens the archive root.
  }
  const parsed = bodySchema.safeParse(body ?? {})
  const conversationId = parsed.success ? parsed.data.conversationId : undefined

  const root = await getArchiveRoot()
  let dir = root

  if (conversationId) {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userId: session.user.id },
      select: { id: true },
    })
    if (!conversation) {
      return Response.json({ error: '对话不存在。' }, { status: 404 })
    }
    dir = conversationDir(root, conversationId)
  }

  try {
    await fs.mkdir(dir, { recursive: true })
  } catch {
    return Response.json({ error: '目录不存在且无法创建。' }, { status: 400 })
  }

  const opener =
    process.platform === 'win32'
      ? 'explorer'
      : process.platform === 'darwin'
        ? 'open'
        : 'xdg-open'
  try {
    const child = spawn(opener, [dir], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch (error) {
    console.error('[archive] open failed:', error)
    return Response.json({ error: '无法打开文件管理器。' }, { status: 500 })
  }

  return Response.json({ ok: true, dir })
}
