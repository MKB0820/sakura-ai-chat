import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolvePersonaId } from '@/lib/personas'
import { getArchiveDefaultOn } from '@/lib/archive'

const createSchema = z.object({
  personaId: z.string().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  const conversations = await prisma.conversation.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: { id: true, title: true, personaId: true, updatedAt: true },
  })

  return Response.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      title: c.title,
      personaId: c.personaId,
      updatedAt: c.updatedAt.toISOString(),
    })),
  })
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录。' }, { status: 401 })
  }

  let body: unknown = {}
  try {
    body = await request.json()
  } catch {
    // An empty body means "default persona", which is valid.
  }

  const parsed = createSchema.safeParse(body ?? {})
  const personaId = resolvePersonaId(parsed.success ? parsed.data.personaId : undefined)

  // New conversations inherit the archive master switch.
  const archiveOn = await getArchiveDefaultOn()

  const conversation = await prisma.conversation.create({
    data: {
      userId: session.user.id,
      personaId,
      archiveEnabled: archiveOn,
      autoRead: archiveOn,
    },
    select: { id: true, title: true, personaId: true },
  })

  return Response.json(conversation, { status: 201 })
}
