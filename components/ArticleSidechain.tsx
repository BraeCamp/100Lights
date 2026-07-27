'use client'

// The pump. A sustained pad holds a chord while a four-on-the-floor kick ducks it
// on every beat — the sidechain move behind most dance music. Drag the amount and
// release and watch the level bar breathe; hold bypass to hear the pad unducked.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, clamp, mixCtx, Frame, Transport, BypassButton, Control, rangeStyle } from './article/mix-kit'
import { useSharedTempo, useSharedRoot } from './article/article-state'
import { dkick } from './article/beat-voices'

const CHORD = [110.0, 130.81, 164.81, 220.0]   // Am-ish pad (transposed by the shared key)

export default function ArticleSidechain({ caption }: { caption?: string }) {
  const BPM = useSharedTempo(124)
  const rootOff = useSharedRoot(0)
  const [amount, setAmount] = useState(0.8)
  const [release, setRelease] = useState(0.22)
  const [bypassed, setBypassed] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [level, setLevel] = useState(0)

  const padGainRef = useRef<GainNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const outRef = useRef<GainNode | null>(null)
  const oscsRef = useRef<OscillatorNode[]>([])
  const timerRef = useRef<number | null>(null)
  const p = useRef({ amount, release, bypassed }); p.current = { amount, release, bypassed }

  // Persistent output + pad gain (ducked) + analyser for the meter.
  useEffect(() => {
    const c = mixCtx()
    const out = c.createGain(); out.gain.value = 0.9; out.connect(c.destination)
    const padGain = c.createGain(); padGain.gain.value = 1
    const analyser = c.createAnalyser(); analyser.fftSize = 512
    padGain.connect(analyser); analyser.connect(out)
    padGainRef.current = padGain; analyserRef.current = analyser; outRef.current = out
    return () => { [out, padGain, analyser].forEach(n => n.disconnect()) }
  }, [])

  function start() {
    const c = mixCtx(); void c.resume()
    const padGain = padGainRef.current, out = outRef.current
    if (!padGain || !out) return
    // Start the pad chord.
    oscsRef.current.forEach(o => { try { o.stop() } catch { /* none */ } })
    const semi = Math.pow(2, rootOff / 12)
    oscsRef.current = CHORD.flatMap(hz => {
      return [0, 7].map(det => {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz * semi; o.detune.value = det
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2200
        const g = c.createGain(); g.gain.value = 0.09
        o.connect(f); f.connect(g); g.connect(padGain); o.start()
        return o
      })
    })
    // Kick + duck scheduler (four on the floor).
    const beat = 60 / BPM
    let step = 0
    let next = c.currentTime + 0.15
    setPlaying(true)
    timerRef.current = window.setInterval(() => {
      const now = c.currentTime
      while (next < now + 0.14) {
        dkick(c, next, out, 1)
        if (!p.current.bypassed) {
          const g = padGain.gain
          g.cancelScheduledValues(next)
          g.setValueAtTime(clamp(1 - p.current.amount, 0.0001, 1), next)
          g.linearRampToValueAtTime(1, next + p.current.release)
        }
        void step; step++
        next += beat
      }
    }, 25)
  }
  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    oscsRef.current.forEach(o => { try { o.stop() } catch { /* none */ } })
    oscsRef.current = []
    const g = padGainRef.current?.gain; if (g) { g.cancelScheduledValues(mixCtx().currentTime); g.setValueAtTime(1, mixCtx().currentTime) }
    setPlaying(false)
  }
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); oscsRef.current.forEach(o => { try { o.stop() } catch { /* none */ } }) }, [])

  // When bypass is held, hold the pad open.
  useEffect(() => {
    const g = padGainRef.current?.gain
    if (bypassed && g) { g.cancelScheduledValues(mixCtx().currentTime); g.setTargetAtTime(1, mixCtx().currentTime, 0.02) }
  }, [bypassed])

  // Level meter from the analyser RMS.
  useEffect(() => {
    let raf = 0
    const buf = new Uint8Array(256)
    const tick = () => {
      const a = analyserRef.current
      if (a) { a.getByteTimeDomainData(buf); let s = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; s += v * v } setLevel(Math.sqrt(s / buf.length)) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <Frame caption={caption}>
      <Transport ready playing={playing} onPlay={start} onStop={stop} playLabel="Play the pump"
        onReset={() => { setAmount(0.8); setRelease(0.22); setBypassed(false) }}
        extra={<BypassButton bypassed={bypassed} setBypassed={setBypassed} disabled={!playing} label="Hold: no duck" />} />

      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>PAD LEVEL</div>
        <div style={{ height: 16, borderRadius: 8, background: 'var(--bg-base)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${clamp(level * 180, 0, 100)}%`, background: `linear-gradient(90deg, rgba(167,139,250,0.4), ${ACCENT})`, transition: 'width 40ms linear' }} />
        </div>
      </div>

      <Control label="Duck amount" value={`${Math.round(amount * 100)}%`}>
        <input type="range" min={0} max={1} step={0.01} value={amount} onChange={e => setAmount(+e.target.value)} style={rangeStyle} aria-label="Duck amount" />
      </Control>
      <Control label="Release" value={`${Math.round(release * 1000)} ms`}>
        <input type="range" min={0.05} max={0.5} step={0.01} value={release} onChange={e => setRelease(+e.target.value)} style={rangeStyle} aria-label="Release" />
      </Control>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        Every kick slams the pad down by the <strong style={{ color: 'var(--text-secondary)' }}>duck amount</strong>, then the <strong style={{ color: 'var(--text-secondary)' }}>release</strong> decides how fast it swells back — short is a tight tick, long is a slow breath in time with the beat. It clears room for the kick and, at higher amounts, becomes the rhythm itself. Hold <strong style={{ color: 'var(--text-secondary)' }}>no duck</strong> to hear the pad fighting the kick for the same space.
      </p>
    </Frame>
  )
}
