'use client'
import { useState, useRef, useEffect, useCallback } from 'react'
import type { BeatHit, BeatType } from '@/lib/beat-analyzer'

// ── Constants ─────────────────────────────────────────────────────────────────

const NOTE_MIN = 36
const NOTE_MAX = 84
const KEY_H = 12          // px per semitone row
const PIANO_W = 48        // px for the piano keyboard column
const VEL_H = 80          // px for velocity lane
const HEADER_H = 44       // px for header bar
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]) // semitone % 12 that are black keys
const TOTAL_NOTES = 128   // MIDI 0–127

const CHORD_INTERVALS: Record<string, number[]> = {
  Major: [0, 4, 7],
  Minor: [0, 3, 7],
  Dom7:  [0, 4, 7, 10],
  Maj7:  [0, 4, 7, 11],
  Min7:  [0, 3, 7, 10],
  Sus2:  [0, 2, 7],
  Sus4:  [0, 5, 7],
}

const CHORD_TYPES = Object.keys(CHORD_INTERVALS)

const TYPE_LABELS: Record<BeatType, string> = {
  kick: 'Kick', snare: 'Snare', hihat: 'Hi-Hat', 'open-hihat': 'Open HH',
  clap: 'Clap', tom: 'Tom', crash: 'Crash', rim: 'Rim',
  'guitar-acoustic': 'Acoustic Guitar', 'guitar-electric': 'Electric Guitar', 'guitar-nylon': 'Nylon Guitar',
  'piano-grand': 'Grand Piano', 'piano-electric': 'Electric Piano', 'piano-rhodes': 'Rhodes',
  'synth-lead': 'Synth Lead', 'synth-pad': 'Synth Pad', 'synth-bass': 'Synth Bass', 'synth-arp': 'Arp',
  other: 'Other',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function midiName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`
}

function snapTime(t: number, bpm: number, subdivisions: number): number {
  const interval = (60 / bpm) / subdivisions
  return Math.round(t / interval) * interval
}

function snapInterval(bpm: number, subdivisions: number): number {
  return (60 / bpm) / subdivisions
}

function newId(): string {
  return Math.random().toString(36).slice(2)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PianoRollProps {
  laneType: BeatType
  laneColor: string
  hits: BeatHit[]
  duration: number
  bpm: number
  onClose: () => void
  onHitsChange: (hits: BeatHit[]) => void
}

type SnapDiv = 4 | 8 | 16 | 32

type DragState =
  | { kind: 'none' }
  | { kind: 'create'; id: string; startX: number; startTime: number; note: number }
  | { kind: 'move'; ids: string[]; startX: number; startY: number; origTimes: number[]; origNotes: number[] }
  | { kind: 'resize'; id: string; startX: number; origDuration: number }
  | { kind: 'select-box'; startX: number; startY: number; curX: number; curY: number }
  | { kind: 'velocity'; id: string; startY: number; origVelocity: number }

// ── Component ─────────────────────────────────────────────────────────────────

export default function PianoRoll({
  laneType, laneColor, hits, duration, bpm, onClose, onHitsChange,
}: PianoRollProps) {
  const [notes, setNotes] = useState<BeatHit[]>(hits)
  const [zoom, setZoom] = useState(1.0)
  const [snapDiv, setSnapDiv] = useState<SnapDiv>(16)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [chordMode, setChordMode] = useState(false)
  const [chordType, setChordType] = useState('Major')

  // drag state stored in ref to avoid stale closures
  const drag = useRef<DragState>({ kind: 'none' })
  const gridRef = useRef<HTMLDivElement>(null)
  const pianoRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const pxPerSec = 120 * zoom
  const totalW = Math.max(duration * pxPerSec + 200, 800)
  const totalH = TOTAL_NOTES * KEY_H

  // sync notes → parent
  const commit = useCallback((next: BeatHit[]) => {
    setNotes(next)
    onHitsChange(next)
  }, [onHitsChange])

  // scroll grid and piano in sync
  const onGridScroll = useCallback(() => {
    if (gridRef.current && pianoRef.current) {
      pianoRef.current.scrollTop = gridRef.current.scrollTop
    }
  }, [])

  // scroll to NOTE_MIN–NOTE_MAX range on mount
  useEffect(() => {
    const el = gridRef.current
    if (!el) return
    const midNote = (NOTE_MIN + NOTE_MAX) / 2
    const targetY = (TOTAL_NOTES - 1 - midNote) * KEY_H - el.clientHeight / 2
    el.scrollTop = Math.max(0, targetY)
  }, [])

  // Ctrl+scroll = zoom
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        setZoom(z => clamp(z * (e.deltaY < 0 ? 1.15 : 0.87), 0.25, 4))
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedIds.size > 0) {
          commit(notes.filter(n => !selectedIds.has(n.id)))
          setSelectedIds(new Set())
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        e.preventDefault()
        setSelectedIds(new Set(notes.map(n => n.id)))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [notes, selectedIds, commit])

  // ── Grid coordinate helpers ────────────────────────────────────────────────

  function xToTime(x: number): number {
    return x / pxPerSec
  }

  function yToNote(y: number): number {
    // y=0 is top = MIDI 127
    return clamp(TOTAL_NOTES - 1 - Math.floor(y / KEY_H), 0, 127)
  }

  function timeToX(t: number): number {
    return t * pxPerSec
  }

  function noteToY(note: number): number {
    return (TOTAL_NOTES - 1 - note) * KEY_H
  }

  function getGridXY(e: React.MouseEvent): { x: number; y: number } {
    const el = gridRef.current
    if (!el) return { x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    return {
      x: e.clientX - rect.left + el.scrollLeft,
      y: e.clientY - rect.top + el.scrollTop,
    }
  }

  // ── Hit detection ──────────────────────────────────────────────────────────

  function hitAtXY(x: number, y: number): { hit: BeatHit; edge: boolean } | null {
    const note = yToNote(y)
    const time = xToTime(x)
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i]
      const dur = n.duration ?? 0.125
      const nx = timeToX(n.time)
      const nw = dur * pxPerSec
      const ny = noteToY(n.note)
      if (
        n.note === note &&
        time >= n.time - 0.001 &&
        time <= n.time + dur + 0.001 &&
        x >= nx && x <= nx + nw &&
        y >= ny && y < ny + KEY_H
      ) {
        const edge = x >= nx + nw - 6
        return { hit: n, edge }
      }
    }
    return null
  }

  // ── Mouse handlers ─────────────────────────────────────────────────────────

  const onGridMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) return // context menu handles right-click
    e.preventDefault()
    const { x, y } = getGridXY(e)
    const time = xToTime(x)
    const note = yToNote(y)
    const hit = hitAtXY(x, y)
    const snapDur = snapInterval(bpm, snapDiv)
    const snappedTime = snapTime(time, bpm, snapDiv)

    if (selectionMode || e.shiftKey) {
      // selection box or toggle
      if (hit) {
        setSelectedIds(prev => {
          const next = new Set(prev)
          if (next.has(hit.hit.id)) next.delete(hit.hit.id)
          else next.add(hit.hit.id)
          return next
        })
      } else {
        drag.current = { kind: 'select-box', startX: x, startY: y, curX: x, curY: y }
        setSelectedIds(new Set())
      }
      return
    }

    if (hit) {
      if (hit.edge) {
        // resize
        drag.current = { kind: 'resize', id: hit.hit.id, startX: x, origDuration: hit.hit.duration ?? 0.125 }
      } else {
        // move (or multi-move if selected)
        const moveIds = selectedIds.has(hit.hit.id) && selectedIds.size > 1
          ? Array.from(selectedIds)
          : [hit.hit.id]
        const moveNotes = moveIds.map(id => notes.find(n => n.id === id)!)
        drag.current = {
          kind: 'move',
          ids: moveIds,
          startX: x,
          startY: y,
          origTimes: moveNotes.map(n => n.time),
          origNotes: moveNotes.map(n => n.note),
        }
        if (!selectedIds.has(hit.hit.id)) setSelectedIds(new Set([hit.hit.id]))
      }
    } else {
      // create
      if (chordMode) {
        const intervals = CHORD_INTERVALS[chordType] ?? [0, 4, 7]
        const newHits: BeatHit[] = intervals.map(interval => ({
          id: newId(),
          time: snappedTime,
          type: laneType,
          velocity: 0.8,
          note: clamp(note + interval, 0, 127),
          duration: snapDur,
        }))
        commit([...notes, ...newHits])
      } else {
        const id = newId()
        const newNote: BeatHit = {
          id,
          time: snappedTime,
          type: laneType,
          velocity: 0.8,
          note,
          duration: snapDur,
        }
        drag.current = { kind: 'create', id, startX: x, startTime: snappedTime, note }
        commit([...notes, newNote])
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, zoom, bpm, snapDiv, selectionMode, selectedIds, chordMode, chordType, laneType, commit])

  const onGridMouseMove = useCallback((e: React.MouseEvent) => {
    const d = drag.current
    if (d.kind === 'none') return
    e.preventDefault()
    const { x, y } = getGridXY(e)

    if (d.kind === 'create') {
      const startT = d.startTime
      const endT = snapTime(xToTime(x), bpm, snapDiv)
      const dur = Math.max(snapInterval(bpm, snapDiv), endT - startT)
      setNotes(prev => prev.map(n => n.id === d.id ? { ...n, duration: dur } : n))
    } else if (d.kind === 'move') {
      const dx = x - d.startX
      const dy = y - d.startY
      const dt = dx / pxPerSec
      const dNote = -Math.round(dy / KEY_H)
      setNotes(prev => prev.map(n => {
        const idx = d.ids.indexOf(n.id)
        if (idx === -1) return n
        const rawTime = d.origTimes[idx] + dt
        return {
          ...n,
          time: Math.max(0, snapTime(rawTime, bpm, snapDiv)),
          note: clamp(d.origNotes[idx] + dNote, 0, 127),
        }
      }))
    } else if (d.kind === 'resize') {
      const dx = x - d.startX
      const dur = Math.max(snapInterval(bpm, snapDiv), d.origDuration + dx / pxPerSec)
      setNotes(prev => prev.map(n => n.id === d.id ? { ...n, duration: snapTime(dur, bpm, snapDiv) } : n))
    } else if (d.kind === 'select-box') {
      drag.current = { ...d, curX: x, curY: y }
      // select notes within box
      const x0 = Math.min(d.startX, x), x1 = Math.max(d.startX, x)
      const y0 = Math.min(d.startY, y), y1 = Math.max(d.startY, y)
      const inBox = notes.filter(n => {
        const nx = timeToX(n.time)
        const ny = noteToY(n.note)
        return nx >= x0 && nx + (n.duration ?? 0.125) * pxPerSec <= x1 && ny >= y0 && ny + KEY_H <= y1
      })
      setSelectedIds(new Set(inBox.map(n => n.id)))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, zoom, bpm, snapDiv, pxPerSec])

  const onGridMouseUp = useCallback((e: React.MouseEvent) => {
    const d = drag.current
    drag.current = { kind: 'none' }
    if (d.kind === 'create' || d.kind === 'move' || d.kind === 'resize') {
      // commit final state
      setNotes(prev => {
        onHitsChange(prev)
        return prev
      })
    }
  }, [onHitsChange])

  const onGridContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const { x, y } = getGridXY(e)
    const hit = hitAtXY(x, y)
    if (hit) {
      commit(notes.filter(n => n.id !== hit.hit.id))
      setSelectedIds(prev => { const s = new Set(prev); s.delete(hit.hit.id); return s })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, zoom, commit])

  // ── Velocity drag ──────────────────────────────────────────────────────────

  const velRef = useRef<HTMLDivElement>(null)

  const onVelMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault()
    e.stopPropagation()
    const hit = notes.find(n => n.id === id)
    if (!hit) return
    drag.current = { kind: 'velocity', id, startY: e.clientY, origVelocity: hit.velocity }
  }, [notes])

  const onVelMouseMove = useCallback((e: MouseEvent) => {
    const d = drag.current
    if (d.kind !== 'velocity') return
    const dy = d.startY - e.clientY
    const newVel = clamp(d.origVelocity + dy / 72, 0, 1)
    setNotes(prev => prev.map(n => n.id === d.id ? { ...n, velocity: newVel } : n))
  }, [])

  const onVelMouseUp = useCallback(() => {
    if (drag.current.kind === 'velocity') {
      drag.current = { kind: 'none' }
      setNotes(prev => { onHitsChange(prev); return prev })
    }
  }, [onHitsChange])

  useEffect(() => {
    window.addEventListener('mousemove', onVelMouseMove)
    window.addEventListener('mouseup', onVelMouseUp)
    return () => {
      window.removeEventListener('mousemove', onVelMouseMove)
      window.removeEventListener('mouseup', onVelMouseUp)
    }
  }, [onVelMouseMove, onVelMouseUp])

  // ── Render grid lines ──────────────────────────────────────────────────────

  function renderGridLines() {
    const lines: React.ReactNode[] = []
    const beatSec = 60 / bpm
    const subSec = beatSec / snapDiv * 4 // smallest unit = 1 subdivision
    // vertical lines
    let t = 0
    let i = 0
    while (t <= duration + 0.001) {
      const x = timeToX(t)
      const isBar = i % (snapDiv) === 0
      const isBeat = i % (snapDiv / 4) === 0
      lines.push(
        <line
          key={`v${i}`}
          x1={x} y1={0} x2={x} y2={totalH}
          stroke={isBar ? 'rgba(255,255,255,0.18)' : isBeat ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.04)'}
          strokeWidth={isBar ? 1.5 : 1}
        />
      )
      t = Math.round((t + subSec) * 10000) / 10000
      i++
    }
    // horizontal lines
    for (let note = 0; note <= 127; note++) {
      const y = noteToY(note)
      const isC = note % 12 === 0
      const isOctaveBoundary = isC
      lines.push(
        <line
          key={`h${note}`}
          x1={0} y1={y} x2={totalW} y2={y}
          stroke={isOctaveBoundary ? 'rgba(255,255,255,0.14)' : 'rgba(255,255,255,0.04)'}
          strokeWidth={isOctaveBoundary ? 1 : 0.5}
        />
      )
    }
    return lines
  }

  // ── Render notes ───────────────────────────────────────────────────────────

  function renderNotes() {
    return notes.map(n => {
      const x = timeToX(n.time)
      const y = noteToY(n.note)
      const w = Math.max(4, (n.duration ?? 0.125) * pxPerSec)
      const isSelected = selectedIds.has(n.id)
      return (
        <g key={n.id}>
          <rect
            x={x + 1}
            y={y + 1}
            width={Math.max(2, w - 2)}
            height={KEY_H - 2}
            rx={2}
            fill={laneColor}
            fillOpacity={isSelected ? 1 : 0.85}
            stroke={isSelected ? '#fff' : laneColor}
            strokeWidth={isSelected ? 1.5 : 0.5}
            strokeOpacity={isSelected ? 0.9 : 0.6}
          />
        </g>
      )
    })
  }

  // selection box overlay
  const selBox = drag.current.kind === 'select-box' ? drag.current : null

  // ── Piano keyboard ─────────────────────────────────────────────────────────

  function renderPianoKeys() {
    const keys: React.ReactNode[] = []
    for (let note = 127; note >= 0; note--) {
      const semitone = note % 12
      const isBlack = BLACK_KEYS.has(semitone)
      const y = noteToY(note)
      const isC = semitone === 0
      keys.push(
        <div
          key={note}
          style={{
            position: 'absolute',
            top: y,
            left: 0,
            width: PIANO_W,
            height: KEY_H,
            background: isBlack ? '#1a1a2e' : '#e8e8f0',
            borderBottom: isBlack ? '1px solid #0d0d1a' : '1px solid #ccc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            paddingRight: 4,
            boxSizing: 'border-box',
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          {isC && (
            <span style={{
              fontSize: 9,
              color: '#666',
              fontFamily: 'monospace',
              lineHeight: 1,
            }}>
              {midiName(note)}
            </span>
          )}
        </div>
      )
    }
    return keys
  }

  // ── Velocity lane ──────────────────────────────────────────────────────────

  function renderVelocityBars() {
    const gridScroll = gridRef.current?.scrollLeft ?? 0
    return notes.map(n => {
      const x = timeToX(n.time) - gridScroll
      if (x < -10 || x > (gridRef.current?.clientWidth ?? 9999) + 10) return null
      const barH = Math.max(2, n.velocity * 72)
      return (
        <div
          key={n.id}
          onMouseDown={e => onVelMouseDown(e, n.id)}
          style={{
            position: 'absolute',
            left: PIANO_W + x,
            bottom: 0,
            width: Math.max(4, (n.duration ?? 0.125) * pxPerSec - 2),
            height: barH,
            background: laneColor,
            opacity: 0.85,
            borderRadius: '2px 2px 0 0',
            cursor: 'ns-resize',
          }}
        />
      )
    })
  }

  const laneLabel = TYPE_LABELS[laneType] ?? laneType

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 500,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-surface, #0f0f17)',
        color: 'var(--text-primary, #e2e8f0)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* ── Header ── */}
      <div style={{
        height: HEADER_H,
        minHeight: HEADER_H,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '0 16px',
        borderBottom: '1px solid var(--border, rgba(255,255,255,0.1))',
        background: 'var(--bg-card, #161624)',
        flexShrink: 0,
        flexWrap: 'nowrap',
        overflow: 'hidden',
      }}>
        {/* Lane name */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <div style={{ width: 10, height: 10, borderRadius: '50%', background: laneColor, flexShrink: 0 }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary, #e2e8f0)', whiteSpace: 'nowrap' }}>
            {laneLabel}
          </span>
          <span style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', whiteSpace: 'nowrap' }}>
            Piano Roll
          </span>
        </div>

        <div style={{ flex: 1 }} />

        {/* Zoom controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <HeaderBtn onClick={() => setZoom(z => clamp(z * 0.8, 0.25, 4))}>−</HeaderBtn>
          <span style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', minWidth: 38, textAlign: 'center' }}>
            {Math.round(zoom * 100)}%
          </span>
          <HeaderBtn onClick={() => setZoom(z => clamp(z * 1.25, 0.25, 4))}>+</HeaderBtn>
        </div>

        {/* Snap */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {([4, 8, 16, 32] as SnapDiv[]).map(d => (
            <HeaderBtn
              key={d}
              onClick={() => setSnapDiv(d)}
              active={snapDiv === d}
            >
              1/{d}
            </HeaderBtn>
          ))}
        </div>

        {/* Selection mode */}
        <HeaderBtn onClick={() => setSelectionMode(s => !s)} active={selectionMode}>
          ✦ Select
        </HeaderBtn>

        {/* Chord mode */}
        <HeaderBtn
          onClick={() => setChordMode(c => !c)}
          active={chordMode}
          activeColor="#d97706"
        >
          Chord
        </HeaderBtn>

        {chordMode && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {CHORD_TYPES.map(ct => (
              <HeaderBtn
                key={ct}
                onClick={() => setChordType(ct)}
                active={chordType === ct}
                activeColor="#d97706"
              >
                {ct}
              </HeaderBtn>
            ))}
          </div>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-muted, #64748b)',
            fontSize: 18,
            cursor: 'pointer',
            padding: '2px 6px',
            borderRadius: 4,
            lineHeight: 1,
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Main editing area ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
          {/* Piano keyboard column */}
          <div
            ref={pianoRef}
            style={{
              width: PIANO_W,
              flexShrink: 0,
              overflowY: 'hidden',
              position: 'relative',
              background: 'var(--bg-card, #161624)',
              borderRight: '1px solid var(--border, rgba(255,255,255,0.1))',
            }}
          >
            <div style={{ position: 'relative', height: totalH }}>
              {renderPianoKeys()}
            </div>
          </div>

          {/* Scrollable grid */}
          <div
            ref={gridRef}
            onScroll={onGridScroll}
            onMouseDown={onGridMouseDown}
            onMouseMove={onGridMouseMove}
            onMouseUp={onGridMouseUp}
            onContextMenu={onGridContextMenu}
            style={{
              flex: 1,
              overflow: 'auto',
              position: 'relative',
              cursor: selectionMode ? 'crosshair' : 'crosshair',
              userSelect: 'none',
            }}
          >
            <div style={{ position: 'relative', width: totalW, height: totalH }}>
              {/* Background stripes for black keys */}
              {Array.from({ length: TOTAL_NOTES }, (_, i) => {
                const note = 127 - i
                const isBlack = BLACK_KEYS.has(note % 12)
                if (!isBlack) return null
                return (
                  <div
                    key={note}
                    style={{
                      position: 'absolute',
                      top: noteToY(note),
                      left: 0,
                      width: '100%',
                      height: KEY_H,
                      background: 'rgba(0,0,0,0.25)',
                      pointerEvents: 'none',
                    }}
                  />
                )
              })}

              {/* SVG grid lines + notes */}
              <svg
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
                width={totalW}
                height={totalH}
              >
                {renderGridLines()}
                {renderNotes()}
                {selBox && (
                  <rect
                    x={Math.min(selBox.startX, selBox.curX)}
                    y={Math.min(selBox.startY, selBox.curY)}
                    width={Math.abs(selBox.curX - selBox.startX)}
                    height={Math.abs(selBox.curY - selBox.startY)}
                    fill="rgba(99,102,241,0.15)"
                    stroke="rgba(99,102,241,0.7)"
                    strokeWidth={1}
                  />
                )}
              </svg>
            </div>
          </div>
        </div>

        {/* ── Velocity lane ── */}
        <div
          ref={velRef}
          style={{
            height: VEL_H,
            flexShrink: 0,
            position: 'relative',
            borderTop: '1px solid var(--border, rgba(255,255,255,0.1))',
            background: 'var(--bg-card, #161624)',
            overflow: 'hidden',
          }}
        >
          <span style={{
            position: 'absolute',
            top: 4,
            left: PIANO_W + 4,
            fontSize: 9,
            color: 'var(--text-muted, #64748b)',
            textTransform: 'uppercase',
            letterSpacing: 1,
            pointerEvents: 'none',
          }}>
            Velocity
          </span>
          {/* velocity lane left spacer */}
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: PIANO_W,
            height: '100%',
            background: 'var(--bg-card, #161624)',
            borderRight: '1px solid var(--border, rgba(255,255,255,0.1))',
          }} />
          {renderVelocityBars()}
        </div>
      </div>
    </div>
  )
}

// ── Small UI primitive ─────────────────────────────────────────────────────────

function HeaderBtn({
  children,
  onClick,
  active,
  activeColor,
}: {
  children: React.ReactNode
  onClick: () => void
  active?: boolean
  activeColor?: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? (activeColor ?? 'var(--accent-subtle, rgba(99,102,241,0.25))') : 'rgba(255,255,255,0.05)',
        border: `1px solid ${active ? (activeColor ?? 'rgba(99,102,241,0.5)') : 'var(--border, rgba(255,255,255,0.1))'}`,
        color: active ? (activeColor ? '#fcd34d' : 'var(--text-primary, #e2e8f0)') : 'var(--text-secondary, #94a3b8)',
        fontSize: 11,
        fontWeight: active ? 600 : 400,
        cursor: 'pointer',
        padding: '3px 8px',
        borderRadius: 4,
        whiteSpace: 'nowrap',
        lineHeight: 1.4,
      }}
    >
      {children}
    </button>
  )
}
