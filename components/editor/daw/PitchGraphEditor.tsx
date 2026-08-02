'use client'

// Per-effect pitch → amount curves. X = note pitch, Y = the effect amount that
// note gets (0–1, same as a slider position). Drag points; double-click empty
// space to add, double-click a point to remove. Used in the preset creator so
// a sound can, e.g., dim its brightness as notes are pitched up.

import { useRef, useState } from 'react'
import type { PitchGraph, PitchGraphTarget } from '@/lib/daw-types'
import { FX_FIELD_BY_KEY, GRAPH_TARGETS, pitchGraphValue, defaultPitchGraph } from '@/lib/roll-fx'

const W = 264, H = 84, PAD = 8
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (p: number) => `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}`
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// X-axis range depends on the graph source: MIDI pitch A0…C8, or velocity 0…127.
const PITCH_LO = 21, PITCH_HI = 108
const rangeFor = (src?: string) => src === 'velocity' ? { lo: 0, hi: 127 } : { lo: PITCH_LO, hi: PITCH_HI }
const xForVal = (v: number, lo: number, hi: number) => PAD + ((clamp(v, lo, hi) - lo) / (hi - lo)) * (W - 2 * PAD)
const valForX = (x: number, lo: number, hi: number) => Math.round(lo + ((x - PAD) / (W - 2 * PAD)) * (hi - lo))
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
  const [drawMode, setDrawMode] = useState(false)
  const painting = useRef(false)
  const buckets = useRef<Map<number, number>>(new Map())
  const field = FX_FIELD_BY_KEY[graph.target]
  const pts = [...graph.points].sort((a, b) => a.pitch - b.pitch)
  const isVel = graph.source === 'velocity'
  const { lo: LO, hi: HI } = rangeFor(graph.source)
  const xLabel = (v: number) => isVel ? `${v}` : noteName(v)

  function localXY(e: React.PointerEvent | React.MouseEvent) {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width * W, y: (e.clientY - r.top) / r.height * H }
  }
  function movePoint(i: number, x: number, y: number) {
    const next = pts.map((p, j) => j === i ? { pitch: valForX(x, LO, HI), amount: amtForY(y) } : p)
    onPatch({ points: next })
  }
  function addAt(e: React.MouseEvent) {
    const { x, y } = localXY(e)
    onPatch({ points: [...pts, { pitch: valForX(x, LO, HI), amount: amtForY(y) }].sort((a, b) => a.pitch - b.pitch) })
  }
  // Freehand: drag across to draw the curve. Points are bucketed by x, so a
  // stroke leaves an even trail; the stroke replaces the graph.
  function paint(e: React.PointerEvent) {
    const { x, y } = localXY(e)
    buckets.current.set(valForX(x, LO, HI), amtForY(y))
    const arr = [...buckets.current.entries()].sort((a, b) => a[0] - b[0]).map(([pitch, amount]) => ({ pitch, amount }))
    if (arr.length === 1) arr.push({ pitch: HI, amount: arr[0].amount })
    onPatch({ points: arr })
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
        <button onClick={() => onPatch({ source: isVel ? 'pitch' : 'velocity' })} title="Switch what drives this graph"
          style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 5, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)' }}>
          {isVel ? 'velocity' : 'pitch'} →
        </button>
        <button onClick={() => setDrawMode(d => !d)} title={drawMode ? 'Drawing — drag across to sketch the curve' : 'Draw the curve freehand'}
          style={{ background: drawMode ? 'rgb(var(--accent-rgb) / 0.18)' : 'none', border: `1px solid ${drawMode ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 5, color: drawMode ? 'var(--accent-light)' : 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '1px 6px' }}>✎</button>
        <button onClick={onRemove} title="Remove graph" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 12, padding: '0 2px' }}>×</button>
      </div>

      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', touchAction: 'none', opacity: graph.enabled ? 1 : 0.45, cursor: drawMode ? 'crosshair' : 'default' }}
        onDoubleClick={drawMode ? undefined : addAt}
        onPointerDown={e => { if (drawMode) { painting.current = true; buckets.current = new Map(); svgRef.current?.setPointerCapture?.(e.pointerId); paint(e) } }}
        onPointerMove={e => { if (drawMode && painting.current) { paint(e) } else if (drag !== null) { const { x, y } = localXY(e); movePoint(drag, x, y) } }}
        onPointerUp={e => { painting.current = false; if (drag !== null) { (e.target as Element).releasePointerCapture?.(e.pointerId) } setDrag(null) }}
      >
        <rect x={0} y={0} width={W} height={H} fill="var(--bg-base)" rx={5} />
        {/* mid gridline */}
        <line x1={PAD} y1={yForAmt(0.5)} x2={W - PAD} y2={yForAmt(0.5)} stroke="var(--border)" strokeDasharray="2 3" />
        <polyline
          points={pts.map(p => `${xForVal(p.pitch, LO, HI)},${yForAmt(p.amount)}`).join(' ')}
          fill="none" stroke="var(--accent-light)" strokeWidth={1.5} />
        {pts.map((p, i) => (
          <circle key={i} cx={xForVal(p.pitch, LO, HI)} cy={yForAmt(p.amount)} r={drawMode ? 2.5 : 5}
            fill="var(--accent-light)" stroke="#000" strokeWidth={0.5} style={{ cursor: 'grab', pointerEvents: drawMode ? 'none' : undefined }}
            onPointerDown={e => { e.stopPropagation(); (e.target as Element).setPointerCapture?.(e.pointerId); setDrag(i) }}
            onDoubleClick={e => { e.stopPropagation(); if (pts.length > 1) onPatch({ points: pts.filter((_, j) => j !== i) }) }}>
            <title>{`${isVel ? `vel ${p.pitch}` : noteName(p.pitch)} → ${field.fmt(pitchGraphValue(graph.target, p.amount))}`}</title>
          </circle>
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: 'var(--text-muted)', padding: '2px 2px 0' }}>
        <span>{isVel ? 'soft' : xLabel(LO)}</span>
        <span>{drawMode ? 'drag across to draw the curve' : '✎ to draw · double-click to add a point'}</span>
        <span>{isVel ? 'hard' : xLabel(HI)}</span>
      </div>
    </div>
  )
}
