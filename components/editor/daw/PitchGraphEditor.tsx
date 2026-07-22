'use client'

// Per-effect pitch → amount curves. X = note pitch, Y = the effect amount that
// note gets (0–1, same as a slider position). Drag points; double-click empty
// space to add, double-click a point to remove. Used in the preset creator so
// a sound can, e.g., dim its brightness as notes are pitched up.

import { useRef, useState } from 'react'
import type { PitchGraph, PitchGraphTarget } from '@/lib/daw-types'
import { FX_FIELD_BY_KEY, GRAPH_TARGETS, pitchGraphValue, defaultPitchGraph } from '@/lib/roll-fx'

const W = 264, H = 84, PAD = 8
const LO = 21, HI = 108   // A0 … C8
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (p: number) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const xForPitch = (p: number) => PAD + ((clamp(p, LO, HI) - LO) / (HI - LO)) * (W - 2 * PAD)
const pitchForX = (x: number) => Math.round(LO + ((x - PAD) / (W - 2 * PAD)) * (HI - LO))
const yForAmt = (a: number) => PAD + (1 - clamp(a, 0, 1)) * (H - 2 * PAD)
const amtForY = (y: number) => clamp(1 - (y - PAD) / (H - 2 * PAD), 0, 1)

export default function PitchGraphEditor({ graphs, onChange, idGen }: {
  graphs: PitchGraph[]
  onChange: (g: PitchGraph[]) => void
  idGen: () => string
}) {
  const used = new Set(graphs.map(g => g.target))
  const available = GRAPH_TARGETS.filter(t => !used.has(t))

  function update(id: string, patch: Partial<PitchGraph>) {
    onChange(graphs.map(g => (g.id === id ? { ...g, ...patch } : g)))
  }
  function addGraph(target: PitchGraphTarget) {
    onChange([...graphs, defaultPitchGraph(target, idGen())])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {graphs.map(g => (
        <GraphCard key={g.id} graph={g}
          onPatch={p => update(g.id, p)}
          onRemove={() => onChange(graphs.filter(x => x.id !== g.id))}
          onRetarget={t => update(g.id, { target: t })}
          available={available} />
      ))}

      {available.length > 0 && (
        <select
          value=""
          onChange={e => { if (e.target.value) addGraph(e.target.value as PitchGraphTarget) }}
          style={{ fontSize: 11, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px dashed var(--border)' }}
        >
          <option value="">+ Add a pitch graph…</option>
          {available.map(t => <option key={t} value={t}>{FX_FIELD_BY_KEY[t].label}</option>)}
        </select>
      )}
      {graphs.length === 0 && (
        <p style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Optional. A graph makes one effect vary by note pitch — e.g. add a <em>Low-pass</em> graph
          that falls as pitch rises, so pitched-up notes don’t get harsh.
        </p>
      )}
    </div>
  )
}

function GraphCard({ graph, onPatch, onRemove, onRetarget, available }: {
  graph: PitchGraph
  onPatch: (p: Partial<PitchGraph>) => void
  onRemove: () => void
  onRetarget: (t: PitchGraphTarget) => void
  available: PitchGraphTarget[]
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const field = FX_FIELD_BY_KEY[graph.target]
  const pts = [...graph.points].sort((a, b) => a.pitch - b.pitch)

  function localXY(e: React.PointerEvent | React.MouseEvent) {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  function movePoint(i: number, x: number, y: number) {
    const next = pts.map((p, j) => j === i ? { pitch: pitchForX(x), amount: amtForY(y) } : p)
    onPatch({ points: next })
  }
  function addAt(e: React.MouseEvent) {
    const { x, y } = localXY(e)
    onPatch({ points: [...pts, { pitch: pitchForX(x), amount: amtForY(y) }].sort((a, b) => a.pitch - b.pitch) })
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-card)', padding: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <input type="checkbox" checked={graph.enabled} onChange={e => onPatch({ enabled: e.target.checked })} title="Enable this graph" />
        <select value={graph.target} onChange={e => onRetarget(e.target.value as PitchGraphTarget)}
          style={{ fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 5, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
          <option value={graph.target}>{field.label}</option>
          {available.map(t => <option key={t} value={t}>{FX_FIELD_BY_KEY[t].label}</option>)}
        </select>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>pitch → amount</span>
        <button onClick={onRemove} title="Remove graph" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}>×</button>
      </div>

      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', touchAction: 'none', opacity: graph.enabled ? 1 : 0.45 }}
        onDoubleClick={addAt}
        onPointerMove={e => { if (drag !== null) { const { x, y } = localXY(e); movePoint(drag, x, y) } }}
        onPointerUp={e => { if (drag !== null) { (e.target as Element).releasePointerCapture?.(e.pointerId) } setDrag(null) }}
      >
        <rect x={0} y={0} width={W} height={H} fill="var(--bg-base)" rx={5} />
        {/* mid gridline */}
        <line x1={PAD} y1={yForAmt(0.5)} x2={W - PAD} y2={yForAmt(0.5)} stroke="var(--border)" strokeDasharray="2 3" />
        <polyline
          points={pts.map(p => `${xForPitch(p.pitch)},${yForAmt(p.amount)}`).join(' ')}
          fill="none" stroke="var(--accent-light)" strokeWidth={1.5} />
        {pts.map((p, i) => (
          <circle key={i} cx={xForPitch(p.pitch)} cy={yForAmt(p.amount)} r={5}
            fill="var(--accent-light)" stroke="#000" strokeWidth={0.5} style={{ cursor: 'grab' }}
            onPointerDown={e => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i) }}
            onDoubleClick={e => { e.stopPropagation(); if (pts.length > 1) onPatch({ points: pts.filter((_, j) => j !== i) }) }}>
            <title>{`${noteName(p.pitch)} → ${field.fmt(pitchGraphValue(graph.target, p.amount))}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: 'var(--text-muted)', padding: '2px 2px 0' }}>
        <span>{noteName(LO)}</span>
        <span>double-click to add · dbl-click a dot to remove</span>
        <span>{noteName(HI)}</span>
      </div>
    </div>
  )
}
