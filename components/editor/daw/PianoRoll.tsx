'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { X, ZoomIn, ZoomOut } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import type { MidiClip, MidiNote } from '@/lib/daw-types'
import { isMidiClip } from '@/lib/daw-types'

const NOTE_H     = 10
const PIANO_W    = 52
const TOOLBAR_H  = 32
const VELOCITY_H = 36
const NUM_NOTES  = 128

type Tool = 'draw' | 'select' | 'erase'
type Quant = 0.25 | 0.5 | 1 | 2

const QUANT_LABELS: Record<Quant, string> = { 0.25: '1/16', 0.5: '1/8', 1: '1/4', 2: '1/2' }

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function noteName(pitch: number) { return NOTE_NAMES[pitch % 12] }
function isBlack(pitch: number) { return [1, 3, 6, 8, 10].includes(pitch % 12) }
function octave(pitch: number) { return Math.floor(pitch / 12) - 1 }

// ── Piano keys ────────────────────────────────────────────────────────────────

function PianoKeys({ scrollTop, hoverPitch, onPlayNote, trackColor }: {
  scrollTop: number
  hoverPitch: number | null
  onPlayNote: (pitch: number) => void
  trackColor: string
}) {
  return (
    <div style={{ width: PIANO_W, flexShrink: 0, position: 'relative', overflow: 'hidden', background: '#1a1a1a' }}>
      <div style={{ position: 'absolute', top: -scrollTop, left: 0, right: 0 }}>
        {Array.from({ length: NUM_NOTES }, (_, i) => {
          const pitch = NUM_NOTES - 1 - i
          const black = isBlack(pitch)
          const isC   = pitch % 12 === 0
          const hover = hoverPitch === pitch
          return (
            <div
              key={pitch}
              onMouseDown={() => onPlayNote(pitch)}
              style={{
                height: NOTE_H, width: black ? '65%' : '100%',
                background: hover ? trackColor : black ? '#1a1a1a' : '#2e2e2e',
                borderBottom: '1px solid #111',
                borderRight: black ? 'none' : '1px solid #333',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                paddingRight: 2, cursor: 'pointer', userSelect: 'none',
                boxSizing: 'border-box', position: 'relative',
                zIndex: black ? 1 : 0,
              }}
            >
              {isC && (
                <span style={{ fontSize: 7, color: hover ? '#fff' : '#555', letterSpacing: '0.04em', paddingRight: 2 }}>
                  C{octave(pitch)}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Velocity bar ──────────────────────────────────────────────────────────────

function VelocityLane({ clip, beatW, scrollLeft, trackColor, onVelocityChange }: {
  clip: MidiClip
  beatW: number
  scrollLeft: number
  trackColor: string
  onVelocityChange: (noteId: string, velocity: number) => void
}) {
  function onMouseDown(e: React.MouseEvent, note: MidiNote) {
    const startY = e.clientY
    const startV = note.velocity
    function onMove(ev: MouseEvent) {
      const delta = (startY - ev.clientY) / 100
      onVelocityChange(note.id, Math.max(1, Math.min(127, Math.round(startV + delta * 127))))
    }
    function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div style={{ height: VELOCITY_H, background: '#111', borderTop: '1px solid var(--border)', position: 'relative', overflow: 'hidden' }}>
      {clip.notes.map(note => {
        const x = note.startBeat * beatW - scrollLeft
        const h = (note.velocity / 127) * (VELOCITY_H - 4)
        return (
          <div
            key={note.id}
            onMouseDown={e => onMouseDown(e, note)}
            style={{
              position: 'absolute',
              left: x, bottom: 2, width: Math.max(3, (note.durationBeats * beatW) - 2),
              height: h, background: trackColor, borderRadius: '1px 1px 0 0',
              cursor: 'ns-resize', opacity: 0.8,
            }}
            title={`Velocity: ${note.velocity}`}
          />
        )
      })}
    </div>
  )
}

// ── Piano Roll inner (receives guaranteed MidiClip) ───────────────────────────

function PianoRollInner({ clip }: { clip: MidiClip }) {
  const { project, dispatch, setEditTarget, engine } = useDaw()

  const track = project.tracks.find(t => t.id === clip.trackId)
  const color = track?.color ?? '#3d8fef'

  const [tool, setTool]   = useState<Tool>('draw')
  const [quant, setQuant] = useState<Quant>(0.25)
  const [beatW, setBeatW] = useState(80)
  const [scrollTop, setScrollTop]   = useState(NUM_NOTES / 2 * NOTE_H - 80)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set())
  const [hoverPitch, setHoverPitch] = useState<number | null>(null)

  const gridRef   = useRef<HTMLDivElement>(null)
  const selBoxRef = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null)
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  function snapBeat(b: number) { return Math.round(b / quant) * quant }

  function playNote(pitch: number) {
    if (!engine.ctx) return
    const osc = engine.ctx.createOscillator()
    const g   = engine.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12)
    g.gain.setValueAtTime(0.3, engine.ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, engine.ctx.currentTime + 0.5)
    osc.connect(g); g.connect(engine.masterGain)
    osc.start(); osc.stop(engine.ctx.currentTime + 0.5)
  }

  function handleGridMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const rect    = e.currentTarget.getBoundingClientRect()
    const rawBeat = (e.clientX - rect.left + scrollLeft) / beatW
    const rawPitch = NUM_NOTES - 1 - Math.floor((e.clientY - rect.top + scrollTop) / NOTE_H)

    if (rawPitch < 0 || rawPitch >= NUM_NOTES) return

    const beat  = snapBeat(rawBeat)
    const pitch = rawPitch

    if (tool === 'draw') {
      // Check if clicking an existing note
      const existing = clip.notes.find(n =>
        n.pitch === pitch &&
        n.startBeat <= rawBeat &&
        n.startBeat + n.durationBeats > rawBeat
      )
      if (existing) {
        // Drag to move
        const startX = e.clientX, startY = e.clientY
        const sb = existing.startBeat, sp = existing.pitch
        const existingId = existing.id
        function onMove(ev: MouseEvent) {
          const db = (ev.clientX - startX) / beatW
          const dp = -Math.round((ev.clientY - startY) / NOTE_H)
          dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: existingId, patch: {
            startBeat: Math.max(0, snapBeat(sb + db)),
            pitch: Math.max(0, Math.min(127, sp + dp)),
          }})
        }
        function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
        document.addEventListener('mousemove', onMove)
        document.addEventListener('mouseup', onUp)
        return
      }

      // Create new note with drag to set duration
      const note: MidiNote = { id: crypto.randomUUID(), pitch, startBeat: beat, durationBeats: quant, velocity: 100 }
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note })
      playNote(pitch)

      const startX = e.clientX
      const noteId = note.id
      function onMove(ev: MouseEvent) {
        const delta = (ev.clientX - startX) / beatW
        const dur   = Math.max(quant, snapBeat(quant + delta))
        dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId, patch: { durationBeats: dur } })
      }
      function onUp() { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }

    if (tool === 'erase') {
      const target = clip.notes.find(n =>
        n.pitch === pitch && n.startBeat <= rawBeat && n.startBeat + n.durationBeats > rawBeat
      )
      if (target) dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: target.id })
    }

    if (tool === 'select') {
      selBoxRef.current = { startX: e.clientX - rect.left, startY: e.clientY - rect.top, endX: e.clientX - rect.left, endY: e.clientY - rect.top }
      setSelRect({ x: selBoxRef.current.startX, y: selBoxRef.current.startY, w: 0, h: 0 })

      function onMove(ev: MouseEvent) {
        if (!selBoxRef.current) return
        selBoxRef.current.endX = ev.clientX - rect.left
        selBoxRef.current.endY = ev.clientY - rect.top
        const x = Math.min(selBoxRef.current.startX, selBoxRef.current.endX)
        const y = Math.min(selBoxRef.current.startY, selBoxRef.current.endY)
        const w = Math.abs(selBoxRef.current.endX - selBoxRef.current.startX)
        const h = Math.abs(selBoxRef.current.endY - selBoxRef.current.startY)
        setSelRect({ x, y, w, h })
      }
      function onUp() {
        if (!selBoxRef.current) return
        const x1 = (Math.min(selBoxRef.current.startX, selBoxRef.current.endX) + scrollLeft) / beatW
        const x2 = (Math.max(selBoxRef.current.startX, selBoxRef.current.endX) + scrollLeft) / beatW
        const p1 = NUM_NOTES - 1 - Math.floor((Math.min(selBoxRef.current.startY, selBoxRef.current.endY) + scrollTop) / NOTE_H)
        const p2 = NUM_NOTES - 1 - Math.floor((Math.max(selBoxRef.current.startY, selBoxRef.current.endY) + scrollTop) / NOTE_H)
        const selected = new Set(clip.notes
          .filter(n => n.startBeat >= x1 && n.startBeat < x2 && n.pitch >= p2 && n.pitch <= p1)
          .map(n => n.id)
        )
        setSelectedNotes(selected)
        selBoxRef.current = null
        setSelRect(null)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }
  }

  function handleGridMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect  = e.currentTarget.getBoundingClientRect()
    const pitch = NUM_NOTES - 1 - Math.floor((e.clientY - rect.top + scrollTop) / NOTE_H)
    setHoverPitch(pitch >= 0 && pitch < NUM_NOTES ? pitch : null)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (tool === 'select') {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        for (const noteId of selectedNotes) {
          dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId })
        }
        setSelectedNotes(new Set())
        e.preventDefault()
      }
      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        setSelectedNotes(new Set(clip.notes.map(n => n.id)))
        e.preventDefault()
      }
    }
  }

  const totalW = clip.durationBeats * beatW + 80

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-surface)', outline: 'none' }}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      {/* Toolbar */}
      <div style={{
        height: TOOLBAR_H, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px',
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        <button onClick={() => setEditTarget(null)} style={{ ...prBtn, width: 22, height: 22 }} title="Close piano roll"><X size={12} /></button>
        <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 2, marginRight: 4 }}>{clip.name}</span>

        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        {(['draw', 'select', 'erase'] as Tool[]).map(t => (
          <button key={t} onClick={() => setTool(t)}
            style={{ ...prBtn, background: tool === t ? 'var(--bg-surface)' : 'transparent', color: tool === t ? 'var(--text-primary)' : 'var(--text-muted)', border: tool === t ? '1px solid var(--border)' : '1px solid transparent', fontSize: 9, padding: '2px 6px' }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}

        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        {(Object.entries(QUANT_LABELS) as [string, string][]).map(([q, label]) => (
          <button key={q} onClick={() => setQuant(Number(q) as Quant)}
            style={{ ...prBtn, background: quant === Number(q) ? 'var(--bg-surface)' : 'transparent', color: quant === Number(q) ? 'var(--text-primary)' : 'var(--text-muted)', border: quant === Number(q) ? '1px solid var(--border)' : '1px solid transparent', fontSize: 9, padding: '2px 5px' }}>
            {label}
          </button>
        ))}

        <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
        <button onClick={() => setBeatW(w => Math.min(200, w * 1.3))} style={prBtn} title="Zoom in"><ZoomIn size={12} /></button>
        <button onClick={() => setBeatW(w => Math.max(20, w * 0.77))} style={prBtn} title="Zoom out"><ZoomOut size={12} /></button>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Piano keys */}
        <PianoKeys scrollTop={scrollTop} hoverPitch={hoverPitch} onPlayNote={playNote} trackColor={color} />

        {/* Note grid + velocity */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Note grid */}
          <div
            ref={gridRef}
            style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: tool === 'draw' ? 'crosshair' : tool === 'erase' ? 'cell' : 'default' }}
            onMouseDown={handleGridMouseDown}
            onMouseMove={handleGridMouseMove}
            onMouseLeave={() => setHoverPitch(null)}
            onWheel={e => {
              if (e.ctrlKey || e.metaKey) { setBeatW(w => Math.max(20, Math.min(200, w * (e.deltaY < 0 ? 1.15 : 0.87)))); e.preventDefault() }
              else { setScrollTop(s => Math.max(0, s + e.deltaY * 0.5)); setScrollLeft(sl => Math.max(0, sl + e.deltaX)) }
            }}
          >
            {/* Background rows */}
            <div style={{ position: 'absolute', top: -scrollTop, left: 0, width: totalW }}>
              {Array.from({ length: NUM_NOTES }, (_, i) => {
                const pitch = NUM_NOTES - 1 - i
                const black = isBlack(pitch)
                const hover = hoverPitch === pitch
                return (
                  <div key={pitch} style={{
                    height: NOTE_H, background: hover ? `${color}20` : black ? '#1a1a1a' : '#1e1e1e',
                    borderBottom: pitch % 12 === 0 ? '1px solid #333' : '1px solid #202020',
                    boxSizing: 'border-box',
                  }} />
                )
              })}
            </div>

            {/* Vertical beat grid lines */}
            <div style={{ position: 'absolute', top: 0, left: -scrollLeft, bottom: 0, width: totalW }}>
              {Array.from({ length: Math.ceil(totalW / beatW) + 1 }, (_, i) => (
                <div key={i} style={{
                  position: 'absolute', left: i * beatW, top: 0, bottom: 0, width: 1,
                  background: i % 4 === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
                }} />
              ))}
            </div>

            {/* Notes */}
            <div style={{ position: 'absolute', top: -scrollTop, left: -scrollLeft }}>
              {clip.notes.map(note => {
                const x = note.startBeat * beatW
                const y = (NUM_NOTES - 1 - note.pitch) * NOTE_H
                const w = Math.max(4, note.durationBeats * beatW - 1)
                const sel = selectedNotes.has(note.id)
                return (
                  <div key={note.id} style={{
                    position: 'absolute', left: x, top: y + 1,
                    width: w, height: NOTE_H - 2,
                    background: color,
                    border: sel ? '1px solid #fff' : `1px solid ${color}cc`,
                    borderRadius: 2, boxSizing: 'border-box',
                    opacity: 0.9,
                  }} />
                )
              })}
            </div>

            {/* Selection rectangle */}
            {selRect && (
              <div style={{
                position: 'absolute',
                left: selRect.x, top: selRect.y, width: selRect.w, height: selRect.h,
                border: '1px solid var(--accent)', background: 'rgba(61,143,239,0.1)',
                pointerEvents: 'none',
              }} />
            )}
          </div>

          {/* Velocity lane */}
          <VelocityLane
            clip={clip}
            beatW={beatW}
            scrollLeft={scrollLeft}
            trackColor={color}
            onVelocityChange={(noteId, velocity) => dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId, patch: { velocity } })}
          />
        </div>
      </div>
    </div>
  )
}

// ── Outer guard ───────────────────────────────────────────────────────────────

export default function PianoRoll() {
  const { project, editTarget } = useDaw()
  const clip = editTarget?.type === 'midi-clip'
    ? (project.arrangementClips.find(c => c.id === editTarget.clipId) ?? null)
    : null
  if (!clip || !isMidiClip(clip)) return null
  return <PianoRollInner clip={clip} />
}

const prBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: 22, borderRadius: 3, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
  padding: '0 4px',
}
