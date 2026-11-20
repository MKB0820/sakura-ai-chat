import { NextRequest, NextResponse } from 'next/server'

// Deliberately dependency-free: no Prisma, no Argon2, no Auth.js config here.
// It only checks that a session cookie exists; the real JWT verification and
// user lookup happen in the protected layout (`app/chat/page.tsx` via `auth()`).
const SESSION_COOKIES = ['authjs.session-token', '__Secure-authjs.session-token']

export default function proxy(request: NextRequest) {
  const hasSession = SESSION_COOKIES.some((name) => request.cookies.get(name)?.value)
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/chat/:path*'],
}
