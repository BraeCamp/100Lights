'use client'
// Mod matrix: full routing table with amount, bipolar, aux scale, remap
// curves, bypass, reorder.

import React, { useMemo, useRef, useState } from 'react'
import { useApollo, Sel, Section, ToggleBtn, UI } from './ApolloContext'
import { MOD_SOURCES, PARAMS, FX_DEFS, ModSource, ModRoute, FxUnit, LfoPoint, uid } from '@/lib/apollo/patch'

function destGroup(path: string): string {
  if (path.startsWith('osc0')) return 'Osc A'
  if (path.startsWith('osc1')) return 'Osc B'
  if (path.startsWith('osc2')) return 'Osc C'
  if (path.startsWith('f1') || path.startsWith('f2')) return 'Filters'
  if (path.startsWith('sub') || path.startsWith('noise')) return 'Sub / Noise'
  if (path.startsWith('env')) return 'Envelopes'
  if (path.startsWith('lfo')) return 'LFOs'
  if (path.startsWith('macro')) return 'Macros'
  return 'Global'
}

function walkFx(units: FxUnit[], out: { value: string; label: string; group: string }[]): void {
  for (const u of units) {
    const def = FX_DEFS[u.type]
    if (def) {
      out.push({ value: `fx.${u.id}.mix`, label: `${def.label}: Mix`, group: 'FX' })
      for (const p of def.params) out.push({ value: `fx.${u.id}.${p.key}`, label: `${def.label}: ${p.label}`, group: 'FX' })
    }
    if (u.chains) for (const c of u.chains) walkFx(c, out)
  }
}

const cellBtn: React.CSSProperties = {
  background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 2,
}

function AmountSlider({ value, onChange, onCommit }: { value: number; onChange: (v: number) => void; onCommit: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef(false)
  const apply = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    onChange(Math.min(1, Math.max(-1, ((e.clientX - r.left) / r.width) * 2 - 1)))
  }
  return (
    <div
      ref={ref}
      onPointerDown={e => { drag.current = true; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); apply(e) }}
      onPointerMove={e => { if (drag.current) apply(e) }}
      onPointerUp={() => { if (drag.current) { drag.current = false; onCommit() } }}
      onDoubleClick={() => { onChange(0); onCommit() }}
      style={{ position: 'relative', width: 90, height: 14, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7, cursor: 'ew-resize', touchAction: 'none' }}
      title={`${Math.round(value * 100)}%`}
    >
      <div style={{
        position: 'absolute', top: 2, bottom: 2, borderRadius: 5,
        left: value >= 0 ? '50%' : `${50 + value * 50}%`,
        width: `${Math.abs(value) * 50}%`,
        background: 'var(--accent)',
      }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border-light)' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, color: 'var(--text-primary)', pointerEvents: 'none' }}>
        {Math.round(value * 100)}%
      </div>
    </div>
  )
}

export function CurveEditor({ curve, onCommit }: { curve: LfoPoint[] | null; onCommit: (c: LfoPoint[] | null) => void }) {
  const [pts, setPts] = useState<LfoPoint[]>(curve || [{ x: 0, y: 0, curve: 0 }, { x: 1, y: 1, curve: 0 }])
  const drag = useRef(-1)
  const cvPos = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) }
  }
  const W = 160, H = 70
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end' }}>
      <svg
        width={W} height={H}
        style={{ background: UI.inset, border: '1px solid var(--border)', borderRadius: 6, cursor: 'crosshair', touchAction: 'none' }}
        onPointerDown={e => {
          const { x, y } = cvPos(e)
          let pi = -1, bd = 0.08
          pts.forEach((p, k) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; pi = k } })
          if (e.detail >= 2) {
            if (pi >= 0 && pts.length > 2) setPts(pts.filter((_, k) => k !== pi))
            else if (pi < 0) setPts([...pts, { x, y, curve: 0 }].sort((a, b) => a.x - b.x))
            return
          }
          if (pi >= 0) { drag.current = pi; (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId) }
        }}
        onPointerMove={e => {
          if (drag.current < 0) return
          const { x, y } = cvPos(e)
          setPts(prev => {
            const next = [...prev]
            const first = drag.current === 0, last = drag.current === next.length - 1
            next[drag.current] = { x: first ? 0 : last ? 1 : x, y, curve: 0 }
            return next.sort((a, b) => a.x - b.x)
          })
        }}
        onPointerUp={() => { drag.current = -1 }}
      >
        <polyline
          fill="none" stroke="var(--accent)" strokeWidth={1.5}
          points={pts.map(p => `${p.x * W},${(1 - p.y) * H}`).join(' ')}
        />
        {pts.map((p, k) => <circle key={k} cx={p.x * W} cy={(1 - p.y) * H} r={3.5} fill="#e8e8e8" />)}
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <ToggleBtn on={false} label="Apply" onClick={() => onCommit(pts)} />
        <ToggleBtn on={false} label="Linear" onClick={() => onCommit(null)} />
      </div>
    </div>
  )
}

export default function ModMatrixPanel() {
  const ctx = useApollo()
  const [curveOpen, setCurveOpen] = useState<string | null>(null)
  const dragRow = useRef(-1)

  const destOpts = useMemo(() => {
    const opts = PARAMS.map(p => ({ value: p.path, label: p.label, group: destGroup(p.path) }))
    walkFx(ctx.patch.fxMain, opts)
    walkFx(ctx.patch.fxBus1, opts)
    walkFx(ctx.patch.fxBus2, opts)
    return opts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx.version])

  const srcOpts = [
    { value: 'none', label: '—', group: 'None' },
    ...MOD_SOURCES.map(s => ({ value: s.id, label: s.label, group: s.group })),
  ]

  const setRow = (id: string, fn: (r: ModRoute) => void) => {
    ctx.update(p => { const r = p.matrix.find(rr => rr.id === id); if (r) fn(r) })
  }

  return (
    <Section
      title={`Matrix · ${ctx.patch.matrix.length} routes`}
      right={<ToggleBtn on={false} label="+ Add" onClick={() => ctx.update(p => {
        p.matrix.push({ id: uid(), source: 'lfo1', dest: 'f1.cutoff', amount: 0.3, bipolar: false, aux: 'none', auxAmount: 0, curve: null, bypass: false })
      })} />}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 300, overflowY: 'auto' }}>
        {ctx.patch.matrix.length === 0 && (
          <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: 8 }}>
            No routes yet — drag a source chip onto any knob, or click “+ Add”.
          </div>
        )}
        {ctx.patch.matrix.map((row, ri) => (
          <div key={row.id} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <div
              draggable
              onDragStart={() => { dragRow.current = ri }}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                const from = dragRow.current
                if (from < 0 || from === ri) return
                ctx.update(p => {
                  const [moved] = p.matrix.splice(from, 1)
                  p.matrix.splice(ri, 0, moved)
                })
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, padding: '3px 4px', borderRadius: 6,
                background: row.bypass ? 'var(--bg-surface)' : 'var(--bg-card-hover, rgba(255,255,255,0.03))',
                opacity: row.bypass ? 0.5 : 1, flexWrap: 'wrap',
              }}
            >
              <span style={{ cursor: 'grab', color: 'var(--text-muted)', fontSize: 10 }}>⠿</span>
              <Sel width={92} value={row.source} options={srcOpts} onChange={v => setRow(row.id, r => { r.source = v as ModSource })} />
              <AmountSlider
                value={row.amount}
                onChange={v => setRow(row.id, r => { r.amount = v })}
                onCommit={() => ctx.commit()}
              />
              <ToggleBtn on={row.bipolar} label="±" title="Bipolar" onClick={() => setRow(row.id, r => { r.bipolar = !r.bipolar })} />
              <Sel width={150} value={row.dest} options={destOpts} onChange={v => setRow(row.id, r => { r.dest = v })} />
              <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>aux</span>
              <Sel width={76} value={row.aux} options={srcOpts} onChange={v => setRow(row.id, r => { r.aux = v as ModSource })} />
              {row.aux !== 'none' && (
                <input
                  type="range" min={0} max={1} step={0.01} value={row.auxAmount} className="cf-slider" style={{ width: 50 }}
                  onChange={e => setRow(row.id, r => { r.auxAmount = Number(e.target.value) })}
                />
              )}
              <button style={{ ...cellBtn, color: row.curve ? 'var(--accent)' : 'var(--text-muted)' }} title="Remap curve"
                onClick={() => setCurveOpen(curveOpen === row.id ? null : row.id)}>◠</button>
              <button style={cellBtn} title={row.bypass ? 'Enable' : 'Bypass'}
                onClick={() => setRow(row.id, r => { r.bypass = !r.bypass })}>{row.bypass ? '◌' : '●'}</button>
              <button style={cellBtn} title="Delete" onClick={() => ctx.update(p => { p.matrix = p.matrix.filter(r => r.id !== row.id) })}>✕</button>
            </div>
            {curveOpen === row.id && (
              <div style={{ paddingLeft: 24 }}>
                <CurveEditor
                  curve={row.curve}
                  onCommit={c => {
                    setCurveOpen(null)
                    ctx.update(p => {
                      const r = p.matrix.find(rr => rr.id === row.id)
                      if (r) r.curve = c
                    })
                    if (c) ctx.engine.sendRemapLut(row.id, c)
                  }}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}
