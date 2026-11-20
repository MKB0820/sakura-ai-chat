import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import ChatShell from '@/components/ChatShell'

export const dynamic = 'force-dynamic'

export default async function ChatLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const conversations = await prisma.conversation.findMany({
    where: { userId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    take: 100,
    select: { id: true, title: true, personaId: true },
  })

  return (
    <ChatShell userEmail={session.user.email} conversations={conversations}>
      {children}
    </ChatShell>
  )
}
