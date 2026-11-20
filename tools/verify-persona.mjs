// End-to-end check for personas + conversation management against a running
// server (port 3000) backed by tools/mock-deepseek.mjs on port 8788.
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
    if (!value) delete jar[name]
    else jar[name] = value
  }
}

async function register(email, password) {
  const res = await fetch(`${BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  return res.status
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
  return { jar, hasSession: Object.keys(jar).some((k) => k.startsWith('authjs.session-token')) }
}

function jsonRequest(jar, url, method, body) {
  return fetch(`${BASE}${url}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(jar),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function streamReply(jar, conversationId, messages) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader(jar) },
    body: JSON.stringify({ conversationId, messages }),
  })
  const raw = await res.text()
  let text = ''
  for (const line of raw.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const payload = line.slice(6).trim()
    if (!payload || payload === '[DONE]') continue
    try {
      const event = JSON.parse(payload)
      if (event.type === 'text-delta' && typeof event.delta === 'string') text += event.delta
    } catch {
      /* ignore malformed keep-alives */
    }
  }
  return { status: res.status, headers: res.headers, text, raw }
}

const ui = (id, role, text) => ({ id, role, parts: [{ type: 'text', text }] })

await waitForServer()

const emailA = 'persona-a@test.local'
const emailB = 'persona-b@test.local'
const password = 'password123'

await register(emailA, password)
await register(emailB, password)

const a = await login(emailA, password)
const b = await login(emailB, password)
check('login A', a.hasSession)
check('login B', b.hasSession)

// --- create conversation with a persona -----------------------------------
const create = await jsonRequest(a.jar, '/api/conversations', 'POST', { personaId: 'strict-engineer' })
const created = await create.json()
check('create conversation', create.status === 201 && created.personaId === 'strict-engineer', JSON.stringify(created))
const convId = created.id

const list = await jsonRequest(a.jar, '/api/conversations', 'GET')
const listed = await list.json()
check('conversation listed for owner', listed.conversations.some((c) => c.id === convId))

// --- first message names the conversation ---------------------------------
const saveUser = await jsonRequest(a.jar, `/api/conversations/${convId}/messages`, 'POST', {
  role: 'user',
  content: '请帮我审查这个方案的风险',
})
check('save user message', saveUser.status === 201)
const afterSave = await jsonRequest(a.jar, '/api/conversations', 'GET')
const titled = (await afterSave.json()).conversations.find((c) => c.id === convId)
check('auto title from first message', titled?.title === '请帮我审查这个方案的风险', titled?.title)

// --- persona reaches the model as the system prompt ------------------------
const first = await streamReply(a.jar, convId, [ui('u1', 'user', '请帮我审查这个方案的风险')])
check('stream status', first.status === 200, `status=${first.status}`)
check('SSE content-type', (first.headers.get('content-type') ?? '').includes('text/event-stream'))
check('persona in system prompt', first.text.includes('严谨的工程师'), first.text.slice(0, 60))
check('base system prompt still present', first.text.includes('不要编造事实'))

// --- long history: persona survives the 20-message context window ----------
const longHistory = Array.from({ length: 25 }, (_, i) =>
  ui(`h${i}`, i % 2 === 0 ? 'user' : 'assistant', `历史消息 ${i}`),
)
const trimmed = await streamReply(a.jar, convId, longHistory)
check('persona survives context trimming', trimmed.text.includes('严谨的工程师'))

// --- clearing context keeps the conversation and its persona --------------
const cleared = await jsonRequest(a.jar, `/api/conversations/${convId}/messages`, 'DELETE')
const clearedBody = await cleared.json()
check('clear context deletes messages', cleared.status === 200 && clearedBody.deleted === 1, JSON.stringify(clearedBody))

const listAfterClear = await jsonRequest(a.jar, '/api/conversations', 'GET')
const survivor = (await listAfterClear.json()).conversations.find((c) => c.id === convId)
check('conversation survives clear', Boolean(survivor))
check('persona survives clear', survivor?.personaId === 'strict-engineer', survivor?.personaId)

const afterClear = await streamReply(a.jar, convId, [ui('u2', 'user', '清空后还在吗')])
check('persona still applied after clear', afterClear.text.includes('严谨的工程师'))

// --- isolation between users ---------------------------------------------
const bCreate = await jsonRequest(b.jar, '/api/conversations', 'POST', {})
const bConv = await bCreate.json()
check('default persona accepted', bCreate.status === 201 && bConv.personaId === 'default')

const bList = await jsonRequest(b.jar, '/api/conversations', 'GET')
const bListed = (await bList.json()).conversations
check('B cannot see A conversations', !bListed.some((c) => c.id === convId) && bListed.length === 1)

const bMessages = await jsonRequest(b.jar, `/api/conversations/${convId}/messages`, 'POST', {
  role: 'user',
  content: '越权写入',
})
check('B cannot write to A conversation', bMessages.status === 404)

const bChat = await streamReply(b.jar, convId, [ui('x', 'user', '越权对话')])
check('B cannot chat in A conversation', bChat.status === 404)

const bDelete = await jsonRequest(b.jar, `/api/conversations/${convId}`, 'DELETE')
check('B cannot delete A conversation', bDelete.status === 404)

const bClear = await jsonRequest(b.jar, `/api/conversations/${convId}/messages`, 'DELETE')
check('B cannot clear A conversation', bClear.status === 404)

// --- page renders persona and history for the owner -----------------------
await jsonRequest(a.jar, `/api/conversations/${convId}/messages`, 'POST', {
  role: 'user',
  content: '页面渲染检查',
})
const page = await fetch(`${BASE}/chat/${convId}`, { headers: { Cookie: cookieHeader(a.jar) } })
const html = await page.text()
check('conversation page 200', page.status === 200)
check('page shows persona name', html.includes('严谨工程师'))
check('page serializes history', html.includes('页面渲染检查'))

const bPage = await fetch(`${BASE}/chat/${convId}`, {
  headers: { Cookie: cookieHeader(b.jar) },
  redirect: 'manual',
})
check('B is redirected away from A page', bPage.status === 307)

// --- delete conversation --------------------------------------------------
const removed = await jsonRequest(a.jar, `/api/conversations/${convId}`, 'DELETE')
check('owner deletes conversation', removed.status === 200)
const finalList = await jsonRequest(a.jar, '/api/conversations', 'GET')
check('deleted conversation gone', !(await finalList.json()).conversations.some((c) => c.id === convId))

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
