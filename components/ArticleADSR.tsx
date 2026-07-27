'use client'

// Hear an envelope. A note retriggers on a loop through a sawtooth → lowpass →
// amp-envelope voice, and the four ADSR sliders reshape it live: fast attack +
// short release is a pluck, slow attack + long release is a pad. The shape is
// drawn from the same numbers that drive the audio.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, mixCtx, Frame, Transport, Control, rangeStyle } from './article/mix-kit'

export default function ArticleADSR({ caption }: { caption?: string }) {
  const [attack, setAttack] = useState(0.01)
  const [decay, setDecay] = useState(0.18)
  const [sustain, setSustain] = useState(0.6)   // 0..1 level
  const [release, setRelease] = useState(0.3)
  const [cutoff, setCutoff] = useState(4000)
  const [playing, setPlaying] = useState(false)

  const outRef = useRef<GainNode | null>(null)
  const timerRef = useRef<number | null>(null)
  // Live values for the scheduler without re-arming the loop.
  const p = useRef({ attack, decay, sustain, release, cutoff })
  p.current = { attack, decay, sustain, release, cutoff }

  useEffect(() => {
    const c = mixCtx()
    const out = c.createGain(); out.gain.value = 0.9; out.connect(c.destination)
    outRef.current = out
    return () => { out.disconnect() }
  }, [])

  function trigger() {
    const c = mixCtx(), out = outRef.current
    if (!out) return
    const { attack: a, decay: d, sustain: s, release: r, cutoff: co } = p.current
    const t = c.currentTime + 0.02
    const hold = 0.35                       // seconds at the sustain level
    const osc = c.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 130.81  // C3
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = co; filt.Q.value = 1
    const g = c.createGain()
    const peak = 0.5
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(peak, t + a)                       // attack
    g.gain.linearRampToValueAtTime(Math.max(0.0001, peak * s), t + a + d)  // decay → sustain
    const relStart = t + a + d + hold
    g.gain.setValueAtTime(Math.max(0.0001, peak * s), relStart)
    g.gain.linearRampToValueAtTime(0.0001, relStart + r)             // release
    osc.connect(filt); filt.connect(g); g.connect(out)
    osc.start(t); osc.stop(relStart + r + 0.05)
  }

  function start() {
    void mixCtx().resume()
    setPlaying(true)
    trigger()
    // Retrigger with enough gap that the longest release still finishes.
    timerRef.current = window.setInterval(() => {
      const { attack: a, decay: d, release: r } = p.current
      // guard against a too-short cycle at extreme settings
      void a; void d; void r
      trigger()
    }, 1600)
  }
  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setPlaying(false)
  }
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  // Draw the ADSR shape (normalized to the widget width).
  const shape = (() => {
    const W = 320, H = 90, pad = 4
    const hold = 0.35
    const total = attack + decay + hold + release || 1
    const x = (s: number) => pad + (s / total) * (W - pad * 2)
    const y = (lvl: number) => H - pad - lvl * (H - pad * 2)
    const p0 = [x(0), y(0)]
    const p1 = [x(attack), y(1)]
    const p2 = [x(attack + decay), y(sustain)]
    const p3 = [x(attack + decay + hold), y(sustain)]
    const p4 = [x(total), y(0)]
    return { W, H, d: `M${p0} L${p1} L${p2} L${p3} L${p4}`, pts: [p1, p2, p3] }
  })()

  return (
    <Frame caption={caption}>
      <Transport ready playing={playing} onPlay={start} onStop={stop} playLabel="Loop a note"
        onReset={() => { setAttack(0.01); setDecay(0.18); setSustain(0.6); setRelease(0.3); setCutoff(4000) }} />

      <svg viewBox={`0 0 ${shape.W} ${shape.H}`} width="100%" height={shape.H} style={{ display: 'block', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-base)', marginBottom: 14 }} aria-hidden="true">
        <path d={`${shape.d} L${shape.W - 4},${shape.H - 4} L4,${shape.H - 4} Z`} fill="rgba(167,139,250,0.12)" stroke="none" />
        <path d={shape.d} fill="none" stroke={ACCENT} strokeWidth={2} strokeLinejoin="round" />
        {shape.pts.map((pt, i) => <circle key={i} cx={pt[0]} cy={pt[1]} r={3} fill={ACCENT} />)}
      </svg>

      <Control label="Attack" value={`${Math.round(attack * 1000)} ms`}>
        <input type="range" min={0} max={1.5} step={0.005} value={attack} onChange={e => setAttack(+e.target.value)} style={rangeStyle} aria-label="Attack" />
      </Control>
      <Control label="Decay" value={`${Math.round(decay * 1000)} ms`}>
        <input type="range" min={0} max={1.5} step={0.005} value={decay} onChange={e => setDecay(+e.target.value)} style={rangeStyle} aria-label="Decay" />
      </Control>
      <Control label="Sustain" value={`${Math.round(sustain * 100)}%`}>
        <input type="range" min={0} max={1} step={0.01} value={sustain} onChange={e => setSustain(+e.target.value)} style={rangeStyle} aria-label="Sustain" />
      </Control>
      <Control label="Release" value={`${Math.round(release * 1000)} ms`}>
        <input type="range" min={0} max={2} step={0.01} value={release} onChange={e => setRelease(+e.target.value)} style={rangeStyle} aria-label="Release" />
      </Control>
      <Control label="Filter cutoff" value={cutoff >= 1000 ? `${(cutoff / 1000).toFixed(1)} kHz` : `${Math.round(cutoff)} Hz`}>
        <input type="range" min={200} max={12000} step={50} value={cutoff} onChange={e => setCutoff(+e.target.value)} style={rangeStyle} aria-label="Cutoff" />
      </Control>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Attack</strong> is how fast it fades in, <strong style={{ color: 'var(--text-secondary)' }}>decay</strong> falls to the <strong style={{ color: 'var(--text-secondary)' }}>sustain</strong> level it holds while a key is down, and <strong style={{ color: 'var(--text-secondary)' }}>release</strong> is the tail after you let go. Snappy attack + short release = a pluck; slow attack + long release = a pad. Same oscillator, completely different instrument.
      </p>
    </Frame>
  )
}
