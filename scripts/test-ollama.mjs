#!/usr/bin/env node
/**
 * test:ollama — end-to-end smoke test of the Ollama backend path.
 *
 * Calls Ollama at OLLAMA_BASE_URL with the model named on the command line
 * (defaults to gemma4:12b-mlx), streams a single prompt, and verifies:
 *   - HTTP 200
 *   - At least one token arrives
 *   - Stream completes with finish_reason "stop" or "length"
 *
 * This exercises the same OpenAI-compatible /v1/chat/completions endpoint
 * that src/main/inference/ollama-backend.ts uses.
 *
 * Usage:
 *   npm run test:ollama                  # uses gemma4:12b-mlx
 *   npm run test:ollama -- gemma4:e4b    # override the model
 *   OLLAMA_BASE=http://host:11434 npm run test:ollama
 */
const BASE = process.env.OLLAMA_BASE || 'http://localhost:11434'
const model = process.argv[2] || 'gemma4:12b-mlx'
const prompt = process.argv[3] || 'Reply with the single word OK.'

const t0 = Date.now()
console.log(`[test:ollama] base=${BASE} model=${model}`)

let res
let lastConnectError = null
for (let attempt = 1; attempt <= 8; attempt++) {
  try {
    res = await fetch(`${BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        stream: true,
        temperature: 0.3,
        max_tokens: 64
      })
    })
    break
  } catch (e) {
    lastConnectError = e
    if (attempt < 8) await new Promise((resolve) => setTimeout(resolve, 750))
  }
}

if (!res) {
  console.error(`✗ could not reach ${BASE}: ${lastConnectError?.message ?? 'unknown error'}`)
  console.error('  is the Ollama server running?')
  process.exit(1)
}

if (!res.ok) {
  const text = await res.text().catch(() => '')
  console.error(`✗ HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`)
  process.exit(1)
}
if (!res.body) {
  console.error('✗ no response body')
  process.exit(1)
}

const reader = res.body.getReader()
const decoder = new TextDecoder()
let buf = ''
let chunks = 0
let text = ''
let firstAt = 0
let finish = null

process.stdout.write('  reply: ')

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  buf += decoder.decode(value, { stream: true })
  let idx
  while ((idx = buf.indexOf('\n\n')) >= 0) {
    const block = buf.slice(0, idx).trim()
    buf = buf.slice(idx + 2)
    for (const line of block.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      let parsed
      try {
        parsed = JSON.parse(data)
      } catch {
        continue
      }
      const delta = parsed.choices?.[0]?.delta?.content
      if (delta) {
        if (!firstAt) firstAt = Date.now() - t0
        process.stdout.write(delta)
        text += delta
        chunks++
      }
      const fr = parsed.choices?.[0]?.finish_reason
      if (fr) finish = fr
    }
  }
}

const total = Date.now() - t0
console.log('\n')
const ok = (msg) => console.log(`  ✓ ${msg}`)
const fail = (msg) => { console.error(`  ✗ ${msg}`); process.exitCode = 1 }

if (chunks > 0) ok(`streamed ${chunks} chunks (${text.length} chars)`)
else fail('no tokens received')

if (firstAt > 0) ok(`first token in ${firstAt}ms`)
else fail('first token timestamp missing')

if (firstAt > 0 && firstAt < 240_000) ok(`first token under 4 min (cold-load tolerant)`)
else fail(`first token too slow: ${firstAt}ms`)

if (text.length > 0) ok(`reply length > 0`)
else fail('empty reply')

if (finish === 'stop' || finish === 'length') ok(`finish_reason=${finish}`)
else fail(`unexpected finish_reason: ${finish}`)

if (process.exitCode) {
  console.error(`\n✗ test:ollama FAILED  (total ${total}ms)`)
  process.exit(process.exitCode)
}
console.log(`\n✓ test:ollama PASSED  (total ${total}ms)`)
