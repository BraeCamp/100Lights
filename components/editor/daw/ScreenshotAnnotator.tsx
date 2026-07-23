'use client'

// Lazy-loaded screenshot editor — opens after a screenshot is captured. Crop to
// a region, draw on the image (freehand or boxes) in any colour, undo, then save
// or copy. Heavy enough (canvas tools + colour picker) to keep out of the main
// bundle: Transport loads it with next/dynamic only when a shot is taken.

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Tool = 'pen' | 'rect' | 'arrow' | 'crop'

interface PenShape   { kind: 'pen';   color: string; width: number; pts: Array<[number, number]> }
interface BoxShape   { kind: 'rect' | 'arrow'; color: string; width: number; x: number; y: number; w: number; h: number }
type Shape = PenShape | BoxShape

const COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ffffff', '#111111']

export default function ScreenshotAnnotator({ blob, defaultName, onClose }: {
  blob: Blob
  defaultName: string
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)  // current base image (post-crop)
  const [shapes, setShapes] = useState<Shape[]>([])
  const [live, setLive] = useState<Shape | null>(null)           // shape being drawn
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState('#ef4444')
  const [width, setWidth] = useState(5)
  const [saved, setSaved] = useState(false)

  // Load the screenshot blob into an Image.
  useEffect(() => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    image.onload = () => { setImg(image); URL.revokeObjectURL(url) }
    image.src = url
    return () => URL.revokeObjectURL(url)
  }, [blob])

  function drawShape(ctx: CanvasRenderingContext2D, s: Shape) {
    ctx.strokeStyle = s.color
    ctx.fillStyle = s.color
    ctx.lineWidth = s.width
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    if (s.kind === 'pen') {
      ctx.beginPath()
      s.pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y))
      ctx.stroke()
    } else if (s.kind === 'rect') {
      ctx.strokeRect(s.x, s.y, s.w, s.h)
    } else {
      // arrow
      const x2 = s.x + s.w, y2 = s.y + s.h
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(x2, y2); ctx.stroke()
      const ang = Math.atan2(s.h, s.w), head = Math.max(12, s.width * 3)
      ctx.beginPath(); ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - head * Math.cos(ang - 0.4), y2 - head * Math.sin(ang - 0.4))
      ctx.lineTo(x2 - head * Math.cos(ang + 0.4), y2 - head * Math.sin(ang + 0.4))
      ctx.closePath(); ctx.fill()
    }
  }

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    if (canvas.width !== img.naturalWidth) { canvas.width = img.naturalWidth; canvas.height = img.naturalHeight }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    for (const s of shapes) drawShape(ctx, s)
    if (live) {
      drawShape(ctx, live)
      if (tool === 'crop' && live.kind === 'rect') {
        // dim everything outside the crop rectangle
        ctx.save()
        ctx.fillStyle = 'rgba(0,0,0,0.45)'
        const { x, y, w, h } = live
        ctx.beginPath(); ctx.rect(0, 0, canvas.width, canvas.height)
        ctx.rect(x, y, w, h); ctx.fill('evenodd')
        ctx.restore()
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4])
        ctx.strokeRect(x, y, w, h); ctx.setLineDash([])
      }
    }
  }, [img, shapes, live, tool])

  useEffect(() => { redraw() }, [redraw])

  // Map a pointer event to image-space coordinates.
  function toCanvas(e: React.PointerEvent): [number, number] {
    const canvas = canvasRef.current!
    const r = canvas.getBoundingClientRect()
    return [
      (e.clientX - r.left) / r.width * canvas.width,
      (e.clientY - r.top) / r.height * canvas.height,
    ]
  }

  function onDown(e: React.PointerEvent) {
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const [x, y] = toCanvas(e)
    if (tool === 'pen') setLive({ kind: 'pen', color, width, pts: [[x, y]] })
    else if (tool === 'crop') setLive({ kind: 'rect', color: '#fff', width: 2, x, y, w: 0, h: 0 })
    else setLive({ kind: tool, color, width, x, y, w: 0, h: 0 })
  }
  function onMove(e: React.PointerEvent) {
    if (!live) return
    const [x, y] = toCanvas(e)
    if (live.kind === 'pen') setLive({ ...live, pts: [...live.pts, [x, y]] })
    else setLive({ ...live, w: x - live.x, h: y - live.y })
  }
  function onUp() {
    if (!live) return
    if (tool === 'crop' && live.kind === 'rect') applyCrop(live)
    else setShapes(s => [...s, live])
    setLive(null)
  }

  // Bake the current canvas (image + annotations) and crop to the region.
  function applyCrop(rect: BoxShape) {
    const src = canvasRef.current
    if (!src) return
    let { x, y, w, h } = rect
    if (w < 0) { x += w; w = -w }
    if (h < 0) { y += h; h = -h }
    if (w < 5 || h < 5) return
    const tmp = document.createElement('canvas')
    tmp.width = Math.round(w); tmp.height = Math.round(h)
    tmp.getContext('2d')!.drawImage(src, x, y, w, h, 0, 0, w, h)
    const cropped = new Image()
    cropped.onload = () => { setShapes([]); setImg(cropped); setTool('pen') }
    cropped.src = tmp.toDataURL('image/png')
  }

  function undo() { setShapes(s => s.slice(0, -1)) }

  function exportBlob(): Promise<Blob | null> {
    return new Promise(res => canvasRef.current?.toBlob(b => res(b), 'image/png') ?? res(null))
  }
  async function save() {
    const b = await exportBlob()
    if (!b) return
    const url = URL.createObjectURL(b)
    const a = Object.assign(document.createElement('a'), { href: url, download: `${defaultName}.png` })
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }
  async function copy() {
    try {
      const b = await exportBlob()
      if (b && 'clipboard' in navigator && 'ClipboardItem' in window) {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
        setSaved(true); setTimeout(() => setSaved(false), 1500)
      }
    } catch { /* clipboard blocked — Save still works */ }
  }

  const toolBtn = (t: Tool, label: string, title: string): React.ReactNode => (
    <button onClick={() => setTool(t)} title={title}
      style={{ fontSize: 11, fontWeight: 700, padding: '4px 9px', borderRadius: 6, cursor: 'pointer',
        border: `1px solid ${tool === t ? 'var(--accent-light)' : 'var(--border)'}`,
        background: tool === t ? 'rgb(var(--accent-rgb) / 0.18)' : 'var(--bg-card)',
        color: tool === t ? 'var(--accent-light)' : 'var(--text-secondary)' }}>{label}</button>
  )

  return createPortal(
    <div onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, zIndex: 4000, background: 'rgba(0,0,0,0.72)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 }}>
      {/* Toolbar */}
      <div onMouseDown={e => e.stopPropagation()}
        style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 12px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)' }}>
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', color: 'var(--text-muted)' }}>SCREENSHOT</span>
        <div style={{ display: 'flex', gap: 5 }}>
          {toolBtn('pen', '✎ Draw', 'Freehand pen')}
          {toolBtn('rect', '▭ Box', 'Draw a box')}
          {toolBtn('arrow', '↗ Arrow', 'Draw an arrow')}
          {toolBtn('crop', '⛶ Crop', 'Drag to crop to a region')}
        </div>
        {/* Colour picker */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)} aria-label={`colour ${c}`}
              style={{ width: 18, height: 18, borderRadius: 5, cursor: 'pointer', background: c,
                border: color === c ? '2px solid var(--accent-light)' : '1px solid rgba(255,255,255,0.25)' }} />
          ))}
          <input type="color" value={color} onChange={e => setColor(e.target.value)} title="Custom colour"
            style={{ width: 24, height: 22, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
        </div>
        {/* Width */}
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: 'var(--text-muted)' }}>
          Size
          <input type="range" min={1} max={24} value={width} onChange={e => setWidth(Number(e.target.value))} style={{ width: 70 }} />
        </label>
        <button onClick={undo} disabled={shapes.length === 0} title="Undo last drawing"
          style={{ fontSize: 11, padding: '4px 9px', borderRadius: 6, cursor: shapes.length ? 'pointer' : 'default', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', opacity: shapes.length ? 1 : 0.5 }}>↶ Undo</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => void copy()} style={{ fontSize: 11, fontWeight: 600, padding: '5px 11px', borderRadius: 6, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>Copy</button>
        <button onClick={() => void save()} style={{ fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 6, cursor: 'pointer', border: 'none', background: 'var(--accent)', color: '#fff' }}>{saved ? 'Saved ✓' : 'Save PNG'}</button>
        <button onClick={onClose} aria-label="Close" style={{ fontSize: 14, padding: '2px 6px', borderRadius: 6, cursor: 'pointer', border: 'none', background: 'transparent', color: 'var(--text-muted)' }}>✕</button>
      </div>

      {/* Canvas */}
      <div onMouseDown={e => e.stopPropagation()} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', maxWidth: '100%' }}>
        {img ? (
          <canvas ref={canvasRef}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
            style={{ maxWidth: '100%', maxHeight: '78vh', borderRadius: 6, boxShadow: '0 8px 30px rgba(0,0,0,0.6)', cursor: tool === 'crop' ? 'crosshair' : 'crosshair', touchAction: 'none', background: '#000' }} />
        ) : (
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Preparing screenshot…</span>
        )}
      </div>
    </div>,
    document.body,
  )
}
