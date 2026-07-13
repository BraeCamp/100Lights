'use client'

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { X, ZoomIn, ZoomOut, ChevronsUpDown, ChevronsDownUp } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { useVoiceMap, VoiceMapTrace, VoiceMapControls } from './VoiceMapKit'
import { RollSettings } from './RollSettings'
import type { MidiClip, MidiNote } from '@/lib/daw-types'
import { isMidiClip } from '@/lib/daw-types'
import { getPresets, addPreset, getGroupedPresets, defaultPresetId, noteRangeLabel, clampToPreset, midiNoteLabel, type MidiPreset } from '@/lib/midi-presets'
import { playInstrumentNote } from '@/lib/daw-instruments'
import { libraryGetAll } from '@/lib/sound-library'
import { libraryFulfill, importSoundfontToLibrary, parseSoundfontText } from '@/lib/default-samples'

const NOTE_H      = 10
const PIANO_W     = 52
const TOOLBAR_H   = 32
const CHORD_ROW_H = 26
const VELOCITY_H  = 36
const NUM_NOTES   = 128

// Edit unifies the old Draw and Select tools: click empty draws, click a note
// selects + drags it, shift+drag marquee-selects. Erase deletes on click or
// marquee-drag.
type Tool = 'edit' | 'erase'
type Quant = 0.25 | 0.5 | 1 | 2

// Copied notes survive closing/reopening the roll and work across MIDI clips
let _noteClipboard: MidiNote[] | null = null

// ── Drum lanes (isDrumClip) ───────────────────────────────────────────────────
// Curated GM rows; alias pitches display on the same lane as their primary.
const DRUM_LANES: Array<{ pitch: number; label: string; aliases: number[] }> = [
  { pitch: 49, label: 'Crash',      aliases: [57] },
  { pitch: 46, label: 'Open Hat',   aliases: [] },
  { pitch: 42, label: 'Closed Hat', aliases: [44] },
  { pitch: 48, label: 'Tom Hi',     aliases: [50] },
  { pitch: 45, label: 'Tom Mid',    aliases: [47] },
  { pitch: 41, label: 'Tom Lo',     aliases: [43] },
  { pitch: 51, label: 'Rim',        aliases: [37] },
  { pitch: 39, label: 'Clap',       aliases: [] },
  { pitch: 38, label: 'Snare',      aliases: [40] },
  { pitch: 36, label: 'Kick',       aliases: [35] },
]
const DRUM_LANE_H = 22
const DRUM_PITCH_TO_ROW = new Map<number, number>()
DRUM_LANES.forEach((l, row) => {
  DRUM_PITCH_TO_ROW.set(l.pitch, row)
  l.aliases.forEach(a => DRUM_PITCH_TO_ROW.set(a, row))
})

const QUANT_LABELS: Record<Quant, string> = { 0.25: '1/16', 0.5: '1/8', 1: '1/4', 2: '1/2' }

const INSTRUMENT_LABELS: Record<string, string> = {
  none: 'None', drum: 'Drum Kit', fm: 'FM', fm4op: 'FM 4-Op',
  poly: 'Poly', sampler: 'Sampler', wavetable: 'Wavetable',
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function isBlack(pitch: number) { return [1, 3, 6, 8, 10].includes(pitch % 12) }
function octave(pitch: number)  { return Math.floor(pitch / 12) - 1 }

// ── Chord stamp ───────────────────────────────────────────────────────────────

const CHORD_INTERVALS: Record<string, number[]> = {
  Maj:   [0, 4, 7],
  Min:   [0, 3, 7],
  Maj7:  [0, 4, 7, 11],
  Min7:  [0, 3, 7, 10],
  Dom7:  [0, 4, 7, 10],
  Sus4:  [0, 5, 7],
  Sus2:  [0, 2, 7],
  Dim:   [0, 3, 6],
  Aug:   [0, 4, 8],
  '9th': [0, 4, 7, 10, 14],
  M9:    [0, 4, 7, 11, 14],
}

// ── Scale lock ────────────────────────────────────────────────────────────────

const SCALE_INTERVALS: Record<string, number[]> = {
  'major':     [0, 2, 4, 5, 7, 9, 11],
  'minor':     [0, 2, 3, 5, 7, 8, 10],
  'penta-maj': [0, 2, 4, 7, 9],
  'penta-min': [0, 3, 5, 7, 10],
  'dorian':    [0, 2, 3, 5, 7, 9, 10],
  'chromatic': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
}

function snapToScale(pitch: number, key: number, scale: string): number {
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS['major']
  const oct = Math.floor(pitch / 12)
  const noteInOctave = pitch % 12
  const relativeNote = ((noteInOctave - key) + 12) % 12
  let nearest = intervals[0]
  let minDist = Math.abs(relativeNote - intervals[0])
  for (const interval of intervals) {
    const dist = Math.abs(relativeNote - interval)
    if (dist < minDist) { minDist = dist; nearest = interval }
  }
  return Math.max(0, Math.min(127, oct * 12 + ((nearest + key) % 12)))
}

function getInScalePitches(key: number, scale: string): Set<number> {
  const intervals = SCALE_INTERVALS[scale] ?? SCALE_INTERVALS['major']
  return new Set(intervals.map(i => (i + key) % 12))
}

// ── Piano keys ────────────────────────────────────────────────────────────────

function DrumLaneKeys({
  scrollTop, hoverPitch, onPlayNote, trackColor,
}: {
  scrollTop: number
  hoverPitch: number | null
  onPlayNote: (pitch: number) => void
  trackColor: string
}) {
  return (
    <div style={{ width: PIANO_W + 18, flexShrink: 0, position: 'relative', overflow: 'hidden', background: '#1a1a1a' }}>
      <div style={{ position: 'absolute', top: -scrollTop, left: 0, right: 0 }}>
        {DRUM_LANES.map(lane => {
          const hover = hoverPitch === lane.pitch
          return (
            <div
              key={lane.pitch}
              onMouseDown={() => onPlayNote(lane.pitch)}
              style={{
                height: DRUM_LANE_H, background: hover ? trackColor : '#242424',
                borderBottom: '1px solid #111', borderRight: '1px solid #333',
                display: 'flex', alignItems: 'center', paddingLeft: 6,
                cursor: 'pointer', userSelect: 'none', boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.04em', color: hover ? '#fff' : '#888', whiteSpace: 'nowrap' }}>
                {lane.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PianoKeys({
  scrollTop, hoverPitch, onPlayNote, trackColor, scaleLock, inScalePitches, noteH = NOTE_H,
}: {
  scrollTop: number
  hoverPitch: number | null
  onPlayNote: (pitch: number) => void
  trackColor: string
  scaleLock: boolean
  inScalePitches: Set<number>
  noteH?: number
}) {
  return (
    <div style={{ width: PIANO_W, flexShrink: 0, position: 'relative', overflow: 'hidden', background: '#1a1a1a' }}>
      <div style={{ position: 'absolute', top: -scrollTop, left: 0, right: 0 }}>
        {Array.from({ length: NUM_NOTES }, (_, i) => {
          const pitch = NUM_NOTES - 1 - i
          const black = isBlack(pitch)
          const isC   = pitch % 12 === 0
          const hover = hoverPitch === pitch
          const inScale = scaleLock && inScalePitches.has(pitch % 12)
          const bg = hover
            ? trackColor
            : inScale
              ? (black ? 'rgba(61,143,239,0.4)' : 'rgba(61,143,239,0.22)')
              : (black ? '#1a1a1a' : '#2e2e2e')
          return (
            <div
              key={pitch}
              onMouseDown={() => onPlayNote(pitch)}
              style={{
                height: noteH, width: black ? '65%' : '100%',
                background: bg,
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

// ── Velocity lane ─────────────────────────────────────────────────────────────

function VelocityLane({
  clip, beatW, scrollLeft, trackColor, selectedNotes, onVelocityChange,
}: {
  clip: MidiClip
  beatW: number
  scrollLeft: number
  trackColor: string
  selectedNotes: Set<string>
  onVelocityChange: (noteId: string, velocity: number) => void
}) {
  function noteAtX(clientX: number, rect: DOMRect): MidiNote | null {
    const absX = clientX - rect.left + scrollLeft
    return clip.notes.find(n => {
      const left  = n.startBeat * beatW
      const right = left + Math.max(3, n.durationBeats * beatW - 2)
      return absX >= left && absX <= right
    }) ?? null
  }

  function velocityFromY(clientY: number, rect: DOMRect): number {
    const relY = Math.max(0, Math.min(VELOCITY_H - 4, clientY - rect.top))
    return Math.max(1, Math.min(127, Math.round((1 - relY / (VELOCITY_H - 4)) * 127)))
  }

  function onMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const rect   = e.currentTarget.getBoundingClientRect()
    const startX = e.clientX
    const startY = e.clientY

    // Shift + drag → linear velocity ramp across selected notes
    if (e.shiftKey) {
      const sorted = clip.notes
        .filter(n => selectedNotes.has(n.id))
        .sort((a, b) => a.startBeat - b.startBeat)
      if (sorted.length > 0) {
        const startVel = velocityFromY(startY, rect)
        function onRampMove(ev: MouseEvent) {
          const endVel = velocityFromY(ev.clientY, rect)
          sorted.forEach((note, i) => {
            const t = sorted.length > 1 ? i / (sorted.length - 1) : 1
            onVelocityChange(note.id, Math.max(1, Math.min(127, Math.round(startVel + (endVel - startVel) * t))))
          })
        }
        function onRampUp() {
          document.removeEventListener('mousemove', onRampMove)
          document.removeEventListener('mouseup', onRampUp)
        }
        document.addEventListener('mousemove', onRampMove)
        document.addEventListener('mouseup', onRampUp)
        e.preventDefault()
        return
      }
    }

    // Normal: detect paint mode (horizontal drag) vs vertical drag
    const initialNote = noteAtX(startX, rect)
    const startV = initialNote?.velocity ?? 64
    let paintMode = false
    let vertMode  = false

    function onMove(ev: MouseEvent) {
      const dx = Math.abs(ev.clientX - startX)
      const dy = Math.abs(ev.clientY - startY)
      if (!paintMode && !vertMode) {
        if (dx > dy && dx > 4) paintMode = true
        else if (dy > 4)       vertMode  = true
      }
      if (paintMode) {
        const n = noteAtX(ev.clientX, rect)
        if (n) onVelocityChange(n.id, velocityFromY(ev.clientY, rect))
      } else if (vertMode && initialNote) {
        const delta = (startY - ev.clientY) / 100
        onVelocityChange(initialNote.id, Math.max(1, Math.min(127, Math.round(startV + delta * 127))))
      }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        height: VELOCITY_H, background: '#111',
        borderTop: '1px solid var(--border)',
        position: 'relative', overflow: 'hidden', cursor: 'crosshair',
      }}
    >
      {clip.notes.map(note => {
        const x = note.startBeat * beatW - scrollLeft
        const h = (note.velocity / 127) * (VELOCITY_H - 4)
        return (
          <div
            key={note.id}
            style={{
              position: 'absolute',
              left: x, bottom: 2,
              width: Math.max(3, (note.durationBeats * beatW) - 2),
              height: h,
              background: trackColor,
              borderRadius: '1px 1px 0 0',
              opacity: 0.8,
              pointerEvents: 'none',
            }}
            title={`Velocity: ${note.velocity}`}
          />
        )
      })}
    </div>
  )
}

// ── Playhead line (RAF-driven; reads engine time without re-rendering the roll)
function PlayheadLine({ clipStart, clipDuration, beatW, scrollLeft }: {
  clipStart: number; clipDuration: number; beatW: number; scrollLeft: number
}) {
  const { engine } = useDaw()
  const lineRef = useRef<HTMLDivElement>(null)
  const geo = useRef({ clipStart, clipDuration, beatW, scrollLeft })
  useEffect(() => { geo.current = { clipStart, clipDuration, beatW, scrollLeft } }, [clipStart, clipDuration, beatW, scrollLeft])

  useEffect(() => {
    let raf: number
    function frame() {
      const el = lineRef.current
      if (el) {
        const { clipStart, clipDuration, beatW, scrollLeft } = geo.current
        const rel = engine.currentBeat - clipStart
        if (rel >= 0 && rel <= clipDuration) {
          el.style.display = 'block'
          el.style.left = `${rel * beatW - scrollLeft}px`
        } else {
          el.style.display = 'none'
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [engine])

  return (
    <div ref={lineRef} style={{
      position: 'absolute', top: 0, bottom: 0, width: 1, display: 'none',
      background: '#ff5555', boxShadow: '0 0 4px rgba(255,85,85,0.6)',
      pointerEvents: 'none', zIndex: 5,
    }} />
  )
}

// ── Piano Roll inner (receives guaranteed MidiClip) ───────────────────────────

function PianoRollInner({ clip }: { clip: MidiClip }) {
  const { project, dispatch, setEditTarget, setExpandedPianoRollClipId, engine, selectedClipIds } = useDaw()

  const track = project.tracks.find(t => t.id === clip.trackId)
  const color = track?.color ?? '#3d8fef'

  const [tool, setTool]   = useState<Tool>('edit')
  const [quant, setQuant] = useState<Quant>(0.25)
  const [beatW, setBeatW] = useState(80)
  const [noteH, setNoteH] = useState(NOTE_H)
  const [scrollTop, setScrollTop]   = useState(clip.isDrumClip ? 0 : NUM_NOTES / 2 * NOTE_H - 80)
  const [scrollLeft, setScrollLeft] = useState(0)
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set())
  const [hoverPitch, setHoverPitch] = useState<number | null>(null)
  const [hoverEdge, setHoverEdge]   = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ note: MidiNote; x: number; y: number } | null>(null)
  const [presets, setPresets]           = useState<MidiPreset[]>([])
  const [showPresetPicker, setShowPresetPicker] = useState(false)
  const [rootMenuPos, setRootMenuPos] = useState<{ top: number; right: number } | null>(null)
  const [previewing, setPreviewing]     = useState(false)
  const presetPickerRef = useRef<HTMLDivElement>(null)
  const rootPickerRef   = useRef<HTMLDivElement>(null)

  // The Root selector applies to this clip plus every other selected MIDI
  // clip (any track) — multi-select clips in the arrangement, pick a root,
  // and they all land in the new key together.
  const transposeTargets = useMemo(() => {
    const targets = project.arrangementClips.filter(c =>
      isMidiClip(c) && !c.isDrumClip && (c.id === clip.id || selectedClipIds.has(c.id)))
    return targets.length ? targets : [clip]
  }, [project.arrangementClips, selectedClipIds, clip])

  // Transpose whole patterns to a new root: every note shifts by the same
  // interval, chosen as the smallest movement (−6…+5 semitones) per clip, so
  // chord shapes and voicings are preserved exactly.
  function transposeToRoot(newRoot: number) {
    for (const target of transposeTargets) {
      if (!isMidiClip(target)) continue
      const current = target.rootNote ?? 0
      let delta = (newRoot - current) % 12
      if (delta > 6) delta -= 12
      if (delta < -6) delta += 12
      if (delta !== 0) {
        const notes = target.notes.map(n => ({ ...n, pitch: Math.max(0, Math.min(127, n.pitch + delta)) }))
        dispatch({ type: 'UPDATE_CLIP', clipId: target.id, patch: { notes, rootNote: newRoot } })
      } else if (newRoot !== current) {
        dispatch({ type: 'UPDATE_CLIP', clipId: target.id, patch: { rootNote: newRoot } })
      }
    }
    playNote(60 + newRoot)  // audition the new root
    setRootMenuPos(null)
  }
  const [showNewPreset, setShowNewPreset] = useState(false)
  const [npName,    setNpName]    = useState('')
  const [npFolder,  setNpFolder]  = useState('')
  const [npLo,      setNpLo]      = useState(36)
  const [npHi,      setNpHi]      = useState(84)
  const [npLoading, setNpLoading] = useState(false)
  const [npSfText,  setNpSfText]  = useState<string | null>(null)

  // ── New feature state
  const [chordType, setChordType] = useState<string | null>(null)
  const [scaleLock, setScaleLock] = useState(false)
  const inScalePitches = getInScalePitches(project.key, project.scale)

  // Voice mapping: sung-pitch ribbon overlay + synced replay (pitched rolls only)
  const voiceMap = useVoiceMap(engine, clip, dispatch)

  // ── Row model: chromatic piano vs named drum lanes ──
  const isDrum = clip.isDrumClip
  const rowH = isDrum ? DRUM_LANE_H : noteH

  // Vertical zoom (pitched rolls only) — re-anchor scroll so the row at the
  // viewport center stays put while row height changes.
  function zoomVertical(factor: number) {
    if (isDrum) return
    setNoteH(h => {
      const next = Math.max(6, Math.min(26, Math.round(h * factor)))
      if (next !== h) {
        const viewH = gridRef.current?.clientHeight ?? 0
        setScrollTop(st => Math.max(0, (st + viewH / 2) * (next / h) - viewH / 2))
      }
      return next
    })
  }
  const rowCount = isDrum ? DRUM_LANES.length : NUM_NOTES
  const yToPitch = (y: number): number | null => {
    const row = Math.floor(y / rowH)
    if (row < 0 || row >= rowCount) return null
    return isDrum ? DRUM_LANES[row].pitch : NUM_NOTES - 1 - row
  }
  const pitchToY = (pitch: number): number | null => {
    if (!isDrum) return (NUM_NOTES - 1 - pitch) * rowH
    const row = DRUM_PITCH_TO_ROW.get(pitch)
    return row === undefined ? null : row * rowH
  }
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { rootRef.current?.focus() }, [])

  useEffect(() => { setPresets(getPresets()) }, [])

  // Default note sound: a clip with no preset on a track with no instrument
  // would play silently — assign the built-in Piano preset so drawn notes
  // always sound. (Clips on instrument tracks keep playing the instrument.)
  useEffect(() => {
    if (clip.presetId || clip.isDrumClip) return
    if (track && track.instrument.type !== 'none') return
    const id = defaultPresetId()
    if (id) {
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId: id } })
      engine.setPresets(getPresets())
    }
  }, [clip.presetId, clip.isDrumClip, clip.id, track, dispatch, engine])

  useEffect(() => {
    if (!rootMenuPos) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      if (document.getElementById('pr-root-menu')?.contains(t)) return
      if (rootPickerRef.current && !rootPickerRef.current.contains(t)) setRootMenuPos(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [rootMenuPos])

  useEffect(() => {
    if (!showPresetPicker) return
    function onDown(e: MouseEvent) {
      const t = e.target as Node
      // The menu itself lives in a portal — a mousedown inside it is not "outside"
      if (document.getElementById('pr-preset-menu')?.contains(t)) return
      if (presetPickerRef.current && !presetPickerRef.current.contains(t)) setShowPresetPicker(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showPresetPicker])

  async function previewMiddleC(presetId: string) {
    if (previewing || !engine.ctx) return
    const preset = presets.find(p => p.id === presetId)
    if (!preset) return
    setPreviewing(true)
    try {
      const NOTE_NAMES_PC = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
      // Middle C, clamped into the preset's covered range (a bass preset
      // previews its highest C-region note instead of silence)
      const target = clampToPreset(preset, 60)
      const targetName = `${NOTE_NAMES_PC[target % 12]}${Math.floor(target / 12) - 1}`
      const entries = await libraryGetAll()
      const inFolder = entries.filter(e => e.folder === preset.folder || e.parentFolder === preset.folder)
      const exact = inFolder.find(e => e.name === targetName)
      const entry = exact ?? inFolder.reduce<typeof inFolder[0] | null>((best, e) => {
        if (!best) return e
        return Math.abs((e.renderSpec?.midiNote ?? 60) - target) < Math.abs((best.renderSpec?.midiNote ?? 60) - target) ? e : best
      }, null)
      if (!entry) return
      const fulfilled = await libraryFulfill(entry.id)
      if (!fulfilled?.audioBlob || !engine.ctx) return
      const buf = await engine.ctx.decodeAudioData(await fulfilled.audioBlob.arrayBuffer())
      const src = engine.ctx.createBufferSource()
      src.buffer = buf
      src.connect(engine.masterGain)
      src.start()
      src.stop(engine.ctx.currentTime + 1.5)
    } catch { /* ignore */ } finally {
      setTimeout(() => setPreviewing(false), 1500)
    }
  }

  const gridRef   = useRef<HTMLDivElement>(null)
  const selBoxRef = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null)
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  function snapBeat(b: number) { return Math.round(b / quant) * quant }
  // Holding ⌥ (alt) bypasses grid snap for free positioning
  function snapUnless(free: boolean, b: number) { return free ? b : snapBeat(b) }

  async function playNote(pitch: number) {
    if (!engine.ctx) return
    const preset = clip.presetId ? presets.find(p => p.id === clip.presetId) : null
    if (preset) {
      try {
        const NOTE_NAMES_PR = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
        const pitchName = `${NOTE_NAMES_PR[pitch % 12]}${Math.floor(pitch / 12) - 1}`
        const entries = await libraryGetAll()
        const inFolder = entries.filter(e => e.folder === preset.folder || e.parentFolder === preset.folder)
        const exact = inFolder.find(e => e.name === pitchName)
        const entry = exact ?? inFolder.reduce<typeof inFolder[0] | null>((best, e) => {
          if (!best) return e
          return Math.abs((e.renderSpec?.midiNote ?? 60) - pitch) < Math.abs((best.renderSpec?.midiNote ?? 60) - pitch) ? e : best
        }, null)
        if (entry) {
          const fulfilled = await libraryFulfill(entry.id)
          if (fulfilled?.audioBlob && engine.ctx) {
            const buf = await engine.ctx.decodeAudioData(await fulfilled.audioBlob.arrayBuffer())
            const src = engine.ctx.createBufferSource()
            src.buffer = buf
            src.connect(engine.masterGain)
            src.start()
            src.stop(engine.ctx.currentTime + 1.5)
            return
          }
        }
      } catch { /* fall through */ }
    }
    // No preset: preview through the track's instrument — what playback will
    // actually sound like. Bare sine only when there is no sound source at all.
    if (track && track.instrument.type !== 'none') {
      playInstrumentNote(engine.ctx, engine.masterGain, track.instrument, pitch, 100, engine.ctx.currentTime, 0.4)
      return
    }
    const osc = engine.ctx.createOscillator()
    const g   = engine.ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 440 * Math.pow(2, (pitch - 69) / 12)
    g.gain.setValueAtTime(0.3, engine.ctx.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, engine.ctx.currentTime + 0.5)
    osc.connect(g); g.connect(engine.masterGain)
    osc.start(); osc.stop(engine.ctx.currentTime + 0.5)
  }

  async function handleSoundfontFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const text = await file.text()
    try {
      parseSoundfontText(text)
      setNpSfText(text)
      if (!npName) setNpName(file.name.replace(/\.[^.]+$/, '').replace(/-/g, ' '))
    } catch { alert('Could not parse soundfont file — make sure it\'s a midi-js-soundfonts .js file') }
  }

  async function handleCreatePreset() {
    const name = npName.trim()
    if (!name) return
    setNpLoading(true)
    try {
      let lo = npLo, hi = npHi
      const folder = npSfText ? name : (npFolder.trim() || name)
      if (npSfText) {
        const r = await importSoundfontToLibrary(npSfText, folder)
        lo = r.loNote; hi = r.hiNote
      }
      const p = addPreset({ name, folder, loNote: lo, hiNote: hi, category: 'custom' })
      setPresets(getPresets())
      engine.setPresets(getPresets()) // engine resolves presets from its own list — keep it current
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId: p.id } })
      setShowNewPreset(false); setNpName(''); setNpFolder(''); setNpSfText(null); setShowPresetPicker(false)
    } catch (err) { alert(`Failed: ${err instanceof Error ? err.message : err}`) }
    finally { setNpLoading(false) }
  }

  useEffect(() => {
    if (!ctxMenu) return
    function onDown(e: MouseEvent) {
      const menu = document.getElementById('pr-ctx-menu')
      if (menu && !menu.contains(e.target as Node)) setCtxMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [ctxMenu])

  const CHORD_PRESETS: Array<{ label: string; intervals: number[] }> = [
    { label: 'Major',      intervals: [4, 7] },
    { label: 'Minor',      intervals: [3, 7] },
    { label: 'Power',      intervals: [7] },
    { label: 'Major 7',    intervals: [4, 7, 11] },
    { label: 'Minor 7',    intervals: [3, 7, 10] },
    { label: 'Octave +1',  intervals: [12] },
    { label: 'Octave -1',  intervals: [-12] },
  ]

  function expandToChord(source: MidiNote, intervals: number[]) {
    for (const semi of intervals) {
      const newPitch = source.pitch + semi
      if (newPitch < 0 || newPitch > 127) continue
      const newNote: MidiNote = {
        id:            crypto.randomUUID(),
        pitch:         newPitch,
        startBeat:     source.startBeat,
        durationBeats: source.durationBeats,
        velocity:      source.velocity,
        presetId:      source.presetId,
      }
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: newNote })
    }
    setCtxMenu(null)
  }

  function noteAt(rawBeat: number, pitch: number): MidiNote | undefined {
    return clip.notes.find(n =>
      (isDrum ? DRUM_PITCH_TO_ROW.get(n.pitch) === DRUM_PITCH_TO_ROW.get(pitch) : n.pitch === pitch) &&
      n.startBeat <= rawBeat &&
      n.startBeat + n.durationBeats > rawBeat
    )
  }

  // Right-edge grab zone for resizing: up to 8px wide but never more than 40%
  // of the note, so short notes stay grabbable for moving.
  function isNoteEdge(n: MidiNote, rawBeat: number): boolean {
    const edgeBeats = Math.min(n.durationBeats * 0.4, 8 / beatW)
    return rawBeat >= n.startBeat + n.durationBeats - edgeBeats
  }

  // Marquee drag shared by Edit (shift+drag select) and Erase (drag erase):
  // draws the rubber-band rect and reports the swept note ids on mouseup.
  function startMarquee(e: React.MouseEvent<HTMLDivElement>, rect: DOMRect, onDone: (ids: Set<string>) => void) {
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
      const yTop = Math.min(selBoxRef.current.startY, selBoxRef.current.endY) + scrollTop
      const yBot = Math.max(selBoxRef.current.startY, selBoxRef.current.endY) + scrollTop
      const rowTop = Math.floor(yTop / rowH)
      const rowBot = Math.floor(yBot / rowH)
      const swept = new Set(clip.notes
        .filter(n => {
          if (n.startBeat < x1 || n.startBeat >= x2) return false
          const row = isDrum ? DRUM_PITCH_TO_ROW.get(n.pitch) : NUM_NOTES - 1 - n.pitch
          return row !== undefined && row >= rowTop && row <= rowBot
        })
        .map(n => n.id)
      )
      selBoxRef.current = null
      setSelRect(null)
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      onDone(swept)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function handleGridMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    rootRef.current?.focus()
    const rect    = e.currentTarget.getBoundingClientRect()
    const rawBeat = (e.clientX - rect.left + scrollLeft) / beatW
    const maybePitch = yToPitch(e.clientY - rect.top + scrollTop)
    if (maybePitch === null) return
    const rawPitch = maybePitch

    const beat  = snapUnless(e.altKey, rawBeat)
    const pitch = rawPitch

    if (tool === 'edit') {
      const existing = noteAt(rawBeat, pitch)
      if (existing) {
        // Shift+click toggles the note in/out of the selection
        if (e.shiftKey) {
          setSelectedNotes(prev => {
            const next = new Set(prev)
            if (next.has(existing.id)) next.delete(existing.id)
            else next.add(existing.id)
            return next
          })
          return
        }

        // Grabbing the right edge resizes instead of moving. Resizes the whole
        // selection when the grabbed note is part of one.
        if (isNoteEdge(existing, rawBeat)) {
          const targets = (selectedNotes.has(existing.id) ? clip.notes.filter(n => selectedNotes.has(n.id)) : [existing])
            .map(n => ({ id: n.id, dur: n.durationBeats }))
          setSelectedNotes(prev => prev.has(existing.id) ? prev : new Set([existing.id]))
          const startX = e.clientX
          function onResizeMove(ev: MouseEvent) {
            const delta = (ev.clientX - startX) / beatW
            for (const t of targets) {
              const dur = Math.max(0.125, snapUnless(ev.altKey, t.dur + delta))
              dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: t.id, patch: { durationBeats: dur } })
            }
          }
          function onResizeUp() {
            document.removeEventListener('mousemove', onResizeMove)
            document.removeEventListener('mouseup', onResizeUp)
          }
          document.addEventListener('mousemove', onResizeMove)
          document.addEventListener('mouseup', onResizeUp)
          return
        }

        // Grabbing a note that is part of a multi-selection drags them all
        if (selectedNotes.has(existing.id) && selectedNotes.size > 1) {
          const startX = e.clientX, startY = e.clientY
          const origins = clip.notes
            .filter(n => selectedNotes.has(n.id))
            .map(n => ({ id: n.id, sb: n.startBeat, sp: n.pitch, row: isDrum ? (DRUM_PITCH_TO_ROW.get(n.pitch) ?? 0) : 0 }))
          function onDragSel(ev: MouseEvent) {
            const db = snapUnless(ev.altKey, (ev.clientX - startX) / beatW)
            const dRow = Math.round((ev.clientY - startY) / rowH)
            for (const o of origins) {
              const newPitch = isDrum
                ? DRUM_LANES[Math.max(0, Math.min(DRUM_LANES.length - 1, o.row + dRow))].pitch
                : Math.max(0, Math.min(127, o.sp - dRow))
              dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: o.id, patch: {
                startBeat: Math.max(0, o.sb + db),
                pitch: newPitch,
              }})
            }
          }
          function onUpSel() {
            document.removeEventListener('mousemove', onDragSel)
            document.removeEventListener('mouseup', onUpSel)
          }
          document.addEventListener('mousemove', onDragSel)
          document.addEventListener('mouseup', onUpSel)
          return
        }

        // Single note: select it and drag moves it (scale lock never applies to moves)
        setSelectedNotes(new Set([existing.id]))
        const startX = e.clientX, startY = e.clientY
        const sb = existing.startBeat, sp = existing.pitch
        const spRow = isDrum ? (DRUM_PITCH_TO_ROW.get(sp) ?? 0) : 0
        const existingId = existing.id
        function onMoveExisting(ev: MouseEvent) {
          const db = (ev.clientX - startX) / beatW
          const dRow = Math.round((ev.clientY - startY) / rowH)
          const newPitch = isDrum
            ? DRUM_LANES[Math.max(0, Math.min(DRUM_LANES.length - 1, spRow + dRow))].pitch
            : Math.max(0, Math.min(127, sp - dRow))
          dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: existingId, patch: {
            startBeat: Math.max(0, snapUnless(ev.altKey, sb + db)),
            pitch: newPitch,
          }})
        }
        function onUpExisting() {
          document.removeEventListener('mousemove', onMoveExisting)
          document.removeEventListener('mouseup', onUpExisting)
        }
        document.addEventListener('mousemove', onMoveExisting)
        document.addEventListener('mouseup', onUpExisting)
        return
      }

      // Empty grid: shift+drag marquee-selects, plain click draws a note
      if (e.shiftKey) {
        startMarquee(e, rect, ids => setSelectedNotes(ids))
        return
      }

      // Looped clips: the region past the pattern length is a repeat, not
      // canvas — a note drawn there would also sound inside every repeat.
      if (clip.loopEnabled && clip.loopLengthBeats && beat >= clip.loopLengthBeats) return

      // Apply scale lock to new note pitch (never for drums)
      const finalPitch = scaleLock && !isDrum
        ? snapToScale(pitch, project.key, project.scale)
        : pitch

      // Chord stamp: place all chord notes at once, no drag-to-extend
      if (chordType !== null) {
        const intervals = CHORD_INTERVALS[chordType]
        if (intervals) {
          for (const interval of intervals) {
            const notePitch = finalPitch + interval
            if (notePitch < 0 || notePitch > 127) continue
            dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: {
              id: crypto.randomUUID(),
              pitch: notePitch,
              startBeat: beat,
              durationBeats: quant,
              velocity: 80,
            }})
          }
          playNote(finalPitch)
          return
        }
      }

      // Single note with drag-to-extend duration
      const note: MidiNote = {
        id: crypto.randomUUID(),
        pitch: finalPitch,
        startBeat: beat,
        durationBeats: quant,
        velocity: 100,
      }
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note })
      setSelectedNotes(new Set([note.id]))
      playNote(finalPitch)

      const startX = e.clientX
      const noteId = note.id
      function onMove(ev: MouseEvent) {
        const delta = (ev.clientX - startX) / beatW
        const dur   = ev.altKey ? Math.max(0.125, quant + delta) : Math.max(quant, snapBeat(quant + delta))
        dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId, patch: { durationBeats: dur } })
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }

    if (tool === 'erase') {
      // Click a note to erase it; drag sweeps a marquee that erases everything inside
      const target = noteAt(rawBeat, pitch)
      if (target) {
        dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: target.id })
        return
      }
      startMarquee(e, rect, ids => {
        for (const id of ids) dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: id })
        setSelectedNotes(prev => {
          const next = new Set(prev)
          for (const id of ids) next.delete(id)
          return next
        })
      })
    }
  }

  function handleGridMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect  = e.currentTarget.getBoundingClientRect()
    const p = yToPitch(e.clientY - rect.top + scrollTop)
    setHoverPitch(p)
    if (tool === 'edit' && p !== null) {
      const rawBeat = (e.clientX - rect.left + scrollLeft) / beatW
      const n = noteAt(rawBeat, p)
      setHoverEdge(!!n && isNoteEdge(n, rawBeat))
    } else if (hoverEdge) {
      setHoverEdge(false)
    }
  }

  function pasteNotes(notes: MidiNote[], atBeat: number) {
    if (notes.length === 0) return
    const origin = Math.min(...notes.map(n => n.startBeat))
    const newIds = new Set<string>()
    for (const n of notes) {
      const id = crypto.randomUUID()
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: {
        ...n, id, startBeat: Math.max(0, atBeat + (n.startBeat - origin)),
      }})
      newIds.add(id)
    }
    setSelectedNotes(newIds)
    setTool('edit')
  }

  function quantizeSelection() {
    for (const n of clip.notes) {
      if (!selectedNotes.has(n.id)) continue
      const snapped = snapBeat(n.startBeat)
      if (snapped !== n.startBeat) {
        dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch: { startBeat: snapped } })
      }
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const meta = e.metaKey || e.ctrlKey
    const selected = clip.notes.filter(n => selectedNotes.has(n.id))

    if (e.key === 'Escape') {
      setSelectedNotes(new Set())
      setChordType(null)
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (meta && e.key === 'a') {
      setSelectedNotes(new Set(clip.notes.map(n => n.id)))
      e.preventDefault(); e.stopPropagation()
      return
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNotes.size > 0) {
      for (const noteId of selectedNotes) dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId })
      setSelectedNotes(new Set())
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (meta && e.key === 'c' && selected.length > 0) {
      _noteClipboard = selected.map(n => ({ ...n }))
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (meta && e.key === 'x' && selected.length > 0) {
      _noteClipboard = selected.map(n => ({ ...n }))
      for (const noteId of selectedNotes) dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId })
      setSelectedNotes(new Set())
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (meta && e.key === 'v' && _noteClipboard && _noteClipboard.length > 0) {
      // Paste at the playhead when it's inside this clip, else after existing notes
      const rel = engine.currentBeat - clip.startBeat
      const at = rel >= 0 && rel <= clip.durationBeats
        ? snapBeat(rel)
        : (clip.notes.length ? snapBeat(Math.max(...clip.notes.map(n => n.startBeat + n.durationBeats))) : 0)
      pasteNotes(_noteClipboard, at)
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (meta && e.key === 'd' && selected.length > 0) {
      const start = Math.min(...selected.map(n => n.startBeat))
      const end   = Math.max(...selected.map(n => n.startBeat + n.durationBeats))
      pasteNotes(selected, start + Math.max(quant, end - start))
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (e.key === 'q' && !meta && selectedNotes.size > 0) {
      quantizeSelection()
      e.preventDefault(); e.stopPropagation()
      return
    }
    // Arrows: nudge time / transpose pitch (⇧ = octave; drums move by lane)
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key) && selected.length > 0) {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const d = (e.key === 'ArrowLeft' ? -1 : 1) * quant
        for (const n of selected) {
          dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch: { startBeat: Math.max(0, n.startBeat + d) } })
        }
      } else {
        const dir = e.key === 'ArrowUp' ? 1 : -1
        for (const n of selected) {
          let newPitch: number
          if (isDrum) {
            const row = DRUM_PITCH_TO_ROW.get(n.pitch) ?? 0
            newPitch = DRUM_LANES[Math.max(0, Math.min(DRUM_LANES.length - 1, row - dir))].pitch
          } else {
            newPitch = Math.max(0, Math.min(127, n.pitch + dir * (e.shiftKey ? 12 : 1)))
          }
          dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch: { pitch: newPitch } })
        }
      }
      return
    }
  }

  // Two bars of headroom past the clip end: drawing there auto-extends the
  // clip (ADD_MIDI_NOTE grows durationBeats), so the canvas keeps growing.
  const totalW = clip.durationBeats * beatW + (clip.loopEnabled ? 80 : 2 * (project.timeSignatureNum || 4) * beatW)

  return (
    <div
      ref={rootRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-surface)', outline: 'none' }}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      // Scrolling inside the roll must not also pan the arrangement behind it
      // (ArrangementView has a handleWheel on the whole track area)
      onWheel={e => e.stopPropagation()}
    >
      {/* ── Toolbar (two rows) ── */}
      <div style={{
        background: 'var(--bg-card)', borderBottom: '1px solid var(--border)', flexShrink: 0,
      }}>
        {/* Row 1: EDIT — scrolls horizontally when narrow so the sound picker
            at the right end can never be clipped out of reach */}
        <div style={{
          height: TOOLBAR_H, display: 'flex', alignItems: 'center', gap: 4, padding: '0 8px', overflowX: 'auto', overflowY: 'hidden',
        }}>
          <span style={{ fontSize: 7, color: 'var(--text-muted)', letterSpacing: '0.08em', marginRight: 2, flexShrink: 0, userSelect: 'none' }}>EDIT</span>
          <div style={{ width: 1, height: 16, background: 'var(--border)', flexShrink: 0 }} />
          <button onClick={() => { setEditTarget(null); setExpandedPianoRollClipId(null) }} style={{ ...prBtn, width: 22, height: 22 }} title="Close piano roll"><X size={12} /></button>
          <span style={{ fontSize: 11, color: 'var(--text-secondary)', marginLeft: 2, marginRight: 4 }}>{clip.name}</span>

          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          {(['edit', 'erase'] as Tool[]).map(t => (
            <button key={t} onClick={() => setTool(t)}
              title={t === 'edit'
                ? 'Edit — click empty: draw · drag note: move · shift+click: multi-select · shift+drag: box-select'
                : 'Erase — click a note or drag a box to delete'}
              style={{ ...prBtn, background: tool === t ? 'var(--bg-surface)' : 'transparent', color: tool === t ? 'var(--text-primary)' : 'var(--text-muted)', border: tool === t ? '1px solid var(--border)' : '1px solid transparent', fontSize: 9, padding: '2px 6px' }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}

          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          {([2, 1, 0.5, 0.25] as Quant[]).map(q => { const label = QUANT_LABELS[q]; return (
            <button key={q} onClick={() => setQuant(Number(q) as Quant)}
              style={{ ...prBtn, background: quant === Number(q) ? 'var(--bg-surface)' : 'transparent', color: quant === Number(q) ? 'var(--text-primary)' : 'var(--text-muted)', border: quant === Number(q) ? '1px solid var(--border)' : '1px solid transparent', fontSize: 9, padding: '2px 5px' }}>
              {label}
            </button>
          )})}

          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <button onClick={() => setBeatW(w => Math.min(200, w * 1.3))} style={prBtn} title="Zoom in"><ZoomIn size={12} /></button>
          <button onClick={() => setBeatW(w => Math.max(20, w * 0.77))} style={prBtn} title="Zoom out"><ZoomOut size={12} /></button>
          {!isDrum && (
            <>
              <button onClick={() => zoomVertical(1.25)} style={prBtn} title="Taller rows (⌥ scroll)"><ChevronsUpDown size={12} /></button>
              <button onClick={() => zoomVertical(0.8)} style={prBtn} title="Shorter rows (⌥ scroll)"><ChevronsDownUp size={12} /></button>
            </>
          )}

          <div style={{ width: 1, height: 16, background: 'var(--border)' }} />
          <button
            onClick={quantizeSelection}
            disabled={selectedNotes.size === 0}
            title={selectedNotes.size ? `Snap ${selectedNotes.size} selected note${selectedNotes.size === 1 ? '' : 's'} to the ${QUANT_LABELS[quant]} grid (Q)` : 'Select notes to quantize (Q)'}
            style={{ ...prBtn, fontSize: 9, padding: '2px 6px', opacity: selectedNotes.size ? 1 : 0.4, cursor: selectedNotes.size ? 'pointer' : 'default' }}
          >Quantize</button>

          <div style={{ flex: 1 }} />

          {/* Root selector — transposes the whole pattern (not for drums) */}
          {!isDrum && (
            <div style={{ position: 'relative' }} ref={rootPickerRef}>
              <button
                onClick={e => {
                  if (rootMenuPos) { setRootMenuPos(null); return }
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                  const spaceBelow = window.innerHeight - r.bottom
                  setRootMenuPos({ top: spaceBelow > 260 ? r.bottom + 4 : r.top - 260, right: window.innerWidth - r.right })
                }}
                title="Transpose the whole pattern to a new root — all notes shift together, voicings preserved"
                style={{ ...prBtn, fontSize: 9, padding: '2px 8px', flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                Root: {NOTE_NAMES[(clip.rootNote ?? 0) % 12]}{transposeTargets.length > 1 ? ` (${transposeTargets.length} clips)` : ''}
              </button>
              {rootMenuPos && createPortal(
                (() => {
                  return (
                    <div id="pr-root-menu" style={{
                      position: 'fixed', top: rootMenuPos.top, right: rootMenuPos.right, width: 132, zIndex: 9999,
                      background: '#161616', border: '1px solid #2e2e2e', borderRadius: 8,
                      padding: '6px 0', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    }}>
                      {NOTE_NAMES.map((n, i) => (
                        <button key={n} onClick={() => transposeToRoot(i)}
                          style={{
                            padding: '6px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                            background: (clip.rootNote ?? 0) === i ? 'rgba(124,58,237,0.2)' : 'transparent',
                            color: (clip.rootNote ?? 0) === i ? '#a78bfa' : '#bbb',
                          }}>
                          {n}
                        </button>
                      ))}
                    </div>
                  )
                })(),
                document.body,
              )}
            </div>
          )}

          {!isDrum && <VoiceMapControls vm={voiceMap} />}

          {!isDrum && (
            <RollSettings
              clip={clip} dispatch={dispatch}
              presetLabel={clip.presetId
                ? presets.find(p => p.id === clip.presetId)?.name ?? '?'
                : track && track.instrument.type !== 'none'
                ? `${INSTRUMENT_LABELS[track.instrument.type]} (track)`
                : 'None'}
              onChangeSound={() => setShowPresetPicker(true)}
              onPreviewSound={() => { if (clip.presetId) void previewMiddleC(clip.presetId) }}
              canPreview={!!clip.presetId}
            />
          )}

          {/* Preset picker */}
          <div style={{ position: 'relative' }} ref={presetPickerRef}>
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {clip.presetId && (
                <button
                  onClick={() => previewMiddleC(clip.presetId!)}
                  disabled={previewing}
                  title="Preview middle C of this preset"
                  style={{ ...prBtn, fontSize: 10, padding: '2px 5px', border: '1px solid rgba(167,139,250,0.4)', background: previewing ? 'rgba(124,58,237,0.25)' : 'rgba(124,58,237,0.10)', color: '#a78bfa' }}
                >▶</button>
              )}
              <button
                onClick={() => setShowPresetPicker(v => !v)}
                style={{
                  ...prBtn, fontSize: 9, padding: '2px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
                  border: `1px solid ${clip.presetId ? 'rgba(167,139,250,0.5)' : 'var(--border)'}`,
                  background: clip.presetId ? 'rgba(124,58,237,0.15)' : 'transparent',
                  color: clip.presetId ? '#a78bfa' : 'var(--text-muted)',
                }}
                title={clip.presetId
                  ? `Sound: ${presets.find(p => p.id === clip.presetId)?.name ?? '?'} — click to change (notes are kept)`
                  : 'Choose the sound for this clip — notes are kept when switching'}
              >
                {clip.presetId
                  ? `Preset: ${presets.find(p => p.id === clip.presetId)?.name ?? '?'}`
                  : track && track.instrument.type !== 'none'
                  ? `Preset: ${INSTRUMENT_LABELS[track.instrument.type]} (track)`
                  : 'Preset: None'}
              </button>
            </div>

            {showPresetPicker && createPortal(
              (() => {
                const btn = presetPickerRef.current?.getBoundingClientRect()
                if (!btn) return null
                const spaceBelow = window.innerHeight - btn.bottom
                const menuH = Math.min(presets.length * 28 + 48, 260)
                const top = spaceBelow > menuH + 8 ? btn.bottom + 4 : btn.top - menuH - 4
                return (
                  <div id="pr-preset-menu" style={{
                    position: 'fixed', top, right: window.innerWidth - btn.right,
                    width: 248, zIndex: 9999,
                    background: '#161616', border: '1px solid #2e2e2e', borderRadius: 8,
                    padding: '6px 0', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
                    maxHeight: showNewPreset ? 480 : 280, overflowY: 'auto',
                  }}>
                    <div style={{ padding: '4px 10px 6px', fontSize: 9, color: '#666', fontWeight: 700, letterSpacing: '0.08em', borderBottom: '1px solid #1e1e1e' }}>CLIP SOUND — notes are kept</div>
                    {clip.presetId && track && track.instrument.type !== 'none' && (
                      <button onClick={() => { dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId: undefined } }); setShowPresetPicker(false) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', fontSize: 10, background: 'transparent', border: 'none', color: '#666', cursor: 'pointer' }}>
                        Track instrument — {INSTRUMENT_LABELS[track.instrument.type]}
                      </button>
                    )}
                    {getGroupedPresets(presets).map(({ group, presets: gp }) => (
                      <div key={group}>
                        <div style={{ padding: '5px 10px 2px', fontSize: 8, color: '#555', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{group}</div>
                        {gp.map(p => (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center' }}>
                            <button
                              onClick={e => { e.stopPropagation(); void previewMiddleC(p.id) }}
                              title={`Listen — plays ${midiNoteLabel(clampToPreset(p, 60))}`}
                              style={{
                                flexShrink: 0, width: 22, border: 'none', background: 'transparent', cursor: 'pointer',
                                color: previewing ? '#444' : '#a78bfa', fontSize: 10, padding: '4px 0 4px 8px', textAlign: 'left',
                              }}>
                              ▶
                            </button>
                            <button
                              onClick={() => { dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId: p.id } }); engine.setPresets(getPresets()); setShowPresetPicker(false) }}
                              style={{
                                flex: 1, display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0,
                                textAlign: 'left', padding: '4px 10px 4px 0', fontSize: 10, cursor: 'pointer', border: 'none',
                                background: clip.presetId === p.id ? 'rgba(124,58,237,0.15)' : 'transparent',
                                color: clip.presetId === p.id ? '#a78bfa' : '#aaa',
                              }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                              <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 8.5, color: '#555', fontVariantNumeric: 'tabular-nums' }}>{noteRangeLabel(p)}</span>
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                    <div style={{ borderTop: '1px solid #1e1e1e', margin: '4px 0' }} />
                    {!showNewPreset ? (<>
                      <button onClick={() => setShowNewPreset(true)}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', fontSize: 10, background: 'transparent', border: 'none', color: '#7c3aed', cursor: 'pointer' }}>
                        + New Preset
                      </button>
                      <a href="/community?kind=preset" target="_blank" rel="noreferrer"
                        style={{ display: 'block', padding: '5px 10px', fontSize: 10, color: '#666', textDecoration: 'none' }}>
                        Find presets in Community ↗
                      </a>
                    </>) : (
                      <div style={{ padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <input placeholder="Preset name" value={npName} onChange={e => setNpName(e.target.value)}
                          style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 3, color: '#ccc', fontSize: 10, padding: '3px 6px', boxSizing: 'border-box' }} />
                        <div style={{ fontSize: 9, color: '#666' }}>Upload soundfont (.js):</div>
                        <input type="file" accept=".js" onChange={handleSoundfontFile}
                          style={{ fontSize: 9, color: '#aaa', width: '100%' }} />
                        {npSfText && <div style={{ fontSize: 9, color: '#4ade80' }}>✓ Soundfont loaded — note range auto-detected</div>}
                        {!npSfText && (<>
                          <div style={{ fontSize: 9, color: '#666' }}>Or: library folder name</div>
                          <input placeholder="Folder" value={npFolder} onChange={e => setNpFolder(e.target.value)}
                            style={{ width: '100%', background: '#111', border: '1px solid #333', borderRadius: 3, color: '#ccc', fontSize: 10, padding: '3px 6px', boxSizing: 'border-box' }} />
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                            <span style={{ fontSize: 9, color: '#666' }}>Lo</span>
                            <input type="number" min={0} max={127} value={npLo} onChange={e => setNpLo(Number(e.target.value))}
                              style={{ width: 44, background: '#111', border: '1px solid #333', borderRadius: 3, color: '#ccc', fontSize: 10, padding: '3px 4px' }} />
                            <span style={{ fontSize: 9, color: '#666' }}>Hi</span>
                            <input type="number" min={0} max={127} value={npHi} onChange={e => setNpHi(Number(e.target.value))}
                              style={{ width: 44, background: '#111', border: '1px solid #333', borderRadius: 3, color: '#ccc', fontSize: 10, padding: '3px 4px' }} />
                          </div>
                        </>)}
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={handleCreatePreset} disabled={npLoading || !npName.trim()}
                            style={{ flex: 1, padding: '4px 0', fontSize: 10, background: '#7c3aed', border: 'none', borderRadius: 3, color: '#fff', cursor: 'pointer' }}>
                            {npLoading ? '…' : 'Create'}
                          </button>
                          <button onClick={() => { setShowNewPreset(false); setNpName(''); setNpSfText(null) }}
                            style={{ padding: '4px 6px', fontSize: 10, background: 'transparent', border: '1px solid #333', borderRadius: 3, color: '#666', cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })(),
              document.body
            )}
          </div>
        </div>

        {/* Row 2: MUSICAL — draw mode, melodic clips only */}
        {tool === 'edit' && !isDrum && (
          <div style={{
            height: CHORD_ROW_H, display: 'flex', alignItems: 'center', gap: 2, padding: '0 8px',
            borderTop: '1px solid var(--border)', overflowX: 'auto',
          }}>
            <span style={{ fontSize: 7, color: 'var(--text-muted)', letterSpacing: '0.08em', marginRight: 2, flexShrink: 0, userSelect: 'none' }}>MUSICAL</span>
            <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0, marginRight: 2 }} />

            {/* Scale lock */}
            <button
              onClick={() => setScaleLock(v => !v)}
              title={`Lock new notes to: ${NOTE_NAMES[project.key]} ${project.scale}`}
              style={{
                ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0,
                background: scaleLock ? 'rgba(167,139,250,0.15)' : 'transparent',
                color: scaleLock ? '#a78bfa' : 'var(--text-muted)',
                border: scaleLock ? '1px solid rgba(167,139,250,0.4)' : '1px solid transparent',
              }}
            >
              {scaleLock ? `♩ ${NOTE_NAMES[project.key]} ${project.scale}` : '♩ Scale'}
            </button>

            <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />

            {/* Chord stamp buttons */}
            {Object.keys(CHORD_INTERVALS).map(chord => (
              <button
                key={chord}
                onClick={() => setChordType(chordType === chord ? null : chord)}
                style={{
                  ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0,
                  background: chordType === chord ? 'rgba(61,143,239,0.18)' : 'transparent',
                  color: chordType === chord ? '#3d8fef' : 'var(--text-muted)',
                  border: chordType === chord ? '1px solid rgba(61,143,239,0.45)' : '1px solid transparent',
                }}
              >
                {chord}
              </button>
            ))}
            {chordType && (
              <>
                <div style={{ flex: 1 }} />
                <button
                  onClick={() => setChordType(null)}
                  style={{ ...prBtn, fontSize: 9, padding: '1px 6px', color: '#555', flexShrink: 0 }}
                >
                  Clear
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        {/* Keys / drum lanes */}
        {isDrum ? (
          <DrumLaneKeys
            scrollTop={scrollTop}
            hoverPitch={hoverPitch}
            onPlayNote={playNote}
            trackColor={color}
          />
        ) : (
          <PianoKeys
            scrollTop={scrollTop}
            hoverPitch={hoverPitch}
            onPlayNote={playNote}
            trackColor={color}
            scaleLock={scaleLock}
            inScalePitches={inScalePitches}
            noteH={noteH}
          />
        )}

        {/* Note grid + velocity */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Note grid */}
          <div
            ref={gridRef}
            style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: tool === 'edit' ? (hoverEdge ? 'ew-resize' : 'crosshair') : 'cell' }}
            onMouseDown={handleGridMouseDown}
            onMouseMove={handleGridMouseMove}
            onMouseLeave={() => setHoverPitch(null)}
            onWheel={e => {
              if (e.ctrlKey || e.metaKey) { setBeatW(w => Math.max(20, Math.min(200, w * (e.deltaY < 0 ? 1.15 : 0.87)))); e.preventDefault() }
              else if (e.altKey) { zoomVertical(e.deltaY < 0 ? 1.25 : 0.8); e.preventDefault() }
              else { setScrollTop(s => Math.max(0, s + e.deltaY * 0.5)); setScrollLeft(sl => Math.max(0, sl + e.deltaX)) }
            }}
          >
            {/* Background rows */}
            <div style={{ position: 'absolute', top: -scrollTop, left: 0, width: totalW }}>
              {Array.from({ length: rowCount }, (_, i) => {
                const pitch = isDrum ? DRUM_LANES[i].pitch : NUM_NOTES - 1 - i
                const black = !isDrum && isBlack(pitch)
                const hover = hoverPitch === pitch
                return (
                  <div key={pitch} style={{
                    height: rowH, background: hover ? `${color}20` : black ? '#1a1a1a' : isDrum && i % 2 === 0 ? '#1c1c1c' : '#1e1e1e',
                    borderBottom: !isDrum && pitch % 12 === 0 ? '1px solid #333' : '1px solid #202020',
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
                const y = pitchToY(note.pitch)
                if (y === null) return null
                const w = Math.max(4, note.durationBeats * beatW - 1)
                const sel = selectedNotes.has(note.id)
                const hasPreset = !!note.presetId
                return (
                  <div
                    key={note.id}
                    onContextMenu={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setCtxMenu({ note, x: e.clientX, y: e.clientY })
                    }}
                    style={{
                      position: 'absolute', left: x, top: y + 1,
                      width: w, height: rowH - 2,
                      background: color,
                      border: sel ? '1px solid #fff' : hasPreset ? `1px solid #a78bfa` : `1px solid ${color}cc`,
                      boxShadow: sel ? '0 0 0 1px #fff, 0 0 6px rgba(255,255,255,0.55)' : undefined,
                      filter: sel ? 'brightness(1.3)' : undefined,
                      borderRadius: 2, boxSizing: 'border-box',
                      opacity: sel ? 1 : 0.9, cursor: 'context-menu',
                    }}
                  />
                )
              })}
            </div>

            {/* Voice mapping ribbon */}
            {!isDrum && (
              <VoiceMapTrace
                vm={voiceMap} beatW={beatW} rowH={rowH} scrollLeft={scrollLeft} scrollTop={scrollTop}
                totalW={totalW} offsetBeats={engine.secondsToBeats(voiceMap.offsetMs / 1000)}
              />
            )}

            {/* Playhead */}
            <PlayheadLine clipStart={clip.startBeat} clipDuration={clip.durationBeats} beatW={beatW} scrollLeft={scrollLeft} />

            {/* Selection rectangle */}
            {selRect && (
              <div style={{
                position: 'absolute',
                left: selRect.x, top: selRect.y, width: selRect.w, height: selRect.h,
                border: tool === 'erase' ? '1px solid #ef4444' : '1px solid var(--accent)',
                background: tool === 'erase' ? 'rgba(239,68,68,0.12)' : 'rgba(61,143,239,0.1)',
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
            selectedNotes={selectedNotes}
            onVelocityChange={(noteId, velocity) => dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId, patch: { velocity } })}
          />
        </div>
      </div>

      {/* Right-click chord context menu */}
      {ctxMenu && createPortal(
        <div
          id="pr-ctx-menu"
          style={{
            position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999,
            background: '#161616', border: '1px solid #2e2e2e', borderRadius: 7,
            padding: '4px 0', boxShadow: '0 8px 24px rgba(0,0,0,0.75)', minWidth: 160,
          }}
        >
          <div style={{ padding: '4px 12px 6px', fontSize: 9, fontWeight: 700, color: '#555', letterSpacing: '0.08em' }}>
            {NOTE_NAMES[ctxMenu.note.pitch % 12]}{octave(ctxMenu.note.pitch)}
            {ctxMenu.note.presetId && <span style={{ color: '#7c3aed', marginLeft: 5 }}>● preset</span>}
          </div>
          <div style={{ borderTop: '1px solid #222', paddingTop: 3 }}>
            {CHORD_PRESETS.map(({ label, intervals }) => (
              <button
                key={label}
                onClick={() => expandToChord(ctxMenu.note, intervals)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '5px 14px', fontSize: 11, color: '#ccc',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(61,143,239,0.12)' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
              >
                {label}
                <span style={{ float: 'right', fontSize: 9, color: '#555' }}>
                  {intervals.map(i => (i > 0 ? `+${i}` : `${i}`)).join(' ')}
                </span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── Outer guard ───────────────────────────────────────────────────────────────

export default function PianoRoll({ clipId: propClipId }: { clipId?: string }) {
  const { project, editTarget, expandedPianoRollClipId } = useDaw()
  const id = propClipId ?? expandedPianoRollClipId ?? (editTarget?.type === 'midi-clip' ? editTarget.clipId : undefined)
  const clip = id ? (project.arrangementClips.find(c => c.id === id) ?? null) : null
  if (!clip || !isMidiClip(clip)) return null
  return <PianoRollInner clip={clip} />
}

const prBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  height: 22, borderRadius: 3, border: '1px solid transparent',
  background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer',
  padding: '0 4px',
}
