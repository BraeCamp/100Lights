'use client'
// Mix page: per-source levels, filter/bus routing, bus returns,
// master + live output meter.

import React from 'react'
import { useApollo, useMeters, Knob, Sel, Section, ToggleBtn, UI } from './ApolloContext'
import { SourceDest, BusDest } from '@/lib/apollo/patch'

const DEST_OPTS = [
  { value: 'f1', label: 'F1' }, { value: 'f2', label: 'F2' },
  { value: 'both', label: 'F1+F2' }, { value: 'bypass', label: 'Byp' },
]
const BUS_OPTS = [
  { value: 'main', label: 'Main' }, { value: 'bus1', label: 'Bus1' },
  { value: 'bus2', label: 'Bus2' }, { value: 'direct', label: 'Dir' },
]

interface StripCfg {
  key: string
  label: string
  levelPath: string
  panPath: string
  enabled: boolean
  dest: SourceDest
  filterBal: number
  bus: BusDest
  toggle: () => void
  setDest: (v: SourceDest) => void
  setBal: (v: number) => void
  setBus: (v: BusDest) => void
}

function Strip({ s }: { s: StripCfg }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 86,
      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 4px',
      opacity: s.enabled ? 1 : 0.5,
    }}>
      <ToggleBtn on={s.enabled} label={s.label} onClick={s.toggle} />
      <Knob path={s.levelPath} label="Level" size={38} />
      <Knob path={s.panPath} label="Pan" bipolar size={30} />
      <Sel width={64} value={s.dest} options={DEST_OPTS} onChange={v => s.setDest(v as SourceDest)} />
      {s.dest === 'both' && (
        <Knob label="F1↔F2" size={26} min={0} max={1} def={0.5} value={s.filterBal} onChange={s.setBal} />
      )}
      <Sel width={64} value={s.bus} options={BUS_OPTS} onChange={v => s.setBus(v as BusDest)} />
    </div>
  )
}

export default function MixerPanel() {
  const ctx = useApollo()
  const meters = useMeters()
  const p = ctx.patch

  const strips: StripCfg[] = [
    ...([0, 1, 2] as const).map((i): StripCfg => ({
      key: `osc${i}`, label: `OSC ${'ABC'[i]}`,
      levelPath: `osc${i}.level`, panPath: `osc${i}.pan`,
      enabled: p.oscs[i].enabled, dest: p.oscs[i].dest, filterBal: p.oscs[i].filterBal, bus: p.oscs[i].bus,
      toggle: () => ctx.update(pp => { pp.oscs[i].enabled = !pp.oscs[i].enabled }),
      setDest: v => ctx.update(pp => { pp.oscs[i].dest = v }),
      setBal: v => ctx.update(pp => { pp.oscs[i].filterBal = v }),
      setBus: v => ctx.update(pp => { pp.oscs[i].bus = v }),
    })),
    {
      key: 'sub', label: 'SUB', levelPath: 'sub.level', panPath: 'sub.pan',
      enabled: p.sub.enabled, dest: p.sub.dest, filterBal: p.sub.filterBal, bus: p.sub.bus,
      toggle: () => ctx.update(pp => { pp.sub.enabled = !pp.sub.enabled }),
      setDest: v => ctx.update(pp => { pp.sub.dest = v }),
      setBal: v => ctx.update(pp => { pp.sub.filterBal = v }),
      setBus: v => ctx.update(pp => { pp.sub.bus = v }),
    },
    {
      key: 'noise', label: 'NOISE', levelPath: 'noise.level', panPath: 'noise.pan',
      enabled: p.noise.enabled, dest: p.noise.dest, filterBal: p.noise.filterBal, bus: p.noise.bus,
      toggle: () => ctx.update(pp => { pp.noise.enabled = !pp.noise.enabled }),
      setDest: v => ctx.update(pp => { pp.noise.dest = v }),
      setBal: v => ctx.update(pp => { pp.noise.filterBal = v }),
      setBus: v => ctx.update(pp => { pp.noise.bus = v }),
    },
  ]

  const meterH = 120
  const peakN = Math.min(1.2, meters.peak)

  return (
    <Section title="Mixer">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
        {strips.map(s => <Strip key={s.key} s={s} />)}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 86, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 4px' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)' }}>FILTERS</span>
          <div style={{ display: 'flex', gap: 3 }}>
            <ToggleBtn on={p.filterRouting === 'serial'} label="Ser" onClick={() => ctx.update(pp => { pp.filterRouting = 'serial' })} />
            <ToggleBtn on={p.filterRouting === 'parallel'} label="Par" onClick={() => ctx.update(pp => { pp.filterRouting = 'parallel' })} />
          </div>
          {([0, 1] as const).map(fi => (
            <ToggleBtn key={fi} on={p.filters[fi].enabled} label={`F${fi + 1}: ${p.filters[fi].type}`}
              onClick={() => ctx.update(pp => { pp.filters[fi].enabled = !pp.filters[fi].enabled })} />
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 86, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 4px' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)' }}>BUSES</span>
          <Knob path="bus1Return" label="Bus 1" size={32} />
          <Knob path="bus2Return" label="Bus 2" size={32} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, width: 86, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 4px' }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)' }}>MASTER</span>
          <Knob path="global.masterGain" label="Master" size={42} />
          <div style={{ width: 14, height: meterH, background: UI.inset, border: '1px solid var(--border)', borderRadius: 4, position: 'relative', overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', bottom: 0, left: 0, right: 0,
              height: `${Math.min(100, peakN * 100)}%`,
              background: peakN > 1 ? 'var(--error)' : peakN > 0.8 ? 'var(--warning)' : 'var(--success)',
              transition: 'height 60ms linear',
            }} />
          </div>
          <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{meters.voices} voices</span>
        </div>
      </div>
    </Section>
  )
}
