/// <reference types="vite/client" />

import type { Api } from '../../preload'

declare global {
  interface Window {
    api: Api
    // Alternative IPC interface for Electron conventions
    electron?: {
      ipcRenderer: {
        invoke: (channel: string, ...args: any[]) => Promise<any>
        on: (channel: string, listener: (...args: any[]) => void) => void
        off: (channel: string, listener: (...args: any[]) => void) => void
      }
    }
  }
}

export {}
