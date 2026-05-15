import { useEffect, useState } from 'react'
import { DEFAULT_MODEL, type SetupStatus } from '@shared/types'
import Setup from './components/Setup'
import Chat from './components/Chat'
import { I18nProvider } from './i18n/useI18n'
import type { Language } from './i18n/useI18n'

type AppState =
  | { phase: 'boot' }
  | { phase: 'setup'; status: SetupStatus; model: string }
  | { phase: 'ready'; model: string; activityState: 'idle' | 'thinking' | 'generating' }
  | { phase: 'switching'; model: string; toModel: string; status: SetupStatus }

function AppContent() {
  const [state, setState] = useState<AppState>({ phase: 'boot' })
  const [activityState, setActivityState] = useState<'idle' | 'thinking' | 'generating'>('idle')

  const handleActivityChange = (newState: 'idle' | 'thinking' | 'generating') => {
    setActivityState(newState)
  }

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
              return { phase: 'ready', model: prev.toModel, activityState: 'idle' }
            }
            return { phase: 'ready', model: prev.phase === 'setup' ? prev.model : DEFAULT_MODEL, activityState: 'idle' }
          }
          if (status.stage === 'error') {
            // If switch failed, go back to the previous model
            if (prev.phase === 'switching') {
              return { phase: 'ready', model: prev.model, activityState: 'idle' }
            }
          }
          // If we're in switching phase, keep it as switching
          if (prev.phase === 'switching') {
            return { ...prev, status }
          }
          const model = prev.phase === 'setup' ? prev.model : DEFAULT_MODEL
          return { phase: 'setup', status, model }
        })
      })

      const local = await window.api.listLocalModels()
      const hasDefault = local.some(
        (m) => m === DEFAULT_MODEL || m.startsWith(DEFAULT_MODEL + ':')
      )
      if (hasDefault) {
        const { hasMLX } = await window.api.checkMLX()
        if (hasMLX) {
          setState({
            phase: 'setup',
            status: { stage: 'starting-mlx', message: 'Starting model runtime…' },
            model: DEFAULT_MODEL
          })
          window.api.startSetup(DEFAULT_MODEL)
          return
        }
      }
      setState({
        phase: 'setup',
        status: { stage: 'checking', message: 'Welcome' },
        model: DEFAULT_MODEL
      })
    })()
    return () => {
      unsub?.()
      rawUnsub?.()
    }
  }, [])

  function handleSwitchModel(newModel: string): void {
    setState((prev) => {
      if (prev.phase !== 'ready') return prev
      if (prev.model === newModel) return prev
      return {
        phase: 'switching',
        model: prev.model,
        toModel: newModel,
        status: { stage: 'downloading-model', message: 'Switching model…' }
      }
    })
    window.api.switchModel(newModel)
  }

  if (state.phase === 'boot') {
    return <BootSplash />
  }

  if (state.phase === 'setup') {
    return (
      <div key="setup" className="anim-fade-in h-full w-full">
        <Setup
          status={state.status}
          model={state.model}
          onModelChange={(m) =>
            setState((s) => (s.phase === 'setup' ? { ...s, model: m } : s))
          }
          onStart={(model) => {
            setState({
              phase: 'setup',
              status: { stage: 'checking', message: 'Checking system…' },
              model
            })
            window.api.startSetup(model)
          }}
        />
      </div>
    )
  }

  if (state.phase === 'switching') {
    return (
      <div key="switching" className="anim-fade-in h-full w-full">
        <Chat model={state.model} onSwitchModel={handleSwitchModel} onActivityChange={handleActivityChange} />
        <SwitchingOverlay status={state.status} />
      </div>
    )
  }

  return (
    <div key="chat" className="anim-fade-scale h-full w-full">
      <Chat model={state.model} onSwitchModel={handleSwitchModel} onActivityChange={handleActivityChange} />
    </div>
  )
}

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  )
}

function BootSplash() {
  return (
    <div className="drag flex h-full w-full items-center justify-center bg-gradient-to-b from-ink-950 via-ink-900 to-black">
      <div className="flex flex-col items-center gap-8">
        <svg viewBox="0 0 200 200" className="h-32 w-32 drop-shadow-lg" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <style>{`
              @keyframes pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
              @keyframes rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
              @keyframes scale { 0%, 100% { transform: scale(0.8); } 50% { transform: scale(1.2); } }
              .dot { animation: pulse 1.5s ease-in-out infinite; }
              .ring { animation: rotate 3s linear infinite; }
              .center { animation: scale 2s ease-in-out infinite; }
            `}</style>
          </defs>
          <circle cx="100" cy="100" r="90" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="2"/>
          <circle cx="100" cy="100" r="70" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" className="ring" strokeDasharray="20 10" strokeLinecap="round"/>
          <circle cx="100" cy="100" r="40" fill="rgba(255,255,255,0.1)" className="center"/>
          <g className="ring">
            <circle cx="100" cy="40" r="4" fill="rgba(255,255,255,0.6)"/>
            <circle cx="160" cy="100" r="4" fill="rgba(255,255,255,0.6)"/>
            <circle cx="100" cy="160" r="4" fill="rgba(255,255,255,0.6)"/>
            <circle cx="40" cy="100" r="4" fill="rgba(255,255,255,0.6)"/>
          </g>
          <circle cx="100" cy="100" r="6" fill="rgba(255,255,255,0.8)" className="dot"/>
        </svg>
        <p className="text-sm text-ink-400">Loading Gemma Chat…</p>
      </div>
    </div>
  )
}

function SwitchingOverlay({ status }: { status: SetupStatus }) {
  return (
    <div className="anim-fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="anim-fade-up flex flex-col items-center gap-4 rounded-2xl border border-white/10 bg-ink-950 px-10 py-8 shadow-2xl">
        <div className="shimmer h-1 w-32 rounded-full" />
        <p className="text-sm text-ink-200">{status.message}</p>
        {status.progress != null && status.progress > 0 && (
          <div className="w-48">
            <div className="h-1 w-full rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-white/60 transition-all duration-500"
                style={{ width: `${Math.round(status.progress * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-[10px] tabular-nums text-ink-400">
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
