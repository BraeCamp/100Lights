'use client'

// The classic filter. Three detuned saws drone through a resonant low-pass; drag
// the cutoff to open and close it, push resonance to make it whistle at the edge,
// and let the LFO sweep it for a hands-free wah. A live spectrum shows the band
// of harmonics you're keeping.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, mixCtx, Frame, Transport, Control, rangeStyle } from './article/mix-kit'

export default function ArticleFilter({ caption }: { caption?: string }) {
  const [cutoff, setCutoff] = useState(1200)
  const [resonance, setResonance] = useState(6)
  const [lfoDepth, setLfoDepth] = useState(0)     // Hz of sweep
  const [lfoRate, setLfoRate] = useState(2)
  const [playing, setPlaying] = useState(false)

  const filterRef = useRef<BiquadFilterNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const lfoRef = useRef<OscillatorNode | null>(null)
  const lfoGainRef = useRef<GainNode | null>(null)
  const oscsRef = useRef<OscillatorNode[]>([])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Persistent filter → analyser → out, plus a free-running LFO on the cutoff.
  useEffect(() => {
    const c = mixCtx()
    const filter = c.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1200; filter.Q.value = 6
    const analyser = c.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.75
    const out = c.createGain(); out.gain.value = 0.5
    filter.connect(analyser); analyser.connect(out); out.connect(c.destination)
    const lfo = c.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 2
    const lfoGain = c.createGain(); lfoGain.gain.value = 0
    lfo.connect(lfoGain); lfoGain.connect(filter.frequency)
    try { lfo.start() } catch { /* started */ }
    filterRef.current = filter; analyserRef.current = analyser; lfoRef.current = lfo; lfoGainRef.current = lfoGain
    return () => { try { lfo.stop() } catch { /* stopped */ } ;[filter, analyser, out, lfo, lfoGain].forEach(n => n.disconnect()) }
  }, [])

  useEffect(() => {
    const f = filterRef.current, lg = lfoGainRef.current, lo = lfoRef.current, t = mixCtx().currentTime
    f?.frequency.setTargetAtTime(cutoff, t, 0.02)
    f?.Q.setTargetAtTime(resonance, t, 0.02)
    lg?.gain.setTargetAtTime(lfoDepth, t, 0.02)
    lo?.frequency.setTargetAtTime(lfoRate, t, 0.02)
  }, [cutoff, resonance, lfoDepth, lfoRate])

  function start() {
    const c = mixCtx(); void c.resume()
    const filter = filterRef.current; if (!filter) return
    oscsRef.current.forEach(o => { try { o.stop() } catch { /* none */ } })
    const detunes = [-7, 0, 7]
    oscsRef.current = detunes.map(cents => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 110; o.detune.value = cents
      const g = c.createGain(); g.gain.value = 0.22
      o.connect(g); g.connect(filter); o.start()
      return o
    })
    setPlaying(true)
  }
  function stop() {
    oscsRef.current.forEach(o => { try { o.stop() } catch { /* none */ } })
    oscsRef.current = []
    setPlaying(false)
  }
  useEffect(() => () => oscsRef.current.forEach(o => { try { o.stop() } catch { /* none */ } }), [])

  // Spectrum + cutoff marker.
  useEffect(() => {
    const cv = canvasRef.current; if (!cv) return
    let raf = 0
    const F_LO = 20, F_HI = 20000
    const xFor = (hz: number) => (Math.log(hz / F_LO) / Math.log(F_HI / F_LO))
    const draw = () => {
      const analyser = analyserRef.current
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth, h = cv.clientHeight
      if (!w || !h) { raf = requestAnimationFrame(draw); return }
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr }
      const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      if (analyser) {
        const bins = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(bins)
        const nyq = mixCtx().sampleRate / 2
        g.beginPath(); g.moveTo(0, h)
        for (let i = 1; i < bins.length; i++) {
          const hz = (i / bins.length) * nyq; if (hz < F_LO) continue
          g.lineTo(xFor(Math.min(F_HI, hz)) * w, h - (bins[i] / 255) * h * 0.94)
        }
        g.lineTo(w, h); g.closePath(); g.fillStyle = 'rgba(167,139,250,0.18)'; g.fill()
      }
      const cx = xFor(cutoff) * w
      g.strokeStyle = ACCENT; g.lineWidth = 1.5
      g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, h); g.stroke()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [cutoff])

  return (
    <Frame caption={caption}>
      <Transport ready playing={playing} onPlay={start} onStop={stop} playLabel="Play the drone"
        onReset={() => { setCutoff(1200); setResonance(6); setLfoDepth(0); setLfoRate(2) }} />

      <canvas ref={canvasRef} style={{ width: '100%', height: 110, display: 'block', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-base)', marginBottom: 14 }} aria-hidden="true" />

      <Control label="Cutoff" value={cutoff >= 1000 ? `${(cutoff / 1000).toFixed(2)} kHz` : `${Math.round(cutoff)} Hz`}>
        <input type="range" min={80} max={12000} step={10} value={cutoff} onChange={e => setCutoff(+e.target.value)} style={rangeStyle} aria-label="Cutoff" />
      </Control>
      <Control label="Resonance (Q)" value={resonance.toFixed(1)}>
        <input type="range" min={0.5} max={24} step={0.1} value={resonance} onChange={e => setResonance(+e.target.value)} style={rangeStyle} aria-label="Resonance" />
      </Control>
      <Control label="LFO depth (auto-wah)" value={lfoDepth < 1 ? 'off' : `±${Math.round(lfoDepth)} Hz`}>
        <input type="range" min={0} max={4000} step={20} value={lfoDepth} onChange={e => setLfoDepth(+e.target.value)} style={rangeStyle} aria-label="LFO depth" />
      </Control>
      <Control label="LFO rate" value={`${lfoRate.toFixed(2)} Hz`}>
        <input type="range" min={0.1} max={10} step={0.05} value={lfoRate} onChange={e => setLfoRate(+e.target.value)} style={rangeStyle} aria-label="LFO rate" />
      </Control>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        A low-pass keeps everything below the <strong style={{ color: 'var(--text-secondary)' }}>cutoff</strong> and throws away the harmonics above it — close it and the sound goes dark and muffled. <strong style={{ color: 'var(--text-secondary)' }}>Resonance</strong> boosts the frequencies right at the cutoff; push it and the filter starts to whistle. Turn up the <strong style={{ color: 'var(--text-secondary)' }}>LFO</strong> to sweep the cutoff on its own — that&rsquo;s a wah, a wobble, movement.
      </p>
    </Frame>
  )
}
