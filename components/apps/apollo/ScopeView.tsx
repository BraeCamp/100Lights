'use client'
// Master oscilloscope + spectrum analyzer fed by the engine's AnalyserNode.

import React, { useEffect, useRef, useState } from 'react'
import { useApollo, Section, ToggleBtn, UI } from './ApolloContext'

export default function ScopeView() {
  const ctx = useApollo()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [mode, setMode] = useState<'wave' | 'spectrum' | 'both'>('both')
  const modeRef = useRef(mode)
  modeRef.current = mode

  useEffect(() => {
    let raf = 0
    const time = new Float32Array(2048)
    const freq = new Uint8Array(1024)
    const draw = () => {
      raf = requestAnimationFrame(draw)
      const cv = canvasRef.current
      const an = ctx.engine.analyser
      if (!cv || !an) return
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth, h = cv.clientHeight
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr }
      const g = cv.getContext('2d')
      if (!g) return
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.fillStyle = UI.inset
      g.fillRect(0, 0, w, h)
      const m = modeRef.current
      // spectrum (log-frequency bars)
      if (m !== 'wave') {
        an.getByteFrequencyData(freq)
        const sr = ctx.engine.ctx?.sampleRate || 48000
        const bars = Math.min(96, w >> 3)
        for (let b = 0; b < bars; b++) {
          // 30 Hz .. 18 kHz log spacing
          const f0 = 30 * Math.pow(18000 / 30, b / bars)
          const f1 = 30 * Math.pow(18000 / 30, (b + 1) / bars)
          const i0 = Math.max(1, Math.floor(f0 / (sr / 2) * freq.length))
          const i1 = Math.max(i0 + 1, Math.ceil(f1 / (sr / 2) * freq.length))
          let mx = 0
          for (let i = i0; i < i1 && i < freq.length; i++) mx = Math.max(mx, freq[i])
          const v = mx / 255
          const bh = Math.pow(v, 1.4) * (h - 6)
          g.fillStyle = `rgba(${b < bars / 3 ? '141, 230, 126' : b < (2 * bars) / 3 ? '110, 190, 200' : '90, 150, 235'}, ${0.35 + v * 0.65})`
          g.fillStyle = UI.blue + Math.round(60 + v * 195).toString(16).padStart(2, '0')
          g.fillRect((b / bars) * w + 1, h - bh - 2, w / bars - 2, bh)
        }
      }
      // waveform trace
      if (m !== 'spectrum') {
        an.getFloatTimeDomainData(time)
        g.strokeStyle = UI.green
        g.lineWidth = 1.4
        g.beginPath()
        for (let x = 0; x < w; x++) {
          const v = time[Math.floor((x / w) * time.length)]
          const y = (0.5 - v * 0.45) * h
          if (x === 0) g.moveTo(x, y)
          else g.lineTo(x, y)
        }
        g.stroke()
      }
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [ctx.engine])

  return (
    <Section
      title="Scope"
      right={
        <div style={{ display: 'flex', gap: 3 }}>
          {(['wave', 'spectrum', 'both'] as const).map(mv => (
            <ToggleBtn key={mv} on={mode === mv} label={mv} onClick={() => setMode(mv)} />
          ))}
        </div>
      }
    >
      <canvas ref={canvasRef} style={{ width: '100%', height: 110, display: 'block', borderRadius: 8 }} />
    </Section>
  )
}
