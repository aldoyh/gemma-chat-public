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
