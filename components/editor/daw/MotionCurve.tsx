'use client'

import { useRef, useEffect, useCallback } from 'react'
import type { AutoPoint } from '@/lib/daw-types'

// A curve editor for FX Motion and per-parameter graphs. The x-axis is the
// clip (left = start, right = end), y is the effect amount (top = full-on,
// bottom = neutral).
//
// Interaction — editing, not sketching:
//   • tap empty space   → add a point there (nothing else is disturbed)
//   • drag a point      → move it
//   • drag the line     → adds a point under the cursor and bends the curve
//   • double-tap a point→ remove it
// It used to wipe the whole curve on every pointer-down ("each stroke replaces
// the curve"), which made a stray click destroy your work; the Reset button is
// the only thing that clears now.
//
// Stored as normalized points (0..1). The engine resamples at render time, so
// a couple dozen points cost nothing.

const HIT_PX = 9          // grab radius for an existing point
const DBL_MS = 350        // double-press window (Chrome reports detail=0 on
const DBL_PX = 12         // pointer events, so we detect it ourselves)

export default function MotionCurve({ points, onChange, width = 300, height = 120, color = 'var(--accent)' }: {
  points: AutoPoint[]
  onChange: (pts: AutoPoint[]) => void
  width?: number
  height?: number
  color?: string
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dragId = useRef<string | null>(null)
  const lastTap = useRef<{ t: number; x: number; y: number; id: string | null }>({ t: 0, x: 0, y: 0, id: null })
  // Points are read from props during a drag, so keep a live ref for handlers.
  const ptsRef = useRef<AutoPoint[]>(points)
  ptsRef.current = points

  useEffect(() => {
    const c = ref.current; if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr; c.height = height * dpr
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1
    for (const yf of [0, 0.5, 1]) { const y = yf * height; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
    const pts = [...points].sort((a, b) => a.t - b.t)
    if (!pts.length) return
    const X = (t: number) => t * width
    const Y = (v: number) => (1 - v) * height
    ctx.beginPath(); ctx.moveTo(0, Y(pts[0].v))
    for (const p of pts) ctx.lineTo(X(p.t), Y(p.v))
    ctx.lineTo(width, Y(pts[pts.length - 1].v)); ctx.lineTo(width, height); ctx.lineTo(0, height); ctx.closePath()
    ctx.fillStyle = 'rgb(var(--accent-rgb) / 0.14)'; ctx.fill()
    ctx.beginPath(); ctx.moveTo(0, Y(pts[0].v))
    for (const p of pts) ctx.lineTo(X(p.t), Y(p.v))
    ctx.lineTo(width, Y(pts[pts.length - 1].v))
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke()
    // Handles are large enough to grab (they used to be 2.2px dots)
    for (const p of pts) {
      ctx.fillStyle = color
      ctx.beginPath(); ctx.arc(X(p.t), Y(p.v), 3.6, 0, Math.PI * 2); ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1; ctx.stroke()
    }
  }, [points, width, height, color])

  const at = useCallback((e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect()
    return {
      t: Math.max(0, Math.min(1, (e.clientX - r.left) / width)),
      v: Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / height)),
      px: e.clientX - r.left,
      py: e.clientY - r.top,
    }
  }, [width, height])

  const mk = (t: number, v: number): AutoPoint =>
    ({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, t, v, smooth: false, h1: [0, 0], h2: [0, 0] })

  /** Nearest existing point within the grab radius, in pixel space. */
  const hitTest = useCallback((px: number, py: number): AutoPoint | null => {
    let best: AutoPoint | null = null
    let bestD = HIT_PX
    for (const p of ptsRef.current) {
      const d = Math.hypot(p.t * width - px, (1 - p.v) * height - py)
      if (d <= bestD) { bestD = d; best = p }
    }
    return best
  }, [width, height])

  const commit = (pts: AutoPoint[]) => {
    const sorted = [...pts].sort((a, b) => a.t - b.t)
    // The engine wants at least two points to describe a shape.
    if (sorted.length === 1) sorted.push({ ...sorted[0], id: sorted[0].id + '-end', t: 1 })
    onChange(sorted)
  }

  return (
    <canvas ref={ref}
      onPointerDown={e => {
        const { t, v, px, py } = at(e)
        const hit = hitTest(px, py)
        const now = Date.now()
        const prev = lastTap.current
        const isDouble = hit && prev.id === hit.id && now - prev.t < DBL_MS &&
          Math.hypot(px - prev.x, py - prev.y) < DBL_PX
        lastTap.current = { t: now, x: px, y: py, id: hit?.id ?? null }

        if (isDouble && hit) {
          // Double-tap a handle removes it (keep at least two).
          if (ptsRef.current.length > 2) commit(ptsRef.current.filter(p => p.id !== hit.id))
          return
        }
        e.currentTarget.setPointerCapture?.(e.pointerId)
        if (hit) { dragId.current = hit.id; return }
        // Empty space or on the line: add a point here and drag it. Adding
        // never disturbs the rest of the curve.
        const p = mk(t, v)
        dragId.current = p.id
        commit([...ptsRef.current, p])
      }}
      onPointerMove={e => {
        if (!dragId.current) return
        const { t, v } = at(e)
        commit(ptsRef.current.map(p => p.id === dragId.current ? { ...p, t, v } : p))
      }}
      onPointerUp={e => { dragId.current = null; e.currentTarget.releasePointerCapture?.(e.pointerId) }}
      onPointerCancel={() => { dragId.current = null }}
      title="Tap to add a point · drag a point to move it · drag the line to bend it · double-tap a point to remove it"
      style={{ width, height, borderRadius: 6, display: 'block', cursor: 'crosshair', touchAction: 'none' }} />
  )
}
