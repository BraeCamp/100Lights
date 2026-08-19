'use client'
// Global voicing / tuning / quality settings.

import React from 'react'
import { useApollo, Knob, Sel, Section, ToggleBtn } from './ApolloContext'
import { SCALES, GlobalConfig } from '@/lib/apollo/patch'

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export default function GlobalPanel() {
  const ctx = useApollo()
  const g = ctx.patch.global
  const num = (v: number, set: (p: GlobalConfig, n: number) => void, min: number, max: number, w = 48) => (
    <input
      type="number" min={min} max={max} value={v}
      onChange={e => ctx.update(p => set(p.global, Math.min(max, Math.max(min, Number(e.target.value)))))}
      style={{ width: w, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 4px', fontSize: 11 }}
    />
  )
  return (
    <Section title="Global">
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Sel width={78} value={g.mode} options={[
          { value: 'poly', label: 'Poly' }, { value: 'mono', label: 'Mono' }, { value: 'legato', label: 'Legato' },
        ]} onChange={v => ctx.update(p => { p.global.mode = v as GlobalConfig['mode'] })} />
        <label style={lbl}>Voices {num(g.poly, (gg, n) => { gg.poly = n }, 1, 32)}</label>
        <Knob path="global.glide" label="Glide" size={34} log />
        <ToggleBtn on={g.glideLegatoOnly} label="Glide: legato" onClick={() => ctx.update(p => { p.global.glideLegatoOnly = !p.global.glideLegatoOnly })} />
        <label style={lbl}>PB range {num(g.pbRange, (gg, n) => { gg.pbRange = n }, 0, 48)}</label>
        <Knob label="Tune" size={34} min={-100} max={100} def={0} bipolar value={g.masterTune}
          onChange={v => { ctx.update(p => { p.global.masterTune = v }) }} format={v => `${v.toFixed(0)}ct`} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>VOICE SPREAD</span>
        <Knob label="Pan" size={32} min={0} max={1} def={0} value={g.voiceSpreadPan} onChange={v => { ctx.update(p => { p.global.voiceSpreadPan = v }) }} />
        <Knob label="Tune" size={32} min={0} max={1} def={0} value={g.voiceSpreadTune} onChange={v => { ctx.update(p => { p.global.voiceSpreadTune = v }) }} />
        <Knob label="Cutoff" size={32} min={0} max={1} def={0} value={g.voiceSpreadCutoff} onChange={v => { ctx.update(p => { p.global.voiceSpreadCutoff = v }) }} />
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 700 }}>SCALE</span>
        <Sel width={52} value={String(g.scaleRoot)} options={NOTE_NAMES.map((nn, k) => ({ value: String(k), label: nn }))}
          onChange={v => ctx.update(p => { p.global.scaleRoot = Number(v) })} />
        <Sel width={120} value={g.scaleName} options={Object.keys(SCALES).map(s => ({ value: s, label: s }))}
          onChange={v => ctx.update(p => { p.global.scaleName = v })} />
        <ToggleBtn on={g.scaleLock} label="Lock" title="Snap incoming notes to scale" onClick={() => ctx.update(p => { p.global.scaleLock = !p.global.scaleLock })} />
        <label style={lbl}>BPM {num(g.bpm, (gg, n) => { gg.bpm = n }, 40, 300, 54)}</label>
        <Sel width={72} title="Render quality" value={g.quality} options={[
          { value: 'draft', label: 'Draft' }, { value: 'good', label: 'Good' }, { value: 'high', label: 'High' },
        ]} onChange={v => ctx.update(p => { p.global.quality = v as GlobalConfig['quality'] })} />
      </div>
    </Section>
  )
}

const lbl: React.CSSProperties = { fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }
