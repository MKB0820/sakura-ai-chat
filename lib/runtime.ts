/**
 * True when the code is running inside Cloudflare Workers (workerd), as
 * opposed to `next dev` / `next start` on Node.js.
 *
 * Used to disable Node-only features (local file archive, filesystem-backed
 * master keys) with an explicit error instead of a silent failure.
 */
export function isCloudflareWorkers(): boolean {
  return typeof navigator !== 'undefined' && navigator.userAgent === 'Cloudflare-Workers'
}
