'use client'

import { useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type Mode = 'login' | 'register'

const GENERIC_LOGIN_ERROR = '邮箱或密码不正确'

export default function AuthForm() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // Guards against a native form submit before hydration (which would reload
  // the page and wipe the inputs). Server snapshot is false, client is true.
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  )

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)

    if (mode === 'register') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
        setError('邮箱格式不正确')
        return
      }
      if (password.length < 8) {
        setError('密码至少需要 8 位')
        return
      }
    }

    setPending(true)
    try {
      if (mode === 'register') {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        })
        if (res.status === 409) {
          setError('该邮箱已被注册')
          return
        }
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null
          setError(data?.error ?? '注册失败，请稍后再试')
          return
        }
      }

      const result = await signIn('credentials', {
        email: email.trim(),
        password,
        redirect: false,
      })
      if (!result || result.error) {
        // Same message whether the email is unknown or the password is wrong.
        setError(GENERIC_LOGIN_ERROR)
        return
      }

      router.push('/chat')
      router.refresh()
    } catch {
      setError(mode === 'register' ? '注册失败，请稍后再试' : GENERIC_LOGIN_ERROR)
    } finally {
      setPending(false)
    }
  }

  return (
    <Card className="w-full max-w-md border-primary/15 bg-card/80 shadow-xl shadow-primary/10 backdrop-blur-md">
      <CardHeader className="text-center">
        <CardDescription className="text-primary">🌸 Sakura Chat</CardDescription>
        <CardTitle className="text-2xl">樱语 · 与 AI 对话</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          role="tablist"
          aria-label="登录或注册"
          className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'login'}
            onClick={() => switchMode('login')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'login'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            登录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'register'}
            onClick={() => switchMode('register')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'register'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            注册
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">邮箱</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              placeholder={mode === 'register' ? '至少 8 位' : '请输入密码'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={mode === 'register' ? 8 : undefined}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={pending || !hydrated}>
            {pending ? '处理中…' : mode === 'login' ? '登录' : '注册并登录'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
