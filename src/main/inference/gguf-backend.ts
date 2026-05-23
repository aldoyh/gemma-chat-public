import path from 'path'
import { existsSync } from 'fs'
import type { InferenceBackend, BackendStatus, ChatStreamOptions, BackendStreamChunk } from './base'

// Types only — actual module loaded dynamically to avoid startup crash
type NodeLlamaCppModule = typeof import('node-llama-cpp')
type Llama = Awaited<ReturnType<NodeLlamaCppModule['getLlama']>>
type LlamaModel = Awaited<ReturnType<Llama['loadModel']>>
type LlamaContext = Awaited<ReturnType<LlamaModel['createContext']>>
type ChatHistoryItem = import('node-llama-cpp').ChatHistoryItem

interface LoadedModel {
  llama: Llama
  model: LlamaModel
  context: LlamaContext
  modelPath: string
}

let llamaCppModule: NodeLlamaCppModule | null = null

async function getLlamaCpp(): Promise<NodeLlamaCppModule> {
  if (!llamaCppModule) {
    llamaCppModule = await import('node-llama-cpp') as NodeLlamaCppModule
  }
  return llamaCppModule
}

export class GGUFBackend implements InferenceBackend {
  private loadedModel: LoadedModel | null = null
  private modelPath: string | null = null

  async initialize(): Promise<void> {
    try {
      const { getLlama } = await getLlamaCpp()
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

      const { getLlama } = await getLlamaCpp()
      const llama = await getLlama()
      const model = await llama.loadModel({ modelPath: fullPath })
      const context = await model.createContext()

      this.loadedModel = { llama, model, context, modelPath: fullPath }
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

    const { LlamaChatSession } = await getLlamaCpp()
    const { context } = this.loadedModel

    try {
      const session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        autoDisposeSequence: true
      })

      const allMessages = opts.messages
      const lastUserMsg = allMessages[allMessages.length - 1]

      const previousHistory: ChatHistoryItem[] = allMessages.slice(0, -1).map(m => {
        if (m.role === 'system') {
          return { type: 'system' as const, text: m.content }
        } else if (m.role === 'assistant') {
          return { type: 'model' as const, response: [m.content] }
        } else {
          return { type: 'user' as const, text: m.content }
        }
      })

      session.setChatHistory(previousHistory)

      // Async queue for real-time streaming via onTextChunk callback
      const chunkQueue: string[] = []
      let generationDone = false
      let notifyNext: (() => void) | null = null

      const promptPromise = session.promptWithMeta(lastUserMsg.content, {
        temperature: opts.temperature ?? 0.7,
        signal: opts.signal,
        onTextChunk: (text: string) => {
          chunkQueue.push(text)
          notifyNext?.()
          notifyNext = null
        }
      })

      promptPromise
        .then(() => {
          generationDone = true
          notifyNext?.()
          notifyNext = null
        })
        .catch(() => {
          generationDone = true
          notifyNext?.()
          notifyNext = null
        })

      while (true) {
        if (chunkQueue.length > 0) {
          yield { content: chunkQueue.shift()! }
        } else if (generationDone) {
          break
        } else {
          await new Promise<void>(resolve => {
            notifyNext = resolve
          })
        }
      }

      await promptPromise
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
