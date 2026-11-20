import type { UIMessage } from 'ai'
import type { TokenUsage } from '@/lib/usage'

/**
 * UI message persisted to the database. `createdAt` and the provider-reported
 * token `usage` travel in message metadata.
 */
export type ChatMessage = UIMessage<{
  createdAt?: string
  usage?: TokenUsage
  contextWindow?: number
  /** Archive records read back into the system prompt for this reply. */
  archiveInjected?: number
}>

/** Concatenates all text parts of a UI message (models here never emit others). */
export function getMessageText(message: ChatMessage): string {
  return message.parts
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('')
}
