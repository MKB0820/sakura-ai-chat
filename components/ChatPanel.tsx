'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { ChatMessage } from '@/lib/chat-types'
import { getMessageText } from '@/lib/chat-types'
import {
  MAX_CONTEXT_MESSAGES,
  estimateMessageTokens,
  formatTokens,
  type TokenUsage,
} from '@/lib/usage'

type PersonaInfo = {
  emoji: string
  name: string
  isDefault: boolean
}

type Props = {
  conversationId: string
  initialMessages: ChatMessage[]
  persona: PersonaInfo
  /** Estimated tokens of the base system prompt plus the conversation persona. */
  systemPromptTokens: number
  /** Context window of the serving model, resolved server-side. */
  contextWindow: number
}

export default function ChatPanel({
  conversationId,
  initialMessages,
  persona,
  systemPromptTokens,
  contextWindow,
}: Props) {
  const router = useRouter()
  const [input, setInput] = useState('')
  const [partialReplyNotice, setPartialReplyNotice] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  // One transport per conversation; the id lets the API resolve the stored
  // persona server-side instead of trusting anything from the client.
  const [transport] = useState(
    () =>
      new DefaultChatTransport({
        api: '/api/chat',
        body: { conversationId },
      }),
  )

  const persistMessage = async (
    role: 'user' | 'assistant',
    content: string,
    usage?: TokenUsage,
  ) => {
    try {
      await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, content, ...(usage ? { usage } : {}) }),
      })
    } catch {
      // Persistence is best-effort; the conversation stays usable in memory.
    }
  }

  const { messages, sendMessage, setMessages, status, stop, error, clearError } =
    useChat<ChatMessage>({
      messages: initialMessages,
      transport,
      onFinish: ({ message, isDisconnect, isError }) => {
        if (isDisconnect) {
          setPartialReplyNotice(true)
          return
        }
        if (isError) return
        const text = getMessageText(message)
        if (text.trim()) {
          void persistMessage('assistant', text, message.metadata?.usage).then(() =>
            router.refresh(),
          )
        }
      },
      onError: () => {
        setPartialReplyNotice(true)
      },
    })

  const isBusy = status === 'submitted' || status === 'streaming'

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  // Let a pending "confirm clear" lapse instead of staying armed forever.
  useEffect(() => {
    if (!confirmClear) return
    const timer = setTimeout(() => setConfirmClear(false), 4000)
    return () => clearTimeout(timer)
  }, [confirmClear])

  const submit = () => {
    const text = input.trim()
    if (!text || isBusy) return
    setInput('')
    setPartialReplyNotice(false)
    clearError()
    void persistMessage('user', text)
    void sendMessage({ text })
  }

  const clearContext = async () => {
    if (isBusy || clearing) return
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    setClearing(true)
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages`, {
        method: 'DELETE',
      })
      if (res.ok) {
        // Only history is dropped; the conversation row keeps its persona.
        setMessages([])
        setPartialReplyNotice(false)
        setConfirmClear(false)
        clearError()
        router.refresh()
      }
    } finally {
      setClearing(false)
    }
  }

  // Live estimate of what the next request will send: the system prompt plus
  // persona, the last MAX_CONTEXT_MESSAGES messages, and the current draft.
  const estimatedContextTokens =
    systemPromptTokens +
    estimateMessageTokens([
      ...messages.slice(-MAX_CONTEXT_MESSAGES).map(getMessageText),
      input,
    ])
  const usagePercent = Math.min(100, (estimatedContextTokens / contextWindow) * 100)
  // A 1M-token window makes early usage round to 0.0%; show a floor instead.
  const usagePercentLabel =
    estimatedContextTokens > 0 && usagePercent < 0.1 ? '<0.1' : usagePercent.toFixed(1)
  const usageBarClass =
    usagePercent >= 90
      ? 'bg-destructive'
      : usagePercent >= 70
        ? 'bg-amber-500'
        : 'bg-primary'

  const lastUsage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant' && message.metadata?.usage)?.metadata?.usage

  // Set by the chat route when this reply was preceded by an archive read-back.
  const archiveInjected =
    [...messages].reverse().find((message) => message.role === 'assistant')?.metadata
      ?.archiveInjected ?? 0

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4">
      <div className="flex items-center justify-between gap-2 py-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 px-2.5 py-1 text-xs text-primary"
            title="人设与系统提示词同级，清除上下文或压缩历史都不会移除它"
          >
            <span aria-hidden="true">{persona.emoji}</span>
            {persona.name}
          </span>
          {archiveInjected > 0 ? (
            <span
              className="shrink-0 rounded-full border border-border bg-secondary/60 px-2 py-1 text-[11px] text-muted-foreground"
              title="本次回复前，模型读取了本地存档中的历史记录"
            >
              📖 存档已读回 {archiveInjected} 条
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => void clearContext()}
          disabled={isBusy || clearing || messages.length === 0}
          className={`rounded-md border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            confirmClear
              ? 'border-destructive/50 bg-destructive/10 font-medium text-destructive'
              : 'border-border text-muted-foreground hover:bg-secondary'
          }`}
          title="只清除聊天记录，人设会保留"
        >
          {clearing ? '清除中…' : confirmClear ? '确认清除上下文？' : '清除上下文'}
        </button>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto py-4">
        {messages.length === 0 ? (
          <div className="mt-16 text-center text-muted-foreground">
            <p className="text-3xl" aria-hidden="true">
              {persona.emoji}
            </p>
            <p className="mt-3">
              {persona.isDefault
                ? '向 DeepSeek 助手提个问题吧，对话会自动保存。'
                : `与「${persona.name}」开始对话吧，对话会自动保存。`}
            </p>
          </div>
        ) : null}

        {messages.map((message) => {
          const text = getMessageText(message)
          const isUser = message.role === 'user'
          return (
            <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
              <div
                className={
                  isUser
                    ? 'max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-primary-foreground shadow-sm'
                    : 'max-w-[85%] rounded-2xl rounded-bl-md border border-border/70 bg-card px-4 py-2.5 shadow-sm backdrop-blur-sm'
                }
              >
                {isUser ? (
                  text
                ) : (
                  <div className="md-body text-sm leading-relaxed">
                    {text ? (
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                    ) : (
                      <span className="inline-flex gap-1 text-muted-foreground">
                        <span className="animate-pulse">●</span>
                        <span className="animate-pulse [animation-delay:150ms]">●</span>
                        <span className="animate-pulse [animation-delay:300ms]">●</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="sticky bottom-0 space-y-2 bg-gradient-to-t from-background via-background/95 to-transparent pb-4 pt-2">
        {error ? (
          <div
            role="alert"
            className="flex items-start justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <span>{error.message || '请求失败，请稍后再试。'}</span>
            <button
              type="button"
              onClick={clearError}
              className="shrink-0 rounded px-1.5 text-xs hover:bg-destructive/10"
              aria-label="关闭错误提示"
            >
              ✕
            </button>
          </div>
        ) : null}

        {partialReplyNotice && !error ? (
          <div
            role="status"
            className="flex items-start justify-between gap-3 rounded-lg border border-amber-400/50 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <span>回复可能不完整：连接中断或生成被中止，已保留已生成的部分内容。</span>
            <button
              type="button"
              onClick={() => setPartialReplyNotice(false)}
              className="shrink-0 rounded px-1.5 text-xs hover:bg-amber-500/10"
              aria-label="关闭提示"
            >
              ✕
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2 rounded-xl border border-border bg-card/85 p-2 shadow-md backdrop-blur-md">
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息，Enter 发送，Shift+Enter 换行"
            rows={1}
            className="max-h-40 min-h-10 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {isBusy ? (
            <Button type="button" variant="outline" onClick={stop} className="shrink-0">
              停止生成
            </Button>
          ) : (
            <Button type="button" onClick={submit} disabled={!input.trim()} className="shrink-0">
              发送
            </Button>
          )}
        </div>

        <div className="px-1" title="按字符估算，随输入和流式回复实时更新；「上次实测」来自模型返回的 usage">
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>
              上下文 ≈ {formatTokens(estimatedContextTokens)} /{' '}
              {formatTokens(contextWindow)} tokens（{usagePercentLabel}%）
            </span>
            {lastUsage ? (
              <span className="hidden shrink-0 sm:inline">
                上次实测：输入 {formatTokens(lastUsage.inputTokens)} · 输出{' '}
                {formatTokens(lastUsage.outputTokens)}
              </span>
            ) : null}
          </div>
          <div
            role="progressbar"
            aria-label="上下文用量"
            aria-valuemin={0}
            aria-valuemax={contextWindow}
            aria-valuenow={Math.round(estimatedContextTokens)}
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary"
          >
            <div
              className={`h-full rounded-full transition-[width] duration-300 ${usageBarClass}`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
