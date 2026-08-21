'use client'

import { useRef, useEffect, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import type { AutomationLane, AutomationPoint } from '@/lib/daw-types'

interface AutomationLaneViewProps {
  lane: AutomationLane
  beatWidth: number       // pixels per beat
  viewStartBeat: number   // scrolled position in beats
  height: number          // lane height in px
}

export default function AutomationLaneView({
  lane,
  beatWidth,
  viewStartBeat,
  height,
}: AutomationLaneViewProps) {
  const { dispatch, playing, position } = useDaw()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafIdRef = useRef<number | null>(null)
  // drawRef always holds the latest draw closure so RAF / ResizeObserver
  // can call it without stale captures.
  const drawRef = useRef<() => void>(() => {})
  const [draggingPointId, setDraggingPointId] = useState<string | null>(null)
  const [drawMode, setDrawMode] = useState(false)

  // ── Coordinate helpers ──────────────────────────────────────────────────
  // These are kept as plain functions (not callbacks) because they are only
  // called from event handlers that already run inside a render closure.

  function beatToX(beat: number): number {
    return (beat - viewStartBeat) * beatWidth
  }

  function valueToY(value: number, canvasH: number): number {
    // value is 0..1; y=0 is top (maximum)
    return canvasH - value * canvasH
  }

  function xToBeat(x: number): number {
    return viewStartBeat + x / beatWidth
  }

  function yToValue(y: number, canvasH: number): number {
    return Math.max(0, Math.min(1, 1 - y / canvasH))
  }

  // ── Keep drawRef current after every render ─────────────────────────────
  // No dependency array: runs after every render so the closure always
  // reflects the latest lane, zoom, scroll, dragging state, and transport.
  useEffect(() => {
    drawRef.current = () => {
      const canvas = canvasRef.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const w = canvas.width / dpr
      const h = canvas.height / dpr

      // Background
      ctx.fillStyle = '#1a1a1a'
      ctx.fillRect(0, 0, w, h)

      // Default-value guide line (normalized from raw defaultValue)
      const defaultNorm =
        lane.max === lane.min
          ? 0.5
          : (lane.defaultValue - lane.min) / (lane.max - lane.min)
      const defaultY = h - defaultNorm * h
      ctx.save()
      ctx.strokeStyle = 'rgba(255,255,255,0.12)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(0, defaultY)
      ctx.lineTo(w, defaultY)
      ctx.stroke()
      ctx.restore()

      // Sort points by beat for correct curve drawing
      const sorted = [...lane.points].sort((a, b) => a.beat - b.beat)

      // Automation curve — grayed while the lane is OVERRIDDEN (a control was
      // touched by hand): the curve is still there, it just isn't driving
      // playback until automation is re-enabled.
      ctx.save()
      ctx.strokeStyle = lane.overridden ? 'rgba(160,160,170,0.55)' : '#3d8fef'
      ctx.lineWidth = 1.5
      ctx.beginPath()

      if (sorted.length === 0) {
        // No points: flat line at default value
        ctx.moveTo(0, defaultY)
        ctx.lineTo(w, defaultY)
      } else {
        const first = sorted[0]
        const firstX = (first.beat - viewStartBeat) * beatWidth
        const firstY = h - first.value * h
        // Extend flat from left edge to first point
        ctx.moveTo(0, firstY)
        ctx.lineTo(firstX, firstY)

        for (const pt of sorted) {
          ctx.lineTo((pt.beat - viewStartBeat) * beatWidth, h - pt.value * h)
        }

        // Extend flat from last point to right edge
        const last = sorted[sorted.length - 1]
        ctx.lineTo(w, h - last.value * h)
      }
      ctx.stroke()
      ctx.restore()

      // Point circles
      for (const pt of sorted) {
        const px = (pt.beat - viewStartBeat) * beatWidth
        const py = h - pt.value * h
        ctx.save()
        ctx.beginPath()
        ctx.arc(px, py, 5, 0, Math.PI * 2)
        ctx.fillStyle = pt.id === draggingPointId ? '#7ab8f5' : '#3d8fef'
        ctx.fill()
        ctx.strokeStyle = '#141414'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.restore()
      }

      // Playhead
      if (playing) {
        const phX = (position - viewStartBeat) * beatWidth
        if (phX >= 0 && phX <= w) {
          ctx.save()
          ctx.strokeStyle = 'rgba(255,255,255,0.7)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(phX, 0)
          ctx.lineTo(phX, h)
          ctx.stroke()
          ctx.restore()
        }
      }
    }
  })

  // ── Draw on lane / zoom / scroll / drag changes ─────────────────────────
  useEffect(() => {
    if (!playing) drawRef.current()
    // When playing, the RAF loop below handles redraws continuously.
  }, [lane, beatWidth, viewStartBeat, height, draggingPointId, playing])

  // ── RAF loop for smooth playhead animation ──────────────────────────────
  useEffect(() => {
    if (!playing) {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
      drawRef.current()
      return
    }

    const loop = () => {
      drawRef.current()
      rafIdRef.current = requestAnimationFrame(loop)
    }
    rafIdRef.current = requestAnimationFrame(loop)
    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current)
        rafIdRef.current = null
      }
    }
  }, [playing])

  // ── Canvas buffer sizing via ResizeObserver ─────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const dpr = window.devicePixelRatio || 1
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const cssW = Math.round(entry.contentRect.width)
        const cssH = Math.round(entry.contentRect.height)
        const newW = (cssW || 1) * dpr
        const newH = (cssH || 1) * dpr
        if (canvas.width !== newW || canvas.height !== newH) {
          canvas.width  = newW
          canvas.height = newH
          canvas.style.width  = `${cssW}px`
          canvas.style.height = `${cssH}px`
          drawRef.current()
        }
      }
    })
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [])

  // ── Point hit-test ──────────────────────────────────────────────────────
  function findNearbyPoint(x: number, y: number): AutomationPoint | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const dpr = window.devicePixelRatio || 1
    const h = canvas.height / dpr
    for (const pt of lane.points) {
      const px = (pt.beat - viewStartBeat) * beatWidth
      const py = h - pt.value * h
      if (Math.sqrt((x - px) ** 2 + (y - py) ** 2) <= 8) return pt
    }
    return null
  }

  // ── Freehand draw (pencil) ──────────────────────────────────────────────
  // Drag to paint the curve. Points are bucketed by x (~6px) so a stroke leaves
  // an even trail; any pre-existing points under the painted beat-range are
  // replaced, points outside it are kept. One lane-level dispatch per move.
  function startFreehand(e: React.MouseEvent<HTMLCanvasElement>): void {
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()
    const dpr = window.devicePixelRatio || 1
    const base = [...lane.points]
    const buckets = new Map<number, AutomationPoint>()
    const sample = (clientX: number, clientY: number) => {
      const r = canvas.getBoundingClientRect()
      const x = clientX - r.left, y = clientY - r.top
      const bucket = Math.round(x / 6)
      const prev = buckets.get(bucket)
      buckets.set(bucket, {
        id: prev?.id ?? crypto.randomUUID(),
        beat: Math.max(0, xToBeat(x)),
        value: yToValue(y, canvas.height / dpr),
      })
      const drawn = [...buckets.values()]
      const beats = drawn.map(p => p.beat)
      const minB = Math.min(...beats), maxB = Math.max(...beats)
      const kept = base.filter(p => p.beat < minB || p.beat > maxB)
      dispatch({ type: 'UPDATE_AUTOMATION_LANE', laneId: lane.id, patch: { points: [...kept, ...drawn] } })
    }
    sample(e.clientX, e.clientY)
    const onMove = (ev: MouseEvent) => sample(ev.clientX, ev.clientY)
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  // ── Mouse handlers ──────────────────────────────────────────────────────
  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>): void {
    if (e.button !== 0) return
    e.preventDefault()
    if (drawMode) { startFreehand(e); return }
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const nearby = findNearbyPoint(x, y)
    if (nearby) {
      const ptId = nearby.id
      setDraggingPointId(ptId)
      function onMove(ev: MouseEvent) {
        const r = canvas!.getBoundingClientRect()
        dispatch({
          type: 'UPDATE_AUTOMATION_POINT',
          laneId: lane.id,
          pointId: ptId,
          patch: {
            beat:  Math.max(0, xToBeat(ev.clientX - r.left)),
            value: yToValue(ev.clientY - r.top, canvas!.height / dpr),
          },
        })
      }
      function onUp() {
        setDraggingPointId(null)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      return
    }

    const newPoint: AutomationPoint = {
      id: crypto.randomUUID(),
      beat: xToBeat(x),
      value: yToValue(y, canvas.height / dpr),
    }
    dispatch({ type: 'ADD_AUTOMATION_POINT', laneId: lane.id, point: newPoint })
  }

  function handleContextMenu(e: React.MouseEvent<HTMLCanvasElement>): void {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const nearby = findNearbyPoint(
      e.clientX - rect.left,
      e.clientY - rect.top,
    )
    if (nearby) {
      dispatch({
        type: 'REMOVE_AUTOMATION_POINT',
        laneId: lane.id,
        pointId: nearby.id,
      })
    }
  }

  // ── Render (caller provides the lane header) ───────────────────────────
  return (
    <div style={{ position: 'relative', width: '100%', height }}>
      <canvas
        ref={canvasRef}
        height={height}
        onMouseDown={handleMouseDown}
        onContextMenu={handleContextMenu}
        style={{
          display: 'block',
          width: '100%',
          height,
          cursor: draggingPointId ? 'grabbing' : drawMode ? 'crosshair' : 'crosshair',
          userSelect: 'none',
        }}
      />
      {/* Pencil: toggle freehand drawing of the curve */}
      <button
        onClick={() => setDrawMode(d => !d)}
        title={drawMode ? 'Drawing — drag to paint the curve. Click to stop.' : 'Draw the curve freehand'}
        aria-pressed={drawMode}
        style={{
          position: 'absolute', top: 3, right: 3, width: 20, height: 20, padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          borderRadius: 4, cursor: 'pointer',
          border: `1px solid ${drawMode ? 'var(--accent)' : 'var(--border)'}`,
          background: drawMode ? 'rgb(var(--accent-rgb) / 0.22)' : 'rgba(0,0,0,0.35)',
          color: drawMode ? 'var(--accent-light)' : 'var(--text-muted)',
        }}
      >
        <Pencil size={11} />
      </button>
    </div>
  )
}
