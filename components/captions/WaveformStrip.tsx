'use client'

// A compact waveform of the loaded audio with caption segments drawn over it + a playhead. Click to
// seek. Lets you see gaps/overlaps between captions and jump around while fine-tuning timing.
import { useEffect, useRef } from 'react'
import type { EditCaption } from '@/lib/caption-format'

export default function WaveformStrip({ peaks, duration, captions, currentTime, onSeek, height = 56 }: {
  peaks: number[]; duration: number; captions: EditCaption[]; currentTime: number; onSeek: (t: number) => void; height?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = ref.current; if (!cv || !peaks.length || !duration) return
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1)
    const W = cv.clientWidth, H = height
    cv.width = W * dpr; cv.height = H * dpr
    const ctx = cv.getContext('2d'); if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const css = (v: string, f: string) => (typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(v).trim() : '') || f
    const accent = css('--accent', '#7c5cff')

    // caption segment bands (alternating tint so boundaries are visible)
    for (let i = 0; i < captions.length; i++) {
      const c = captions[i]
      const x0 = (c.start / duration) * W, x1 = (c.end / duration) * W
      ctx.fillStyle = i % 2 ? 'rgba(124,92,255,0.10)' : 'rgba(124,92,255,0.05)'
      ctx.fillRect(x0, 0, Math.max(1, x1 - x0), H)
    }
    // waveform mirrored around the middle
    const mid = H / 2, bw = W / peaks.length
    ctx.fillStyle = 'rgba(150,150,170,0.55)'
    for (let i = 0; i < peaks.length; i++) {
      const h = Math.max(1, peaks[i] * (H - 6))
      ctx.fillRect(i * bw, mid - h / 2, Math.max(0.6, bw - 0.4), h)
    }
    // caption boundaries
    ctx.strokeStyle = 'rgba(124,92,255,0.5)'; ctx.lineWidth = 1
    for (const c of captions) { const x = (c.start / duration) * W; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke() }
    // playhead
    const px = (currentTime / duration) * W
    ctx.strokeStyle = accent; ctx.lineWidth = 1.5
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, H); ctx.stroke()
  }, [peaks, duration, captions, currentTime, height])

  return (
    <canvas ref={ref} onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.max(0, Math.min(duration, ((e.clientX - r.left) / r.width) * duration))) }}
      style={{ width: '100%', height, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-base)', cursor: 'pointer', display: 'block' }} />
  )
}
