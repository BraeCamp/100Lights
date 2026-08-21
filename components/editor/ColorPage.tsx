'use client'

// The Color page — Resolve's grading model:
//   • the playhead's clip is the graded clip (thumbnail strip auto-selects it)
//   • corrections live in an ordered chain of NODES, per clip
//   • a second chain (the "look") applies to the whole timeline
//   • stills capture a grade + reference frame; copy grades between clips
// Every control writes GradeNodes, which lib/video-export/grade-gl renders in
// both the preview overlay and the export compositor — one code path, so what
// is graded here is what renders.

import { useCallback, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Copy, Camera, Power } from 'lucide-react'
import type { GradeNode, GradeWheel, GradeCurvePoint, TimelineItem } from '@/lib/editor-types'
import { defaultGradeNode, gradeNodeIsNeutral } from '@/lib/editor-types'

export interface ColorStill {
  id: string
  label: string
  thumb: string          // data URL
  nodes: GradeNode[]     // the clip chain captured with it
}

interface Props {
  clips: TimelineItem[]              // gradeable clips, timeline order
  activeClipId: string | null
  onSelectClip: (id: string) => void
  onClipNodesChange: (clipId: string, nodes: GradeNode[]) => void
  lookNodes: GradeNode[]
  onLookNodesChange: (nodes: GradeNode[]) => void
  stills: ColorStill[]
  onStillsChange: (s: ColorStill[]) => void
  /** Grab the current viewer frame as a data URL (for stills). */
  grabFrame?: () => string | null
  /** Live scopes panel (already exists in the editor) rendered alongside. */
  scopes?: React.ReactNode
}

// ── Wheel control: a trackpad-style pad for r/g/b push + a master slider ─────
function WheelPad({ label, value, onChange }: { label: string; value: GradeWheel; onChange: (w: GradeWheel) => void }) {
  const padRef = useRef<HTMLDivElement>(null)
  const drag = useRef(false)

  // Pad position encodes hue direction: x → red↔cyan, y → blue↔yellow.
  const px = 0.5 + (value.r - (value.g + value.b) / 2) * 1.6
  const py = 0.5 - (value.b - (value.r + value.g) / 2) * 1.6

  const applyFromPoint = useCallback((clientX: number, clientY: number) => {
    const el = padRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
    const ny = Math.min(1, Math.max(0, (clientY - r.top) / r.height))
    const dx = (nx - 0.5) / 1.6
    const dy = -(ny - 0.5) / 1.6
    // Convert the 2-axis push back into an RGB triple summing to ~0
    onChange({ ...value, r: dx - dy / 3, g: -dx / 2 - dy / 3, b: dy - dx / 6 })
  }, [onChange, value])

  const isNeutral = value.r === 0 && value.g === 0 && value.b === 0 && value.y === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
      <div
        ref={padRef}
        onPointerDown={e => { drag.current = true; e.currentTarget.setPointerCapture(e.pointerId); applyFromPoint(e.clientX, e.clientY) }}
        onPointerMove={e => { if (drag.current) applyFromPoint(e.clientX, e.clientY) }}
        onPointerUp={() => { drag.current = false }}
        onDoubleClick={() => onChange({ r: 0, g: 0, b: 0, y: value.y })}
        title={`${label} — drag to push color, double-click to reset`}
        style={{
          width: 92, height: 92, borderRadius: '50%', position: 'relative', cursor: 'crosshair',
          background: 'conic-gradient(from 90deg, #ff5a5a, #ffe066, #6bff8f, #66e6ff, #7a7aff, #ff6bd6, #ff5a5a)',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ position: 'absolute', inset: 8, borderRadius: '50%', background: 'var(--bg-surface)', opacity: 0.72 }} />
        <div style={{
          position: 'absolute', left: `${px * 100}%`, top: `${py * 100}%`, width: 10, height: 10,
          marginLeft: -5, marginTop: -5, borderRadius: '50%',
          background: '#fff', border: '1.5px solid #000', boxShadow: '0 0 4px rgba(0,0,0,0.6)', pointerEvents: 'none',
        }} />
      </div>
      <input
        type="range" min={-0.5} max={0.5} step={0.005} value={value.y}
        onChange={e => onChange({ ...value, y: Number(e.target.value) })}
        onDoubleClick={() => onChange({ ...value, y: 0 })}
        className="cf-slider" style={{ width: 92, height: 4 }}
        title={`${label} master`}
      />
      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: isNeutral ? 'var(--text-muted)' : 'var(--accent)' }}>
        {label}
      </span>
    </div>
  )
}

function NumRow({ label, value, min, max, step = 0.01, neutral, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; neutral: number; onChange: (v: number) => void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 10, width: 62, color: 'var(--text-secondary)' }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} className="cf-slider" style={{ flex: 1, height: 4 }}
        onChange={e => onChange(Number(e.target.value))} onDoubleClick={() => onChange(neutral)} />
      <span style={{ fontSize: 10, width: 40, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: value === neutral ? 'var(--text-muted)' : 'var(--text-primary)' }}>
        {value.toFixed(2)}
      </span>
    </div>
  )
}

// ── Luma curve editor: drag control points on a 0..1 graph ──────────────────
function CurveEditor({ points, onChange }: { points: GradeCurvePoint[]; onChange: (p: GradeCurvePoint[]) => void }) {
  const size = 150
  const ref = useRef<SVGSVGElement>(null)
  const dragIdx = useRef<number | null>(null)
  const pts = useMemo(
    () => (points.length >= 2 ? points : [{ x: 0, y: 0 }, { x: 1, y: 1 }]),
    [points])

  const toLocal = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)),
    }
  }

  const path = useMemo(() => {
    const sorted = [...pts].sort((a, b) => a.x - b.x)
    return sorted.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x * size} ${(1 - p.y) * size}`).join(' ')
  }, [pts])

  return (
    <svg
      ref={ref} width={size} height={size}
      style={{ background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 4, touchAction: 'none' }}
      onPointerDown={e => {
        const { x, y } = toLocal(e)
        const hit = pts.findIndex(p => Math.hypot(p.x - x, p.y - y) < 0.07)
        if (hit >= 0) { dragIdx.current = hit; e.currentTarget.setPointerCapture(e.pointerId); return }
        const next = [...pts, { x, y }].sort((a, b) => a.x - b.x)
        onChange(next)
        dragIdx.current = next.findIndex(p => p.x === x && p.y === y)
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={e => {
        if (dragIdx.current === null) return
        const { x, y } = toLocal(e)
        const next = pts.map((p, i) => i === dragIdx.current ? { x, y } : p).sort((a, b) => a.x - b.x)
        onChange(next)
      }}
      onPointerUp={() => { dragIdx.current = null }}
      onDoubleClick={() => onChange([{ x: 0, y: 0 }, { x: 1, y: 1 }])}
    >
      <line x1={0} y1={size} x2={size} y2={0} stroke="var(--border)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x * size} cy={(1 - p.y) * size} r={3.5} fill="var(--accent)" stroke="#000" strokeWidth={0.5} />
      ))}
    </svg>
  )
}

// ── One node's full control set ─────────────────────────────────────────────
function NodeEditor({ node, onChange }: { node: GradeNode; onChange: (n: GradeNode) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        <WheelPad label="Lift"   value={node.lift}   onChange={w => onChange({ ...node, lift: w })} />
        <WheelPad label="Gamma"  value={node.gamma}  onChange={w => onChange({ ...node, gamma: w })} />
        <WheelPad label="Gain"   value={node.gain}   onChange={w => onChange({ ...node, gain: w })} />
        <WheelPad label="Offset" value={node.offset} onChange={w => onChange({ ...node, offset: w })} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <NumRow label="Contrast"   value={node.contrast}   min={0}  max={2}  neutral={1}     onChange={v => onChange({ ...node, contrast: v })} />
        <NumRow label="Pivot"      value={node.pivot}      min={0}  max={1}  neutral={0.435} onChange={v => onChange({ ...node, pivot: v })} />
        <NumRow label="Temp"       value={node.temp}       min={-1} max={1}  neutral={0}     onChange={v => onChange({ ...node, temp: v })} />
        <NumRow label="Tint"       value={node.tint}       min={-1} max={1}  neutral={0}     onChange={v => onChange({ ...node, tint: v })} />
        <NumRow label="Saturation" value={node.saturation} min={0}  max={2}  neutral={1}     onChange={v => onChange({ ...node, saturation: v })} />
      </div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Luma curve</span>
          <CurveEditor points={node.lumaCurve ?? []} onChange={p => onChange({ ...node, lumaCurve: p })} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Hue vs sat</span>
          <CurveEditor points={node.hueSat ?? []} onChange={p => onChange({ ...node, hueSat: p })} />
        </div>
      </div>
      {/* Window (soft ellipse / gradient) — limits this node to part of the frame */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Window</span>
          {(['none', 'ellipse', 'gradient'] as const).map(shape => {
            const active = shape === 'none' ? !node.window : node.window?.shape === shape
            return (
              <button key={shape}
                onClick={() => onChange({
                  ...node,
                  window: shape === 'none' ? null
                    : { shape, cx: 0.5, cy: 0.5, rx: 0.3, ry: 0.3, angle: 0, softness: 0.35, invert: false },
                })}
                style={{
                  fontSize: 9, padding: '2px 8px', borderRadius: 4, cursor: 'pointer', textTransform: 'capitalize',
                  background: active ? 'var(--accent)' : 'transparent',
                  color: active ? '#0b0d10' : 'var(--text-secondary)',
                  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                }}>{shape}</button>
            )
          })}
        </div>
        {node.window && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <NumRow label="X"        value={node.window.cx}       min={0} max={1} neutral={0.5}  onChange={v => onChange({ ...node, window: { ...node.window!, cx: v } })} />
            <NumRow label="Y"        value={node.window.cy}       min={0} max={1} neutral={0.5}  onChange={v => onChange({ ...node, window: { ...node.window!, cy: v } })} />
            <NumRow label="Size X"   value={node.window.rx}       min={0.02} max={1} neutral={0.3} onChange={v => onChange({ ...node, window: { ...node.window!, rx: v } })} />
            <NumRow label="Size Y"   value={node.window.ry}       min={0.02} max={1} neutral={0.3} onChange={v => onChange({ ...node, window: { ...node.window!, ry: v } })} />
            <NumRow label="Softness" value={node.window.softness} min={0.01} max={1} neutral={0.35} onChange={v => onChange({ ...node, window: { ...node.window!, softness: v } })} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={node.window.invert} onChange={e => onChange({ ...node, window: { ...node.window!, invert: e.target.checked } })} />
              Invert
            </label>
          </div>
        )}
      </div>
    </div>
  )
}

export default function ColorPage({
  clips, activeClipId, onSelectClip, onClipNodesChange,
  lookNodes, onLookNodesChange, stills, onStillsChange, grabFrame, scopes,
}: Props) {
  const [level, setLevel] = useState<'clip' | 'look'>('clip')
  const [selNode, setSelNode] = useState(0)

  const activeClip = clips.find(c => c.id === activeClipId) ?? null
  const clipNodes = activeClip?.gradeNodes ?? []
  const nodes = level === 'clip' ? clipNodes : lookNodes

  const setNodes = useCallback((next: GradeNode[]) => {
    if (level === 'look') { onLookNodesChange(next); return }
    if (activeClip) onClipNodesChange(activeClip.id, next)
  }, [level, activeClip, onClipNodesChange, onLookNodesChange])

  const node: GradeNode | null = nodes[selNode] ?? nodes[0] ?? null
  const idx = nodes[selNode] ? selNode : 0

  const addNode = () => {
    const next = [...nodes, defaultGradeNode(`Node ${nodes.length + 1}`)]
    setNodes(next)
    setSelNode(next.length - 1)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--bg-base)' }}>
      {/* Header: level switch + stills actions */}
      <div style={{ height: 36, flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Color</span>
        {(['clip', 'look'] as const).map(l => (
          <button key={l} onClick={() => { setLevel(l); setSelNode(0) }}
            style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
              background: level === l ? 'var(--accent)' : 'transparent',
              color: level === l ? '#0b0d10' : 'var(--text-secondary)',
              border: `1px solid ${level === l ? 'var(--accent)' : 'var(--border)'}`,
            }}>
            {l === 'clip' ? 'Clip grade' : 'The look (all clips)'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => {
            const thumb = grabFrame?.() ?? ''
            onStillsChange([...stills, { id: crypto.randomUUID(), label: activeClip?.label ?? `Still ${stills.length + 1}`, thumb, nodes: clipNodes.map(n => ({ ...n })) }])
          }}
          title="Grab still — saves this clip's grade with a reference frame"
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, padding: '3px 9px', borderRadius: 4, cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          <Camera size={11} /> Grab still
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: node chain + controls */}
        <div style={{ width: 430, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
            {nodes.map((n, i) => (
              <button key={n.id} onClick={() => setSelNode(i)}
                title={n.label ?? `Node ${i + 1}`}
                style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                  background: i === idx ? 'var(--accent)' : 'transparent',
                  color: i === idx ? '#0b0d10' : (gradeNodeIsNeutral(n) ? 'var(--text-muted)' : 'var(--text-primary)'),
                  border: `1px solid ${i === idx ? 'var(--accent)' : 'var(--border)'}`,
                  opacity: n.enabled ? 1 : 0.45,
                }}>
                {n.label ?? `Node ${i + 1}`}
              </button>
            ))}
            <button onClick={addNode} title="Add a serial node"
              style={{ display: 'flex', alignItems: 'center', fontSize: 10, padding: '3px 7px', borderRadius: 4, cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', border: '1px dashed var(--border)' }}>
              <Plus size={11} />
            </button>
            {node && (
              <>
                <div style={{ flex: 1 }} />
                <button onClick={() => setNodes(nodes.map((n, i) => i === idx ? { ...n, enabled: !n.enabled } : n))}
                  title={node.enabled ? 'Disable node' : 'Enable node'}
                  style={{ display: 'flex', padding: 3, borderRadius: 4, cursor: 'pointer', background: 'transparent', color: node.enabled ? 'var(--accent)' : 'var(--text-muted)', border: '1px solid var(--border)' }}>
                  <Power size={11} />
                </button>
                <button onClick={() => { const next = nodes.filter((_, i) => i !== idx); setNodes(next); setSelNode(0) }}
                  title="Delete node"
                  style={{ display: 'flex', padding: 3, borderRadius: 4, cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                  <Trash2 size={11} />
                </button>
              </>
            )}
          </div>

          <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
            {level === 'clip' && !activeClip ? (
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Select a clip in the strip below to grade it.</p>
            ) : node ? (
              <NodeEditor node={node} onChange={n => setNodes(nodes.map((x, i) => i === idx ? n : x))} />
            ) : (
              <button onClick={addNode}
                style={{ fontSize: 11, padding: '8px 12px', borderRadius: 6, cursor: 'pointer', background: 'var(--accent)', color: '#0b0d10', border: 'none', fontWeight: 700 }}>
                + Add {level === 'look' ? 'look' : 'clip'} node
              </button>
            )}
          </div>
        </div>

        {/* Right: scopes + stills gallery */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {scopes ?? <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>Scopes appear here while a clip is loaded.</p>}
          </div>
          {stills.length > 0 && (
            <div style={{ borderTop: '1px solid var(--border)', padding: 8, display: 'flex', gap: 8, overflowX: 'auto', flexShrink: 0 }}>
              {stills.map(st => (
                <div key={st.id} style={{ flexShrink: 0, width: 108 }}>
                  {st.thumb
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={st.thumb} alt={st.label} style={{ width: 108, height: 60, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)' }} />
                    : <div style={{ width: 108, height: 60, borderRadius: 3, background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />}
                  <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                    <button
                      onClick={() => { if (activeClip) onClipNodesChange(activeClip.id, st.nodes.map(n => ({ ...n, id: crypto.randomUUID() }))) }}
                      title="Apply this grade to the selected clip"
                      style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, fontSize: 9, padding: '2px 0', borderRadius: 3, cursor: 'pointer', background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                      <Copy size={9} /> Apply
                    </button>
                    <button onClick={() => onStillsChange(stills.filter(s => s.id !== st.id))}
                      style={{ display: 'flex', padding: '2px 4px', borderRadius: 3, cursor: 'pointer', background: 'transparent', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                      <Trash2 size={9} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Clip thumbnail strip — the playhead's clip is the graded clip */}
      <div style={{ height: 78, flexShrink: 0, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', gap: 6, padding: 8, overflowX: 'auto' }}>
        {clips.length === 0 && <p style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>No gradeable clips on the timeline.</p>}
        {clips.map((c, i) => {
          const graded = (c.gradeNodes ?? []).some(n => n.enabled && !gradeNodeIsNeutral(n))
          const active = c.id === activeClipId
          return (
            <button key={c.id} onClick={() => onSelectClip(c.id)} title={c.label}
              data-color-clip={c.id}
              style={{
                flexShrink: 0, width: 96, height: 62, borderRadius: 4, cursor: 'pointer', padding: 4,
                background: 'var(--bg-base)', textAlign: 'left', overflow: 'hidden',
                border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
              }}>
              <div style={{
                fontSize: 9, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                // graded clips get the rainbow number, ungraded stay gray (Resolve tell)
                background: graded ? 'linear-gradient(90deg,#ff6b6b,#ffd166,#6bffb0,#66d9ff,#b19bff)' : 'none',
                WebkitBackgroundClip: graded ? 'text' : undefined,
                WebkitTextFillColor: graded ? 'transparent' : undefined,
                color: graded ? undefined : 'var(--text-muted)',
              }}>{String(i + 1).padStart(2, '0')}</div>
              <div style={{ fontSize: 9, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
