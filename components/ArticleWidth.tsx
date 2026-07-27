'use client'

// Stereo width + pan, shown on a vectorscope. The loop is split to mid/side; the
// side signal is scaled (0 = mono, 1 = as-recorded, 2 = extra wide) and recombined,
// then panned. The goniometer plots L against R so the reader sees the image go
// from a vertical line (mono) to a spread cloud (wide) as they drag.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, mixCtx, useLoopPlayer, rangeStyle, Frame, Transport, BypassButton, Control, SourcePicker } from './article/mix-kit'

const panLabel = (p: number) => (Math.abs(p) < 0.03 ? 'Centre' : `${Math.round(Math.abs(p) * 100)}% ${p < 0 ? 'L' : 'R'}`)

export default function ArticleWidth({ caption }: { caption?: string }) {
  const [width, setWidth] = useState(1)
  const [pan, setPan] = useState(0)
  const [bypassed, setBypassed] = useState(false)

  const inputRef = useRef<AudioNode | null>(null)
  const sideRef = useRef<GainNode | null>(null)      // side * width
  const panRef = useRef<StereoPannerNode | null>(null)
  const analyserLRef = useRef<AnalyserNode | null>(null)
  const analyserRRef = useRef<AnalyserNode | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { ready, playing, play, stop, loadFile, useDemo, sourceName } = useLoopPlayer(inputRef, 'disco')

  useEffect(() => {
    const c = mixCtx()
    const gain = (v: number) => { const g = c.createGain(); g.gain.value = v; return g }
    const input = c.createGain()

    // Mid/side matrix.
    const split = c.createChannelSplitter(2)
    input.connect(split)
    const mid = c.createGain()
    const mL = gain(0.5), mR = gain(0.5)
    split.connect(mL, 0); split.connect(mR, 1); mL.connect(mid); mR.connect(mid)
    const side = c.createGain()
    const sL = gain(0.5), sR = gain(-0.5)
    split.connect(sL, 0); split.connect(sR, 1); sL.connect(side); sR.connect(side)
    const sideW = gain(1)                       // side × width
    side.connect(sideW)
    const sideNeg = gain(-1); sideW.connect(sideNeg)

    // outL = mid + side×w ; outR = mid − side×w
    const outL = c.createGain(), outR = c.createGain()
    mid.connect(outL); sideW.connect(outL)
    mid.connect(outR); sideNeg.connect(outR)
    const merge = c.createChannelMerger(2)
    outL.connect(merge, 0, 0); outR.connect(merge, 0, 1)

    const panner = c.createStereoPanner()
    merge.connect(panner)

    // Vectorscope taps the panned output per channel.
    const scopeSplit = c.createChannelSplitter(2)
    panner.connect(scopeSplit)
    const aL = c.createAnalyser(); aL.fftSize = 1024
    const aR = c.createAnalyser(); aR.fftSize = 1024
    scopeSplit.connect(aL, 0); scopeSplit.connect(aR, 1)

    panner.connect(c.destination)

    inputRef.current = input; sideRef.current = sideW; panRef.current = panner
    analyserLRef.current = aL; analyserRRef.current = aR
    return () => { [input, split, mid, mL, mR, side, sL, sR, sideW, sideNeg, outL, outR, merge, panner, scopeSplit, aL, aR].forEach(n => n.disconnect()) }
  }, [])

  useEffect(() => {
    const t = mixCtx().currentTime
    sideRef.current?.gain.setTargetAtTime(bypassed ? 1 : width, t, 0.02)
    panRef.current?.pan.setTargetAtTime(bypassed ? 0 : pan, t, 0.02)
  }, [width, pan, bypassed])

  // Goniometer: plot L vs R rotated 45° (mono → vertical, wide → horizontal spread).
  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    let raf = 0
    const bufL = new Float32Array(1024), bufR = new Float32Array(1024)
    const draw = () => {
      const aL = analyserLRef.current, aR = analyserRRef.current
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = cv.clientWidth, h = cv.clientHeight
      if (!w || !h) { raf = requestAnimationFrame(draw); return }
      if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr }
      const g = cv.getContext('2d')!; g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      // Guides: vertical (mono) + the L/R diagonals.
      g.strokeStyle = 'rgba(148,148,168,0.22)'; g.lineWidth = 1
      g.beginPath(); g.moveTo(w / 2, 4); g.lineTo(w / 2, h - 4); g.stroke()
      g.strokeStyle = 'rgba(148,148,168,0.12)'
      g.beginPath(); g.moveTo(6, h - 6); g.lineTo(w - 6, 6); g.moveTo(6, 6); g.lineTo(w - 6, h - 6); g.stroke()

      if (aL && aR) {
        aL.getFloatTimeDomainData(bufL); aR.getFloatTimeDomainData(bufR)
        const cx = w / 2, cy = h / 2, scale = Math.min(w, h) * 0.46
        g.fillStyle = 'rgba(167,139,250,0.7)'
        for (let i = 0; i < bufL.length; i += 2) {
          const L = bufL[i], R = bufR[i]
          const x = cx + ((L - R) / Math.SQRT2) * scale
          const y = cy - ((L + R) / Math.SQRT2) * scale
          g.fillRect(x, y, 1.3, 1.3)
        }
      }
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  return (
    <Frame caption={caption}>
      <Transport
        ready={ready} playing={playing} onPlay={play} onStop={stop}
        onReset={() => { setWidth(1); setPan(0); setBypassed(false) }}
        extra={<BypassButton bypassed={bypassed} setBypassed={setBypassed} disabled={!playing} label="Hold: as-is" />}
      />
      <SourcePicker sourceName={sourceName} onFile={loadFile} onDemo={useDemo} />

      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
        <canvas ref={canvasRef} style={{ width: 150, height: 150, display: 'block', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-base)' }} aria-hidden="true" />
      </div>
      <div style={{ textAlign: 'center', fontSize: 9, color: 'var(--text-muted)', marginBottom: 14, fontWeight: 600 }}>
        vertical line = mono · sideways spread = wide
      </div>

      <Control label="Width" value={width < 0.02 ? 'Mono' : `${Math.round(width * 100)}%`}>
        <input type="range" min={0} max={2} step={0.01} value={width} onChange={e => setWidth(+e.target.value)} style={rangeStyle} aria-label="Width" />
      </Control>
      <Control label="Pan" value={panLabel(pan)}>
        <input type="range" min={-1} max={1} step={0.01} value={pan} onChange={e => setPan(+e.target.value)} style={rangeStyle} aria-label="Pan" />
      </Control>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        <strong style={{ color: 'var(--text-secondary)' }}>Width</strong> at 0% collapses to mono (the scope snaps to a vertical line — the safest way to check a mix survives mono), 100% is as-is, above that exaggerates the sides. <strong style={{ color: 'var(--text-secondary)' }}>Pan</strong> slides the whole image left or right. Keep bass and kick near mono; widen hats, pads, and ear-candy.
      </p>
    </Frame>
  )
}
