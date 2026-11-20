'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { getPersona } from '@/lib/personas'

type ArchiveRow = {
  id: string
  title: string
  personaId: string
  archiveEnabled: boolean
  autoRead: boolean
  archivedTurns: number
  needsArchiveRead: boolean
  messageCount: number
  hasFiles: boolean
}

type Overview = {
  root: string
  defaultOn: boolean
  conversations: ArchiveRow[]
}

type Props = {
  open: boolean
  onClose: () => void
}

function Toggle({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string
  active: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
        active
          ? 'border-primary/40 bg-primary/10 font-medium text-primary'
          : 'border-border text-muted-foreground hover:bg-secondary'
      }`}
    >
      {active ? `${label} · 开` : `${label} · 关`}
    </button>
  )
}

function ActionChip({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors disabled:opacity-40 ${
        danger
          ? 'border-destructive/40 text-destructive hover:bg-destructive/10'
          : 'border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
      }`}
    >
      {children}
    </button>
  )
}

export default function ArchivePanel({ open, onClose }: Props) {
  const [data, setData] = useState<Overview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [rootInput, setRootInput] = useState('')
  const [moveExisting, setMoveExisting] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  // No setState before the first await: keeps the effect free of synchronous
  // state updates (react-hooks/set-state-in-effect).
  const load = async () => {
    try {
      const res = await fetch('/api/archive')
      const json = (await res.json()) as Overview & { error?: string }
      if (!res.ok) throw new Error(json.error ?? '读取失败')
      setData(json)
      setRootInput((current) => current || json.root)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取存档信息失败。')
    }
  }

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    panelRef.current?.focus()
    // Fetching from disk when the panel opens is exactly the "sync with an
    // external system" case; state is only written after the await resolves.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
    return () => document.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const request = async (url: string, init?: RequestInit) => {
    const res = await fetch(url, init)
    const json = (await res.json().catch(() => null)) as
      | (Record<string, unknown> & { error?: string })
      | null
    if (!res.ok) throw new Error(json?.error ?? '操作失败，请稍后再试。')
    return json
  }

  const patchConversation = async (
    row: ArchiveRow,
    body: Record<string, unknown>,
    key: string,
  ) => {
    setBusy(key)
    setError(null)
    setNotice(null)
    try {
      const json = await request(`/api/archive/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const rebuilt = Number(json?.rebuilt ?? 0)
      if (body.archiveEnabled === true && rebuilt > 0) {
        setNotice(`已开启存档，并从聊天日志回填了 ${rebuilt} 条消息。`)
      } else if (body.exportNow) {
        setNotice(`已重新导出「${row.title}」的存档。`)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败。')
    } finally {
      setBusy(null)
    }
  }

  const readNow = async (row: ArchiveRow) => {
    setBusy(row.id)
    setError(null)
    setNotice(null)
    try {
      await request(`/api/archive/${row.id}`, { method: 'POST' })
      setNotice(`「${row.title}」将在下一次回复时读取存档。`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败。')
    } finally {
      setBusy(null)
    }
  }

  const openDirectory = async (conversationId?: string) => {
    setError(null)
    try {
      await request('/api/archive/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(conversationId ? { conversationId } : {}),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '无法打开目录。')
    }
  }

  const deleteFiles = async (row: ArchiveRow) => {
    if (confirmDeleteId !== row.id) {
      setConfirmDeleteId(row.id)
      return
    }
    setBusy(row.id)
    setError(null)
    setNotice(null)
    try {
      await request(`/api/archive/${row.id}`, { method: 'DELETE' })
      setConfirmDeleteId(null)
      setNotice(`已删除「${row.title}」的存档文件，对话本身不受影响。`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败。')
    } finally {
      setBusy(null)
    }
  }

  const saveSettings = async (body: Record<string, unknown>, message: string) => {
    setBusy('settings')
    setError(null)
    setNotice(null)
    try {
      const json = await request('/api/archive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const moved = Number(json?.moved ?? 0)
      setNotice(moved > 0 ? `${message}，已迁移 ${moved} 个会话目录。` : message)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败。')
    } finally {
      setBusy(null)
    }
  }

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
        aria-labelledby="archive-panel-title"
        tabIndex={-1}
        className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-border bg-card p-5 shadow-2xl outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="archive-panel-title" className="text-lg font-semibold">
              存档管理
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              每个会话一个本地文件夹：transcript.md、context.jsonl、meta.json。
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

        {data ? (
          <div className="mt-4 space-y-3">
            <section className="rounded-xl border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium">新对话默认开启存档</p>
                  <p className="text-xs text-muted-foreground">
                    作为总开关，决定之后新建会话是否自动开启存档与自动读取。
                  </p>
                </div>
                <Toggle
                  label="默认"
                  active={data.defaultOn}
                  disabled={busy !== null}
                  onClick={() =>
                    void saveSettings(
                      { defaultOn: !data.defaultOn },
                      data.defaultOn ? '已关闭新对话默认存档。' : '已开启新对话默认存档。',
                    )
                  }
                />
              </div>

              <div className="mt-3 space-y-2">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="archive-root">
                  存档目录
                </label>
                <div className="flex gap-2">
                  <Input
                    id="archive-root"
                    value={rootInput}
                    onChange={(event) => setRootInput(event.target.value)}
                    placeholder="例如 D:\\sakura-archives"
                    className="h-9 text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy !== null || !rootInput.trim() || rootInput.trim() === data.root}
                    onClick={() => void saveSettings({ root: rootInput, moveExisting }, '存档目录已更新')}
                  >
                    更改目录
                  </Button>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={moveExisting}
                      onChange={(event) => setMoveExisting(event.target.checked)}
                      className="accent-[var(--primary)]"
                    />
                    同时把已有存档迁移过去
                  </label>
                  <ActionChip onClick={() => void openDirectory()}>打开目录</ActionChip>
                </div>
                <p className="break-all text-[11px] text-muted-foreground">当前：{data.root}</p>
              </div>
            </section>

            {notice ? (
              <p role="status" className="rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
                {notice}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <section className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                全部会话
              </p>
              {data.conversations.length === 0 ? (
                <p className="text-xs text-muted-foreground">还没有会话。</p>
              ) : (
                data.conversations.map((row) => {
                  const persona = getPersona(row.personaId)
                  const pending = busy === row.id
                  return (
                    <div key={row.id} className="rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            <span aria-hidden="true">{persona.emoji}</span> {row.title}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {row.messageCount} 条消息 · 已归档 {row.archivedTurns} 轮 ·{' '}
                            {row.hasFiles ? '文件已生成' : '尚未生成文件'}
                            {row.needsArchiveRead ? ' · 待读取' : ''}
                          </p>
                        </div>
                        <div className="flex gap-1.5">
                          <Toggle
                            label="存档"
                            active={row.archiveEnabled}
                            disabled={pending}
                            onClick={() =>
                              void patchConversation(
                                row,
                                { archiveEnabled: !row.archiveEnabled },
                                row.id,
                              )
                            }
                          />
                          <Toggle
                            label="自动读取"
                            active={row.autoRead}
                            disabled={pending}
                            onClick={() =>
                              void patchConversation(row, { autoRead: !row.autoRead }, row.id)
                            }
                          />
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <ActionChip
                          onClick={() => void patchConversation(row, { exportNow: true }, row.id)}
                          disabled={pending || !row.hasFiles}
                        >
                          立即导出
                        </ActionChip>
                        <ActionChip onClick={() => void readNow(row)} disabled={pending || !row.hasFiles}>
                          立即读取
                        </ActionChip>
                        <ActionChip onClick={() => void openDirectory(row.id)} disabled={pending}>
                          打开目录
                        </ActionChip>
                        <ActionChip onClick={() => void deleteFiles(row)} disabled={pending} danger>
                          {confirmDeleteId === row.id ? '确认删除？' : '删除文件'}
                        </ActionChip>
                      </div>
                    </div>
                  )
                })
              )}
            </section>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground">{error ?? '加载中…'}</p>
        )}
      </div>
    </div>
  )
}
