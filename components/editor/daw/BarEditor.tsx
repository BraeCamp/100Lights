'use client'

// Editor for an effect bar: dial in the target sound with the shared FxControls,
// and draw the one automation graph (0 = neutral/off, 1 = your settings) that
// every active effect follows together. Graph points snap to 0 / 0.5 / 1.

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDaw } from '@/lib/daw-state'
import type { ClipEffect, RollFx, AutoPoint } from '@/lib/daw-types'
import { activeBarFields } from '@/lib/effect-bar'
import FxControls from './FxControls'
import { clampToViewport } from './menu-clamp'

const W = 300, H = 92, PAD = 8
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const SNAP = [0, 0.5, 1]
const SOUND_MODE_KEY = '100lights-sound-mode-v1'   // shared with the clip Sound panel

export default function BarEditor({ effect: atOpen, anchor, onClose }: {
  effect: ClipEffect
  anchor: { x: number; y: number }
  onClose: () => void
}) {
  const { project, dispatch } = useDaw()
  const eff = project.clipEffects?.find(e => e.id === atOpen.id) ?? atOpen
  const panelRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [mode, setMode] = useState<'basic' | 'advanced'>(() => {
    try { return localStorage.getItem(SOUND_MODE_KEY) === 'advanced' ? 'advanced' : 'basic' } catch { return 'basic' }
  })
  function toggleMode() {
    const next = mode === 'basic' ? 'advanced' : 'basic'
    setMode(next)
    try { localStorage.setItem(SOUND_MODE_KEY, next) } catch { /* storage off */ }
  }

  const dur = eff.durationBeats || 4
  const graph: AutoPoint[] = (eff.graph?.length ? eff.graph : [{ id: 'g0', t: 0, v: 1, smooth: false, h1: [0, 0], h2: [0, 0] }, { id: 'g1', t: dur, v: 1, smooth: false, h1: [0, 0], h2: [0, 0] }])
  const pts = [...graph].sort((a, b) => a.t - b.t)
  const active = activeBarFields(eff.fx)

  const xFor = (t: number) => PAD + (clamp(t, 0, dur) / dur) * (W - 2 * PAD)
  const yFor = (v: number) => PAD + (1 - clamp(v, 0, 1)) * (H - 2 * PAD)
  const tFor = (x: number) => clamp(((x - PAD) / (W - 2 * PAD)) * dur, 0, dur)
  const vFor = (y: number) => {
    let v = clamp(1 - (y - PAD) / (H - 2 * PAD), 0, 1)
    for (const s of SNAP) if (Math.abs(v - s) < 0.06) v = s   // snap to 0 / 0.5 / 1
    return v
  }

  function commitGraph(next: AutoPoint[]) {
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: eff.id, patch: { graph: next.sort((a, b) => a.t - b.t) } })
  }
  function commitFx(fx: RollFx | undefined) {
    dispatch({ type: 'UPDATE_CLIP_EFFECT', effectId: eff.id, patch: { fx: fx ?? {} } })
  }
  function localXY(e: React.PointerEvent | React.MouseEvent) {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  // Keep the panel on screen — open upward if it would run off the bottom.
  useLayoutEffect(() => { clampToViewport(panelRef.current, anchor) }, [anchor, mode])

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={panelRef}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: anchor.y, left: anchor.x,
        width: 320, maxHeight: '84vh', overflowY: 'auto', zIndex: 9999,
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
            style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 7px', borderRadius: 4, cursor: 'pointer', border: '1px solid var(--border-light)', background: mode === 'advanced' ? 'rgb(var(--accent-rgb) / 0.15)' : 'var(--bg-card)', color: mode === 'advanced' ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
            {mode === 'basic' ? 'ADVANCED ▸' : '◂ BASIC'}
          </button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>
        </div>
      </div>

      {/* Graph */}
      <div style={{ padding: '10px 12px 6px' }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--text-muted)', marginBottom: 4 }}>GRAPH — 0 = off · 1 = your settings</div>
        <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', touchAction: 'none' }}
          onDoubleClick={e => { const { x, y } = localXY(e); commitGraph([...pts, { id: crypto.randomUUID(), t: tFor(x), v: vFor(y), smooth: false, h1: [0, 0], h2: [0, 0] }]) }}
          onPointerMove={e => { if (drag !== null) { const { x, y } = localXY(e); const next = pts.map((p, i) => i === drag ? { ...p, t: tFor(x), v: vFor(y) } : p); commitGraph(next) } }}
          onPointerUp={() => setDrag(null)}
        >
          <rect x={0} y={0} width={W} height={H} fill="var(--bg-base)" rx={5} />
          <line x1={PAD} y1={yFor(0.5)} x2={W - PAD} y2={yFor(0.5)} stroke="var(--border)" strokeDasharray="2 3" />
          <polyline points={pts.map(p => `${xFor(p.t)},${yFor(p.v)}`).join(' ')} fill="none" stroke="var(--accent-light)" strokeWidth={1.5} />
          {pts.map((p, i) => (
            <circle key={p.id} cx={xFor(p.t)} cy={yFor(p.v)} r={5} fill="var(--accent-light)" stroke="#000" strokeWidth={0.5} style={{ cursor: 'grab' }}
              onPointerDown={e => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i) }}
              onDoubleClick={e => { e.stopPropagation(); if (pts.length > 2) commitGraph(pts.filter((_, j) => j !== i)) }} />
          ))}
        </svg>
        <div style={{ fontSize: 8.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 2 }}>double-click to add a point · dbl-click a point to remove · snaps to 0 / ½ / 1</div>
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
