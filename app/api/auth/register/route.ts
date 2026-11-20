import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { hashPassword } from '@/lib/password'
import { registerSchema } from '@/lib/validation'

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: '请求格式不正确' }, { status: 400 })
  }

  const parsed = registerSchema.safeParse(body)
  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message ?? '输入不合法'
    return Response.json({ error: firstError }, { status: 400 })
  }

  const { email, password } = parsed.data

  try {
    const passwordHash = await hashPassword(password)
    await prisma.user.create({ data: { email, passwordHash } })
    return Response.json({ ok: true }, { status: 201 })
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return Response.json({ error: '该邮箱已被注册' }, { status: 409 })
    }
    console.error('[register] failed:', error)
    return Response.json({ error: '注册失败，请稍后再试' }, { status: 500 })
  }
}
