/** Fallback context window when DEEPSEEK_CONTEXT_TOKENS is not set. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 64_000

/** Only the most recent messages are forwarded to the model per request. */
export const MAX_CONTEXT_MESSAGES = 20

/** Rough per-message framing overhead (role markers, separators). */
const MESSAGE_OVERHEAD_TOKENS = 4

export type TokenUsage = {
  inputTokens: number
  outputTokens: number
}

/**
 * Rough token estimate: CJK characters count as one token each, other
 * characters as roughly 3.5 per token. Deliberately simple and deterministic;
 * the authoritative number is the provider's `usage`, shown as「上次实测」.
 */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    const isCjk =
      (code >= 0x3040 && code <= 0x30ff) || // kana
      (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
      (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
      (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
      (code >= 0xff00 && code <= 0xffef) // full-width forms
    if (isCjk) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk + other / 3.5)
}

export function estimateMessageTokens(texts: string[]): number {
  return texts.reduce(
    (total, text) => total + estimateTokens(text) + MESSAGE_OVERHEAD_TOKENS,
    0,
  )
}

/** Deterministic thousands separators (avoids locale-dependent hydration). */
export function formatTokens(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}
