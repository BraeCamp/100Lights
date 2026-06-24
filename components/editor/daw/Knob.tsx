'use client'

import { useEffect, useRef, useCallback } from 'react'

interface KnobProps {
  value: number
  min?: number
  max?: number
  defaultValue?: number
  size?: number
  color?: string
  label?: string
  onChange: (v: number) => void
  onCommit?: (v: number) => void
  format?: (v: number) => string
}

const START_ANGLE = (225 * Math.PI) / 180
const END_ANGLE   = (-45 * Math.PI) / 180
const SWEEP       = 300 * (Math.PI / 180)

export default function Knob({
  value,
  min = -1,
  max = 1,
  defaultValue = 0,
  size = 32,
  color = 'var(--accent)',
  label,
  onChange,
  onCommit,
  format,
}: KnobProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef   = useRef<{ startY: number; startVal: number } | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    const ctx = canvas.getContext('2d')!
    const W = size, H = size
    ctx.clearRect(0, 0, W * dpr, H * dpr)
    ctx.save()
    ctx.scale(dpr, dpr)

    const cx = W / 2, cy = H / 2
    const r  = W / 2 - 3

    // Background track
    ctx.beginPath()
    ctx.arc(cx, cy, r, START_ANGLE, START_ANGLE - SWEEP, true)
    ctx.strokeStyle = '#1a1a1a'
    ctx.lineWidth = 3
    ctx.lineCap = 'round'
    ctx.stroke()

    // Value arc
    const norm = (value - min) / (max - min)
    const endA = START_ANGLE - norm * SWEEP
    ctx.beginPath()
    ctx.arc(cx, cy, r, START_ANGLE, endA, true)
    ctx.strokeStyle = color.startsWith('var(') ? '#3d8fef' : color
    ctx.lineWidth = 3
    ctx.stroke()

    // Center dot
    ctx.beginPath()
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2)
    ctx.fillStyle = '#888'
    ctx.fill()

    ctx.restore()
  }, [value, min, max, color, size])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width  = size * dpr
    canvas.height = size * dpr
    canvas.style.width  = `${size}px`
    canvas.style.height = `${size}px`
    draw()
  }, [size, draw])

  useEffect(() => { draw() }, [draw])

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.detail === 2) {
      onChange(defaultValue)
      onCommit?.(defaultValue)
      return
    }
    dragRef.current = { startY: e.clientY, startVal: value }

    function onMove(ev: MouseEvent) {
      if (!dragRef.current) return
      const sensitivity = ev.shiftKey ? 0.002 : 0.01
      const delta = (dragRef.current.startY - ev.clientY) * sensitivity * (max - min)
      const next  = Math.max(min, Math.min(max, dragRef.current.startVal + delta))
      onChange(next)
    }
    function onUp(ev: MouseEvent) {
      if (!dragRef.current) return
      const sensitivity = ev.shiftKey ? 0.002 : 0.01
      const delta = (dragRef.current.startY - ev.clientY) * sensitivity * (max - min)
      const next  = Math.max(min, Math.min(max, dragRef.current.startVal + delta))
      onCommit?.(next)
      dragRef.current = null
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [value, min, max, defaultValue, onChange, onCommit])

  const tooltip = format ? format(value) : `${Math.round(value * 100) / 100}`

  return (
    <div
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 2, userSelect: 'none' }}
      title={tooltip}
    >
      <canvas
        ref={canvasRef}
        onMouseDown={onMouseDown}
        style={{ cursor: 'ns-resize', display: 'block' }}
      />
      {label && (
        <span style={{ fontSize: 9, color: 'var(--text-muted)', letterSpacing: '0.06em', lineHeight: 1 }}>
          {label}
        </span>
      )}
    </div>
  )
}
