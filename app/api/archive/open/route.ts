import { promises as fs } from 'node:fs'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { conversationDir, getArchiveRoot, isArchiveSupported } from '@/lib/archive'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  conversationId: z.string().optional(),
})

export async function POST(request: Request) {
  if (!isArchiveSupported()) {
    return Response.json(
      { error: '当前运行环境（Cloudflare Workers）不支持本地文件存档。', unsupported: true },
      { status: 501 },
    )
  }

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
    // Imported lazily: node:child_process is unavailable on Workers, and this
    // code path is guarded above.
    const { spawn } = await import('node:child_process')
    const child = spawn(opener, [dir], { detached: true, stdio: 'ignore' })
    child.unref()
  } catch (error) {
    console.error('[archive] open failed:', error)
    return Response.json({ error: '无法打开文件管理器。' }, { status: 500 })
  }

  return Response.json({ ok: true, dir })
}
