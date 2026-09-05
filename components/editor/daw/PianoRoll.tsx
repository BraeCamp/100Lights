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
type Tool = 'edit' | 'erase'
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
    <div style={{ width: PIANO_W, flexShrink: 0, position: 'relative', overflow: 'hidden', background: 'var(--bg-surface)' }}>
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
              ? (black ? 'rgb(var(--accent-rgb) / 0.4)' : 'rgb(var(--accent-rgb) / 0.22)')
              : (black ? '#1a1a1a' : '#2e2e2e')
          return (
            <div
              key={pitch}
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
        height: VELOCITY_H, background: 'var(--bg-base)',
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

  const [tool, setTool]   = useState<Tool>('edit')
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
              lastNoteLenRef.current = dur
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
  const targetNotes = () => (selectedNotes.size ? clip.notes.filter(n => selectedNotes.has(n.id)) : clip.notes)

  function patchNotes(fn: (n: MidiNote, i: number) => Partial<MidiNote> | null) {
    const notes = targetNotes()
    notes.forEach((n, i) => {
      const patch = fn(n, i)
      if (patch) dispatch({ type: 'UPDATE_MIDI_NOTE', clipId: clip.id, noteId: n.id, patch })
    })
  }

  /** Quantise start times to the current grid — and lengths too, so a run of
   *  notes lands flush instead of snapping to the grid while keeping ragged
   *  ends. Drum clips keep their lengths; a snare's length is meaningless. */
  function quantizeNotes(strength = 1) {
    patchNotes(n => {
      const snapped = snapBeat(n.startBeat)
      const startBeat = n.startBeat + (snapped - n.startBeat) * strength
      const patch: Partial<MidiNote> = { startBeat: Math.max(0, startBeat) }
      if (!isDrum && strength === 1) patch.durationBeats = Math.max(quant, snapBeat(n.durationBeats) || quant)
      return patch
    })
  }

  /** Push notes off the grid by a small random amount, in both time and
   *  velocity. A perfectly quantised part is the single clearest tell that
   *  music was typed rather than played. Deliberately subtle: ±18ms is about
   *  the spread of a competent player, and it scales with tempo so it stays
   *  ±18ms rather than ±a fixed fraction of a beat. */
  function humanize() {
    const msToBeats = (ms: number) => (ms / 1000) * (project.tempo / 60)
    const spread = msToBeats(18)
    patchNotes(n => ({
      startBeat: Math.max(0, n.startBeat + (Math.random() * 2 - 1) * spread),
      velocity: Math.max(0.15, Math.min(1, (n.velocity ?? 0.8) + (Math.random() * 2 - 1) * 0.09)),
    }))
  }

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
    patchNotes(n => ({ pitch: Math.max(0, Math.min(127, n.pitch + semitones)) }))
  }

  function scaleVelocity(mult: number) {
    patchNotes(n => ({ velocity: Math.max(0.05, Math.min(1, (n.velocity ?? 0.8) * mult)) }))
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
    { id: 'roll.quantize', group: 'Notes', label: `Quantise ${rollScope} to the grid`,
      keywords: 'snap align tighten timing grid straighten on beat q', shortcut: 'Q',
      run: () => quantizeNotes(1) },
    { id: 'roll.quantize.half', group: 'Notes', label: `Half-quantise ${rollScope} (keep some feel)`,
      keywords: 'snap partial strength loose groove timing halfway',
      run: () => quantizeNotes(0.5) },
    { id: 'roll.humanize', group: 'Notes', label: `Humanise ${rollScope}`,
      keywords: 'loosen feel random natural played not typed timing velocity groove',
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
    { id: 'roll.close', group: 'Notes', label: 'Close the piano roll',
      keywords: 'hide dismiss done back arrangement',
      run: () => { setExpandedPianoRollClipId?.(null); setEditTarget?.(null) } },
  ], [clip.id, clip.notes, selectedNotes, rollScope, isDrum, quant, project.tempo, project.key, project.scale])

  function handleKeyDown(e: React.KeyboardEvent) {
    const selected = clip.notes.filter(n => selectedNotes.has(n.id))
    // What this key means in the roll, from the one table (lib/keymap.ts).
    const kb = resolveKey(e, ['roll'])?.id

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
      quantizeNotes(1)
      e.preventDefault(); e.stopPropagation()
      return
    }
    // Arrows: nudge time / transpose pitch (⇧ = octave; drums move by lane)
    if ((kb === 'notes.earlier' || kb === 'notes.later' || kb === 'notes.up' || kb === 'notes.down' || kb === 'notes.upOctave' || kb === 'notes.downOctave') && selected.length > 0) {
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
            onClick={() => quantizeNotes(1)}
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
            style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: tool === 'edit' ? (hoverEdge ? 'ew-resize' : 'crosshair') : 'cell', touchAction: isMobile ? 'none' : undefined }}
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
                const pitch = isDrum ? DRUM_LANES[i].pitch : NUM_NOTES - 1 - i
                const black = !isDrum && isBlack(pitch)
                const hover = hoverPitch === pitch
                const inScale = scaleLock && !isDrum && inScalePitches.has(pitch % 12)
                const bg = hover
                  ? `${color}20`
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
                      border: sel ? '1px solid #fff' : hasPreset ? `1px solid var(--accent-light)` : `1px solid ${color}cc`,
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
                background: tool === 'erase' ? 'rgba(239,68,68,0.12)' : 'rgb(var(--accent-rgb) / 0.1)',
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
