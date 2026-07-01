import { type ComponentPropsWithoutRef } from 'react'

interface Props extends ComponentPropsWithoutRef<'svg'> {
  animating?: boolean
}

/**
 * An SVG bug mascot (Gemma) with legs that animate in a walking cycle
 * when `animating` is true. The body stays still while legs walk.
 */
export default function GemmaBug({ animating = false, className, ...rest }: Props) {
  const legAnim = animating ? 'gemma-bug-walk' : undefined
  const legBaseStyle: React.CSSProperties = {
    transformBox: 'fill-box',
  }

  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      role="img"
      aria-label="Gemma bug mascot"
      {...rest}
    >
      {/* ── Body ── */}
      <ellipse cx="16" cy="18" rx="8" ry="8.5" fill="currentColor" opacity={0.18} />
      <ellipse cx="16" cy="17.5" rx="7" ry="7.5" fill="currentColor" opacity={0.35} />

      {/* ── Head ── */}
      <circle cx="16" cy="9" r="5.5" fill="currentColor" opacity={0.50} />
      <circle cx="16" cy="9" r="4.5" fill="currentColor" opacity={0.80} />

      {/* ── Eyes ── */}
      <circle cx="14" cy="8" r="1.2" fill="white" opacity={0.9} />
      <circle cx="18" cy="8" r="1.2" fill="white" opacity={0.9} />

      {/* ── Antennae ── */}
      <path
        d="M13 5.5 C11 3, 9 2.5, 8 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="3 2"
        opacity={0.5}
      />
      <path
        d="M19 5.5 C21 3, 23 2.5, 24 3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="3 2"
        opacity={0.5}
      />

      {/* ── Left Legs ── */}
      {/* Front leg */}
      <line
        x1="9"
        y1="14"
        x2="5"
        y2="16"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={0.55}
        style={{
          ...legBaseStyle,
          transformOrigin: '9px 14px',
          animation: legAnim ? 'gemma-bug-walk-front-left 0.5s ease-in-out infinite' : undefined,
        }}
      />
      {/* Middle leg */}
      <line
        x1="8.5"
        y1="18"
        x2="4"
        y2="18"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={0.55}
        style={{
          ...legBaseStyle,
          transformOrigin: '8.5px 18px',
          animation: legAnim ? 'gemma-bug-walk-mid-left 0.5s ease-in-out infinite' : undefined,
        }}
      />
      {/* Back leg */}
      <line
        x1="9"
        y1="22"
        x2="5"
        y2="20"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={0.55}
        style={{
          ...legBaseStyle,
          transformOrigin: '9px 22px',
          animation: legAnim ? 'gemma-bug-walk-back-left 0.5s ease-in-out infinite' : undefined,
        }}
      />

      {/* ── Right Legs ── */}
      {/* Front leg */}
      <line
        x1="23"
        y1="14"
        x2="27"
        y2="16"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={0.55}
        style={{
          ...legBaseStyle,
          transformOrigin: '23px 14px',
          animation: legAnim ? 'gemma-bug-walk-front-right 0.5s ease-in-out infinite' : undefined,
        }}
      />
      {/* Middle leg */}
      <line
        x1="23.5"
        y1="18"
        x2="28"
        y2="18"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={0.55}
        style={{
          ...legBaseStyle,
          transformOrigin: '23.5px 18px',
          animation: legAnim ? 'gemma-bug-walk-mid-right 0.5s ease-in-out infinite' : undefined,
        }}
      />
      {/* Back leg */}
      <line
        x1="23"
        y1="22"
        x2="27"
        y2="20"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity={0.55}
        style={{
          ...legBaseStyle,
          transformOrigin: '23px 22px',
          animation: legAnim ? 'gemma-bug-walk-back-right 0.5s ease-in-out infinite' : undefined,
        }}
      />
    </svg>
  )
}
