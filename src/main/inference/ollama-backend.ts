import { OLLAMA_BASE_URL, isOllamaRunning, listOllamaModels } from '../ollama'
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

  async loadModel(
    modelName: string,
    _onProgress?: (p: { message: string; progress?: number }) => void
  ): Promise<void> {
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
        messages: opts.messages.map((m) => ({
          role: m.role === 'tool' ? 'user' : m.role,
          content: m.content
        })),
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
          if (data === '[DONE]') {
            yield { done: true }
            return
          }
          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{
                delta?: { content?: string }
                finish_reason?: string | null
              }>
            }
            const choice = parsed.choices?.[0]
            if (choice?.delta?.content) yield { content: choice.delta.content }
            if (choice?.finish_reason === 'stop' || choice?.finish_reason === 'length') {
              yield { done: true }
              return
            }
          } catch {
            /* skip malformed SSE events */
          }
        }
      }
    }
    yield { done: true }
  }
}
