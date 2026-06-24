'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useDaw, makeMidiClip } from '@/lib/daw-state'
import { playInstrumentNote } from '@/lib/daw-instruments'
import { libraryGetAll } from '@/lib/sound-library'
import type { LibraryEntry } from '@/lib/sound-library'
import type { MidiClip, MidiNote } from '@/lib/daw-types'
import { isMidiClip } from '@/lib/daw-types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Pad {
  id: string
  pitch: number
  drumLabel: string
  key: string              // keyboard shortcut (lowercase), '' = unassigned
  customSoundId?: string   // Library entry ID — replaces synthesis when set
  customSoundName?: string // Display name for the assigned sound
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_PADS: Pad[] = [
  { id: 'p1', pitch: 36, drumLabel: 'Kick',     key: 'a' },
  { id: 'p2', pitch: 38, drumLabel: 'Snare',    key: 's' },
  { id: 'p3', pitch: 42, drumLabel: 'Hi-Hat',   key: 'd' },
  { id: 'p4', pitch: 46, drumLabel: 'Open Hat', key: 'f' },
  { id: 'p5', pitch: 39, drumLabel: 'Clap',     key: 'z' },
  { id: 'p6', pitch: 51, drumLabel: 'Rim',      key: 'x' },
  { id: 'p7', pitch: 49, drumLabel: 'Crash',    key: 'c' },
  { id: 'p8', pitch: 45, drumLabel: 'Tom',      key: 'v' },
]

function buildPianoKeyMap(baseOctave: number): Record<string, number> {
  const b = (baseOctave + 1) * 12
  return {
    z: b,    s: b+1,  x: b+2,  d: b+3,  c: b+4,
    v: b+5,  g: b+6,  b: b+7,  h: b+8,  n: b+9,
    j: b+10, m: b+11,
    q: b+12, 2: b+13, w: b+14, 3: b+15, e: b+16,
    r: b+17, 5: b+18, t: b+19, 6: b+20, y: b+21,
    7: b+22, u: b+23,
  }
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function pitchToName(p: number) { return `${NOTE_NAMES[p % 12]}${Math.floor(p / 12) - 1}` }

const WHITE_ST  = [0, 2, 4, 5, 7, 9, 11]
const BLACK_KEYS = [
  { st: 1, pos: 0.65 }, { st: 3, pos: 1.65 },
  { st: 6, pos: 3.65 }, { st: 8, pos: 4.65 }, { st: 10, pos: 5.65 },
]

const C = {
  bg:     '#1c1c1c',
  bgCard: '#252525',
  bgDark: '#151515',
  border: '#333333',
  accent: '#3d8fef',
  red:    '#ef4444',
  text:   '#e8e8e8',
  muted:  '#7c7c7c',
} as const

// ── Pad context-menu popover ───────────────────────────────────────────────────

function PadPopover({ pad, anchor, onRemap, onAssignSound, onClearSound, onClose }: {
  pad: Pad
  anchor: { x: number; y: number }
  onRemap: () => void
  onAssignSound: (entry: LibraryEntry) => void
  onClearSound: () => void
  onClose: () => void
}) {
  const [entries,     setEntries]     = useState<LibraryEntry[]>([])
  const [loading,     setLoading]     = useState(true)
  const [showLibrary, setShowLibrary] = useState(false)
  const [search,      setSearch]      = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    libraryGetAll().then(e => { setEntries(e); setLoading(false) })
  }, [])

  // Close on click-outside
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const filtered = entries.filter(e => e.name.toLowerCase().includes(search.toLowerCase()))

  // Position: keep within viewport
  const left = Math.min(anchor.x, window.innerWidth  - 280)
  const top  = Math.min(anchor.y, window.innerHeight - 400)

  return createPortal(
    <div
      ref={ref}
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', left, top, width: 260, zIndex: 3000,
        background: C.bgCard, border: `1px solid ${C.accent}`,
        borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 10px', background: 'rgba(61,143,239,0.12)', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: C.text, flex: 1 }}>{pad.drumLabel}</span>
        <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {/* Key section */}
      <div style={{ padding: '10px 10px 8px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Key</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
          <span style={{
            fontSize: 14, fontWeight: 800, fontFamily: 'monospace',
            width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: C.bgDark, border: `1px solid ${C.border}`, borderRadius: 4, color: pad.key ? C.text : C.muted,
          }}>{pad.key ? pad.key.toUpperCase() : '–'}</span>
          <button
            onClick={() => { onRemap(); onClose() }}
            style={{ fontSize: 11, padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.text, cursor: 'pointer' }}
          >{pad.key ? 'Remap Key' : 'Assign Key'}</button>
        </div>
      </div>

      {/* Sound section */}
      <div style={{ padding: '10px 10px 8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sound</span>
          {pad.customSoundId && (
            <button onClick={onClearSound} style={{ fontSize: 10, padding: '1px 6px', borderRadius: 3, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}>Clear</button>
          )}
        </div>

        {/* Current sound indicator */}
        <div style={{ fontSize: 11, color: pad.customSoundId ? C.accent : C.muted, marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {pad.customSoundId ? `✓ ${pad.customSoundName ?? 'Custom sound'}` : 'Instrument default'}
        </div>

        {/* Library toggle */}
        <button
          onClick={() => setShowLibrary(v => !v)}
          style={{ width: '100%', fontSize: 11, padding: '5px 0', borderRadius: 4, border: `1px solid ${C.accent}`, background: showLibrary ? `${C.accent}22` : 'transparent', color: C.accent, cursor: 'pointer', fontWeight: 600 }}
        >{showLibrary ? 'Hide Library ▴' : 'Pick from Library ▾'}</button>

        {/* Library browser */}
        {showLibrary && (
          <div style={{ marginTop: 8 }}>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search sounds…"
              autoFocus
              style={{ width: '100%', fontSize: 11, padding: '4px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgDark, color: C.text, outline: 'none', boxSizing: 'border-box', marginBottom: 4 }}
              onKeyDown={e => e.stopPropagation()}
              onClick={e => e.stopPropagation()}
            />
            {loading ? (
              <div style={{ fontSize: 11, color: C.muted, padding: '8px 4px' }}>Loading…</div>
            ) : filtered.length === 0 ? (
              <div style={{ fontSize: 11, color: C.muted, padding: '8px 4px' }}>
                {entries.length === 0 ? 'No sounds in library — add some via the Sound Library panel' : 'No matches'}
              </div>
            ) : (
              <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                {filtered.map(entry => (
                  <button
                    key={entry.id}
                    onClick={() => { onAssignSound(entry); onClose() }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6, width: '100%', textAlign: 'left',
                      padding: '5px 6px', borderRadius: 3, border: 'none',
                      background: entry.id === pad.customSoundId ? `${C.accent}22` : 'transparent',
                      color: entry.id === pad.customSoundId ? C.accent : C.text,
                      cursor: 'pointer', fontSize: 11,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.06)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = entry.id === pad.customSoundId ? `${C.accent}22` : 'transparent' }}
                  >
                    <span style={{ fontSize: 13 }}>🔊</span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.name}</span>
                    <span style={{ fontSize: 9, color: C.muted, flexShrink: 0 }}>{entry.duration.toFixed(1)}s</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PadInput({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const { project, dispatch, engine } = useDaw()

  const [tab,        setTab]        = useState<'pads' | 'keyboard'>('pads')
  const [pads,       setPads]       = useState<Pad[]>(DEFAULT_PADS)
  const [octave,     setOctave]     = useState(4)
  const [pressing,   setPressing]   = useState<Set<number>>(new Set())
  const [remapId,    setRemapId]    = useState<string | null>(null)
  const [active,     setActive]     = useState(false)
  const [contextMenu, setContextMenu] = useState<{ pad: Pad; x: number; y: number } | null>(null)
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth  / 2 - 250) : 200,
    y: typeof window !== 'undefined' ? Math.max(0, window.innerHeight - 400)      : 200,
  }))

  const containerRef  = useRef<HTMLDivElement>(null)
  const noteStarts    = useRef<Map<number, { beat: number; clipId: string }>>(new Map())
  const activeClipId  = useRef<string | null>(null)
  const soundBuffers  = useRef<Map<string, AudioBuffer>>(new Map())
  const dragging      = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const track      = project.tracks.find(t => t.id === trackId)
  const instrument = track?.instrument
  const isDrum     = instrument?.type === 'drum'

  const pianoKeyMap = useMemo(() => buildPianoKeyMap(octave), [octave])
  const padKeyMap   = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of pads) if (p.key) m[p.key] = p.pitch
    return m
  }, [pads])

  // ── Audio helpers ─────────────────────────────────────────────────────────────

  const getOrCreateClip = useCallback((): string => {
    const now = engine.currentBeat
    if (activeClipId.current && project.arrangementClips.some(c => c.id === activeClipId.current)) {
      return activeClipId.current
    }
    const spanning = project.arrangementClips.find(c =>
      isMidiClip(c) && c.trackId === trackId && now >= c.startBeat && now < c.startBeat + c.durationBeats
    )
    if (spanning) { activeClipId.current = spanning.id; return spanning.id }
    const startBeat = Math.floor(now / project.timeSignatureNum) * project.timeSignatureNum
    const clip = makeMidiClip(trackId, 'Beat', startBeat, 8 * project.timeSignatureNum)
    ;(clip as MidiClip).isDrumClip = isDrum
    dispatch({ type: 'ADD_CLIP', clip })
    activeClipId.current = clip.id
    return clip.id
  }, [engine, project, trackId, dispatch, isDrum])

  // Play a pitch — uses custom sound if assigned to this pad, otherwise synthesis
  const startNote = useCallback(async (pitch: number) => {
    // Find pad assigned to this pitch to check for custom sound
    const pad = pads.find(p => p.pitch === pitch)

    if (pad?.customSoundId) {
      // Load + cache decoded buffer
      let buf = soundBuffers.current.get(pad.customSoundId)
      if (!buf) {
        try {
          const entries = await libraryGetAll()
          const entry = entries.find(e => e.id === pad.customSoundId)
          if (entry) {
            const ab = await entry.audioBlob.arrayBuffer()
            buf = await engine.ctx.decodeAudioData(ab)
            soundBuffers.current.set(pad.customSoundId, buf)
          }
        } catch { /* decode failed — fall through to synthesis */ }
      }
      if (buf) {
        const src = engine.ctx.createBufferSource()
        src.buffer = buf
        src.playbackRate.value = Math.pow(2, (pitch - 60) / 12)
        src.connect(engine.masterGain)
        src.start(engine.ctx.currentTime)
      }
    } else if (instrument) {
      playInstrumentNote(engine.ctx, engine.masterGain, instrument, pitch, 100, engine.ctx.currentTime, 0.25)
    }

    setPressing(prev => new Set([...prev, pitch]))
    if (engine.isRecording && engine.isPlaying) {
      const clipId = getOrCreateClip()
      noteStarts.current.set(pitch, { beat: engine.currentBeat, clipId })
    }
  }, [pads, instrument, engine, getOrCreateClip])

  const endNote = useCallback((pitch: number) => {
    setPressing(prev => { const n = new Set(prev); n.delete(pitch); return n })
    const started = noteStarts.current.get(pitch)
    if (!started) return
    noteStarts.current.delete(pitch)
    const clip = project.arrangementClips.find(c => c.id === started.clipId)
    if (clip && isMidiClip(clip)) {
      const note: MidiNote = {
        id: crypto.randomUUID(), pitch,
        startBeat: Math.max(0, started.beat - clip.startBeat),
        durationBeats: Math.max(0.0625, engine.currentBeat - started.beat),
        velocity: 100,
      }
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note })
    }
  }, [project, engine, dispatch])

  // ── Click-outside → deactivate ───────────────────────────────────────────────

  useEffect(() => {
    if (!active) return
    function onDocDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setActive(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [active])

  // ── Capture-phase swallower — blocks DAW shortcuts while active ───────────────

  useEffect(() => {
    if (!active) return
    function swallow(e: KeyboardEvent) {
      if (e.key === 'Escape') { setActive(false); return }
      e.stopPropagation()
    }
    document.addEventListener('keydown', swallow, true)
    document.addEventListener('keyup',   swallow, true)
    return () => {
      document.removeEventListener('keydown', swallow, true)
      document.removeEventListener('keyup',   swallow, true)
    }
  }, [active])

  // ── Keyboard handler ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!active) return

    function onDown(e: KeyboardEvent) {
      if (e.repeat) return
      const k = e.key.toLowerCase()

      if (remapId !== null) {
        if (k === 'escape') { setRemapId(null); return }
        e.preventDefault()
        setPads(prev => prev.map(p => {
          if (p.key === k) return { ...p, key: '' }
          if (p.id === remapId) return { ...p, key: k }
          return p
        }))
        setRemapId(null)
        return
      }

      const keyMap = tab === 'pads' ? padKeyMap : pianoKeyMap
      const pitch  = keyMap[k] ?? keyMap[e.key]
      if (pitch === undefined) return
      e.preventDefault()
      startNote(pitch)
    }

    function onUp(e: KeyboardEvent) {
      const k = e.key.toLowerCase()
      const keyMap = tab === 'pads' ? padKeyMap : pianoKeyMap
      const pitch  = keyMap[k] ?? keyMap[e.key]
      if (pitch === undefined) return
      endNote(pitch)
    }

    document.addEventListener('keydown', onDown)
    document.addEventListener('keyup',   onUp)
    return () => {
      document.removeEventListener('keydown', onDown)
      document.removeEventListener('keyup',   onUp)
    }
  }, [active, tab, padKeyMap, pianoKeyMap, remapId, startNote, endNote])

  // ── Drag header ───────────────────────────────────────────────────────────────

  const onHeaderMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    function mm(ev: MouseEvent) {
      if (!dragging.current) return
      setPos({ x: dragging.current.ox + ev.clientX - dragging.current.sx,
               y: dragging.current.oy + ev.clientY - dragging.current.sy })
    }
    function mu() { dragging.current = null; document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu) }
    document.addEventListener('mousemove', mm)
    document.addEventListener('mouseup', mu)
    e.preventDefault()
  }, [pos])

  const isRecActive = engine.isRecording && engine.isPlaying

  // ── Render ────────────────────────────────────────────────────────────────────

  return createPortal(
    <>
      <div
        ref={containerRef}
        onMouseDown={() => setActive(true)}
        style={{
          position: 'fixed', left: pos.x, top: pos.y, width: 500,
          background: C.bg,
          border: active ? `1px solid ${C.accent}` : `1px solid ${C.border}`,
          borderRadius: 10,
          boxShadow: active
            ? `0 12px 40px rgba(0,0,0,0.75), 0 0 0 2px rgba(61,143,239,0.35)`
            : '0 12px 40px rgba(0,0,0,0.75)',
          zIndex: 2000, userSelect: 'none', transition: 'border-color 0.15s, box-shadow 0.15s',
        }}
      >
        {/* Header */}
        <div onMouseDown={onHeaderMouseDown} style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          background: active ? 'rgba(61,143,239,0.18)' : C.bgCard,
          borderRadius: '10px 10px 0 0',
          borderBottom: `1px solid ${active ? 'rgba(61,143,239,0.4)' : C.border}`,
          cursor: 'grab', transition: 'background 0.15s',
        }}>
          <span style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>⌨ Pad Input</span>
          {track && <span style={{ fontSize: 11, color: C.muted, borderLeft: `2px solid ${track.color ?? C.accent}`, paddingLeft: 6 }}>{track.name}</span>}
          {active
            ? <span style={{ fontSize: 10, fontWeight: 800, color: C.accent, background: 'rgba(61,143,239,0.15)', border: `1px solid rgba(61,143,239,0.4)`, borderRadius: 3, padding: '1px 6px', letterSpacing: '0.06em' }}>ACTIVE</span>
            : <span style={{ fontSize: 10, color: C.muted }}>click to activate</span>
          }
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {isRecActive && <span style={{ fontSize: 10, color: C.red, fontWeight: 800, letterSpacing: '0.05em' }}>● REC</span>}
            <span style={{ fontSize: 10, color: C.muted }}>drag to move</span>
            <button onClick={e => { e.stopPropagation(); onClose() }}
              style={{ background: 'transparent', border: 'none', color: C.muted, cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' }}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 2, padding: '6px 12px 0', background: C.bgCard, borderBottom: `1px solid ${C.border}` }}>
          {(['pads', 'keyboard'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '4px 14px', fontSize: 12, borderRadius: '4px 4px 0 0',
              border: `1px solid ${tab === t ? C.border : 'transparent'}`, borderBottom: 'none',
              background: tab === t ? C.bg : 'transparent',
              color: tab === t ? C.text : C.muted, cursor: 'pointer', fontWeight: tab === t ? 600 : 400,
              textTransform: 'capitalize',
            }}>{t}</button>
          ))}
        </div>

        {/* Pads tab */}
        {tab === 'pads' && (
          <div style={{ padding: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              {pads.map(pad => {
                const isActive    = pressing.has(pad.pitch)
                const isRemapping = remapId === pad.id
                const label       = isDrum ? pad.drumLabel : pitchToName(pad.pitch)
                const hasCustom   = !!pad.customSoundId
                return (
                  <button
                    key={pad.id}
                    onMouseDown={e => { e.stopPropagation(); if (e.button === 0) startNote(pad.pitch) }}
                    onMouseUp={e => { e.stopPropagation(); if (e.button === 0) endNote(pad.pitch) }}
                    onMouseLeave={() => endNote(pad.pitch)}
                    onContextMenu={e => {
                      e.preventDefault(); e.stopPropagation()
                      setContextMenu({ pad, x: e.clientX, y: e.clientY })
                    }}
                    onClick={e => e.stopPropagation()}
                    title="Right-click to edit pad"
                    style={{
                      height: 76, display: 'flex', flexDirection: 'column', alignItems: 'center',
                      justifyContent: 'center', gap: 4, borderRadius: 6, position: 'relative',
                      border: `1px solid ${isRemapping ? C.accent : isActive ? '#666' : hasCustom ? 'rgba(61,143,239,0.4)' : C.border}`,
                      background: isRemapping ? `${C.accent}30` : isActive ? 'rgba(255,255,255,0.12)' : hasCustom ? 'rgba(61,143,239,0.07)' : C.bgCard,
                      color: isActive ? '#fff' : C.text, cursor: 'pointer',
                      transition: 'background 50ms, border-color 50ms',
                    }}
                  >
                    {/* Custom sound dot */}
                    {hasCustom && !isActive && (
                      <span style={{ position: 'absolute', top: 5, right: 6, width: 6, height: 6, borderRadius: '50%', background: C.accent }} title={pad.customSoundName} />
                    )}
                    <span style={{ fontSize: 12, fontWeight: 600 }}>
                      {isRemapping ? '…press key' : label}
                    </span>
                    {hasCustom && !isRemapping && (
                      <span style={{ fontSize: 9, color: C.accent, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1 }}>
                        {pad.customSoundName}
                      </span>
                    )}
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                      background: C.bgDark, border: `1px solid #3a3a3a`,
                      color: pad.key ? '#9c9c9c' : '#444', fontFamily: 'monospace',
                    }}>{pad.key ? pad.key.toUpperCase() : '–'}</span>
                  </button>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
              <button
                onClick={() => {
                  const lastPitch = pads.length > 0 ? pads[pads.length - 1].pitch + 1 : 60
                  setPads(prev => [...prev, { id: crypto.randomUUID(), pitch: lastPitch, drumLabel: pitchToName(lastPitch), key: '' }])
                }}
                style={{ fontSize: 11, padding: '4px 12px', borderRadius: 4, border: `1px dashed ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}
              >+ Add Pad</button>
              {pads.length > 4 && (
                <button
                  onClick={() => setPads(prev => prev.slice(0, -1))}
                  style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: `1px solid ${C.border}`, background: 'transparent', color: C.muted, cursor: 'pointer' }}
                >− Remove Last</button>
              )}
              <span style={{ fontSize: 10, color: '#444', marginLeft: 'auto' }}>Right-click a pad to edit key or sound</span>
            </div>
          </div>
        )}

        {/* Keyboard tab */}
        {tab === 'keyboard' && (
          <div style={{ padding: '12px 12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <button onClick={() => setOctave(o => Math.max(0, o - 1))}
                style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, cursor: 'pointer', fontSize: 13 }}>◀</button>
              <span style={{ fontSize: 12, color: C.muted, minWidth: 60, textAlign: 'center' }}>Oct {octave} (C{octave})</span>
              <button onClick={() => setOctave(o => Math.min(8, o + 1))}
                style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, cursor: 'pointer', fontSize: 13 }}>▶</button>
              <span style={{ fontSize: 10, color: '#444', marginLeft: 8 }}>Z–M = lower oct · Q–U = upper oct</span>
            </div>

            {[octave, octave + 1].map(oct => {
              const base = (oct + 1) * 12
              const WW = 30, WH = 90, BW = 18, BH = 56
              const octW = WW * 7
              return (
                <div key={oct} style={{ display: 'inline-block', position: 'relative', width: octW, height: WH, marginRight: 2 }}>
                  {WHITE_ST.map((st, i) => {
                    const pitch = base + st
                    const act = pressing.has(pitch)
                    return (
                      <div key={st}
                        onMouseDown={e => { e.stopPropagation(); startNote(pitch) }}
                        onMouseUp={e => { e.stopPropagation(); endNote(pitch) }}
                        onMouseLeave={() => endNote(pitch)}
                        style={{ position: 'absolute', left: i * WW, top: 0, width: WW - 1, height: WH, background: act ? C.accent : '#d8d8d8', borderRadius: '0 0 4px 4px', border: '1px solid #555', borderTop: 'none', cursor: 'pointer', boxSizing: 'border-box', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4 }}>
                        {st === 0 && <span style={{ fontSize: 9, color: '#666', fontWeight: 700 }}>C{oct}</span>}
                      </div>
                    )
                  })}
                  {BLACK_KEYS.map(({ st, pos: bpos }) => {
                    const pitch = base + st
                    const act = pressing.has(pitch)
                    return (
                      <div key={st}
                        onMouseDown={e => { e.stopPropagation(); e.preventDefault(); startNote(pitch) }}
                        onMouseUp={e => { e.stopPropagation(); endNote(pitch) }}
                        onMouseLeave={() => endNote(pitch)}
                        style={{ position: 'absolute', left: bpos * WW + (WW - BW) / 2, top: 0, width: BW, height: BH, zIndex: 1, background: act ? C.accent : '#222', borderRadius: '0 0 3px 3px', border: '1px solid #111', borderTop: 'none', cursor: 'pointer', boxSizing: 'border-box' }} />
                    )
                  })}
                </div>
              )
            })}

            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {Object.entries(pianoKeyMap).slice(0, 12).map(([k, p]) => (
                <span key={k} style={{ fontSize: 9, padding: '1px 4px', borderRadius: 2, background: C.bgCard, border: `1px solid ${C.border}`, color: C.muted, fontFamily: 'monospace' }}>
                  {k.toUpperCase()}={pitchToName(p)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: '6px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {active
            ? <span style={{ fontSize: 10, color: C.muted }}>Esc or click outside to release · Arm track + record to capture</span>
            : <span style={{ fontSize: 10, color: '#444' }}>Click overlay to activate keyboard input</span>
          }
          {isRecActive && <span style={{ fontSize: 10, color: C.red, fontWeight: 700, flexShrink: 0, marginLeft: 8 }}>Recording…</span>}
        </div>
      </div>

      {/* Pad context-menu popover */}
      {contextMenu && (
        <PadPopover
          pad={contextMenu.pad}
          anchor={{ x: contextMenu.x, y: contextMenu.y }}
          onRemap={() => setRemapId(contextMenu.pad.id)}
          onAssignSound={entry => setPads(prev => prev.map(p =>
            p.id === contextMenu.pad.id ? { ...p, customSoundId: entry.id, customSoundName: entry.name } : p
          ))}
          onClearSound={() => {
            setPads(prev => prev.map(p =>
              p.id === contextMenu.pad.id ? { ...p, customSoundId: undefined, customSoundName: undefined } : p
            ))
          }}
          onClose={() => setContextMenu(null)}
        />
      )}
    </>,
    document.body
  )
}
