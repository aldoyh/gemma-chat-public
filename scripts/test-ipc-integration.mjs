// End-to-end IPC integration: simulate exactly what handleChat does — build
// a baseMessages array with a system role, run it through formatMessagesForMLX,
// POST to the live MLX server, and assert we get HTTP 200 with a streamed
// reply (not the 404 we used to see).
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { request } from 'node:http'
import { build } from 'esbuild'
import { join } from 'node:path'

const HOME = process.env.HOME
const REAL_USER_DATA = `${HOME}/Library/Application Support/gemma-chat`
const TMP_USER_DATA = '/tmp/gemma-chat-ipc'
const PORT = 11436 // different from 11435 to avoid collisions

// 1) Seed the tmp user-data dir with a symlink to the real model cache so
//    the MLX server doesn't have to re-download the model files.
rmSync(TMP_USER_DATA, { recursive: true, force: true })
mkdirSync(`${TMP_USER_DATA}/mlx`, { recursive: true })
if (existsSync(`${REAL_USER_DATA}/mlx/models`)) {
  symlinkSync(`${REAL_USER_DATA}/mlx/models`, `${TMP_USER_DATA}/mlx/models`)
}

// 2) Bundle the message-format module so we can call it from this script.
const tmpBundle = '/tmp/ipc-message-format.mjs'
await build({
  entryPoints: ['src/main/inference/message-format.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: tmpBundle,
  logLevel: 'silent'
})
const { formatMessagesForMLX } = await import(tmpBundle)

// 3) Build the same baseMessages the renderer's handleChat does.
const baseMessages = [
  { role: 'system', content: 'You are Gemma, an AI assistant running 100% locally on the user\'s Mac.' },
  { role: 'user', content: 'Reply with exactly the word OK and nothing else.' }
]

// 4) Run through the formatter (this is what mlx.chatStream calls).
const formatted = formatMessagesForMLX(baseMessages)
console.log('[ipc] formatted messages sent to MLX:')
for (const m of formatted) {
  console.log(`        role=${m.role}  content=${JSON.stringify(m.content).slice(0, 80)}…`)
}

// 5) Spawn the mlx_lm server pointed at our tmp user-data dir + port.
const venvPy = `${REAL_USER_DATA}/mlx/venv/bin/python3`
if (!existsSync(venvPy)) {
  console.error('[ipc] MLX venv missing at', venvPy)
  process.exit(1)
}

const proc = spawn(venvPy, [
  '-m', 'mlx_lm', 'server',
  '--model', 'mlx-community/gemma-2-2b-it-4bit',
  '--port', String(PORT),
  '--prompt-cache-size', '0',
  '--decode-concurrency', '1',
  '--prompt-concurrency', '1'
], {
  env: {
    ...process.env,
    HF_HOME: `${TMP_USER_DATA}/mlx/models`,
    TRANSFORMERS_CACHE: `${TMP_USER_DATA}/mlx/models`
  },
  stdio: ['ignore', 'pipe', 'pipe']
})
proc.stdout.on('data', (d) => process.stdout.write(`[mlx] ${d}`))
proc.stderr.on('data', (d) => process.stdout.write(`[mlx] ${d}`))

// 6) Wait for /v1/models to come up.
async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/v1/models`)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error('MLX server did not become healthy')
}

await waitForHealth(120_000)
console.log('[ipc] MLX server is healthy')

// 7) POST exactly what chatStream posts.
const start = Date.now()
let status = 0
let reply = ''
let chunks = 0

const res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    model: 'mlx-community/gemma-2-2b-it-4bit',
    messages: formatted,
    stream: true,
    temperature: 0.75,
    max_tokens: 2048,
    repetition_penalty: 1.15,
    repeat_last_n: 64
  })
})
status = res.status
console.log(`[ipc] POST /v1/chat/completions → HTTP ${status}`)

if (status === 404) {
  const text = await res.text().catch(() => '')
  console.error('[ipc] BUG: still getting 404 from MLX server!')
  console.error('[ipc] body:', text)
  proc.kill('SIGTERM')
  process.exit(1)
}

const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ''
while (true) {
  const { value, done } = await reader.read()
  if (done) break
  buf += dec.decode(value, { stream: true })
  let idx
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 2)
    if (!block || !block.startsWith('data: ')) continue
    const payload = block.slice(6)
    if (payload === '[DONE]') continue
    try {
      const j = JSON.parse(payload)
      const c = j.choices?.[0]?.delta?.content
      if (c) { reply += c; chunks++ }
    } catch {}
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(2)
console.log(`[ipc] reply: ${JSON.stringify(reply)}`)
console.log(`[ipc] ${chunks} chunks, ${elapsed}s`)

proc.kill('SIGTERM')
process.exit(reply.length > 0 ? 0 : 1)
