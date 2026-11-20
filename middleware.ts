import { NextRequest, NextResponse } from 'next/server'

// Must stay `middleware.ts` (not `proxy.ts`): @opennextjs/cloudflare does not
// pick up the Next 16 `proxy.ts` filename, which would silently disable route
// protection on Cloudflare. The file is Edge-compatible on purpose — no Prisma,
// no Argon2, no node:fs. It only checks that a session cookie exists; the real
// JWT verification and user lookup happen in the protected layout via auth().
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token']

export default function middleware(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.get(name)?.value)
  if (!hasSession) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/chat/:path*'],
}
