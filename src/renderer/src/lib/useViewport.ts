import { useEffect, useState } from 'react'

/**
 * Reactive viewport width hook. Returns `undefined` during SSR / before the
 * first measurement so consumers can defer layout decisions until we know
 * the actual size.
 */
export function useViewportWidth(): number | undefined {
  const [width, setWidth] = useState<number | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    return window.innerWidth
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    const onResize = (): void => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize, { passive: true })
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/**
 * Convenience: a stable boolean for a Tailwind-style breakpoint.
 *
 *   useBreakpoint('md')  → true when viewport >= 768px
 *   useBreakpoint('lg')  → true when viewport >= 1024px
 *   useBreakpoint('xl')  → true when viewport >= 1280px
 */
export function useBreakpoint(
  bp: 'sm' | 'md' | 'lg' | 'xl' | '2xl'
): boolean | undefined {
  const width = useViewportWidth()
  if (width == null) return undefined
  switch (bp) {
    case 'sm':
      return width >= 640
    case 'md':
      return width >= 768
    case 'lg':
      return width >= 1024
    case 'xl':
      return width >= 1280
    case '2xl':
      return width >= 1536
  }
}
