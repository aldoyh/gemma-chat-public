import {
  locateMLX,
  installMLX,
  startServer,
  stopServer,
  listLocalModels,
  chatStream
} from '../mlx'
import type { InferenceBackend, BackendStatus, ChatStreamOptions, BackendStreamChunk } from './base'

export class MLXBackend implements InferenceBackend {
  private currentModel: string | null = null
  private mlxPython: string | null = null

  async initialize(): Promise<void> {
    const status = await this.getStatus()
    if (!status.available) {
      throw new Error('MLX initialization failed: ' + status.message)
    }
    // We allow initialization even if not installed yet,
    // so that we can call install() later.
  }

  async shutdown(): Promise<void> {
    await stopServer()
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

  async install(onProgress: (progress: { stage: string; message: string }) => void): Promise<void> {
    await installMLX((p) => {
      onProgress({
        stage: 'installing-mlx',
        message: p.message
      })
    })
  }

  async loadModel(
    modelName: string,
    onProgress?: (progress: {
      message: string
      progress?: number
      remainingSeconds?: number
      totalSeconds?: number
    }) => void
  ): Promise<void> {
    if (this.currentModel === modelName) return

    // Ensure MLX is installed
    let mlx = locateMLX()
    if (!mlx) {
      throw new Error('MLX not available')
    }

    if (!mlx.installed) {
      throw new Error('MLX not installed. Run initialization first.')
    }

    this.mlxPython = mlx.python

    // Start server with the model
    await startServer(this.mlxPython, modelName, (progress) => {
      if (onProgress) {
        onProgress({
          message: progress.message,
          progress: progress.progress,
          remainingSeconds: progress.remainingSeconds,
          totalSeconds: progress.totalSeconds
        })
      }
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

  async *chat(opts: ChatStreamOptions): AsyncGenerator<BackendStreamChunk> {
    if (!this.mlxPython || !this.currentModel) {
      throw new Error('No model loaded. Call loadModel() before chat.')
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
