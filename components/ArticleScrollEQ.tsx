'use client'

// A scroll-driven EQ tour. The spectrum + response curve stay pinned at the top
// while captioned "scenes" scroll past; as each reaches the middle of the screen
// the EQ moves to that band and — if the loop is playing — you hear it change.
// Reading the article IS operating the EQ.

import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { ACCENT, clamp, mixCtx, useLoopPlayer } from './article/mix-kit'

const BANDS: Array<{ type: BiquadFilterType; freq: number; q: number }> = [
  { type: 'lowshelf', freq: 90, q: 0.7 },
  { type: 'peaking', freq: 380, q: 1 },
  { type: 'peaking', freq: 2600, q: 1 },
  { type: 'highshelf', freq: 9000, q: 0.7 },
]
const SCENES: Array<{ title: string; gains: number[]; text: string }> = [
  { title: 'Flat', gains: [0, 0, 0, 0], text: 'Press play. This is the loop with every band flat — no EQ at all. Keep it running and scroll.' },
  { title: 'Lows — weight', gains: [10, 0, 0, 0], text: 'Boost the low shelf. The kick and bass get their weight and the whole thing sits down lower — powerful, but push it far and it turns woolly.' },
  { title: 'Low-mids — mud', gains: [0, 11, 0, 0], text: 'Now shove the low-mids up. Hear it go boxy and congested? This is where mud lives. On a real mix you almost always cut here, not boost.' },
  { title: 'High-mids — presence', gains: [0, 0, 9, 0], text: 'Lift the high-mids and everything jumps forward — more present, more aggressive, more “in your face.” Too much and it gets harsh and fatiguing.' },
  { title: 'Highs — air', gains: [0, 0, 0, 10], text: 'Open the high shelf for sparkle and air up top. A little makes things sound expensive; a lot brings up hiss and sizzle.' },
  { title: 'All together', gains: [4, -4, 3, 4], text: 'A gentle version of all four at once — lows up, low-mids cut, a touch of presence and air. That shape, smaller than you’d expect, is most of what mixing an EQ is.' },
]

export default function ArticleScrollEQ({ caption }: { caption?: string }) {
  const [scene, setScene] = useState(0)
  const inputRef = useRef<AudioNode | null>(null)
  const filtersRef = useRef<BiquadFilterNode[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneRefs = useRef<(HTMLDivElement | null)[]>([])
  const { ready, playing, play, stop } = useLoopPlayer(inputRef, 'techno')

  // Persistent chain: in → band×4 → analyser → out.
  useEffect(() => {
    const c = mixCtx()
    const input = c.createGain()
    const filters = BANDS.map(b => { const f = c.createBiquadFilter(); f.type = b.type; f.frequency.value = b.freq; f.Q.value = b.q; f.gain.value = 0; return f })
    const analyser = c.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8
    input.connect(filters[0])
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1])
    filters[filters.length - 1].connect(analyser); analyser.connect(c.destination)
    inputRef.current = input; filtersRef.current = filters; analyserRef.current = analyser
    return () => { input.disconnect(); filters.forEach(f => f.disconnect()); analyser.disconnect() }
  }, [])

  // Drive the band gains from the active scene (smoothed).
  useEffect(() => {
    const filters = filtersRef.current, t = mixCtx().currentTime
    SCENES[scene].gains.forEach((g, i) => filters[i]?.gain.setTargetAtTime(g, t, 0.08))
  }, [scene])

  // Which scene is nearest the middle of the screen.
  useEffect(() => {
    const io = new IntersectionObserver(
      entries => {
        for (const e of entries) if (e.isIntersecting) {
          const idx = sceneRefs.current.indexOf(e.target as HTMLDivElement)
          if (idx >= 0) setScene(idx)
        }
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: 0 },
    )
    sceneRefs.current.forEach(el => el && io.observe(el))
    return () => io.disconnect()
  }, [])

  // Spectrum + response curve (same as the EQ widget).
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return
    let raf = 0
    const F_LO = 20, F_HI = 20000
    const draw = () => {
      const analyser = analyserRef.current, filters = filtersRef.current
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth, h = cv.clientHeight
      if (!w || !h) { raf = requestAnimationFrame(draw); return }
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr }
      const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h)
      const xFor = (hz: number) => (Math.log(hz / F_LO) / Math.log(F_HI / F_LO)) * w
      if (analyser && playing) {
        const bins = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(bins)
        const nyq = mixCtx().sampleRate / 2
        g.beginPath(); g.moveTo(0, h)
        for (let i = 1; i < bins.length; i++) { const hz = (i / bins.length) * nyq; if (hz < F_LO) continue; g.lineTo(xFor(Math.min(F_HI, hz)), h - (bins[i] / 255) * h * 0.92) }
        g.lineTo(w, h); g.closePath(); g.fillStyle = 'rgba(167,139,250,0.16)'; g.fill()
      }
      const DB_TOP = 16, DB_BOT = -16
      const yFor = (db: number) => (DB_TOP - clamp(db, DB_BOT, DB_TOP)) / (DB_TOP - DB_BOT) * h
      g.strokeStyle = 'rgba(148,148,168,0.28)'; g.lineWidth = 1; g.beginPath(); g.moveTo(0, yFor(0)); g.lineTo(w, yFor(0)); g.stroke()
      const N = 200, freqs = new Float32Array(N)
      for (let i = 0; i < N; i++) freqs[i] = F_LO * Math.pow(F_HI / F_LO, i / (N - 1))
      const mag = new Float32Array(N).fill(1), m = new Float32Array(N), ph = new Float32Array(N)
      for (const f of filters) { f.getFrequencyResponse(freqs, m, ph); for (let i = 0; i < N; i++) mag[i] *= m[i] }
      g.strokeStyle = ACCENT; g.lineWidth = 2; g.beginPath()
      for (let i = 0; i < N; i++) { const db = 20 * Math.log10(Math.max(1e-4, mag[i])); const x = (i / (N - 1)) * w, y = yFor(db); i === 0 ? g.moveTo(x, y) : g.lineTo(x, y) }
      g.stroke()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  return (
    <figure style={{ margin: '24px 0' }}>
      <div style={{ position: 'relative', border: `1px solid ${ACCENT}55`, borderRadius: 14, background: 'rgba(167,139,250,0.05)', padding: '0 16px' }}>
        {/* Pinned visual + transport */}
        <div style={{ position: 'sticky', top: 8, zIndex: 2, paddingTop: 16, background: 'linear-gradient(180deg, var(--bg-base) 78%, transparent)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <button onClick={() => (playing ? stop() : play())} disabled={!ready} style={{
              display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: 'none',
              cursor: ready ? 'pointer' : 'default', opacity: ready ? 1 : 0.5,
              background: playing ? ACCENT : 'rgba(167,139,250,0.2)', color: playing ? '#fff' : ACCENT,
            }}>{playing ? <Square size={13} fill="currentColor" /> : <Play size={14} />}{playing ? 'Stop' : ready ? 'Play & scroll' : 'Loading…'}</button>
            <span style={{ fontSize: 12, fontWeight: 800, color: ACCENT, letterSpacing: '0.02em' }}>{SCENES[scene].title}</span>
          </div>
          <canvas ref={canvasRef} style={{ width: '100%', height: 120, display: 'block', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-base)' }} aria-hidden="true" />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', margin: '3px 2px 0', fontWeight: 600 }}>
            <span>20 Hz</span><span>200</span><span>2 kHz</span><span>20 kHz</span>
          </div>
        </div>

        {/* Scroll scenes */}
        {SCENES.map((sc, i) => (
          <div key={i} ref={el => { sceneRefs.current[i] = el }} style={{ minHeight: '58vh', display: 'flex', alignItems: 'center', padding: '8px 0' }}>
            <p style={{ fontSize: 14.5, lineHeight: 1.7, color: scene === i ? 'var(--text-primary)' : 'var(--text-muted)', transition: 'color 200ms', margin: 0 }}>
              <strong style={{ color: ACCENT, display: 'block', fontSize: 11, letterSpacing: '0.06em', marginBottom: 6, textTransform: 'uppercase' }}>{sc.title}</strong>
              {sc.text}
            </p>
          </div>
        ))}
      </div>
      {caption && <figcaption style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.6 }}>{caption}</figcaption>}
    </figure>
  )
}
