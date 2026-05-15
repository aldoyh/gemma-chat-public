import { useEffect, useState } from 'react'
import FractalThinkingAnimation from './FractalThinkingAnimation'
import type { ActivityState } from '@shared/types'

interface Props {
  state: ActivityState
  cpuPercent?: number
}

export default function ActivityIndicator({ state, cpuPercent }: Props) {
  const [displayLabel, setDisplayLabel] = useState('Idle')
  const [isAnimating, setIsAnimating] = useState(false)

  useEffect(() => {
    switch (state) {
      case 'thinking':
        setDisplayLabel('Thinking')
        setIsAnimating(true)
        break
      case 'generating':
        setDisplayLabel('Generating')
        setIsAnimating(true)
        break
      case 'loading':
        setDisplayLabel('Loading model')
        setIsAnimating(true)
        break
      case 'idle':
        setDisplayLabel('Idle')
        setIsAnimating(false)
        break
    }
  }, [state])

  const showCPU = state !== 'idle' && cpuPercent !== undefined

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 border border-white/10">
      {/* Animated icon */}
      <div className="w-4 h-4 flex items-center justify-center">
        {isAnimating ? (
          <FractalThinkingAnimation size={16} isAnimating={true} />
        ) : (
          <div className="w-2 h-2 rounded-full bg-white/40" />
        )}
      </div>

      {/* Status label */}
      <span className="text-xs font-medium text-ink-200 tabular-nums">
        {displayLabel}
      </span>

      {/* CPU percentage (optional) */}
      {showCPU && (
        <span className="text-[10px] text-ink-400 ml-1">
          {Math.round(cpuPercent)}%
        </span>
      )}
    </div>
  )
}
