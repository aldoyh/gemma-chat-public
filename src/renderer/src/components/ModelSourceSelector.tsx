import { useEffect, useState, type ReactElement } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { ModelConfig, OllamaModelInfo } from '@shared/types'
import { AVAILABLE_MODELS, DEFAULT_MODEL } from '@shared/types'

interface Props {
  modelConfig: ModelConfig
  onConfigChange: (config: ModelConfig) => void
  disabled?: boolean
}

export default function ModelSourceSelector({ modelConfig, onConfigChange, disabled = false }: Props): ReactElement {
  const { t, language } = useI18n()
  const [ggufPath, setGgufPath] = useState(modelConfig.path || '')
  const [ollamaModels, setOllamaModels] = useState<OllamaModelInfo[]>([])
  const [ollamaLoading, setOllamaLoading] = useState(false)

  useEffect(() => {
    if (modelConfig.source !== 'ollama') return
    setOllamaLoading(true)
    window.api.listOllamaModels().then((models) => {
      setOllamaModels(models)
      if (models.length > 0 && !modelConfig.model) {
        onConfigChange({ source: 'ollama', model: models[0].name })
      }
      setOllamaLoading(false)
    }).catch(() => setOllamaLoading(false))
  }, [modelConfig.source])

  const selectGGUFFile = async () => {
    const result = await window.api.openFileDialog({
      filters: [
        { name: 'GGUF Models', extensions: ['gguf'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (!result.canceled && result.filePaths.length > 0) {
      const path = result.filePaths[0]
      setGgufPath(path)
      onConfigChange({ source: 'gguf', path })
    }
  }

  const refreshOllama = () => {
    setOllamaLoading(true)
    window.api.listOllamaModels().then((models) => {
      setOllamaModels(models)
      setOllamaLoading(false)
    }).catch(() => setOllamaLoading(false))
  }

  const btn = (active: boolean) =>
    `w-full text-left rounded-lg border-2 p-3 transition ${
      active ? 'border-blue-500 bg-blue-500/10' : 'border-white/10 bg-white/5 hover:border-white/20'
    } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`

  return (
    <div className={`space-y-4 rounded-lg border border-white/10 bg-white/5 p-4 ${language === 'ar' ? 'rtl' : ''}`}>
      <div className="space-y-2">
        <label className={`block text-sm font-medium ${language === 'ar' ? 'font-tajawal text-right' : ''}`}>
          {t.setup.modelSource}
        </label>

        {/* Ollama option */}
        <button
          type="button"
          onClick={() => onConfigChange({ source: 'ollama', model: ollamaModels[0]?.name })}
          disabled={disabled}
          className={btn(modelConfig.source === 'ollama')}
        >
          <div className="font-medium flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
            Ollama (local)
          </div>
          <div className="text-xs text-white/60">Use any model from your local Ollama install</div>
        </button>

        {modelConfig.source === 'ollama' && (
          <div className="flex gap-2">
            <select
              value={modelConfig.model || ''}
              onChange={(e) => onConfigChange({ source: 'ollama', model: e.target.value })}
              disabled={disabled || ollamaLoading}
              title="Select Ollama model"
              className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
            >
              {ollamaLoading && <option value="">Loading…</option>}
              {!ollamaLoading && ollamaModels.length === 0 && <option value="">No models found</option>}
              {ollamaModels.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}{m.size ? ` (${m.size})` : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={refreshOllama}
              disabled={disabled || ollamaLoading}
              title="Refresh Ollama model list"
              className="flex items-center justify-center rounded-lg border border-white/10 bg-white/5 px-3 py-2 hover:bg-white/10"
            >
              <svg
                viewBox="0 0 16 16"
                className={`h-3.5 w-3.5 ${ollamaLoading ? 'animate-spin' : ''}`}
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M13.5 8a5.5 5.5 0 1 1-1.4-3.6" />
                <path d="M13.5 2.5V5.5H10.5" />
              </svg>
            </button>
          </div>
        )}

        {/* MLX (HuggingFace download) option */}
        <button
          type="button"
          onClick={() => onConfigChange({ source: 'mlx', model: modelConfig.model || DEFAULT_MODEL })}
          disabled={disabled}
          className={btn(modelConfig.source === 'mlx')}
        >
          <div className="font-medium">{t.setup.downloadFromHF}</div>
          <div className="text-xs text-white/60">{t.setup.downloadFromHFDesc}</div>
        </button>

        {modelConfig.source === 'mlx' && (
          <select
            value={modelConfig.model || DEFAULT_MODEL}
            onChange={(e) => onConfigChange({ source: 'mlx', model: e.target.value })}
            disabled={disabled}
            title="Select MLX model"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
          >
            {AVAILABLE_MODELS.map((m) => (
              <option key={m.name} value={m.name} disabled={m.requiresManualOverride}>
                {m.label} ({m.size})
              </option>
            ))}
          </select>
        )}

        {/* GGUF (local file) option */}
        <button
          type="button"
          onClick={() => onConfigChange({ source: 'gguf', path: ggufPath })}
          disabled={disabled}
          className={btn(modelConfig.source === 'gguf')}
        >
          <div className="font-medium">{t.setup.useLocalGGUF}</div>
          <div className="text-xs text-white/60">{t.setup.useLocalGGUFDesc}</div>
        </button>

        {modelConfig.source === 'gguf' && (
          <div className="space-y-2">
            <button
              type="button"
              onClick={selectGGUFFile}
              disabled={disabled}
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
            >
              {ggufPath ? t.setup.changeFile : t.setup.selectModelFile}
            </button>
            {ggufPath && (
              <div className="text-xs text-white/70 break-all">{ggufPath.split('/').pop()}</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
