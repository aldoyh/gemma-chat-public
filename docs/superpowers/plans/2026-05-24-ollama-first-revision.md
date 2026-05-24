# Ollama-First Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Ollama as the primary auto-detected backend, with MLX Gemma models and GGUF as the unchanged fallback chain.

**Architecture:** A new `OllamaBackend` class implements the existing `InferenceBackend` interface, talking to the local Ollama server via its OpenAI-compatible `/v1/chat/completions` API. On startup the main process pings Ollama; if it responds, the Setup wizard is skipped and chat opens immediately with a live model picker. If Ollama is absent, the original MLX setup flow runs unchanged.

**Tech Stack:** Electron + electron-vite, React 19, TypeScript, Tailwind, node-llama-cpp (GGUF), mlx-lm via Python subprocess (MLX), Ollama HTTP API (Ollama).

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `src/main/ollama.ts` | Ollama detection + model listing helpers |
| Create | `src/main/inference/ollama-backend.ts` | `OllamaBackend` implementing `InferenceBackend` |
| Modify | `src/shared/types.ts` | Add `'ollama'` source, `OllamaModelInfo`, `metrics` StreamChunk |
| Modify | `src/main/inference/base.ts` | Add `'ollama'` to `BackendType` |
| Modify | `src/main/inference/index.ts` | Factory + `switchBackend` for Ollama |
| Modify | `src/main/index.ts` | Auto-detect Ollama, new IPC handlers, `ensureBackendRunning` Ollama branch |
| Modify | `src/preload/index.ts` | Expose `checkOllama`, `listOllamaModels`, fix `openFileDialog` |
| Modify | `src/renderer/src/App.tsx` | Ollama startup branch, skip wizard |
| Modify | `src/renderer/src/components/ModelSourceSelector.tsx` | Add Ollama option + live model dropdown |
| Modify | `src/renderer/src/components/Chat.tsx` | Handle `'ollama'` source in `modelName` |
| Modify | `src/renderer/src/components/Sidebar.tsx` | Backend badge in footer |

---

### Task 1: Extend shared types

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `'ollama'` to `ModelSource` and add `OllamaModelInfo`**

Open `src/shared/types.ts`. Find the `ModelSource` type and `ModelConfig` interface, and add the Ollama model info type. Replace the bottom section of the file from `export type ModelSource` onwards:

```typescript
export type ModelSource = 'mlx' | 'gguf' | 'ollama'

export interface OllamaModelInfo {
  name: string
  label: string
  size: string
  details?: string
}

export interface ModelConfig {
  source: ModelSource
  path?: string   // GGUF: absolute path to .gguf file
  model?: string  // MLX: HuggingFace model ID; Ollama: model name like 'qwen3.5:9b'
}
```

Also add `metrics` to the `StreamChunk` union (it is sent by the main process but missing from the type). Find the `StreamChunk` export and add one line:

```typescript
export type StreamChunk =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'tool_result'; id: string; result?: string; error?: string }
  | { type: 'activity'; activity: AgentActivity }
  | { type: 'metrics'; cpuPercent: number }
  | { type: 'done' }
  | { type: 'error'; error: string }
```

- [ ] **Step 2: Run typecheck to confirm no regressions**

```bash
cd /Users/aldoyh/Projects/AI/gemma-chat-public && npm run typecheck 2>&1 | tail -20
```

Expected: errors only in files we haven't updated yet (inference/base, index files). Zero errors in `types.ts` itself.

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add ollama ModelSource and OllamaModelInfo types"
```

---

### Task 2: Add `'ollama'` to `BackendType`

**Files:**
- Modify: `src/main/inference/base.ts`

- [ ] **Step 1: Extend the BackendType union**

In `src/main/inference/base.ts`, change line 1:

```typescript
export type BackendType = 'mlx' | 'gguf' | 'ollama'
```

- [ ] **Step 2: Commit**

```bash
git add src/main/inference/base.ts
git commit -m "feat: add ollama to BackendType"
```

---

### Task 3: Create `src/main/ollama.ts`

**Files:**
- Create: `src/main/ollama.ts`

- [ ] **Step 1: Write the Ollama helpers module**

Create `src/main/ollama.ts` with the following content:

```typescript
export const OLLAMA_BASE_URL = 'http://localhost:11434'

export interface OllamaModelEntry {
  name: string
  size: number
  details?: { family?: string; parameter_size?: string }
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/v1/models`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

export async function listOllamaModels(): Promise<OllamaModelEntry[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const data = (await res.json()) as { models?: OllamaModelEntry[] }
    return data.models ?? []
  } catch {
    return []
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}

export function ollamaModelToInfo(entry: OllamaModelEntry): { name: string; label: string; size: string } {
  const label = entry.details?.parameter_size
    ? `${entry.name} (${entry.details.parameter_size})`
    : entry.name
  return {
    name: entry.name,
    label,
    size: entry.size ? formatBytes(entry.size) : ''
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/main/ollama.ts
git commit -m "feat: add ollama detection and model listing helpers"
```

---

### Task 4: Create `src/main/inference/ollama-backend.ts`

**Files:**
- Create: `src/main/inference/ollama-backend.ts`

- [ ] **Step 1: Write the OllamaBackend class**

Create `src/main/inference/ollama-backend.ts`:

```typescript
import { OLLAMA_BASE_URL, isOllamaRunning, listOllamaModels, ollamaModelToInfo } from '../ollama'
import type { InferenceBackend, BackendStatus, ChatStreamOptions, BackendStreamChunk } from './base'

export class OllamaBackend implements InferenceBackend {
  private currentModel: string | null = null

  async initialize(): Promise<void> {
    const running = await isOllamaRunning()
    if (!running) {
      throw new Error('Ollama is not running. Start it with: ollama serve')
    }
  }

  async shutdown(): Promise<void> {
    this.currentModel = null
  }

  async getStatus(): Promise<BackendStatus> {
    const running = await isOllamaRunning()
    return {
      available: running,
      installed: running,
      message: running ? 'Ollama running' : 'Ollama not running'
    }
  }

  async isReady(): Promise<boolean> {
    return this.currentModel !== null && (await isOllamaRunning())
  }

  async install(_onProgress: (progress: { stage: string; message: string }) => void): Promise<void> {
    // Ollama is externally managed — nothing to install
  }

  async loadModel(modelName: string, _onProgress?: (p: { message: string; progress?: number }) => void): Promise<void> {
    const running = await isOllamaRunning()
    if (!running) throw new Error('Ollama is not running')
    this.currentModel = modelName
  }

  async listModels(): Promise<string[]> {
    const entries = await listOllamaModels()
    return entries.map((e) => e.name)
  }

  async hasModel(name: string): Promise<boolean> {
    const models = await this.listModels()
    return models.includes(name)
  }

  async *chat(opts: ChatStreamOptions): AsyncGenerator<BackendStreamChunk> {
    if (!this.currentModel) {
      throw new Error('No model loaded. Call loadModel() first.')
    }

    const res = await fetch(`${OLLAMA_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: opts.model || this.currentModel,
        messages: opts.messages.map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
        stream: true,
        temperature: opts.temperature ?? 0.7
      }),
      signal: opts.signal
    })

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => '')
      throw new Error(`Ollama chat failed: ${res.status} ${res.statusText} — ${text}`)
    }

    const reader = res.body.getReader()
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
        for (const line of block.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') { yield { done: true }; return }
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>
            }
            const choice = parsed.choices?.[0]
            if (choice?.delta?.content) yield { content: choice.delta.content }
            if (choice?.finish_reason === 'stop' || choice?.finish_reason === 'length') {
              yield { done: true }
              return
            }
          } catch { /* skip malformed */ }
        }
      }
    }
    yield { done: true }
  }
}

export { ollamaModelToInfo }
```

- [ ] **Step 2: Commit**

```bash
git add src/main/inference/ollama-backend.ts
git commit -m "feat: implement OllamaBackend using OpenAI-compatible streaming API"
```

---

### Task 5: Wire OllamaBackend into the inference factory

**Files:**
- Modify: `src/main/inference/index.ts`

- [ ] **Step 1: Import and add OllamaBackend to the factory**

In `src/main/inference/index.ts`, add the import at the top:

```typescript
import { OllamaBackend } from './ollama-backend'
```

In the `createBackend` switch statement, add the new case before the `default`:

```typescript
case 'ollama':
  backend = new OllamaBackend()
  break
```

At the bottom of the file, add to the re-exports:

```typescript
export { OllamaBackend } from './ollama-backend'
```

- [ ] **Step 2: Commit**

```bash
git add src/main/inference/index.ts
git commit -m "feat: register OllamaBackend in inference factory"
```

---

### Task 6: Update main process — Ollama IPC + `ensureBackendRunning`

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add Ollama import at the top of `src/main/index.ts`**

After the existing imports, add:

```typescript
import { isOllamaRunning, listOllamaModels, ollamaModelToInfo } from './ollama'
```

- [ ] **Step 2: Add the Ollama branch to `ensureBackendRunning`**

In `ensureBackendRunning`, make three edits:

**2a.** Replace the `targetType` line:
```typescript
const targetType = modelConfig.source === 'mlx' ? 'mlx' : modelConfig.source === 'ollama' ? 'ollama' : 'gguf'
```

**2b.** In the early-return "already running" block, add the Ollama case so the model name is updated:
```typescript
if (backend && backendType === targetType) {
  if (targetType === 'mlx' && modelConfig.model) {
    await backend.loadModel(modelConfig.model, onProgress)
  } else if (targetType === 'gguf' && modelConfig.path) {
    await backend.loadModel(modelConfig.path, onProgress)
  } else if (targetType === 'ollama' && modelConfig.model) {
    await backend.loadModel(modelConfig.model, onProgress)
  }
  return backend
}
```

**2c.** Inside the large `try` block, add a new `else if` for Ollama before the final `else`:
```typescript
} else if (modelConfig.source === 'ollama') {
  const modelName = modelConfig.model
  if (!modelName) throw new Error('Ollama model name required')

  await switchBackend('ollama')
  const ollamaBackend = getCurrentBackend()
  if (!ollamaBackend) throw new Error('Failed to initialize Ollama backend')

  await ollamaBackend.loadModel(modelName, onProgress)
  return ollamaBackend
```

- [ ] **Step 3: Register new IPC handlers inside `app.whenReady`**

After the existing `ipcMain.handle('models:list-local', ...)` handler, add:

```typescript
ipcMain.handle('ollama:check', async () => {
  return { running: await isOllamaRunning() }
})

ipcMain.handle('ollama:list-models', async () => {
  const entries = await listOllamaModels()
  return entries.map(ollamaModelToInfo)
})
```

- [ ] **Step 4: Run typecheck**

```bash
cd /Users/aldoyh/Projects/AI/gemma-chat-public && npm run typecheck 2>&1 | grep -E "error|Error" | head -20
```

Expected: zero errors in modified files.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: wire Ollama backend into main process IPC and ensureBackendRunning"
```

---

### Task 7: Update preload — expose Ollama API + fix file dialog

**Files:**
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add `checkOllama` and `listOllamaModels` to the api object**

In `src/preload/index.ts`, find the `const api = {` block. Add after `listLocalModels`:

```typescript
checkOllama: (): Promise<{ running: boolean }> =>
  ipcRenderer.invoke('ollama:check'),

listOllamaModels: (): Promise<Array<{ name: string; label: string; size: string }>> =>
  ipcRenderer.invoke('ollama:list-models'),

openFileDialog: (options?: { filters?: Array<{ name: string; extensions: string[] }> }): Promise<{ canceled: boolean; filePaths: string[] }> =>
  ipcRenderer.invoke('dialog:open-file', options),
```

- [ ] **Step 2: Update the type imports to include `OllamaModelInfo`**

At the top of `src/preload/index.ts`, add `OllamaModelInfo` to the import from `../shared/types`:

```typescript
import type {
  ChatRequest,
  SetupStatus,
  StreamChunk,
  WorkspaceInfo,
  WorkspaceFile,
  ModelConfig,
  OllamaModelInfo
} from '../shared/types'
```

Also update the return type of `listOllamaModels`:

```typescript
listOllamaModels: (): Promise<OllamaModelInfo[]> =>
  ipcRenderer.invoke('ollama:list-models'),
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/aldoyh/Projects/AI/gemma-chat-public && npm run typecheck 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: expose ollama IPC and file dialog in preload API"
```

---

### Task 8: Update `App.tsx` — Ollama startup branch

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add Ollama detection to the startup `useEffect`**

In `App.tsx`, find the `useEffect` inside `AppContent`. The current startup logic checks `listLocalModels` then `checkMLX`. Rewrite the startup logic to check Ollama first:

Replace the async IIFE `(async () => { ... })()` block inside the `useEffect` with:

```typescript
;(async () => {
  // 1. Check Ollama first — if running, skip setup entirely
  const { running } = await window.api.checkOllama()
  if (running) {
    const ollamaModels = await window.api.listOllamaModels()
    const firstModel = ollamaModels[0]?.name ?? 'gemma3:4b'
    const ollamaConfig: ModelConfig = { source: 'ollama', model: firstModel }
    setState({
      phase: 'setup',
      status: { stage: 'starting-mlx', message: 'Connecting to Ollama…' },
      modelConfig: ollamaConfig
    })
    window.api.startSetup(ollamaConfig)
    return
  }

  // 2. Fall back to original MLX check
  const local = await window.api.listLocalModels()
  const hasDefault = local.some(
    (m) => m === DEFAULT_MODEL || m.startsWith(DEFAULT_MODEL + ':')
  )
  const defaultConfig: ModelConfig = { source: 'mlx', model: DEFAULT_MODEL }
  if (hasDefault) {
    const { hasMLX } = await window.api.checkMLX()
    if (hasMLX) {
      setState({
        phase: 'setup',
        status: { stage: 'starting-mlx', message: 'Starting model runtime…' },
        modelConfig: defaultConfig
      })
      window.api.startSetup(defaultConfig)
      return
    }
  }
  setState({
    phase: 'setup',
    status: { stage: 'checking', message: 'Welcome' },
    modelConfig: defaultConfig
  })
})()
```

- [ ] **Step 2: Update `handleSwitchModel` to allow Ollama switches**

Find `handleSwitchModel`. The equality check `prev.modelConfig.source === newModelConfig.source && prev.modelConfig.model === newModelConfig.model` already works for Ollama since it compares `source` and `model`. No change needed here.

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/aldoyh/Projects/AI/gemma-chat-public && npm run typecheck 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: add Ollama auto-detection to App startup flow"
```

---

### Task 9: Update `ModelSourceSelector` — add Ollama option

**Files:**
- Modify: `src/renderer/src/components/ModelSourceSelector.tsx`

- [ ] **Step 1: Rewrite `ModelSourceSelector.tsx` with Ollama option**

Replace the entire file content with:

```typescript
import { useEffect, useState, type ReactElement } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { ModelConfig, OllamaModelInfo } from '@shared/types'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@shared/types'

interface Props {
  modelConfig: ModelConfig
  onConfigChange: (config: ModelConfig) => void
  disabled?: boolean
}

export default function ModelSourceSelector({ modelConfig, onConfigChange, disabled = false }: Props): ReactElement {
  const { t, language } = useI18n()
  const [ggufPath, setGgufPath] = useState(modelConfig.path || '')
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([])
  const [ollamaLoading, setOllamaLoading] = useState(false)

  useEffect(() => {
    if (modelConfig.source !== 'ollama') return
    setOllamaLoading(true)
    window.api.listOllamaModels().then((models) => {
      setOllamaModels(models)
      if (models.length > 0 && !modelConfig.model) {
        onConfigChange({ source: 'ollama', model: models[0].name })
      }
      setOllamaLoading(false)
    }).catch(() => setOllamaLoading(false))
  }, [modelConfig.source])

  const selectGGUFFile = async () => {
    const result = await window.api.openFileDialog({
      filters: [
        { name: 'GGUF Models', extensions: ['gguf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0]
      setGgufPath(path)
      onConfigChange({ source: 'gguf', path })
    }
  }

  const refreshOllama = () => {
    setOllamaLoading(true)
    window.api.listOllamaModels().then((models) => {
      setOllamaModels(models)
      setOllamaLoading(false)
    }).catch(() => setOllamaLoading(false))
  }

  const btn = (active: boolean) =>
    `w-full text-left rounded-lg border-2 p-3 transition ${
      active ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-white/5 hover:border-white/20'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`

  return (
    <div className={`space-y-4 rounded-lg border border-white/10 bg-white/5 p-4 ${language === 'ar' ? 'rtl' : ''}`}>
      <div className="space-y-2">
        <label className={`block text-sm font-medium ${language === 'ar' ? 'font-tajawal text-right' : ''}`}>
          {t.setup.modelSource}
        </label>

        {/* Ollama option */}
        <button
          onClick={() => onConfigChange({ source: 'ollama', model: ollamaModels[0]?.name })}
          disabled={disabled}
          className={btn(modelConfig.source === 'ollama')}
        >
          <div className="font-medium flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            Ollama (local)
          </div>
          <div className="text-xs text-white/60">Use any model from your local Ollama install</div>
        </button>

        {modelConfig.source === 'ollama' && (
          <div className="flex gap-2">
            <select
              value={modelConfig.model || ''}
              onChange={(e) => onConfigChange({ source: 'ollama', model: e.target.value })}
              disabled={disabled || ollamaLoading}
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
            >
              {ollamaLoading && <option value="">Loading…</option>}
              {!ollamaLoading && ollamaModels.length === 0 && <option value="">No models found</option>}
              {ollamaModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}{m.size ? ` (${m.size})` : ''}
                </option>
              ))}
            </select>
            <button
              onClick={refreshOllama}
              disabled={disabled || ollamaLoading}
              title="Refresh Ollama model list"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs hover:bg-white/10"
            >
              ↺
            </button>
          </div>
        )}

        {/* MLX option */}
        <button
          onClick={() => onConfigChange({ source: 'mlx', model: modelConfig.model || DEFAULT_MODEL })}
          disabled={disabled}
          className={btn(modelConfig.source === 'mlx')}
        >
          <div className="font-medium">{t.setup.downloadFromHF}</div>
          <div className="text-xs text-white/60">{t.setup.downloadFromHFDesc}</div>
        </button>

        {modelConfig.source === 'mlx' && (
          <select
            value={modelConfig.model || DEFAULT_MODEL}
            onChange={(e) => onConfigChange({ source: 'mlx', model: e.target.value })}
            disabled={disabled}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.name} value={m.name}>
                {m.label} ({m.size})
              </option>
            ))}
          </select>
        )}

        {/* GGUF option */}
        <button
          onClick={() => onConfigChange({ source: 'gguf', path: ggufPath })}
          disabled={disabled}
          className={btn(modelConfig.source === 'gguf')}
        >
          <div className="font-medium">{t.setup.useLocalGGUF}</div>
          <div className="text-xs text-white/60">{t.setup.useLocalGGUFDesc}</div>
        </button>

        {modelConfig.source === 'gguf' && (
          <div className="space-y-2">
            <button
              onClick={selectGGUFFile}
              disabled={disabled}
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
            >
              {ggufPath ? t.setup.changeFile : t.setup.selectModelFile}
            </button>
            {ggufPath && (
              <div className="text-xs text-white/70 break-all">{ggufPath.split('/').pop()}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

```bash
cd /Users/aldoyh/Projects/AI/gemma-chat-public && npm run typecheck 2>&1 | grep -E "error|Error" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ModelSourceSelector.tsx
git commit -m "feat: add Ollama model picker to ModelSourceSelector, fix GGUF file dialog"
```

---

### Task 10: Update `Chat.tsx` — handle Ollama model name

**Files:**
- Modify: `src/renderer/src/components/Chat.tsx`

- [ ] **Step 1: Fix the `modelName` extraction to include Ollama**

In `Chat.tsx`, find the two occurrences of:
```typescript
const modelName = modelConfig.source === 'mlx' ? (modelConfig.model || 'unknown') : (modelConfig.path || 'custom')
```

Replace both with:
```typescript
const modelName =
  modelConfig.source === 'mlx' ? (modelConfig.model || 'unknown') :
  modelConfig.source === 'ollama' ? (modelConfig.model || 'unknown') :
  (modelConfig.path || 'custom')
```

- [ ] **Step 2: Fix the model label display for Ollama (second occurrence)**

In the model-switcher section of `Chat.tsx` (around line 394), find:
```typescript
const currentLabel = AVAILABLE_MODELS.find((m) => m.name === modelName)?.label ?? modelName
```

Replace with:
```typescript
const currentLabel =
  modelConfig.source === 'ollama'
    ? (modelConfig.model || 'Ollama')
    : (AVAILABLE_MODELS.find((m) => m.name === modelName)?.label ?? modelName)
```

- [ ] **Step 3: Run typecheck**

```bash
cd /Users/aldoyh/Projects/AI/gemma-chat-public && npm run typecheck 2>&1 | grep -E "error|Error" | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Chat.tsx
git commit -m "feat: handle ollama source in Chat modelName and label"
```

---

### Task 11: Update `Sidebar.tsx` — backend badge

**Files:**
- Modify: `src/renderer/src/components/Sidebar.tsx`

- [ ] **Step 1: Add `modelConfig` prop and backend badge to Sidebar**

The `Sidebar` component needs to know the active backend to display the badge. Update the interface and component:

```typescript
import type { ModelConfig } from '@shared/types'

interface Props {
  conversations: Conversation[]
  activeId: string
  modelConfig: ModelConfig
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}
```

Update the function signature:
```typescript
export default function Sidebar({ conversations, activeId, modelConfig, onSelect, onNew, onDelete }: Props) {
```

Replace the footer `<div>` (the one with "Running locally") with:

```typescript
<div className="no-drag border-t border-white/[0.06] p-3 text-[11px] text-ink-400">
  <div className="flex items-center justify-between">
    <div className="flex items-center gap-1.5">
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${
        modelConfig.source === 'ollama' ? 'bg-emerald-400' :
        modelConfig.source === 'mlx' ? 'bg-blue-400' : 'bg-orange-400'
      }`} />
      {modelConfig.source === 'ollama' ? 'Ollama' :
       modelConfig.source === 'mlx' ? 'MLX' : 'GGUF'}
    </div>
    <a href="https://x.com/ammaar" target="_blank" rel="noopener noreferrer"
       className="text-ink-400/50 transition hover:text-ink-200">
      @ammaar
    </a>
  </div>
</div>
```

- [ ] **Step 2: Update `Chat.tsx` to pass `modelConfig` to Sidebar**

In `Chat.tsx`, find the `<Sidebar` JSX and add the `modelConfig` prop:

```typescript
<Sidebar
  conversations={conversations.map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt }))}
  activeId={activeId}
  modelConfig={modelConfig}
  onSelect={setActiveId}
  onNew={() => createConversation(activeConversation.mode)}
  onDelete={deleteConversation}
/>
```

- [ ] **Step 3: Run final typecheck**

```bash
cd /Users/aldoyh/Projects/AI/gemma-chat-public && npm run typecheck 2>&1 | tail -10
```

Expected: `Found 0 errors.`

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/Sidebar.tsx src/renderer/src/components/Chat.tsx
git commit -m "feat: add backend badge to Sidebar showing Ollama/MLX/GGUF"
```

---

### Task 12: Build, install, and launch

**Files:** none (build only)

- [ ] **Step 1: Run the production build**

```bash
cd /Users/aldoyh/Projects/AI/gemma-chat-public && npm run dist 2>&1 | tail -30
```

Expected: `Build complete.` with `out/mac-arm64/Gemma Chat.app` (or `dist/mac-arm64/...`). If the build fails, check the error and fix before continuing.

- [ ] **Step 2: Find the built .app**

```bash
find /Users/aldoyh/Projects/AI/gemma-chat-public/out -name "*.app" -maxdepth 4 2>/dev/null; find /Users/aldoyh/Projects/AI/gemma-chat-public/dist -name "*.app" -maxdepth 4 2>/dev/null
```

Note the exact path for the next step.

- [ ] **Step 3: Replace the existing app in /Applications**

```bash
APP_PATH=$(find /Users/aldoyh/Projects/AI/gemma-chat-public/out /Users/aldoyh/Projects/AI/gemma-chat-public/dist -name "Gemma Chat.app" -maxdepth 4 2>/dev/null | head -1)
echo "Found: $APP_PATH"
rm -rf "/Applications/Gemma Chat.app"
cp -R "$APP_PATH" "/Applications/Gemma Chat.app"
echo "Installed."
```

- [ ] **Step 4: Launch the app**

```bash
open -a "Gemma Chat"
```

- [ ] **Step 5: Monitor for startup errors**

```bash
log stream --predicate 'process == "Gemma Chat"' --level debug 2>/dev/null &
LOG_PID=$!
sleep 15
kill $LOG_PID 2>/dev/null || true
```

Look for: Ollama connected, model loaded, no crash. If there are errors, read the output and fix the root cause.

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/specs/ docs/superpowers/plans/
git commit -m "docs: add ollama-first revision spec and implementation plan"
```
