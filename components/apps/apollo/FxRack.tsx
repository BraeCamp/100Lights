'use client'
// Apollo FX rack: three lanes (Main / Bus 1 / Bus 2), unlimited stackable FX
// units with auto-generated controls, splitter units with nested sub-chains,
// sibling drag-reorder, duplicate/delete, per-unit enable + mix.

import React, { useRef, useState } from 'react'
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
const IR_NAMES = ['Room', 'Hall', 'Cathedral', 'Plate', 'Spring', 'Chamber', 'Reverse', 'Gated']
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

export default function FxRack() {
  const ctx = useApollo()
  const [lane, setLane] = useState<Lane>('main')
  const dnd = useRef<DragInfo | null>(null)
  const locate = laneLocate(lane)
  const counts: Record<Lane, number> = {
    main: ctx.patch.fxMain.length,
    bus1: ctx.patch.fxBus1.length,
    bus2: ctx.patch.fxBus2.length,
  }
  return (
    <Section
      title="Effects"
      right={
        <div style={{ display: 'flex', gap: 4 }}>
          {LANES.map(l => (
            <ToggleBtn
              key={l.key}
              on={lane === l.key}
              label={counts[l.key] ? `${l.label} · ${counts[l.key]}` : l.label}
              onClick={() => setLane(l.key)}
            />
          ))}
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
