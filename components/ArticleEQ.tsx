'use client'

// An EQ playground for articles: shape a 4-band EQ over a synthesized groove and
// watch a live spectrum move under the response curve you're drawing. The curve
// is read from the filters' own getFrequencyResponse(), and the spectrum from an
// AnalyserNode on the output, so what you see is exactly what you hear.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, clamp, mixCtx, useLoopPlayer, rangeStyle, Frame, Transport, BypassButton, Control, SourcePicker } from './article/mix-kit'

type BandKind = 'lowshelf' | 'peaking' | 'highshelf'
const BANDS: Array<{ key: string; label: string; type: BandKind; freq: number; q: number }> = [
  { key: 'low',  label: 'Low',      type: 'lowshelf',  freq: 90,   q: 0.7 },
  { key: 'lmid', label: 'Low-mid',  type: 'peaking',   freq: 380,  q: 1.0 },
  { key: 'hmid', label: 'High-mid', type: 'peaking',   freq: 2600, q: 1.0 },
  { key: 'high', label: 'High',     type: 'highshelf', freq: 9000, q: 0.7 },
]
const fmtDb = (db: number) => `${db >= 0 ? '+' : ''}${db.toFixed(1)} dB`

export default function ArticleEQ({ caption }: { caption?: string }) {
  const [gains, setGains] = useState<number[]>(() => BANDS.map(() => 0))
  const [bypassed, setBypassed] = useState(false)

  const inputRef = useRef<AudioNode | null>(null)
  const filtersRef = useRef<BiquadFilterNode[]>([])
  const analyserRef = useRef<AnalyserNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { ready, playing, play, stop, loadFile, useDemo, sourceName } = useLoopPlayer(inputRef)

  // Persistent chain: in → band×4 → analyser → out. Built once so the curve is
  // live before the first play (a suspended context still answers getFreqResp).
  useEffect(() => {
    const c = mixCtx()
    const input = c.createGain()
    const filters = BANDS.map(b => {
      const f = c.createBiquadFilter()
      f.type = b.type; f.frequency.value = b.freq; f.Q.value = b.q; f.gain.value = 0
      return f
    })
    const analyser = c.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.8
    input.connect(filters[0])
    for (let i = 0; i < filters.length - 1; i++) filters[i].connect(filters[i + 1])
    filters[filters.length - 1].connect(analyser)
    analyser.connect(c.destination)
    inputRef.current = input
    filtersRef.current = filters
    analyserRef.current = analyser
    return () => { input.disconnect(); filters.forEach(f => f.disconnect()); analyser.disconnect() }
  }, [])

  // Bypass reroutes the input straight to the analyser, skipping the bands.
  useEffect(() => {
    const input = inputRef.current, filters = filtersRef.current, analyser = analyserRef.current
    if (!input || !filters.length || !analyser) return
    try { input.disconnect() } catch { /* none */ }
    input.connect(bypassed ? analyser : filters[0])
  }, [bypassed])

  // Push gains onto the live filters.
  useEffect(() => {
    const filters = filtersRef.current
    const t = mixCtx().currentTime
    gains.forEach((g, i) => filters[i]?.gain.setTargetAtTime(g, t, 0.02))
  }, [gains])

  // Draw spectrum + response curve. Animates while playing; single paint otherwise.
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    let raf = 0
    const draw = () => {
      const analyser = analyserRef.current, filters = filtersRef.current
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth, h = cv.clientHeight
      if (!w || !h) { raf = requestAnimationFrame(draw); return }
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr }
      const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)

      const F_LO = 20, F_HI = 20000
      const xFor = (hz: number) => (Math.log(hz / F_LO) / Math.log(F_HI / F_LO)) * w

      // Live spectrum (filled), mapped to log frequency.
      if (analyser && !bypassed) {
        const bins = new Uint8Array(analyser.frequencyBinCount)
        analyser.getByteFrequencyData(bins)
        const nyq = mixCtx().sampleRate / 2
        g.beginPath(); g.moveTo(0, h)
        for (let i = 1; i < bins.length; i++) {
          const hz = (i / bins.length) * nyq
          if (hz < F_LO) continue
          const x = xFor(Math.min(F_HI, hz))
          const y = h - (bins[i] / 255) * h * 0.92
          g.lineTo(x, y)
        }
        g.lineTo(w, h); g.closePath()
        g.fillStyle = 'rgba(167,139,250,0.16)'; g.fill()
      }

      // 0 dB line + response curve from the filters themselves.
      const DB_TOP = 16, DB_BOT = -16
      const yFor = (db: number) => (DB_TOP - clamp(db, DB_BOT, DB_TOP)) / (DB_TOP - DB_BOT) * h
      g.strokeStyle = 'rgba(148,148,168,0.28)'; g.lineWidth = 1
      g.beginPath(); g.moveTo(0, yFor(0)); g.lineTo(w, yFor(0)); g.stroke()

      const N = 200
      const freqs = new Float32Array(N)
      for (let i = 0; i < N; i++) freqs[i] = F_LO * Math.pow(F_HI / F_LO, i / (N - 1))
      const mag = new Float32Array(N).fill(1)
      const m = new Float32Array(N), ph = new Float32Array(N)
      if (!bypassed) for (const f of filters) { f.getFrequencyResponse(freqs, m, ph); for (let i = 0; i < N; i++) mag[i] *= m[i] }
      g.strokeStyle = ACCENT; g.lineWidth = 2; g.beginPath()
      for (let i = 0; i < N; i++) {
        const db = 20 * Math.log10(Math.max(1e-4, mag[i]))
        const x = (i / (N - 1)) * w, y = yFor(db)
        i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)
      }
      g.stroke()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [bypassed])

  const setGain = (i: number, v: number) => setGains(gs => gs.map((g, j) => j === i ? v : g))

  return (
    <Frame caption={caption}>
      <Transport
        ready={ready} playing={playing} onPlay={play} onStop={stop}
        onReset={() => { setGains(BANDS.map(() => 0)); setBypassed(false) }}
        extra={<BypassButton bypassed={bypassed} setBypassed={setBypassed} disabled={!playing} label="Hold: flat" />}
      />
      <SourcePicker sourceName={sourceName} onFile={loadFile} onDemo={useDemo} />

      <canvas ref={canvasRef} style={{ width: '100%', height: 120, display: 'block', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-base)' }} aria-hidden="true" />
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', margin: '3px 2px 14px', fontWeight: 600 }}>
        <span>20 Hz</span><span>200</span><span>2 kHz</span><span>20 kHz</span>
      </div>

      {BANDS.map((b, i) => (
        <Control key={b.key} label={b.label} value={fmtDb(gains[i])}>
          <input type="range" min={-15} max={15} step={0.1} value={gains[i]} onChange={e => setGain(i, +e.target.value)} style={rangeStyle} aria-label={`${b.label} gain`} />
        </Control>
      ))}

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        Boost a band to hear what lives there, then decide whether the mix wants more or less of it. <strong style={{ color: 'var(--text-secondary)' }}>Low</strong> is weight, <strong style={{ color: 'var(--text-secondary)' }}>low-mid</strong> is mud or warmth, <strong style={{ color: 'var(--text-secondary)' }}>high-mid</strong> is presence, <strong style={{ color: 'var(--text-secondary)' }}>high</strong> is air. <strong style={{ color: 'var(--text-secondary)' }}>Hold &ldquo;flat&rdquo;</strong> to compare against no EQ.
      </p>
    </Frame>
  )
}
