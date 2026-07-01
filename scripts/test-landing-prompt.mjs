#!/usr/bin/env node
/**
 * test-landing-prompt — runs the default Gemma model on a real landing page prompt.
 * Verifies that the model generates a valid action tag for creating the files,
 * ensuring it goes through the actual local model execution.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, symlinkSync, rmSync } from 'node:fs'
import { build } from 'esbuild'
import { join } from 'node:path'

const HOME = process.env.HOME
const REAL_USER_DATA = `${HOME}/Library/Application Support/gemma-chat`
const TMP_USER_DATA = '/tmp/gemma-chat-landing-test'
const PORT = 11438

console.log('── Running Landing Prompt Test with Default Model ──')

const venvDir = `${REAL_USER_DATA}/mlx/venv`
const venvPy = `${venvDir}/bin/python3`

// Check if venv is missing or broken
let venvOK = false
if (existsSync(venvPy)) {
  try {
    const verCheck = spawnSync(venvPy, ['--version'], { timeout: 5000 })
    if (verCheck.status === 0) {
      venvOK = true
    }
  } catch {}
}

if (!venvOK) {
  console.log('[test-landing] Venv is missing or broken. Attempting to recreate/repair using compatible Python…')
  
  // Clean broken venv
  rmSync(venvDir, { recursive: true, force: true })

  // Find a compatible system python (3.10 - 3.13)
  const candidates = [
    '/opt/homebrew/bin/python3.13',
    '/opt/homebrew/bin/python3.12',
    '/opt/homebrew/bin/python3.11',
    '/opt/homebrew/bin/python3.10',
    '/opt/homebrew/opt/python@3.13/bin/python3.13',
    '/opt/homebrew/opt/python@3.12/bin/python3.12',
    '/opt/homebrew/opt/python@3.11/bin/python3.11',
    '/opt/homebrew/opt/python@3.10/bin/python3.10',
    'python3',
    'python'
  ]

  let sysPython = null
  for (const c of candidates) {
    try {
      const s = spawnSync(c, ['--version'], { timeout: 5000 })
      if (s.status === 0) {
        const ver = s.stdout.toString().trim() || s.stderr.toString().trim()
        const match = ver.match(/Python 3\.(\d+)/)
        const minor = match ? parseInt(match[1], 10) : 99
        if (minor >= 10 && minor <= 13) {
          sysPython = c
          console.log(`[test-landing] Found compatible Python: ${sysPython} (${ver})`)
          break
        }
      }
    } catch {}
  }

  if (!sysPython) {
    console.error('✗ FAIL: No compatible Python (3.10 - 3.13) found to build the virtual environment.')
    process.exit(1)
  }

  console.log(`[test-landing] Creating venv at ${venvDir} using ${sysPython}…`)
  const createRes = spawnSync(sysPython, ['-m', 'venv', venvDir], { stdio: 'inherit' })
  if (createRes.status !== 0) {
    console.error('✗ FAIL: venv creation failed')
    process.exit(1)
  }

  console.log('[test-landing] Upgrading pip…')
  const pipUpgrade = spawnSync(venvPy, [
    '-m', 'pip', 'install', '--upgrade', 'pip',
    '--index-url', 'https://pypi.org/simple/'
  ], { stdio: 'inherit' })
  if (pipUpgrade.status !== 0) {
    console.error('✗ FAIL: pip upgrade failed')
    process.exit(1)
  }

  console.log('[test-landing] Installing mlx-lm…')
  const mlxInstall = spawnSync(venvPy, [
    '-m', 'pip', 'install', '--upgrade', 'mlx-lm>=0.24.0',
    '--index-url', 'https://pypi.org/simple/'
  ], { stdio: 'inherit' })
  if (mlxInstall.status !== 0) {
    console.error('✗ FAIL: mlx-lm install failed')
    process.exit(1)
  }

  console.log('[test-landing] Venv successfully created and prepared.')
} else {
  console.log('[test-landing] Existing venv is functional.')
}

// 1) Seed the tmp user-data dir with a symlink to the real model cache
rmSync(TMP_USER_DATA, { recursive: true, force: true })
mkdirSync(`${TMP_USER_DATA}/mlx`, { recursive: true })
if (existsSync(`${REAL_USER_DATA}/mlx/models`)) {
  symlinkSync(`${REAL_USER_DATA}/mlx/models`, `${TMP_USER_DATA}/mlx/models`)
  console.log('[test-landing] symlinked model cache')
}

// 2) Bundle the message-format and tools modules
const tmpBundleFmt = '/tmp/landing-message-format.mjs'
await build({
  entryPoints: ['src/main/inference/message-format.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: tmpBundleFmt,
  logLevel: 'silent'
})
const { formatMessagesForMLX } = await import(tmpBundleFmt)

const tmpBundleTools = '/tmp/landing-tools.mjs'
await build({
  entryPoints: ['src/main/test-support/pure.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: tmpBundleTools,
  logLevel: 'silent',
  alias: { electron: new URL('./fixtures/electron-stub.mjs', import.meta.url).pathname }
})
const { codeSystemPrompt, findNextAction } = await import(tmpBundleTools)

// 3) Create base messages with system prompt + landing prompt
// Ensure prompt bypasses the example recipes: we specify a "dog walking service" landing page.
// The recipe interceptor only triggers if:
// normalized.includes('coffee') && normalized.includes('landing')
const systemPrompt = codeSystemPrompt('/tmp/ws-landing-test', 'http://localhost:8000')
const landingPrompt = 'Build a beautiful, simple single-file landing page for a dog walking startup called Barkly. Use a clean dark mode design. Start immediately with the action tag.'

const baseMessages = [
  { role: 'system', content: systemPrompt },
  { role: 'user', content: landingPrompt }
]
const formatted = formatMessagesForMLX(baseMessages)

console.log('[test-landing] Prompt:', landingPrompt)
console.log('[test-landing] Model: mlx-community/gemma-2-2b-it-4bit')

// 4) Spawn the mlx_lm server pointed at our tmp user-data dir + port
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

// Log server output to terminal
proc.stdout.on('data', (d) => process.stdout.write(`[mlx] ${d}`))
proc.stderr.on('data', (d) => process.stdout.write(`[mlx] ${d}`))

function cleanup() {
  console.log('[test-landing] cleaning up MLX server process…')
  try {
    proc.kill('SIGKILL')
  } catch {}
}
process.on('exit', cleanup)
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)

// 5) Wait for /v1/models to come up
async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/v1/models`)
      if (res.ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('MLX server did not become healthy')
}

console.log('[test-landing] waiting for MLX server to start…')
try {
  await waitForHealth(120_000)
} catch (e) {
  console.error('[test-landing] server startup failed:', e.message)
  cleanup()
  process.exit(1)
}
console.log('[test-landing] MLX server is online!')

// 6) POST to /v1/chat/completions to stream the response
const start = Date.now()
let res
try {
  res = await fetch(`http://127.0.0.1:${PORT}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'mlx-community/gemma-2-2b-it-4bit',
      messages: formatted,
      stream: true,
      temperature: 0.3,
      max_tokens: 1536
    })
  })
} catch (e) {
  console.error('[test-landing] fetch failed:', e.message)
  cleanup()
  process.exit(1)
}

if (!res.ok) {
  const text = await res.text().catch(() => '')
  console.error(`[test-landing] HTTP ${res.status}: ${text}`)
  cleanup()
  process.exit(1)
}

const reader = res.body.getReader()
const dec = new TextDecoder()
let buf = ''
let reply = ''
let chunks = 0

console.log('[test-landing] streaming reply:\n')

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
      if (c) {
        reply += c
        chunks++
        process.stdout.write(c)
      }
    } catch {}
  }
}

const elapsed = ((Date.now() - start) / 1000).toFixed(2)
console.log(`\n\n[test-landing] streamed ${chunks} chunks in ${elapsed}s`)

// 7) Validate response
const action = findNextAction(reply)
if (!action) {
  console.error('✗ FAIL: No action tag was found in the model response!')
  cleanup()
  process.exit(1)
}
if (action === 'incomplete') {
  console.error('✗ FAIL: The action tag was incomplete or malformed!')
  cleanup()
  process.exit(1)
}

console.log('\n── Validation ──────────────────────────────────')
console.log('✓ PASS: Action tag found and parsed successfully!')
console.log(`  Action Name: ${action.name}`)
console.log(`  Target Path: ${action.args.path}`)
if (action.args.content) {
  console.log(`  Content Length: ${String(action.args.content).length} characters`)
}

cleanup()
process.exit(0)
