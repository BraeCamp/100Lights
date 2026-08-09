'use client'

// Editable mini piano-roll shared by the transcription apps (Hear Sheet Music, Transcribe).
// Drag a note vertically to fix its pitch, horizontally to shift its timing; double-tap to delete.
// Pure client canvas; calls onChange with the updated note list. This is the "mess with the
// transcription" surface — no AI, all local.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MidiNote } from '@/lib/daw-types'

export default function NoteEditor({ notes, onChange, height = 172, confidence, confidenceThreshold = 0.55 }: {
  notes: MidiNote[]; onChange: (n: MidiNote[]) => void; height?: number
  /** Optional per-note-id confidence (0..1); notes below the threshold render in a warning colour. */
  confidence?: Record<string, number>; confidenceThreshold?: number
}) {
  const cvRef = useRef<HTMLCanvasElement>(null)
  const [sel, setSel] = useState<string | null>(null)
  const drag = useRef<{ id: string; x0: number; y0: number; beat0: number; pitch0: number } | null>(null)
  const notesRef = useRef(notes); notesRef.current = notes

  // Geometry from the current notes, padded so a dragged note keeps headroom.
  const geom = useCallback(() => {
    const W = cvRef.current?.clientWidth || 320, H = height, pad = 8
    const ns = notesRef.current
    const end = Math.max(...ns.map(n => n.startBeat + n.durationBeats), 1)
    const pits = ns.length ? ns.map(n => n.pitch) : [60]
    const lo = Math.min(...pits) - 4, hi = Math.max(...pits) + 4
    const span = Math.max(12, hi - lo)
    const rowH = (H - 2 * pad) / span
    return {
      W, H, pad, end, lo, span, rowH,
      x: (b: number) => pad + (b / end) * (W - 2 * pad),
      w: (d: number) => Math.max(3, (d / end) * (W - 2 * pad)),
      y: (p: number) => pad + (1 - (p - lo) / span) * (H - 2 * pad),
    }
  }, [height])

  const draw = useCallback(() => {
    const cv = cvRef.current; if (!cv) return
    const ctx = cv.getContext('2d'); if (!ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const g = geom()
    cv.width = g.W * dpr; cv.height = g.H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, g.W, g.H)
    const cs = getComputedStyle(cv)
    const accent = cs.getPropertyValue('--accent').trim() || '#3d8fef'
    const warn = '#f59e0b'  // low-confidence notes (would route to the smarter/AI pass)
    const h = Math.max(4, g.rowH * 0.8)
    for (const n of notesRef.current) {
      const x = g.x(n.startBeat), w = g.w(n.durationBeats), y = g.y(n.pitch)
      const low = confidence && confidence[n.id] !== undefined && confidence[n.id] < confidenceThreshold
      const col = low ? warn : accent
      if (n.id === sel) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y - h / 2, w, h); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.strokeRect(x - 1.5, y - h / 2 - 1.5, w + 3, h + 3) }
      else { ctx.fillStyle = col; ctx.fillRect(x, y - h / 2, w, h) }
    }
  }, [geom, sel, confidence, confidenceThreshold])
  useEffect(() => { draw() }, [draw, notes])
  useEffect(() => { const r = () => draw(); window.addEventListener('resize', r); return () => window.removeEventListener('resize', r) }, [draw])

  const hit = useCallback((px: number, py: number): MidiNote | null => {
    const g = geom(); const h = Math.max(9, g.rowH * 0.8)
    const ns = notesRef.current
    for (let i = ns.length - 1; i >= 0; i--) {
      const n = ns[i], x = g.x(n.startBeat), w = g.w(n.durationBeats), y = g.y(n.pitch)
      if (px >= x - 3 && px <= x + w + 3 && py >= y - h / 2 - 3 && py <= y + h / 2 + 3) return n
    }
    return null
  }, [geom])

  const pos = (e: { clientX: number; clientY: number }) => { const r = cvRef.current!.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top } }

  const onDown = (e: React.PointerEvent) => {
    const { px, py } = pos(e); const n = hit(px, py)
    if (n) { setSel(n.id); drag.current = { id: n.id, x0: px, y0: py, beat0: n.startBeat, pitch0: n.pitch }; try { cvRef.current!.setPointerCapture(e.pointerId) } catch { /* ok */ } }
    else setSel(null)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    const { px, py } = pos(e); const g = geom()
    const dPitch = Math.round((d.y0 - py) / g.rowH)
    const dBeat = ((px - d.x0) / (g.W - 2 * g.pad)) * g.end
    const pitch = Math.max(0, Math.min(127, d.pitch0 + dPitch))
    const startBeat = Math.max(0, +(d.beat0 + dBeat).toFixed(4))
    onChange(notesRef.current.map(n => (n.id === d.id ? { ...n, pitch, startBeat } : n)))
  }
  const onUp = (e: React.PointerEvent) => { drag.current = null; try { cvRef.current!.releasePointerCapture(e.pointerId) } catch { /* ok */ } }
  const onDbl = (e: React.MouseEvent) => { const { px, py } = pos(e); const n = hit(px, py); if (n) { onChange(notesRef.current.filter(x => x.id !== n.id)); setSel(null) } }

  return (
    <div>
      <canvas
        ref={cvRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDbl}
        style={{ width: '100%', height, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', touchAction: 'none', cursor: 'pointer', display: 'block' }}
      />
      <p style={{ fontSize: 11.5, color: 'var(--text-muted, var(--text-secondary))', margin: '6px 2px 0' }}>Drag a note to fix its pitch or timing · double-tap to delete</p>
    </div>
  )
}
