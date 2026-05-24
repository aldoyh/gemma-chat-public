export type BackendType = 'mlx' | 'gguf' | 'ollama'

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

export interface BackendStreamChunk {
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
  install(onProgress: (progress: { stage: string; message: string }) => void): Promise<void>

  // Chat
  chat(opts: ChatStreamOptions): AsyncGenerator<BackendStreamChunk>

  // Model management
  listModels(): Promise<string[]>
  hasModel(name: string): Promise<boolean>
  loadModel(
    modelPath: string,
    onProgress?: (progress: {
      message: string
      progress?: number
      remainingSeconds?: number
      totalSeconds?: number
    }) => void
  ): Promise<void>
}
