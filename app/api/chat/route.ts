import { createDeepSeek } from '@ai-sdk/deepseek'
import {
  APICallError,
  convertToModelMessages,
  createUIMessageStreamResponse,
  streamText,
} from 'ai'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import type { ChatMessage } from '@/lib/chat-types'
import { buildSystemPrompt } from '@/lib/personas'
import { MAX_CONTEXT_MESSAGES } from '@/lib/usage'
import { getChatModelId, getContextWindowTokens } from '@/lib/config'
import { ARCHIVE_INJECT_EVERY_TURNS, buildArchiveDigest } from '@/lib/archive'

export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  conversationId: z.string().min(1),
  messages: z.array(z.unknown()).min(1),
})

function mapProviderError(error: unknown): string {
  if (error instanceof APICallError) {
    if (error.statusCode === 401) {
      return 'DeepSeek API 密钥无效或已过期，请联系管理员检查服务端配置。'
    }
    if (error.statusCode === 429) {
      return '请求过于频繁，已触发限流，请稍后再试。'
    }
    if (error.statusCode && error.statusCode >= 500) {
      return 'DeepSeek 服务暂时不可用，请稍后再试。'
    }
  }
  console.error('[chat] stream error:', error)
  return '生成回复时出现问题，请稍后重试。'
}

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: '未登录，请先登录。' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return Response.json({ error: '请求格式不正确。' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: '请求参数不合法。' }, { status: 400 })
  }

  // Ownership check: the persona always comes from the database, never from
  // the request body, so a client cannot inject or swap system instructions.
  const conversation = await prisma.conversation.findFirst({
    where: { id: parsed.data.conversationId, userId: session.user.id },
    select: {
      id: true,
      personaId: true,
      archiveEnabled: true,
      autoRead: true,
      archivedTurns: true,
      lastInjectTurn: true,
      needsArchiveRead: true,
    },
  })
  if (!conversation) {
    return Response.json({ error: '对话不存在。' }, { status: 404 })
  }

  // Token budget: only the most recent turns are forwarded. The persona lives
  // in the `system` field below, outside this window, so trimming never
  // compresses it.
  const recentMessages = (parsed.data.messages as ChatMessage[]).slice(-MAX_CONTEXT_MESSAGES)

  // Archive read-back. The digest is rebuilt from disk on each trigger and is
  // never stored in the message list, so it survives both trimming and clears.
  let archiveDigest: string | null = null
  let archiveInjected = 0
  const manualRead = conversation.needsArchiveRead
  const periodicRead =
    conversation.autoRead &&
    conversation.archivedTurns - conversation.lastInjectTurn >= ARCHIVE_INJECT_EVERY_TURNS

  if (conversation.archiveEnabled && (manualRead || periodicRead)) {
    try {
      const digest = await buildArchiveDigest(
        conversation.id,
        new Set(recentMessages.map((message) => message.id)),
      )
      if (digest) {
        archiveDigest = digest.text
        archiveInjected = digest.selected
      }
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          needsArchiveRead: false,
          lastInjectTurn: conversation.archivedTurns,
        },
      })
    } catch (error) {
      console.error('[archive] digest failed:', error)
    }
  }

  const systemPrompt =
    buildSystemPrompt(conversation.personaId) +
    (archiveDigest ? `\n\n${archiveDigest}` : '')

  const deepseek = createDeepSeek({
    apiKey: process.env.DEEPSEEK_API_KEY,
    ...(process.env.DEEPSEEK_BASE_URL ? { baseURL: process.env.DEEPSEEK_BASE_URL } : {}),
  })

  try {
    const result = streamText({
      model: deepseek(getChatModelId()),
      // Base system prompt + persona, sent as one system message on every turn,
      // plus an archive digest on the turns that read it back.
      system: systemPrompt,
      messages: await convertToModelMessages(recentMessages),
      abortSignal: request.signal,
    })

    return createUIMessageStreamResponse({
      stream: result.toUIMessageStream({
        onError: mapProviderError,
        // Ship the provider's token usage to the client with the finished
        // message so the usage meter can show real numbers, not estimates.
        messageMetadata: ({ part }) => {
          if (part.type === 'start') {
            return { contextWindow: getContextWindowTokens(), archiveInjected }
          }
          if (part.type === 'finish') {
            return {
              contextWindow: getContextWindowTokens(),
              archiveInjected,
              usage: {
                inputTokens: part.totalUsage.inputTokens ?? 0,
                outputTokens: part.totalUsage.outputTokens ?? 0,
              },
            }
          }
          return undefined
        },
      }),
      headers: {
        'Cache-Control': 'no-cache, no-transform',
        'X-Vercel-CDN-Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    const message = mapProviderError(error)
    const status = error instanceof APICallError && error.statusCode ? error.statusCode : 500
    return Response.json({ error: message }, { status })
  }
}
