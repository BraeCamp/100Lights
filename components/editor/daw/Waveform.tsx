'use client'

import { useEffect, useRef } from 'react'

interface WaveformProps {
  peaks: number[]
  color?: string
  bgColor?: string
  width?: number
  height?: number
  playhead?: number
  trimStart?: number
  trimEnd?: number
  verticalZoom?: number
  style?: React.CSSProperties
  className?: string
}

export default function Waveform({
  peaks,
  color = '#3d8fef',
  bgColor = 'transparent',
  width = 200,
  height = 48,
  playhead,
  trimStart,
  trimEnd,
  verticalZoom = 1,
  style,
  className,
}: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

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
    ctx.clearRect(0, 0, width, height)

    if (bgColor !== 'transparent') {
      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, width, height)
    }

    if (!peaks.length) return

    const mid  = height / 2
    const step = width / peaks.length

    ctx.fillStyle = color
    for (let i = 0; i < peaks.length; i++) {
      const barH = Math.min(mid, Math.max(1, peaks[i] * mid * 0.95 * verticalZoom))
      ctx.fillRect(i * step, mid - barH, Math.max(1, step - 0.5), barH * 2)
    }

    // Dim trimmed regions
    if (trimStart && trimStart > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect(0, 0, trimStart * width, height)
    }
    if (trimEnd && trimEnd > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'
      ctx.fillRect((1 - trimEnd) * width, 0, trimEnd * width, height)
    }

    // Playhead
    if (playhead != null && playhead >= 0 && playhead <= 1) {
      ctx.strokeStyle = 'rgba(255,220,50,0.9)'
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(playhead * width, 0)
      ctx.lineTo(playhead * width, height)
      ctx.stroke()
    }
  }, [peaks, color, bgColor, width, height, playhead, trimStart, trimEnd, verticalZoom])

  return <canvas ref={canvasRef} style={style} className={className} />
}
