import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `cacheComponents` (Next 16 default) forbids route segment config such as
  // `export const dynamic = 'force-dynamic'`, which the chat API and chat page
  // require. Disabled so those directives take effect.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
