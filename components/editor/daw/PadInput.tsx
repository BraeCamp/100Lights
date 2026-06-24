'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useDaw, makeMidiClip } from '@/lib/daw-state'
import { playInstrumentNote } from '@/lib/daw-instruments'
import type { MidiClip, MidiNote } from '@/lib/daw-types'
import { isMidiClip } from '@/lib/daw-types'

// ── Types ──────────────────────────────────────────────────────────────────────

interface Pad {
  id: string
  pitch: number
  drumLabel: string  // shown for drum tracks
  key: string        // keyboard shortcut (lowercase), '' = unassigned
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

// Standard DAW piano keyboard layout (lower row Z, upper row Q)
function buildPianoKeyMap(baseOctave: number): Record<string, number> {
  const b = (baseOctave + 1) * 12  // C4 = MIDI 60 when octave=4
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

// White-key semitone offsets and their black-key neighbours
const WHITE_ST = [0, 2, 4, 5, 7, 9, 11]
// [semitone, position-fraction-from-left-of-octave-in-white-key-units]
const BLACK_KEYS = [
  { st: 1, pos: 0.65 }, { st: 3, pos: 1.65 },
  { st: 6, pos: 3.65 }, { st: 8, pos: 4.65 }, { st: 10, pos: 5.65 },
]

const C = {
  bg:       '#1c1c1c',
  bgCard:   '#252525',
  bgDark:   '#151515',
  border:   '#333333',
  accent:   '#3d8fef',
  red:      '#ef4444',
  text:     '#e8e8e8',
  muted:    '#7c7c7c',
} as const

// ── Main component ─────────────────────────────────────────────────────────────

export default function PadInput({ trackId, onClose }: { trackId: string; onClose: () => void }) {
  const { project, dispatch, engine } = useDaw()

  const [tab,        setTab]        = useState<'pads' | 'keyboard'>('pads')
  const [pads,       setPads]       = useState<Pad[]>(DEFAULT_PADS)
  const [octave,     setOctave]     = useState(4)
  const [pressing,   setPressing]   = useState<Set<number>>(new Set())
  const [remapId,    setRemapId]    = useState<string | null>(null)
  const [pos, setPos] = useState(() => ({
    x: typeof window !== 'undefined' ? Math.max(0, window.innerWidth  / 2 - 250) : 200,
    y: typeof window !== 'undefined' ? Math.max(0, window.innerHeight - 400)      : 200,
  }))

  const noteStarts    = useRef<Map<number, { beat: number; clipId: string }>>(new Map())
  const activeClipId  = useRef<string | null>(null)
  const dragging      = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null)

  const track      = project.tracks.find(t => t.id === trackId)
  const instrument = track?.instrument
  const isDrum     = instrument?.type === 'drum'

  // Piano key map changes when octave changes
  const pianoKeyMap = useMemo(() => buildPianoKeyMap(octave), [octave])
  // Pads key→pitch map
  const padKeyMap = useMemo(() => {
    const m: Record<string, number> = {}
    for (const p of pads) if (p.key) m[p.key] = p.pitch
    return m
  }, [pads])

  // ── Audio + recording helpers ────────────────────────────────────────────────

  const getOrCreateClip = useCallback((): string => {
    const now = engine.currentBeat
    if (activeClipId.current) {
      if (project.arrangementClips.some(c => c.id === activeClipId.current)) return activeClipId.current
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

  const playPitch = useCallback((pitch: number) => {
    if (!instrument) return
    playInstrumentNote(engine.ctx, engine.masterGain, instrument, pitch, 100, engine.ctx.currentTime, 0.25)
  }, [instrument, engine])

  const startNote = useCallback((pitch: number) => {
    playPitch(pitch)
    setPressing(prev => new Set([...prev, pitch]))
    if (engine.isRecording && engine.isPlaying) {
      const clipId = getOrCreateClip()
      noteStarts.current.set(pitch, { beat: engine.currentBeat, clipId })
    }
  }, [playPitch, engine, getOrCreateClip])

  const endNote = useCallback((pitch: number) => {
    setPressing(prev => { const n = new Set(prev); n.delete(pitch); return n })
    const started = noteStarts.current.get(pitch)
    if (!started) return
    noteStarts.current.delete(pitch)
    const clip = project.arrangementClips.find(c => c.id === started.clipId)
    if (clip && isMidiClip(clip)) {
      const note: MidiNote = {
        id: crypto.randomUUID(),
        pitch,
        startBeat: Math.max(0, started.beat - clip.startBeat),
        durationBeats: Math.max(0.0625, engine.currentBeat - started.beat),
        velocity: 100,
      }
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note })
    }
  }, [project, engine, dispatch])

  // ── Keyboard handler ─────────────────────────────────────────────────────────

  useEffect(() => {
    function onDown(e: KeyboardEvent) {
      if (e.repeat) return
      const k = e.key.toLowerCase()

      // Remap mode: assign key to pad
      if (remapId !== null) {
        if (k === 'escape') { setRemapId(null); return }
        e.preventDefault(); e.stopPropagation()
        setPads(prev => prev.map(p => {
          if (p.key === k) return { ...p, key: '' }  // clear old binding
          if (p.id === remapId) return { ...p, key: k }
          return p
        }))
        setRemapId(null)
        return
      }

      const keyMap = tab === 'pads' ? padKeyMap : pianoKeyMap
      const pitch  = keyMap[k] ?? keyMap[e.key]
      if (pitch === undefined) return
      e.preventDefault(); e.stopPropagation()
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
  }, [tab, padKeyMap, pianoKeyMap, remapId, startNote, endNote])

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
    <div style={{
      position: 'fixed', left: pos.x, top: pos.y, width: 500,
      background: C.bg, border: `1px solid ${C.border}`, borderRadius: 10,
      boxShadow: '0 12px 40px rgba(0,0,0,0.75)', zIndex: 2000, userSelect: 'none',
    }}>

      {/* Header */}
      <div onMouseDown={onHeaderMouseDown} style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
        background: C.bgCard, borderRadius: '10px 10px 0 0',
        borderBottom: `1px solid ${C.border}`, cursor: 'grab',
      }}>
        <span style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>⌨ Pad Input</span>
        {track && <span style={{ fontSize: 11, color: C.muted, borderLeft: `2px solid ${track.color ?? C.accent}`, paddingLeft: 6 }}>{track.name}</span>}
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
              const active     = pressing.has(pad.pitch)
              const isRemapping = remapId === pad.id
              const label      = isDrum ? pad.drumLabel : pitchToName(pad.pitch)
              return (
                <button
                  key={pad.id}
                  onMouseDown={e => { e.stopPropagation(); startNote(pad.pitch) }}
                  onMouseUp={e => { e.stopPropagation(); endNote(pad.pitch) }}
                  onMouseLeave={() => endNote(pad.pitch)}
                  onContextMenu={e => { e.preventDefault(); e.stopPropagation(); setRemapId(pad.id) }}
                  onClick={e => e.stopPropagation()}
                  title="Right-click to remap key"
                  style={{
                    height: 76, display: 'flex', flexDirection: 'column', alignItems: 'center',
                    justifyContent: 'center', gap: 5, borderRadius: 6,
                    border: `1px solid ${isRemapping ? C.accent : active ? '#666' : C.border}`,
                    background: isRemapping ? `${C.accent}30` : active ? 'rgba(255,255,255,0.12)' : C.bgCard,
                    color: active ? '#fff' : C.text, cursor: 'pointer',
                    transition: 'background 50ms, border-color 50ms',
                    position: 'relative',
                  }}
                >
                  <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.01em' }}>
                    {isRemapping ? '…press key' : label}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    background: C.bgDark, border: `1px solid #3a3a3a`,
                    color: pad.key ? '#9c9c9c' : '#444', fontFamily: 'monospace',
                  }}>{pad.key ? pad.key.toUpperCase() : '–'}</span>
                </button>
              )
            })}
          </div>

          {/* Add pad row */}
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
            <span style={{ fontSize: 10, color: '#444', marginLeft: 'auto' }}>Right-click pad to remap key</span>
          </div>
        </div>
      )}

      {/* Keyboard tab */}
      {tab === 'keyboard' && (
        <div style={{ padding: '12px 12px 14px' }}>
          {/* Octave controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <button onClick={() => setOctave(o => Math.max(0, o - 1))}
              style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, cursor: 'pointer', fontSize: 13 }}>◀</button>
            <span style={{ fontSize: 12, color: C.muted, minWidth: 60, textAlign: 'center' }}>Oct {octave} (C{octave})</span>
            <button onClick={() => setOctave(o => Math.min(8, o + 1))}
              style={{ padding: '3px 10px', borderRadius: 4, border: `1px solid ${C.border}`, background: C.bgCard, color: C.text, cursor: 'pointer', fontSize: 13 }}>▶</button>
            <span style={{ fontSize: 10, color: '#444', marginLeft: 8 }}>Z–M = lower oct · Q–U = upper oct</span>
          </div>

          {/* 2-octave mini piano */}
          {[octave, octave + 1].map(oct => {
            const base = (oct + 1) * 12
            const WW = 30   // white key width
            const WH = 90   // white key height
            const BW = 18   // black key width
            const BH = 56   // black key height
            const octW = WW * 7
            return (
              <div key={oct} style={{ display: 'inline-block', position: 'relative', width: octW, height: WH, marginRight: 2 }}>
                {/* White keys */}
                {WHITE_ST.map((st, i) => {
                  const pitch = base + st
                  const active = pressing.has(pitch)
                  return (
                    <div key={st} onMouseDown={e => { e.stopPropagation(); startNote(pitch) }}
                      onMouseUp={e => { e.stopPropagation(); endNote(pitch) }}
                      onMouseLeave={() => endNote(pitch)}
                      style={{
                        position: 'absolute', left: i * WW, top: 0,
                        width: WW - 1, height: WH,
                        background: active ? `${C.accent}` : '#d8d8d8',
                        borderRadius: '0 0 4px 4px',
                        border: `1px solid #555`, borderTop: 'none',
                        cursor: 'pointer', boxSizing: 'border-box',
                        display: 'flex', alignItems: 'flex-end', justifyContent: 'center', paddingBottom: 4,
                      }}>
                      {st === 0 && <span style={{ fontSize: 9, color: '#666', fontWeight: 700 }}>C{oct}</span>}
                    </div>
                  )
                })}
                {/* Black keys */}
                {BLACK_KEYS.map(({ st, pos: bpos }) => {
                  const pitch = base + st
                  const active = pressing.has(pitch)
                  return (
                    <div key={st} onMouseDown={e => { e.stopPropagation(); e.preventDefault(); startNote(pitch) }}
                      onMouseUp={e => { e.stopPropagation(); endNote(pitch) }}
                      onMouseLeave={() => endNote(pitch)}
                      style={{
                        position: 'absolute', left: bpos * WW + (WW - BW) / 2, top: 0,
                        width: BW, height: BH, zIndex: 1,
                        background: active ? C.accent : '#222',
                        borderRadius: '0 0 3px 3px',
                        border: `1px solid #111`, borderTop: 'none',
                        cursor: 'pointer', boxSizing: 'border-box',
                      }} />
                  )
                })}
              </div>
            )
          })}

          {/* Key labels for active keys */}
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
      <div style={{ padding: '6px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 10, color: '#444' }}>Arm track (●) + press transport record to capture</span>
        {isRecActive && <span style={{ fontSize: 10, color: C.red, fontWeight: 700 }}>Recording…</span>}
      </div>
    </div>,
    document.body
  )
}
