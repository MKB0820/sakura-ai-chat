import { defineCloudflareConfig } from '@opennextjs/cloudflare'

// No incremental-cache overrides: every page and API route in this app is
// dynamic (force-dynamic), and chat streaming must never be cached.
export default defineCloudflareConfig({})
