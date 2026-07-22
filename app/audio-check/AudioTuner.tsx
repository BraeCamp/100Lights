'use client'

// Live, by-ear tuner for the demo clips. Renders audio in the browser from the
// exact same DSP the server uses (lib/demo-audio), so what you hear here is what
// ships once you Save. Admin-gated by the page.

import { useEffect, useRef, useState } from 'react'
import { renderClip, DEFAULT_SETTINGS, type DemoSettings } from '@/lib/demo-audio'

type Ctrl = { label: string; path: string; min: number; max: number; step: number; unit: string }
type Section = { title: string; note: string; plays: { label: string; clip: string }[]; controls: Ctrl[] }

const SECTIONS: Section[] = [
  {
    title: 'Stem balance', note: 'How loud each instrument sits in the loop (affects most clips). Fix "one thing too loud" here.',
    plays: [{ label: '▶ Play the loop', clip: 'mix-mud' }],
    controls: [
      { label: 'Drums', path: 'stemDb.drums', min: -15, max: 6, step: 0.5, unit: 'dB' },
      { label: 'Bass', path: 'stemDb.bass', min: -15, max: 6, step: 0.5, unit: 'dB' },
      { label: 'Pad', path: 'stemDb.pad', min: -15, max: 6, step: 0.5, unit: 'dB' },
      { label: 'Lead', path: 'stemDb.lead', min: -15, max: 6, step: 0.5, unit: 'dB' },
    ],
  },
  {
    title: 'Test 1 — Compression', note: 'A = dry, B = compressed. Lower ratio / makeup if B "drones" or feels harsh.',
    plays: [{ label: '▶ A (dry)', clip: 'hear-comp-off' }, { label: '▶ B (compressed)', clip: 'hear-comp-on' }],
    controls: [
      { label: 'Threshold', path: 'comp.threshDb', min: -40, max: -6, step: 1, unit: 'dB' },
      { label: 'Ratio', path: 'comp.ratio', min: 1, max: 12, step: 0.5, unit: ':1' },
      { label: 'Makeup', path: 'comp.makeupDb', min: 0, max: 15, step: 0.5, unit: 'dB' },
    ],
  },
  {
    title: 'Test 2 — EQ (cut vs boost)', note: 'A = low-mids cut, B = low-mids boosted. Push the amounts until the difference is obvious.',
    plays: [{ label: '▶ A (cut)', clip: 'hear-eq-cut' }, { label: '▶ B (boost)', clip: 'hear-eq-boost' }],
    controls: [
      { label: 'Cut', path: 'eq.cutDb', min: -24, max: 0, step: 1, unit: 'dB' },
      { label: 'Boost', path: 'eq.boostDb', min: 0, max: 15, step: 1, unit: 'dB' },
      { label: 'Frequency', path: 'eq.freq', min: 150, max: 700, step: 10, unit: 'Hz' },
    ],
  },
  {
    title: 'Test 3 — Reverb (short vs long)', note: 'A = short tail, B = long tail. Send controls how loud the tail is.',
    plays: [{ label: '▶ A (short)', clip: 'hear-verb-08' }, { label: '▶ B (long)', clip: 'hear-verb-14' }],
    controls: [
      { label: 'Short decay', path: 'reverb.shortFb', min: 0.2, max: 0.7, step: 0.01, unit: '' },
      { label: 'Long decay', path: 'reverb.longFb', min: 0.7, max: 0.97, step: 0.01, unit: '' },
      { label: 'Send', path: 'reverb.send', min: 0.2, max: 1, step: 0.05, unit: '' },
    ],
  },
  {
    title: 'Test 4 — Hats level', note: 'A = normal, B = louder hats. Raise until you can clearly hear it.',
    plays: [{ label: '▶ A (normal)', clip: 'hear-hats-0' }, { label: '▶ B (louder)', clip: 'hear-hats-plus1' }],
    controls: [{ label: 'Hats boost', path: 'hats.plusDb', min: 0, max: 12, step: 0.5, unit: 'dB' }],
  },
  {
    title: 'Sidechain', note: 'A = bass held, B = bass ducked to the kick. Depth = how much it dips.',
    plays: [{ label: '▶ A (held)', clip: 'duck-off' }, { label: '▶ B (ducked)', clip: 'duck-on' }],
    controls: [{ label: 'Duck depth', path: 'duck.depth', min: 0, max: 1, step: 0.05, unit: '' }],
  },
]

const get = (o: unknown, path: string): number => path.split('.').reduce((a: unknown, k) => (a as Record<string, unknown>)?.[k], o) as number
function setPath(o: DemoSettings, path: string, v: number): DemoSettings {
  const clone: DemoSettings = JSON.parse(JSON.stringify(o))
  const keys = path.split('.')
  let node: Record<string, unknown> = clone as unknown as Record<string, unknown>
  for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]] as Record<string, unknown>
  node[keys[keys.length - 1]] = v
  return clone
}

export default function AudioTuner() {
  const [settings, setSettings] = useState<DemoSettings | null>(null)
  const [msg, setMsg] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const srcRef = useRef<AudioBufferSourceNode | null>(null)

  useEffect(() => {
    fetch('/api/admin/demo-audio').then(r => r.ok ? r.json() : null).then(d => setSettings(d?.settings ?? DEFAULT_SETTINGS)).catch(() => setSettings(DEFAULT_SETTINGS))
  }, [])

  function stop() { try { srcRef.current?.stop() } catch { /* already stopped */ } srcRef.current = null; setPlaying(null) }

  function play(clip: string) {
    if (!settings) return
    const ctx = (ctxRef.current ??= new AudioContext())
    void ctx.resume()
    stop()
    const { L, R } = renderClip(clip, settings)
    const buf = ctx.createBuffer(2, L.length, 44100)
    buf.getChannelData(0).set(L); buf.getChannelData(1).set(R)
    const src = ctx.createBufferSource()
    src.buffer = buf; src.connect(ctx.destination)
    src.onended = () => { if (srcRef.current === src) { srcRef.current = null; setPlaying(null) } }
    src.start()
    srcRef.current = src
    setPlaying(clip)
  }

  async function save() {
    if (!settings) return
    setMsg('Saving…')
    const r = await fetch('/api/admin/demo-audio', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) }).catch(() => null)
    setMsg(r?.ok ? 'Saved — live in the articles within ~5 min (players cache briefly).' : 'Save failed')
  }

  useEffect(() => () => { try { srcRef.current?.stop() } catch { /* noop */ } void ctxRef.current?.close() }, [])

  if (!settings) return <main style={{ maxWidth: 720, margin: '0 auto', padding: 40, color: 'var(--text-secondary)' }}>Loading…</main>

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', color: 'var(--text-primary)' }}>
      <main style={{ maxWidth: 720, margin: '0 auto', padding: '36px 20px 120px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, margin: '0 0 6px' }}>Audio tuner</h1>
        <p style={{ fontSize: 13.5, color: 'var(--text-secondary)', margin: '0 0 24px', lineHeight: 1.6 }}>
          Adjust each test by ear — playback is live and uses the exact code that ships. Hit <strong>Save</strong> to make your settings the real article clips.
        </p>

        {SECTIONS.map(sec => (
          <section key={sec.title} style={{ marginBottom: 22, padding: '16px 18px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
            <h2 style={{ fontSize: 15, fontWeight: 750, margin: '0 0 3px' }}>{sec.title}</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px', lineHeight: 1.5 }}>{sec.note}</p>
            {sec.controls.map(c => {
              const val = get(settings, c.path)
              return (
                <div key={c.path} style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 9 }}>
                  <span style={{ width: 90, fontSize: 12, color: 'var(--text-secondary)', flexShrink: 0 }}>{c.label}</span>
                  <input type="range" min={c.min} max={c.max} step={c.step} value={val}
                    onChange={e => setSettings(s => s ? setPath(s, c.path, parseFloat(e.target.value)) : s)}
                    style={{ flex: 1, accentColor: 'var(--accent)' }} />
                  <span style={{ width: 66, textAlign: 'right', fontSize: 12, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{val}{c.unit ? ` ${c.unit}` : ''}</span>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              {sec.plays.map(p => (
                <button key={p.clip} onClick={() => play(p.clip)} style={{
                  fontSize: 12.5, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                  border: `1px solid ${playing === p.clip ? 'var(--accent)' : 'var(--border)'}`,
                  background: playing === p.clip ? 'rgba(124,58,237,0.15)' : 'var(--bg-base)', color: 'var(--text-primary)',
                }}>{p.label}</button>
              ))}
              {playing && <button onClick={stop} style={{ fontSize: 12.5, fontWeight: 700, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', border: '1px solid #dc2626', background: 'rgba(220,38,38,0.12)', color: '#dc2626' }}>■ Stop</button>}
            </div>
          </section>
        ))}

        {/* Save bar */}
        <div style={{ position: 'sticky', bottom: 0, marginTop: 8, padding: '14px 0', background: 'linear-gradient(transparent, var(--bg-base) 30%)', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={save} style={{ fontSize: 14, fontWeight: 700, padding: '10px 22px', borderRadius: 10, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>Save — make live</button>
          <button onClick={() => setSettings(DEFAULT_SETTINGS)} style={{ fontSize: 13, padding: '9px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}>Reset to defaults</button>
          <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{msg}</span>
        </div>
      </main>
    </div>
  )
}
