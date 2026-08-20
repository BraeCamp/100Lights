'use client'
// Apollo FX rack: three lanes (Main / Bus 1 / Bus 2), unlimited stackable FX
// units with auto-generated controls, splitter units with nested sub-chains,
// sibling drag-reorder, duplicate/delete, per-unit enable + mix.

import React, { useEffect, useRef, useState } from 'react'
import { useApollo, Knob, Sel, Section, ToggleBtn } from '@/components/apps/apollo/ApolloContext'
import {
  ApolloPatch, FxUnit, FxType, FX_DEFS, FILTER_TYPES, SYNC_RATES, defaultFx, uid,
} from '@/lib/apollo/patch'

type Locate = (p: ApolloPatch) => FxUnit[]
type Lane = 'main' | 'bus1' | 'bus2'

interface DragInfo { chainKey: string; index: number }

function cloneFxUnit(u: FxUnit): FxUnit {
  const copy: FxUnit = {
    ...u,
    id: uid(),
    params: { ...u.params },
  }
  if (u.chains) copy.chains = u.chains.map(chain => chain.map(cloneFxUnit))
  return copy
}

const DIST_MODES = ['Tube', 'Soft', 'Hard', 'Diode', 'Fold', 'Sine', 'ZeroSq', 'Asym', 'Rectify', 'Bitcrush', 'Downsmp', 'Overdrive']
const REVERB_MODES = ['Hall', 'Plate', 'Vintage', 'Nitrous', 'Basin']
const IR_NAMES = ['Room', 'Hall', 'Cathedral', 'Plate', 'Spring', 'Chamber', 'Reverse', 'Gated', 'Cabinet', 'Chimes', 'Tank']
const FILTER_POS = ['Off', 'Pre', 'Post']
const FILTER_KIND = ['LP', 'BP', 'HP']
const EQ_TYPES = ['LoShelf', 'Peak', 'HiShelf']
const BOOL_KEYS = new Set(['sync', 'pingpong', 'multiband', 'tape'])
const TIME_KEYS = new Set(['timeL', 'timeR', 'time'])

const SPLITTERS: FxType[] = ['splitLH', 'splitLMH', 'splitMS']
const EFFECTS: FxType[] = ['hyper', 'distortion', 'echobode', 'chorus', 'flanger', 'phaser', 'delay', 'compressor', 'convolve', 'reverb', 'eq', 'filter', 'utility', 'octaver', 'bitcrush']

function chainLabels(type: FxType): string[] {
  if (type === 'splitLH') return ['Low', 'High']
  if (type === 'splitLMH') return ['Low', 'Mid', 'High']
  return ['Mid', 'Side']
}

function intRange(lo: number, hi: number): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = []
  for (let i = lo; i <= hi; i++) out.push({ value: String(i), label: String(i) })
  return out
}

function discreteOptions(unitType: FxType, key: string): { value: string; label: string }[] | null {
  if (key === 'mode' && unitType === 'distortion') return DIST_MODES.map((l, i) => ({ value: String(i), label: l }))
  if (key === 'mode' && unitType === 'reverb') return REVERB_MODES.map((l, i) => ({ value: String(i), label: l }))
  if (key === 'ir') return IR_NAMES.map((l, i) => ({ value: String(i), label: l }))
  if (key === 'type' && unitType === 'filter') return FILTER_TYPES.map((f, i) => ({ value: String(i), label: f.label }))
  if (TIME_KEYS.has(key)) return SYNC_RATES.map((r, i) => ({ value: String(i), label: r.label }))
  if (key === 'filterPos') return FILTER_POS.map((l, i) => ({ value: String(i), label: l }))
  if (key === 'filterType') return FILTER_KIND.map((l, i) => ({ value: String(i), label: l }))
  if (key === 't1' || key === 't2') return EQ_TYPES.map((l, i) => ({ value: String(i), label: l }))
  if (key === 'stages') return intRange(2, 12)
  if (key === 'voices') return intRange(2, 4)
  if (key === 'unison') return intRange(1, 7)
  return null
}

function UnitCard({ unit, locate, index, count, dnd, chainKey }: {
  unit: FxUnit
  locate: Locate
  index: number
  count: number
  dnd: React.MutableRefObject<DragInfo | null>
  chainKey: string
}) {
  const ctx = useApollo()
  const def = FX_DEFS[unit.type]
  const isSplitter = SPLITTERS.includes(unit.type)
  const [dragOver, setDragOver] = useState(false)

  const mutate = (fn: (arr: FxUnit[]) => void) => ctx.update(p => fn(locate(p)))
  const mutUnit = (fn: () => void) => ctx.update(() => fn())

  const paramValue = (key: string, fallback: number): number =>
    unit.params[key] != null ? unit.params[key] : fallback

  const syncVal = unit.params.sync
  const showTime = syncVal == null || syncVal > 0.5

  const controls: React.ReactNode[] = []
  for (const pd of def.params) {
    if (TIME_KEYS.has(pd.key) && !showTime) continue
    if (pd.key === 'freeMs' && showTime) continue
    if (BOOL_KEYS.has(pd.key)) {
      controls.push(
        <ToggleBtn
          key={pd.key}
          on={paramValue(pd.key, pd.default) > 0.5}
          label={pd.label}
          onClick={() => mutUnit(() => { unit.params[pd.key] = paramValue(pd.key, pd.default) > 0.5 ? 0 : 1 })}
        />,
      )
      continue
    }
    const opts = discreteOptions(unit.type, pd.key)
    if (opts) {
      controls.push(
        <div key={pd.key} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 60 }}>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.6 }}>{pd.label}</div>
          <Sel
            value={String(Math.round(paramValue(pd.key, pd.default)))}
            options={opts}
            onChange={v => mutUnit(() => { unit.params[pd.key] = Number(v) })}
          />
        </div>,
      )
      continue
    }
    controls.push(
      <Knob
        key={pd.key}
        path={`fx.${unit.id}.${pd.key}`}
        value={paramValue(pd.key, pd.default)}
        min={pd.min}
        max={pd.max}
        def={pd.default}
        log={pd.curve === 'log'}
        label={pd.label}
        size={34}
        onChange={v => { unit.params[pd.key] = v; ctx.engine.setParam(`fx.${unit.id}.${pd.key}`, v) }}
        onCommit={() => ctx.commit()}
      />,
    )
  }

  return (
    <div
      onDragOver={e => {
        if (dnd.current && dnd.current.chainKey === chainKey && dnd.current.index !== index) {
          e.preventDefault(); setDragOver(true)
        }
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => {
        e.preventDefault(); setDragOver(false)
        const info = dnd.current
        if (!info || info.chainKey !== chainKey || info.index === index) return
        mutate(arr => {
          const [moved] = arr.splice(info.index, 1)
          if (moved) arr.splice(index, 0, moved)
        })
        dnd.current = null
      }}
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid ' + (dragOver ? 'var(--accent)' : 'var(--border)'),
        borderRadius: 8, padding: 8, display: 'flex', flexDirection: 'column', gap: 6,
        opacity: unit.enabled ? 1 : 0.55,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span
          draggable
          onDragStart={e => { dnd.current = { chainKey, index }; e.dataTransfer.setData('text/plain', unit.id) }}
          onDragEnd={() => { dnd.current = null }}
          title="Drag to reorder within this chain"
          style={{ cursor: 'grab', color: 'var(--text-muted)', fontSize: 11, padding: '0 2px', userSelect: 'none' }}
        >⋮⋮</span>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {def.label}
        </div>
        <ToggleBtn on={unit.enabled} label={unit.enabled ? 'On' : 'Off'} onClick={() => mutUnit(() => { unit.enabled = !unit.enabled })} />
        {!isSplitter && (
          <Knob
            path={`fx.${unit.id}.mix`}
            value={unit.mix}
            min={0} max={1} def={1}
            label="Mix"
            size={26}
            onChange={v => { unit.mix = v; ctx.engine.setParam(`fx.${unit.id}.mix`, v) }}
            onCommit={() => ctx.commit()}
          />
        )}
        <button
          title="Duplicate"
          onClick={() => mutate(arr => { arr.splice(index + 1, 0, cloneFxUnit(unit)) })}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 2 }}
        >⧉</button>
        <button
          title="Remove"
          onClick={() => mutate(arr => { const i = arr.indexOf(unit); if (i >= 0) arr.splice(i, 1) })}
          style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, padding: 2 }}
        >✕</button>
      </div>
      {unit.type === 'eq' && <EqGraph unit={unit} />}
      {unit.type === 'compressor' && <GrMeter unitId={unit.id} multiband={paramValue('multiband', 0) > 0.5} />}
      {controls.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'flex-end' }}>{controls}</div>
      )}
      {isSplitter && unit.chains && (
        <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', minWidth: 0, overflowX: 'auto' }}>
          {unit.chains.map((_, ci) => (
            <div key={ci} style={{ flex: 1, minWidth: 150, background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1, color: 'var(--accent)', textTransform: 'uppercase' }}>
                {chainLabels(unit.type)[ci]}
              </div>
              <ChainView
                chainKey={`${unit.id}:${ci}`}
                locate={p => {
                  const arr = locate(p)
                  const u = arr.find(x => x.id === unit.id)
                  return u?.chains?.[ci] || []
                }}
                dnd={dnd}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AddFxMenu({ locate }: { locate: Locate }) {
  const ctx = useApollo()
  return (
    <Sel
      value=""
      title="Add an effect to this chain"
      options={[
        { value: '', label: '+ Add FX' },
        ...EFFECTS.map(t => ({ value: t, label: FX_DEFS[t].label, group: 'Effects' })),
        ...SPLITTERS.map(t => ({ value: t, label: FX_DEFS[t].label, group: 'Splitters' })),
      ]}
      onChange={v => {
        if (!v) return
        ctx.update(p => { locate(p).push(defaultFx(v as FxType)) })
      }}
    />
  )
}

function ChainView({ chainKey, locate, dnd }: { chainKey: string; locate: Locate; dnd: React.MutableRefObject<DragInfo | null> }) {
  const ctx = useApollo()
  const units = locate(ctx.patch)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {units.map((u, i) => (
        <UnitCard key={u.id} unit={u} locate={locate} index={i} count={units.length} dnd={dnd} chainKey={chainKey} />
      ))}
      <AddFxMenu locate={locate} />
    </div>
  )
}

const LANES: { key: Lane; label: string }[] = [
  { key: 'main', label: 'MAIN' },
  { key: 'bus1', label: 'BUS 1' },
  { key: 'bus2', label: 'BUS 2' },
]

function laneLocate(lane: Lane): Locate {
  if (lane === 'main') return p => p.fxMain
  if (lane === 'bus1') return p => p.fxBus1
  return p => p.fxBus2
}

// `minimal` (optional — Apollo 2): empty bus lanes are collapsed behind one
// bare "+" until used or revealed, so a fresh patch shows a single Effects lane.
// ── EQ visual editor: drag the two band handles on the response curve ───────
// (x = frequency, y = gain; scroll wheel over a handle = Q). The same params
// the knobs edit — this is just a face for them, so modulation still works.
function EqGraph({ unit }: { unit: FxUnit }) {
  const ctx = useApollo()
  const canvasRef = React.useRef<HTMLCanvasElement>(null)
  const dragRef = React.useRef<number>(-1)
  const W = 300, H = 84
  const pv = (k: string, d: number) => (unit.params[k] != null ? unit.params[k] : d)

  // one band's dB response at normalized log-frequency x (display approximation)
  const bandDb = React.useCallback((x: number, f: number, g: number, q: number, t: number) => {
    const w = Math.max(0.02, 0.25 / Math.sqrt(q))
    const d = x - f
    if (Math.round(t) === 1) return g * Math.exp(-(d * d) / (2 * w * w)) // peak
    // shelves: smooth step below (t=0) / above (t=2) the corner
    const sig = 1 / (1 + Math.exp(-d / (w * 0.6)))
    return Math.round(t) === 0 ? g * (1 - sig) : g * sig
  }, [])

  const draw = React.useCallback(() => {
    const cv = canvasRef.current
    if (!cv) return
    const dpr = window.devicePixelRatio || 1
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr }
    const g2d = cv.getContext('2d')
    if (!g2d) return
    g2d.setTransform(dpr, 0, 0, dpr, 0, 0)
    g2d.clearRect(0, 0, W, H)
    g2d.fillStyle = 'rgba(0,0,0,0.28)'
    g2d.fillRect(0, 0, W, H)
    // spectrum underlay (standalone page only — DAW mode has no analyser)
    const an = ctx.engine.analyser
    if (an && ctx.engine.meters.peak > 0.001) {
      const bins = new Uint8Array(an.frequencyBinCount)
      an.getByteFrequencyData(bins)
      const sr = ctx.engine.ctx?.sampleRate ?? 48000
      g2d.fillStyle = 'rgba(111,208,140,0.16)'
      for (let px = 0; px < W; px += 2) {
        const fHz = 20 * Math.pow(1000, px / W) // 20 Hz → 20 kHz log
        const bin = Math.min(bins.length - 1, Math.round(fHz / (sr / 2) * bins.length))
        const h = (bins[bin] / 255) * (H - 6)
        g2d.fillRect(px, H - h, 2, h)
      }
    }
    // zero line
    g2d.strokeStyle = 'rgba(255,255,255,0.12)'
    g2d.beginPath(); g2d.moveTo(0, H / 2); g2d.lineTo(W, H / 2); g2d.stroke()
    // combined curve
    g2d.strokeStyle = 'var(--accent)'
    g2d.strokeStyle = '#7c9fd4'
    g2d.lineWidth = 1.6
    g2d.beginPath()
    for (let px = 0; px <= W; px++) {
      const x = px / W
      const db = bandDb(x, pv('f1', 0.2), pv('g1', 0), pv('q1', 0.8), pv('t1', 1))
        + bandDb(x, pv('f2', 0.75), pv('g2', 0), pv('q2', 0.8), pv('t2', 1))
      const y = H / 2 - (db / 18) * (H / 2 - 6)
      if (px === 0) g2d.moveTo(px, y); else g2d.lineTo(px, y)
    }
    g2d.stroke()
    // handles
    for (const b of [1, 2]) {
      const x = pv(`f${b}`, b === 1 ? 0.2 : 0.75) * W
      const y = H / 2 - (pv(`g${b}`, 0) / 18) * (H / 2 - 6)
      g2d.fillStyle = b === 1 ? '#e0b355' : '#6fd08c'
      g2d.beginPath(); g2d.arc(x, y, 5, 0, Math.PI * 2); g2d.fill()
      g2d.fillStyle = '#0b0d10'
      g2d.font = 'bold 7px sans-serif'; g2d.textAlign = 'center'; g2d.textBaseline = 'middle'
      g2d.fillText(String(b), x, y)
    }
  }, [bandDb, ctx.engine, unit.params]) // eslint-disable-line react-hooks/exhaustive-deps

  // redraw on meter events while audio plays (spectrum), and on patch changes
  React.useEffect(() => {
    draw()
    const eng = ctx.engine
    const onMeters = () => { if (eng.meters.peak > 0.001 || dragRef.current >= 0) draw() }
    eng.addEventListener('meters', onMeters)
    return () => eng.removeEventListener('meters', onMeters)
  }, [draw, ctx.version, ctx.engine])

  const apply = (e: React.PointerEvent) => {
    const b = dragRef.current
    if (b < 0) return
    if (e.type === 'pointermove' && e.buttons === 0) { dragRef.current = -1; ctx.commit(); return }
    const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect()
    // clamp: freq 0/1 would push the biquad to degenerate coefficients
    const x = Math.min(0.98, Math.max(0.02, (e.clientX - r.left) / r.width))
    const db = Math.min(18, Math.max(-18, ((H / 2 - (e.clientY - r.top) / r.height * H) / (H / 2 - 6)) * 18))
    unit.params[`f${b}`] = x
    unit.params[`g${b}`] = db
    ctx.engine.setParam(`fx.${unit.id}.f${b}`, x)
    ctx.engine.setParam(`fx.${unit.id}.g${b}`, db)
    draw()
  }
  return (
    <canvas
      ref={canvasRef}
      data-learn="EQ curve"
      title="Drag a handle: left/right = frequency, up/down = gain · scroll over a handle = Q"
      style={{ width: '100%', maxWidth: W, height: H, borderRadius: 6, touchAction: 'none', cursor: 'crosshair' }}
      onPointerDown={e => {
        const r = e.currentTarget.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width
        const d1 = Math.abs(x - pv('f1', 0.2)), d2 = Math.abs(x - pv('f2', 0.75))
        dragRef.current = d1 <= d2 ? 1 : 2
        e.currentTarget.setPointerCapture?.(e.pointerId)
        apply(e)
      }}
      onPointerMove={e => apply(e)}
      onPointerUp={() => { if (dragRef.current >= 0) { dragRef.current = -1; ctx.commit() } }}
      onPointerCancel={() => { if (dragRef.current >= 0) { dragRef.current = -1; ctx.commit() } }}
      onWheel={e => {
        e.preventDefault()
        const r = e.currentTarget.getBoundingClientRect()
        const x = (e.clientX - r.left) / r.width
        const b = Math.abs(x - pv('f1', 0.2)) <= Math.abs(x - pv('f2', 0.75)) ? 1 : 2
        const q = Math.min(8, Math.max(0.2, pv(`q${b}`, 0.8) * (e.deltaY > 0 ? 0.92 : 1.09)))
        unit.params[`q${b}`] = q
        ctx.engine.setParam(`fx.${unit.id}.q${b}`, q)
        ctx.commit()
      }}
    />
  )
}

// ── Compressor gain-reduction meter (fed by the engine's fxGr meters) ───────
function GrMeter({ unitId, multiband }: { unitId: string; multiband: boolean }) {
  const ctx = useApollo()
  const [gr, setGr] = React.useState<number[]>([])
  React.useEffect(() => {
    const eng = ctx.engine
    const onMeters = () => {
      const v = eng.meters.fxGr?.[unitId]
      setGr(prev => {
        const next = v ?? []
        if (prev.length === next.length && prev.every((x, i) => Math.abs(x - next[i]) < 0.1)) return prev
        return [...next]
      })
    }
    eng.addEventListener('meters', onMeters)
    return () => eng.removeEventListener('meters', onMeters)
  }, [ctx.engine, unitId])
  const bands = multiband ? ['Lo', 'Mid', 'Hi'] : ['GR']
  return (
    <div data-learn="Gain reduction" title="Gain change per band: red bars = compression down, green = upward lift" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      {bands.map((label, i) => {
        const db = gr[i] ?? 0
        const down = Math.min(1, Math.max(0, -db / 24))
        const up = Math.min(1, Math.max(0, db / 24))
        return (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', width: 18 }}>{label}</span>
            <div style={{ width: 64, height: 7, borderRadius: 3, background: 'rgba(0,0,0,0.35)', border: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
              <div style={{ position: 'absolute', right: '50%', top: 0, bottom: 0, width: `${down * 50}%`, background: '#e07a6a' }} />
              <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: `${up * 50}%`, background: '#6fd08c' }} />
            </div>
            <span style={{ fontSize: 8, color: 'var(--text-muted)', width: 30, fontVariantNumeric: 'tabular-nums' }}>{db.toFixed(1)}dB</span>
          </div>
        )
      })}
    </div>
  )
}

const RACKS_KEY = 'apollo_fx_racks_v1'
const CLIP_KEY = 'apollo_fx_clipboard_v1'
interface RackPreset { name: string; units: FxUnit[] }

function loadRacks(): RackPreset[] {
  try { return JSON.parse(localStorage.getItem(RACKS_KEY) || '[]') as RackPreset[] } catch { return [] }
}

// Factory racks — curated chains in the spirit of Serum 2's factory rack
// presets (echo-band distortion, big retro mod reverb, …)
const fxWith = (type: FxType, params: Record<string, number>, mix?: number): FxUnit => {
  const u = defaultFx(type)
  Object.assign(u.params, params)
  if (mix != null) u.mix = mix
  return u
}
const FACTORY_RACKS: { name: string; make: () => FxUnit[] }[] = [
  { name: 'Echo Band Distortion', make: () => [
    fxWith('distortion', { drive: 0.55 }),
    fxWith('eq', { t1: 1, f1: 0.35, g1: 3, q1: 1.2, t2: 2, f2: 0.85, g2: -2, q2: 0.8 }),
    fxWith('delay', { timeL: 8, timeR: 10, feedback: 0.45 }, 0.3),
  ]},
  { name: 'Big Retro Mod Reverb', make: () => [
    fxWith('chorus', { rate: 0.35, depth: 0.6 }, 0.5),
    fxWith('reverb', { size: 0.85, decay: 0.8, damp: 0.35 }, 0.45),
  ]},
  { name: 'OTT Bright', make: () => [
    fxWith('compressor', { multiband: 1, upward: 0.6, makeup: 3 }),
    fxWith('eq', { t1: 0, f1: 0.2, g1: -1.5, t2: 2, f2: 0.8, g2: 2.5 }),
  ]},
  { name: 'Cab & Spring', make: () => [
    fxWith('convolve', { ir: 8, size: 0.6, damp: 0.4 }, 0.85),
    fxWith('convolve', { ir: 4, size: 0.5 }, 0.25),
  ]},
  { name: 'Wide Wash', make: () => [
    fxWith('hyper', { rate: 0.5, detune: 0.4, unison: 5 }, 0.6),
    fxWith('delay', { timeL: 9, timeR: 11, feedback: 0.5 }, 0.35),
    fxWith('reverb', { size: 0.9, decay: 0.85 }, 0.4),
  ]},
]

function RacksMenu({ lane, locate }: { lane: Lane; locate: Locate }) {
  const ctx = useApollo()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState<RackPreset[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) setSaved(loadRacks()) }, [open])
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])
  const freshIds = (units: FxUnit[]): FxUnit[] => units.map(u => ({
    ...structuredClone(u), id: uid(),
    chains: u.chains?.map(c => freshIds(c)),
  }))
  const setLane = (units: FxUnit[]) => {
    ctx.update(p => {
      const arr = locate(p)
      arr.splice(0, arr.length, ...freshIds(units))
    })
    setOpen(false)
  }
  const item: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '4px 8px', borderRadius: 5,
    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)', fontSize: 10.5,
  }
  const head: React.CSSProperties = { fontSize: 8.5, fontWeight: 800, letterSpacing: 1, color: 'var(--text-muted)', textTransform: 'uppercase', padding: '3px 8px 1px' }
  return (
    <div ref={menuRef} style={{ position: 'relative' }} data-learn="Racks">
      <ToggleBtn on={open} label="Racks ▾" title="Whole-chain presets: save this lane, load factory or saved racks, copy/paste between lanes" onClick={() => setOpen(o => !o)} />
      {open && (
        <div style={{
          position: 'absolute', top: '110%', right: 0, zIndex: 260, minWidth: 190, maxHeight: 280, overflowY: 'auto',
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 5,
          boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
        }}>
          <div style={head}>Factory racks</div>
          {FACTORY_RACKS.map(r => (
            <button key={r.name} style={item} onClick={() => setLane(r.make())}>{r.name}</button>
          ))}
          {saved.length > 0 && <div style={head}>Saved racks</div>}
          {saved.map(r => (
            <div key={r.name} style={{ display: 'flex', alignItems: 'center' }}>
              <button style={{ ...item, flex: 1 }} onClick={() => setLane(r.units)}>{r.name}</button>
              <button
                title="Delete rack"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, padding: 2 }}
                onClick={() => {
                  const next = saved.filter(x => x.name !== r.name)
                  setSaved(next)
                  try { localStorage.setItem(RACKS_KEY, JSON.stringify(next)) } catch { /* quota */ }
                }}
              >🗑</button>
            </div>
          ))}
          <div style={head}>This lane</div>
          <button style={item} onClick={() => {
            const name = window.prompt('Rack name:')?.trim()
            if (!name) return
            const units = locate(ctx.patch)
            const next = [...loadRacks().filter(r => r.name !== name), { name, units: structuredClone(units) }]
            try { localStorage.setItem(RACKS_KEY, JSON.stringify(next)) } catch { /* quota */ }
            setSaved(next)
          }}>Save as rack…</button>
          <button style={item} onClick={() => {
            try { localStorage.setItem(CLIP_KEY, JSON.stringify(locate(ctx.patch))) } catch { /* quota */ }
            setOpen(false)
          }}>Copy lane</button>
          <button style={item} onClick={() => {
            try {
              const units = JSON.parse(localStorage.getItem(CLIP_KEY) || 'null') as FxUnit[] | null
              if (Array.isArray(units)) setLane(units)
            } catch { /* nothing on the clipboard */ }
          }}>Paste lane</button>
          <button style={item} onClick={() => setLane([])}>Clear lane</button>
        </div>
      )}
    </div>
  )
}

export default function FxRack({ minimal = false }: { minimal?: boolean } = {}) {
  const ctx = useApollo()
  const [lane, setLane] = useState<Lane>('main')
  const [revealBusses, setRevealBusses] = useState(false)
  const dnd = useRef<DragInfo | null>(null)
  const locate = laneLocate(lane)
  const counts: Record<Lane, number> = {
    main: ctx.patch.fxMain.length,
    bus1: ctx.patch.fxBus1.length,
    bus2: ctx.patch.fxBus2.length,
  }
  const busUsed = counts.bus1 > 0 || counts.bus2 > 0
    || ctx.patch.filters.some(f => f.bus === 'bus1' || f.bus === 'bus2')
    || [...ctx.patch.oscs, ctx.patch.sub, ctx.patch.noise].some(s => s.bus === 'bus1' || s.bus === 'bus2')
  const showBusses = !minimal || busUsed || revealBusses
  const lanes = showBusses ? LANES : LANES.filter(l => l.key === 'main')
  useEffect(() => { if (!showBusses && lane !== 'main') setLane('main') }, [showBusses, lane])
  const dice = () => {
    ctx.update(p => {
      for (const u of locate(p)) {
        if (!u.enabled) continue
        const def = FX_DEFS[u.type]
        if (!def) continue
        for (const pd of def.params) {
          if (BOOL_KEYS.has(pd.key) || TIME_KEYS.has(pd.key)) continue
          const cur = u.params[pd.key] != null ? u.params[pd.key] : pd.default
          const span = (pd.max - pd.min) * 0.18
          u.params[pd.key] = Math.min(pd.max, Math.max(pd.min, cur + (Math.random() - 0.5) * 2 * span))
        }
      }
    })
  }
  return (
    <Section
      title="Effects"
      dice={dice}
      right={
        <div style={{ display: 'flex', gap: 4 }}>
          {lanes.map(l => (
            <ToggleBtn
              key={l.key}
              on={lane === l.key}
              label={counts[l.key] ? `${l.label} · ${counts[l.key]}` : l.label}
              onClick={() => setLane(l.key)}
            />
          ))}
          {!showBusses && (
            <ToggleBtn on={false} label="+" title="Effect busses — separate lanes you can route sources to" onClick={() => setRevealBusses(true)} />
          )}
          <RacksMenu lane={lane} locate={locate} />
        </div>
      }
      style={{ flex: 1, minHeight: 0 }}
    >
      <div style={{ overflowY: 'auto', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 2 }}>
        <ChainView chainKey={lane} locate={locate} dnd={dnd} />
      </div>
    </Section>
  )
}
