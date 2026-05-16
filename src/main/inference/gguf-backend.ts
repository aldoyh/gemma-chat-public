import { getLlama, type Llama } from 'node-llama-cpp'
import path from 'path'
import { existsSync } from 'fs'
import type { InferenceBackend, BackendStatus, ChatStreamOptions, BackendStreamChunk } from './base'

interface LoadedModel {
  llama: Llama
  model: any // The loaded model instance
  context: any // The inference context
  modelPath: string
}

export class GGUFBackend implements InferenceBackend {
  private loadedModel: LoadedModel | null = null
  private modelPath: string | null = null

  async initialize(): Promise<void> {
    // GGUF backend initialization - mostly just prepares getLlama
    try {
      await getLlama()
    } catch (e) {
      console.log('[gguf-backend] Warning: getLlama not ready:', (e as Error).message)
    }
  }

  async shutdown(): Promise<void> {
    if (this.loadedModel) {
      try {
        // Dispose context first
        if (this.loadedModel.context) {
          this.loadedModel.context.dispose()
        }
      } catch (e) {
        console.error('[gguf-backend] Error disposing context:', e)
      }

      try {
        // Dispose model
        if (this.loadedModel.model) {
          this.loadedModel.model.dispose()
        }
      } catch (e) {
        console.error('[gguf-backend] Error disposing model:', e)
      }

      try {
        // Dispose Llama instance
        await this.loadedModel.llama.dispose()
      } catch (e) {
        console.error('[gguf-backend] Error disposing Llama:', e)
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

  async loadModel(modelPath: string): Promise<void> {
    // Verify file exists
    const fullPath = path.resolve(modelPath)
    if (!existsSync(fullPath)) {
      throw new Error(`Model file not found: ${fullPath}`)
    }

    // Shutdown previous model if different path
    if (this.loadedModel && this.loadedModel.modelPath !== fullPath) {
      await this.shutdown()
    }

    if (this.loadedModel && this.loadedModel.modelPath === fullPath) {
      return // Already loaded
    }

    try {
      console.log(`[gguf-backend] Loading model from ${fullPath}`)

      const llama = await getLlama({
        gpu: 'auto'
      })

      // Load the model once and keep it in memory
      const model = await llama.loadModel({
        modelPath: fullPath
      })

      // Create a persistent context for inference
      const context = await model.createContext({
        sequences: 1,
        threads: 4
      })

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
    // GGUF backend doesn't auto-discover models
    // Return the currently loaded model if available
    return this.modelPath ? [this.modelPath] : []
  }

  async hasModel(name: string): Promise<boolean> {
    return this.modelPath === name
  }

  async *chat(opts: ChatStreamOptions): AsyncGenerator<BackendStreamChunk> {
    if (!this.loadedModel) {
      throw new Error('No model loaded. Call loadModel() first.')
    }

    const { model, context } = this.loadedModel

    // Build messages in chat format
    const messages = opts.messages.map(m => `${m.role}: ${m.content}`).join('\n') + '\nassistant:'

    try {
      // Get a sequence for generation
      const sequence = context.getSequence()

      // Tokenize the messages
      const tokens = model.tokenize(messages)

      // Generate response
      for await (const token of sequence.evaluate(tokens, {
        temperature: opts.temperature ?? 0.7
      })) {
        // Check for abort signal
        if (opts.signal?.aborted) {
          break
        }

        const text = model.detokenize([token])
        if (text) {
          yield { content: text }
        }
      }

      yield { done: true }

      // Cleanup only the sequence, not the context (reuse it)
      sequence.dispose()
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        yield { done: true }
      } else {
        throw new Error(`Chat generation failed: ${(e as Error).message}`)
      }
    }
  }
}
