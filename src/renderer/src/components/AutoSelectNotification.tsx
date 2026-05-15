import { useEffect, useState } from 'react'

interface Props {
  modelName: string
  onDismiss: () => void
  onAutoSelect: () => void
  duration?: number // in seconds, default 15
}

export default function AutoSelectNotification({
  modelName,
  onDismiss,
  onAutoSelect,
  duration = 15
}: Props) {
  const [remaining, setRemaining] = useState(duration)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (dismissed) return

    if (remaining <= 0) {
      onAutoSelect()
      return
    }

    const timer = setInterval(() => {
      setRemaining(prev => prev - 1)
    }, 1000)

    return () => clearInterval(timer)
  }, [remaining, dismissed, onAutoSelect])

  if (dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss()
  }

  const progress = ((duration - remaining) / duration) * 100

  return (
    <div className="fixed top-8 left-1/2 -translate-x-1/2 z-40 w-full max-w-md">
      <div
        className="cursor-pointer rounded-lg border border-white/20 bg-gradient-to-r from-blue-500/20 to-purple-500/20 px-4 py-3 shadow-lg backdrop-blur-sm hover:border-white/30 transition-colors"
        onClick={handleDismiss}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm text-white font-medium">
              Auto-starting <span className="font-semibold">{modelName}</span> in {remaining}s...
            </p>
            <p className="text-xs text-ink-400 mt-0.5">(click to change model)</p>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDismiss()
            }}
            className="text-ink-400 hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>

        {/* Progress bar */}
        <div className="mt-2 h-[2px] w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-1000"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}
