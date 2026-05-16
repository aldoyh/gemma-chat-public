import type { Api } from './index'
import type { ModelConfig } from '../shared/types'

declare global {
  interface Window {
    api: Api
  }
}

export type { Api, ModelConfig }
