'use client'

// Editor for an effect bar: dial in the target sound with the shared FxControls,
// and draw the one automation graph (0 = neutral/off, 1 = your settings) that
// every active effect follows together. Graph points snap to 0 / 0.5 / 1.
//
// 2026-08-18 (Brae): points drag by ID and CLAMP between their neighbours (a
// point you drag past another used to swap identities mid-drag and yank the
// other point around); the graph zooms (wheel or ±) and pans when zoomed; the
// playhead is drawn live while the transport crosses the bar; and the card
// itself grows with the window instead of a fixed 320px.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, ChevronLeft, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import type { ClipEffect, RollFx, AutoPoint } from '@/lib/daw-types'
import { activeBarFields } from '@/lib/effect-bar'
import FxControls from './FxControls'
import { clampToViewport } from './menu-clamp'

const PAD = 8
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const SNAP = [0, 0.5, 1]
const MIN_GAP_FRAC = 0.004        // neighbouring points keep at least this t-gap (× dur)
const SOUND_MODE_KEY = '100lights-sound-mode-v1'   // shared with the clip Sound panel

export default function BarEditor({ effect: atOpen, anchor, onClose }: {
  effect: ClipEffect
  anchor: { x: number; y: number }
  onClose: () => void
}) {
  const { project, dispatch, engine } = useDaw()
  const eff = project.clipEffects?.find(e => e.id === atOpen.id) ?? atOpen
  const panelRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [mode, setMode] = useState<'basic' | 'advanced'>(() => {
    try { return localStorage.getItem(SOUND_MODE_KEY) === 'advanced' ? 'advanced' : 'basic' } catch { return 'basic' }
  })
  function toggleMode() {
    const next = mode === 'basic' ? 'advanced' : 'basic'
    setMode(next)
    try { localStorage.setItem(SOUND_MODE_KEY, next) } catch { /* storage off */ }
  }

  // ── responsive card + graph size (grows with the window) ──────────────────
  const cardW = typeof window === 'undefined' ? 320 : Math.round(clamp(window.innerWidth * 0.34, 320, 520))
  const W = cardW - 24                                   // svg drawing width (card padding)
  const H = typeof window === 'undefined' ? 92 : Math.round(clamp(window.innerHeight * 0.16, 92, 170))

  // ── zoom / pan over the t axis ────────────────────────────────────────────
  const [zoom, setZoom] = useState(1)                    // 1×..8×
  const [pan, setPan] = useState(0)                      // 0..1−1/zoom (fraction of dur)
  const clampPan = (p: number, z: number) => clamp(p, 0, 1 - 1 / z)

  const dur = eff.durationBeats || 4
  const graph: AutoPoint[] = (eff.graph?.length ? eff.graph : [{ id: 'g0', t: 0, v: 1, smooth: false, h1: [0, 0], h2: [0, 0] }, { id: 'g1', t: dur, v: 1, smooth: false, h1: [0, 0], h2: [0, 0] }])
  const pts = [...graph].sort((a, b) => a.t - b.t)
  const active = activeBarFields(eff.fx)

  const xFor = (t: number) => PAD + ((clamp(t, 0, dur) / dur - pan) * zoom) * (W - 2 * PAD)
  const yFor = (v: number) => PAD + (1 - clamp(v, 0, 1)) * (H - 2 * PAD)
  const tFor = (x: number) => clamp((((x - PAD) / (W - 2 * PAD)) / zoom + pan) * dur, 0, dur)
  const vFor = (y: number) => {
    let v = clamp(1 - (y - PAD) / (H - 2 * PAD), 0, 1)
    for (const s of SNAP) if (Math.abs(v - s) < 0.06) v = s   // snap to 0 / 0.5 / 1
    return v
  }

  function commitGraph(next: AutoPoint[]) {
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: eff.id, patch: { graph: [...next].sort((a, b) => a.t - b.t) } })
  }
  function commitFx(fx: RollFx | undefined) {
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: eff.id, patch: { fx: fx ?? {} } })
  }
  function localXY(e: React.PointerEvent | React.MouseEvent | WheelEvent) {
    const r = svgRef.current!.getBoundingClientRect()
    // the svg is drawn at its intrinsic size, but guard against CSS scaling
    const sx = W / r.width, sy = H / r.height
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy }
  }

  // Drag by ID, clamped between the point's neighbours — crossing another
  // point stops at it instead of silently grabbing it.
  function movePoint(id: string, x: number, y: number) {
    const i = pts.findIndex(p => p.id === id)
    if (i === -1) return
    const gap = dur * MIN_GAP_FRAC
    const lo = i > 0 ? pts[i - 1].t + gap : 0
    const hi = i < pts.length - 1 ? pts[i + 1].t - gap : dur
    const t = clamp(tFor(x), lo, Math.max(lo, hi))
    commitGraph(pts.map(p => p.id === id ? { ...p, t, v: vFor(y) } : p))
  }

  // Wheel: zoom around the cursor; horizontal wheel pans when zoomed in.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        setPan(p => clampPan(p + (e.deltaX / (W - 2 * PAD)) / zoom, zoom))
        return
      }
      const { x } = localXY(e)
      const frac = clamp((x - PAD) / (W - 2 * PAD), 0, 1)      // cursor position in view
      const tAt = frac / zoom + pan                              // dur-fraction under cursor
      const z = clamp(zoom * Math.exp(-e.deltaY * 0.0015), 1, 8)
      setZoom(z)
      setPan(clampPan(tAt - frac / z, z))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, pan, W])

  // Live playhead: while the transport is inside this bar, draw where it is.
  const [playT, setPlayT] = useState<number | null>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const beat = (engine as { currentBeat?: number })?.currentBeat
      const t = beat != null ? beat - eff.startBeat : null
      setPlayT(t != null && t >= 0 && t <= dur ? t : null)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [engine, eff.startBeat, dur])

  // Keep the panel on screen — open upward if it would run off the bottom.
  useLayoutEffect(() => { clampToViewport(panelRef.current, anchor) }, [anchor, mode])

  const zBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 18,
    borderRadius: 4, border: '1px solid var(--border-light)', background: 'var(--bg-card)',
    color: 'var(--text-secondary)', cursor: 'pointer', padding: 0,
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={panelRef}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: anchor.y, left: anchor.x,
        width: cardW, maxHeight: '86vh', overflowY: 'auto', zIndex: 9999,
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10,
        boxShadow: '0 14px 40px rgba(0,0,0,0.7)', padding: '0 0 10px',
      }}
    >
      <div style={{ position: 'sticky', top: 0, background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', zIndex: 2 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-primary)' }}>
          EFFECT BAR{active.length ? ` · ${active.length} on` : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={toggleMode}
            title={mode === 'basic' ? 'Show all effects' : 'Show just the essentials'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: mode === 'advanced' ? 'rgb(var(--accent-rgb) / 0.15)' : 'var(--bg-card)', color: mode === 'advanced' ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
            {mode === 'basic' ? <>ADVANCED <ChevronRight size={10} /></> : <><ChevronLeft size={10} /> BASIC</>}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><X size={14} /></button>
        </div>
      </div>

      {/* Graph */}
      <div style={{ padding: '10px 12px 6px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)' }}>GRAPH — 0 = off · 1 = your settings</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <button style={zBtn} title="Zoom out" onClick={() => { const z = clamp(zoom / 1.5, 1, 8); setZoom(z); setPan(p => clampPan(p, z)) }}><ZoomOut size={11} /></button>
            <span style={{ fontSize: 8.5, color: 'var(--text-muted)', minWidth: 24, textAlign: 'center' }}>{zoom.toFixed(1)}×</span>
            <button style={zBtn} title="Zoom in (wheel over the graph works too)" onClick={() => { const z = clamp(zoom * 1.5, 1, 8); setZoom(z) }}><ZoomIn size={11} /></button>
          </span>
        </div>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', touchAction: 'none' }}
          onDoubleClick={e => { const { x, y } = localXY(e); commitGraph([...pts, { id: crypto.randomUUID(), t: tFor(x), v: vFor(y), smooth: false, h1: [0, 0], h2: [0, 0] }]) }}
          onPointerMove={e => { if (dragId !== null) { const { x, y } = localXY(e); movePoint(dragId, x, y) } }}
          onPointerUp={() => setDragId(null)}
        >
          <rect x={0} y={0} width={W} height={H} fill="var(--bg-base)" rx={5} />
          <line x1={PAD} y1={yFor(0.5)} x2={W - PAD} y2={yFor(0.5)} stroke="var(--border)" strokeDasharray="2 3" />
          {playT != null && (
            <line x1={xFor(playT)} y1={2} x2={xFor(playT)} y2={H - 2} stroke="#ef4444" strokeWidth={1.2} opacity={0.9} />
          )}
          <polyline points={pts.map(p => `${xFor(p.t)},${yFor(p.v)}`).join(' ')} fill="none" stroke="var(--accent-light)" strokeWidth={1.5} />
          {pts.map(p => (
            <circle key={p.id} cx={xFor(p.t)} cy={yFor(p.v)} r={5} fill={p.id === dragId ? '#fff' : 'var(--accent-light)'} stroke="#000" strokeWidth={0.5} style={{ cursor: 'grab' }}
              onPointerDown={e => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDragId(p.id) }}
              onDoubleClick={e => { e.stopPropagation(); if (pts.length > 2) commitGraph(pts.filter(q => q.id !== p.id)) }} />
          ))}
        </svg>
        <div style={{ fontSize: 8.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 2 }}>double-click to add a point · dbl-click a point to remove · snaps to 0 / ½ / 1 · wheel = zoom</div>
      </div>

      {/* Sound settings (targets) */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 4 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', padding: '4px 12px 2px' }}>EFFECTS (tick any to activate)</div>
        <FxControls value={eff.fx} onCommit={commitFx} hideCats={['env', 'pitch']} mode={mode} />
      </div>
    </div>,
    document.body,
  )
}
