// Checks the token-usage pipeline: provider usage rides the UI message stream,
// is persisted with the assistant message, and is re-served on page load.
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaClient } from '@prisma/client'

const BASE = 'http://127.0.0.1:3000'
let failures = 0

function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`)
  if (!ok) failures++
}

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/login`)
      if (res.ok) return
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('server did not start')
}

const cookieHeader = (jar) =>
  Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ')

function absorb(jar, res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';')
    const idx = pair.indexOf('=')
    const name = pair.slice(0, idx)
    const value = pair.slice(idx + 1)
    if (!value) delete jar[name]
    else jar[name] = value
  }
}

async function login(email, password) {
  const jar = {}
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  absorb(jar, csrfRes)
  const { csrfToken } = await csrfRes.json()
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: cookieHeader(jar),
    },
    body: new URLSearchParams({ csrfToken, email, password }),
    redirect: 'manual',
  })
  absorb(jar, res)
  return jar
}

const json = (jar, url, method, body) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

await waitForServer()

const email = 'usage-test@test.local'
const password = 'password123'
await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
const jar = await login(email, password)
check('login', Object.keys(jar).length > 0)

const created = await (await json(jar, '/api/conversations', 'POST', {})).json()
const conversationId = created.id
check('conversation created', Boolean(conversationId))

// --- usage metadata rides the stream --------------------------------------
const res = await fetch(`${BASE}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
  body: JSON.stringify({
    conversationId,
    messages: [{ id: 'u1', role: 'user', parts: [{ type: 'text', text: '用量测试' }] }],
  }),
})
const sse = await res.text()
check('stream ok', res.status === 200)
check('context window metadata sent', sse.includes('"contextWindow":64000'))
check('input tokens in finish metadata', sse.includes('"inputTokens":10'), sse.match(/"usage":\{[^}]*\}/)?.[0] ?? 'no usage')
check('output tokens in finish metadata', sse.includes('"outputTokens":30'))

// --- persisted with the assistant message ---------------------------------
const saveUser = await json(jar, `/api/conversations/${conversationId}/messages`, 'POST', {
  role: 'user',
  content: '用量测试：你好',
})
const saveAssistant = await json(jar, `/api/conversations/${conversationId}/messages`, 'POST', {
  role: 'assistant',
  content: '用量测试：回复',
  usage: { inputTokens: 123, outputTokens: 45 },
})
check('save user message', saveUser.status === 201)
check('save assistant message', saveAssistant.status === 201)

const prisma = new PrismaClient({
  adapter: new PrismaBetterSqlite3({ url: 'file:./prisma/dev.db' }),
})
const rows = await prisma.message.findMany({
  where: { conversationId },
  orderBy: { createdAt: 'asc' },
  select: { role: true, inputTokens: true, outputTokens: true },
})
const userRow = rows.find((r) => r.role === 'user')
const assistantRow = rows.find((r) => r.role === 'assistant')
check('user row stores no usage', userRow?.inputTokens === null && userRow?.outputTokens === null)
check('assistant row stores usage', assistantRow?.inputTokens === 123 && assistantRow?.outputTokens === 45, JSON.stringify(assistantRow))

// --- re-served on page load ------------------------------------------------
const page = await fetch(`${BASE}/chat/${conversationId}`, {
  headers: { Cookie: cookieHeader(jar) },
})
const html = await page.text()
check('page ok', page.status === 200)
check('page serializes usage metadata', html.includes('\\"usage\\":{\\"inputTokens\\":123'), 'rsc payload')
check('page renders usage meter label', html.includes('上下文'))

// --- invalid usage is rejected --------------------------------------------
const bad = await json(jar, `/api/conversations/${conversationId}/messages`, 'POST', {
  role: 'assistant',
  content: 'bad',
  usage: { inputTokens: -5, outputTokens: 1 },
})
check('negative usage rejected', bad.status === 400)

await prisma.$disconnect()
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
