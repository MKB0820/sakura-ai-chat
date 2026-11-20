import NewConversationHero from '@/components/NewConversationHero'

export const dynamic = 'force-dynamic'

export default function ChatHomePage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-16">
      <NewConversationHero />
    </div>
  )
}
