import type { InferenceBackend, BackendStatus, ChatStreamOptions, BackendStreamChunk } from './base'

/**
 * GGUF backend is intentionally a stub in this build. We previously depended on
 * `node-llama-cpp`, but that package is unmaintained and we now route all
 * local inference through the MLX (HuggingFace) or Ollama backends. The class
 * is kept so the type registry stays stable; selecting the GGUF source
 * surfaces a clear, actionable error rather than crashing on import.
 */
export class GGUFBackend implements InferenceBackend {
  private modelPath: string | null = null

  async initialize(): Promise<void> {
    throw new Error(
      'Local GGUF inference is not available in this build. Use the MLX (HuggingFace) or Ollama backend instead.'
    )
  }

  async shutdown(): Promise<void> {
    this.modelPath = null
  }

  async getStatus(): Promise<BackendStatus> {
    return {
      available: false,
      installed: false,
      message: 'GGUF backend disabled — use MLX or Ollama.'
    }
  }

  async isReady(): Promise<boolean> {
    return false
  }

  async install(
    _onProgress: (progress: { stage: string; message: string }) => void
  ): Promise<void> {
    throw new Error('GGUF backend is not available. Choose MLX or Ollama.')
  }

  async loadModel(
    modelPath: string,
    _onProgress?: (progress: {
      message: string
      progress?: number
      remainingSeconds?: number
      totalSeconds?: number
    }) => void
  ): Promise<void> {
    this.modelPath = modelPath
    throw new Error(
      'GGUF backend is not available. Pick a model from the MLX or Ollama list.'
    )
  }

  async listModels(): Promise<string[]> {
    return this.modelPath ? [this.modelPath] : []
  }

  async hasModel(name: string): Promise<boolean> {
    return this.modelPath === name
  }

  async *chat(_opts: ChatStreamOptions): AsyncGenerator<BackendStreamChunk> {
    throw new Error('GGUF backend is not available. Switch to MLX or Ollama.')
  }
}
