import { useEffect, useRef } from 'react'

interface Props {
  size?: number // Default 120px
  isAnimating: boolean
}

export default function FractalThinkingAnimation({ size = 120, isAnimating }: Props) {
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

      // Morph shape: triangle -> square -> hexagon -> star -> back to triangle
      const morphPhase = (Math.sin(timeRef.current * 0.5) + 1) / 2
      const shapePhase = timeRef.current * 0.3

      // Color cycling: blue -> purple -> cyan -> blue
      const hue = (shapePhase * 60) % 360
      const saturation = 65 + Math.sin(timeRef.current * 0.4) * 15
      const lightness = 55 + Math.sin(timeRef.current * 0.3) * 10

      // Clear SVG
      svg.innerHTML = ''

      // Draw recursive fractal pattern
      drawFractal(
        svg,
        size / 2,
        size / 2,
        size * 0.3,
        0,
        3,
        morphPhase,
        shapePhase,
        `hsl(${hue}, ${saturation}%, ${lightness}%)`
      )

      // Breathing pulse effect
      const scale = 0.9 + Math.sin(timeRef.current * 2) * 0.1
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
      group.setAttribute('transform', `translate(${size / 2}, ${size / 2}) scale(${scale}) translate(${-size / 2}, ${-size / 2})`)

      Array.from(svg.children).forEach(child => {
        group.appendChild(child.cloneNode(true))
      })

      svg.innerHTML = ''
      svg.appendChild(group)

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

function drawFractal(
  svg: SVGSVGElement,
  x: number,
  y: number,
  size: number,
  angle: number,
  depth: number,
  morphPhase: number,
  shapePhase: number,
  color: string
) {
  if (depth === 0 || size < 2) return

  // Draw shape at current position (morphing between geometries)
  const shape = drawMorphingShape(svg, x, y, size, morphPhase, shapePhase, color)
  if (shape) {
    svg.appendChild(shape)
  }

  // Recursive branches following golden ratio
  const goldenRatio = 1.618
  const childSize = size / goldenRatio
  const branchCount = 3 + Math.floor(morphPhase * 2)

  for (let i = 0; i < branchCount; i++) {
    const branchAngle = angle + (i * 360) / branchCount + Math.sin(shapePhase) * 30
    const branchX = x + Math.cos((branchAngle * Math.PI) / 180) * size * 0.6
    const branchY = y + Math.sin((branchAngle * Math.PI) / 180) * size * 0.6

    // Draw connecting line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    line.setAttribute('x1', String(x))
    line.setAttribute('y1', String(y))
    line.setAttribute('x2', String(branchX))
    line.setAttribute('y2', String(branchY))
    line.setAttribute('stroke', color)
    line.setAttribute('stroke-width', String(Math.max(0.5, size / 30)))
    line.setAttribute('opacity', String(0.4 + morphPhase * 0.6))
    svg.appendChild(line)

    // Recursive call
    drawFractal(svg, branchX, branchY, childSize, branchAngle, depth - 1, morphPhase, shapePhase, color)
  }
}

function drawMorphingShape(
  _svg: SVGSVGElement,
  x: number,
  y: number,
  size: number,
  morphPhase: number,
  shapePhase: number,
  color: string
): SVGElement | null {
  const points: Array<[number, number]> = []
  const sides = 3 + Math.round(morphPhase * 3) // 3 (triangle) to 6 (hexagon)

  // Generate polygon points
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * Math.PI * 2 + (shapePhase * 0.2)
    const px = x + Math.cos(angle) * size
    const py = y + Math.sin(angle) * size
    points.push([px, py])
  }

  const polygon = document.createElementNS('http://www.w3.org/2000/svg', 'polygon')
  polygon.setAttribute('points', points.map(p => p.join(',')).join(' '))
  polygon.setAttribute('fill', color)
  polygon.setAttribute('opacity', String(0.3 + morphPhase * 0.4))
  polygon.setAttribute('stroke', color)
  polygon.setAttribute('stroke-width', '1.5')

  return polygon
}
