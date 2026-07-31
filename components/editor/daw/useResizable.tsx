'use client'

// Drag-to-resize for studio panels. `useResizable` owns a clamped, optionally
// persisted size; `ResizeHandle` is the thin edge grip that drives it. The
// parent element must be position:relative for the handle to sit on its edge.

import React, { useRef, useState } from 'react'

interface Opts {
  /** localStorage key (persists the size across sessions). Omit to not persist. */
  key?: string
  initial: number
  min: number
  max: number
  axis: 'x' | 'y'
  /** true when the handle grows the panel in the negative-delta direction
   *  (e.g. a top edge that gets taller as you drag up). */
  invert?: boolean
}

export function useResizable({ key, initial, min, max, axis, invert = false }: Opts) {
  const clamp = (v: number) => Math.max(min, Math.min(max, v))
  const [size, setSizeState] = useState<number>(() => {
    if (typeof window === 'undefined' || !key) return initial
    const raw = localStorage.getItem('100lights-resize-' + key)
    const v = raw ? Number(raw) : NaN
    return Number.isFinite(v) ? clamp(v) : initial
  })
  const [dragging, setDragging] = useState(false)
  const sizeRef = useRef(size)
  const setSize = (v: number) => { const c = clamp(v); sizeRef.current = c; setSizeState(c) }

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation()
    setDragging(true)
    const startPos = axis === 'x' ? e.clientX : e.clientY
    const startSize = sizeRef.current
    const move = (ev: PointerEvent) => {
      const d = (axis === 'x' ? ev.clientX : ev.clientY) - startPos
      setSize(startSize + (invert ? -d : d))
    }
    const up = () => {
      setDragging(false)
      if (key) { try { localStorage.setItem('100lights-resize-' + key, String(sizeRef.current)) } catch { /* ignore */ } }
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return { size, dragging, setSize, handleProps: { onPointerDown } }
}

export function ResizeHandle({ axis, edge, onPointerDown }: {
  axis: 'x' | 'y'
  /** which edge of the (relative) parent to sit on */
  edge: 'right' | 'left' | 'top' | 'bottom'
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const [hot, setHot] = useState(false)
  const horiz = axis === 'x'
  const pos: React.CSSProperties = horiz
    ? { top: 0, bottom: 0, width: 8, cursor: 'col-resize', [edge]: -4 }
    : { left: 0, right: 0, height: 8, cursor: 'row-resize', [edge]: -4 }
  return (
    <div
      onPointerDown={onPointerDown}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      title="Drag to resize"
      style={{
        position: 'absolute', zIndex: 6, touchAction: 'none',
        background: hot ? 'rgb(var(--accent-rgb) / 0.45)' : 'transparent',
        transition: 'background 0.12s',
        ...pos,
      }}
    />
  )
}
