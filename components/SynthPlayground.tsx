'use client'

/**
 * A tiny subtractive synth the reader can play inside an article. Built for the
 * Reese-bass piece: two detuned sawtooth oscillators through a resonant
 * lowpass, with the exact controls the article talks about — voices, detune,
 * cutoff, resonance — updating live so you hear the growl appear as you drag.
 *
 * "Hold" sustains one low note (the article's whole point: with two detuned
 * saws it never sits still, no modulation running). "Riff" loops the bass
 * pattern the article describes.
 *
 * "Guide me" runs a step-by-step tour: it strips the patch back to a plain
 * saw, then highlights one control at a time — with a target zone drawn on the
 * slider — and advances as you dial each value in, building up to the Reese.
 */

import { useEffect, useRef, useState } from 'react'

export interface SynthConfig {
  note?: number       // MIDI root, default 28 = E1
  detune?: number     // cents
  cutoff?: number     // Hz
  resonance?: number  // filter Q
  voices?: number     // 1 or 2
  caption?: string
}

const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
// Root · root · fifth · root | octave on the "and" of 3 · root · root · root
const RIFF = [0, 0, 7, 0, 12, 0, 0, 0]
const RIFF_BPM = 172

type TourStep = {
  spot: 'voices' | 'detune' | 'cutoff' | 'resonance' | null
  zone?: [number, number]
  text: string
  done: (s: { mode: string | null; voices: number; detune: number; cutoff: number; resonance: number }) => boolean
  final?: boolean
}

// The tour starts from a deliberately bland patch (one open saw) and walks up
// to the stock Reese, one control per step.
const TOUR: TourStep[] = [
  { spot: 'voices', text: "You're hearing one plain sawtooth — a bass note, nothing more. Switch to 2 saws.", done: s => s.voices === 2 },
  { spot: 'detune', zone: [6, 12], text: 'Two saws, but locked in tune, so still no growl. Detune them to about 9¢ — now they drift in and out of phase.', done: s => s.detune >= 6 && s.detune <= 12 },
  { spot: 'cutoff', zone: [480, 760], text: 'A Reese is dark — pull the Cutoff down toward 620 Hz and throw away most of the harshness.', done: s => s.cutoff >= 480 && s.cutoff <= 760 },
  { spot: 'resonance', zone: [5, 7.5], text: 'Add the vowel: bring Resonance up to around 6 for that "ooo" that sits under the drums.', done: s => s.resonance >= 5 && s.resonance <= 7.5 },
  { spot: null, text: "That's a Reese. Nothing is modulating it — the movement you hear is the two saws alone. Drag anything to keep exploring.", done: () => true, final: true },
]

export default function SynthPlayground({ config }: { config: SynthConfig }) {
  const note = config.note ?? 28
  const [voices, setVoices] = useState(config.voices ?? 2)
  const [detune, setDetune] = useState(config.detune ?? 9)
  const [cutoff, setCutoff] = useState(config.cutoff ?? 620)
  const [resonance, setResonance] = useState(config.resonance ?? 6)
  const [mode, setMode] = useState<null | 'hold' | 'riff'>(null)
  const [tour, setTour] = useState<number | null>(null)

  const ctxRef = useRef<AudioContext | null>(null)
  const nodes = useRef<{ oscs: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode } | null>(null)
  const riffTimer = useRef<number | null>(null)
  const step = useRef(0)
  const nextTime = useRef(0)
  // The audio engine reads its parameters from refs, not React state — state
  // updates land a render too late for an immediate rebuild (see changeVoices).
  const p = useRef({ voices, detune, cutoff, resonance })
  p.current = { voices, detune, cutoff, resonance }

  function ctx() { return (ctxRef.current ??= new AudioContext()) }

  function teardown() {
    if (riffTimer.current) { clearInterval(riffTimer.current); riffTimer.current = null }
    const n = nodes.current
    if (n) {
      const c = ctxRef.current!
      n.gain.gain.cancelScheduledValues(c.currentTime)
      n.gain.gain.setTargetAtTime(0, c.currentTime, 0.03)
      const oscs = n.oscs
      setTimeout(() => { oscs.forEach(o => { try { o.stop() } catch { /* stopped */ } }); n.filter.disconnect(); n.gain.disconnect() }, 120)
      nodes.current = null
    }
  }

  function build(ov?: Partial<{ voices: number; detune: number; cutoff: number; resonance: number }>): { oscs: OscillatorNode[]; filter: BiquadFilterNode; gain: GainNode } {
    const c = ctx()
    void c.resume()
    const { voices: nv, detune: nd, cutoff: nc, resonance: nr } = { ...p.current, ...ov }
    const filter = c.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = nc
    filter.Q.value = nr
    const gain = c.createGain()
    gain.gain.value = 0
    filter.connect(gain); gain.connect(c.destination)
    const freq = midiToHz(note)
    const oscs: OscillatorNode[] = []
    for (let i = 0; i < nv; i++) {
      const o = c.createOscillator()
      o.type = 'sawtooth'
      o.frequency.value = freq
      // Symmetric spread: one below, one above.
      o.detune.value = nv === 1 ? 0 : (i === 0 ? -nd / 2 : nd / 2)
      o.connect(filter); o.start()
      oscs.push(o)
    }
    return { oscs, filter, gain }
  }

  function startHold(ov?: { voices: number }) {
    teardown()
    const n = build(ov)
    nodes.current = n
    const c = ctxRef.current!
    n.gain.gain.setTargetAtTime(0.28, c.currentTime, 0.006) // 6 ms attack
    setMode('hold')
  }

  function startRiff(ov?: { voices: number }) {
    teardown()
    const n = build(ov)
    nodes.current = n
    const c = ctxRef.current!
    step.current = 0
    nextTime.current = c.currentTime + 0.06
    const stepDur = 60 / RIFF_BPM / 2 // eighth notes
    riffTimer.current = window.setInterval(() => {
      const nn = nodes.current
      if (!nn) return
      while (nextTime.current < c.currentTime + 0.12) {
        const semis = RIFF[step.current % RIFF.length]
        const f = midiToHz(note + semis)
        for (const o of nn.oscs) o.frequency.setValueAtTime(f, nextTime.current)
        // Retrigger the amp envelope for each note, with a sliver of gap.
        nn.gain.gain.setValueAtTime(0.0001, nextTime.current)
        nn.gain.gain.exponentialRampToValueAtTime(0.3, nextTime.current + 0.006)
        nn.gain.gain.setTargetAtTime(0.22, nextTime.current + 0.02, 0.05)
        nn.gain.gain.setTargetAtTime(0.0001, nextTime.current + stepDur * 0.75, 0.02)
        nextTime.current += stepDur
        step.current++
      }
    }, 25)
    setMode('riff')
  }

  function stop() { teardown(); setMode(null); setTour(null) }

  // Live control changes apply to the running sound.
  useEffect(() => {
    const n = nodes.current, c = ctxRef.current
    if (!n || !c) return
    n.filter.frequency.setTargetAtTime(cutoff, c.currentTime, 0.02)
    n.filter.Q.setTargetAtTime(resonance, c.currentTime, 0.02)
    if (n.oscs.length >= 2) {
      n.oscs[0].detune.setTargetAtTime(-detune / 2, c.currentTime, 0.02)
      n.oscs[1].detune.setTargetAtTime(detune / 2, c.currentTime, 0.02)
    }
  }, [cutoff, resonance, detune])

  // Changing the number of oscillators needs a full rebuild. Update the engine's
  // param ref synchronously so the rebuild uses the new count, not stale state.
  function changeVoices(v: number) {
    p.current = { ...p.current, voices: v }
    setVoices(v)
    if (mode === 'hold') startHold({ voices: v })
    else if (mode === 'riff') startRiff({ voices: v })
  }

  // Guided tour: reset to a bland one-saw patch, start it, and step forward as
  // the reader dials each control into range.
  function startTour() {
    p.current = { voices: 1, detune: 0, cutoff: 2600, resonance: 1 }
    setVoices(1); setDetune(0); setCutoff(2600); setResonance(1)
    setTour(0)
    startHold({ voices: 1 })
  }

  useEffect(() => {
    if (tour == null) return
    const s = TOUR[tour]
    if (s.final) return
    if (s.done({ mode, voices, detune, cutoff, resonance })) {
      const id = setTimeout(() => setTour(t => (t == null ? null : Math.min(t + 1, TOUR.length - 1))), 700)
      return () => clearTimeout(id)
    }
  }, [tour, mode, voices, detune, cutoff, resonance])

  useEffect(() => () => { teardown(); void ctxRef.current?.close() }, [])

  const active = tour != null ? TOUR[tour] : null
  const spot = active?.spot ?? null

  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{ position: 'relative', border: `1px solid ${tour != null ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 14, padding: '18px 18px 16px', background: 'rgba(255,255,255,0.02)' }}>
        {/* Tour instruction banner */}
        {active && (
          <div style={{ marginBottom: 16, padding: '11px 13px', borderRadius: 10, background: 'rgba(124,58,237,0.12)', border: '1px solid var(--accent)' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', color: 'var(--accent-light)' }}>
                {active.final ? 'DONE' : `STEP ${tour! + 1} OF ${TOUR.length - 1}`}
              </span>
              <button onClick={() => setTour(null)} style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                {active.final ? 'Close' : 'Skip tour'}
              </button>
            </div>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.55 }}>{active.text}</p>
          </div>
        )}

        {/* Transport */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={() => mode === 'hold' ? stop() : startHold()} style={btn(mode === 'hold')}>
            {mode === 'hold' ? '■ Stop' : '▶ Hold a note'}
          </button>
          <button onClick={() => mode === 'riff' ? stop() : startRiff()} style={btn(mode === 'riff')}>
            {mode === 'riff' ? '■ Stop' : '▶ Play the riff'}
          </button>
          <button onClick={startTour} style={{
            padding: '8px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            border: '1px solid var(--accent)', background: tour != null ? 'rgba(124,58,237,0.15)' : 'transparent', color: 'var(--accent-light)',
          }}>✨ Guide me</button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{tour != null ? 'follow the highlight' : 'drag while it plays'}</span>
        </div>

        {/* Voices — the teaching control */}
        <div className={spot === 'voices' ? 'reese-spot' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, borderRadius: 9, padding: spot === 'voices' ? '6px 8px' : 0, margin: spot === 'voices' ? '-6px -8px 8px' : '0 0 14px' }}>
          <span style={{ fontSize: 11.5, color: 'var(--text-secondary)', width: 96, flexShrink: 0 }}>Oscillators</span>
          {[1, 2].map(v => (
            <button key={v} onClick={() => changeVoices(v)} style={{
              fontSize: 12, fontWeight: 700, padding: '5px 14px', borderRadius: 8, cursor: 'pointer',
              border: `1px solid ${voices === v ? 'var(--accent)' : 'var(--border)'}`,
              background: voices === v ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: voices === v ? 'var(--accent-light)' : 'var(--text-muted)',
            }}>{v} saw{v > 1 ? 's' : ''}</button>
          ))}
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{voices === 1 ? 'one saw — no growl' : 'two detuned saws — the growl'}</span>
        </div>

        <Slider label="Detune" value={detune} min={0} max={60} step={1} unit="¢" onChange={setDetune} disabled={voices < 2}
          spot={spot === 'detune'} zone={spot === 'detune' ? active?.zone : undefined}
          hint={detune === 0 ? '' : detune > 50 ? 'too far — sounds like two instruments' : detune > 30 ? 'thicker, blurrier' : 'motion without pitch'} />
        <Slider label="Cutoff" value={cutoff} min={100} max={4000} step={10} unit="Hz" onChange={setCutoff}
          spot={spot === 'cutoff'} zone={spot === 'cutoff' ? active?.zone : undefined}
          hint={cutoff <= 700 ? 'dark — the classic Reese' : cutoff > 2000 ? 'bright, buzzy' : ''} />
        <Slider label="Resonance" value={resonance} min={0.5} max={14} step={0.5} unit="Q" onChange={setResonance}
          spot={spot === 'resonance'} zone={spot === 'resonance' ? active?.zone : undefined}
          hint={resonance <= 1.5 ? 'polite' : resonance >= 11 ? 'whistling on its own' : 'that vowel-like bump'} />
      </div>
      {config.caption && (
        <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{config.caption}</figcaption>
      )}
      <style>{`
        @keyframes reesePulse { 0%,100% { box-shadow: 0 0 0 1px var(--accent), 0 0 10px 0 rgba(124,58,237,0.35); } 50% { box-shadow: 0 0 0 2px var(--accent), 0 0 18px 3px rgba(124,58,237,0.65); } }
        .reese-spot { animation: reesePulse 1.4s ease-in-out infinite; }
      `}</style>
    </figure>
  )
}

function Slider({ label, value, min, max, step, unit, onChange, hint, disabled, spot, zone }: {
  label: string; value: number; min: number; max: number; step: number; unit: string
  onChange: (v: number) => void; hint?: string; disabled?: boolean; spot?: boolean; zone?: [number, number]
}) {
  const pct = (v: number) => ((v - min) / (max - min)) * 100
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, opacity: disabled ? 0.4 : 1 }}>
      <span style={{ fontSize: 11.5, color: spot ? 'var(--accent-light)' : 'var(--text-secondary)', fontWeight: spot ? 700 : 400, width: 96, flexShrink: 0 }}>{label}</span>
      <div className={spot ? 'reese-spot' : undefined} style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', borderRadius: 6, padding: spot ? '4px 6px' : 0, margin: spot ? '0 -6px' : 0 }}>
        {zone && (
          <div aria-hidden="true" style={{
            position: 'absolute', left: `calc(${pct(zone[0])}% )`, width: `${pct(zone[1]) - pct(zone[0])}%`,
            top: '50%', height: 10, transform: 'translateY(-50%)', pointerEvents: 'none',
            background: 'rgba(124,58,237,0.30)', border: '1px solid var(--accent)', borderRadius: 4,
          }} />
        )}
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled}
          onChange={e => onChange(parseFloat(e.target.value))} className="cf-slider" style={{ width: '100%', position: 'relative' }} />
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', width: 62, textAlign: 'right', flexShrink: 0 }}>
        {value} {unit}
      </span>
      {hint && <span style={{ fontSize: 10.5, color: 'var(--text-muted)', width: 150, flexShrink: 0, lineHeight: 1.3 }}>{hint}</span>}
    </div>
  )
}

function btn(active: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', borderRadius: 9, cursor: 'pointer', fontSize: 13, fontWeight: 700,
    border: active ? '1px solid #dc2626' : 'none',
    background: active ? 'rgba(220,38,38,0.13)' : 'var(--accent)',
    color: active ? '#dc2626' : '#fff',
  }
}
