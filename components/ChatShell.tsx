'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import PersonaDialog from '@/components/PersonaDialog'
import ArchivePanel from '@/components/ArchivePanel'
import { getPersona } from '@/lib/personas'

export type ConversationSummary = {
  id: string
  title: string
  personaId: string
}

type Props = {
  userEmail: string
  conversations: ConversationSummary[]
  /** Local file archives need a filesystem; disabled on Cloudflare Workers. */
  archiveAvailable: boolean
  children: React.ReactNode
}

export default function ChatShell({
  userEmail,
  conversations,
  archiveAvailable,
  children,
}: Props) {
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const activeId = pathname?.startsWith('/chat/') ? pathname.slice('/chat/'.length) : null

  // A conversation created on the client is not in the layout's data yet.
  // Ask the server for a fresh list once so it appears in the sidebar.
  useEffect(() => {
    if (activeId && !conversations.some((conversation) => conversation.id === activeId)) {
      router.refresh()
    }
  }, [activeId, conversations, router])

  const openDialog = () => {
    setMobileOpen(false)
    setDialogOpen(true)
  }

  const deleteConversation = async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: 'DELETE' })
      setPendingDeleteId(null)
      if (res.ok) {
        if (activeId === id) {
          // Leave the page first; refreshing here would cancel the push.
          router.push('/chat')
        } else {
          router.refresh()
        }
      }
    } finally {
      setDeletingId(null)
    }
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-2 p-3">
      <button
        type="button"
        onClick={openDialog}
        className="flex w-full items-center justify-center gap-2 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
      >
        <span aria-hidden="true">＋</span> 新对话
      </button>

      {archiveAvailable ? (
        <button
          type="button"
          onClick={() => {
            setMobileOpen(false)
            setArchiveOpen(true)
          }}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <span aria-hidden="true">🗂</span> 存档管理
        </button>
      ) : null}

      <p className="px-1 pt-2 text-xs font-medium text-muted-foreground">对话记录</p>

      {conversations.length === 0 ? (
        <p className="px-1 py-2 text-xs leading-relaxed text-muted-foreground">
          还没有对话，点击上方按钮开始吧。
        </p>
      ) : (
        <ul className="space-y-1">
          {conversations.map((conversation) => {
            const persona = getPersona(conversation.personaId)
            const active = conversation.id === activeId
            const confirming = pendingDeleteId === conversation.id
            return (
              <li key={conversation.id} className="relative">
                <Link
                  href={`/chat/${conversation.id}`}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-2 rounded-lg py-2 pl-2.5 pr-9 text-sm transition-colors ${
                    active
                      ? 'bg-secondary font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
                  }`}
                >
                  <span aria-hidden="true">{persona.emoji}</span>
                  <span className="truncate">{conversation.title}</span>
                </Link>
                <button
                  type="button"
                  disabled={deletingId === conversation.id}
                  onClick={() => {
                    if (confirming) {
                      void deleteConversation(conversation.id)
                    } else {
                      setPendingDeleteId(conversation.id)
                    }
                  }}
                  aria-label={
                    confirming ? `确认删除对话「${conversation.title}」` : `删除对话「${conversation.title}」`
                  }
                  title={confirming ? '再次点击确认删除' : '删除对话'}
                  className={`absolute right-1 top-1/2 -translate-y-1/2 rounded px-1.5 py-1 text-xs transition-colors ${
                    confirming
                      ? 'bg-destructive/10 font-medium text-destructive'
                      : 'text-muted-foreground/60 hover:bg-secondary hover:text-foreground'
                  } disabled:opacity-40`}
                >
                  {deletingId === conversation.id ? '…' : confirming ? '确认' : '✕'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-border/60 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="rounded-md border border-border px-2 py-1 text-sm md:hidden"
              aria-label="打开对话列表"
            >
              ☰
            </button>
            <Link href="/chat" className="flex items-center gap-2 truncate font-semibold">
              <span aria-hidden="true">🌸</span> 樱语 · Sakura Chat
            </Link>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-[220px] truncate text-sm text-muted-foreground sm:inline">
              {userEmail}
            </span>
            <button
              type="button"
              onClick={() => void signOut({ redirectTo: '/login' })}
              className="rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-secondary"
            >
              退出登录
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1">
        <aside className="hidden w-64 shrink-0 border-r border-border/60 md:block">{sidebar}</aside>
        <div className="flex min-w-0 flex-1 flex-col">{children}</div>
      </div>

      {mobileOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/35"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto border-r border-border bg-background shadow-xl">
            <div className="flex items-center justify-between px-3 py-3">
              <span className="text-sm font-medium">对话</span>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="关闭对话列表"
                className="rounded px-2 py-1 text-muted-foreground hover:bg-secondary"
              >
                ✕
              </button>
            </div>
            {sidebar}
          </div>
        </div>
      ) : null}

      <PersonaDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      <ArchivePanel open={archiveOpen} onClose={() => setArchiveOpen(false)} />
    </div>
  )
}
