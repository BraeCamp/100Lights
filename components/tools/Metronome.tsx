'use client'

/**
 * Standalone metronome.
 *
 * The DAW's metronome is welded to the engine (it reads the transport clock,
 * the master bus, the project time signature), so this reimplements the same
 * ~40-line look-ahead scheduler independently: build two short sine-ping
 * buffers, then schedule them a beat ahead on the audio clock. A setInterval
 * that played clicks directly would audibly drift; scheduling against
 * AudioContext.currentTime does not.
 */

import { useEffect, useRef, useState } from 'react'


const LOOKAHEAD_S = 0.15
const TICK_MS = 25
const MIN_BPM = 30
const MAX_BPM = 300

export default function Metronome() {
  const [bpm, setBpm] = useState(120)
  const [beatsPerBar, setBeatsPerBar] = useState(4)
  const [playing, setPlaying] = useState(false)
  const [beat, setBeat] = useState(-1)

  const ctxRef = useRef<AudioContext | null>(null)
  const tickBuf = useRef<AudioBuffer | null>(null)
  const tockBuf = useRef<AudioBuffer | null>(null)
  const timer = useRef<number | null>(null)
  const nextTime = useRef(0)
  const nextBeat = useRef(0)
  // Live values the scheduler reads without re-arming on every change.
  const bpmRef = useRef(bpm)
  const bpbRef = useRef(beatsPerBar)
  useEffect(() => { bpmRef.current = bpm }, [bpm])
  useEffect(() => { bpbRef.current = beatsPerBar }, [beatsPerBar])
  const tapTimes = useRef<number[]>([])

  function ctx(): AudioContext {
    if (!ctxRef.current) {
      const c = new AudioContext()
      ctxRef.current = c
      const sr = c.sampleRate
      const len = Math.floor(sr * 0.04)
      const build = (freq: number, gain: number) => {
        const b = c.createBuffer(1, len, sr)
        const d = b.getChannelData(0)
        for (let i = 0; i < len; i++) d[i] = Math.sin(2 * Math.PI * freq * i / sr) * Math.exp(-i / (sr * 0.015)) * gain
        return b
      }
      tickBuf.current = build(1800, 1)   // downbeat
      tockBuf.current = build(900, 0.5)  // offbeat
    }
    return ctxRef.current
  }

  function schedule() {
    const c = ctxRef.current
    if (!c) return
    const secPerBeat = 60 / bpmRef.current
    while (nextTime.current < c.currentTime + LOOKAHEAD_S) {
      const isDown = nextBeat.current % bpbRef.current === 0
      const buf = isDown ? tickBuf.current : tockBuf.current
      if (buf) {
        const src = c.createBufferSource()
        src.buffer = buf
        const g = c.createGain()
        g.gain.value = 0.6
        src.connect(g); g.connect(c.destination)
        src.start(nextTime.current)
        src.onended = () => { src.disconnect(); g.disconnect() }
      }
      const drawBeat = nextBeat.current % bpbRef.current
      const at = nextTime.current
      window.setTimeout(() => setBeat(drawBeat), Math.max(0, (at - c.currentTime) * 1000))
      nextTime.current += secPerBeat
      nextBeat.current++
    }
  }

  function start() {
    const c = ctx()
    void c.resume()
    nextBeat.current = 0
    nextTime.current = c.currentTime + 0.06
    setPlaying(true)
    timer.current = window.setInterval(schedule, TICK_MS)
  }

  function stop() {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    setPlaying(false)
    setBeat(-1)
  }

  function tap() {
    const now = performance.now()
    const times = tapTimes.current.filter(t => now - t < 2000)
    times.push(now)
    tapTimes.current = times
    if (times.length >= 2) {
      const gaps = times.slice(1).map((t, i) => t - times[i])
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length
      const next = Math.round(60000 / avg)
      setBpm(Math.max(MIN_BPM, Math.min(MAX_BPM, next)))
    }
  }

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current)
    void ctxRef.current?.close()
  }, [])

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: '22px 20px', background: 'var(--bg-card)', maxWidth: 400, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 18 }}>
        <div style={{ fontSize: 58, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.03em', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{bpm}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>BPM</div>
      </div>

      {/* Beat dots */}
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: 18 }}>
        {Array.from({ length: beatsPerBar }, (_, i) => (
          <div key={i} style={{
            width: 14, height: 14, borderRadius: 7,
            background: beat === i ? (i === 0 ? 'var(--accent-light)' : '#34d399') : 'var(--border)',
            transform: beat === i ? 'scale(1.25)' : 'scale(1)',
            transition: 'transform 60ms, background 60ms',
          }} />
        ))}
      </div>

      <input type="range" min={MIN_BPM} max={MAX_BPM} value={bpm} onChange={e => setBpm(Number(e.target.value))}
        className="cf-slider" style={{ width: '100%', marginBottom: 16 }} aria-label="Tempo" />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <button onClick={() => setBpm(b => Math.max(MIN_BPM, b - 1))} style={stepBtn}>−</button>
        <button onClick={() => playing ? stop() : start()} style={{
          padding: '10px 28px', borderRadius: 10, border: 'none', fontSize: 15, fontWeight: 700, cursor: 'pointer',
          background: playing ? '#dc2626' : 'var(--accent)', color: '#fff',
        }}>{playing ? '■ Stop' : '▶ Start'}</button>
        <button onClick={() => setBpm(b => Math.min(MAX_BPM, b + 1))} style={stepBtn}>+</button>
        <button onClick={tap} style={{ ...stepBtn, width: 'auto', padding: '0 16px', fontSize: 12, fontWeight: 700 }}>TAP</button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)' }}>
        <span>Beats per bar</span>
        {[2, 3, 4, 6].map(n => (
          <button key={n} onClick={() => setBeatsPerBar(n)} style={{
            width: 30, height: 30, borderRadius: 7, cursor: 'pointer', fontWeight: 700, fontSize: 13,
            border: `1px solid ${beatsPerBar === n ? 'var(--accent)' : 'var(--border)'}`,
            background: beatsPerBar === n ? 'rgba(124,58,237,0.15)' : 'transparent',
            color: beatsPerBar === n ? 'var(--accent-light)' : 'var(--text-muted)',
          }}>{n}</button>
        ))}
      </div>
    </div>
  )
}

const stepBtn: React.CSSProperties = {
  width: 40, height: 40, borderRadius: 10, cursor: 'pointer', fontSize: 20, fontWeight: 700,
  border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
