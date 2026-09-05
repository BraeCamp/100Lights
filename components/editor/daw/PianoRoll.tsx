'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useRegisterCommands } from '@/lib/commands'
import { X, ZoomIn, ZoomOut, ChevronsUpDown, ChevronsDownUp, Play } from 'lucide-react'
import { useDaw } from '@/lib/daw-state'
import { useVoiceMap, VoiceMapTrace, VoiceMapControls } from './VoiceMapKit'
import { RollSettings } from './RollSettings'
import { NoteFxSettings } from './NoteFxSettings'
import { SaveRecipeButton } from '../SoundCreate'
import type { MidiClip, MidiNote, RollFx, PitchGraph, PresetSound } from '@/lib/daw-types'
import { isMidiClip } from '@/lib/daw-types'
import { useIsMobile } from '@/lib/use-is-mobile'
import { sharePreset } from '@/lib/community'
import NewPresetModal from './NewPresetModal'
import { getPresets, combinePresets, addPreset, getGroupedPresets, defaultPresetId, noteRangeLabel, clampToPreset, midiNoteLabel, type MidiPreset } from '@/lib/midi-presets'
import { DRUM_LANES } from '@/lib/drum-presets'
import { playInstrumentNote } from '@/lib/daw-instruments'
import { libraryGetAll, type LibraryEntry } from '@/lib/sound-library'
import { guessRootNote, samplePresetFor, isPickableSample, rootLabel, collapseNoteVariants, type PickableSound } from '@/lib/sample-preset'
import { resampleBySemitones } from '@/lib/audio-resample'
import { resolveKey } from '@/lib/keymap'
import Knob from './Knob'
import { useDrawMode, toggleDrawMode } from '@/lib/draw-mode'
import { beginStroke, strokeTo, velocityFromDrag, noteUnder, type Stroke } from '@/lib/draw-notes'
import { laneValue, lanePatch, randomizeLane, rampLane, LANE_MAX, type LaneField } from '@/lib/note-chance'
import { visibleRows, rowIndexOf, focusScrollTop, stepAdvance, stepMove } from '@/lib/roll-rows'
import { transposeNotes, transposeDegrees, invertNotes, addInterval, stretchNotes, setLength, humanizeNotes, reverseNotes, durationLabel, describeInterval, type Scale } from '@/lib/pitch-time'
import { PitchTimePanel } from './PitchTimePanel'
import { splitAt, chopNotes, chopOnGrid, joinNotes, fitToRange, setActive, anyInactive, type Splice } from '@/lib/note-ops'
import { findNotes, filterIsEmpty, type NoteFilter } from '@/lib/find-notes'
import { FindNotesBar } from './FindNotesBar'
import { StretchMarkers } from './StretchMarkers'
import { useNoteSelectionRequest, consumeNoteSelection } from '@/lib/note-selection'
import { quantizeNotes as quantizePatches, useQuantizeSettings, setQuantizeSettings, describeQuantize } from '@/lib/quantize'
import { QuantizeDialog } from './QuantizeDialog'
import { loopRange, workingRange, notesInRange, duplicateLoop, cropToRange, insertTime, deleteTime, duplicateTime } from '@/lib/clip-time'

/** Roots a sample can be declared at: C1 to C7, every semitone. */
const ROOT_CHOICES = Array.from({ length: 73 }, (_, i) => 24 + i)
import { libraryFulfill, importSoundfontToLibrary, parseSoundfontText } from '@/lib/default-samples'

/** Previews a buffer with a 3ms attack and a 120ms tail release — raw
 *  start()/stop() at full gain clicks at both edges. */
function playClickFree(ctx: AudioContext, src: AudioBufferSourceNode, dest: AudioNode, seconds: number) {
  const g = ctx.createGain()
  const t0 = ctx.currentTime
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.linearRampToValueAtTime(1, t0 + 0.003)
  g.gain.setValueAtTime(1, t0 + seconds - 0.12)
  g.gain.linearRampToValueAtTime(0.0001, t0 + seconds)
  src.connect(g); g.connect(dest)
  src.start()
  src.stop(t0 + seconds + 0.02)
  src.onended = () => { src.disconnect(); g.disconnect() }
}

const NOTE_H      = 10
const PIANO_W     = 52
const TOOLBAR_H   = 32
const CHORD_ROW_H = 26
const VELOCITY_H  = 36
const NUM_NOTES   = 128

// Edit unifies the old Draw and Select tools: click empty draws, click a note
// selects + drags it, shift+drag marquee-selects. Erase deletes on click or
// marquee-drag.
type Tool = 'edit' | 'erase' | 'draw'
type Quant = 0.25 | 0.5 | 1 | 2

// Copied notes survive closing/reopening the roll and work across MIDI clips
let _noteClipboard: MidiNote[] | null = null

// ── Drum lanes (isDrumClip) ───────────────────────────────────────────────────
// Canonical lanes come from lib/drum-presets — the single source of truth the
// step sequencer also uses. Alias pitches display on their primary's row.
const DRUM_LANE_H = 22
const DRUM_PITCH_TO_ROW = new Map<number, number>()
DRUM_LANES.forEach((l, row) => {
  DRUM_PITCH_TO_ROW.set(l.pitch, row)
  l.aliases?.forEach(a => DRUM_PITCH_TO_ROW.set(a, row))
})

const QUANT_LABELS: Record<Quant, string> = { 0.25: '1/16', 0.5: '1/8', 1: '1/4', 2: '1/2' }

const INSTRUMENT_LABELS: Record<string, string> = {
  none: 'None', drum: 'Drum Kit', fm: 'FM', fm4op: 'FM 4-Op',
  poly: 'Poly', sampler: 'Sampler', wavetable: 'Wavetable',
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function isBlack(pitch: number) { return [1, 3, 6, 8, 10].includes(pitch % 12) }

// Per-clip zoom/scroll memory (session-lived) so reopening a clip's editor
// restores where you were, instead of resetting to default zoom every time.
const rollViewCache = new Map<string, { beatW: number; noteH: number; scrollTop: number; scrollLeft: number }>()
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
    <div style={{ width: PIANO_W + 18, flexShrink: 0, position: 'relative', overflow: 'hidden', background: 'var(--bg-surface)' }}>
      <div style={{ position: 'absolute', top: -scrollTop, left: 0, right: 0 }}>
        {DRUM_LANES.map(lane => {
          const hover = hoverPitch === lane.pitch
          return (
            <div
              key={lane.pitch}
              onMouseDown={() => onPlayNote(lane.pitch)}
              style={{
                height: DRUM_LANE_H, background: hover ? trackColor : '#242424',
                borderBottom: '1px solid var(--border)', borderRight: '1px solid var(--border-light)',
                display: 'flex', alignItems: 'center', paddingLeft: 6,
                cursor: 'pointer', userSelect: 'none', boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: 8, fontWeight: 700, letterSpacing: '0.04em', color: hover ? '#fff' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
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
  scrollTop, hoverPitch, onPlayNote, trackColor, scaleLock, inScalePitches, noteH = NOTE_H, rows, root = 0,
}: {
  scrollTop: number
  hoverPitch: number | null
  onPlayNote: (pitch: number) => void
  trackColor: string
  /** Scale lock or Highlight Scale — either tints the keys. */
  scaleLock: boolean
  inScalePitches: Set<number>
  noteH?: number
  /** The pitches shown, top to bottom (lib/roll-rows.ts) — folded or chromatic. */
  rows: number[]
  /** The scale's root pitch class, drawn stronger when highlighted. */
  root?: number
}) {
  return (
    <div data-help-id="piano-keys" style={{ width: PIANO_W, flexShrink: 0, position: 'relative', overflow: 'hidden', background: 'var(--bg-surface)' }}>
      <div style={{ position: 'absolute', top: -scrollTop, left: 0, right: 0 }}>
        {rows.map(pitch => {
          const black = isBlack(pitch)
          const isC   = pitch % 12 === 0
          const hover = hoverPitch === pitch
          const inScale = scaleLock && inScalePitches.has(pitch % 12)
          const isRoot = inScale && pitch % 12 === root
          const bg = hover
            ? trackColor
            : isRoot
              ? 'rgb(var(--accent-rgb) / 0.6)'
              : inScale
                ? (black ? 'rgb(var(--accent-rgb) / 0.4)' : 'rgb(var(--accent-rgb) / 0.22)')
                : (black ? '#1a1a1a' : '#2e2e2e')
          return (
            <div
              key={pitch}
              data-pitch={pitch}
              data-in-scale={inScale || undefined}
              onMouseDown={() => onPlayNote(pitch)}
              style={{
                height: noteH, width: black ? '65%' : '100%',
                background: bg,
                borderBottom: '1px solid var(--border)',
                borderRight: black ? 'none' : '1px solid #333',
                display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
                paddingRight: 2, cursor: 'pointer', userSelect: 'none',
                boxSizing: 'border-box', position: 'relative',
                zIndex: black ? 1 : 0,
              }}
            >
              {isC && (
                <span style={{ fontSize: 7, color: hover ? '#fff' : 'var(--text-muted)', letterSpacing: '0.04em', paddingRight: 2 }}>
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
  clip, beatW, scrollLeft, trackColor, selectedNotes, onVelocityChange, field = 'velocity',
}: {
  clip: MidiClip
  beatW: number
  scrollLeft: number
  trackColor: string
  selectedNotes: Set<string>
  /** Receives the value in the lane's units: velocity 1..127, deviation 0..127, chance 0..100. */
  onVelocityChange: (noteId: string, value: number) => void
  /** Which expression the lane shows (lib/note-chance.ts). */
  field?: LaneField
}) {
  const MAX = LANE_MAX[field]
  const valueOf = (n: MidiNote) => laneValue(n, field)
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
    return Math.max(field === 'velocity' ? 1 : 0, Math.min(MAX, Math.round((1 - relY / (VELOCITY_H - 4)) * MAX)))
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
            onVelocityChange(note.id, Math.max(0, Math.min(MAX, Math.round(startVel + (endVel - startVel) * t))))
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
    const startV = initialNote ? valueOf(initialNote) : Math.round(MAX / 2)
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
        onVelocityChange(initialNote.id, Math.max(0, Math.min(MAX, Math.round(startV + delta * MAX))))
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
      data-help-id="note-lane"
      data-lane={field}
      style={{
        height: VELOCITY_H, background: 'var(--bg-base)',
        borderTop: '1px solid var(--border)',
        position: 'relative', overflow: 'hidden', cursor: 'crosshair',
      }}
    >
      {clip.notes.map(note => {
        const x = note.startBeat * beatW - scrollLeft
        const h = (valueOf(note) / MAX) * (VELOCITY_H - 4)
        return (
          <div
            key={note.id}
            style={{
              position: 'absolute',
              left: x, bottom: 2,
              width: Math.max(3, (note.durationBeats * beatW) - 2),
              height: h,
              background: field === 'chance' ? '#f59e0b' : field === 'deviation' ? '#38bdf8' : trackColor,
              borderRadius: '1px 1px 0 0',
              opacity: selectedNotes.has(note.id) ? 1 : 0.65,
              pointerEvents: 'none',
            }}
            title={field === 'chance' ? `Chance: ${valueOf(note)}%` : field === 'deviation' ? `Deviation: ±${valueOf(note)}` : `Velocity: ${valueOf(note)}`}
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
        const rel = engine.displayBeat - clipStart
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

  const [toolChoice, setToolChoice] = useState<Exclude<Tool, 'draw'>>('edit')
  // Draw Mode is the studio's (lib/draw-mode.ts, `B`): while it is on, the
  // pencil is the tool whatever the toolbar says; the last velocity drawn
  // is what the next note gets.
  const draw = useDrawMode()
  const tool: Tool = draw.on ? 'draw' : toolChoice
  const setTool = (t: Tool) => { if (t === 'draw') toggleDrawMode(); else { if (draw.on) toggleDrawMode(); setToolChoice(t) } }
  const lastVelRef = useRef(100)
  const [quant, setQuant] = useState<Quant>(0.25)
  const isMobile = useIsMobile()
  const mobileRoll = typeof window !== 'undefined' && window.innerWidth < 760
  // Restore this clip's last zoom/scroll so reopening lands where you left off
  // (avoids the "zoom resets every time" flaw). Cache lives for the session.
  const cached = rollViewCache.get(clip.id)
  const [beatW, setBeatW] = useState(cached?.beatW ?? 80)
  const [noteH, setNoteH] = useState(cached?.noteH ?? (mobileRoll ? 22 : NOTE_H))
  const [scrollTop, setScrollTop]   = useState(cached?.scrollTop ?? (clip.isDrumClip ? 0 : NUM_NOTES / 2 * (mobileRoll ? 22 : NOTE_H) - 80))
  const [scrollLeft, setScrollLeft] = useState(cached?.scrollLeft ?? 0)
  useEffect(() => { rollViewCache.set(clip.id, { beatW, noteH, scrollTop, scrollLeft }) }, [clip.id, beatW, noteH, scrollTop, scrollLeft])
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set())
  // Which expression lane shows under the grid, and the Randomize amount.
  const [lane, setLane] = useState<LaneField>('velocity')
  const [randAmount, setRandAmount] = useState(25)
  const selectedList = () => clip.notes.filter(n => selectedNotes.has(n.id))
  function nudgeLane(field: LaneField, delta: number) {
    const sel = selectedList()
    if (!sel.length) return
    dispatch({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: sel.map(n => ({ id: n.id, patch: lanePatch(field, laneValue(n, field) + delta) })) })
  }
  function randomizeSelected() {
    const sel = selectedList()
    if (!sel.length) return
    // A new seed each press, so pressing again reshuffles; the seed rides in
    // the ids so a render of the result is still deterministic.
    dispatch({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: randomizeLane(sel, lane, randAmount, `${clip.id}:${Date.now()}`) })
  }
  function rampSelected() {
    const sel = selectedList()
    if (sel.length < 2) return
    const sorted = [...sel].sort((a, b) => a.startBeat - b.startBeat)
    dispatch({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: rampLane(sel, lane, laneValue(sorted[0], lane), laneValue(sorted[sorted.length - 1], lane)) })
  }
  // ⌘G: Play One → Play All → ungroup, for the selected notes.
  const groupLabel = (() => {
    const sel = selectedList()
    if (!sel.length) return null
    const g = sel[0].chanceGroup
    if (!g || !sel.every(n => n.chanceGroup === g)) return null
    return clip.chanceGroups?.[g] === 'all' ? 'Play All' : 'Play One'
  })()
  function cycleGroup() {
    const sel = selectedList()
    if (!sel.length) return
    const g = sel[0].chanceGroup
    const shared = !!g && sel.every(n => n.chanceGroup === g)
    const ids = sel.map(n => n.id)
    if (!shared) { dispatch({ type: 'SET_CHANCE_GROUP', clipId: clip.id, noteIds: ids, group: crypto.randomUUID().slice(0, 8), mode: 'one' }); return }
    const mode = clip.chanceGroups?.[g!] ?? 'one'
    if (mode === 'one') dispatch({ type: 'SET_CHANCE_GROUP', clipId: clip.id, noteIds: ids, group: g!, mode: 'all' })
    else dispatch({ type: 'SET_CHANCE_GROUP', clipId: clip.id, noteIds: ids, group: null })
  }
  const [hoverPitch, setHoverPitch] = useState<number | null>(null)
  const [hoverEdge, setHoverEdge]   = useState(false)
  const [ctxMenu, setCtxMenu] = useState<{ note: MidiNote; x: number; y: number } | null>(null)
  const [presets, setPresets]           = useState<MidiPreset[]>([])
  const [showPresetPicker, setShowPresetPicker] = useState(false)
  // ── The Samples tab ────────────────────────────────────────────────────
  // Brae: "a samples tab when the user clicks on presets in the piano roll".
  // One library sound, pitched from its root across the keys — see
  // lib/sample-preset.ts. The library is read when the tab opens, not before.
  const [pickerTab, setPickerTab] = useState<'presets' | 'samples'>('presets')
  const [sampleQuery, setSampleQuery] = useState('')
  const [pickerSamples, setPickerSamples] = useState<PickableSound<LibraryEntry>[]>([])
  const [pickerSamplesLoading, setPickerSamplesLoading] = useState(false)
  /** Roots the user corrected, by sample id — the guess is only a guess. */
  const [sampleRoots, setSampleRoots] = useState<Record<string, number>>({})
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
  const [npSound,   setNpSound]   = useState<RollFx | undefined>(undefined)
  const [npGraphs,  setNpGraphs]  = useState<PitchGraph[]>([])
  const [npShare,   setNpShare]   = useState(false)
  const [npDesc,    setNpDesc]    = useState('')

  // ── New feature state
  const [chordType, setChordType] = useState<string | null>(null)
  // Default scale-lock ON for melodic clips on a phone: taps snap to the key so
  // beginners can't hit a wrong note (toggle is in the toolbar). Desktop off.
  const [scaleLock, setScaleLock] = useState(mobileRoll && !clip.isDrumClip)
  const inScalePitches = getInScalePitches(project.key, project.scale)

  // Pitch & Time (lib/pitch-time.ts). With the scale on, pitch moves are in
  // scale degrees — Live 12's rule — and the interval field means degrees.
  const scaleOn = scaleLock && !clip.isDrumClip && project.scale !== 'chromatic'
  const rollScale: Scale = { root: project.key, intervals: SCALE_INTERVALS[project.scale] ?? SCALE_INTERVALS['major'] }
  const [intervalSemis, setIntervalSemis] = useState(7)
  const [intervalDegrees, setIntervalDegrees] = useState(2)
  const intervalSize = scaleOn ? intervalDegrees : intervalSemis
  const setIntervalSize = scaleOn ? setIntervalDegrees : setIntervalSemis
  const [stretchFactor, setStretchFactor] = useState(1)
  const [lengthBeats, setLengthBeats] = useState(0.5)
  const [humanizeAmount, setHumanizeAmount] = useState(50)
  const [ptAnchor, setPtAnchor] = useState<{ x: number; y: number } | null>(null)
  const ptBtnRef = useRef<HTMLButtonElement>(null)
  const humanizeRuns = useRef(0)

  // Note surgery (lib/note-ops.ts): E held = the split tool; Chop's part count;
  // Find & Select (lib/find-notes.ts) with its bar open or closed.
  const [splitting, setSplitting] = useState(false)
  const [chopParts, setChopParts] = useState(2)
  // Quantize Settings (lib/quantize.ts) — persisted; Q and ⌘U use them.
  const qSettings = useQuantizeSettings()
  const [qAnchor, setQAnchor] = useState<{ x: number; y: number } | null>(null)
  const qBtnRef = useRef<HTMLButtonElement>(null)
  // The loop brace (lib/clip-time.ts): selected, it takes the arrow chords.
  const [braceSelected, setBraceSelected] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [filter, setFilter] = useState<NoteFilter>({})
  // A selection asked for from outside — the voice, the palette — parked
  // until this roll can take it (lib/note-selection.ts).
  const selReq = useNoteSelectionRequest()
  useEffect(() => {
    if (!selReq || selReq.clipId !== clip.id) return
    const have = new Set(clip.notes.map(n => n.id))
    setSelectedNotes(new Set(selReq.noteIds.filter(id => have.has(id))))
    consumeNoteSelection(selReq)
  }, [selReq, clip.id, clip.notes])

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
  // Fold (F), Fold to Scale (G), Highlight Scale (K) — lib/roll-rows.ts. The
  // rows are the pitches shown, top to bottom; everything that maps a row to
  // a pitch or a pitch to a y goes through them, so a folded roll and the
  // full one are the same code.
  const [fold, setFold] = useState(false)
  const [foldScale, setFoldScale] = useState(false)
  const [highlightScale, setHighlightScale] = useState(true)
  const rows = isDrum ? [] : visibleRows({ fold, foldScale, inScale: inScalePitches, notes: clip.notes })
  const rowIndex = rowIndexOf(rows)
  const rowCount = isDrum ? DRUM_LANES.length : rows.length
  const yToPitch = (y: number): number | null => {
    const row = Math.floor(y / rowH)
    if (row < 0 || row >= rowCount) return null
    return isDrum ? DRUM_LANES[row].pitch : rows[row]
  }
  const pitchToY = (pitch: number): number | null => {
    if (!isDrum) { const r = rowIndex.get(pitch); return r === undefined ? null : r * rowH }
    const row = DRUM_PITCH_TO_ROW.get(pitch)
    return row === undefined ? null : row * rowH
  }
  // Focus (N): scroll to where the notes are.
  function focusNotes() {
    const top = focusScrollTop(rows, clip.notes, rowH, gridRef.current?.clientHeight ?? 300)
    if (top != null) setScrollTop(top)
  }
  // Step entry: with it on, playing a key writes a note at the insert marker
  // and the marker advances by the grid; ← / → move the marker.
  const [stepEntry, setStepEntry] = useState(false)
  const [stepBeat, setStepBeat] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => { rootRef.current?.focus() }, [])

  useEffect(() => { setPresets(combinePresets(project.presets)) }, [project.presets])

  // Default note sound: a clip with no preset on a track with no instrument
  // would play silently — assign the built-in Piano preset so drawn notes
  // always sound. (Clips on instrument tracks keep playing the instrument.)
  useEffect(() => {
    if (clip.presetId || clip.isDrumClip) return
    if (track && track.instrument.type !== 'none') return
    const id = defaultPresetId()
    if (id) {
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId: id } })
      engine.setPresets(combinePresets(project.presets))
    }
  }, [clip.presetId, clip.isDrumClip, clip.id, track, dispatch, engine, project.presets])

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

  async function loadPickerSamples() {
    setPickerSamplesLoading(true)
    try {
      const all = await libraryGetAll()
      // One row per SOUND: a seeded synth arrives as one entry per note, and
      // "Arp A3, Arp C4, Arp E4" is one arp. Your own sounds first — recordings,
      // imports, bounces — then the catalog, which is thousands deep and found
      // by searching.
      const picks = collapseNoteVariants(all.filter(isPickableSample))
      picks.sort((a, b) => Number(!!a.entry.catalog) - Number(!!b.entry.catalog) || (a.entry.folder ?? '').localeCompare(b.entry.folder ?? '') || a.name.localeCompare(b.name))
      setPickerSamples(picks)
    } catch { setPickerSamples([]) }
    finally { setPickerSamplesLoading(false) }
  }

  /** The sample at its root — what "Use" will put under the keys. */
  async function previewSample(entry: LibraryEntry, root: number) {
    if (previewing || !engine.ctx) return
    setPreviewing(true)
    try {
      const fulfilled = await libraryFulfill(entry.id)
      if (!fulfilled?.audioBlob || !engine.ctx) return
      const raw = await engine.ctx.decodeAudioData(await fulfilled.audioBlob.arrayBuffer())
      // Heard at middle C when the root is within reach, so two samples can
      // be compared at one pitch; at the root itself when it is not.
      const semis = Math.abs(60 - root) <= 12 ? 60 - root : 0
      const buf = semis === 0 ? raw : await resampleBySemitones(raw, semis, { sampleRate: engine.ctx.sampleRate })
      const src = engine.ctx.createBufferSource()
      src.buffer = buf
      playClickFree(engine.ctx, src, engine.masterGain, 1.5)
    } catch { /* ignore */ } finally {
      setTimeout(() => setPreviewing(false), 1200)
    }
  }

  /** Make the sample this clip's sound: a preset that names it and its root,
   *  embedded in the project so it travels with the song. */
  function useSample(entry: LibraryEntry, root: number, name?: string) {
    const p = addPreset(samplePresetFor(entry, { rootNote: root, name }))
    dispatch({ type: 'ADD_PRESET', preset: p })
    const next = combinePresets([...(project.presets ?? []), p])
    setPresets(next)
    engine.setPresets(next)
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId: p.id } })
    setShowPresetPicker(false)
    setPickerTab('presets')
  }

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
      // A sample preset: the one recording, repitched from its root.
      if (preset.sampleId) {
        const fulfilled = await libraryFulfill(preset.sampleId)
        if (!fulfilled?.audioBlob || !engine.ctx) return
        const raw = await engine.ctx.decodeAudioData(await fulfilled.audioBlob.arrayBuffer())
        const semis = target - (preset.rootNote ?? 60)
        const buf = semis === 0 ? raw : await resampleBySemitones(raw, semis, { sampleRate: engine.ctx.sampleRate })
        const src = engine.ctx.createBufferSource()
        src.buffer = buf
        playClickFree(engine.ctx, src, engine.masterGain, 1.5)
        return
      }
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
      playClickFree(engine.ctx, src, engine.masterGain, 1.5)
    } catch { /* ignore */ } finally {
      setTimeout(() => setPreviewing(false), 1500)
    }
  }

  const gridRef   = useRef<HTMLDivElement>(null)
  const bodyRef   = useRef<HTMLDivElement>(null)
  const selBoxRef = useRef<{ startX: number; startY: number; endX: number; endY: number } | null>(null)

  // Scroll containment. React attaches onWheel as a PASSIVE listener (React 19),
  // so preventDefault() inside it is a no-op and wheeling the roll also scrolls
  // the page. Attach our own NON-passive wheel listener to the body so wheel
  // (over keys, grid, or velocity lane) only ever scrolls/zooms the roll and
  // never chains to the viewport. Dynamic row metrics come from a ref.
  const wheelMetrics = useRef({ rowCount: 0, rowH: 0 })
  wheelMetrics.current = { rowCount, rowH }
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) { setBeatW(w => Math.max(20, Math.min(200, w * (e.deltaY < 0 ? 1.15 : 0.87)))); e.preventDefault(); return }
      if (e.altKey) { zoomVertical(e.deltaY < 0 ? 1.25 : 0.8); e.preventDefault(); return }
      e.preventDefault()
      if (Math.abs(e.deltaX) > 0) setScrollLeft(sl => Math.max(0, sl + e.deltaX))
      const { rowCount, rowH } = wheelMetrics.current
      const max = Math.max(0, rowCount * rowH - (gridRef.current?.clientHeight ?? 0))
      setScrollTop(s => Math.max(0, Math.min(max, s + e.deltaY * 0.5)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])
  // FL-style "new notes inherit the last length": remembers the duration you
  // last drew or resized a note to; a plain click reuses it. 0 = unset → falls
  // back to the grid snap, so behaviour is unchanged until you set a length.
  const lastNoteLenRef = useRef(0)
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  function snapBeat(b: number) { return Math.round(b / quant) * quant }
  // Holding ⌥ (alt) bypasses grid snap for free positioning
  function snapUnless(free: boolean, b: number) { return free ? b : snapBeat(b) }

  // Step entry: a played key becomes a note at the insert marker.
  function stepWrite(pitch: number) {
    const note: MidiNote = { id: crypto.randomUUID(), pitch, startBeat: stepBeat, durationBeats: quant, velocity: lastVelRef.current }
    dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note })
    setSelectedNotes(new Set([note.id]))
    setStepBeat(b => stepAdvance(b, quant, clip.durationBeats))
  }
  async function playNote(pitch: number) {
    if (stepEntry) stepWrite(pitch)
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
            playClickFree(engine.ctx, src, engine.masterGain, 1.5)
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
      // Bundle the sound shaping + pitch graphs onto the preset so every note
      // that uses it inherits them (and they travel on a community share).
      const fx = npSound && Object.keys(npSound).length ? npSound : undefined
      const graphs = npGraphs.filter(g => g.points.length >= 1)
      const sound: PresetSound | undefined = (fx || graphs.length)
        ? { ...(fx ? { fx } : {}), ...(graphs.length ? { pitchGraphs: graphs } : {}) }
        : undefined
      const p = addPreset({ name, folder, loNote: lo, hiNote: hi, category: 'custom', sound })
      dispatch({ type: 'ADD_PRESET', preset: p })   // embed in the project so the sound travels with the .cfproj
      setPresets(combinePresets(project.presets))
      engine.setPresets(combinePresets(project.presets)) // engine resolves presets from its own list — keep it current
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId: p.id } })
      if (npShare) {
        try { await sharePreset(p, npDesc.trim() || `${name} — custom preset`) }
        catch (e) { alert(`Preset created, but sharing failed: ${e instanceof Error ? e.message : e}`) }
      }
      setShowNewPreset(false); setNpName(''); setNpFolder(''); setNpSfText(null); setShowPresetPicker(false)
      setNpSound(undefined); setNpGraphs([]); setNpShare(false); setNpDesc('')
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
  // Left-edge grab zone: mirror of the right, but never overlapping it (so the
  // right edge wins on tiny notes). Dragging it moves the note's START, end fixed.
  function isNoteLeftEdge(n: MidiNote, rawBeat: number): boolean {
    const edgeBeats = Math.min(n.durationBeats * 0.4, 8 / beatW)
    return rawBeat <= n.startBeat + edgeBeats && rawBeat < n.startBeat + n.durationBeats - edgeBeats
  }

  // Marquee drag shared by Edit (shift+drag select) and Erase (drag erase):
  // draws the rubber-band rect and reports the swept note ids on mouseup.
  function startMarquee(e: React.MouseEvent<HTMLDivElement>, rect: DOMRect, onDone: (ids: Set<string>) => void) {
    // Suppress the browser's own drag-selection rectangle — without this a
    // shift-drag drew the native text/element selection box UNDER our marquee,
    // so two boxes appeared.
    e.preventDefault()
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
          const row = isDrum ? DRUM_PITCH_TO_ROW.get(n.pitch) : rowIndex.get(n.pitch)
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
    if (braceSelected) setBraceSelected(false)

    // E held: the split tool (lib/note-ops.ts). A click splits the note under
    // the pointer where it was clicked; a drag splits every note the pointer
    // crosses, each at the x it was crossed. ⌥ leaves the cut off the grid.
    if (splitting) {
      const done = new Set<string>()
      const cutOne = (n: MidiNote | undefined, at: number) => {
        if (!n || done.has(n.id)) return
        done.add(n.id)
        const s = splitAt([n], at, newNoteId)
        if (s.add.length) dispatch({ type: 'SPLICE_MIDI_NOTES', clipId: clip.id, remove: s.remove, add: s.add })
      }
      cutOne(noteAt(rawBeat, pitch), beat)
      const onSplitMove = (ev: MouseEvent) => {
        const rb = (ev.clientX - rect.left + scrollLeft) / beatW
        const p = yToPitch(ev.clientY - rect.top + scrollTop)
        if (p === null) return
        cutOne(noteAt(rb, p), snapUnless(ev.altKey, rb))
      }
      const onSplitUp = () => { document.removeEventListener('mousemove', onSplitMove); document.removeEventListener('mouseup', onSplitUp) }
      document.addEventListener('mousemove', onSplitMove)
      document.addEventListener('mouseup', onSplitUp)
      return
    }

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
              lastNoteLenRef.current = dur
              dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: t.id, patch: { durationBeats: dur } })
            }
          }
          function onResizeUp() {
            document.removeEventListener('mousemove', onResizeMove)
            document.removeEventListener('mouseup', onResizeUp)
            settleOverlaps(targets.map(t => t.id))
          }
          document.addEventListener('mousemove', onResizeMove)
          document.addEventListener('mouseup', onResizeUp)
          return
        }

        // Grabbing the LEFT edge moves the note's start (end stays fixed) — drag
        // left to lengthen, right to shorten. Resizes the whole selection too.
        if (isNoteLeftEdge(existing, rawBeat)) {
          const targets = (selectedNotes.has(existing.id) ? clip.notes.filter(n => selectedNotes.has(n.id)) : [existing])
            .map(n => ({ id: n.id, start: n.startBeat, end: n.startBeat + n.durationBeats }))
          setSelectedNotes(prev => prev.has(existing.id) ? prev : new Set([existing.id]))
          const startX = e.clientX
          function onLeftMove(ev: MouseEvent) {
            const delta = (ev.clientX - startX) / beatW
            for (const t of targets) {
              const newStart = Math.max(0, Math.min(t.end - 0.125, snapUnless(ev.altKey, t.start + delta)))
              const dur = t.end - newStart
              lastNoteLenRef.current = dur
              dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: t.id, patch: { startBeat: newStart, durationBeats: dur } })
            }
          }
          function onLeftUp() {
            document.removeEventListener('mousemove', onLeftMove)
            document.removeEventListener('mouseup', onLeftUp)
            settleOverlaps(targets.map(t => t.id))
          }
          document.addEventListener('mousemove', onLeftMove)
          document.addEventListener('mouseup', onLeftUp)
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
            settleOverlaps(origins.map(o => o.id))
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
          settleOverlaps([existingId])
        }
        document.addEventListener('mousemove', onMoveExisting)
        document.addEventListener('mouseup', onUpExisting)
        return
      }

      // Empty grid: shift+drag marquee-selects, plain click draws a note.
      // Shift = ADD, so each marquee UNIONS with the current selection — you can
      // shift-drag several boxes in a row without the earlier ones deselecting.
      if (e.shiftKey) {
        startMarquee(e, rect, ids => setSelectedNotes(prev => new Set([...prev, ...ids])))
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
              durationBeats: lastNoteLenRef.current || quant,
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
        durationBeats: lastNoteLenRef.current || quant,
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
        lastNoteLenRef.current = dur
        dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId, patch: { durationBeats: dur } })
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    }

    if (tool === 'draw') {
      // ── The pencil (lib/draw-notes.ts) ──────────────────────────────
      // A click on a note erases it; on empty grid it places a grid-length
      // note, and dragging across places one per step (on one pitch with
      // Pitch Lock, ⌥ flips it for this stroke), dragging up or down first
      // sets the velocity, dragging back erases.
      const under = noteUnder(clip.notes, rawBeat, pitch)
      if (under) { dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: under.id }); return }
      if (clip.loopEnabled && clip.loopLengthBeats && beat >= clip.loopLengthBeats) return
      const lockPitch = e.altKey ? !draw.pitchLock : draw.pitchLock
      const startPitch = scaleLock && !isDrum ? snapToScale(pitch, project.key, project.scale) : pitch
      const stroke: Stroke = beginStroke(rawBeat, startPitch, quant, lastVelRef.current, lockPitch, clip.loopEnabled && clip.loopLengthBeats ? clip.loopLengthBeats : undefined)
      const first = strokeTo(stroke, rawBeat, startPitch, () => crypto.randomUUID())
      for (const n of first.add) dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: n })
      if (first.add.length) playNote(first.add[0].pitch)
      const startX = e.clientX, startY = e.clientY
      let mode: 'none' | 'across' | 'velocity' = 'none'
      function onMove(ev: MouseEvent) {
        const dx = ev.clientX - startX, dy = ev.clientY - startY
        if (mode === 'none') {
          if (Math.abs(dx) >= 4 || Math.abs(dy) >= 4) mode = Math.abs(dx) >= Math.abs(dy) ? 'across' : 'velocity'
          else return
        }
        if (mode === 'velocity') {
          const v = velocityFromDrag(stroke.velocity, dy)
          lastVelRef.current = v
          for (const n of stroke.placed.values()) dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch: { velocity: v } })
          return
        }
        const b = (ev.clientX - rect.left + scrollLeft) / beatW
        const p = yToPitch(ev.clientY - rect.top + scrollTop) ?? stroke.startPitch
        const pp = scaleLock && !isDrum ? snapToScale(p, project.key, project.scale) : p
        const { add, remove } = strokeTo(stroke, b, pp, () => crypto.randomUUID())
        for (const id of remove) dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: id })
        for (const n of add) { n.velocity = lastVelRef.current; dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: n }) }
        if (add.length) playNote(add[add.length - 1].pitch)
      }
      function onUp() {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        setSelectedNotes(new Set([...stroke.placed.values()].map(n => n.id)))
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
      return
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
      setHoverEdge(!!n && (isNoteEdge(n, rawBeat) || isNoteLeftEdge(n, rawBeat)))
    } else if (hoverEdge) {
      setHoverEdge(false)
    }
  }

  function pasteNotes(notes: MidiNote[], atBeat: number) {
    if (notes.length === 0) return
    const origin = Math.min(...notes.map(n => n.startBeat))
    const newIds = new Set<string>()
    for (const n of notes) {
      const startBeat = Math.max(0, atBeat + (n.startBeat - origin))
      // Pasting onto the exact same spot (double-paste, paste-at-playhead over
      // the source) would silently stack an identical note — doubling loudness
      // with nothing visible on the roll. Skip exact duplicates.
      if (clip.notes.some(x => x.pitch === n.pitch && Math.abs(x.startBeat - startBeat) < 1e-6 && Math.abs(x.durationBeats - n.durationBeats) < 1e-6)) continue
      const id = crypto.randomUUID()
      dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: { ...n, id, startBeat } })
      newIds.add(id)
    }
    setSelectedNotes(newIds)
    setTool('edit')
  }

  // ── Note tools ──────────────────────────────────────────────────────────────
  //
  // The piano roll had a real editing vocabulary and almost no words for it:
  // select-all, copy, cut, paste, duplicate, nudge and transpose were reachable
  // ONLY by keystroke, none of them written down anywhere in the interface.
  // Quantise is the exception and shows the subtler failure — there IS a button
  // labelled Quantize, but it sits greyed out until you have selected notes, so
  // the one state in which you go looking for it is the state in which it looks
  // unavailable. From the palette it now quantises the whole clip instead.
  //
  // Everything below acts on the SELECTED notes, or on the whole clip when
  // nothing is selected. That fallback matters: from the palette you have
  // usually just typed a word, not made a selection, and "Quantise" doing
  // nothing because you had not first dragged a marquee is the kind of silence
  // that reads as a bug.
  // A selection whose notes are gone (the clip was replaced under the roll,
  // or Add Interval's copies were undone) is no selection — every note, not none.
  const targetNotes = () => {
    const sel = selectedNotes.size ? clip.notes.filter(n => selectedNotes.has(n.id)) : []
    return sel.length ? sel : clip.notes
  }

  function patchNotes(fn: (n: MidiNote, i: number) => Partial<MidiNote> | null) {
    const notes = targetNotes()
    notes.forEach((n, i) => {
      const patch = fn(n, i)
      if (patch) dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch })
    })
  }

  /** Quantise with the settings (lib/quantize.ts): the grid — the editor's
   *  unless one is set — starts, ends or both, and the Amount. One undo step.
   *  `amount` overrides for the half-quantise command. */
  function quantizeNotes(amount?: number) {
    const s = amount == null ? qSettings : { ...qSettings, amount }
    const patches = quantizePatches(targetNotes(), s, quant)
    if (patches.length) dispatch({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: patches })
  }
  function openQuantizeSettings() {
    if (qAnchor) { setQAnchor(null); return }
    const r = qBtnRef.current?.getBoundingClientRect()
    setQAnchor(r ? { x: r.left, y: r.bottom + 6 } : { x: 240, y: 240 })
  }

  // The loop brace and the time commands (lib/clip-time.ts). The clip's own
  // time signature draws the bar lines; the song's stands in without one.
  const barBeats = project.timeSignatureNum || 4
  const clipBarBeats = clip.timeSignatureNum ? (clip.timeSignatureNum * 4) / (clip.timeSignatureDen || 4) : barBeats
  const brace = loopRange(clip)
  function setLoopLength(beats: number) {
    const L = Math.max(quant, Math.round(beats / quant) * quant)
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { loopEnabled: true, loopLengthBeats: L } })
  }
  function toggleLoop() {
    const on = !clip.loopEnabled
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: on
      ? { loopEnabled: true, loopLengthBeats: Math.max(quant, clip.loopLengthBeats ?? Math.min(clip.durationBeats, barBeats)) }
      : { loopEnabled: false, loopLengthBeats: undefined } })
    if (!on) setBraceSelected(false)
  }
  /** Set Loop End: the brace ends where the playhead is, snapped to the grid — a loop captured on the fly. */
  function setLoopEndHere() {
    const rel = engine.currentBeat - clip.startBeat
    if (rel > quant / 2) setLoopLength(rel)
  }
  function dupLoop() {
    const r = duplicateLoop(clip, newNoteId, barBeats)
    if (r) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: r })
  }
  function cropClip() {
    const { start, end } = workingRange(clip)
    if (start === 0 && end >= clip.durationBeats - 1e-6) return
    const r = cropToRange(clip, start, end)
    if (r) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: r })
  }
  function selectInLoop() {
    const { start, end } = workingRange(clip)
    setSelectedNotes(new Set(notesInRange(clip.notes, start, end).map(n => n.id)))
    setBraceSelected(false)
  }
  function timeCommand(op: 'insert' | 'delete' | 'duplicate') {
    const { start, end } = workingRange(clip)
    const span = end - start
    if (op === 'insert') dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: insertTime(clip.notes, end, span), durationBeats: clip.durationBeats + span } })
    else if (op === 'delete') {
      const newDur = Math.max(barBeats, clip.durationBeats - span)
      dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: deleteTime(clip.notes, start, end), durationBeats: newDur, ...(clip.loopLengthBeats ? { loopLengthBeats: Math.min(clip.loopLengthBeats, newDur) } : {}) } })
    } else dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: duplicateTime(clip.notes, start, end, newNoteId), durationBeats: clip.durationBeats + span } })
  }
  const rangeWord = brace ? 'the loop' : 'the clip'

  // The Pitch & Time utilities (lib/pitch-time.ts), on the selection or the
  // whole clip. Each is ONE UPDATE_MIDI_NOTES — one undo step — and the same
  // arithmetic the voice path runs, so "invert the lead" and the Invert button
  // cannot disagree.
  const patchMany = (patches: { id: string; patch: Partial<MidiNote> }[]) => {
    if (patches.length) dispatch({ type: 'UPDATE_MIDI_NOTES', clipId: clip.id, notes: patches })
  }
  /** Humanise: each start moved up to `humanizeAmount` % of half a grid step,
   *  earlier or later. A perfectly quantised part is the single clearest tell
   *  that music was typed rather than played. Seeded per run, so undo → redo
   *  gives the same performance back. Timing only — velocity's randomness is
   *  the deviation lane's, per pass. */
  function humanize() {
    humanizeRuns.current++
    patchMany(humanizeNotes(targetNotes(), humanizeAmount, quant, `${clip.id}:${humanizeRuns.current}`))
  }
  /** Up or down by scale degree when the scale is on (Live 12); a semitone otherwise. */
  function transposeStep(dir: 1 | -1) {
    if (isDrum) return
    patchMany(scaleOn ? transposeDegrees(targetNotes(), dir, rollScale) : transposeNotes(targetNotes(), dir))
  }
  function invert() { if (!isDrum) patchMany(invertNotes(targetNotes(), scaleOn ? rollScale : null)) }
  /** Backwards within the selection — or the whole clip when nothing is selected. */
  function reverse() {
    patchMany(reverseNotes(targetNotes(), selectedNotes.size ? undefined : { start: 0, end: clip.durationBeats }))
  }
  /** Add Interval: the copies are new notes, and they become the selection (Live). */
  function addIntervalNow() {
    if (isDrum) return
    const added = addInterval(targetNotes(), intervalSize, scaleOn ? rollScale : null, () => crypto.randomUUID())
    if (!added.length) return
    dispatch({ type: 'ADD_MIDI_NOTES', clipId: clip.id, notes: added })
    setSelectedNotes(new Set(added.map(n => n.id)))
  }
  function stretch(factor: number) { patchMany(stretchNotes(targetNotes(), factor)) }
  function applyLength(beats = lengthBeats) { patchMany(setLength(targetNotes(), beats)) }
  function openPitchTime() {
    if (ptAnchor) { setPtAnchor(null); return }
    const r = ptBtnRef.current?.getBoundingClientRect()
    setPtAnchor(r ? { x: r.left, y: r.bottom + 6 } : { x: 240, y: 240 })
  }

  // Note surgery (lib/note-ops.ts). A splice is one undo step; the pieces of
  // a split keep the first piece's id so the selection stays on it.
  const newNoteId = () => crypto.randomUUID()
  function splice(s: Splice, select?: 'added') {
    if (!s.remove.length && !s.add.length) return
    dispatch({ type: 'SPLICE_MIDI_NOTES', clipId: clip.id, remove: s.remove, add: s.add })
    if (select === 'added') setSelectedNotes(new Set(s.add.map(n => n.id)))
  }
  /** ⌘E: chop the selection on the grid; with nothing selected, split at the playhead (or the step marker). */
  function splitOrChop() {
    if (selectedNotes.size) { splice(chopOnGrid(targetNotes(), quant, newNoteId), 'added'); return }
    const rel = engine.currentBeat - clip.startBeat
    const at = stepEntry ? stepBeat : rel > 0 && rel < clip.durationBeats ? rel : null
    if (at == null) return
    splice(splitAt(clip.notes, at, newNoteId), 'added')
  }
  function chopSelected(parts = chopParts) { splice(chopNotes(targetNotes(), parts, newNoteId), 'added') }
  function joinSelected() { splice(joinNotes(targetNotes()), 'added') }
  /** ⌘⌥J: the selection scaled into the clip's loop, or the whole clip. */
  function fitSelectedToRange() {
    const end = clip.loopEnabled && clip.loopLengthBeats ? clip.loopLengthBeats : clip.durationBeats
    patchMany(fitToRange(targetNotes(), 0, end))
  }
  /** 0: deactivate the selection — or bring it back when any of it is off. */
  function toggleActive() {
    const t = targetNotes()
    patchMany(setActive(t, anyInactive(t)))
  }
  const findScale: Scale | null = project.scale !== 'chromatic' ? rollScale : null
  const found = useMemo(() => (filterIsEmpty(filter) ? [] : findNotes(clip.notes, filter, { scale: findScale })), [clip.notes, filter, findScale])
  function selectFound() { if (!filterIsEmpty(filter)) setSelectedNotes(new Set(found.map(n => n.id))) }
  /** Live's overlap rule, once a drag has ended (lib/note-ops.ts). */
  const settleOverlaps = (ids: string[]) => { if (ids.length) dispatch({ type: 'RESOLVE_NOTE_OVERLAPS', clipId: clip.id, noteIds: ids }) }

  /** Stretch every note to touch the next one that starts after it, so a line
   *  is joined rather than a row of separate blips. Notes with nothing after
   *  them are left alone. */
  function legato() {
    const notes = [...targetNotes()].sort((a, b) => a.startBeat - b.startBeat)
    notes.forEach(n => {
      const next = notes.find(m => m.startBeat > n.startBeat + 1e-6)
      if (!next) return
      const durationBeats = next.startBeat - n.startBeat
      if (durationBeats > 0.01 && Math.abs(durationBeats - n.durationBeats) > 1e-6) {
        dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch: { durationBeats } })
      }
    })
  }

  function transpose(semitones: number) {
    if (isDrum) return
    patchMany(transposeNotes(targetNotes(), semitones))
  }

  function scaleVelocity(mult: number) {
    // ⚠️ Velocity is 0–127. This clamped to 1.0 for a while, so "play harder"
    // quietly turned the notes it touched down to nothing.
    patchNotes(n => ({ velocity: Math.max(1, Math.min(127, Math.round((n.velocity ?? 100) * mult))) }))
  }

  function scaleLength(mult: number) {
    patchNotes(n => ({ durationBeats: Math.max(0.0625, n.durationBeats * mult) }))
  }

  /** Pull every out-of-key note to the nearest note that IS in key. Uses the
   *  project's key and scale — the same pair the roll already shades the rows
   *  with, so what this does matches what you can already see. */
  function fitToScale() {
    if (isDrum) return
    patchNotes(n => {
      if (inScalePitches.has(n.pitch % 12)) return null
      for (let d = 1; d <= 6; d++) {
        if (inScalePitches.has((n.pitch - d + 120) % 12)) return { pitch: n.pitch - d }
        if (inScalePitches.has((n.pitch + d) % 12)) return { pitch: n.pitch + d }
      }
      return null
    })
  }

  const rollScope = selectedNotes.size ? `${selectedNotes.size} selected notes` : 'every note in this clip'
  useRegisterCommands([
    { id: 'roll.quantize', group: 'Notes', label: `Quantise ${rollScope} — ${describeQuantize(qSettings, quant)}`,
      keywords: 'snap align tighten timing grid straighten on beat q', shortcut: 'Q',
      run: () => quantizeNotes() },
    { id: 'roll.quantize.half', group: 'Notes', label: `Half-quantise ${rollScope} (keep some feel)`,
      keywords: 'snap partial strength loose groove timing halfway',
      run: () => quantizeNotes(50) },
    { id: 'roll.quantizeSettings', group: 'Notes', label: 'Quantize settings — grid, triplets, starts / ends, amount',
      keywords: 'quantize settings quantise settings grid triplet amount start end both dialog', shortcut: '⇧⌘U',
      run: openQuantizeSettings },
    { id: 'roll.humanize', group: 'Notes', label: `Humanise ${rollScope} — timing by up to ${humanizeAmount}% of the grid`,
      keywords: 'loosen feel random natural played not typed timing groove amount',
      run: humanize },
    { id: 'roll.legato', group: 'Notes', label: `Join ${rollScope} end to end (legato)`,
      keywords: 'legato connect smooth slur sustain fill gaps length',
      run: legato },
    { id: 'roll.fitScale', group: 'Notes', label: `Pull ${rollScope} into key`,
      keywords: 'scale key fix wrong notes tune correct in key',
      when: () => !isDrum, run: fitToScale },
    { id: 'roll.octaveUp', group: 'Notes', label: `Move ${rollScope} up an octave`,
      keywords: 'transpose octave higher pitch up 12', shortcut: '⇧↑',
      when: () => !isDrum, run: () => transpose(12) },
    { id: 'roll.octaveDown', group: 'Notes', label: `Move ${rollScope} down an octave`,
      keywords: 'transpose octave lower pitch down 12', shortcut: '⇧↓',
      when: () => !isDrum, run: () => transpose(-12) },
    { id: 'roll.semitoneUp', group: 'Notes', label: `Move ${rollScope} up a semitone`,
      keywords: 'transpose pitch up half step sharp', shortcut: '↑',
      when: () => !isDrum, run: () => transpose(1) },
    { id: 'roll.semitoneDown', group: 'Notes', label: `Move ${rollScope} down a semitone`,
      keywords: 'transpose pitch down half step flat', shortcut: '↓',
      when: () => !isDrum, run: () => transpose(-1) },
    { id: 'roll.louder', group: 'Notes', label: `Play ${rollScope} harder`,
      keywords: 'velocity louder accent stronger dynamics up',
      run: () => scaleVelocity(1.15) },
    { id: 'roll.softer', group: 'Notes', label: `Play ${rollScope} softer`,
      keywords: 'velocity quieter gentler dynamics down',
      run: () => scaleVelocity(0.87) },
    { id: 'roll.longer', group: 'Notes', label: `Make ${rollScope} twice as long`,
      keywords: 'length duration double stretch longer sustain',
      run: () => scaleLength(2) },
    { id: 'roll.shorter', group: 'Notes', label: `Make ${rollScope} half as long`,
      keywords: 'length duration halve shorten staccato shorter tighter',
      run: () => scaleLength(0.5) },
    // Pitch & Time (lib/pitch-time.ts) — the panel and each of its buttons.
    { id: 'roll.pitchTime', group: 'Notes', label: 'Pitch & Time utilities — invert, reverse, add interval, stretch, set length, humanise',
      keywords: 'pitch & time utilities panel notes box tools', when: () => !isDrum, run: openPitchTime },
    { id: 'roll.invert', group: 'Notes', label: `Invert ${rollScope} — highest becomes lowest${scaleOn ? ', in key' : ''}`,
      keywords: 'invert flip upside down mirror pitch contour', when: () => !isDrum, run: invert },
    { id: 'roll.reverse', group: 'Notes', label: `Reverse ${rollScope} — play it backwards`,
      keywords: 'reverse backwards retrograde mirror time', run: reverse },
    { id: 'roll.addInterval', group: 'Notes', label: `Add interval to ${rollScope} — a copy ${describeInterval(intervalSize, scaleOn)} away`,
      keywords: 'add interval harmonize harmonise stack copy third fifth octave chord voice', when: () => !isDrum, run: addIntervalNow },
    { id: 'roll.degreeUp', group: 'Notes', label: `Move ${rollScope} up a scale degree`,
      keywords: 'scale degree step in key up transpose diatonic', shortcut: '↑', when: () => scaleOn, run: () => transposeStep(1) },
    { id: 'roll.degreeDown', group: 'Notes', label: `Move ${rollScope} down a scale degree`,
      keywords: 'scale degree step in key down transpose diatonic', shortcut: '↓', when: () => scaleOn, run: () => transposeStep(-1) },
    { id: 'roll.stretch2', group: 'Notes', label: `Stretch ${rollScope} ×2 — half speed, positions and lengths together`,
      keywords: 'stretch double twice slower half speed time expand', run: () => stretch(2) },
    { id: 'roll.stretchHalf', group: 'Notes', label: `Stretch ${rollScope} ÷2 — double speed`,
      keywords: 'stretch halve squash faster double speed time compress', run: () => stretch(0.5) },
    { id: 'roll.setLength', group: 'Notes', label: `Set length — make ${rollScope} ${durationLabel(lengthBeats)} long`,
      keywords: 'set length duration same length every note fixed uniform', run: () => applyLength() },
    // Note surgery (lib/note-ops.ts).
    { id: 'roll.split', group: 'Notes', label: selectedNotes.size ? `Chop ${rollScope} on the grid` : 'Split the notes at the playhead',
      keywords: 'split cut chop grid divide slice notes e', shortcut: '⌘E', run: splitOrChop },
    { id: 'roll.chop', group: 'Notes', label: `Chop ${rollScope} into ${chopParts} parts`,
      keywords: 'chop split parts pieces divide equal notes', run: () => chopSelected() },
    { id: 'roll.chopMore', group: 'Notes', label: `Chop into more parts (${chopParts + 1})`,
      keywords: 'chop parts more count up', run: () => setChopParts(p => Math.min(64, p + 1)) },
    { id: 'roll.chopFewer', group: 'Notes', label: `Chop into fewer parts (${Math.max(2, chopParts - 1)})`,
      keywords: 'chop parts fewer count down', when: () => chopParts > 2, run: () => setChopParts(p => Math.max(2, p - 1)) },
    { id: 'roll.join', group: 'Notes', label: `Join ${rollScope} — one note per key`,
      keywords: 'join merge combine glue notes tie', shortcut: '⌘J', run: joinSelected },
    { id: 'roll.fitRange', group: 'Notes', label: `Fit ${rollScope} to ${clip.loopEnabled && clip.loopLengthBeats ? 'the loop' : 'the clip'}`,
      keywords: 'fit to time range fill loop clip stretch notes', shortcut: '⌘⌥J', run: fitSelectedToRange },
    { id: 'roll.deactivate', group: 'Notes', label: anyInactive(targetNotes()) ? `Activate ${rollScope} again` : `Deactivate ${rollScope} — keep them, silence them`,
      keywords: 'deactivate activate mute notes silence disable enable off on 0', shortcut: '0', run: toggleActive },
    // Find & Select (lib/find-notes.ts).
    { id: 'roll.find', group: 'Notes', label: findOpen ? 'Close Find & Select notes' : 'Find & Select notes — filter by pitch, velocity, chance, length, time, scale',
      keywords: 'find select notes filter search magnifier every nth quiet loud short long', run: () => setFindOpen(v => !v) },
    { id: 'roll.findSelect', group: 'Notes', label: `Select the ${found.length} notes the Find filter matches`,
      keywords: 'find select apply filter matches', when: () => !filterIsEmpty(filter), run: selectFound },
    // The loop brace and time commands (lib/clip-time.ts).
    { id: 'roll.loop', group: 'Notes', label: brace ? `Stop looping the clip (loops every ${+(brace.end / barBeats).toFixed(2)} bars)` : 'Loop the clip — repeat its pattern',
      keywords: 'loop the clip clip loop repeat pattern brace on off', run: toggleLoop },
    { id: 'roll.loopSetEnd', group: 'Notes', label: 'Set loop end at the playhead',
      keywords: 'set loop end length playhead capture on the fly brace', when: () => !!brace, run: setLoopEndHere },
    { id: 'roll.dupLoop', group: 'Notes', label: 'Duplicate loop — double it and copy its notes',
      keywords: 'duplicate loop duplicate the loop double loop brace copy repeat', shortcut: '⌘D', when: () => !!brace, run: dupLoop },
    { id: 'roll.crop', group: 'Notes', label: 'Crop the clip to its loop',
      keywords: 'crop clip loop trim cut outside remove', shortcut: '⇧⌘J', when: () => !!brace && brace.end < clip.durationBeats - 1e-6, run: cropClip },
    { id: 'roll.selectInLoop', group: 'Notes', label: 'Select the notes in the loop',
      keywords: 'select notes in the loop inside the loop material brace', shortcut: '⇧⌘L', when: () => !!brace, run: selectInLoop },
    { id: 'roll.insertTime', group: 'Notes', label: `Insert time — ${rangeWord}'s length of silence after it`,
      keywords: 'insert time silence gap push later clip loop', run: () => timeCommand('insert') },
    { id: 'roll.deleteTime', group: 'Notes', label: `Delete time — remove ${rangeWord}'s span and close the gap`,
      keywords: 'delete time remove span close gap cut clip loop', run: () => timeCommand('delete') },
    { id: 'roll.duplicateTime', group: 'Notes', label: `Duplicate time — copy ${rangeWord}'s span after itself`,
      keywords: 'duplicate time copy span repeat clip loop', run: () => timeCommand('duplicate') },
    { id: 'roll.clipSig', group: 'Notes', label: clip.timeSignatureNum ? `Clip time signature ${clip.timeSignatureNum}/${clip.timeSignatureDen || 4} — back to the song's` : 'Clip time signature — its own bar lines (choose in the Musical bar)',
      keywords: 'clip time signature clip signature meter bar lines', when: () => !!clip.timeSignatureNum, run: () => dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { timeSignatureNum: undefined, timeSignatureDen: undefined } }) },
    { id: 'roll.selectAll', group: 'Notes', label: 'Select every note in this clip',
      keywords: 'all everything notes select', shortcut: '⌘A',
      run: () => setSelectedNotes(new Set(clip.notes.map(n => n.id))) },
    { id: 'roll.deselect', group: 'Notes', label: 'Deselect the notes',
      keywords: 'none clear selection escape', shortcut: 'Esc',
      when: () => selectedNotes.size > 0, run: () => setSelectedNotes(new Set()) },
    { id: 'roll.delete', group: 'Notes', label: `Delete ${selectedNotes.size} selected notes`,
      keywords: 'remove erase notes clear', shortcut: '⌫',
      when: () => selectedNotes.size > 0,
      run: () => {
        selectedNotes.forEach(id => dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: id }))
        setSelectedNotes(new Set())
      } },
    { id: 'roll.duplicate', group: 'Notes', label: `Duplicate ${selectedNotes.size} selected notes`,
      keywords: 'copy repeat again notes double', shortcut: '⌘D',
      when: () => selectedNotes.size > 0,
      run: () => {
        const sel = clip.notes.filter(n => selectedNotes.has(n.id))
        if (!sel.length) return
        const span = Math.max(...sel.map(n => n.startBeat + n.durationBeats)) - Math.min(...sel.map(n => n.startBeat))
        pasteNotes(sel, Math.min(...sel.map(n => n.startBeat)) + span)
      } },
    // The expression lanes and probability groups (lib/note-chance.ts).
    { id: 'roll.lane.chance', group: 'Notes', label: 'Chance lane — how often each note plays',
      keywords: 'chance probability lane expression dice random sometimes', run: () => setLane('chance') },
    { id: 'roll.lane.deviation', group: 'Notes', label: 'Velocity deviation lane — random ± per pass',
      keywords: 'velocity deviation lane humanize random expression', run: () => setLane('deviation') },
    { id: 'roll.group', group: 'Notes', label: groupLabel ? `Probability group: ${groupLabel} → ${groupLabel === 'Play One' ? 'Play All' : 'ungroup'}` : 'Group the selected notes: Play One',
      keywords: 'probability group play one play all chance notes', when: () => selectedNotes.size > 0, run: cycleGroup },
    { id: 'roll.fold', group: 'Notes', label: fold ? 'Unfold the piano roll' : 'Fold the piano roll to the notes it uses', keywords: 'fold key tracks pitches used hide empty rows f', when: () => !isDrum, run: () => setFold(v => !v) },
    { id: 'roll.foldScale', group: 'Notes', label: foldScale ? 'Show every pitch again' : 'Fold the piano roll to the scale', keywords: 'fold scale key tracks in key hide g', when: () => !isDrum, run: () => setFoldScale(v => !v) },
    { id: 'roll.highlightScale', group: 'Notes', label: highlightScale ? 'Stop highlighting the scale' : 'Highlight the scale on the keys', keywords: 'highlight scale key tint root k', when: () => !isDrum, run: () => setHighlightScale(v => !v) },
    { id: 'roll.focus', group: 'Notes', label: 'Focus the piano roll on its notes', keywords: 'focus scroll to notes n center', when: () => !isDrum, run: focusNotes },
    { id: 'roll.stepEntry', group: 'Notes', label: stepEntry ? 'Step entry off' : 'Step entry — write notes one key at a time', keywords: 'step entry insert marker record keys one at a time', when: () => !isDrum, run: () => setStepEntry(v => !v) },
    { id: 'roll.close', group: 'Notes', label: 'Close the piano roll',
      keywords: 'hide dismiss done back arrangement',
      run: () => { setExpandedPianoRollClipId?.(null); setEditTarget?.(null) } },
  ], [clip.id, clip.notes, selectedNotes, rollScope, isDrum, quant, project.tempo, project.key, project.scale, groupLabel, fold, foldScale, highlightScale, stepEntry, scaleOn, intervalSize, lengthBeats, humanizeAmount, ptAnchor, chopParts, findOpen, filter, found, clip.loopEnabled, clip.loopLengthBeats, qSettings, qAnchor, braceSelected, clip.durationBeats, clip.timeSignatureNum, clip.timeSignatureDen, barBeats])

  function handleKeyDown(e: React.KeyboardEvent) {
    const selected = clip.notes.filter(n => selectedNotes.has(n.id))
    // What this key means in the roll, from the one table (lib/keymap.ts).
    const kb = resolveKey(e, ['roll'])?.id

    // The loop brace, selected (lib/clip-time.ts): ⌘← / ⌘→ shorten / lengthen
    // by the grid, ⌘↑ / ⌘↓ double / halve, ⌘D duplicates the loop, Esc lets go.
    if (braceSelected && brace) {
      if (kb === 'loop.shorter' || kb === 'loop.longer') { e.preventDefault(); e.stopPropagation(); setLoopLength(brace.end + (kb === 'loop.longer' ? quant : -quant)); return }
      if (kb === 'notes.velUp' || kb === 'notes.velDown') { e.preventDefault(); e.stopPropagation(); setLoopLength(kb === 'notes.velUp' ? brace.end * 2 : brace.end / 2); return }
      if (kb === 'notes.duplicate') { e.preventDefault(); e.stopPropagation(); dupLoop(); return }
      if (kb === 'notes.deselect') { e.preventDefault(); e.stopPropagation(); setBraceSelected(false); return }
    }
    if (kb === 'notes.crop') { e.preventDefault(); e.stopPropagation(); cropClip(); return }
    if (kb === 'notes.selectInLoop') { e.preventDefault(); e.stopPropagation(); selectInLoop(); return }
    if (kb === 'notes.deselect') {
      setSelectedNotes(new Set())
      setChordType(null)
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (kb === 'notes.selectAll') {
      setSelectedNotes(new Set(clip.notes.map(n => n.id)))
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (kb === 'notes.delete' && selectedNotes.size > 0) {
      for (const noteId of selectedNotes) dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId })
      setSelectedNotes(new Set())
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (kb === 'notes.copy' && selected.length > 0) {
      _noteClipboard = selected.map(n => ({ ...n }))
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (kb === 'notes.cut' && selected.length > 0) {
      _noteClipboard = selected.map(n => ({ ...n }))
      for (const noteId of selectedNotes) dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId })
      setSelectedNotes(new Set())
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (kb === 'notes.paste' && _noteClipboard && _noteClipboard.length > 0) {
      // Paste at the playhead when it's inside this clip, else after existing notes
      const rel = engine.currentBeat - clip.startBeat
      const at = rel >= 0 && rel <= clip.durationBeats
        ? snapBeat(rel)
        : (clip.notes.length ? snapBeat(Math.max(...clip.notes.map(n => n.startBeat + n.durationBeats))) : 0)
      pasteNotes(_noteClipboard, at)
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (kb === 'notes.duplicate' && selected.length > 0) {
      const start = Math.min(...selected.map(n => n.startBeat))
      const end   = Math.max(...selected.map(n => n.startBeat + n.durationBeats))
      pasteNotes(selected, start + Math.max(quant, end - start))
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (kb === 'notes.quantize' && selectedNotes.size > 0) {
      quantizeNotes()
      e.preventDefault(); e.stopPropagation()
      return
    }
    if (kb === 'notes.quantizeSettings') { e.preventDefault(); e.stopPropagation(); openQuantizeSettings(); return }
    // Arrows: nudge time / transpose pitch (⇧ = octave; drums move by lane)
    // Fold (F), Fold to Scale (G), Highlight Scale (K), Focus (N) — lib/roll-rows.ts.
    // Note surgery (lib/note-ops.ts): E held is the split tool; ⌘E chops or
    // splits; ⌘J joins; ⌘⌥J fits; 0 deactivates.
    if (kb === 'notes.splitTool') { e.preventDefault(); e.stopPropagation(); if (!splitting) setSplitting(true); return }
    if (kb === 'notes.split') { e.preventDefault(); e.stopPropagation(); splitOrChop(); return }
    if (kb === 'notes.join') { e.preventDefault(); e.stopPropagation(); if (selected.length) joinSelected(); return }
    if (kb === 'notes.fitRange') { e.preventDefault(); e.stopPropagation(); if (selected.length) fitSelectedToRange(); return }
    // 0 with notes selected deactivates the notes; with none, the CLIP — the
    // arrangement's own 0 (Live's Clip Activator) cannot reach it while the
    // roll has focus, so it is done from here.
    if (kb === 'notes.deactivate') {
      e.preventDefault(); e.stopPropagation()
      if (selected.length) toggleActive()
      else dispatch({ type: 'SET_CLIPS_ACTIVE', clipIds: [clip.id], active: clip.active === false })
      return
    }
    if (kb === 'notes.fold') { e.preventDefault(); e.stopPropagation(); setFold(v => !v); return }
    if (kb === 'notes.foldScale') { e.preventDefault(); e.stopPropagation(); setFoldScale(v => !v); return }
    if (kb === 'notes.highlightScale') { e.preventDefault(); e.stopPropagation(); setHighlightScale(v => !v); return }
    if (kb === 'notes.focus') { e.preventDefault(); e.stopPropagation(); focusNotes(); return }
    // Step entry: with nothing selected, ← / → move the insert marker.
    if (stepEntry && selected.length === 0 && (kb === 'notes.earlier' || kb === 'notes.later')) {
      e.preventDefault(); e.stopPropagation()
      setStepBeat(b => stepMove(b, kb === 'notes.later' ? 1 : -1, quant, clip.durationBeats))
      return
    }
    // The expression lanes by key (lib/keymap.ts): ⌘↑↓ velocity, ⇧⌘↑↓ deviation, ⌘⌥↑↓ chance, ⌘G group.
    if (kb === 'notes.velUp' || kb === 'notes.velDown' || kb === 'notes.devUp' || kb === 'notes.devDown' || kb === 'notes.chanceUp' || kb === 'notes.chanceDown') {
      e.preventDefault(); e.stopPropagation()
      const field: LaneField = kb.startsWith('notes.vel') ? 'velocity' : kb.startsWith('notes.dev') ? 'deviation' : 'chance'
      nudgeLane(field, kb.endsWith('Up') ? 5 : -5)
      setLane(field)
      return
    }
    if (kb === 'notes.group') { e.preventDefault(); e.stopPropagation(); cycleGroup(); return }
    if ((kb === 'notes.earlier' || kb === 'notes.later' || kb === 'notes.up' || kb === 'notes.down' || kb === 'notes.upOctave' || kb === 'notes.downOctave' || kb === 'notes.upSemitone' || kb === 'notes.downSemitone') && selected.length > 0) {
      e.preventDefault(); e.stopPropagation()
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const d = (e.key === 'ArrowLeft' ? -1 : 1) * quant
        for (const n of selected) {
          dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch: { startBeat: Math.max(0, n.startBeat + d) } })
        }
      } else {
        const dir = e.key === 'ArrowUp' ? 1 : -1
        if (isDrum) {
          for (const n of selected) {
            const row = DRUM_PITCH_TO_ROW.get(n.pitch) ?? 0
            const newPitch = DRUM_LANES[Math.max(0, Math.min(DRUM_LANES.length - 1, row - dir))].pitch
            dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch: { pitch: newPitch } })
          }
        } else if (e.shiftKey) transpose(dir * 12)
        // With the scale on, ↑ / ↓ climb the scale (Live 12); ⌥ is still a semitone.
        else if (e.altKey || !scaleOn) transpose(dir)
        else transposeStep(dir)
      }
      return
    }
  }

  // Two bars of headroom past the clip end: drawing there auto-extends the
  // clip (ADD_MIDI_NOTE grows durationBeats), so the canvas keeps growing.
  // ---- Touch (mobile): 1 finger = add + drag-to-length / move / erase;
  //      2 fingers = pan the roll + pinch-zoom. touchAction:'none' keeps the
  //      page from scrolling/zooming so these gestures drive the roll only. ----
  const touchRef = useRef<
    | { mode: 'add'; noteId: string; startBeat: number }
    | { mode: 'move'; noteId: string; sb: number; sp: number; spRow: number; startX: number; startY: number }
    | { mode: 'gesture'; startDist: number; startBeatW: number; midX: number; midY: number; startSL: number; startST: number }
    | null
  >(null)

  function gridPoint(t: { clientX: number; clientY: number }) {
    const rect = gridRef.current!.getBoundingClientRect()
    return {
      rawBeat: (t.clientX - rect.left + scrollLeft) / beatW,
      pitch: yToPitch(t.clientY - rect.top + scrollTop),
    }
  }

  function onGridTouchStart(e: React.TouchEvent<HTMLDivElement>) {
    if (!gridRef.current) return
    if (e.touches.length >= 2) {
      const a = e.touches[0], b = e.touches[1]
      touchRef.current = {
        mode: 'gesture',
        startDist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
        startBeatW: beatW,
        midX: (a.clientX + b.clientX) / 2,
        midY: (a.clientY + b.clientY) / 2,
        startSL: scrollLeft,
        startST: scrollTop,
      }
      return
    }
    const t = e.touches[0]
    const { rawBeat, pitch } = gridPoint(t)
    if (pitch === null) return
    const existing = noteAt(rawBeat, pitch)

    if (tool === 'erase') {
      if (existing) dispatch({ type: 'REMOVE_MIDI_NOTE', clipId: clip.id, noteId: existing.id })
      touchRef.current = null
      return
    }

    if (existing) {
      // Tap-drag an existing note to reposition it (pitch + start)
      setSelectedNotes(new Set([existing.id]))
      touchRef.current = {
        mode: 'move', noteId: existing.id,
        sb: existing.startBeat, sp: existing.pitch,
        spRow: isDrum ? (DRUM_PITCH_TO_ROW.get(existing.pitch) ?? 0) : 0,
        startX: t.clientX, startY: t.clientY,
      }
      return
    }

    // Empty cell → add a note, then drag right to set its length
    const beat = snapBeat(rawBeat)
    if (clip.loopEnabled && clip.loopLengthBeats && beat >= clip.loopLengthBeats) { touchRef.current = null; return }
    const finalPitch = scaleLock && !isDrum ? snapToScale(pitch, project.key, project.scale) : pitch

    if (chordType !== null) {
      const intervals = CHORD_INTERVALS[chordType]
      if (intervals) {
        for (const interval of intervals) {
          const np = finalPitch + interval
          if (np < 0 || np > 127) continue
          dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: { id: crypto.randomUUID(), pitch: np, startBeat: beat, durationBeats: lastNoteLenRef.current || quant, velocity: 80 } })
        }
        void playNote(finalPitch)
        touchRef.current = null
        return
      }
    }

    const id = crypto.randomUUID()
    dispatch({ type: 'ADD_MIDI_NOTE', clipId: clip.id, note: { id, pitch: finalPitch, startBeat: beat, durationBeats: lastNoteLenRef.current || quant, velocity: 100 } })
    setSelectedNotes(new Set([id]))
    void playNote(finalPitch)
    touchRef.current = { mode: 'add', noteId: id, startBeat: beat }
  }

  function onGridTouchMove(e: React.TouchEvent<HTMLDivElement>) {
    const st = touchRef.current
    if (!st) return

    if (st.mode === 'gesture' && e.touches.length >= 2) {
      const a = e.touches[0], b = e.touches[1]
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1
      const midX = (a.clientX + b.clientX) / 2
      const midY = (a.clientY + b.clientY) / 2
      setBeatW(Math.max(24, Math.min(320, st.startBeatW * (dist / st.startDist))))
      setScrollLeft(Math.max(0, st.startSL - (midX - st.midX)))
      const maxST = Math.max(0, rowCount * rowH - (gridRef.current?.clientHeight ?? 0))
      setScrollTop(Math.max(0, Math.min(maxST, st.startST - (midY - st.midY))))
      return
    }

    if (st.mode === 'add' && e.touches.length === 1) {
      const { rawBeat } = gridPoint(e.touches[0])
      const dur = Math.max(quant, snapBeat(rawBeat - st.startBeat))
      dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: st.noteId, patch: { durationBeats: dur } })
      return
    }

    if (st.mode === 'move' && e.touches.length === 1) {
      const t = e.touches[0]
      const db = (t.clientX - st.startX) / beatW
      const dRow = Math.round((t.clientY - st.startY) / rowH)
      const newPitch = isDrum
        ? DRUM_LANES[Math.max(0, Math.min(DRUM_LANES.length - 1, st.spRow + dRow))].pitch
        : Math.max(0, Math.min(127, st.sp - dRow))
      dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: st.noteId, patch: {
        startBeat: Math.max(0, snapBeat(st.sb + db)),
        pitch: newPitch,
      }})
      return
    }
  }

  function onGridTouchEnd(e: React.TouchEvent<HTMLDivElement>) {
    if (e.touches.length === 0) touchRef.current = null
  }

  const totalW = clip.durationBeats * beatW + (clip.loopEnabled ? 80 : 2 * (project.timeSignatureNum || 4) * beatW)

  return (
    <div
      ref={rootRef}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-surface)', outline: 'none' }}
      tabIndex={-1}
      data-help-id="piano-roll"
      data-clip-editor={clip.id}
      onKeyDown={handleKeyDown}
      onKeyUp={e => { if (splitting && resolveKey(e, ['roll'])?.id === 'notes.splitTool') setSplitting(false) }}
      onBlur={() => { if (splitting) setSplitting(false) }}
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
          {(['edit', 'draw', 'erase'] as Tool[]).map(t => (
            <button key={t} onClick={() => setTool(t)} data-help-id={t === 'draw' ? 'draw-mode' : undefined} aria-pressed={tool === t}
              title={t === 'edit'
                ? 'Edit — click empty: draw · drag note: move · shift+click: multi-select · shift+drag: box-select'
                : t === 'draw'
                  ? `Draw Mode (B; hold B to draw and let go) — click: a grid-length note · drag across: one note per step${draw.pitchLock ? ', on one pitch (⌥ frees it)' : ', following the pointer (⌥ locks it)'} · drag up/down: velocity · drag back: erase · click a note: erase`
                  : 'Erase — click a note or drag a box to delete'}
              style={{ ...prBtn, background: tool === t ? 'var(--bg-surface)' : 'transparent', color: tool === t ? 'var(--text-primary)' : 'var(--text-muted)', border: tool === t ? '1px solid var(--border)' : '1px solid transparent', fontSize: 9, padding: '2px 6px' }}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}

          <button onClick={() => setFindOpen(v => !v)} aria-pressed={findOpen} data-help-id="roll-find"
            title="Find & Select notes — a filter over the clip's notes (pitch, velocity, chance, length, time, every nth, condition, scale) that becomes the selection"
            style={{ ...prBtn, background: findOpen ? 'var(--bg-surface)' : 'transparent', color: findOpen ? 'var(--text-primary)' : 'var(--text-muted)', border: findOpen ? '1px solid var(--border)' : '1px solid transparent', fontSize: 9, padding: '2px 6px' }}>
            ⌕ Find
          </button>

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
            ref={qBtnRef}
            data-help-id="roll-quantize"
            onClick={() => quantizeNotes()}
            onContextMenu={e => { e.preventDefault(); openQuantizeSettings() }}
            disabled={selectedNotes.size === 0}
            title={`${selectedNotes.size ? `Quantize ${selectedNotes.size} selected note${selectedNotes.size === 1 ? '' : 's'}` : 'Select notes to quantize'} — ${describeQuantize(qSettings, quant)} (Q or ⌘U; right-click or ⇧⌘U for settings)`}
            style={{ ...prBtn, fontSize: 9, padding: '2px 6px', opacity: selectedNotes.size ? 1 : 0.4, cursor: selectedNotes.size ? 'pointer' : 'default' }}
          >Quantize</button>
          <button data-help-id="roll-quantize-settings" onClick={openQuantizeSettings} aria-pressed={!!qAnchor} title="Quantize Settings (⇧⌘U) — grid, triplets, starts / ends, amount"
            style={{ ...prBtn, fontSize: 9, padding: '2px 4px', color: qAnchor ? 'var(--accent-light)' : 'var(--text-muted)' }}>⚙</button>
          {qAnchor && (
            <QuantizeDialog anchor={qAnchor} settings={qSettings} editorGrid={quant} scope={rollScope}
              count={quantizePatches(targetNotes(), qSettings, quant).length}
              onChange={patch => setQuantizeSettings(patch)}
              onApply={() => { quantizeNotes(); setQAnchor(null) }}
              onClose={() => setQAnchor(null)} />
          )}

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
                      background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
                      padding: '6px 0', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
                      display: 'grid', gridTemplateColumns: '1fr 1fr 1fr',
                    }}>
                      {NOTE_NAMES.map((n, i) => (
                        <button key={n} onClick={() => transposeToRoot(i)}
                          style={{
                            padding: '6px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer', border: 'none',
                            background: (clip.rootNote ?? 0) === i ? 'rgb(var(--accent-rgb) / 0.2)' : 'transparent',
                            color: (clip.rootNote ?? 0) === i ? 'var(--accent-light)' : 'var(--text-secondary)',
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

          {!isDrum && <NoteFxSettings clip={clip} dispatch={dispatch} selectedNoteIds={selectedNotes} />}

          <SaveRecipeButton clip={clip} />

          {/* Preset picker */}
          <div style={{ position: 'relative' }} ref={presetPickerRef}>
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {clip.presetId && (
                <button
                  onClick={() => previewMiddleC(clip.presetId!)}
                  disabled={previewing}
                  title="Preview middle C of this preset"
                  style={{ ...prBtn, fontSize: 10, padding: '2px 5px', border: '1px solid rgb(var(--accent-rgb) / 0.4)', background: previewing ? 'rgb(var(--accent-rgb) / 0.25)' : 'rgb(var(--accent-rgb) / 0.10)', color: 'var(--accent-light)' }}
                ><Play size={12} /></button>
              )}
              <button
                onClick={() => setShowPresetPicker(v => !v)}
                style={{
                  ...prBtn, fontSize: 9, padding: '2px 8px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flexShrink: 0,
                  border: `1px solid ${clip.presetId ? 'rgb(var(--accent-rgb) / 0.5)' : 'var(--border)'}`,
                  background: clip.presetId ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent',
                  color: clip.presetId ? 'var(--accent-light)' : 'var(--text-muted)',
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
                const samplesTab = pickerTab === 'samples'
                const menuH = samplesTab ? 440 : Math.min(presets.length * 28 + 48, 260)
                const top = spaceBelow > menuH + 8 ? btn.bottom + 4 : Math.max(8, btn.top - menuH - 4)
                const tabBtn = (id: 'presets' | 'samples', label: string) => (
                  <button
                    key={id}
                    data-pr-picker-tab={id}
                    onClick={e => { e.stopPropagation(); setPickerTab(id); if (id === 'samples') void loadPickerSamples() }}
                    style={{
                      flex: 1, padding: '5px 0', fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em', cursor: 'pointer',
                      border: 'none', borderBottom: `2px solid ${pickerTab === id ? 'var(--accent)' : 'transparent'}`,
                      background: 'transparent', color: pickerTab === id ? 'var(--accent-light)' : 'var(--text-muted)',
                    }}
                  >{label}</button>
                )
                const q = sampleQuery.trim().toLowerCase()
                const matching = pickerSamples.filter(s => !q || `${s.name} ${s.entry.folder ?? ''} ${(s.entry.tags ?? []).join(' ')}`.toLowerCase().includes(q))
                // A catalog is thousands of rows; the menu draws the first
                // hundred and a half and says how many more a search would
                // reach — drawing all of them is what makes a click take a second.
                const SHOW_MAX = 150
                const shown = matching.slice(0, SHOW_MAX)
                const hidden = matching.length - shown.length
                const byFolder = new Map<string, typeof shown>()
                for (const s of shown) { const f = s.entry.folder || s.entry.parentFolder || 'Samples'; const g = byFolder.get(f) ?? []; g.push(s); byFolder.set(f, g) }
                return (
                  <div id="pr-preset-menu" style={{
                    position: 'fixed', top, right: window.innerWidth - btn.right,
                    width: samplesTab ? 340 : 248, zIndex: 9999,
                    background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
                    padding: '0 0 6px', boxShadow: '0 10px 28px rgba(0,0,0,0.75)',
                    maxHeight: samplesTab ? 440 : showNewPreset ? 480 : 280, overflowY: 'auto',
                    display: 'flex', flexDirection: 'column',
                  }}>
                    {/* Presets | Samples. Brae: "a samples tab when the user
                        clicks on presets in the piano roll" — one library
                        sample, played across the keys (lib/sample-preset.ts). */}
                    <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
                      {tabBtn('presets', 'PRESETS')}
                      {tabBtn('samples', 'SAMPLES')}
                    </div>
                    {samplesTab ? (
                      <div data-pr-samples style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
                        <div style={{ padding: '6px 8px 4px', display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                          <input
                            value={sampleQuery}
                            onChange={e => setSampleQuery(e.target.value)}
                            placeholder="Search your sounds…"
                            autoFocus
                            style={{ flex: 1, fontSize: 10, padding: '4px 7px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)' }}
                          />
                          <span style={{ fontSize: 8.5, color: 'var(--text-muted)', flexShrink: 0 }}>{pickerSamplesLoading ? 'loading…' : `${matching.length}`}</span>
                        </div>
                        <div style={{ padding: '0 10px 4px', fontSize: 8.5, color: 'var(--text-muted)', lineHeight: 1.35, flexShrink: 0 }}>
                          Any sound in your library becomes an instrument: it is pitched from its root note to every key. Set the root if the guess is wrong.
                        </div>
                        <div style={{ overflowY: 'auto', minHeight: 0, flex: 1 }}>
                          {!pickerSamplesLoading && !shown.length && (
                            <div style={{ padding: '10px', fontSize: 10, color: 'var(--text-muted)' }}>{q ? 'Nothing matches.' : 'No sounds in the library yet — record one, or open the Sound Library.'}</div>
                          )}
                          {[...byFolder.entries()].map(([folder, entries]) => (
                            <div key={folder}>
                              <div style={{ padding: '5px 10px 2px', fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{folder}</div>
                              {entries.map(row => {
                                const e = row.entry
                                const root = sampleRoots[e.id] ?? guessRootNote(e)
                                return (
                                  <div key={e.id} data-pr-sample={e.id} data-pr-sample-name={row.name} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px 2px 4px' }}>
                                    <button
                                      onClick={ev => { ev.stopPropagation(); void previewSample(e, root) }}
                                      title={`Listen at ${rootLabel(root)}`}
                                      style={{ flexShrink: 0, width: 22, border: 'none', background: 'transparent', cursor: 'pointer', color: previewing ? 'var(--text-muted)' : 'var(--accent-light)', padding: '3px 0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                                    ><Play size={11} /></button>
                                    <span title={row.notes > 1 ? `${row.name} — ${row.notes} notes in the library; played at any pitch` : e.name} style={{ flex: 1, minWidth: 0, fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {row.name}{row.notes > 1 && <span style={{ marginLeft: 4, fontSize: 8, color: 'var(--text-muted)' }}>· {row.notes} notes</span>}
                                    </span>
                                    <span style={{ fontSize: 8, color: 'var(--text-muted)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{e.duration ? `${e.duration.toFixed(1)}s` : ''}</span>
                                    <select
                                      value={root}
                                      onChange={ev => setSampleRoots(r => ({ ...r, [e.id]: Number(ev.target.value) }))}
                                      onClick={ev => ev.stopPropagation()}
                                      title="Root note — the pitch this recording is at"
                                      style={{ fontSize: 8.5, padding: '1px 2px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-muted)', flexShrink: 0 }}
                                    >
                                      {ROOT_CHOICES.map(m => <option key={m} value={m}>{rootLabel(m)}</option>)}
                                    </select>
                                    <button
                                      data-pr-sample-use={e.id}
                                      onClick={ev => { ev.stopPropagation(); void useSample(e, root, row.name) }}
                                      style={{ flexShrink: 0, fontSize: 8.5, fontWeight: 700, padding: '2px 7px', borderRadius: 3, border: '1px solid var(--accent)', background: 'rgb(var(--accent-rgb) / 0.12)', color: 'var(--accent)', cursor: 'pointer' }}
                                    >Use</button>
                                  </div>
                                )
                              })}
                            </div>
                          ))}
                          {hidden > 0 && (
                            <div style={{ padding: '6px 10px 4px', fontSize: 9, color: 'var(--text-muted)' }}>…and {hidden.toLocaleString()} more — search to narrow it down.</div>
                          )}
                        </div>
                      </div>
                    ) : (<>
                    <div style={{ padding: '4px 10px 6px', fontSize: 9, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.08em', borderBottom: '1px solid var(--border)' }}>CLIP SOUND — notes are kept</div>
                    {clip.presetId && track && track.instrument.type !== 'none' && (
                      <button onClick={() => { dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId: undefined } }); setShowPresetPicker(false) }}
                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', fontSize: 10, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        Track instrument — {INSTRUMENT_LABELS[track.instrument.type]}
                      </button>
                    )}
                    {getGroupedPresets(presets).map(({ group, presets: gp }) => {
                      // A preset is flagged when the clip has notes below loNote or
                      // above hiNote — those notes play at the wrong pitch (nearest
                      // edge sample), so they're the ones to warn about in red.
                      const ns = clip.notes ?? []
                      const cLo = ns.length ? Math.min(...ns.map(n => n.pitch)) : null
                      const cHi = ns.length ? Math.max(...ns.map(n => n.pitch)) : null
                      return (
                      <div key={group}>
                        <div style={{ padding: '5px 10px 2px', fontSize: 8, color: 'var(--text-muted)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{group}</div>
                        {gp.map(p => {
                          const oor = cLo != null && cHi != null && (cLo < p.loNote || cHi > p.hiNote)
                          return (
                          <div key={p.id} style={{ display: 'flex', alignItems: 'center' }}>
                            <button
                              onClick={e => { e.stopPropagation(); void previewMiddleC(p.id) }}
                              title={`Listen — plays ${midiNoteLabel(clampToPreset(p, 60))}`}
                              style={{
                                flexShrink: 0, width: 22, border: 'none', background: 'transparent', cursor: 'pointer',
                                color: previewing ? 'var(--text-muted)' : 'var(--accent-light)', fontSize: 10, padding: '4px 0 4px 8px', textAlign: 'left',
                                display: 'inline-flex', alignItems: 'center',
                              }}>
                              <Play size={11} />
                            </button>
                            <button
                              onClick={() => { dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { presetId: p.id } }); engine.setPresets(combinePresets(project.presets)); setShowPresetPicker(false) }}
                              title={oor ? `This clip's notes (${midiNoteLabel(cLo!)}–${midiNoteLabel(cHi!)}) go outside this preset's range (${noteRangeLabel(p)}); out-of-range notes play at the wrong pitch.` : undefined}
                              style={{
                                flex: 1, display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0,
                                textAlign: 'left', padding: '4px 10px 4px 0', fontSize: 10, cursor: 'pointer', border: 'none',
                                background: clip.presetId === p.id ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent',
                                color: oor ? '#f87171' : clip.presetId === p.id ? 'var(--accent-light)' : 'var(--text-secondary)',
                              }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{oor ? '⚠ ' : ''}{p.name}</span>
                              <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 8.5, color: oor ? '#f87171' : 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>{noteRangeLabel(p)}</span>
                            </button>
                          </div>
                          )
                        })}
                      </div>
                      )
                    })}
                    <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
                    <button onClick={() => { setShowPresetPicker(false); setShowNewPreset(true) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 10px', fontSize: 10, background: 'transparent', border: 'none', color: 'var(--accent)', cursor: 'pointer' }}>
                      + New Preset
                    </button>
                    <a href="/community?kind=preset" target="_blank" rel="noreferrer"
                      style={{ display: 'block', padding: '5px 10px', fontSize: 10, color: 'var(--text-muted)', textDecoration: 'none' }}>
                      Find presets in Community ↗
                    </a>
                    </>)}
                  </div>
                )
              })(),
              document.body
            )}
          </div>
        </div>

        {showNewPreset && (
          <NewPresetModal
            name={npName} setName={setNpName}
            folder={npFolder} setFolder={setNpFolder}
            lo={npLo} setLo={setNpLo} hi={npHi} setHi={setNpHi}
            sfText={npSfText} onSoundfontFile={handleSoundfontFile}
            sound={npSound} setSound={setNpSound}
            graphs={npGraphs} setGraphs={setNpGraphs}
            share={npShare} setShare={setNpShare}
            desc={npDesc} setDesc={setNpDesc}
            loading={npLoading}
            onCreate={handleCreatePreset}
            onCancel={() => { setShowNewPreset(false); setNpName(''); setNpSfText(null); setNpSound(undefined); setNpGraphs([]); setNpShare(false); setNpDesc('') }}
          />
        )}

        {/* Row 2: MUSICAL — draw mode, melodic clips only */}
        {findOpen && (
          <FindNotesBar filter={filter} setFilter={setFilter} count={found.length} total={clip.notes.length}
            onSelect={selectFound} onClose={() => setFindOpen(false)} scaleOn={!!findScale} />
        )}

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
              title={`Scale lock — highlights the notes of ${NOTE_NAMES[project.key]} ${project.scale} on the keyboard and snaps notes you draw to that scale, so you stay in key. Toggle off to draw any note freely.`}
              style={{
                ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0,
                background: scaleLock ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent',
                color: scaleLock ? 'var(--accent-light)' : 'var(--text-muted)',
                border: scaleLock ? '1px solid rgb(var(--accent-rgb) / 0.4)' : '1px solid transparent',
              }}
            >
              {scaleLock ? `♩ ${NOTE_NAMES[project.key]} ${project.scale}` : '♩ Scale'}
            </button>

            {!isDrum && (
              <>
                <button onClick={() => setFold(v => !v)} aria-pressed={fold} data-help-id="roll-fold" title="Fold (F) — show only the pitches this clip uses"
                  style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0, background: fold ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent', color: fold ? 'var(--accent-light)' : 'var(--text-muted)', border: fold ? '1px solid rgb(var(--accent-rgb) / 0.4)' : '1px solid transparent' }}>Fold</button>
                <button onClick={() => setFoldScale(v => !v)} aria-pressed={foldScale} data-help-id="roll-fold-scale" title={`Fold to Scale (G) — show only the notes of ${NOTE_NAMES[project.key]} ${project.scale}, and any note outside it`}
                  style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0, background: foldScale ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent', color: foldScale ? 'var(--accent-light)' : 'var(--text-muted)', border: foldScale ? '1px solid rgb(var(--accent-rgb) / 0.4)' : '1px solid transparent' }}>Scale fold</button>
                <button onClick={() => setHighlightScale(v => !v)} aria-pressed={highlightScale} data-help-id="roll-highlight-scale" title="Highlight Scale (K) — tint the scale on the keys and the grid, the root more so"
                  style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0, background: highlightScale ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent', color: highlightScale ? 'var(--accent-light)' : 'var(--text-muted)', border: highlightScale ? '1px solid rgb(var(--accent-rgb) / 0.4)' : '1px solid transparent' }}>Highlight</button>
                <button onClick={focusNotes} data-help-id="roll-focus" title="Focus (N) — scroll to where the notes are"
                  style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0 }}>Focus</button>
                <button onClick={() => setStepEntry(v => !v)} aria-pressed={stepEntry} data-help-id="roll-step-entry" title="Step entry — play a key to write a note at the insert marker and step on by the grid; ← / → move the marker"
                  style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0, background: stepEntry ? 'rgba(245,158,11,0.18)' : 'transparent', color: stepEntry ? '#f59e0b' : 'var(--text-muted)', border: stepEntry ? '1px solid rgba(245,158,11,0.5)' : '1px solid transparent' }}>Step</button>
                <button ref={ptBtnRef} onClick={openPitchTime} aria-pressed={!!ptAnchor} data-help-id="pitch-time" title="Pitch & Time — transpose, invert, add interval, stretch, set length, humanise, reverse, legato"
                  style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0, background: ptAnchor ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent', color: ptAnchor ? 'var(--accent-light)' : 'var(--text-muted)', border: ptAnchor ? '1px solid rgb(var(--accent-rgb) / 0.4)' : '1px solid transparent' }}>Pitch &amp; Time</button>
                {/* The loop brace and time commands (lib/clip-time.ts) */}
                <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />
                <button onClick={toggleLoop} aria-pressed={!!brace} data-help-id="roll-loop" title={brace ? `Looping every ${+(brace.end / barBeats).toFixed(2)} bars — click to stop` : 'Loop the clip — repeat its pattern every loop length'}
                  style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0, background: brace ? 'rgb(var(--accent-rgb) / 0.15)' : 'transparent', color: brace ? 'var(--accent-light)' : 'var(--text-muted)', border: brace ? '1px solid rgb(var(--accent-rgb) / 0.4)' : '1px solid transparent' }}>
                  Loop{brace ? ` ${+(brace.end / barBeats).toFixed(2)}` : ''}
                </button>
                {brace && (
                  <>
                    <button onClick={setLoopEndHere} data-help-id="roll-loop-set-end" title="Set Loop End — the loop ends where the playhead is (snapped to the grid)"
                      style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0 }}>Set End</button>
                    <button onClick={dupLoop} data-help-id="roll-dup-loop" title="Duplicate Loop (⌘D with the brace selected) — the loop doubles and its notes are copied"
                      style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0 }}>Dup Loop</button>
                    <button onClick={cropClip} data-help-id="roll-crop" title="Crop (⇧⌘J) — notes outside the loop go, the loop becomes the clip"
                      style={{ ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0 }}>Crop</button>
                  </>
                )}
                <select data-help-id="roll-clip-sig" aria-label="Clip time signature" title="The clip's own time signature — draws its bar lines (the song's without one)"
                  value={clip.timeSignatureNum ? `${clip.timeSignatureNum}/${clip.timeSignatureDen || 4}` : ''}
                  onChange={e => { const [n, d] = e.target.value.split('/').map(Number); dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: e.target.value ? { timeSignatureNum: n, timeSignatureDen: d } : { timeSignatureNum: undefined, timeSignatureDen: undefined } }) }}
                  style={{ fontSize: 9, padding: '0 2px', background: 'transparent', color: clip.timeSignatureNum ? 'var(--text-secondary)' : 'var(--text-muted)', border: '1px solid transparent', borderRadius: 3, flexShrink: 0 }}>
                  <option value="">{project.timeSignatureNum || 4}/{project.timeSignatureDen || 4} (song)</option>
                  {['2/4', '3/4', '4/4', '5/4', '6/8', '7/8', '9/8', '12/8'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                {ptAnchor && (
                  <PitchTimePanel
                    anchor={ptAnchor} onClose={() => setPtAnchor(null)} ignoreOutside={ptBtnRef}
                    scope={rollScope} scaleOn={scaleOn} scaleName={`${NOTE_NAMES[project.key]} ${project.scale}`}
                    intervalSize={intervalSize} setIntervalSize={setIntervalSize}
                    stretchFactor={stretchFactor} setStretchFactor={setStretchFactor}
                    lengthBeats={lengthBeats} setLengthBeats={setLengthBeats}
                    humanizeAmount={humanizeAmount} setHumanizeAmount={setHumanizeAmount}
                    onTranspose={steps => (Math.abs(steps) === 1 ? transposeStep(steps as 1 | -1) : scaleOn ? patchMany(transposeDegrees(targetNotes(), steps, rollScale)) : transpose(steps))}
                    onInvert={invert} onAddInterval={addIntervalNow} onStretch={stretch} onSetLength={() => applyLength()}
                    onHumanize={humanize} onReverse={reverse} onLegato={legato}
                  />
                )}
              </>
            )}
            <div style={{ width: 1, height: 12, background: 'var(--border)', flexShrink: 0, margin: '0 2px' }} />

            {/* Chord stamp buttons */}
            {Object.keys(CHORD_INTERVALS).map(chord => (
              <button
                key={chord}
                onClick={() => setChordType(chordType === chord ? null : chord)}
                style={{
                  ...prBtn, fontSize: 9, padding: '1px 6px', flexShrink: 0,
                  background: chordType === chord ? 'rgb(var(--accent-rgb) / 0.18)' : 'transparent',
                  color: chordType === chord ? 'var(--accent)' : 'var(--text-muted)',
                  border: chordType === chord ? '1px solid rgb(var(--accent-rgb) / 0.45)' : '1px solid transparent',
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
                  style={{ ...prBtn, fontSize: 9, padding: '1px 6px', color: 'var(--text-muted)', flexShrink: 0 }}
                >
                  Clear
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div ref={bodyRef} style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden', overscrollBehavior: 'contain' }}>
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
            rows={rows}
            root={project.key}
            scrollTop={scrollTop}
            hoverPitch={hoverPitch}
            onPlayNote={playNote}
            trackColor={color}
            scaleLock={scaleLock || highlightScale}
            inScalePitches={inScalePitches}
            noteH={noteH}
          />
        )}

        {/* Note grid + velocity */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Note grid */}
          <div
            ref={gridRef}
            data-help-id="roll-grid"
            data-splitting={splitting || undefined}
            style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: splitting ? 'col-resize' : tool === 'edit' ? (hoverEdge ? 'ew-resize' : 'crosshair') : tool === 'draw' ? 'copy' : 'cell', touchAction: isMobile ? 'none' : undefined }}
            onMouseDown={handleGridMouseDown}
            onMouseMove={handleGridMouseMove}
            onMouseLeave={() => setHoverPitch(null)}
            onTouchStart={isMobile ? onGridTouchStart : undefined}
            onTouchMove={isMobile ? onGridTouchMove : undefined}
            onTouchEnd={isMobile ? onGridTouchEnd : undefined}
          >
            {/* Background rows. When scale-lock is on, the in-scale lanes are
                washed with the account accent (var(--accent-rgb), which follows
                the user's appearance customization) so you can see across the
                whole roll exactly which notes the lock allows — matching the
                same tint on the piano keys to the left. */}
            <div style={{ position: 'absolute', top: -scrollTop, left: 0, width: totalW }}>
              {Array.from({ length: rowCount }, (_, i) => {
                const pitch = isDrum ? DRUM_LANES[i].pitch : rows[i]
                const black = !isDrum && isBlack(pitch)
                const hover = hoverPitch === pitch
                const inScale = (scaleLock || highlightScale) && !isDrum && inScalePitches.has(pitch % 12)
                const isRoot = inScale && pitch % 12 === project.key
                const bg = hover
                  ? `${color}20`
                  : isRoot
                    ? 'rgb(var(--accent-rgb) / 0.26)'
                    : inScale
                      ? (black ? 'rgb(var(--accent-rgb) / 0.2)' : 'rgb(var(--accent-rgb) / 0.14)')
                      : black ? '#1a1a1a' : isDrum && i % 2 === 0 ? '#1c1c1c' : '#1e1e1e'
                return (
                  <div key={pitch} style={{
                    height: rowH, background: bg,
                    borderBottom: !isDrum && pitch % 12 === 0 ? '1px solid var(--border-light)' : '1px solid #202020',
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
                  background: i % clipBarBeats === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
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
                // A deactivated note (0) is kept in place, drawn hollow and dim.
                const off = note.active === false
                return (
                  <div
                    key={note.id}
                    data-note-id={note.id}
                    data-note-active={off ? 'false' : undefined}
                    onContextMenu={e => {
                      e.preventDefault()
                      e.stopPropagation()
                      setCtxMenu({ note, x: e.clientX, y: e.clientY })
                    }}
                    style={{
                      position: 'absolute', left: x, top: y + 1,
                      width: w, height: rowH - 2,
                      background: off ? 'transparent' : color,
                      border: sel ? '1px solid #fff' : off ? `1px dashed ${color}` : hasPreset ? `1px solid var(--accent-light)` : `1px solid ${color}cc`,
                      boxShadow: sel ? '0 0 0 1px #fff, 0 0 6px rgba(255,255,255,0.55)' : undefined,
                      filter: sel ? 'brightness(1.3)' : undefined,
                      borderRadius: 2, boxSizing: 'border-box',
                      opacity: off ? (sel ? 0.7 : 0.45) : sel ? 1 : 0.9, cursor: 'context-menu',
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
            {stepEntry && (
              <div data-help-id="step-marker" data-step-beat={stepBeat} style={{ position: 'absolute', top: 0, bottom: 0, left: stepBeat * beatW - scrollLeft, width: 2, background: '#f59e0b', boxShadow: '0 0 4px rgba(245,158,11,0.7)', pointerEvents: 'none', zIndex: 6 }} />
            )}

            {/* The loop brace (lib/clip-time.ts): click to select, drag the end to resize */}
            {brace && (
              <div data-help-id="loop-brace" data-loop-end={brace.end} aria-pressed={braceSelected}
                onMouseDown={e => { e.stopPropagation(); setBraceSelected(true); setSelectedNotes(new Set()) }}
                title="Loop brace — click to select it; ⌘← / ⌘→ shorten / lengthen by the grid, ⌘↑ / ⌘↓ double / halve, ⌘D duplicates the loop; drag the end to resize"
                style={{ position: 'absolute', top: 0, left: -scrollLeft, width: Math.max(4, brace.end * beatW), height: 6, zIndex: 9, cursor: 'pointer',
                  background: braceSelected ? 'var(--accent-light)' : 'rgb(var(--accent-rgb) / 0.55)', borderRadius: '0 0 3px 0' }}>
                <div data-help-id="loop-brace-end"
                  onMouseDown={e => {
                    e.stopPropagation(); e.preventDefault()
                    const startX = e.clientX, L0 = brace.end
                    const onMove = (ev: MouseEvent) => setLoopLength(L0 + (ev.clientX - startX) / beatW)
                    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
                    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
                  }}
                  style={{ position: 'absolute', right: -4, top: -1, width: 8, height: 8, background: 'var(--accent-light)', cursor: 'ew-resize', borderRadius: 2 }} />
              </div>
            )}

            {/* Stretch markers over a selection of two or more notes (lib/pitch-time.ts) */}
            {selectedNotes.size >= 2 && tool === 'edit' && (
              <StretchMarkers
                notes={clip.notes.filter(n => selectedNotes.has(n.id))}
                beatW={beatW} scrollLeft={scrollLeft} top={brace ? 7 : 0}
                snap={(b, free) => snapUnless(free, b)}
                apply={patchMany}
                onDone={() => settleOverlaps([...selectedNotes])}
              />
            )}

            {/* Selection rectangle */}
            {selRect && (
              <div style={{
                position: 'absolute',
                left: selRect.x, top: selRect.y, width: selRect.w, height: selRect.h,
                border: tool === 'erase' ? '1px solid #ef4444' : '1px solid var(--accent)',
                background: tool === 'erase' ? 'rgba(239,68,68,0.12)' : 'rgb(var(--accent-rgb) / 0.1)',
                pointerEvents: 'none',
              }} />
            )}
          </div>

          {/* Expression lanes — Velocity, Deviation, Chance — one at a time, with
              Randomize / Amount / Ramp for the selection (lib/note-chance.ts). */}
          <div data-help-id="note-lanes" style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', fontSize: 9 }}>
            {(['velocity', 'deviation', 'chance'] as LaneField[]).map(f => (
              <button key={f} onClick={() => setLane(f)} aria-pressed={lane === f} data-help-id={`lane-${f}`}
                style={{ ...prBtn, fontSize: 9, padding: '1px 6px', background: lane === f ? 'var(--bg-card)' : 'transparent', color: lane === f ? 'var(--text-primary)' : 'var(--text-muted)', border: lane === f ? '1px solid var(--border)' : '1px solid transparent', textTransform: 'capitalize' }}>{f}</button>
            ))}
            <div style={{ width: 1, height: 12, background: 'var(--border)', margin: '0 2px' }} />
            <button onClick={randomizeSelected} disabled={!selectedNotes.size} data-help-id="lane-randomize" title={`Randomize the selected notes' ${lane} by up to ±${randAmount}% (repeatable — the same seed each time)`}
              style={{ ...prBtn, fontSize: 9, padding: '1px 6px', opacity: selectedNotes.size ? 1 : 0.4 }}>Randomize</button>
            <Knob value={randAmount} min={0} max={100} defaultValue={25} size={16} spec={{ label: 'Randomize amount', min: 0, max: 100, unit: '%' }} onChange={v => setRandAmount(Math.round(v))} />
            <button onClick={rampSelected} disabled={selectedNotes.size < 2} data-help-id="lane-ramp" title={`Ramp the selected notes' ${lane} from the first to the last`}
              style={{ ...prBtn, fontSize: 9, padding: '1px 6px', opacity: selectedNotes.size >= 2 ? 1 : 0.4 }}>Ramp</button>
            <div style={{ width: 1, height: 12, background: 'var(--border)', margin: '0 2px' }} />
            <button onClick={cycleGroup} disabled={!selectedNotes.size} data-help-id="lane-group" title="Probability group for the selected notes (⌘G): Play One → Play All → ungroup"
              style={{ ...prBtn, fontSize: 9, padding: '1px 6px', opacity: selectedNotes.size ? 1 : 0.4, color: groupLabel ? '#f59e0b' : undefined }}>{groupLabel ?? 'Group'}</button>
          </div>
          <VelocityLane
            clip={clip}
            beatW={beatW}
            scrollLeft={scrollLeft}
            trackColor={color}
            selectedNotes={selectedNotes}
            field={lane}
            onVelocityChange={(noteId, value) => dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId, patch: lanePatch(lane, value) })}
          />
        </div>
      </div>

      {/* Right-click chord context menu */}
      {ctxMenu && createPortal(
        <div
          id="pr-ctx-menu"
          style={{
            position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999,
            background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 7,
            padding: '4px 0', boxShadow: '0 8px 24px rgba(0,0,0,0.75)', minWidth: 160,
          }}
        >
          <div style={{ padding: '4px 12px 6px', fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em' }}>
            {NOTE_NAMES[ctxMenu.note.pitch % 12]}{octave(ctxMenu.note.pitch)}
            {ctxMenu.note.presetId && <span style={{ color: 'var(--accent)', marginLeft: 5 }}>● preset</span>}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 3 }}>
            {CHORD_PRESETS.map(({ label, intervals }) => (
              <button
                key={label}
                onClick={() => expandToChord(ctxMenu.note, intervals)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '5px 14px', fontSize: 11, color: 'var(--text-primary)',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgb(var(--accent-rgb) / 0.12)' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent' }}
              >
                {label}
                <span style={{ float: 'right', fontSize: 9, color: 'var(--text-muted)' }}>
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
