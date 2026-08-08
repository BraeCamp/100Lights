'use client'

import { useEffect, useRef } from 'react'
import { useDaw } from '@/lib/daw-state'

interface LevelMeterProps {
  trackId?: string
  width?: number
  height?: number
  /** Gate the readback+repaint RAF. When false the loop is idle and the meter
   *  shows one static, decayed-to-zero frame. */
  playing?: boolean
}

export default function LevelMeter({ trackId, width = 8, height = 120, playing = true }: LevelMeterProps) {
  const { engine } = useDaw()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const peakRef   = useRef(0)
  const peakHold  = useRef(0)
  const rafRef    = useRef<number | undefined>(undefined)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width  = width  * dpr
    canvas.height = height * dpr
    canvas.style.width  = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    let lastPeakTime = 0

    function paint(norm: number, peak: number) {
      ctx.clearRect(0, 0, width, height)

      const barH = norm * height
      const grad = ctx.createLinearGradient(0, height, 0, 0)
      grad.addColorStop(0,    '#22c55e')
      grad.addColorStop(0.65, '#eab308')
      grad.addColorStop(0.85, '#f97316')
      grad.addColorStop(1,    '#ef4444')
      ctx.fillStyle = grad
      ctx.fillRect(0, height - barH, width, barH)

      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      const peakY = height - peak * height
      ctx.fillRect(0, peakY, width, 2)
    }

    function draw(ts: number) {
      const data = trackId ? engine.getTrackLevel(trackId) : engine.getMasterLevel()
      let rms = 0
      if (data) {
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128
          rms += v * v
        }
        rms = Math.sqrt(rms / data.length)
      }

      const db = 20 * Math.log10(Math.max(rms, 0.0001))
      const norm = Math.max(0, Math.min(1, (db + 60) / 60))

      if (norm > peakRef.current) {
        peakRef.current = norm
        lastPeakTime = ts
        peakHold.current = norm
      } else {
        const decay = (ts - lastPeakTime) / 1500
        if (decay > 0) peakRef.current = Math.max(0, peakHold.current - decay)
      }

      paint(norm, peakRef.current)

      rafRef.current = requestAnimationFrame(draw)
    }

    // Stopped: paint one decayed-to-zero frame and don't schedule the loop.
    if (!playing) {
      peakRef.current  = 0
      peakHold.current = 0
      paint(0, 0)
      return
    }

    rafRef.current = requestAnimationFrame(draw)
    return () => { if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current) }
  }, [engine, trackId, width, height, playing])

  return (
    <canvas
      ref={canvasRef}
      style={{ display: 'block', borderRadius: 2 }}
    />
  )
}
