'use client'

// MIDI note stretch markers — Live's pair of handles above a selection of
// two or more notes, plus the pseudo marker between them.
//
// Drag the END marker and the selection stretches in time from its start;
// drag the START marker and it stretches from its end; drag either past the
// other and the order mirrors (a negative factor in lib/pitch-time.ts). The
// middle handle is the pseudo marker: dragging it warps the inside — the
// notes before it compress into one side, the notes after it expand into the
// other — and the ends stay where they are. Every move is computed from the
// notes as they were when the drag began, so a long drag never accumulates
// rounding, and the patches go out through one callback.

import { useRef } from 'react'
import type { MidiNote } from '@/lib/daw-types'
import { stretchNotes, warpNotes, type NotePatch } from '@/lib/pitch-time'

export function StretchMarkers({ notes, beatW, scrollLeft, snap, apply, onDone }: {
  /** The selected notes — two or more. */
  notes: MidiNote[]
  beatW: number
  scrollLeft: number
  /** Snap a beat to the grid, unless the drag is free (⌥). */
  snap: (beat: number, free: boolean) => number
  apply: (patches: NotePatch[]) => void
  onDone?: () => void
}) {
  const dragRef = useRef<{ orig: MidiNote[]; lo: number; hi: number } | null>(null)
  if (notes.length < 2) return null
  const lo = Math.min(...notes.map(n => n.startBeat))
  const hi = Math.max(...notes.map(n => n.startBeat + n.durationBeats))
  if (!(hi > lo)) return null
  const mid = (lo + hi) / 2
  const x = (b: number) => b * beatW - scrollLeft

  function begin(which: 'start' | 'mid' | 'end', e: React.MouseEvent) {
    e.preventDefault(); e.stopPropagation()
    const orig = notes.map(n => ({ ...n }))
    dragRef.current = { orig, lo, hi }
    const startX = e.clientX
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const dBeat = (ev.clientX - startX) / beatW
      if (which === 'end') {
        const newHi = snap(d.hi + dBeat, ev.altKey)
        if (Math.abs(newHi - d.lo) < 1e-6) return
        apply(stretchNotes(d.orig, (newHi - d.lo) / (d.hi - d.lo), d.lo))
      } else if (which === 'start') {
        const newLo = Math.max(0, snap(d.lo + dBeat, ev.altKey))
        if (Math.abs(d.hi - newLo) < 1e-6) return
        apply(stretchNotes(d.orig, (d.hi - newLo) / (d.hi - d.lo), d.hi))
      } else {
        const m0 = (d.lo + d.hi) / 2
        const newMid = snap(m0 + dBeat, ev.altKey)
        if (newMid <= d.lo + 1e-6 || newMid >= d.hi - 1e-6) return
        apply(warpNotes(d.orig, d.lo, m0, d.hi, newMid))
      }
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      dragRef.current = null
      onDone?.()
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handle = (which: 'start' | 'mid' | 'end', beat: number, title: string) => (
    <div key={which} data-help-id={`stretch-marker-${which}`} data-beat={beat} onMouseDown={e => begin(which, e)} title={title}
      style={{
        position: 'absolute', top: 0, left: x(beat) - 5, width: 10, height: 9, cursor: 'ew-resize', zIndex: 8,
        clipPath: 'polygon(0 0, 100% 0, 50% 100%)',
        background: which === 'mid' ? 'rgb(var(--accent-rgb) / 0.55)' : 'var(--accent-light)',
      }} />
  )

  return (
    <div data-help-id="stretch-markers" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 10, pointerEvents: 'none', zIndex: 8 }}>
      <div style={{ position: 'absolute', top: 3, left: x(lo), width: x(hi) - x(lo), height: 2, background: 'rgb(var(--accent-rgb) / 0.35)' }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }}>
        {handle('start', lo, 'Stretch marker — drag to stretch the selection from its end; past the other marker mirrors it')}
        {handle('mid', mid, 'Pseudo stretch marker — drag to warp the inside of the selection; the ends stay')}
        {handle('end', hi, 'Stretch marker — drag to stretch the selection from its start; past the other marker mirrors it')}
      </div>
    </div>
  )
}
