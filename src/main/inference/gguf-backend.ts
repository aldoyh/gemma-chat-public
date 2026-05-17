import { getLlama, type Llama, type LlamaModel, type LlamaContext, LlamaChatSession } from 'node-llama-cpp'
import path from 'path'
import { existsSync } from 'fs'
import type { InferenceBackend, BackendStatus, ChatStreamOptions, BackendStreamChunk } from './base'

interface LoadedModel {
  llama: Llama
  model: LlamaModel
  context: LlamaContext
  modelPath: string
}

export class GGUFBackend implements InferenceBackend {
  private loadedModel: LoadedModel | null = null
  private modelPath: string | null = null

  async initialize(): Promise<void> {
    try {
      await getLlama()
    } catch (e) {
      console.log('[gguf-backend] Warning: getLlama not ready:', (e as Error).message)
    }
  }

  async shutdown(): Promise<void> {
    if (this.loadedModel) {
      try {
        if (this.loadedModel.context) {
          await this.loadedModel.context.dispose()
        }
      } catch (e) {
        console.error('[gguf-backend] Error disposing context:', e)
      }

      try {
        if (this.loadedModel.model) {
          await this.loadedModel.model.dispose()
        }
      } catch (e) {
        console.error('[gguf-backend] Error disposing model:', e)
      }

      this.loadedModel = null
      this.modelPath = null
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

  async install(_onProgress: (progress: { stage: string; message: string }) => void): Promise<void> {
    // GGUF backend uses node-llama-cpp which is installed via npm
    return
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
    const fullPath = path.resolve(modelPath)
    if (!existsSync(fullPath)) {
      throw new Error(`Model file not found: ${fullPath}`)
    }

    if (this.loadedModel && this.loadedModel.modelPath !== fullPath) {
      await this.shutdown()
    }

    if (this.loadedModel && this.loadedModel.modelPath === fullPath) {
      return
    }

    try {
      console.log(`[gguf-backend] Loading model from ${fullPath}`)

      const llama = await getLlama()

      const model = await llama.loadModel({
        modelPath: fullPath
      })

      const context = await model.createContext()

      this.loadedModel = {
        llama,
        model,
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
    return this.modelPath ? [this.modelPath] : []
  }

  async hasModel(name: string): Promise<boolean> {
    return this.modelPath === name
  }

  async *chat(opts: ChatStreamOptions): AsyncGenerator<BackendStreamChunk> {
    if (!this.loadedModel) {
      throw new Error('No model loaded. Call loadModel() first.')
    }

    const { context } = this.loadedModel

    try {
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        autoDisposeSequence: true
      })

      // Convert messages to node-llama-cpp format
      // Note: LlamaChatSession manages the history, but here we provide the whole context
      // as it's a stateless call from the perspective of this backend method.
      const history = opts.messages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content
      }))

      // The last message is usually the user prompt if we want to use session.prompt()
      // or we can set the history and call prompt() with the last message.
      const lastMessage = history[history.length - 1]
      const previousHistory = history.slice(0, -1)

      session.setChatHistory(previousHistory)

      const iterator = await session.promptWithStream(lastMessage.content, {
        temperature: opts.temperature ?? 0.7,
        signal: opts.signal
      })

      for await (const chunk of iterator) {
        yield { content: chunk }
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

