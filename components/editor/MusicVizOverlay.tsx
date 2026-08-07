'use client'

// Live music-visual overlay for the video preview. Mounts a full-frame canvas
// over the video and renders the chosen audio-reactive visual (waveform / EQ /
// radial) from an AnalyserNode tapping the timeline audio, via the shared
// renderer in lib/music-viz.ts. The SAME renderer drives the export compositor,
// so preview and export match. When there's no live audio the format falls back
// to a gentle idle animation, so the overlay always reads.

import { useEffect, useRef } from 'react'
import { createMusicViz, DEFAULT_MUSIC_VIZ_FORMAT, type MusicVizConfig } from '@/lib/music-viz'

export interface MusicVizOverlayProps {
  format?: string
  accent: string
  bg?: [string, string] | null
  /** Read the live analyser tapping the timeline audio each frame (the node is
   *  created lazily/per-URL, so we poll it rather than capture it once). Returns
   *  null → the format falls back to a gentle idle animation. */
  getAnalyser: () => AnalyserNode | null
  /** Render resolution (short side). Falls back to the element's pixel size. */
  resolution?: number
  opacity?: number      // 0–100
  blendMode?: string
}

export default function MusicVizOverlay({ format, accent, bg, getAnalyser, resolution, opacity = 100, blendMode }: MusicVizOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const waveRef = useRef<Uint8Array<ArrayBuffer> | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const config: MusicVizConfig = { format: format || DEFAULT_MUSIC_VIZ_FORMAT, accent, bg: bg ?? null }
    const viz = createMusicViz(config)
    let raf = 0
    const t0 = performance.now()

    const sizeCanvas = () => {
      const r = canvas.getBoundingClientRect()
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = resolution
        ? Math.round(resolution * (r.width / Math.max(1, r.height)))
        : Math.max(2, Math.round(r.width * dpr))
      const h = resolution ? resolution : Math.max(2, Math.round(r.height * dpr))
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h }
    }

    const frame = () => {
      sizeCanvas()
      let audio = null
      const analyser = getAnalyser()
      if (analyser) {
        if (!freqRef.current || freqRef.current.length !== analyser.frequencyBinCount) freqRef.current = new Uint8Array(analyser.frequencyBinCount)
        if (!waveRef.current || waveRef.current.length !== analyser.fftSize) waveRef.current = new Uint8Array(analyser.fftSize)
        analyser.getByteFrequencyData(freqRef.current)
        analyser.getByteTimeDomainData(waveRef.current)
        audio = { freq: freqRef.current, wave: waveRef.current }
      }
      viz.draw(ctx, canvas.width, canvas.height, (performance.now() - t0) / 1000, audio)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
    // getAnalyser is read live each frame; only the look/format deps re-init.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, accent, bg, resolution])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        pointerEvents: 'none', opacity: Math.max(0, Math.min(100, opacity)) / 100,
        mixBlendMode: (blendMode as React.CSSProperties['mixBlendMode']) || 'normal',
      }}
    />
  )
}
