'use client'

import { useEffect, useRef, useCallback } from 'react'

type ScopeType = 'waveform' | 'vectorscope' | 'histogram' | 'parade' | 'spectrum'

interface Props {
  videoRef: React.RefObject<HTMLVideoElement | null>
  isPlaying: boolean
  scope: ScopeType
  onScopeChange: (s: ScopeType) => void
}

const TABS: { id: ScopeType; label: string }[] = [
  { id: 'waveform', label: 'Waveform' },
  { id: 'vectorscope', label: 'Vectorscope' },
  { id: 'histogram', label: 'Histogram' },
  { id: 'parade', label: 'Parade' },
  { id: 'spectrum', label: 'Spectrum' },
]

const SAMPLE_W = 320
const SAMPLE_H = 180

export default function ColorScopes({ videoRef, isPlaying, scope, onScopeChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const offscreenRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)
  const scopeRef = useRef(scope)
  scopeRef.current = scope

  const audioCtxRef  = useRef<AudioContext | null>(null)
  const analyserRef  = useRef<AnalyserNode | null>(null)
  const fftDataRef   = useRef<Uint8Array<ArrayBuffer> | null>(null)

  useEffect(() => {
    if (scope !== 'spectrum') {
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {})
        audioCtxRef.current = null
        analyserRef.current = null
        fftDataRef.current  = null
      }
      return
    }
    const video = videoRef.current
    if (!video) return
    try {
      const ctx = new AudioContext()
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      const source = ctx.createMediaElementSource(video)
      source.connect(analyser)
      analyser.connect(ctx.destination)
      audioCtxRef.current = ctx
      analyserRef.current = analyser
      fftDataRef.current  = new Uint8Array(analyser.frequencyBinCount)
    } catch {
      // Video element already owned by another AudioContext
    }
  }, [scope]) // eslint-disable-line

  // Lazily create the offscreen canvas once
  function getOffscreen(): HTMLCanvasElement {
    if (!offscreenRef.current) {
      const c = document.createElement('canvas')
      c.width = SAMPLE_W
      c.height = SAMPLE_H
      offscreenRef.current = c
    }
    return offscreenRef.current
  }

  const draw = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!canvas || !video || video.readyState < 2) return

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return

    const W = canvas.width
    const H = canvas.height

    // Sample the video frame into the small offscreen canvas
    const off = getOffscreen()
    const octx = off.getContext('2d', { willReadFrequently: true })!
    octx.drawImage(video, 0, 0, SAMPLE_W, SAMPLE_H)
    const { data } = octx.getImageData(0, 0, SAMPLE_W, SAMPLE_H)

    // Clear
    ctx.fillStyle = '#0a0a0a'
    ctx.fillRect(0, 0, W, H)

    const currentScope = scopeRef.current

    if (currentScope === 'waveform') {
      drawWaveform(ctx, data, W, H, SAMPLE_W, SAMPLE_H, 0, W, '#00ff7f')
    } else if (currentScope === 'vectorscope') {
      drawVectorscope(ctx, data, W, H, SAMPLE_W, SAMPLE_H)
    } else if (currentScope === 'histogram') {
      drawHistogram(ctx, data, W, H, SAMPLE_W, SAMPLE_H)
    } else if (currentScope === 'parade') {
      drawParade(ctx, data, W, H, SAMPLE_W, SAMPLE_H)
    } else if (currentScope === 'spectrum') {
      const analyser = analyserRef.current
      const fft      = fftDataRef.current
      if (analyser && fft) {
        analyser.getByteFrequencyData(fft)
        const bins = fft.length
        const barW = W / bins
        for (let i = 0; i < bins; i++) {
          const v     = fft[i] / 255
          const barH  = v * H
          const hue   = (i / bins) * 280
          ctx.fillStyle = `hsl(${hue}, 100%, ${30 + v * 35}%)`
          ctx.fillRect(i * barW, H - barH, Math.max(1, barW - 1), barH)
          // Peak dot
          ctx.fillStyle = `hsl(${hue}, 100%, 75%)`
          ctx.fillRect(i * barW, H - barH - 2, Math.max(1, barW - 1), 2)
        }
      } else {
        // No audio — draw placeholder bars
        const bins = 64
        const barW = W / bins
        for (let i = 0; i < bins; i++) {
          const hue = (i / bins) * 280
          ctx.fillStyle = `hsl(${hue}, 60%, 20%)`
          ctx.fillRect(i * barW, H * 0.7, Math.max(1, barW - 1), H * 0.3)
        }
        ctx.fillStyle = '#555'
        ctx.font = '11px sans-serif'
        ctx.textAlign = 'center'
        ctx.fillText('Enable audio in player to see spectrum', W / 2, H / 2)
      }
    }
  }, [videoRef])

  // RAF loop while playing
  useEffect(() => {
    if (!isPlaying) return

    function loop() {
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [isPlaying, draw])

  // Single draw on pause / scope change
  useEffect(() => {
    if (!isPlaying) {
      draw()
    }
  }, [isPlaying, scope, draw])

  // Sync canvas size to container
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      canvas.width = Math.floor(width)
      canvas.height = Math.floor(height)
      draw()
    })
    ro.observe(canvas.parentElement ?? canvas)
    return () => ro.disconnect()
  }, [draw])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--bg-base)' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => onScopeChange(tab.id)}
            style={{
              flex: 1,
              padding: '6px 0',
              fontSize: 11,
              fontWeight: 500,
              letterSpacing: '0.03em',
              background: 'none',
              border: 'none',
              borderBottom: scope === tab.id ? '2px solid #a855f7' : '2px solid transparent',
              color: scope === tab.id ? 'var(--text-primary)' : '#71717a',
              cursor: 'pointer',
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Canvas fills remaining space */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', width: '100%', height: '100%' }}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  data: Uint8ClampedArray,
  W: number,
  H: number,
  sw: number,
  sh: number,
  xOffset: number,
  xWidth: number,
  color: string,
) {
  // Accumulate hit counts per (column, row) bucket
  const cols = xWidth
  const hits = new Uint16Array(cols * H)

  for (let px = 0; px < sw; px++) {
    const col = Math.floor((px / sw) * cols)
    for (let py = 0; py < sh; py++) {
      const i = (py * sw + px) * 4
      const r = data[i] / 255
      const g = data[i + 1] / 255
      const b = data[i + 2] / 255
      const y = 0.299 * r + 0.587 * g + 0.114 * b
      const row = H - 1 - Math.round(y * (H - 1))
      hits[col * H + row]++
    }
  }

  // Find max for brightness normalization
  let maxHit = 0
  for (let i = 0; i < hits.length; i++) if (hits[i] > maxHit) maxHit = hits[i]
  if (maxHit === 0) return

  // Parse base color
  const [cr, cg, cb] = hexToRgb(color)

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < H; row++) {
      const count = hits[col * H + row]
      if (count === 0) continue
      const alpha = Math.min(1, 0.15 + (count / maxHit) * 0.85)
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
      ctx.fillRect(xOffset + col, row, 1, 1)
    }
  }
}

function drawVectorscope(
  ctx: CanvasRenderingContext2D,
  data: Uint8ClampedArray,
  W: number,
  H: number,
  sw: number,
  sh: number,
) {
  const cx = W / 2
  const cy = H / 2
  const radius = Math.min(W, H) / 2 - 8
  const scale = radius / 0.5

  // Reference circle at 75% saturation
  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.75, 0, Math.PI * 2)
  ctx.strokeStyle = '#2a2a2a'
  ctx.lineWidth = 1
  ctx.stroke()

  // Crosshairs
  ctx.strokeStyle = '#1f1f1f'
  ctx.beginPath()
  ctx.moveTo(cx, cy - radius - 4)
  ctx.lineTo(cx, cy + radius + 4)
  ctx.moveTo(cx - radius - 4, cy)
  ctx.lineTo(cx + radius + 4, cy)
  ctx.stroke()

  // Plot pixels
  const [pr, pg, pb] = hexToRgb('#a855f7')
  ctx.fillStyle = `rgba(${pr},${pg},${pb},0.6)`

  for (let i = 0; i < sw * sh; i++) {
    const idx = i * 4
    const r = data[idx] / 255
    const g = data[idx + 1] / 255
    const b = data[idx + 2] / 255
    const y = 0.299 * r + 0.587 * g + 0.114 * b
    const cb = b - y
    const cr = r - y
    const x = cx + cb * scale
    const yPos = cy - cr * scale
    ctx.fillRect(Math.round(x), Math.round(yPos), 1, 1)
  }
}

function drawHistogram(
  ctx: CanvasRenderingContext2D,
  data: Uint8ClampedArray,
  W: number,
  H: number,
  sw: number,
  sh: number,
) {
  const rBins = new Uint32Array(256)
  const gBins = new Uint32Array(256)
  const bBins = new Uint32Array(256)

  for (let i = 0; i < sw * sh; i++) {
    const idx = i * 4
    rBins[data[idx]]++
    gBins[data[idx + 1]]++
    bBins[data[idx + 2]]++
  }

  let maxCount = 0
  for (let i = 0; i < 256; i++) {
    if (rBins[i] > maxCount) maxCount = rBins[i]
    if (gBins[i] > maxCount) maxCount = gBins[i]
    if (bBins[i] > maxCount) maxCount = bBins[i]
  }
  if (maxCount === 0) return

  const channels: [Uint32Array, string][] = [
    [rBins, 'rgba(239,68,68,0.6)'],
    [gBins, 'rgba(34,197,94,0.6)'],
    [bBins, 'rgba(59,130,246,0.6)'],
  ]

  for (const [bins, color] of channels) {
    ctx.beginPath()
    ctx.moveTo(0, H)
    for (let v = 0; v < 256; v++) {
      const x = (v / 255) * W
      const y = H - (bins[v] / maxCount) * H
      if (v === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.lineTo(W, H)
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  }
}

function drawParade(
  ctx: CanvasRenderingContext2D,
  data: Uint8ClampedArray,
  W: number,
  H: number,
  sw: number,
  sh: number,
) {
  const channelW = Math.floor(W / 3)
  const gap = Math.floor((W - channelW * 3) / 2)

  const channels: [number, string][] = [
    [0, '#ef4444'], // R
    [1, '#22c55e'], // G
    [2, '#3b82f6'], // B
  ]

  for (let ci = 0; ci < 3; ci++) {
    const [channelIdx, color] = channels[ci]
    const xOffset = ci * (channelW + gap)

    const cols = channelW
    const hits = new Uint16Array(cols * H)

    for (let px = 0; px < sw; px++) {
      const col = Math.floor((px / sw) * cols)
      for (let py = 0; py < sh; py++) {
        const i = (py * sw + px) * 4
        const val = data[i + channelIdx] / 255
        const row = H - 1 - Math.round(val * (H - 1))
        hits[col * H + row]++
      }
    }

    let maxHit = 0
    for (let i = 0; i < hits.length; i++) if (hits[i] > maxHit) maxHit = hits[i]
    if (maxHit === 0) continue

    const [cr, cg, cb] = hexToRgb(color)

    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < H; row++) {
        const count = hits[col * H + row]
        if (count === 0) continue
        const alpha = Math.min(1, 0.15 + (count / maxHit) * 0.85)
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`
        ctx.fillRect(xOffset + col, row, 1, 1)
      }
    }

    // Channel label
    ctx.fillStyle = color
    ctx.font = '10px monospace'
    ctx.fillText(['R', 'G', 'B'][ci], xOffset + 4, H - 6)

    // Divider
    if (ci < 2) {
      ctx.strokeStyle = '#1f1f1f'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(xOffset + channelW + Math.floor(gap / 2), 0)
      ctx.lineTo(xOffset + channelW + Math.floor(gap / 2), H)
      ctx.stroke()
    }
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
