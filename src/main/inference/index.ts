import type { InferenceBackend, BackendType } from './base'
import { MLXBackend } from './mlx-backend'
import { GGUFBackend } from './gguf-backend'
import { OllamaBackend } from './ollama-backend'

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
    case 'ollama':
      backend = new OllamaBackend()
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
export { OllamaBackend } from './ollama-backend'
export type { InferenceBackend, BackendType, BackendStatus, ChatStreamOptions, BackendStreamChunk } from './base'
