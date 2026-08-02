'use client'

import { useRef, useEffect } from 'react'

// ── Drawable 4-band Tone-EQ curve ─────────────────────────────────────────────
// Shared by the Mixer strip and the clip Sound panel so both edit the SAME EQ.
// A small graph you draw on — drag a band's point up/down (like a vertical
// slider) to set its ±12 dB gain, double-click for flat. Bands sit at their real
// frequencies (log x-axis): sub 70 · bass 200 · mid 1k · treble 8k.
export type EqBand = 'sub' | 'bass' | 'mid' | 'treble'

export default function EqCurve({ value, onChange, width = 66, height = 42 }: {
  value: { sub?: number; bass?: number; mid?: number; treble?: number }
  onChange: (band: EqBand, v: number) => void
  width?: number; height?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const dragBand = useRef<number | null>(null)
  const BANDS: EqBand[] = ['sub', 'bass', 'mid', 'treble']
  const XF = [0.13, 0.38, 0.63, 0.88]                       // x fraction per band
  const COLORS = ['var(--accent-light)', '#22c55e', '#eab308', '#3b82f6']
  const gains = BANDS.map(b => value[b] ?? 0)
  const pad = 4
  const gToY = (g: number) => height / 2 - (g / 12) * (height / 2 - pad)
  const yToG = (y: number) => Math.max(-12, Math.min(12, ((height / 2 - y) / (height / 2 - pad)) * 12))

  // Bigger points / thicker line / gridlines + labels once the graph is opened
  // large, so every band is an easy drag target.
  const large = height >= 100
  const R = large ? 6 : 2.6
  const LW = large ? 2.5 : 1.5
  useEffect(() => {
    const c = ref.current; if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = width * dpr; c.height = height * dpr
    const ctx = c.getContext('2d')!; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = 'rgba(255,255,255,0.04)'; ctx.fillRect(0, 0, width, height)
    // dB gridlines: 0 dB solid, ±6 dB faint (only worth drawing when large)
    if (large) {
      ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 1
      for (const g of [6, -6]) { const y = gToY(g); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
      // band frequency guides
      ctx.strokeStyle = 'rgba(255,255,255,0.05)'
      XF.forEach(x => { ctx.beginPath(); ctx.moveTo(x * width, 0); ctx.lineTo(x * width, height); ctx.stroke() })
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke()
    // curve through the four band points (flat lead-in/out at the edges)
    const pts = XF.map((x, i) => [x * width, gToY(gains[i])] as const)
    // subtle fill under the curve when large
    if (large) {
      ctx.beginPath(); ctx.moveTo(0, gToY(gains[0]))
      for (const [x, y] of pts) ctx.lineTo(x, y)
      ctx.lineTo(width, gToY(gains[3])); ctx.lineTo(width, height / 2); ctx.lineTo(0, height / 2); ctx.closePath()
      ctx.fillStyle = 'rgb(var(--accent-rgb) / 0.12)'; ctx.fill()
    }
    ctx.strokeStyle = 'var(--accent)'; ctx.lineWidth = LW; ctx.beginPath()
    ctx.moveTo(0, gToY(gains[0]))
    for (const [x, y] of pts) ctx.lineTo(x, y)
    ctx.lineTo(width, gToY(gains[3])); ctx.stroke()
    pts.forEach(([x, y], i) => {
      if (large) { ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.stroke() }
      ctx.fillStyle = COLORS[i]; ctx.beginPath(); ctx.arc(x, y, R, 0, Math.PI * 2); ctx.fill()
    })
  }, [gains.join(','), width, height, large, R, LW])

  const bandAtX = (px: number) => {
    const fx = px / width; let best = 0, bd = 9
    XF.forEach((x, i) => { const d = Math.abs(x - fx); if (d < bd) { bd = d; best = i } })
    return best
  }
  const onDown = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    const b = bandAtX(e.clientX - rect.left)
    dragBand.current = b
    const apply = (clientY: number) => onChange(BANDS[b], Math.round(yToG(clientY - rect.top) * 2) / 2)
    apply(e.clientY)
    const mm = (ev: PointerEvent) => { if (dragBand.current != null) apply(ev.clientY) }
    const mu = () => { dragBand.current = null; document.removeEventListener('pointermove', mm); document.removeEventListener('pointerup', mu) }
    document.addEventListener('pointermove', mm); document.addEventListener('pointerup', mu)
  }
  return (
    <canvas ref={ref} onPointerDown={onDown} onDoubleClick={() => BANDS.forEach(b => onChange(b, 0))}
      title="Draw the EQ — drag a band up/down · double-click for flat"
      style={{ width, height, borderRadius: 3, display: 'block', cursor: 'ns-resize', touchAction: 'none' }} />
  )
}
