# Auto-Select Countdown, Activity Indicators & Thinking Animation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add auto-selecting recommended model with 15s countdown, CPU/activity status indicators in header, and a unique mathematical fractal thinking animation.

**Architecture:** Three independent features working together:
1. **AutoSelectNotification** - Appears on Welcome screen, dismissible 15s countdown to auto-start
2. **ActivityIndicator** - Header component showing "Thinking/Generating/Idle" with optional CPU%, updated via activity state
3. **FractalThinkingAnimation** - SVG-based animated fractal with morphing geometry, used in Setup and Chat thinking states

**Tech Stack:** React, SVG, TypeScript, Electron IPC for CPU metrics

---

## File Structure

**New files:**
- `src/renderer/src/components/AutoSelectNotification.tsx` - Countdown notification
- `src/renderer/src/components/ActivityIndicator.tsx` - Status + CPU display
- `src/renderer/src/components/FractalThinkingAnimation.tsx` - Fractal animation
- `src/renderer/src/hooks/useSystemActivity.ts` - Hook to track CPU/activity

**Modified files:**
- `src/renderer/src/components/Setup.tsx` - Add notification to Welcome screen
- `src/renderer/src/components/Chat.tsx` - Add activity indicator to header
- `src/renderer/src/App.tsx` - Manage activity state, track thinking phases
- `src/main/index.ts` - Send CPU metrics via IPC
- `src/shared/types.ts` - Add ActivityState and SystemMetrics types

---

## Task 1: Add Type Definitions for Activity State and System Metrics

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add ActivityState type to types.ts**

Open `src/shared/types.ts` and add after the existing types:

```typescript
export type ActivityState = 'idle' | 'thinking' | 'generating' | 'loading'

export interface SystemMetrics {
  cpuPercent: number
  activityState: ActivityState
  timestamp: number
}
```

- [ ] **Step 2: Commit**

```bash
git add src/shared/types.ts
git commit -m "types: Add ActivityState and SystemMetrics types"
```

---

## Task 2: Create FractalThinkingAnimation Component

**Files:**
- Create: `src/renderer/src/components/FractalThinkingAnimation.tsx`

- [ ] **Step 1: Create the fractal animation component**

Create `src/renderer/src/components/FractalThinkingAnimation.tsx`:

```typescript
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
  svg: SVGSVGElement,
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
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" || echo "✓ Compiles successfully"
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/FractalThinkingAnimation.tsx
git commit -m "feat: Create FractalThinkingAnimation component with morphing geometric fractals"
```

---

## Task 3: Create ActivityIndicator Component

**Files:**
- Create: `src/renderer/src/components/ActivityIndicator.tsx`

- [ ] **Step 1: Create the activity indicator component**

Create `src/renderer/src/components/ActivityIndicator.tsx`:

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" || echo "✓ Compiles successfully"
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/ActivityIndicator.tsx
git commit -m "feat: Create ActivityIndicator component with status and CPU display"
```

---

## Task 4: Create AutoSelectNotification Component

**Files:**
- Create: `src/renderer/src/components/AutoSelectNotification.tsx`

- [ ] **Step 1: Create the auto-select notification component**

Create `src/renderer/src/components/AutoSelectNotification.tsx`:

```typescript
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
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" || echo "✓ Compiles successfully"
```

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/components/AutoSelectNotification.tsx
git commit -m "feat: Create AutoSelectNotification component with 15s countdown"
```

---

## Task 5: Update Setup Component to Add Auto-Select Notification

**Files:**
- Modify: `src/renderer/src/components/Setup.tsx`

- [ ] **Step 1: Add imports and state to Setup**

At the top of `src/renderer/src/components/Setup.tsx`, add imports:
```typescript
import { useState } from 'react'
import AutoSelectNotification from './AutoSelectNotification'
import FractalThinkingAnimation from './FractalThinkingAnimation'
```

Update the WelcomeScreen function to include notification state and handlers.

- [ ] **Step 2: Update WelcomeScreen function**

Replace the `WelcomeScreen` function with version that includes auto-select logic and notification.

- [ ] **Step 3: Update StageDot animation**

Replace the active StageDot animation with FractalThinkingAnimation.

- [ ] **Step 4: Verify it compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" || echo "✓ Compiles successfully"
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Setup.tsx
git commit -m "feat: Add auto-select notification and fractal animations to Setup"
```

---

## Task 6: Update Chat Component to Add ActivityIndicator

**Files:**
- Modify: `src/renderer/src/components/Chat.tsx`

- [ ] **Step 1: Add imports and activity state**

Add imports for ActivityIndicator and types, add activity state tracking.

- [ ] **Step 2: Add activity tracking to message handling**

Track when chat is thinking, generating, or idle based on message processing.

- [ ] **Step 3: Add ActivityIndicator to header**

Add ActivityIndicator component to Chat header showing current activity state.

- [ ] **Step 4: Verify it compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" || echo "✓ Compiles successfully"
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/Chat.tsx
git commit -m "feat: Add ActivityIndicator to Chat header"
```

---

## Task 7: Update App Component for Activity State Management

**Files:**
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Add activity state tracking to AppContent**

Add activity state and callback handlers to manage activity across app.

- [ ] **Step 2: Pass activity state to Chat**

Wire up activity state callbacks between Chat and App components.

- [ ] **Step 3: Verify it compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" || echo "✓ Compiles successfully"
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/App.tsx
git commit -m "feat: Add activity state management to App component"
```

---

## Task 8: Update Main Process for CPU Metrics (Optional)

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Add CPU monitoring function**

Add function to get CPU load from system.

- [ ] **Step 2: Emit CPU metrics during chat**

Add periodic CPU metrics emission while chat is active.

- [ ] **Step 3: Verify it compiles**

```bash
npm run build 2>&1 | grep -E "error|Error" || echo "✓ Compiles successfully"
```

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: Add CPU metrics emission from main process"
```

---

## Summary

Three new components created with unique features:
- ✅ FractalThinkingAnimation - Morphing geometric fractals
- ✅ ActivityIndicator - Status + CPU display
- ✅ AutoSelectNotification - Dismissible 15s countdown

All integrated into Setup and Chat components.
