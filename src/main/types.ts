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
