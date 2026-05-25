import { useState } from 'react'
import { AVAILABLE_MODELS, type SetupStatus, type ModelConfig } from '@shared/types'
import { useI18n } from '../i18n/useI18n'
import LanguageSwitcher from './LanguageSwitcher'
import gemmaLogoUrl from '../assets/gemma-logo.png'
import AutoSelectNotification from './AutoSelectNotification'
import ModelSourceSelector from './ModelSourceSelector'

interface Props {
  status: SetupStatus
  modelConfig: ModelConfig
  onConfigChange: (config: ModelConfig) => void
  onStart: (config: ModelConfig) => void
}

function formatBytes(n?: number): string {
  if (!n) return ''
  const u = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = n
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`
}

export default function Setup({ status, modelConfig, onConfigChange, onStart }: Props) {
  const { t, language } = useI18n()
  const isWorking =
    status.stage === 'checking' ||
    status.stage === 'installing-mlx' ||
    status.stage === 'starting-mlx' ||
    status.stage === 'downloading-model'

  if (status.stage === 'checking' && status.message === 'Welcome') {
    return <WelcomeScreen modelConfig={modelConfig} onConfigChange={onConfigChange} onStart={onStart} />
  }

  return (
    <div className={`drag flex h-full w-full flex-col bg-gradient-to-b from-ink-950 via-ink-900 to-black ${language === 'ar' ? 'rtl' : ''}`}>
      <div className="flex h-9 items-center justify-end px-8">
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="no-drag w-full max-w-sm">
          {/* Logo with ambient glow */}
          <div className="mb-10 flex flex-col items-center text-center">
            <div className="relative mb-6">
              <div className="absolute inset-0 rounded-full bg-white/10 blur-2xl scale-150" />
              <GemmaLogo className="relative h-16 w-16 drop-shadow-lg" />
            </div>
            <h1 className={`text-xl font-semibold tracking-tight text-white ${language === 'ar' ? 'font-tajawal' : ''}`}>
              {t.setup.settingUp}
            </h1>
            <p className={`mt-1 text-[13px] text-ink-400 ${language === 'ar' ? 'font-tajawal' : ''}`}>
              {t.setup.allLocal}
            </p>
          </div>

          {/* Stage checklist */}
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-5">
            <StageList status={status} />

            {isWorking && status.progress != null && (
              <div className="mt-5 border-t border-white/[0.07] pt-4">
                <div className="h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-white/70 transition-[width] duration-300 ease-out"
                    style={{ width: `${Math.max(2, Math.round((status.progress ?? 0) * 100))}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between text-[11px] tabular-nums text-ink-400">
                  <span>{Math.round((status.progress ?? 0) * 100)}%</span>
                  {status.remainingSeconds != null ? (
                    <span>{Math.ceil(status.remainingSeconds)}s left</span>
                  ) : status.bytesDone != null && status.bytesTotal != null ? (
                    <span>{formatBytes(status.bytesDone)} / {formatBytes(status.bytesTotal)}</span>
                  ) : null}
                </div>
              </div>
            )}
          </div>

          {status.stage === 'error' && (
            <div className={`mt-4 rounded-xl border border-red-500/25 bg-red-500/[0.08] p-4 text-sm text-red-300 ${language === 'ar' ? 'font-tajawal text-right' : ''}`}>
              <div className="font-medium">{t.setup.error}</div>
              <div className="mt-1 text-[13px] text-red-300/70 leading-relaxed">{status.error}</div>
              <button
                onClick={() => onStart(modelConfig)}
                className={`mt-3 rounded-lg border border-white/10 bg-white/[0.05] px-3 py-1.5 text-xs transition hover:bg-white/10 ${language === 'ar' ? 'font-tajawal' : ''}`}
              >
                {t.setup.tryAgain}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function WelcomeScreen({
  modelConfig,
  onConfigChange,
  onStart
}: {
  modelConfig: ModelConfig
  onConfigChange: (config: ModelConfig) => void
  onStart: (config: ModelConfig) => void
}) {
  const { t, language } = useI18n()
  const selected = AVAILABLE_MODELS.find((m) => m.name === modelConfig.model) ?? AVAILABLE_MODELS[0]
  const [showNotification, setShowNotification] = useState(true)

  const handleAutoSelect = () => {
    setShowNotification(false)
    const recommended = AVAILABLE_MODELS.find(m => m.recommended) ?? AVAILABLE_MODELS[0]
    onStart({ source: 'mlx', model: recommended.name })
  }

  const handleDismissNotification = () => {
    setShowNotification(false)
  }

  return (
    <div className={`drag flex h-full w-full flex-col ${language === 'ar' ? 'rtl' : ''}`}>
      {showNotification && (
        <AutoSelectNotification
          modelName={selected.label}
          onAutoSelect={handleAutoSelect}
          onDismiss={handleDismissNotification}
          duration={15}
        />
      )}

      <div className="flex h-9 items-center justify-end px-8">
        <LanguageSwitcher />
      </div>
      <div className="flex flex-1 items-center justify-center px-8">
        <div className="no-drag w-full max-w-md">
          <div className="anim-fade-up mb-8 text-center">
            <GemmaLogo className="mx-auto mb-5 h-24 w-24" />
            <h1 className={`text-[26px] font-semibold tracking-tight ${language === 'ar' ? 'font-tajawal' : ''}`}>{t.setup.title}</h1>
            <p className={`mt-2 text-[13.5px] leading-relaxed text-ink-400 ${language === 'ar' ? 'font-tajawal' : ''}`}>
              {t.setup.subtitle.split('\n').map((line, i) => (
                <span key={i}>
                  {line}
                  {i === 0 && <br />}
                </span>
              ))}
            </p>
          </div>

          <ModelSourceSelector
            modelConfig={modelConfig}
            onConfigChange={(config) => {
              onConfigChange(config)
              setShowNotification(false)
            }}
            disabled={false}
          />

          <div className={`mt-6 mb-3 text-[11px] font-medium uppercase tracking-wider text-ink-400 ${language === 'ar' ? 'font-tajawal text-right' : ''}`}>
            {t.setup.pickModel}
          </div>
          {modelConfig.source === 'mlx' && (
            <div className="anim-stagger space-y-2">
              {AVAILABLE_MODELS.map((m) => (
                <button
                  key={m.name}
                  onClick={() => {
                    onConfigChange({ source: 'mlx', model: m.name })
                    setShowNotification(false)
                  }}
                  className={`anim-fade-up group relative w-full rounded-xl border px-4 py-3 text-left transition active:scale-[0.99] ${
                    modelConfig.model === m.name
                      ? 'border-white/25 bg-white/[0.06]'
                      : 'border-white/5 bg-white/[0.02] hover:border-white/10 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{m.label}</span>
                      {m.recommended && (
                        <span className="rounded-full bg-white/10 px-2 py-[1px] text-[10px] font-medium uppercase tracking-wider text-ink-100">
                          Recommended
                        </span>
                      )}
                    </div>
                    <span className="text-xs tabular-nums text-ink-400">{m.size}</span>
                  </div>
                  <div className="mt-1 text-[12.5px] leading-snug text-ink-400">
                    {m.description}
                  </div>
                </button>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              setShowNotification(false)
              onStart(modelConfig)
            }}
            className={`mt-6 w-full rounded-xl bg-white py-3 text-sm font-medium text-ink-900 transition hover:bg-white/90 active:scale-[0.99] ${language === 'ar' ? 'font-tajawal' : ''}`}
          >
            {modelConfig.source === 'gguf' ? (
              <>{t.setup.download} from Local File</>
            ) : (
              <>{t.setup.download} {selected.label} <span className="opacity-40 mx-1">·</span> {selected.size}</>
            )}
          </button>
          <p className={`mt-3 text-center text-[11px] text-ink-400 ${language === 'ar' ? 'font-tajawal' : ''}`}>
            {t.setup.installNote}
          </p>
        </div>
      </div>
    </div>
  )
}

function StageList({ status }: { status: SetupStatus }) {
  const { t } = useI18n()
  const stages: Array<{ key: SetupStatus['stage']; label: string }> = [
    { key: 'installing-mlx', label: t.setup.stages.installing },
    { key: 'starting-mlx', label: t.setup.stages.starting },
    { key: 'downloading-model', label: t.setup.stages.downloading },
    { key: 'ready', label: t.setup.stages.ready }
  ]
  const order: SetupStatus['stage'][] = [
    'checking',
    'installing-mlx',
    'starting-mlx',
    'downloading-model',
    'ready'
  ]
  const currentIdx = order.indexOf(status.stage)

  return (
    <div className="space-y-3.5">
      {stages.map((s) => {
        const idx = order.indexOf(s.key)
        const state = idx < currentIdx ? 'done' : idx === currentIdx ? 'active' : 'pending'
        return (
          <div key={s.key} className="flex items-center gap-3">
            <StageDot state={state} />
            <div className="flex-1 min-w-0">
              <div
                className={`text-[13px] leading-snug transition-colors ${
                  state === 'pending'
                    ? 'text-ink-500'
                    : state === 'active'
                      ? 'text-white'
                      : 'text-ink-300'
                }`}
              >
                {state === 'active' && status.message ? status.message : s.label}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StageDot({ state }: { state: 'pending' | 'active' | 'done' }) {
  if (state === 'done') {
    return (
      <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/90">
        <svg viewBox="0 0 12 12" className="h-2.5 w-2.5 text-ink-900" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="M2 6.5l2.5 2.5 5.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    )
  }
  if (state === 'active') {
    return (
      <div className="relative flex h-5 w-5 shrink-0 items-center justify-center">
        {/* Outer pulse ring */}
        <span className="absolute inset-0 rounded-full bg-white/20 animate-ping" style={{ animationDuration: '1.4s' }} />
        {/* Spinning arc */}
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 20 20" fill="none" style={{ animationDuration: '0.9s' }}>
          <circle cx="10" cy="10" r="7" stroke="white" strokeOpacity="0.12" strokeWidth="2" />
          <path d="M10 3a7 7 0 0 1 7 7" stroke="white" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
    )
  }
  return <div className="h-5 w-5 shrink-0 rounded-full border border-white/10" />
}

function GemmaLogo({ className }: { className?: string }) {
  return (
    <img
      src={gemmaLogoUrl}
      alt="Gemma"
      className={className}
      draggable={false}
    />
  )
}
