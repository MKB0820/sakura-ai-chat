// Acceptance checks against the Cloudflare Workers runtime (wrangler dev).
// Usage: node tools/verify-cloudflare.mjs [baseUrl]   (default http://127.0.0.1:8790)
const BASE = process.argv[2] ?? 'http://127.0.0.1:8790'
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
  throw new Error('worker did not start')
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

async function register(email, password) {
  const started = Date.now()
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return { status: res.status, ms: Date.now() - started, body: await res.text() }
}

async function login(email, password) {
  const jar = {}
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`)
  absorb(jar, csrfRes)
  const { csrfToken } = await csrfRes.json()
  const started = Date.now()
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
  const hasSession = Object.keys(jar).some((k) => k.startsWith('authjs.session-token'))
  return { jar, hasSession, status: res.status, ms: Date.now() - started }
}

const json = (jar, url, method, body) =>
  fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

async function streamChat(jar, conversationId, text, timeoutMs = 90000) {
  const started = Date.now()
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
    body: JSON.stringify({
      conversationId,
      messages: [{ id: `u-${Date.now()}`, role: 'user', parts: [{ type: 'text', text }] }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const headers = {
    contentType: res.headers.get('content-type'),
    cacheControl: res.headers.get('cache-control'),
    accelBuffering: res.headers.get('x-accel-buffering'),
  }

  const decoder = new TextDecoder()
  const reader = res.body.getReader()
  let buffer = ''
  let reply = ''
  let firstDeltaMs = null
  let deltas = 0
  let metadata = null

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let index
    while ((index = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, index)
      buffer = buffer.slice(index + 2)
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (!payload || payload === '[DONE]') continue
        try {
          const event = JSON.parse(payload)
          if (event.type === 'text-delta' && typeof event.delta === 'string') {
            if (firstDeltaMs === null) firstDeltaMs = Date.now() - started
            deltas++
            reply += event.delta
          }
          if (event.type === 'finish') metadata = event.messageMetadata
        } catch {
          /* keep-alive */
        }
      }
    }
  }

  return { status: res.status, headers, reply, firstDeltaMs, deltas, metadata, ms: Date.now() - started }
}

await waitForServer()

const runId = Date.now()
const emailA = `cf-a-${runId}@test.local`
const emailB = `cf-b-${runId}@test.local`
const a = await register(emailA, 'password123')
const b = await register(emailB, 'password123')
check('register on Workers (pure JS Argon2)', a.status === 201, `${a.status} in ${a.ms}ms ${a.body}`)
check('register second user', b.status === 201, `${b.status}`)

const loginA = await login(emailA, 'password123')
check('login A (JWT session)', loginA.hasSession, `${loginA.status} in ${loginA.ms}ms`)
const loginB = await login(emailB, 'password123')
check('login B', loginB.hasSession)

const wrong = await login(emailA, 'wrong-password')
check('wrong password rejected without session', !wrong.hasSession)

const me = await fetch(`${BASE}/api/conversations`, { headers: { Cookie: cookieHeader(loginA.jar) } })
check('authenticated API reaches D1', me.status === 200)

const created = await (await json(loginA.jar, '/api/conversations', 'POST', { personaId: 'gentle-senior' })).json()
const conversationId = created.id
check('conversation created in D1', Boolean(conversationId), JSON.stringify(created))

const stream = await streamChat(loginA.jar, conversationId, '用一句话介绍你自己。')
check('chat stream status 200', stream.status === 200, `status ${stream.status}`)
check('SSE content-type', (stream.headers.contentType ?? '').includes('text/event-stream'), stream.headers.contentType)
check('SSE no-buffering header', stream.headers.accelBuffering === 'no', String(stream.headers.accelBuffering))
check('reply is non-empty', stream.reply.trim().length > 0, `${stream.reply.length} chars`)
check('reply streams incrementally', stream.deltas > 3 && stream.firstDeltaMs !== null, `${stream.deltas} deltas, first at ${stream.firstDeltaMs}ms, total ${stream.ms}ms`)
check('first delta arrives before completion', stream.firstDeltaMs !== null && stream.firstDeltaMs < Math.max(stream.ms - 300, 600), `first ${stream.firstDeltaMs}ms / total ${stream.ms}ms`)
check('usage metadata from provider', (stream.metadata?.usage?.inputTokens ?? 0) > 0, JSON.stringify(stream.metadata?.usage))

// Persist the exchange the way the client does, then reload the page.
await json(loginA.jar, `/api/conversations/${conversationId}/messages`, 'POST', {
  role: 'user',
  content: '用一句话介绍你自己。',
})
await json(loginA.jar, `/api/conversations/${conversationId}/messages`, 'POST', {
  role: 'assistant',
  content: stream.reply,
  usage: stream.metadata?.usage,
})

const page = await fetch(`${BASE}/chat/${conversationId}`, { headers: { Cookie: cookieHeader(loginA.jar) } })
const html = await page.text()
check('conversation page renders', page.status === 200)
check('history persisted in D1 after reload', html.includes('用一句话介绍你自己'))
check('usage persisted and rendered', html.includes('上次实测'))

const list = await (await json(loginA.jar, '/api/conversations', 'GET')).json()
check('conversation listed from D1', list.conversations?.some((c) => c.id === conversationId))

const badUsage = await json(loginA.jar, `/api/conversations/${conversationId}/messages`, 'POST', {
  role: 'assistant',
  content: 'bad usage',
  usage: { inputTokens: -5, outputTokens: 1 },
})
check('negative usage rejected', badUsage.status === 400, `status ${badUsage.status}`)

// Isolation between accounts.
const bPage = await fetch(`${BASE}/chat/${conversationId}`, {
  headers: { Cookie: cookieHeader(loginB.jar) },
  redirect: 'manual',
})
check('B cannot open A conversation page', bPage.status === 307, `status ${bPage.status}`)
const bWrite = await json(loginB.jar, `/api/conversations/${conversationId}/messages`, 'POST', {
  role: 'user',
  content: '越权写入',
})
check('B cannot write to A conversation', bWrite.status === 404)
const bChat = await streamChat(loginB.jar, conversationId, '越权对话')
check('B cannot chat in A conversation', bChat.status === 404)

// Filesystem-only archive must fail loudly, not silently.
const archive = await json(loginA.jar, '/api/archive', 'GET')
const archiveBody = await archive.json().catch(() => ({}))
check('archive disabled with explicit 501', archive.status === 501 && archiveBody.unsupported === true, `${archive.status}`)

// Middleware protection.
const anonChat = await fetch(`${BASE}/chat`, { redirect: 'manual' })
check('anonymous /chat redirected by middleware', anonChat.status === 307 && (anonChat.headers.get('location') ?? '').includes('/login'), `${anonChat.status} ${anonChat.headers.get('location')}`)

console.log(failures === 0 ? '\nALL CLOUDFLARE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
