import { app } from 'electron'
import { spawn, ChildProcess, spawnSync } from 'child_process'
import { join } from 'path'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { totalmem } from 'os'
import { AVAILABLE_MODELS } from '../shared/types'
import { formatMessagesForMLX } from './inference/message-format'

export const MLX_PORT = 11435
const MLX_HOST = `127.0.0.1:${MLX_PORT}`
export const MLX_URL = `http://${MLX_HOST}`

let serverProc: ChildProcess | null = null
let currentModel: string | null = null
let serverStartPromise: Promise<void> | null = null

const BYTES_PER_GIB = 1024 ** 3

// ---------------------------------------------------------------------------
// Paths — everything lives under <appData>/mlx/
// ---------------------------------------------------------------------------

function dataDir(): string {
  return join(app.getPath('userData'), 'mlx')
}

function venvDir(): string {
  return join(dataDir(), 'venv')
}

/** The python binary inside our managed venv */
function venvPython(): string {
  return join(venvDir(), 'bin', 'python3')
}

function modelsDir(): string {
  return join(dataDir(), 'models')
}

function firstRunResetMarkerPath(): string {
  return join(dataDir(), '.first-run-model-reset-v1')
}

// ---------------------------------------------------------------------------
// System Python detection
// ---------------------------------------------------------------------------

/**
 * Find a compatible system Python (3.10–3.13).
 * We explicitly skip 3.14+ because mlx-lm doesn't publish wheels for it yet.
 * We try versioned binaries first (most reliable), then fall back to `python3`.
 */
function findSystemPython(): string | null {
  // Prefer specific known-good versions, newest first
  const versionedCandidates = [
    '/opt/homebrew/bin/python3.13',
    '/opt/homebrew/bin/python3.12',
    '/opt/homebrew/bin/python3.11',
    '/opt/homebrew/bin/python3.10',
    '/opt/homebrew/opt/python@3.13/bin/python3.13',
    '/opt/homebrew/opt/python@3.12/bin/python3.12',
    '/opt/homebrew/opt/python@3.11/bin/python3.11',
    '/opt/homebrew/opt/python@3.10/bin/python3.10',
    '/usr/local/bin/python3.13',
    '/usr/local/bin/python3.12',
    '/usr/local/bin/python3.11',
    '/usr/local/bin/python3.10'
  ]

  for (const c of versionedCandidates) {
    try {
      const s = spawnSync(c, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      if (s.status === 0) {
        console.log(`[mlx] Found compatible Python: ${c} (${s.stdout.toString().trim()})`)
        return c
      }
    } catch {
      // not available
    }
  }

  // Last resort: try generic python3/python but verify it's not 3.14+
  const fallbacks = ['python3', 'python', '/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3']
  for (const c of fallbacks) {
    try {
      const s = spawnSync(c, ['--version'], { timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })
      if (s.status === 0) {
        const ver = s.stdout.toString().trim() || s.stderr.toString().trim() // e.g. "Python 3.13.2"
        const match = ver.match(/Python 3\.(\d+)/)
        const minor = match ? parseInt(match[1], 10) : 99
        if (minor >= 10 && minor <= 13) {
          console.log(`[mlx] Found compatible Python via ${c}: ${ver}`)
          // If it was an unqualified command, we should try to get its full path
          if (!c.startsWith('/')) {
            const which = spawnSync('which', [c], { stdio: ['ignore', 'pipe', 'ignore'] })
            if (which.status === 0) return which.stdout.toString().trim()
          }
          return c
        } else if (minor < 10) {
          console.log(`[mlx] Skipping ${c} — ${ver} is too old (need 3.10+)`)
        } else {
          console.log(`[mlx] Skipping ${c} — ${ver} is too new for mlx-lm`)
        }
      }
    } catch {
      // not available
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// MLX detection
// ---------------------------------------------------------------------------

export interface MLXStatus {
  /** Python to use for running mlx_lm (venv python if installed, system python otherwise) */
  python: string
  /** Whether mlx-lm is installed and importable */
  installed: boolean
}

/**
 * Check if mlx-lm is ready to use.
 * Returns the python path to use and whether mlx_lm is installed.
 */
export function locateMLX(): MLXStatus | null {
  // 1. Check if we have a working venv with mlx_lm installed
  const vPy = venvPython()
  if (existsSync(vPy)) {
    // Verify the venv Python is 3.10+ — older versions can't run modern mlx-lm
    try {
      const verCheck = spawnSync(vPy, ['--version'], {
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      const verStr = verCheck.stdout?.toString().trim() || ''
      const verMatch = verStr.match(/Python 3\.(\d+)/)
      const minor = verMatch ? parseInt(verMatch[1], 10) : 0
      if (minor < 10) {
        console.log(`[mlx] Existing venv uses ${verStr} (too old). Deleting and recreating…`)
        try { rmSync(venvDir(), { recursive: true, force: true }) } catch { /* ok */ }
        // Fall through to system python detection below
      } else {
        // Venv Python is compatible — check if mlx_lm is installed
        try {
          const check = spawnSync(vPy, ['-c', 'import mlx_lm; print("ok")'], {
            timeout: 15000,
            stdio: ['ignore', 'pipe', 'pipe']
          })
          const stdout = check.stdout?.toString().trim() || ''
          if (check.status === 0 && stdout.includes('ok')) {
            console.log('[mlx] Found mlx-lm in venv')
            return { python: vPy, installed: true }
          }
        } catch {
          // venv exists but mlx_lm not importable
        }
        // Venv exists but mlx_lm is missing — can still pip install into it
        return { python: vPy, installed: false }
      }
    } catch {
      // Can't check version — treat as needing recreation
      console.log('[mlx] Cannot determine venv Python version. Recreating…')
      try { rmSync(venvDir(), { recursive: true, force: true }) } catch { /* ok */ }
    }
  }

  // 2. No venv yet — find a compatible system python so we can create one
  const sysPython = findSystemPython()
  if (!sysPython) return null
  return { python: sysPython, installed: false }
}

// ---------------------------------------------------------------------------
// Installation — creates a venv and installs mlx-lm
// ---------------------------------------------------------------------------

export type InstallProgress = {
  stage: 'download' | 'install'
  message: string
}

/**
 * On first launch only, wipe cached model files so setup always starts clean.
 * This avoids stale/corrupted downloads carrying over from previous builds.
 */
export async function ensureCleanFirstRunModelState(
  onProgress?: (message: string) => void
): Promise<boolean> {
  const marker = firstRunResetMarkerPath()
  if (existsSync(marker)) return false

  onProgress?.('First launch detected. Resetting local model cache…')

  await stopServer()

  try {
    rmSync(modelsDir(), { recursive: true, force: true })
    mkdirSync(dataDir(), { recursive: true })
    writeFileSync(
      marker,
      JSON.stringify({ cleanedAt: new Date().toISOString(), version: 1 }) + '\n',
      'utf8'
    )
    console.log('[mlx] First-run model reset complete')
    return true
  } catch (e) {
    throw new Error(`Failed to reset first-run model cache: ${(e as Error).message}`)
  }
}

/**
 * Install mlx-lm into a dedicated virtual environment.
 * Uses --index-url to bypass any corporate pip registries.
 * Returns the venv python path to use for all subsequent operations.
 */
export async function installMLX(
  onProgress: (p: InstallProgress) => void
): Promise<string> {
  const sysPython = findSystemPython()
  if (!sysPython) {
    throw new Error(
      'Python 3.10–3.13 not found. Please install Python via Homebrew: brew install python@3.13'
    )
  }

  const vDir = venvDir()
  const vPy = venvPython()

  // Step 1: Create venv if needed
  if (!existsSync(vPy)) {
    onProgress({ stage: 'install', message: 'Creating Python virtual environment…' })
    console.log(`[mlx] Creating venv at ${vDir} using ${sysPython}`)
    await runProcess(sysPython, ['-m', 'venv', vDir], onProgress)
  }

  // Step 2: Upgrade pip first (avoids old-pip issues)
  onProgress({ stage: 'install', message: 'Upgrading pip…' })
  await runProcess(vPy, [
    '-m', 'pip', 'install', '--upgrade', 'pip',
    '--index-url', 'https://pypi.org/simple/'
  ], onProgress)

  // Step 3: Install mlx-lm (force public PyPI to bypass corporate registries)
  onProgress({ stage: 'install', message: 'Installing mlx-lm (this may take a few minutes)…' })
  await runProcess(vPy, [
    '-m', 'pip', 'install', '--upgrade', 'mlx-lm>=0.24.0',
    '--index-url', 'https://pypi.org/simple/'
  ], onProgress)

  // Verify the install worked
  const check = spawnSync(vPy, ['-c', 'import mlx_lm; print("ok")'], {
    timeout: 15000,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  if (check.status !== 0 || !check.stdout?.toString().includes('ok')) {
    const err = check.stderr?.toString().slice(-300) || 'unknown error'
    throw new Error(`mlx-lm installed but failed to import: ${err}`)
  }

  console.log('[mlx] mlx-lm installed successfully')
  return vPy
}

/** Run a subprocess and stream output to onProgress */
function runProcess(
  cmd: string,
  args: string[],
  onProgress: (p: InstallProgress) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PIP_DISABLE_PIP_VERSION_CHECK: '1',
        // Force public PyPI — don't inherit corporate pip.conf
        PIP_INDEX_URL: 'https://pypi.org/simple/',
        PIP_EXTRA_INDEX_URL: ''
      }
    })

    let stderr = ''
    proc.stdout?.on('data', (d) => {
      const line = d.toString().trim()
      if (line) onProgress({ stage: 'install', message: line.slice(0, 120) })
    })
    proc.stderr?.on('data', (d) => {
      stderr += d.toString()
      const line = d.toString().trim()
      if (line) onProgress({ stage: 'install', message: line.slice(0, 120) })
    })
    proc.on('error', reject)
    proc.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${cmd} ${args.slice(0, 3).join(' ')} failed (exit ${code}): ${stderr.slice(-500)}`))
    })
  })
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

export interface ServerProgress {
  message: string
  /** 0.0–1.0 progress fraction, if available */
  progress?: number
  /** Estimated seconds remaining */
  remainingSeconds?: number
  /** Total estimated seconds for entire process */
  totalSeconds?: number
}

export async function startServer(
  python: string,
  model: string,
  onProgress?: (p: ServerProgress) => void,
  skipPostLoadRepair = false
): Promise<void> {
  if (serverStartPromise) {
    await serverStartPromise
    if (serverProc && !serverProc.killed && currentModel === model) return
  }

  serverStartPromise = startServerInternal(python, model, onProgress, skipPostLoadRepair)
    .finally(() => {
      serverStartPromise = null
    })

  return serverStartPromise
}

async function startServerInternal(
  python: string,
  model: string,
  onProgress?: (p: ServerProgress) => void,
  skipPostLoadRepair = false
): Promise<void> {
  if (serverProc && !serverProc.killed && currentModel === model) return

  assertSafeLocalModelLoad(model)

  // Kill existing server if running with different model
  await stopServer()

  // Apply known model fixes BEFORE spawning
  try {
    await repairModelConfig(model)
  } catch (e) {
    console.warn('[mlx] Model repair failed (non-critical):', (e as Error).message)
  }

  const env = {
    ...process.env,
    // HuggingFace cache dir — keep models in our app data
    HF_HOME: modelsDir(),
    TRANSFORMERS_CACHE: modelsDir(),
    HF_HUB_DISABLE_TELEMETRY: '1'
  }

  // Track early exit so waitForHealth can bail out immediately
  let earlyExit: { code: number | null; stderr: string } | null = null
  let stderrBuf = ''

  // Get model size for time estimation
  const modelInfo = AVAILABLE_MODELS.find(m => m.name === model)
  const modelSizeBytes = modelInfo?.sizeBytes ?? 3_000_000_000 // default 3GB

  // Metrics for progress tracking
  let downloadStartTime = 0
  let downloadCompleteTime = 0

  // Estimate model loading time based on size (rough: ~60MB/s on Apple Silicon)
  const estimatedLoadTimeSeconds = Math.ceil(modelSizeBytes / 60_000_000)

  const serverArgs = [
    '-m',
    'mlx_lm',
    'server',
    '--model',
    model,
    '--port',
    String(MLX_PORT),
    '--prompt-cache-size',
    '0',
    '--decode-concurrency',
    '1',
    '--prompt-concurrency',
    '1'
  ]

  console.log(`[mlx] Starting server: ${python} ${serverArgs.join(' ')}`)

  serverProc = spawn(
    python,
    serverArgs,
    {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    }
  )
  currentModel = model

  serverProc.stdout?.on('data', (d) => console.log('[mlx]', d.toString().trim()))
  serverProc.stderr?.on('data', (d) => {
    const text = d.toString()
    stderrBuf += text
    console.log('[mlx]', text.trim())

    // Parse HuggingFace download progress from stderr
    if (onProgress) {
      const lines = text.split(/[\r\n]+/).filter(l => l.length > 0)
      for (const line of lines) {
        const fetchMatch = line.match(/Fetching\s+(\d+)\s+files?:\s+(\d+)%.*?(\d+)\/(\d+)\s*\[([^\]<]+)<([^\]]+)/)
        if (fetchMatch) {
          const pct = parseInt(fetchMatch[2], 10)
          const done = parseInt(fetchMatch[3], 10)
          const total = parseInt(fetchMatch[4], 10)
          const remainingStr = fetchMatch[6] // "00:59"

          if (!downloadStartTime) downloadStartTime = Date.now()

          const remainingMatch = remainingStr.match(/(\d+):(\d+)/)
          const remainingDownloadSeconds = remainingMatch ?
            parseInt(remainingMatch[1]) * 60 + parseInt(remainingMatch[2]) : 0

          if (pct === 100) {
            if (!downloadCompleteTime) downloadCompleteTime = Date.now()
            const totalLoadTime = estimatedLoadTimeSeconds
            onProgress({
              message: `Loading model into memory… (${totalLoadTime}s estimated)`,
              progress: 0.95,
              remainingSeconds: totalLoadTime,
              totalSeconds: (downloadCompleteTime - downloadStartTime) / 1000 + totalLoadTime
            })
          } else {
            const totalLoadTime = estimatedLoadTimeSeconds
            const estimatedTotalSeconds = (Date.now() - downloadStartTime) / 1000 + remainingDownloadSeconds + totalLoadTime
            onProgress({
              message: `Downloading model files… ${done}/${total}`,
              progress: (pct / 100) * 0.5,
              remainingSeconds: remainingDownloadSeconds + totalLoadTime,
              totalSeconds: estimatedTotalSeconds
            })
          }
          continue
        }

        if (line.includes('Starting httpd') || line.includes('starting')) {
          onProgress({ message: 'Starting server…', progress: 1.0 })
        }
      }
    }
  })
  
  serverProc.on('exit', (code) => {
    console.log('[mlx] server exited with code', code)
    earlyExit = { code, stderr: stderrBuf }
    serverProc = null
    currentModel = null
  })

  // Wait for the server to become healthy.
  // First run downloads model weights from HuggingFace, so allow up to 10 min.
  await waitForHealth(600_000, () => earlyExit, onProgress, {
    modelSize: modelSizeBytes,
    estimatedLoadTime: estimatedLoadTimeSeconds,
    getStderr: () => stderrBuf
  })

  // On a true first download, model files did not exist before spawn, so
  // pre-spawn repair cannot patch them yet. Repair now and restart once.
  if (!skipPostLoadRepair) {
    try {
      const changed = await repairModelConfig(model)
      if (changed) {
        console.log('[mlx] Post-download model repair applied; restarting server to load patched config')
        onProgress?.({
          message: 'Applying compatibility fix and restarting model runtime…',
          progress: 0.98
        })
        await stopServer()
        await startServerInternal(python, model, onProgress, true)
      }
    } catch (e) {
      console.warn('[mlx] Post-download model repair failed (non-critical):', (e as Error).message)
    }
  }
}

function assertSafeLocalModelLoad(model: string): void {
  const info = AVAILABLE_MODELS.find((m) => m.name === model)
  if (!info?.requiresManualOverride) return
  if (process.env.GEMMA_CHAT_ALLOW_LARGE_MODELS === '1') return

  const systemMemoryGiB = Math.round(totalmem() / BYTES_PER_GIB)
  throw new Error(
    `${info.label} is disabled by default because it can saturate memory and hang this Mac (${systemMemoryGiB} GB RAM). ` +
    'Use Gemma 2 2B or Gemma 4 E2B/E4B, or set GEMMA_CHAT_ALLOW_LARGE_MODELS=1 if you intentionally want to test it.'
  )
}

/**
 * Apply known fixes to model config.json files.
 * Some Gemma 4 models on HF have architecture mismatches (KV sharing).
 */
async function repairModelConfig(modelName: string): Promise<boolean> {
  const repoDir = join(modelsDir(), 'hub', `models--${modelName.replace(/\//g, '--')}`)
  if (!existsSync(repoDir)) return false

  // Find config.json in snapshots
  const snapshotsDir = join(repoDir, 'snapshots')
  if (!existsSync(snapshotsDir)) return false

  const { readdir, readFile, writeFile } = await import('fs/promises')
  const snapshots = await readdir(snapshotsDir)
  let changedAny = false
  
  for (const s of snapshots) {
    const configPath = join(snapshotsDir, s, 'config.json')
    if (existsSync(configPath)) {
      try {
        const content = JSON.parse(await readFile(configPath, 'utf8'))
        let changed = false

        // Fix for Gemma 4 KV sharing mismatch
        if (content.model_type === 'gemma4' && content.text_config?.num_kv_shared_layers > 0) {
          console.log(`[mlx] Repairing KV sharing mismatch for ${modelName}`)
          content.text_config.num_kv_shared_layers = 0
          changed = true
        }
        if (content.model_type === 'gemma4' && typeof content.num_kv_shared_layers === 'number' && content.num_kv_shared_layers > 0) {
          console.log(`[mlx] Repairing root KV sharing mismatch for ${modelName}`)
          content.num_kv_shared_layers = 0
          changed = true
        }

        if (changed) {
          await writeFile(configPath, JSON.stringify(content, null, 4))
          console.log(`[mlx] Successfully repaired ${modelName} config`)
          changedAny = true
        }
      } catch (e) {
        console.warn(`[mlx] Failed to check/repair config for ${modelName}:`, (e as Error).message)
      }
    }
  }
  return changedAny
}

/**
 * Stop the current MLX server process and wait for it to exit.
 * Uses SIGTERM initially, falls back to SIGKILL if it doesn't exit within 3s.
 */
export async function stopServer(): Promise<void> {
  if (!serverProc || serverProc.killed) {
    serverProc = null
    currentModel = null
    return
  }

  console.log('[mlx] Stopping server process')
  const proc = serverProc
  serverProc = null
  currentModel = null

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      console.log('[mlx] Server did not exit in time, force killing…')
      try { proc.kill('SIGKILL') } catch { /* ok */ }
      resolve()
    }, 3000)

    proc.on('exit', () => {
      clearTimeout(timeout)
      console.log('[mlx] Server process exited cleanly')
      resolve()
    })

    try { proc.kill('SIGTERM') } catch {
      clearTimeout(timeout)
      resolve()
    }
  })
}

/**
 * Poll the server's /v1/models endpoint until the requested model is loaded.
 * If the server process exits early or logs a fatal error, throw immediately.
 */
async function waitForHealth(
  timeoutMs: number,
  checkEarlyExit: () => { code: number | null; stderr: string } | null,
  onProgress?: (p: ServerProgress) => void,
  estimateInfo?: { modelSize: number; estimatedLoadTime: number; getStderr: () => string }
): Promise<void> {
  const start = Date.now()
  let lastError: unknown = null
  let lastProgressSend = 0
  const estimatedLoadSeconds = estimateInfo?.estimatedLoadTime ?? 60
  
  // We need to wait at least a few seconds for the model to actually load into memory,
  // even if it appears in the /v1/models list (which scans the cache directory immediately).
  const minLoadTimeMs = 5000 

  while (Date.now() - start < timeoutMs) {
    // 1. Check if the server process crashed
    const exit = checkEarlyExit()
    if (exit) {
      throw new Error(
        `MLX server exited with code ${exit.code}. ${exit.stderr.slice(-500)}`
      )
    }

    // 2. Check for fatal errors in stderr without exiting
    const stderr = estimateInfo?.getStderr() || ''
    if (stderr.includes('OutOfMemoryError') || stderr.includes('MemoryError')) {
      await stopServer()
      throw new Error('MLX server ran out of memory while loading the model. Try a smaller model variant.')
    }
    if (stderr.includes('Error: model not found') || stderr.includes('FileNotFoundError')) {
      await stopServer()
      throw new Error('MLX server could not find the model files. Try deleting the model folder and downloading again.')
    }

    // 3. Poll the models endpoint
    try {
      const res = await fetch(`${MLX_URL}/v1/models`)
      if (res.ok) {
        const data = (await res.json()) as { data?: Array<{ id: string }> }
        const models = (data.data ?? []).map((m) => m.id)
        
        // Check if the current model is in the list
        const found = currentModel && models.some((m) => m === currentModel || m.startsWith(currentModel + ':'))
        
        // Only consider it healthy if it's found AND we've waited at least minLoadTimeMs
        // OR if the server is already responding to chat requests (not checked here for simplicity)
        if (found && (Date.now() - start > minLoadTimeMs)) {
          console.log('[mlx] Server is healthy, model loaded')
          return
        }

        // Server is up but model not ready yet - send progress update
        const now = Date.now()
        if (now - lastProgressSend > 1000) {
          const elapsedSec = Math.round((now - start) / 1000)
          const remainingSec = Math.max(0, estimatedLoadSeconds - elapsedSec)
          
          if (onProgress) {
            onProgress({
              message: `Loading model into memory… (${remainingSec}s remaining)`,
              progress: 0.5 + (elapsedSec / estimatedLoadSeconds) * 0.45,
              remainingSeconds: remainingSec,
              totalSeconds: elapsedSec + estimatedLoadSeconds
            })
          }
          lastProgressSend = now
        }
      }
    } catch (e) {
      lastError = e
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error(`MLX server did not become healthy within ${timeoutMs / 1000}s: ${String(lastError)}`)
}

// ---------------------------------------------------------------------------
// Model management
// ---------------------------------------------------------------------------

export async function listLocalModels(): Promise<string[]> {
  try {
    const res = await fetch(`${MLX_URL}/v1/models`)
    if (!res.ok) return []
    const data = (await res.json()) as { data?: Array<{ id: string }> }
    return (data.data ?? []).map((m) => m.id)
  } catch {
    return []
  }
}

export async function hasModel(_name: string): Promise<boolean> {
  try {
    const models = await listLocalModels()
    return models.length > 0
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Chat streaming (OpenAI-compatible SSE)
// ---------------------------------------------------------------------------

export interface MLXChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  images?: string[]
}

export interface MLXChatOptions {
  model: string
  messages: MLXChatMessage[]
  signal?: AbortSignal
  temperature?: number
}

export async function* chatStream(
  opts: MLXChatOptions
): AsyncGenerator<{ content?: string; done?: boolean }> {
  const res = await fetch(`${MLX_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: opts.model,
      messages: formatMessagesForMLX(opts.messages),
      stream: true,
      temperature: opts.temperature ?? 0.7,
      max_tokens: 2048
    }),
    signal: opts.signal
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Chat request failed: ${res.status} ${res.statusText} — ${text}`)
  }

  // Parse SSE stream (OpenAI format: "data: {...}\n\n")
  const stream = res.body as unknown as ReadableStream<Uint8Array>
  for await (const event of readSSE(stream)) {
    if (event === '[DONE]') {
      yield { done: true }
      return
    }
    try {
      const parsed = JSON.parse(event) as {
        choices?: Array<{
          delta?: { content?: string; role?: string }
          finish_reason?: string | null
        }>
      }
      const choice = parsed.choices?.[0]
      if (choice?.delta?.content) {
        yield { content: choice.delta.content }
      }
      if (choice?.finish_reason === 'stop' || choice?.finish_reason === 'length') {
        yield { done: true }
        return
      }
    } catch {
      // Skip malformed events
    }
  }
  yield { done: true }
}

/** Parse an SSE byte stream into individual data payloads */
async function* readSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, idx).trim()
      buf = buf.slice(idx + 2)
      if (!block) continue
      for (const line of block.split('\n')) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data) yield data
        }
      }
    }
  }

  // Flush remaining buffer
  if (buf.trim()) {
    for (const line of buf.trim().split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6).trim()
        if (data) yield data
      }
    }
  }
}
