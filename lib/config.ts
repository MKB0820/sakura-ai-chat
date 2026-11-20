import { DEFAULT_CONTEXT_WINDOW_TOKENS } from '@/lib/usage'

/**
 * Server-only runtime configuration. Values come from `.env.local`, which is
 * gitignored and never reaches the browser bundle.
 */

/** DeepSeek model id. `deepseek-chat` is the documented alias for the current chat model. */
export function getChatModelId(): string {
  return process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-chat'
}

/** Context window of the serving model, used by the usage meter. */
export function getContextWindowTokens(): number {
  const parsed = Number(process.env.DEEPSEEK_CONTEXT_TOKENS)
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_CONTEXT_WINDOW_TOKENS
}
