'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import PersonaDialog from '@/components/PersonaDialog'
import { PERSONAS } from '@/lib/personas'

export default function NewConversationHero() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="w-full max-w-md rounded-2xl border border-primary/15 bg-card/80 p-8 text-center shadow-xl shadow-primary/10 backdrop-blur-md">
        <p className="text-4xl" aria-hidden="true">
          🌸
        </p>
        <h1 className="mt-3 text-xl font-semibold">开始一段新对话</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          先选一个人设再开始聊天。人设与系统提示词同级，清除上下文也不会丢失。
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          {PERSONAS.map((persona) => (
            <span
              key={persona.id}
              className="rounded-full border border-border bg-secondary/60 px-2.5 py-1 text-xs text-muted-foreground"
            >
              {persona.emoji} {persona.name}
            </span>
          ))}
        </div>
        <Button className="mt-6 w-full" onClick={() => setOpen(true)}>
          开启新对话
        </Button>
      </div>
      <PersonaDialog open={open} onClose={() => setOpen(false)} />
    </>
  )
}
