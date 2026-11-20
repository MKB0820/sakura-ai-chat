import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import { authConfig } from '@/auth.config'
import { prisma } from '@/lib/db'
import { verifyPassword } from '@/lib/password'
import { loginSchema } from '@/lib/validation'

/**
 * Auth.js entry point. Runs in the Node.js runtime (and in Cloudflare Workers
 * through nodejs_compat). The edge-safe options live in auth.config.ts.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: '邮箱', type: 'email' },
        password: { label: '密码', type: 'password' },
      },
      // Returns null for every failure mode on purpose: the client only ever
      // shows "邮箱或密码不正确", never whether the email exists.
      authorize: async (credentials) => {
        const parsed = loginSchema.safeParse(credentials)
        if (!parsed.success) return null
        const { email, password } = parsed.data

        const user = await prisma.user.findUnique({ where: { email } })
        const passwordOk = await verifyPassword(user?.passwordHash ?? null, password)
        if (!user || !passwordOk) return null

        return { id: user.id, email: user.email }
      },
    }),
  ],
})
