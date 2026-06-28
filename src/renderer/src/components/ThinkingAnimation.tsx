import { useEffect, useRef } from 'react'

interface Props {
  size?: number // Default 24px
  isAnimating: boolean
}

export default function ThinkingAnimation({ size = 24, isAnimating }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const animationRef = useRef<number | null>(null)
  const timeRef = useRef(0)

  useEffect(() => {
    if (!isAnimating || !svgRef.current) return

    const svg = svgRef.current

    // Clear previous animation
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current)
    }

    const animate = () => {
      timeRef.current += 0.016 // ~60fps

      // Clear SVG
      svg.innerHTML = ''

      // Draw the thinking animation
      drawThinkingAnimation(svg, size / 2, size / 2, size * 0.4, timeRef.current)

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isAnimating, size])

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      xmlns="http://www.w3.org/2000/svg"
      style={{ display: 'block' }}
    />
  )
}

function drawThinkingAnimation(svg: SVGSVGElement, centerX: number, centerY: number, radius: number, time: number) {
  // Draw the main circle
  const mainCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  mainCircle.setAttribute('cx', String(centerX))
  mainCircle.setAttribute('cy', String(centerY))
  mainCircle.setAttribute('r', String(radius))
  mainCircle.setAttribute('fill', 'none')
  mainCircle.setAttribute('stroke', 'currentColor')
  mainCircle.setAttribute('stroke-width', '2')
  svg.appendChild(mainCircle)

  // Draw the rotating dots
  const dotCount = 8
  const dotRadius = radius * 0.15

  for (let i = 0; i < dotCount; i++) {
    const angle = (i / dotCount) * Math.PI * 2 + time * 0.5
    const dotX = centerX + Math.cos(angle) * radius * 0.7
    const dotY = centerY + Math.sin(angle) * radius * 0.7

    const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    dot.setAttribute('cx', String(dotX))
    dot.setAttribute('cy', String(dotY))
    dot.setAttribute('r', String(dotRadius))
    dot.setAttribute('fill', 'currentColor')

    // Calculate opacity based on position
    const opacity = 0.3 + Math.sin(angle + time) * 0.2
    dot.setAttribute('opacity', String(opacity))

    svg.appendChild(dot)
  }

  // Draw the pulsing center
  const pulseRadius = radius * 0.3 * (0.8 + Math.sin(time * 2) * 0.2)
  const centerDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
  centerDot.setAttribute('cx', String(centerX))
  centerDot.setAttribute('cy', String(centerY))
  centerDot.setAttribute('r', String(pulseRadius))
  centerDot.setAttribute('fill', 'currentColor')
  centerDot.setAttribute('opacity', '0.8')
  svg.appendChild(centerDot)
}
