import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import AuthForm from '@/components/AuthForm'

export default async function LoginPage() {
  const session = await auth()
  if (session?.user) redirect('/chat')

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <AuthForm />
    </main>
  )
}
