'use client'

// A compressor you can feel: squeeze the groove and watch the gain-reduction
// meter breathe on every hit. Threshold / ratio / attack / release are the real
// DynamicsCompressorNode params; the meter reads its live `.reduction`. Makeup
// gain lets you match loudness so the A/B is about dynamics, not volume.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, clamp, mixCtx, useLoopPlayer, rangeStyle, Frame, Transport, BypassButton, Control, SourcePicker } from './article/mix-kit'

const fmtMs = (s: number) => (s < 0.1 ? `${Math.round(s * 1000)} ms` : `${(s).toFixed(2)} s`)

export default function ArticleCompressor({ caption }: { caption?: string }) {
  const [threshold, setThreshold] = useState(-24)
  const [ratio, setRatio] = useState(4)
  const [attack, setAttack] = useState(0.006)
  const [release, setRelease] = useState(0.18)
  const [makeup, setMakeup] = useState(0)
  const [bypassed, setBypassed] = useState(false)
  const [redDb, setRedDb] = useState(0)

  const inputRef = useRef<AudioNode | null>(null)
  const compRef = useRef<DynamicsCompressorNode | null>(null)
  const makeupRef = useRef<GainNode | null>(null)
  const { ready, playing, play, stop, loadFile, useDemo, sourceName } = useLoopPlayer(inputRef, 'boombap')

  useEffect(() => {
    const c = mixCtx()
    const input = c.createGain()
    const comp = c.createDynamicsCompressor()
    comp.knee.value = 6
    const mk = c.createGain(); mk.gain.value = 1
    input.connect(comp); comp.connect(mk); mk.connect(c.destination)
    inputRef.current = input; compRef.current = comp; makeupRef.current = mk
    return () => { input.disconnect(); comp.disconnect(); mk.disconnect() }
  }, [])

  useEffect(() => {
    const input = inputRef.current, comp = compRef.current, mk = makeupRef.current
    if (!input || !comp || !mk) return
    try { input.disconnect() } catch { /* none */ }
    input.connect(bypassed ? mk : comp)
  }, [bypassed])

  useEffect(() => {
    const comp = compRef.current, mk = makeupRef.current, t = mixCtx().currentTime
    if (comp) {
      comp.threshold.setTargetAtTime(threshold, t, 0.01)
      comp.ratio.setTargetAtTime(ratio, t, 0.01)
      comp.attack.setTargetAtTime(attack, t, 0.01)
      comp.release.setTargetAtTime(release, t, 0.01)
    }
    if (mk) mk.gain.setTargetAtTime(Math.pow(10, makeup / 20), t, 0.01)
  }, [threshold, ratio, attack, release, makeup])

  // Animate the gain-reduction meter from the compressor's live reduction.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const comp = compRef.current
      if (comp) setRedDb(bypassed ? 0 : comp.reduction)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [bypassed])

  const METER_MAX = 24
  const redPct = clamp(-redDb / METER_MAX, 0, 1) * 100

  return (
    <Frame caption={caption}>
      <Transport
        ready={ready} playing={playing} onPlay={play} onStop={stop}
        onReset={() => { setThreshold(-24); setRatio(4); setAttack(0.006); setRelease(0.18); setMakeup(0); setBypassed(false) }}
        extra={<BypassButton bypassed={bypassed} setBypassed={setBypassed} disabled={!playing} />}
      />
      <SourcePicker sourceName={sourceName} onFile={loadFile} onDemo={useDemo} />

      {/* Gain-reduction meter */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4 }}>
          <span>GAIN REDUCTION</span>
          <span style={{ color: ACCENT, fontVariantNumeric: 'tabular-nums' }}>{redDb <= -0.1 ? `${redDb.toFixed(1)} dB` : '0.0 dB'}</span>
        </div>
        <div style={{ position: 'relative', height: 14, borderRadius: 7, background: 'var(--bg-base)', border: '1px solid var(--border)', overflow: 'hidden' }}>
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: `${redPct}%`, background: `linear-gradient(90deg, rgba(167,139,250,0.35), ${ACCENT})`, transition: 'width 60ms linear' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8.5, color: 'var(--text-muted)', marginTop: 2 }}>
          <span>0</span><span>−12</span><span>−{METER_MAX} dB</span>
        </div>
      </div>

      <Control label="Threshold" value={`${threshold.toFixed(0)} dB`}>
        <input type="range" min={-60} max={0} step={0.5} value={threshold} onChange={e => setThreshold(+e.target.value)} style={rangeStyle} aria-label="Threshold" />
      </Control>
      <Control label="Ratio" value={`${ratio.toFixed(1)} : 1`}>
        <input type="range" min={1} max={20} step={0.1} value={ratio} onChange={e => setRatio(+e.target.value)} style={rangeStyle} aria-label="Ratio" />
      </Control>
      <Control label="Attack" value={fmtMs(attack)}>
        <input type="range" min={0} max={0.2} step={0.001} value={attack} onChange={e => setAttack(+e.target.value)} style={rangeStyle} aria-label="Attack" />
      </Control>
      <Control label="Release" value={fmtMs(release)}>
        <input type="range" min={0.02} max={1} step={0.01} value={release} onChange={e => setRelease(+e.target.value)} style={rangeStyle} aria-label="Release" />
      </Control>
      <Control label="Makeup gain" value={`${makeup >= 0 ? '+' : ''}${makeup.toFixed(1)} dB`}>
        <input type="range" min={0} max={12} step={0.1} value={makeup} onChange={e => setMakeup(+e.target.value)} style={rangeStyle} aria-label="Makeup gain" />
      </Control>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        Drop the <strong style={{ color: 'var(--text-secondary)' }}>threshold</strong> until the meter moves on the loud hits, set how hard with <strong style={{ color: 'var(--text-secondary)' }}>ratio</strong>, then shape the feel: fast <strong style={{ color: 'var(--text-secondary)' }}>attack</strong> tames transients, slow lets them punch; <strong style={{ color: 'var(--text-secondary)' }}>release</strong> sets the pump. Add <strong style={{ color: 'var(--text-secondary)' }}>makeup</strong> to match level, then <strong style={{ color: 'var(--text-secondary)' }}>hold bypass</strong> — if it&rsquo;s only louder, you over-did it.
      </p>
    </Frame>
  )
}
