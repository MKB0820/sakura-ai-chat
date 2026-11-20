'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { DEFAULT_PERSONA, PERSONAS } from '@/lib/personas'

type Props = {
  open: boolean
  onClose: () => void
}

export default function PersonaDialog({ open, onClose }: Props) {
  const router = useRouter()
  const [selected, setSelected] = useState(PERSONAS[0].id)
  const [pending, setPending] = useState<'selected' | 'default' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const selectedPersona = PERSONAS.find((p) => p.id === selected) ?? PERSONAS[0]

  const createConversation = async (personaId: string, which: 'selected' | 'default') => {
    setPending(which)
    setError(null)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personaId }),
      })
      if (!res.ok) {
        setError('创建对话失败，请稍后再试。')
        return
      }
      const data = (await res.json()) as { id: string }
      onClose()
      // Navigating to the new conversation re-renders the page; a refresh()
      // here would cancel this transition before it commits.
      router.push(`/chat/${data.id}`)
    } catch {
      setError('网络异常，请稍后再试。')
    } finally {
      setPending(null)
    }
  }

  const busy = pending !== null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="persona-dialog-title"
        tabIndex={-1}
        className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="persona-dialog-title" className="text-lg font-semibold">
              设置人设
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              人设与系统提示词同级，清除上下文或压缩历史都不会移除它。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-md px-2 py-1 text-muted-foreground hover:bg-secondary"
          >
            ✕
          </button>
        </div>

        <div role="radiogroup" aria-label="选择人设" className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PERSONAS.map((persona) => {
            const active = persona.id === selected
            return (
              <button
                key={persona.id}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelected(persona.id)}
                disabled={busy}
                className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                  active
                    ? 'border-primary bg-primary/5 ring-1 ring-primary'
                    : 'border-border hover:bg-secondary/60'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <span aria-hidden="true">{persona.emoji}</span>
                  {persona.name}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {persona.description}
                </span>
              </button>
            )
          })}
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-5 space-y-2">
          <Button
            type="button"
            className="w-full"
            disabled={busy}
            onClick={() => void createConversation(selectedPersona.id, 'selected')}
          >
            {pending === 'selected'
              ? '创建中…'
              : `用「${selectedPersona.name}」开始对话`}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={busy}
            onClick={() => void createConversation(DEFAULT_PERSONA.id, 'default')}
          >
            {pending === 'default' ? '创建中…' : '使用默认人设'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            「使用默认人设」不会添加任何额外设定。
          </p>
        </div>
      </div>
    </div>
  )
}
