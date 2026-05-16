import { useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import type { ModelConfig } from '@shared/types'
import { AVAILABLE_MODELS } from '@shared/types'

interface Props {
  modelConfig: ModelConfig
  onConfigChange: (config: ModelConfig) => void
  disabled?: boolean
}

export default function ModelSourceSelector({
  modelConfig,
  onConfigChange,
  disabled = false
}: Props) {
  const { language } = useI18n()
  const [ggufPath, setGgufPath] = useState(modelConfig.path || '')

  const selectGGUFFile = async () => {
    const result = await (window as any).electron.ipcRenderer.invoke('dialog:open-file', {
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

  return (
    <div className={`space-y-4 rounded-lg border border-white/10 bg-white/5 p-4 ${language === 'ar' ? 'rtl' : ''}`}>
      <div className="space-y-2">
        <label className={`block text-sm font-medium ${language === 'ar' ? 'font-tajawal text-right' : ''}`}>
          Model Source
        </label>

        {/* MLX (Download) Option */}
        <button
          onClick={() => onConfigChange({ source: 'mlx', model: modelConfig.model || 'mlx-community/gemma-4-e4b-it-4bit' })}
          disabled={disabled}
          className={`w-full text-left rounded-lg border-2 p-3 transition ${
            modelConfig.source === 'mlx'
              ? 'border-blue-500 bg-blue-500/10'
              : 'border-white/10 bg-white/5 hover:border-white/20'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="font-medium">Download from HuggingFace</div>
          <div className="text-xs text-white/60">MLX-quantized models (auto-cached)</div>
        </button>

        {/* MLX Model Selector */}
        {modelConfig.source === 'mlx' && (
          <select
            value={modelConfig.model || 'mlx-community/gemma-4-e4b-it-4bit'}
            onChange={(e) => onConfigChange({ source: 'mlx', model: e.target.value })}
            disabled={disabled}
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm"
          >
            {AVAILABLE_MODELS.map(m => (
              <option key={m.name} value={m.name}>
                {m.label} ({m.size})
              </option>
            ))}
          </select>
        )}

        {/* GGUF (Local) Option */}
        <button
          onClick={() => onConfigChange({ source: 'gguf', path: ggufPath })}
          disabled={disabled}
          className={`w-full text-left rounded-lg border-2 p-3 transition ${
            modelConfig.source === 'gguf'
              ? 'border-green-500 bg-green-500/10'
              : 'border-white/10 bg-white/5 hover:border-white/20'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="font-medium">Use Local GGUF File</div>
          <div className="text-xs text-white/60">Faster startup, no download needed</div>
        </button>

        {/* GGUF File Selector */}
        {modelConfig.source === 'gguf' && (
          <div className="space-y-2">
            <button
              onClick={selectGGUFFile}
              disabled={disabled}
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm hover:bg-white/20"
            >
              {ggufPath ? 'Change File' : 'Select Model File'}
            </button>
            {ggufPath && (
              <div className="text-xs text-white/70 break-all">
                {ggufPath.split('/').pop()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
