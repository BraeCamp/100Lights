'use client'

// Feel the grid loosen. A straight 16th-note beat plays; the swing slider pushes
// every off-beat 16th later, from dead-straight (50%) to a heavy shuffle (~70%).
// The dots below show exactly where each hit lands, so you see the swing as well
// as hear it.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, mixCtx, Frame, Transport, Control, rangeStyle } from './article/mix-kit'
import { useSharedTempo } from './article/article-state'
import { dkick, dsnare, dhat } from './article/beat-voices'

const KICK = new Set([0, 4, 8, 12])
const SNARE = new Set([4, 12])

export default function ArticleSwing({ caption }: { caption?: string }) {
  const BPM = useSharedTempo(96)
  const [swing, setSwing] = useState(0.5)   // 0.5 = straight
  const [playing, setPlaying] = useState(false)
  const [cur, setCur] = useState(-1)

  const outRef = useRef<GainNode | null>(null)
  const timerRef = useRef<number | null>(null)
  const swingRef = useRef(swing); swingRef.current = swing

  useEffect(() => {
    const c = mixCtx()
    const out = c.createGain(); out.gain.value = 0.9; out.connect(c.destination)
    outRef.current = out
    return () => { out.disconnect() }
  }, [])

  const eighthDur = 60 / BPM / 2
  const barDur = (60 / BPM) * 4
  const stepTime = (step: number, s: number) => Math.floor(step / 2) * eighthDur + (step % 2 ? s * eighthDur : 0)

  function start() {
    const c = mixCtx(); void c.resume()
    const out = outRef.current; if (!out) return
    let step = 0
    let barStart = c.currentTime + 0.12
    let next = barStart + stepTime(0, swingRef.current)
    setPlaying(true)
    timerRef.current = window.setInterval(() => {
      const now = c.currentTime
      while (next < now + 0.14) {
        const t = next, s = step
        dhat(c, t, out, 0.28)
        if (KICK.has(s)) dkick(c, t, out)
        if (SNARE.has(s)) dsnare(c, t, out)
        window.setTimeout(() => setCur(s), Math.max(0, (t - c.currentTime + (c.outputLatency || 0)) * 1000))
        step++
        if (step >= 16) { step = 0; barStart += barDur }
        next = barStart + stepTime(step, swingRef.current)
      }
    }, 25)
  }
  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setPlaying(false); setCur(-1)
  }
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const swingPct = Math.round(swing * 100)

  return (
    <Frame caption={caption}>
      <Transport ready playing={playing} onPlay={start} onStop={stop} playLabel="Play the beat"
        onReset={() => setSwing(0.5)} />

      {/* Timing dots — off-beats slide right with swing */}
      <div style={{ position: 'relative', height: 30, margin: '2px 2px 14px', borderRadius: 6, background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
        {Array.from({ length: 16 }, (_, i) => {
          const frac = (Math.floor(i / 2) + (i % 2 ? swing : 0)) / 8
          const beat = i % 4 === 0
          return (
            <div key={i} style={{
              position: 'absolute', top: '50%', left: `calc(${frac * 100}% )`, transform: 'translate(-50%,-50%)',
              width: cur === i ? 12 : beat ? 9 : 6, height: cur === i ? 12 : beat ? 9 : 6, borderRadius: '50%',
              background: cur === i ? '#fff' : i % 2 ? ACCENT : 'rgba(167,139,250,0.55)',
              transition: 'left 90ms, width 90ms, height 90ms, background 90ms',
            }} />
          )
        })}
      </div>

      <Control label="Swing" value={swing < 0.505 ? 'Straight' : `${swingPct}%`}>
        <input type="range" min={0.5} max={0.72} step={0.005} value={swing} onChange={e => setSwing(+e.target.value)} style={rangeStyle} aria-label="Swing amount" />
      </Control>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        Straight 16ths are evenly spaced — every dot the same distance apart. Add <strong style={{ color: 'var(--text-secondary)' }}>swing</strong> and the off-beats (the small purple dots) slide later, so each pair becomes long-short, long-short. That lopsided bounce is the difference between a beat that marches and one that grooves. Most swung music lives around 54–62%.
      </p>
    </Frame>
  )
}
