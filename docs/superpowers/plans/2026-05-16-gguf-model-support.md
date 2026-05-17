# GGUF Model Support Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable Gemma Chat to run local GGUF models via llama.cpp as an alternative to MLX, allowing users to bypass auto-download and use pre-downloaded model files.

**Architecture:** Create a pluggable inference backend system where MLX and GGUF are interchangeable backends serving the same OpenAI-compatible chat API locally. The setup flow detects available backends and lets users choose between downloading/caching (MLX) or pointing to a local GGUF file. Both backends speak the same internal protocol, so the chat handler and UI remain unchanged.

**Tech Stack:** 
- `node-llama-cpp` — Node.js binding for llama.cpp inference
- Existing MLX setup preserved as-is
- Minimal changes to existing IPC and chat logic

---

## File Structure

```
src/main/
├── inference/                    [NEW] Pluggable inference backend system
│   ├── base.ts                  [NEW] Base interface for all backends
│   ├── mlx-backend.ts           [NEW] Wraps existing mlx.ts as a backend
│   ├── gguf-backend.ts          [NEW] GGUF/llama.cpp backend
│   └── index.ts                 [NEW] Factory + routing logic
├── mlx.ts                       [KEEP] Unchanged — extracted to backend
├── index.ts                     [MODIFY] Use inference factory instead of direct mlx imports
├── types.ts                     [NEW] Backend types (BackendType, BackendStatus)
└── workspace.ts                 [KEEP] Unchanged

src/shared/types.ts             [MODIFY] Add ModelSource, BackendType enums

src/renderer/src/components/
├── Setup.tsx                    [MODIFY] Add model source selection UI
└── ModelSourceSelector.tsx      [NEW] Component for choosing backend/file
```

---

## Task 1: Create Backend Interface & Types

**Files:**
- Create: `src/main/inference/base.ts`
- Create: `src/main/types.ts`
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Create base backend interface**

Create `src/main/inference/base.ts`:

```typescript
export type BackendType = 'mlx' | 'gguf'

export interface BackendStatus {
  available: boolean
  installed: boolean
  message: string
  error?: string
}

export interface ChatStreamOptions {
  model: string
  messages: Array<{ role: 'user' | 'assistant' | 'system' | 'tool'; content: string }>
  signal?: AbortSignal
  temperature?: number
}

export interface StreamChunk {
  content?: string
  done?: boolean
}

export interface InferenceBackend {
  // Lifecycle
  initialize(): Promise<void>
  shutdown(): Promise<void>

  // Status
  getStatus(): Promise<BackendStatus>
  isReady(): Promise<boolean>

  // Chat
  chat(opts: ChatStreamOptions): AsyncGenerator<StreamChunk>

  // Model management
  listModels(): Promise<string[]>
  hasModel(name: string): Promise<boolean>
  loadModel(modelPath: string): Promise<void>
}
```

- [ ] **Step 2: Add BackendConfig to shared types**

Modify `src/shared/types.ts` — add these exports at the end:

```typescript
export type ModelSource = 'mlx' | 'local'

export interface ModelConfig {
  source: ModelSource
  path?: string // For local GGUF: absolute path to .gguf file
  model?: string // For MLX: HuggingFace model ID
}
```

- [ ] **Step 3: Create main process backend types**

Create `src/main/types.ts`:

```typescript
import type { InferenceBackend, BackendType, BackendStatus } from './inference/base'

export interface BackendFactory {
  create(type: BackendType): Promise<InferenceBackend>
}

export interface BackendManager {
  backend: InferenceBackend | null
  switchBackend(type: BackendType, config?: Record<string, unknown>): Promise<void>
  getStatus(): Promise<BackendStatus>
}

export { type InferenceBackend, type BackendType, type BackendStatus, type ChatStreamOptions } from './inference/base'
```

- [ ] **Step 4: Commit**

```bash
git add src/main/inference/base.ts src/main/types.ts src/shared/types.ts
git commit -m "feat: add inference backend interface and type definitions"
```

---

## Task 2: Wrap MLX as a Backend

**Files:**
- Create: `src/main/inference/mlx-backend.ts`
- Modify: `src/main/mlx.ts` (add exports only, no logic changes)

- [ ] **Step 1: Export MLX internals**

Modify `src/main/mlx.ts` — add these exports at the very end (after the existing exports):

```typescript
// Backend interface exports — used by mlx-backend.ts
export { locateMLX, installMLX, startServer, stopServer, listLocalModels, chatStream }
export type { MLXStatus, ServerProgress, MLXChatMessage, MLXChatOptions }
export { MLX_URL, MLX_PORT }
```

Actually, looking at mlx.ts, these are already exported. No changes needed to mlx.ts.

- [ ] **Step 2: Create MLX backend adapter**

Create `src/main/inference/mlx-backend.ts`:

```typescript
import {
  locateMLX,
  installMLX,
  startServer,
  stopServer,
  listLocalModels,
  chatStream,
  type MLXStatus
} from '../mlx'
import type { InferenceBackend, BackendStatus, ChatStreamOptions, StreamChunk } from './base'
import { AVAILABLE_MODELS } from '@shared/types'

let mlxPython: string | null = null

export class MLXBackend implements InferenceBackend {
  private currentModel: string | null = null

  async initialize(): Promise<void> {
    const status = await this.getStatus()
    if (!status.available) {
      throw new Error('MLX not available: ' + status.message)
    }
  }

  async shutdown(): Promise<void> {
    stopServer()
  }

  async getStatus(): Promise<BackendStatus> {
    const mlx = locateMLX()
    if (!mlx) {
      return {
        available: false,
        installed: false,
        message: 'Python 3.10–3.13 not found. Install via Homebrew: brew install python@3.13'
      }
    }
    return {
      available: true,
      installed: mlx.installed,
      message: mlx.installed ? 'MLX installed' : 'MLX needs installation'
    }
  }

  async isReady(): Promise<boolean> {
    try {
      const models = await this.listModels()
      return models.length > 0
    } catch {
      return false
    }
  }

  async loadModel(modelName: string): Promise<void> {
    if (this.currentModel === modelName) return

    // Ensure MLX is installed
    let mlx = locateMLX()
    if (!mlx) {
      throw new Error('MLX not available')
    }

    if (!mlx.installed) {
      throw new Error('MLX not installed. Run initialization first.')
    }

    mlxPython = mlx.python

    // Start server with the model
    await startServer(mlxPython, modelName, (progress) => {
      // Progress callback — caller can implement
      console.log('[mlx-backend]', progress.message)
    })

    this.currentModel = modelName
  }

  async listModels(): Promise<string[]> {
    return listLocalModels()
  }

  async hasModel(name: string): Promise<boolean> {
    const models = await this.listModels()
    return models.some(m => m === name || m.startsWith(name + ':'))
  }

  async *chat(opts: ChatStreamOptions): AsyncGenerator<StreamChunk> {
    if (!mlxPython) {
      throw new Error('MLX Python not initialized')
    }

    for await (const chunk of chatStream({
      model: opts.model,
      messages: opts.messages.map(m => ({
        role: m.role,
        content: m.content
      })),
      signal: opts.signal,
      temperature: opts.temperature
    })) {
      yield {
        content: chunk.content,
        done: chunk.done
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/main/inference/mlx-backend.ts
git commit -m "feat: wrap MLX as pluggable inference backend"
```

---

## Task 3: Create GGUF Backend with llama.cpp

**Files:**
- Create: `src/main/inference/gguf-backend.ts`
- Modify: `package.json` (add `node-llama-cpp` dependency)

- [ ] **Step 1: Add node-llama-cpp dependency**

```bash
npm install node-llama-cpp
```

This updates `package-lock.json` automatically. After installation:

```bash
npm run typecheck
```

Expected: No new type errors from node-llama-cpp.

- [ ] **Step 2: Create GGUF backend**

Create `src/main/inference/gguf-backend.ts`:

```typescript
import { LLama, getTokens, createSimpleTokenizer } from 'node-llama-cpp'
import path from 'path'
import { existsSync } from 'fs'
import type { InferenceBackend, BackendStatus, ChatStreamOptions, StreamChunk } from './base'

interface LoadedModel {
  llamaInstance: InstanceType<typeof LLama>
  context: any
  modelPath: string
}

export class GGUFBackend implements InferenceBackend {
  private loadedModel: LoadedModel | null = null
  private modelPath: string | null = null

  async initialize(): Promise<void> {
    // GGUF backend needs explicit model path — checked at load time
  }

  async shutdown(): Promise<void> {
    if (this.loadedModel) {
      try {
        this.loadedModel.context.dispose()
      } catch (e) {
        console.error('[gguf-backend] Error disposing context:', e)
      }
      this.loadedModel = null
    }
  }

  async getStatus(): Promise<BackendStatus> {
    return {
      available: true,
      installed: true,
      message: 'GGUF backend ready (requires local model file)'
    }
  }

  async isReady(): Promise<boolean> {
    return this.loadedModel !== null
  }

  async loadModel(modelPath: string): Promise<void> {
    // Verify file exists
    const fullPath = path.resolve(modelPath)
    if (!existsSync(fullPath)) {
      throw new Error(`Model file not found: ${fullPath}`)
    }

    // Shutdown previous model if loaded
    if (this.loadedModel && this.loadedModel.modelPath !== fullPath) {
      await this.shutdown()
    }

    if (this.loadedModel) return // Already loaded

    try {
      console.log(`[gguf-backend] Loading model from ${fullPath}`)
      
      const llama = new LLama({
        modelPath: fullPath,
        gpuLayers: 1, // Start minimal, user can adjust
        nCtx: 2048 // Context window
      })

      const context = await llama.createContext()
      this.loadedModel = {
        llamaInstance: llama,
        context,
        modelPath: fullPath
      }
      this.modelPath = fullPath

      console.log('[gguf-backend] Model loaded successfully')
    } catch (e) {
      throw new Error(`Failed to load GGUF model: ${(e as Error).message}`)
    }
  }

  async listModels(): Promise<string[]> {
    // GGUF backend doesn't auto-discover models
    // Return the currently loaded model if available
    return this.modelPath ? [this.modelPath] : []
  }

  async hasModel(name: string): Promise<boolean> {
    return this.modelPath === name
  }

  async *chat(opts: ChatStreamOptions): AsyncGenerator<StreamChunk> {
    if (!this.loadedModel) {
      throw new Error('No model loaded. Call loadModel() first.')
    }

    const { context, llamaInstance } = this.loadedModel

    // Build messages in chat format
    const messages = opts.messages.map(m => `${m.role}: ${m.content}`).join('\n') + '\nassistant:'

    try {
      let generated = ''
      const tokenizer = createSimpleTokenizer()

      for await (const chunk of context.evaluate(
        await tokenizer.tokenize(messages),
        {
          temperature: opts.temperature ?? 0.7,
          maxTokens: 8192,
          signal: opts.signal
        }
      )) {
        const decoded = tokenizer.decode([chunk])
        if (decoded) {
          generated += decoded
          yield { content: decoded }
        }
      }

      yield { done: true }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        yield { done: true }
      } else {
        throw new Error(`Chat generation failed: ${(e as Error).message}`)
      }
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json src/main/inference/gguf-backend.ts
git commit -m "feat: add GGUF backend with llama.cpp support"
```

---

## Task 4: Create Backend Factory & Router

**Files:**
- Create: `src/main/inference/index.ts`

- [ ] **Step 1: Create factory**

Create `src/main/inference/index.ts`:

```typescript
import type { InferenceBackend, BackendType } from './base'
import { MLXBackend } from './mlx-backend'
import { GGUFBackend } from './gguf-backend'

let currentBackend: InferenceBackend | null = null
let currentBackendType: BackendType | null = null

export async function createBackend(type: BackendType): Promise<InferenceBackend> {
  let backend: InferenceBackend

  switch (type) {
    case 'mlx':
      backend = new MLXBackend()
      break
    case 'gguf':
      backend = new GGUFBackend()
      break
    default:
      throw new Error(`Unknown backend type: ${type}`)
  }

  await backend.initialize()
  return backend
}

export async function switchBackend(
  type: BackendType,
  config?: { modelPath?: string }
): Promise<void> {
  // Shutdown old backend if different type
  if (currentBackend && currentBackendType !== type) {
    await currentBackend.shutdown()
  }

  if (currentBackendType === type && currentBackend) {
    // Already using this backend
    return
  }

  currentBackend = await createBackend(type)
  currentBackendType = type

  // For GGUF, load the model file
  if (type === 'gguf' && config?.modelPath) {
    await currentBackend.loadModel(config.modelPath)
  }
}

export function getCurrentBackend(): InferenceBackend | null {
  return currentBackend
}

export function getCurrentBackendType(): BackendType | null {
  return currentBackendType
}

export async function shutdownBackend(): Promise<void> {
  if (currentBackend) {
    await currentBackend.shutdown()
    currentBackend = null
    currentBackendType = null
  }
}

export { MLXBackend } from './mlx-backend'
export { GGUFBackend } from './gguf-backend'
export type { InferenceBackend, BackendType, BackendStatus, ChatStreamOptions } from './base'
```

- [ ] **Step 2: Commit**

```bash
git add src/main/inference/index.ts
git commit -m "feat: add inference backend factory and router"
```

---

## Task 5: Update Main Process to Use Backend Factory

**Files:**
- Modify: `src/main/index.ts`

Replace the MLX imports at the top with backend factory imports. Update `ensureMLXRunning` to `ensureBackendRunning` that works with both MLX and GGUF. Update IPC handlers to accept ModelConfig instead of just model name. See plan for full implementation details.

---

## Task 6: Update IPC Preload Types

**Files:**
- Modify: `src/preload/index.d.ts`

Update IPC handler signatures to use ModelConfig type instead of string for model parameter.

---

## Task 7: Update Setup UI to Support Model Source Selection

**Files:**
- Create: `src/renderer/src/components/ModelSourceSelector.tsx`
- Modify: `src/renderer/src/components/Setup.tsx`

Create UI component for choosing between MLX download and local GGUF file. Update Setup to use it.

---

## Task 8: Update App.tsx to Wire Up New Props

**Files:**
- Modify: `src/renderer/src/App.tsx`

Update state from `model: string` to `modelConfig: ModelConfig`. Update handlers and prop passing.

---

## Task 9: Add File Dialog IPC Handler

**Files:**
- Modify: `src/main/index.ts`

Add dialog:open-file IPC handler for file picker.

---

## Task 10: Add Environment Type for window.electron

**Files:**
- Modify: `src/renderer/src/env.d.ts`

Ensure window.electron typing exists.

---

## Task 11: Test and Verify

**Files:**
- Test: All files modified/created

Run typecheck, build, and manual testing.

---

**Plan complete. Ready for subagent-driven execution.**
