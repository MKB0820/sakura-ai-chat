import { DEFAULT_CONTEXT_WINDOW_TOKENS } from '@/lib/usage'

/**
 * Server-only runtime configuration. Values come from `.env.local`, which is
 * gitignored and never reaches the browser bundle.
 */

/**
 * DeepSeek model id. Every conversation uses this one model at request time;
 * `deepseek-flash` (DeepSeek-V4.1-Flash) is the default. Override with
 * DEEPSEEK_MODEL if the account serves a different id.
 */
export function getChatModelId(): string {
  return process.env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash'
}

/** Context window of the serving model, used by the usage meter. */
export function getContextWindowTokens(): number {
  const parsed = Number(process.env.DEEPSEEK_CONTEXT_TOKENS)
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : DEFAULT_CONTEXT_WINDOW_TOKENS
}
