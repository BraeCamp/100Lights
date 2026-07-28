'use client'

import { useEffect, useRef } from 'react'

// A full-screen, click-through canvas overlay that draws a cinematic flourish
// wherever the user clicks. It sits above the whole UI, so the screen recorder
// captures the effect — turning a plain screen-record into something that reads
// like a produced clip. Purely visual: pointer-events are off, so it never
// intercepts a real click.

export type ClickStyle = 'ripple' | 'glow' | 'burst'

interface Ping { x: number; y: number; t0: number }

const DURATION: Record<ClickStyle, number> = { ripple: 750, glow: 650, burst: 620 }

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '')
  const n = m.length === 3 ? m.split('').map(c => c + c).join('') : m
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
}

function draw(ctx: CanvasRenderingContext2D, p: Ping, t: number, style: ClickStyle, rgb: [number, number, number]) {
  const [r, g, b] = rgb
  const ease = 1 - Math.pow(1 - t, 3) // easeOutCubic
  if (style === 'ripple') {
    const radius = 6 + ease * 46
    ctx.beginPath()
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2)
    ctx.lineWidth = 3 * (1 - t)
    ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - t) * 0.9})`
    ctx.stroke()
    // solid core dot that fades fast
    if (t < 0.4) {
      ctx.beginPath()
      ctx.arc(p.x, p.y, 5 * (1 - t / 0.4), 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${r},${g},${b},${1 - t / 0.4})`
      ctx.fill()
    }
  } else if (style === 'glow') {
    const radius = 10 + ease * 40
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius)
    const a = (1 - t) * 0.55
    grad.addColorStop(0, `rgba(${r},${g},${b},${a})`)
    grad.addColorStop(0.6, `rgba(${r},${g},${b},${a * 0.35})`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`)
    ctx.fillStyle = grad
    ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill()
  } else { // burst
    ctx.strokeStyle = `rgba(${r},${g},${b},${(1 - t) * 0.9})`
    ctx.lineWidth = 2.5 * (1 - t)
    ctx.beginPath(); ctx.arc(p.x, p.y, 4 + ease * 26, 0, Math.PI * 2); ctx.stroke()
    const spokes = 8
    for (let i = 0; i < spokes; i++) {
      const ang = (i / spokes) * Math.PI * 2
      const inner = 10 + ease * 20
      const outer = inner + 10 * (1 - t)
      ctx.beginPath()
      ctx.moveTo(p.x + Math.cos(ang) * inner, p.y + Math.sin(ang) * inner)
      ctx.lineTo(p.x + Math.cos(ang) * outer, p.y + Math.sin(ang) * outer)
      ctx.stroke()
    }
  }
}

export default function ClickHighlighter({ style = 'ripple', color = '#a78bfa' }: { style?: ClickStyle; color?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pings = useRef<Ping[]>([])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv) return
    const c = cv.getContext('2d')
    if (!c) return
    const rgb = hexToRgb(color)

    function resize() {
      const dpr = window.devicePixelRatio || 1
      cv!.width = window.innerWidth * dpr
      cv!.height = window.innerHeight * dpr
      cv!.style.width = window.innerWidth + 'px'
      cv!.style.height = window.innerHeight + 'px'
      c!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    window.addEventListener('resize', resize)

    const onDown = (e: PointerEvent) => { pings.current.push({ x: e.clientX, y: e.clientY, t0: performance.now() }) }
    window.addEventListener('pointerdown', onDown, true)

    let raf = 0
    const dur = DURATION[style]
    function frame() {
      c!.clearRect(0, 0, window.innerWidth, window.innerHeight)
      const now = performance.now()
      pings.current = pings.current.filter(p => now - p.t0 < dur)
      for (const p of pings.current) draw(c!, p, (now - p.t0) / dur, style, rgb)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [style, color])

  return <canvas ref={canvasRef} aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none' }} />
}
