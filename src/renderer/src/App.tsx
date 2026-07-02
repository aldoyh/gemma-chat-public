import { useEffect, useState } from 'react'
import { DEFAULT_MODEL, type SetupStatus, type ModelConfig } from '@shared/types'
import Setup from './components/Setup'
import Chat from './components/Chat'
import { I18nProvider } from './i18n/useI18n'

type AppState =
  | { phase: 'boot' }
  | { phase: 'setup'; status: SetupStatus; modelConfig: ModelConfig }
  | { phase: 'ready'; modelConfig: ModelConfig }
  | { phase: 'switching'; modelConfig: ModelConfig; toModelConfig: ModelConfig; status: SetupStatus }

function AppContent() {
  const [state, setState] = useState<AppState>({ phase: 'boot' })

  useEffect(() => {
    // Forward raw Gemma output to devtools console for debugging
    const rawUnsub = window.api.onRawChunk((ev) => {
      // eslint-disable-next-line no-console
      console.log('[gemma]', ev.chunk)
    })
    let unsub: (() => void) | undefined
    ;(async () => {
      unsub = window.api.onSetupStatus((status) => {
        setState((prev) => {
          if (status.stage === 'ready') {
            // If we were switching, the new model is now ready
            if (prev.phase === 'switching') {
              const nextState: AppState = { phase: 'ready', modelConfig: prev.toModelConfig }
              return nextState
            }
            const defaultConfig: ModelConfig = { source: 'mlx', model: DEFAULT_MODEL }
            const nextState: AppState = { phase: 'ready', modelConfig: prev.phase === 'setup' ? prev.modelConfig : defaultConfig }
            return nextState
          }
          if (status.stage === 'error') {
            // If switch failed, go back to the previous model
            if (prev.phase === 'switching') {
              const nextState: AppState = { phase: 'ready', modelConfig: prev.modelConfig }
              return nextState
            }
          }
          // If we're in switching phase, keep it as switching
          if (prev.phase === 'switching') {
            return { ...prev, status }
          }
          const defaultConfig: ModelConfig = { source: 'mlx', model: DEFAULT_MODEL }
          const modelConfig = prev.phase === 'setup' ? prev.modelConfig : defaultConfig
          const nextState: AppState = { phase: 'setup', status, modelConfig }
          return nextState
        })
      })

      // 1. Check Ollama first. Do not auto-start a model from boot; local models
      // can be large enough to lock up the machine if selected accidentally.
      const { running } = await window.api.checkOllama()
      if (running) {
        const ollamaModels = await window.api.listOllamaModels()
        const firstModel = ollamaModels[0]?.name
        if (firstModel) {
          const ollamaConfig: ModelConfig = { source: 'ollama', model: firstModel }
          setState({
            phase: 'setup',
            status: { stage: 'checking', message: 'Welcome' },
            modelConfig: ollamaConfig
          })
          return
        }
      }

      // 2. Fall back to original MLX check
      const local = await window.api.listLocalModels()
      const hasDefault = local.some(
        (m) => m === DEFAULT_MODEL || m.startsWith(DEFAULT_MODEL + ':')
      )
      const defaultConfig: ModelConfig = { source: 'mlx', model: DEFAULT_MODEL }
      if (hasDefault) {
        const { hasMLX } = await window.api.checkMLX()
        if (hasMLX) {
          setState({
            phase: 'setup',
            status: { stage: 'starting-mlx', message: 'Starting model runtime…' },
            modelConfig: defaultConfig
          })
          window.api.startSetup(defaultConfig)
          return
        }
      }
      setState({
        phase: 'setup',
        status: { stage: 'checking', message: 'Welcome' },
        modelConfig: defaultConfig
      })
    })()
    return () => {
      unsub?.()
      rawUnsub?.()
    }
  }, [])

  function handleSwitchModel(newModelConfig: ModelConfig): void {
    setState((prev) => {
      if (prev.phase !== 'ready') return prev
      if (prev.modelConfig.source === newModelConfig.source && prev.modelConfig.model === newModelConfig.model) return prev
      return {
        phase: 'switching',
        modelConfig: prev.modelConfig,
        toModelConfig: newModelConfig,
        status: { stage: 'downloading-model', message: 'Switching model…' }
      }
    })
    window.api.switchModel(newModelConfig)
  }

  if (state.phase === 'boot') {
    return <BootSplash />
  }

  if (state.phase === 'setup') {
    return (
      <div key="setup" className="anim-fade-in h-full w-full">
        <Setup
          status={state.status}
          modelConfig={state.modelConfig}
          onConfigChange={(config) =>
            setState((s) => (s.phase === 'setup' ? { ...s, modelConfig: config } : s))
          }
          onStart={(config) => {
            setState({
              phase: 'setup',
              status: { stage: 'checking', message: 'Checking system…' },
              modelConfig: config
            })
            window.api.startSetup(config)
          }}
        />
      </div>
    )
  }

  if (state.phase === 'switching') {
    return (
      <div key="switching" className="anim-fade-in h-full w-full">
        <Chat modelConfig={state.modelConfig} onSwitchModel={handleSwitchModel} />
        <SwitchingOverlay status={state.status} />
      </div>
    )
  }

  return (
    <div key="chat" className="anim-fade-scale h-full w-full">
      <Chat modelConfig={state.modelConfig} onSwitchModel={handleSwitchModel} />
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <div className="relative h-full w-full overflow-hidden">
        <AppBackdrop />
        <AppContent />
      </div>
    </I18nProvider>
  )
}

function AppBackdrop() {
  return (
    <div className="app-backdrop">
      <div className="app-orb app-orb--one" />
      <div className="app-orb app-orb--two" />
      <div className="app-orb app-orb--three" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.08),_transparent_30%),radial-gradient(circle_at_50%_110%,_rgba(255,255,255,0.05),_transparent_24%)] opacity-80" />
    </div>
  )
}

function BootSplash() {
  return (
    <div className="drag anim-fade-in flex h-full w-full items-center justify-center bg-gradient-to-b from-ink-950 via-ink-900 to-black">
      <div className="anim-fade-up flex flex-col items-center gap-8">
        <svg viewBox="0 0 200 200" className="h-32 w-32 drop-shadow-[0_0_24px_rgba(255,255,255,0.15)]" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <filter id="boot-glow" x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            <style>{`
              @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
              @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
              @keyframes scale { 0%, 100% { transform: scale(0.8); } 50% { transform: scale(1.15); opacity: 0.85; } }
              .dot { animation: pulse 1.5s ease-in-out infinite; }
              .ring { animation: rotate 3s linear infinite; transform-origin: 100px 100px; }
              .center { animation: scale 2s ease-in-out infinite; transform-origin: 100px 100px; }
            `}</style>
          </defs>
          <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2"/>
          <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" className="ring" strokeDasharray="20 10" strokeLinecap="round"/>
          <circle cx="100" cy="100" r="40" fill="rgba(255,255,255,0.12)" className="center" filter="url(#boot-glow)"/>
          <g className="ring">
            <circle cx="100" cy="40" r="4" fill="rgba(255,255,255,0.7)" filter="url(#boot-glow)"/>
            <circle cx="160" cy="100" r="4" fill="rgba(255,255,255,0.7)" filter="url(#boot-glow)"/>
            <circle cx="100" cy="160" r="4" fill="rgba(255,255,255,0.7)" filter="url(#boot-glow)"/>
            <circle cx="40" cy="100" r="4" fill="rgba(255,255,255,0.7)" filter="url(#boot-glow)"/>
          </g>
          <circle cx="100" cy="100" r="6" fill="rgba(255,255,255,0.9)" className="dot" filter="url(#boot-glow)"/>
        </svg>
        <p className="shimmer-text text-sm">Loading Gemma Chat…</p>
      </div>
    </div>
  )
}

function SwitchingOverlay({ status }: { status: SetupStatus }) {
  return (
    <div className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="anim-fade-up flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-ink-950 px-10 py-8 shadow-2xl">
        <div className="shimmer h-1.5 w-32 rounded-full shadow-[0_0_12px_rgba(255,255,255,0.25)]" />
        <p className="shimmer-text text-sm">{status.message}</p>
        {status.progress != null && status.progress > 0 && (
          <div className="w-48">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.4)] transition-all duration-500"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] tabular-nums text-ink-400">
              <span>{Math.round(status.progress * 100)}%</span>
              {status.remainingSeconds != null && (
                <span>{Math.ceil(status.remainingSeconds)}s remaining</span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
