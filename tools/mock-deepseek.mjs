// Local OpenAI-compatible streaming stub for offline end-to-end testing only.
// Not used at runtime; the real app talks to api.deepseek.com.
// It echoes the received system prompt so tests can prove the persona is sent.
import http from 'node:http'

const CHUNK_DELAY_MS = 15
const BODY = '这是一段**流式**返回的测试文本。\n\n- 第一点\n- 第二点'

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
    res.writeHead(404).end()
    return
  }
  let raw = ''
  req.on('data', (c) => (raw += c))
  req.on('end', async () => {
    const auth = req.headers.authorization ?? ''
    if (!auth.startsWith('Bearer ')) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'missing key' } }))
      return
    }

    let payload = {}
    try {
      payload = JSON.parse(raw)
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad json' } }))
      return
    }

    const system = (payload.messages ?? []).find((m) => m.role === 'system')
    const systemText = typeof system?.content === 'string' ? system.content : ''
    const REPLY = `系统提示校验：${systemText.slice(0, 420)}\n\n${BODY}`

    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const id = 'mock-' + Date.now()
    const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`)
    send({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: payload.model ?? 'deepseek-flash',
      choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }],
    })
    for (const ch of [...REPLY]) {
      await new Promise((r) => setTimeout(r, CHUNK_DELAY_MS))
      send({
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: payload.model ?? 'deepseek-flash',
        choices: [{ index: 0, delta: { content: ch }, finish_reason: null }],
      })
    }
    send({
      id,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: payload.model ?? 'deepseek-flash',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 30, total_tokens: 40 },
    })
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

server.listen(8788, '127.0.0.1', () => console.log('mock deepseek on http://127.0.0.1:8788'))
