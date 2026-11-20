import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import ChatPanel from '@/components/ChatPanel'
import type { ChatMessage } from '@/lib/chat-types'
import { buildSystemPrompt, getPersona } from '@/lib/personas'
import { estimateTokens } from '@/lib/usage'
import { getContextWindowTokens } from '@/lib/config'

export const dynamic = 'force-dynamic'

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const { id } = await params

  const conversation = await prisma.conversation.findFirst({
    where: { id, userId: session.user.id },
    select: { id: true, personaId: true },
  })
  if (!conversation) redirect('/chat')

  const rows = await prisma.message.findMany({
    where: { conversationId: conversation.id, userId: session.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      role: true,
      content: true,
      createdAt: true,
      inputTokens: true,
      outputTokens: true,
    },
  })

  const initialMessages: ChatMessage[] = rows.reverse().map((row) => ({
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    parts: [{ type: 'text', text: row.content }],
    metadata: {
      createdAt: row.createdAt.toISOString(),
      ...(row.role === 'assistant' && row.inputTokens != null && row.outputTokens != null
        ? { usage: { inputTokens: row.inputTokens, outputTokens: row.outputTokens } }
        : {}),
    },
  }))

  const persona = getPersona(conversation.personaId)

  return (
    <ChatPanel
      key={conversation.id}
      conversationId={conversation.id}
      initialMessages={initialMessages}
      persona={{ emoji: persona.emoji, name: persona.name, isDefault: persona.id === 'default' }}
      systemPromptTokens={estimateTokens(buildSystemPrompt(conversation.personaId))}
      contextWindow={getContextWindowTokens()}
    />
  )
}
