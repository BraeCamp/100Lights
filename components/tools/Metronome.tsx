'use client'

/**
 * Standalone metronome with a tempo trainer, subdivisions, editable accents,
 * tap tempo, keyboard control, and a type-in BPM.
 *
 * The DAW's metronome is welded to the engine, so this runs its own look-ahead
 * scheduler: it schedules clicks a beat ahead against AudioContext.currentTime
 * rather than firing them from a timer, which would audibly drift. The
 * scheduler advances by *ticks* (a beat divided by the subdivision) so the
 * off-beat clicks land exactly.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

const LOOKAHEAD_S = 0.15
const TICK_MS = 25
const MIN_BPM = 20
const MAX_BPM = 400

type AccentLevel = 0 | 1 | 2 // silent / normal / accent

const SUBDIVISIONS: Array<{ n: number; label: string }> = [
  { n: 1, label: '♩' },
  { n: 2, label: '♫' },
  { n: 3, label: '⅃' },
  { n: 4, label: '♬' },
]

// Broad tempo-marking names people also search for.
function tempoName(bpm: number): string {
  if (bpm < 40) return 'Grave'
  if (bpm < 60) return 'Largo'
  if (bpm < 76) return 'Adagio'
  if (bpm < 108) return 'Andante'
  if (bpm < 120) return 'Moderato'
  if (bpm < 156) return 'Allegro'
  if (bpm < 176) return 'Vivace'
  if (bpm < 200) return 'Presto'
  return 'Prestissimo'
}

const clampBpm = (v: number) => Math.max(MIN_BPM, Math.min(MAX_BPM, Math.round(v)))
const PREFS_KEY = '100lights-metronome'

interface Trainer { on: boolean; target: number; step: number; everyBars: number }

export default function Metronome({ initialBpm }: { initialBpm?: number }) {
  const [bpm, setBpm] = useState(initialBpm ?? 120)
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const [subdivision, setSubdivision] = useState(1)
  const [accents, setAccents] = useState<AccentLevel[]>(() => Array.from({ length: 4 }, (_, i) => (i === 0 ? 2 : 1)))
  const [playing, setPlaying] = useState(false)
  const [beat, setBeat] = useState(-1)
  const [editingBpm, setEditingBpm] = useState(false)
  const [trainer, setTrainer] = useState<Trainer>({ on: false, target: 160, step: 5, everyBars: 2 })

  const ctxRef = useRef<AudioContext | null>(null)
  const bufs = useRef<{ accent: AudioBuffer; normal: AudioBuffer; sub: AudioBuffer } | null>(null)
  const timer = useRef<number | null>(null)
  const nextTickTime = useRef(0)
  const tickCount = useRef(0)

  // Live values the scheduler reads without re-arming on every change.
  const ref = useRef({ bpm, beatsPerBar, subdivision, accents, trainer })
  useEffect(() => { ref.current = { bpm, beatsPerBar, subdivision, accents, trainer } }, [bpm, beatsPerBar, subdivision, accents, trainer])

  const tapTimes = useRef<number[]>([])

  // ── persistence ──────────────────────────────────────────────
  // Load prefs after mount (never during render) so SSR and hydration match.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PREFS_KEY)
      if (!raw) return
      const p = JSON.parse(raw)
      // A specific-BPM page (/metronome/120) honours its URL, not the saved tempo.
      if (initialBpm == null && typeof p.bpm === 'number') setBpm(clampBpm(p.bpm))
      if (typeof p.beatsPerBar === 'number') setBeatsPerBar(p.beatsPerBar)
      if (typeof p.subdivision === 'number') setSubdivision(p.subdivision)
      if (Array.isArray(p.accents)) setAccents(p.accents)
      if (p.trainer) setTrainer(t => ({ ...t, ...p.trainer, on: false }))
    } catch { /* ignore corrupt prefs */ }
  }, [initialBpm])

  useEffect(() => {
    const t = setTimeout(() => {
      try { localStorage.setItem(PREFS_KEY, JSON.stringify({ bpm, beatsPerBar, subdivision, accents, trainer: { target: trainer.target, step: trainer.step, everyBars: trainer.everyBars } })) } catch { /* quota */ }
    }, 300)
    return () => clearTimeout(t)
  }, [bpm, beatsPerBar, subdivision, accents, trainer])

  // Changing the meter resizes the accent pattern in the same action, keeping
  // beats and accents in sync without a reactive effect.
  function changeBeats(n: number) {
    setBeatsPerBar(n)
    setAccents(prev => Array.from({ length: n }, (_, i) => prev[i] ?? (i === 0 ? 2 : 1)))
  }

  function ctx(): AudioContext {
    if (!ctxRef.current) {
      const c = new AudioContext()
      ctxRef.current = c
      const sr = c.sampleRate
      const len = Math.floor(sr * 0.04)
      const build = (freq: number, gain: number) => {
        const b = c.createBuffer(1, len, sr)
        const d = b.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.sin(2 * Math.PI * freq * i / sr) * Math.exp(-i / (sr * 0.012)) * gain
        return b
      }
      bufs.current = { accent: build(2000, 1), normal: build(1000, 0.6), sub: build(1500, 0.28) }
    }
    return ctxRef.current
  }

  const schedule = useCallback(() => {
    const c = ctxRef.current
    const b = bufs.current
    if (!c || !b) return
    const { beatsPerBar: bpb, subdivision: sub, accents: acc, trainer: tr } = ref.current
    const ticksPerBar = bpb * sub

    while (nextTickTime.current < c.currentTime + LOOKAHEAD_S) {
      const tc = tickCount.current
      const subIndex = tc % sub
      const beatIndex = Math.floor(tc / sub) % bpb
      const isBeat = subIndex === 0

      let buf: AudioBuffer | null = null
      if (isBeat) {
        const level = acc[beatIndex] ?? 1
        buf = level === 2 ? b.accent : level === 1 ? b.normal : null
      } else {
        buf = b.sub
      }
      if (buf) {
        const src = c.createBufferSource()
        src.buffer = buf
        src.connect(c.destination)
        src.start(nextTickTime.current)
        src.onended = () => src.disconnect()
      }
      if (isBeat) {
        const at = nextTickTime.current
        window.setTimeout(() => setBeat(beatIndex), Math.max(0, (at - c.currentTime) * 1000))
      }

      // Tempo trainer: at each bar boundary, step toward the target.
      const secPerBeat = 60 / ref.current.bpm
      nextTickTime.current += secPerBeat / sub
      tickCount.current++
      if (tr.on && tickCount.current % ticksPerBar === 0) {
        setBpm(cur => {
          if (cur === tr.target) return cur
          const barsDone = tickCount.current / ticksPerBar
          if (barsDone % Math.max(1, tr.everyBars) !== 0) return cur
          const dir = tr.target > cur ? 1 : -1
          const next = cur + dir * tr.step
          return dir > 0 ? Math.min(tr.target, next) : Math.max(tr.target, next)
        })
      }
    }
  }, [])

  const start = useCallback(() => {
    const c = ctx()
    void c.resume()
    tickCount.current = 0
    nextTickTime.current = c.currentTime + 0.06
    setPlaying(true)
    timer.current = window.setInterval(schedule, TICK_MS)
  }, [schedule])

  const stop = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    setPlaying(false)
    setBeat(-1)
  }, [])

  const toggle = useCallback(() => { playing ? stop() : start() }, [playing, start, stop])

  function tap() {
    const now = performance.now()
    const times = tapTimes.current.filter(t => now - t < 2000)
    times.push(now)
    tapTimes.current = times
    if (times.length >= 2) {
      const gaps = times.slice(1).map((t, i) => t - times[i])
      setBpm(clampBpm(60000 / (gaps.reduce((a, b) => a + b, 0) / gaps.length)))
    }
  }

  // Spacebar toggles, unless typing into a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.code === 'Space') { e.preventDefault(); toggle() }
      else if (e.code === 'ArrowUp') { e.preventDefault(); setBpm(b => clampBpm(b + 1)) }
      else if (e.code === 'ArrowDown') { e.preventDefault(); setBpm(b => clampBpm(b - 1)) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
    void ctxRef.current?.close()
  }, [])

  function cycleAccent(i: number) {
    setAccents(prev => prev.map((v, j) => j === i ? (((v + 1) % 3) as AccentLevel) : v))
  }

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 18, padding: '24px 22px', background: 'var(--bg-card)', maxWidth: 440, margin: '0 auto' }}>
      {/* BPM — click to type */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        {editingBpm ? (
          <input
            autoFocus type="number" min={MIN_BPM} max={MAX_BPM} defaultValue={bpm}
            onBlur={e => { setBpm(clampBpm(Number(e.target.value) || bpm)); setEditingBpm(false) }}
            onKeyDown={e => { if (e.key === 'Enter') { setBpm(clampBpm(Number((e.target as HTMLInputElement).value) || bpm)); setEditingBpm(false) } if (e.key === 'Escape') setEditingBpm(false) }}
            style={{ width: 150, fontSize: 56, fontWeight: 800, textAlign: 'center', background: 'var(--bg-base)', border: '1px solid var(--accent)', borderRadius: 12, color: 'var(--text-primary)', outline: 'none', fontVariantNumeric: 'tabular-nums' }}
          />
        ) : (
          <button onClick={() => setEditingBpm(true)} title="Click to type a tempo"
            style={{ background: 'none', border: 'none', cursor: 'text', padding: 0, display: 'block', margin: '0 auto' }}>
            <span style={{ fontSize: 62, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{bpm}</span>
          </button>
        )}
        <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: 2 }}>
          BPM · {tempoName(bpm)}
        </div>
      </div>

      {/* Beat dots — click to cycle accent / normal / silent */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 9, marginBottom: 8, flexWrap: 'wrap' }}>
        {accents.map((level, i) => (
          <button key={i} onClick={() => cycleAccent(i)} title="Accent · normal · silent"
            style={{
              width: 22, height: 22, borderRadius: 6, cursor: 'pointer', padding: 0,
              border: `1px solid ${beat === i ? 'transparent' : 'var(--border)'}`,
              background: level === 0 ? 'transparent'
                : beat === i ? (level === 2 ? 'var(--accent-light)' : '#34d399')
                : (level === 2 ? 'rgba(139,92,246,0.5)' : 'rgba(52,211,153,0.35)'),
              transform: beat === i ? 'scale(1.2)' : 'scale(1)', transition: 'transform 60ms, background 60ms',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff',
            }}>{level === 0 ? '·' : ''}</button>
        ))}
      </div>
      <p style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', margin: '0 0 16px' }}>tap a dot to accent, quiet, or silence that beat</p>

      <input type="range" min={MIN_BPM} max={Math.min(300, MAX_BPM)} value={Math.min(bpm, 300)} onChange={e => setBpm(Number(e.target.value))}
        className="cf-slider" style={{ width: '100%', marginBottom: 16 }} aria-label="Tempo" />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 18, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={() => setBpm(b => clampBpm(b - 1))} style={stepBtn}>−</button>
        <button onClick={toggle} style={{ padding: '11px 30px', borderRadius: 11, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer', background: playing ? '#dc2626' : 'var(--accent)', color: '#fff' }}>
          {playing ? '■ Stop' : '▶ Start'}
        </button>
        <button onClick={() => setBpm(b => clampBpm(b + 1))} style={stepBtn}>+</button>
        <button onClick={tap} style={{ ...stepBtn, width: 'auto', padding: '0 16px', fontSize: 12, fontWeight: 700 }}>TAP</button>
      </div>

      {/* Meter + subdivision */}
      <div style={{ display: 'flex', gap: 18, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 16 }}>
        <Group label="Beats / bar">
          {[2, 3, 4, 5, 6, 7].map(n => <Chip key={n} on={beatsPerBar === n} onClick={() => changeBeats(n)}>{n}</Chip>)}
        </Group>
        <Group label="Subdivision">
          {SUBDIVISIONS.map(s => <Chip key={s.n} on={subdivision === s.n} onClick={() => setSubdivision(s.n)}>{s.label}</Chip>)}
        </Group>
      </div>

      {/* Tempo trainer */}
      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: trainer.on ? 12 : 0 }}>
          <input type="checkbox" checked={trainer.on} onChange={e => setTrainer(t => ({ ...t, on: e.target.checked }))} />
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Tempo trainer</span>
          <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>speed up automatically as you play</span>
        </label>
        {trainer.on && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--text-secondary)' }}>
            <span>Climb to</span>
            <NumBox value={trainer.target} min={MIN_BPM} max={MAX_BPM} onChange={v => setTrainer(t => ({ ...t, target: clampBpm(v) }))} />
            <span>BPM, +</span>
            <NumBox value={trainer.step} min={1} max={40} onChange={v => setTrainer(t => ({ ...t, step: Math.max(1, Math.min(40, Math.round(v))) }))} />
            <span>every</span>
            <NumBox value={trainer.everyBars} min={1} max={16} onChange={v => setTrainer(t => ({ ...t, everyBars: Math.max(1, Math.min(16, Math.round(v))) }))} />
            <span>bars</span>
          </div>
        )}
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', textAlign: 'center', marginTop: 14, marginBottom: 0 }}>
        Press <kbd style={kbd}>space</kbd> to start/stop · <kbd style={kbd}>↑</kbd><kbd style={kbd}>↓</kbd> to nudge tempo
      </p>
    </div>
  )
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>{children}</div>
    </div>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      minWidth: 30, height: 30, padding: '0 8px', borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 13,
      border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
      background: on ? 'rgba(124,58,237,0.15)' : 'transparent',
      color: on ? 'var(--accent-light)' : 'var(--text-muted)',
    }}>{children}</button>
  )
}

function NumBox({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <input type="number" min={min} max={max} value={value} onChange={e => onChange(Number(e.target.value))}
      style={{ width: 52, fontSize: 12.5, padding: '4px 6px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none', textAlign: 'center' }} />
  )
}

const stepBtn: React.CSSProperties = {
  width: 42, height: 42, borderRadius: 11, cursor: 'pointer', fontSize: 20, fontWeight: 700,
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const kbd: React.CSSProperties = { fontFamily: 'inherit', fontSize: 10, padding: '1px 5px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-base)', margin: '0 1px' }
