'use client'

import { useRef, useEffect } from 'react'
import type { AutoPoint } from '@/lib/daw-types'

// A freehand curve editor for FX Motion. The x-axis is the clip (left = start,
// right = end), y is the effect amount (top = full-on, bottom = neutral). Drag
// across to sketch the shape; each stroke replaces the curve. Stored as a small
// set of normalized points (0..1) — a couple dozen at most, so it's tiny; the
// engine resamples the curve at render time, so the point count costs nothing.
export default function MotionCurve({ points, onChange, width = 300, height = 120, color = 'var(--accent)' }: {
  points: AutoPoint[]
  onChange: (pts: AutoPoint[]) => void
  width?: number
  height?: number
  color?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const painting = useRef(false)
  const buckets = useRef<Map<number, number>>(new Map())
  const NB = Math.min(32, Math.max(12, Math.round(width / 10)))   // x resolution

  useEffect(() => {
    const c = ref.current; if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr; c.height = height * dpr
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, width, height)
    // amount gridlines: full / half / neutral
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1
    for (const yf of [0, 0.5, 1]) { const y = yf * height; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
    const pts = [...points].sort((a, b) => a.t - b.t)
    if (!pts.length) return
    const X = (t: number) => t * width
    const Y = (v: number) => (1 - v) * height
    // fill under the curve
    ctx.beginPath(); ctx.moveTo(0, Y(pts[0].v))
    for (const p of pts) ctx.lineTo(X(p.t), Y(p.v))
    ctx.lineTo(width, Y(pts[pts.length - 1].v)); ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath()
    ctx.fillStyle = 'rgb(var(--accent-rgb) / 0.14)'; ctx.fill()
    // the curve line (held flat before the first / after the last point)
    ctx.beginPath(); ctx.moveTo(0, Y(pts[0].v))
    for (const p of pts) ctx.lineTo(X(p.t), Y(p.v))
    ctx.lineTo(width, Y(pts[pts.length - 1].v))
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke()
    for (const p of pts) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(X(p.t), Y(p.v), 2.2, 0, Math.PI * 2); ctx.fill() }
  }, [points, width, height, color])

  const emit = () => {
    const arr: AutoPoint[] = [...buckets.current.entries()].sort((a, b) => a[0] - b[0])
      .map(([b, v]) => ({ id: `m${b}`, t: b / NB, v, smooth: false, h1: [0, 0], h2: [0, 0] }))
    if (arr.length === 1) arr.push({ ...arr[0], id: 'm-end', t: 1 })   // engine wants ≥2
    onChange(arr)
  }
  const at = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return { fx: Math.max(0, Math.min(1, (e.clientX - r.left) / width)), v: Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / height)) }
  }
  const paint = (e: { clientX: number; clientY: number }) => {
    const { fx, v } = at(e)
    buckets.current.set(Math.round(fx * NB), Math.round(v * 100) / 100)
    emit()
  }
  return (
    <canvas ref={ref}
      onPointerDown={e => { painting.current = true; buckets.current = new Map(); e.currentTarget.setPointerCapture?.(e.pointerId); paint(e) }}
      onPointerMove={e => { if (painting.current) paint(e) }}
      onPointerUp={e => { painting.current = false; e.currentTarget.releasePointerCapture?.(e.pointerId) }}
      onPointerLeave={() => { painting.current = false }}
      title="Draw the FX motion across the clip — left = start, right = end · top = full, bottom = off"
      style={{ width, height, borderRadius: 6, display: 'block', cursor: 'crosshair', touchAction: 'none' }} />
  )
}
