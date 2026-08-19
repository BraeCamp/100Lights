'use client'
// Arpeggiator: modes, rate, gate, swing, hold, custom pattern editor.

import React, { useRef } from 'react'
import { useApollo, Knob, Sel, Section, ToggleBtn, UI } from './ApolloContext'
import { SYNC_RATES, ArpConfig } from '@/lib/apollo/patch'

const MODES: { value: ArpConfig['mode']; label: string }[] = [
  { value: 'up', label: 'Up' }, { value: 'down', label: 'Down' },
  { value: 'updown', label: 'Up-Down' }, { value: 'downup', label: 'Down-Up' },
  { value: 'converge', label: 'Converge' }, { value: 'diverge', label: 'Diverge' },
  { value: 'random', label: 'Random' }, { value: 'asplayed', label: 'As Played' },
  { value: 'pattern', label: 'Pattern' },
]

export default function ArpPanel() {
  const ctx = useApollo()
  const arp = ctx.patch.arp
  const dragVel = useRef(false)

  const setStep = (si: number, fn: (s: { step: number; on: boolean; vel: number }) => void) => {
    ctx.update(p => { const s = p.arp.pattern[si]; if (s) fn(s) })
  }

  return (
    <Section
      title="Arpeggiator"
      right={<ToggleBtn on={arp.on} label={arp.on ? 'ON' : 'OFF'} onClick={() => ctx.update(p => { p.arp.on = !p.arp.on })} />}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', opacity: arp.on ? 1 : 0.55 }}>
        <Sel width={92} value={arp.mode} options={MODES.map(m => ({ value: m.value, label: m.label }))}
          onChange={v => ctx.update(p => { p.arp.mode = v as ArpConfig['mode'] })} />
        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Oct
          <Sel width={44} value={String(arp.octaves)} options={[1, 2, 3, 4].map(o => ({ value: String(o), label: String(o) }))}
            onChange={v => ctx.update(p => { p.arp.octaves = Number(v) })} />
        </label>
        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Rate
          <Sel width={64} value={String(arp.syncRate)} options={SYNC_RATES.map((r, k) => ({ value: String(k), label: r.label }))}
            onChange={v => ctx.update(p => { p.arp.syncRate = Number(v) })} />
        </label>
        <Knob label="Gate" size={32} min={0.05} max={2} def={0.8} value={arp.gate}
          onChange={v => { ctx.update(p => { p.arp.gate = v }) }} />
        <Knob label="Swing" size={32} min={0} max={1} def={0} value={arp.swing}
          onChange={v => { ctx.update(p => { p.arp.swing = v }) }} />
        <label style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
          Transp
          <input type="number" min={-24} max={24} value={arp.transpose}
            onChange={e => ctx.update(p => { p.arp.transpose = Number(e.target.value) })}
            style={{ width: 44, background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 4px', fontSize: 11 }} />
        </label>
        <ToggleBtn on={arp.hold} label="Hold" title="Keep arpeggiating after release" onClick={() => ctx.update(p => { p.arp.hold = !p.arp.hold })} />
        <ToggleBtn on={arp.scaleLock} label="Scale" title="Snap to the global scale" onClick={() => ctx.update(p => { p.arp.scaleLock = !p.arp.scaleLock })} />
      </div>
      {arp.mode === 'pattern' && (
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', opacity: arp.on ? 1 : 0.55 }}>
          {arp.pattern.map((s, si) => (
            <div key={si} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <div
                onPointerDown={e => {
                  if (e.shiftKey) { setStep(si, st => { st.step = (st.step + 1) % 8 }); return }
                  dragVel.current = true
                  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
                  setStep(si, st => { st.on = !st.on })
                }}
                onPointerMove={e => {
                  if (!dragVel.current) return
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const v = Math.min(1, Math.max(0.05, 1 - (e.clientY - r.top) / r.height))
                  setStep(si, st => { st.vel = v })
                }}
                onPointerUp={() => { dragVel.current = false }}
                title="Click toggles • drag = velocity • shift-click cycles chord index"
                style={{
                  width: 22, height: 52, borderRadius: 4, border: '1px solid var(--border)', position: 'relative',
                  background: UI.inset, cursor: 'pointer', overflow: 'hidden', touchAction: 'none',
                }}
              >
                {s.on && (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${s.vel * 100}%`, background: 'var(--accent)' }} />
                )}
              </div>
              <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{s.step}</span>
            </div>
          ))}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <ToggleBtn on={false} label="+" onClick={() => ctx.update(p => { if (p.arp.pattern.length < 16) p.arp.pattern.push({ step: p.arp.pattern.length % 8, on: true, vel: 1 }) })} />
            <ToggleBtn on={false} label="−" onClick={() => ctx.update(p => { if (p.arp.pattern.length > 1) p.arp.pattern.pop() })} />
          </div>
        </div>
      )}
    </Section>
  )
}
