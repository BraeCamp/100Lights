'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { Mic } from 'lucide-react'

interface Props {
  src: string | null
  contentType: 'audio' | 'video' | null
  currentTime: number
  duration: number
  onSeek: (t: number) => void
}

const PEAK_COUNT = 1800

export default function AudioWaveform({ src, contentType, currentTime, duration, onSeek }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [decoding, setDecoding] = useState(false)
  const [decodeError, setDecodeError] = useState('')
  const decodedSrcRef = useRef<string | null>(null)

  useEffect(() => {
    if (!src || contentType === 'video') {
      if (contentType === 'video') { setPeaks(null); setDecodeError('') }
      return
    }
    if (src === decodedSrcRef.current) return
    decodedSrcRef.current = src
    setPeaks(null)
    setDecodeError('')
    setDecoding(true)

    const ACtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ac = new ACtx()

    fetch(src)
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer() })
      .then(buf => ac.decodeAudioData(buf))
      .then(audioBuffer => {
        const channelData = audioBuffer.getChannelData(0)
        const blockSize = Math.max(1, Math.floor(channelData.length / PEAK_COUNT))
        const data = new Float32Array(PEAK_COUNT)
        for (let i = 0; i < PEAK_COUNT; i++) {
          let max = 0
          const start = i * blockSize
          for (let j = 0; j < blockSize; j++) {
            const abs = Math.abs(channelData[start + j] ?? 0)
            if (abs > max) max = abs
          }
          data[i] = max
        }
        setPeaks(data)
      })
      .catch(e => setDecodeError(e instanceof Error ? e.message : 'Failed to decode'))
      .finally(() => { setDecoding(false); ac.close().catch(() => {}) })
  }, [src, contentType])

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return
    const { width, height } = container.getBoundingClientRect()
    if (!width || !height) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    ctx.fillStyle = '#09090f'
    ctx.fillRect(0, 0, width, height)

    if (!peaks) return

    const mid = height / 2
    const barW = width / PEAK_COUNT
    const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0
    const progressX = progress * width

    for (let i = 0; i < PEAK_COUNT; i++) {
      const x = i * barW
      const barH = Math.max(1, peaks[i] * mid * 0.85)
      ctx.fillStyle = x < progressX ? 'rgba(139,92,246,0.85)' : 'rgba(55,55,85,0.9)'
      ctx.fillRect(x, mid - barH, Math.max(0.6, barW - 0.5), barH * 2)
    }

    // Center line
    ctx.fillStyle = 'rgba(255,255,255,0.04)'
    ctx.fillRect(0, mid - 0.5, width, 1)

    // Playhead
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(progressX, 0)
    ctx.lineTo(progressX, height)
    ctx.stroke()

    // Playhead triangle
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.moveTo(progressX - 5, 0)
    ctx.lineTo(progressX + 5, 0)
    ctx.lineTo(progressX, 7)
    ctx.closePath()
    ctx.fill()
  }, [peaks, currentTime, duration])

  useEffect(() => { draw() }, [draw])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => draw())
    ro.observe(el)
    return () => ro.disconnect()
  }, [draw])

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    onSeek(Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration)))
  }, [duration, onSeek])

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`

  const isEmpty = !src && !decoding && !decodeError
  const isVideo = contentType === 'video'

  return (
    <div ref={containerRef} className="relative w-full h-full flex flex-col" style={{ background: 'var(--bg-base)', overflow: 'hidden' }}>
      <div className="flex items-center justify-between px-3 shrink-0" style={{ height: 24, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}>
        <span className="text-xs font-semibold tracking-widest" style={{ color: 'var(--text-muted)', fontSize: 9 }}>AUDIO</span>
        {duration > 0 && (
          <span className="text-xs tabular-nums font-mono" style={{ color: 'var(--text-muted)', fontSize: 10 }}>
            {fmt(currentTime)} / {fmt(duration)}
          </span>
        )}
      </div>

      <div className="flex-1 relative" style={{ minHeight: 0 }}>
        <canvas
          ref={canvasRef}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', cursor: peaks && duration ? 'crosshair' : 'default' }}
          onClick={handleClick}
        />
        {decoding && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none" style={{ background: 'var(--bg-base)' }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid rgba(139,92,246,0.3)', borderTopColor: '#8b5cf6', animation: 'spin 0.8s linear infinite' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Decoding audio…</span>
          </div>
        )}
        {decodeError && !decoding && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none" style={{ background: 'var(--bg-base)' }}>
            <Mic size={18} style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Could not decode audio</span>
          </div>
        )}
        {isEmpty && !decodeError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none" style={{ background: 'var(--bg-base)' }}>
            <Mic size={22} style={{ color: 'rgba(255,255,255,0.08)' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Import an audio file to see the waveform</span>
          </div>
        )}
        {isVideo && !decoding && !isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 pointer-events-none" style={{ background: 'var(--bg-base)' }}>
            <Mic size={18} style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Audio waveform for video coming soon</span>
          </div>
        )}
      </div>
    </div>
  )
}
