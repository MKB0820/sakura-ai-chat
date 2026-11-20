// Live smoke test: one real streaming round-trip through the app against the
// configured DeepSeek API. Works against `npm run dev`, `wrangler dev`, or a
// deployed Worker:
//   node tools/smoke-live.mjs [baseUrl]
const BASE = process.argv[2] ?? 'http://127.0.0.1:3000'

async function waitForServer() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) return
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
    const i = pair.indexOf('=')
    const name = pair.slice(0, i)
    const value = pair.slice(i + 1)
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
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookieHeader(jar) },
    body: new URLSearchParams({ csrfToken, email, password }),
    redirect: 'manual',
  })
  absorb(jar, res)
  return jar
}

await waitForServer()

const email = `live-smoke-${Date.now()}@test.local`
const password = 'password123'
await fetch(`${BASE}/api/auth/register`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
})
const jar = await login(email, password)
console.log('logged in:', Object.keys(jar).length > 0)

const conversation = await (
  await fetch(`${BASE}/api/conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
    body: JSON.stringify({ personaId: 'gentle-senior' }),
  })
).json()

const started = Date.now()
const res = await fetch(`${BASE}/api/chat`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
  body: JSON.stringify({
    conversationId: conversation.id,
    messages: [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: '用一句话介绍一下你自己。' }],
      },
    ],
  }),
})
console.log('chat status:', res.status, 'content-type:', res.headers.get('content-type'))

const raw = await res.text()
let text = ''
let finish = null
let firstDeltaMs = null
for (const line of raw.split('\n')) {
  if (!line.startsWith('data: ')) continue
  const payload = line.slice(6).trim()
  if (!payload || payload === '[DONE]') continue
  try {
    const event = JSON.parse(payload)
    if (event.type === 'text-delta' && typeof event.delta === 'string') {
      if (firstDeltaMs === null) firstDeltaMs = Date.now() - started
      text += event.delta
    }
    if (event.type === 'finish') finish = event
  } catch {
    /* keep-alive */
  }
}

console.log('first delta after ms:', firstDeltaMs)
console.log('reply chars:', text.length)
console.log('reply preview:', JSON.stringify(text.slice(0, 80)))
console.log('finish metadata:', JSON.stringify(finish?.messageMetadata ?? null))

const usage = finish?.messageMetadata?.usage
const ok = res.status === 200 && text.trim().length > 0 && usage?.inputTokens > 0 && usage?.outputTokens > 0
console.log(ok ? 'LIVE SMOKE PASSED' : 'LIVE SMOKE FAILED')
process.exit(ok ? 0 : 1)
