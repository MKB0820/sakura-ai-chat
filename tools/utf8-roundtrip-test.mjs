// Self-contained: performs CSRF + credentials login in-process (no cookie files),
// clears garbled curl-era rows, posts UTF-8 messages through the real API, then
// verifies GET /chat serializes them back intact.
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://127.0.0.1:3000'

function cookieHeader(jar) {
  return Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')
}

function absorb(jar, res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';')
    const idx = pair.indexOf('=')
    const name = pair.slice(0, idx)
    const value = pair.slice(idx + 1)
    if (value === '' ) delete jar[name]
    else jar[name] = value
  }
}

async function login(email, password) {
  const jar = {}
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  absorb(jar, csrfRes)
  const { csrfToken } = await csrfRes.json()
  const body = new URLSearchParams({ csrfToken, email, password })
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
    },
    body,
    redirect: 'manual',
  })
  absorb(jar, res)
  const hasSession = Object.keys(jar).some((k) => k.includes('session-token') && !k.includes('callback'))
  return { jar, status: res.status, hasSession }
}

const { jar, status, hasSession } = await login('sakura@test.local', 'password123')
console.log('login status:', status, 'session cookie:', hasSession)

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' }),
})
const user = await prisma.user.findUnique({ where: { email: 'sakura@test.local' } })
const removed = await prisma.message.deleteMany({ where: { userId: user.id } })
console.log('removed garbled rows:', removed.count)

const USER_TEXT = '持久化测试：你好，樱花 🌸'
const ASSISTANT_TEXT = '持久化测试：这是助手回复，包含 **Markdown** 与中文。'

for (const [role, content] of [
  ['user', USER_TEXT],
  ['assistant', ASSISTANT_TEXT],
]) {
  const res = await fetch(`${BASE}/api/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Cookie: cookieHeader(jar),
    },
    body: JSON.stringify({ role, content }),
  })
  console.log('save', role, res.status, await res.text())
}

const stored = await prisma.message.findMany({
  where: { userId: user.id },
  orderBy: { createdAt: 'asc' },
})
for (const m of stored) {
  console.log('stored', m.role, JSON.stringify(m.content), 'bytes=' + Buffer.byteLength(m.content, 'utf8'))
}

const page = await fetch(`${BASE}/chat`, { headers: { Cookie: cookieHeader(jar) } })
const html = await page.text()
console.log('chat status:', page.status)
console.log('serialized user text intact:', html.includes(USER_TEXT))
console.log('serialized assistant text intact:', html.includes(ASSISTANT_TEXT))

await prisma.$disconnect()
