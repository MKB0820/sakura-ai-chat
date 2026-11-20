import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const nextConfig: NextConfig = {
  // `cacheComponents` (Next 16 default) forbids route segment config such as
  // `export const dynamic = 'force-dynamic'`, which the chat API and chat page
  // require. It is also incompatible with @opennextjs/cloudflare, where it can
  // serve only the static shell with no streamed content. Keep it disabled.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

// Makes the D1 binding available to `next dev` (through Wrangler/miniflare),
// so local development uses the same D1 adapter as Workers. No-op in builds.
void initOpenNextCloudflareForDev();

export default nextConfig;
