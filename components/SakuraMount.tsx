'use client'

import dynamic from 'next/dynamic'

// `ssr: false` is only legal inside a Client Component, so this thin wrapper
// keeps app/layout.tsx a Server Component while still loading the canvas
// client-only (otherwise window access would run during SSR).
const SakuraBackground = dynamic(() => import('./SakuraBackground'), {
  ssr: false,
})

export default function SakuraMount() {
  return <SakuraBackground />
}
