'use client'
// Sub oscillator + noise sampler strips.

import React from 'react'
import { useApollo, Knob, Sel, Section, ToggleBtn } from './ApolloContext'
import SamplePicker from './SamplePicker'
import type { SourceDest } from '@/lib/apollo/patch'

const DEST_OPTS = [
  { value: 'f1', label: '→ F1' }, { value: 'f2', label: '→ F2' },
  { value: 'both', label: '→ F1+F2' }, { value: 'bypass', label: 'Bypass' },
]

export default function SubNoisePanel() {
  const ctx = useApollo()
  const { sub, noise } = ctx.patch
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <Section
        title="Sub"
        right={<ToggleBtn on={sub.enabled} label={sub.enabled ? 'On' : 'Off'} onClick={() => ctx.update(p => { p.sub.enabled = !p.sub.enabled })} />}
      >
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Sel width={72} value={sub.shape} options={[
            { value: 'sine', label: 'Sine' }, { value: 'triangle', label: 'Triangle' },
            { value: 'square', label: 'Square' }, { value: 'saw', label: 'Saw' },
          ]} onChange={v => ctx.update(p => { p.sub.shape = v as typeof sub.shape })} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            <button onClick={() => ctx.update(p => { p.sub.octave = Math.max(-2, p.sub.octave - 1) })} style={btn}>−</button>
            <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 28, textAlign: 'center' }}>{sub.octave} oct</span>
            <button onClick={() => ctx.update(p => { p.sub.octave = Math.min(0, p.sub.octave + 1) })} style={btn}>+</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Knob path="sub.level" label="Level" size={34} />
          <Knob path="sub.pan" label="Pan" bipolar size={34} />
          <Sel width={80} value={sub.dest} options={DEST_OPTS} onChange={v => ctx.update(p => { p.sub.dest = v as SourceDest })} />
          <ToggleBtn on={sub.direct} label="Direct" title="Bypass filters and FX to output" onClick={() => ctx.update(p => { p.sub.direct = !p.sub.direct })} />
        </div>
      </Section>
      <Section
        title="Noise"
        right={<ToggleBtn on={noise.enabled} label={noise.enabled ? 'On' : 'Off'} onClick={() => ctx.update(p => { p.noise.enabled = !p.noise.enabled })} />}
      >
        <SamplePicker oscIndex={0} target="noise" />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <Knob path="noise.level" label="Level" size={34} />
          <Knob path="noise.pan" label="Pan" bipolar size={34} />
          <Knob path="noise.pitch" label="Pitch" bipolar size={34} />
          <Sel width={80} value={noise.dest} options={DEST_OPTS} onChange={v => ctx.update(p => { p.noise.dest = v as SourceDest })} />
          <ToggleBtn on={noise.keytrack} label="Key" onClick={() => ctx.update(p => { p.noise.keytrack = !p.noise.keytrack })} />
          <ToggleBtn on={noise.oneShot} label="1-shot" onClick={() => ctx.update(p => { p.noise.oneShot = !p.noise.oneShot })} />
        </div>
      </Section>
    </div>
  )
}

const btn: React.CSSProperties = {
  background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)',
  borderRadius: 4, width: 18, height: 18, fontSize: 11, cursor: 'pointer', lineHeight: 1, padding: 0,
}
