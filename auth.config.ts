import type { NextAuthConfig } from 'next-auth'

/**
 * Edge-safe Auth.js configuration: no Prisma, no Node-only modules.
 * The providers are added in `lib/auth.ts`; keeping them out of this object
 * avoids emitting a second `providers` key when the configs are merged.
 */
export const authConfig: Omit<NextAuthConfig, 'providers'> = {
  trustHost: true,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.id = user.id
      return token
    },
    session({ session, token }) {
      if (token.id) session.user.id = token.id as string
      return session
    },
  },
}
