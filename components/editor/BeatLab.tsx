'use client'

/*
 * DEVELOPER NOTES — BeatLab.tsx
 *
 * ARCHITECTURE OVERVIEW
 * ─────────────────────
 * BeatLab is a self-contained beatbox recorder/editor that lives inside AudioEditor.
 * It appears as a virtual track with ID '__beatlab__' in the AudioEditor sidebar.
 * When that track is selected, the waveform area is hidden and BeatLab gets the full panel.
 * Hits/duration/BPM bubble up to AudioEditor via the `onHitsChange` prop so the sidebar
 * entry can show live stats and an expand/collapse hit-type breakdown.
 *
 * AI FEEDBACK FLOW (current)
 * ──────────────────────────
 * 1. After recording, AI runs async and sets `aiSuggestions: Map<hitId, BeatType>`.
 * 2. A pill button "✦ AI: N suggestions" appears in the toolbar.
 * 3. Clicking opens the feedback card modal with four choices:
 *    - Good            → dismiss suggestions, no corrections saved
 *    - Program was right → save INVERSE corrections (AI was wrong), dismiss
 *    - AI was right    → apply all + save corrections for learning, dismiss
 *    - Correct         → apply all + open the inline feedback panel for manual tweaks
 * 4. The inline feedback panel (feedbackItems state) lets the user change individual
 *    hit types, retry AI up to MAX_RETRIES (3) times, and confirm to save + get
 *    a Claude Haiku reflection via /api/beat-reflection.
 *
 * TWO-SIDED LEARNING
 * ──────────────────
 * Side A: Sound Library entries (lib/sound-library.ts, IndexedDB 'contentforge-sound-library')
 * Side B: Accepted corrections (lib/correction-store.ts, IndexedDB 'contentforge-corrections')
 * Both are loaded into `referenceSounds` on mount and passed to analyzeBeats().
 * Nearest-neighbor classifier runs before rule-based classifier (NN_MAX_DIST = 0.38).
 *
 * CUSTOM LANES
 * ────────────
 * Users can rename any lane label/color (typeOverrides map) and add custom lanes
 * (extraLaneIds). Custom lane IDs are 'cust_${Date.now()}' strings cast as BeatType.
 * Click a lane label to open the rename popover with name input + color swatches.
 *
 * PENDING / NOT YET IMPLEMENTED
 * ──────────────────────────────
 * - "Bounce to track": render beat hits via OfflineAudioContext → WAV blob → AudioEditor track.
 *   Needs: onBounce callback prop, WAV encoder (or MediaRecorder trick), R2 upload.
 * - "Recording on normal tracks": user asked for beat recording to happen as a track entry
 *   (like a proper DAW) rather than the current self-contained mode. Would require lifting
 *   recording state up to AudioEditor and showing a record button per-track.
 * - Ground truth teaching mode: currently visible to all users on idle screen.
 *   Once classifier is accurate enough, move it to admin-only (see classify-beats/route.ts note).
 */

import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { Mic, Square, Play, Pause, Trash2, RefreshCw, ChevronDown, Volume2, VolumeX, Send } from 'lucide-react'
import Tooltip from './Tooltip'
import type { MidiMapping, MidiMappingTarget } from '@/lib/midi-mapping'
import { applyCCValue, targetLabel, serializeMappings } from '@/lib/midi-mapping'
import MidiMappingPanel, { MidiLearnContext } from './MidiMappingPanel'
import MidiKeyboard from './MidiKeyboard'
import type { BeatHit, BeatAnalysis, BeatType, BeatTrackEntry, ReferenceSound, HitSpectral } from '@/lib/beat-analyzer'
import { analyzeBeats, classifyHitLocally, NN_MAX_DIST, clusterHits, CLUSTER_LETTERS, CLUSTER_COLORS } from '@/lib/beat-analyzer'
import { playDrumHit } from '@/lib/drum-samples'
import { playMelodicNote, MELODIC_TYPES } from '@/lib/instrument-synth'
import { aiClassifyHits } from '@/lib/ai-beat-classifier'
import { correctionsGetAll, correctionsClear } from '@/lib/correction-store'
import { libraryGetAll } from '@/lib/sound-library'
import { AddToLibraryModal } from './SoundLibrary'
import { sampleGetAll } from '@/lib/sample-pack'
import { detectPitchCurve, detectPitchCurveAsync, transformVoiceToSynth, extractNoteEvents, DEFAULT_SYNTH_OPTIONS, type SynthOptions, midiToFreq, freqToMidi } from '@/lib/pitch-detector'
import { matchBuffer, extractHarmonicProfile } from '@/lib/spectral-match'
import { SAMPLE_LIBRARY, getSampleBuffer } from '@/lib/sample-library'
import { findBestMatch, saveProfile, incrementUsage, profileLabel, type ProfileFeatures, type LearnedProfile } from '@/lib/learned-profiles'
import { extractSubBuffer, spliceSegmentBack } from '@/lib/vowel-segmenter'
import { separateHarmonicPercussive, mixBuffers } from '@/lib/hpss'
import { smoothPitchCurve } from '@/lib/timbre-smooth'
import { parseAbletonProject, loadClipAudio, type AbletonProject, type AbletonTrack } from '@/lib/ableton-parser'
import { encodeWav, decodeWav, decodeAiff } from '@/lib/wav-codec'
import { synthDrum, DRUM_COLORS, DRUM_LABELS } from '@/lib/drum-synth'
import { createSidechainProcessor } from '@/lib/sidechain'
import { saveClip, deleteClip, loadAllClips } from '@/lib/clip-store'
import type { SceneClip, SessionLane } from './SessionView'
const SCENE_COUNT = 8
const PianoRoll               = lazy(() => import('./PianoRoll'))
const SessionView             = lazy(() => import('./SessionView'))
const StepSequencer           = lazy(() => import('./StepSequencer'))
const ChordProgressionBuilder = lazy(() => import('./ChordProgressionBuilder'))
const CommandPalette          = lazy(() => import('./CommandPalette'))
const SpectrumAnalyzer        = lazy(() => import('./SpectrumAnalyzer'))
const Arpeggiator             = lazy(() => import('./Arpeggiator'))
const InspectorPanel          = lazy(() => import('./InspectorPanel'))
const CompEditor              = lazy(() => import('./CompEditor'))
const SamplerEditor           = lazy(() => import('./SamplerEditor'))
const WavetableSynthEditor    = lazy(() => import('./WavetableSynthEditor'))
const FMSynthEditor           = lazy(() => import('./FMSynthEditor'))
import type { CompGroup } from '@/lib/comping'
import { renderComp } from '@/lib/comping'
import { addTakeToGroup } from '@/lib/loop-recorder'
import { TooltipModeProvider, TooltipModeToggle } from './TooltipMode'

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_DRUM_TYPES: BeatType[] = ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'crash', 'rim']
const DEFAULT_ENABLED: BeatType[] = []

const TYPE_COLORS: Record<BeatType, string> = {
  kick:              '#7c3aed',
  snare:             '#dc2626',
  hihat:             '#ca8a04',
  'open-hihat':      '#d97706',
  clap:              '#0284c7',
  tom:               '#059669',
  crash:             '#9333ea',
  rim:               '#db2777',
  'guitar-acoustic': '#b45309',
  'guitar-electric': '#0891b2',
  'guitar-nylon':    '#a16207',
  'piano-grand':     '#1d4ed8',
  'piano-electric':  '#0369a1',
  'piano-rhodes':    '#1e40af',
  'synth-lead':      '#be123c',
  'synth-pad':       '#9333ea',
  'synth-bass':      '#15803d',
  'synth-arp':       '#c2410c',
  other:             '#6b7280',
}

const TYPE_LABELS: Record<BeatType, string> = {
  kick:              'Kick',
  snare:             'Snare',
  hihat:             'Hi-Hat',
  'open-hihat':      'Open HH',
  clap:              'Clap',
  tom:               'Tom',
  crash:             'Crash',
  rim:               'Rim',
  'guitar-acoustic': 'Acoustic',
  'guitar-electric': 'Electric Gtr',
  'guitar-nylon':    'Nylon',
  'piano-grand':     'Grand Piano',
  'piano-electric':  'Electric Piano',
  'piano-rhodes':    'Rhodes',
  'synth-lead':      'Synth Lead',
  'synth-pad':       'Synth Pad',
  'synth-bass':      'Synth Bass',
  'synth-arp':       'Arp',
  other:             'Other',
}

const NOTE_MIN = 36
const NOTE_MAX = 84
const NOTE_RANGE = NOTE_MAX - NOTE_MIN
const LANE_HEIGHT = 88
const HEADER_W = 164  // lane label column: 140px + 24px note axis

// ── Custom type helpers ────────────────────────────────────────────────────────

type TypeOverrides = Record<string, { label: string; color: string }>

const CUSTOM_PALETTE = [
  '#7c3aed','#dc2626','#ca8a04','#0284c7','#059669',
  '#db2777','#c2410c','#0891b2','#15803d','#9333ea','#6b7280',
]

function typeLabel(t: string, overrides: TypeOverrides): string {
  return overrides[t]?.label ?? TYPE_LABELS[t as BeatType] ?? t
}
function typeColor(t: string, overrides: TypeOverrides): string {
  return overrides[t]?.color ?? TYPE_COLORS[t as BeatType] ?? '#6b7280'
}

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
function midiName(note: number) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`
}

type Phase = 'idle' | 'recording' | 'analyzing' | 'editing'
type RecMode = 'hits' | 'loop'

async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  const ab    = await blob.arrayBuffer()
  const bytes = new Uint8Array(ab, 0, Math.min(12, ab.byteLength))
  // Chrome does not support AIFF in decodeAudioData — detect and decode manually
  const isAiff =
    bytes[0] === 0x46 && bytes[1] === 0x4F && bytes[2] === 0x52 && bytes[3] === 0x4D &&
    bytes[8] === 0x41 && bytes[9] === 0x49  // "FORM...AI..."
  if (isAiff) {
    const { channels, sampleRate } = decodeAiff(ab)
    const ctx = new AudioContext()
    try {
      const out = ctx.createBuffer(channels.length, channels[0].length, sampleRate)
      for (let ch = 0; ch < channels.length; ch++) out.getChannelData(ch).set(channels[ch])
      return out
    } finally { ctx.close() }
  }
  const ctx = new AudioContext()
  try { return await ctx.decodeAudioData(ab) } finally { ctx.close() }
}

function makeReverbIR(ctx: AudioContext, duration = 2.5, decay = 2): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * duration)
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
  }
  return buf
}

// ── Waveform ─────────────────────────────────────────────────────────────────

function Waveform({ audioBuffer, pxWidth }: { audioBuffer: AudioBuffer; pxWidth: number }) {
  const height = 40
  const mid = height / 2
  const data = audioBuffer.getChannelData(0)
  const spx = data.length / pxWidth

  const path = useMemo(() => {
    const top: string[] = [], bot: string[] = []
    for (let x = 0; x < pxWidth; x++) {
      const s = Math.floor(x * spx)
      const e = Math.min(data.length, Math.floor((x + 1) * spx))
      let peak = 0
      for (let i = s; i < e; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a }
      const h = peak * (mid - 1)
      top.push(`${x === 0 ? 'M' : 'L'} ${x} ${mid - h}`)
      bot.push(`L ${x} ${mid + h}`)
    }
    return top.join(' ') + ' ' + bot.reverse().join(' ') + ' Z'
  }, [audioBuffer, pxWidth]) // eslint-disable-line

  return (
    <div style={{ paddingLeft: HEADER_W, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <svg width={pxWidth} height={height} style={{ display: 'block' }}>
        <path d={path} fill="rgba(139,92,246,0.2)" stroke="rgba(139,92,246,0.35)" strokeWidth={0.5} />
      </svg>
    </div>
  )
}

// ── Time ruler ────────────────────────────────────────────────────────────────

interface Locator { id: string; time: number; label: string }

function RulerTicks({
  duration, px, bpm, abLoop, abLoopEnabled, onSeek, onAbLoopDrag, locators, onLocatorAdd, onLocatorRemove,
}: {
  duration: number; px: number; bpm: number | null
  abLoop: { start: number; end: number } | null
  abLoopEnabled: boolean
  onSeek?: (t: number) => void
  onAbLoopDrag?: (loop: { start: number; end: number }) => void
  locators?: Locator[]
  onLocatorAdd?: (t: number) => void
  onLocatorRemove?: (id: string) => void
}) {
  // If we have BPM, show bars+beats; otherwise fall back to time labels.
  const beatSec  = bpm ? 60 / bpm : null
  const barSec   = beatSec ? beatSec * 4 : null
  const pxPerSec = px / duration

  // Choose a sensible major-tick interval
  let majSec: number
  if (barSec && (pxPerSec * barSec) >= 40) {
    majSec = barSec        // bar lines when bars are wide enough
  } else if (barSec && (pxPerSec * barSec * 4) >= 40) {
    majSec = barSec * 4   // every 4 bars
  } else {
    majSec = duration <= 4 ? 0.5 : duration <= 10 ? 1 : 2
  }
  // Show beat sub-ticks when individual beats are ≥ 12px apart
  const showBeats = beatSec != null && pxPerSec * beatSec >= 12

  const ticks: Array<{ t: number; major: boolean; label: string }> = []
  for (let t = 0; t <= duration + 0.001; t += majSec) {
    const sec = Math.round(t * 1000) / 1000
    let label: string
    if (barSec) {
      const bar = Math.round(sec / barSec) + 1
      label = `${bar}`
    } else {
      label = sec < 1 ? `${sec.toFixed(1)}s` : `${sec.toFixed(0)}s`
    }
    ticks.push({ t: sec, major: true, label })
    // Beat sub-ticks between major ticks
    if (showBeats && beatSec) {
      for (let b = 1; b < majSec / beatSec - 0.01; b++) {
        const bt = Math.round((sec + b * beatSec) * 1000) / 1000
        if (bt < duration) ticks.push({ t: bt, major: false, label: '' })
      }
    }
  }

  function posFromEvent(e: React.MouseEvent): number {
    const rect = e.currentTarget.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration))
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (!onAbLoopDrag) { if (onSeek) onSeek(posFromEvent(e)); return }
    // Shift+drag sets the AB loop region
    if (e.shiftKey) {
      e.preventDefault()
      const startT = posFromEvent(e)
      let endT = startT
      onAbLoopDrag({ start: startT, end: endT })
      const move = (me: MouseEvent) => {
        const rect = (e.target as HTMLElement).closest<HTMLElement>('[data-ruler]')?.getBoundingClientRect()
        if (!rect) return
        endT = Math.max(0, Math.min(duration, ((me.clientX - rect.left) / rect.width) * duration))
        const [s, en] = endT >= startT ? [startT, endT] : [endT, startT]
        onAbLoopDrag({ start: s, end: en })
      }
      const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
      window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
    } else {
      onSeek?.(posFromEvent(e))
    }
  }

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    if (onLocatorAdd) onLocatorAdd(posFromEvent(e))
  }

  return (
    <div
      data-ruler="1"
      style={{ position: 'relative', height: 22, borderBottom: '1px solid var(--border)', cursor: onSeek ? 'pointer' : 'default', overflow: 'hidden' }}
      onMouseDown={handleMouseDown}
      onContextMenu={handleContextMenu}
    >
      {/* A/B loop region highlight */}
      {abLoop && (
        <div style={{
          position: 'absolute',
          left: (abLoop.start / duration) * px,
          width: Math.max(2, ((abLoop.end - abLoop.start) / duration) * px),
          top: 0, bottom: 0,
          background: abLoopEnabled ? 'rgba(251,191,36,0.18)' : 'rgba(139,92,246,0.12)',
          borderLeft: `1px solid ${abLoopEnabled ? 'rgba(251,191,36,0.6)' : 'rgba(139,92,246,0.4)'}`,
          borderRight: `1px solid ${abLoopEnabled ? 'rgba(251,191,36,0.6)' : 'rgba(139,92,246,0.4)'}`,
          pointerEvents: 'none',
        }} />
      )}
      {/* Ticks */}
      {ticks.map(({ t, major, label }) => (
        <div key={t} style={{ position: 'absolute', left: (t / duration) * px, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
          {major && label && (
            <span style={{ fontSize: 9, color: 'var(--text-muted)', userSelect: 'none', whiteSpace: 'nowrap', transform: 'translateX(-50%)', lineHeight: '13px' }}>{label}</span>
          )}
          <div style={{ position: 'absolute', bottom: 0, width: 1, height: major ? 6 : 4, background: major ? 'var(--border-light)' : 'var(--border)' }} />
        </div>
      ))}
      {/* Locators */}
      {locators?.map(loc => (
        <div
          key={loc.id}
          title={`${loc.label} (right-click to remove)`}
          onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onLocatorRemove?.(loc.id) }}
          style={{ position: 'absolute', left: (loc.time / duration) * px, top: 0, bottom: 0, cursor: 'pointer', pointerEvents: 'all' }}
        >
          <div style={{ position: 'absolute', top: 0, left: -5, width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '8px solid #f59e0b' }} />
          <div style={{ position: 'absolute', top: 8, left: 0, width: 1, height: 14, background: '#f59e0b', opacity: 0.7 }} />
          <span style={{ position: 'absolute', top: 1, left: 7, fontSize: 8, color: '#f59e0b', whiteSpace: 'nowrap', userSelect: 'none' }}>{loc.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── HitBlock ──────────────────────────────────────────────────────────────────

interface HitBlockProps {
  hit: BeatHit
  duration: number
  pxWidth: number
  selected: boolean
  muted: boolean
  aiSuggestion?: BeatType
  aiDeleteSuggestion?: boolean
  typeOverrides: TypeOverrides
  snapInterval?: number
  onSelect: (additive: boolean) => void
  onMove: (id: string, time: number, note: number) => void
  onDelete: () => void
  onRightClick: (e: React.MouseEvent, id: string) => void
}

function HitBlock({ hit, duration, pxWidth, selected, muted, aiSuggestion, aiDeleteSuggestion, typeOverrides, snapInterval, onSelect, onMove, onDelete, onRightClick }: HitBlockProps) {
  const color = typeColor(hit.type, typeOverrides)
  const noteVal = hit.note ?? Math.round((NOTE_MIN + NOTE_MAX) / 2)
  // Width: proportional to hit.duration when set, else narrow default
  const hitDur = hit.duration ?? 0
  const blockW = hitDur > 0 ? Math.max(8, Math.min(pxWidth * 0.4, (hitDur / duration) * pxWidth)) : 13
  const left = (hit.time / duration) * pxWidth - (hitDur > 0 ? 0 : 6)
  const top = (1 - (noteVal - NOTE_MIN) / NOTE_RANGE) * (LANE_HEIGHT - 10) + 1

  function handlePointerDown(e: React.PointerEvent) {
    e.stopPropagation()
    e.preventDefault()
    onSelect(e.shiftKey || e.metaKey || e.ctrlKey)

    const startX = e.clientX
    const startY = e.clientY
    const startTime = hit.time
    const startNote = noteVal
    const capDur = duration
    const capPx = pxWidth
    const snap = snapInterval

    function onGlobalMove(ev: PointerEvent) {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      let newTime = Math.max(0, Math.min(capDur - 0.01, startTime + (dx / capPx) * capDur))
      if (snap && snap > 0) newTime = Math.max(0, Math.min(capDur - 0.01, Math.round(newTime / snap) * snap))
      // Vertical: snap to nearest semitone (already integer, just clamp)
      const newNote = Math.max(NOTE_MIN, Math.min(NOTE_MAX, Math.round(startNote - (dy / LANE_HEIGHT) * NOTE_RANGE)))
      onMove(hit.id, newTime, newNote)
    }
    function onGlobalUp() {
      document.removeEventListener('pointermove', onGlobalMove)
      document.removeEventListener('pointerup', onGlobalUp)
    }
    document.addEventListener('pointermove', onGlobalMove)
    document.addEventListener('pointerup', onGlobalUp)
  }

  return (
    <div style={{ position: 'absolute', left, top, zIndex: selected ? 10 : 1 }}>
      <div
        onPointerDown={handlePointerDown}
        onMouseDown={e => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => { e.stopPropagation(); onDelete() }}
        onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onRightClick(e, hit.id) }}
        title={aiDeleteSuggestion ? 'AI: delete (noise/false hit) · right-click to edit' : aiSuggestion ? `AI: ${typeLabel(aiSuggestion, typeOverrides)} · right-click to edit` : 'Right-click to edit'}
        style={{
          width: blockW, height: 8,
          background: muted ? 'var(--border-light)' : color,
          borderRadius: 2,
          opacity: muted ? 0.35 : selected ? 1 : 0.35 + 0.6 * hit.velocity,
          cursor: 'grab',
          boxShadow: selected && !muted
            ? `0 0 0 1px #fff, 0 0 0 2px ${color}`
            : aiDeleteSuggestion
              ? '0 0 0 1.5px rgba(239,68,68,0.8)'
              : aiSuggestion
                ? '0 0 0 1.5px rgba(139,92,246,0.8)'
                : 'none',
          touchAction: 'none',
          transition: 'box-shadow 0.1s',
        }}
      />
      {/* AI delete marker — red X above the hit */}
      {aiDeleteSuggestion && !muted && (
        <div style={{
          position: 'absolute', top: -6, left: 2,
          fontSize: 8, lineHeight: 1, color: 'rgba(239,68,68,0.9)',
          pointerEvents: 'none', fontWeight: 700,
        }}>✕</div>
      )}
      {/* AI reclassify marker — purple dot above the hit */}
      {aiSuggestion && !aiDeleteSuggestion && !muted && (
        <div style={{
          position: 'absolute', top: -5, left: 3,
          width: 5, height: 5, borderRadius: '50%',
          background: 'rgba(139,92,246,0.9)',
          pointerEvents: 'none',
        }} />
      )}
    </div>
  )
}

// ── Note grid (C-note lines) ──────────────────────────────────────────────────

function NoteGrid() {
  const lines: React.ReactNode[] = []
  for (let n = NOTE_MIN; n <= NOTE_MAX; n += 12) {
    const y = (1 - (n - NOTE_MIN) / NOTE_RANGE) * LANE_HEIGHT
    lines.push(<div key={n} style={{ position: 'absolute', left: 0, right: 0, top: y, height: 1, background: 'rgba(139,92,246,0.15)', pointerEvents: 'none' }} />)
  }
  return <>{lines}</>
}

// ── Note Y-axis labels ────────────────────────────────────────────────────────

function NoteAxis() {
  const markers: React.ReactNode[] = []
  for (let n = NOTE_MIN; n <= NOTE_MAX; n += 12) {
    const y = (1 - (n - NOTE_MIN) / NOTE_RANGE) * LANE_HEIGHT
    markers.push(
      <div key={n} style={{ position: 'absolute', right: 3, top: y - 5, fontSize: 8, color: 'rgba(139,92,246,0.45)', pointerEvents: 'none', userSelect: 'none' }}>
        {midiName(n)}
      </div>
    )
  }
  return (
    <div style={{ position: 'relative', width: 24, height: LANE_HEIGHT, flexShrink: 0, background: 'var(--bg-surface)', borderRight: '1px solid rgba(139,92,246,0.08)' }}>
      {markers}
    </div>
  )
}

// ── Lane ──────────────────────────────────────────────────────────────────────

interface WarpMarker { bufFrac: number; timeFrac: number }

type LaneEffectType = 'eq3' | 'comp' | 'crush' | 'reverb' | 'delay' | 'chorus' | 'phaser' | 'flanger' | 'autofilter' | 'saturator' | 'lfo' | 'beatrepeat'
interface LaneEffect {
  id: string
  type: LaneEffectType
  enabled: boolean
  params: Record<string, number>
}
const LANE_EFFECT_DEFAULTS: Record<LaneEffectType, Record<string, number>> = {
  eq3:        { low: 0, mid: 0, high: 0, midFreq: 1000 },
  comp:       { threshold: -24, ratio: 4, attack: 0.003, release: 0.25, knee: 6 },
  crush:      { bits: 8 },
  reverb:     { wet: 0.3, decay: 2.0 },
  delay:      { wet: 0.3, time: 0.25, feedback: 0.4 },
  chorus:     { wet: 0.5, rate: 1.2, depth: 0.003, delay: 0.025 },
  phaser:     { wet: 0.5, rate: 0.5, depth: 1000 },
  flanger:    { wet: 0.5, rate: 0.25, depth: 0.005, delay: 0.005, feedback: 0.5 },
  autofilter: { wet: 1.0, freq: 800, Q: 1.5, lfoRate: 1.0, lfoDepth: 600, type: 0 },
  saturator:  { drive: 3, wet: 1.0 },
  lfo:        { rate: 2.0, depth: 0.6, shape: 0 }, // shape: 0=sine 1=square 2=sawtooth
  beatrepeat: { grid: 0.125, chance: 1.0, pitch: 0, feedback: 0.5 },
}
const LANE_EFFECT_LABELS: Record<LaneEffectType, string> = {
  eq3: 'EQ3', comp: 'Comp', crush: 'Crush', reverb: 'Reverb', delay: 'Delay',
  chorus: 'Chorus', phaser: 'Phaser', flanger: 'Flanger', autofilter: 'AutoFilt', saturator: 'Satur',
  lfo: 'LFO', beatrepeat: 'BeatRpt',
}

// ── Automation ──────────────────────────────────────────────────────────────
type AutomParam = 'volume' | 'pan'
interface AutomPoint { id: string; time: number; value: number }
interface AutomLaneDef { id: string; laneType: string; param: AutomParam; points: AutomPoint[] }

const AUTOM_RANGE: Record<AutomParam, [number, number]> = { volume: [0, 1.5], pan: [-1, 1] }
const AUTOM_DEFAULT: Record<AutomParam, number>          = { volume: 1, pan: 0 }
const AUTOM_LABEL: Record<AutomParam, string>            = { volume: 'VOL', pan: 'PAN' }
const AUTOM_H = 52

interface AudioClipShape {
  id: string; startTime: number; muted: boolean; name: string
  buf: { duration: number; sampleRate: number; getChannelData(ch: number): Float32Array }
  gain: number
  stretchDuration: number | null
  loopDuration:    number | null
  gateThreshold:   number
  fadeIn:          number        // seconds
  fadeOut:         number        // seconds
  color:           string | null // null = default purple
  reversed:        boolean
  warpMarkers:     WarpMarker[]
  gainEnvelope?:   { t: number; v: number }[]  // t: 0-1 normalized within clip, v: 0-1 gain
}

function clipEffectiveDuration(c: AudioClipShape) {
  return c.loopDuration ?? c.stretchDuration ?? c.buf.duration
}

function WaveformCanvas({ buf, color, gain = 1, gateThreshold = 0, loopDuration = null, stretchDuration = null, fadeIn = 0, fadeOut = 0, reversed = false, warpMarkers = [], gainEnvelope }: {
  buf: AudioClipShape['buf']; color: string
  gain?: number; gateThreshold?: number; loopDuration?: number | null; stretchDuration?: number | null
  fadeIn?: number; fadeOut?: number; reversed?: boolean; warpMarkers?: WarpMarker[]
  gainEnvelope?: { t: number; v: number }[]
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const w = Math.max(1, Math.round(parent.clientWidth))
    const h = Math.max(1, Math.round(parent.clientHeight))
    canvas.width = w; canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const raw    = buf.getChannelData(0)
    const mid    = h / 2
    const maxAmp = Math.min(0.92, 0.88 * gain)

    ctx.clearRect(0, 0, w, h)

    const cycleDur  = stretchDuration ?? buf.duration
    const effDur    = loopDuration ?? cycleDur
    const isLooped  = loopDuration != null && loopDuration > cycleDur
    const cyclePx   = isLooped ? (cycleDur / loopDuration!) * w : w
    const dimColor  = color.replace(/[\d.]+\)$/, '0.15)')

    let startX = 0, loopIdx = 0
    while (startX < w) {
      if (isLooped && loopIdx > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1
        ctx.setLineDash([2, 3])
        ctx.beginPath(); ctx.moveTo(startX + 0.5, 0); ctx.lineTo(startX + 0.5, h); ctx.stroke()
        ctx.setLineDash([])
      }

      const bars: { mn: number; mx: number; barAmp: number }[] = []
      for (let x = 0; x < cyclePx && startX + x < w; x++) {
        const frac = x / cyclePx
        const base = Math.floor(frac * raw.length)
        const step = Math.max(1, Math.ceil(raw.length / cyclePx))
        let mn = 0, mx = 0
        for (let i = 0; i < step && base + i < raw.length; i++) {
          const v = raw[base + i]; if (v < mn) mn = v; if (v > mx) mx = v
        }
        bars.push({ mn, mx, barAmp: Math.max(Math.abs(mn), Math.abs(mx)) })
      }

      ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath()
      for (let x = 0; x < bars.length; x++) {
        const { mn, mx, barAmp } = bars[x]
        if (gateThreshold <= 0 || barAmp >= gateThreshold) {
          const px = startX + x
          ctx.moveTo(px + 0.5, mid + mn * mid * maxAmp)
          ctx.lineTo(px + 0.5, mid + mx * mid * maxAmp)
        }
      }
      ctx.stroke()

      if (gateThreshold > 0) {
        ctx.strokeStyle = dimColor; ctx.lineWidth = 1; ctx.beginPath()
        for (let x = 0; x < bars.length; x++) {
          const { mn, mx, barAmp } = bars[x]
          if (barAmp < gateThreshold) {
            const px = startX + x
            ctx.moveTo(px + 0.5, mid + mn * mid * maxAmp)
            ctx.lineTo(px + 0.5, mid + mx * mid * maxAmp)
          }
        }
        ctx.stroke()
      }

      if (!isLooped) break
      startX += cyclePx; loopIdx++
      if (loopIdx > 64) break
    }

    // Midline
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, mid); ctx.lineTo(w, mid); ctx.stroke()

    // Gate threshold lines
    if (gateThreshold > 0) {
      const threshPx = gateThreshold * mid * maxAmp
      ctx.strokeStyle = 'rgba(251,191,36,0.6)'; ctx.lineWidth = 1
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(0, mid - threshPx); ctx.lineTo(w, mid - threshPx)
      ctx.moveTo(0, mid + threshPx); ctx.lineTo(w, mid + threshPx)
      ctx.stroke(); ctx.setLineDash([])
    }

    // Fade-in overlay: dark triangle on the left
    if (fadeIn > 0 && effDur > 0) {
      const fadeInPx = Math.min(w, (fadeIn / effDur) * w)
      const grad = ctx.createLinearGradient(0, 0, fadeInPx, 0)
      grad.addColorStop(0, 'rgba(0,0,0,0.72)')
      grad.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = grad
      ctx.fillRect(0, 0, fadeInPx, h)
      // Handle triangle marker
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.lineTo(0, 10); ctx.closePath(); ctx.fill()
    }

    // Fade-out overlay: dark triangle on the right
    if (fadeOut > 0 && effDur > 0) {
      const fadeOutPx = Math.min(w, (fadeOut / effDur) * w)
      const grad = ctx.createLinearGradient(w - fadeOutPx, 0, w, 0)
      grad.addColorStop(0, 'rgba(0,0,0,0)')
      grad.addColorStop(1, 'rgba(0,0,0,0.72)')
      ctx.fillStyle = grad
      ctx.fillRect(w - fadeOutPx, 0, fadeOutPx, h)
      ctx.fillStyle = 'rgba(255,255,255,0.7)'
      ctx.beginPath(); ctx.moveTo(w, 0); ctx.lineTo(w - 10, 0); ctx.lineTo(w, 10); ctx.closePath(); ctx.fill()
    }

    // Reversed indicator
    if (reversed) {
      ctx.fillStyle = 'rgba(250,200,80,0.22)'
      ctx.fillRect(0, 0, w, h)
    }

    // Warp marker lines
    for (const m of warpMarkers) {
      const mx = m.timeFrac * w
      ctx.strokeStyle = 'rgba(255,220,80,0.85)'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(mx + 0.5, 0); ctx.lineTo(mx + 0.5, h); ctx.stroke()
      // Diamond handle at top
      ctx.fillStyle = 'rgba(255,220,80,0.95)'
      ctx.beginPath()
      ctx.moveTo(mx, 3); ctx.lineTo(mx + 5, 8); ctx.lineTo(mx, 13); ctx.lineTo(mx - 5, 8); ctx.closePath()
      ctx.fill()
    }
    // Gain envelope overlay
    if (gainEnvelope && gainEnvelope.length >= 2) {
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (const pt of gainEnvelope) ctx.lineTo(pt.t * w, (1 - pt.v) * h)
      ctx.lineTo(w, h)
      ctx.closePath()
      ctx.fillStyle = 'rgba(167,139,250,0.25)'
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(gainEnvelope[0].t * w, (1 - gainEnvelope[0].v) * h)
      for (let i = 1; i < gainEnvelope.length; i++) ctx.lineTo(gainEnvelope[i].t * w, (1 - gainEnvelope[i].v) * h)
      ctx.strokeStyle = 'rgba(167,139,250,0.7)'; ctx.lineWidth = 1.5; ctx.stroke()
      ctx.fillStyle = 'rgba(167,139,250,0.9)'
      for (const pt of gainEnvelope) {
        ctx.beginPath(); ctx.arc(pt.t * w, (1 - pt.v) * h, 4, 0, Math.PI * 2); ctx.fill()
      }
    }
  }, [buf, color, gain, gateThreshold, loopDuration, stretchDuration, fadeIn, fadeOut, reversed, warpMarkers, gainEnvelope])
  return <canvas ref={ref} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
}

function getClipZone(rx: number, ry: number, w: number, h: number, warpMarkers: WarpMarker[] = []): string {
  const eW = Math.min(14, w * 0.18), eH = 7, midY = h / 2
  // Warp markers — thin grab strip around each marker line
  for (const m of warpMarkers) {
    if (Math.abs(rx - m.timeFrac * w) < 5) return 'warp-marker'
  }
  // Fade handles — top 10px, outer 16px corners
  if (ry < 10 && rx < 16) return 'fade-in'
  if (ry < 10 && rx > w - 16) return 'fade-out'
  if (ry < eH) return 'top-edge'
  if (ry > h - eH) return 'bottom-edge'
  if (rx < eW) return ry < midY ? 'left-loop' : 'left-stretch'
  if (rx > w - eW) return ry < midY ? 'right-loop' : 'right-stretch'
  if (Math.abs(ry - midY) < 5) return 'midline'
  return 'move'
}

const ZONE_CURSOR: Record<string, string> = {
  'top-edge': 'ns-resize', 'bottom-edge': 'ns-resize',
  'left-loop': 'ew-resize', 'right-loop': 'ew-resize',
  'left-stretch': 'ew-resize', 'right-stretch': 'ew-resize',
  'midline': 'ns-resize', 'move': 'grab',
  'fade-in': 'e-resize', 'fade-out': 'w-resize',
  'warp-marker': 'ew-resize',
}

// ── AutomLaneView — draws one automation sub-lane ────────────────────────────

function AutomLaneView({ def, duration, pxWidth, onPointAdd, onPointUpdate, onPointDelete, onRemove }: {
  def: AutomLaneDef; duration: number; pxWidth: number
  onPointAdd: (pt: AutomPoint) => void
  onPointUpdate: (id: string, pt: Partial<AutomPoint>) => void
  onPointDelete: (id: string) => void
  onRemove: () => void
}) {
  const [min, max] = AUTOM_RANGE[def.param]
  const defVal     = AUTOM_DEFAULT[def.param]

  const timeToX = (t: number) => duration > 0 ? (t / duration) * pxWidth : 0
  const xToTime = (x: number) => Math.max(0, Math.min(duration, duration > 0 ? (x / pxWidth) * duration : 0))
  const valToY  = (v: number) => AUTOM_H - ((v - min) / (max - min)) * AUTOM_H
  const yToVal  = (y: number) => Math.max(min, Math.min(max, min + (1 - y / AUTOM_H) * (max - min)))

  const sorted = def.points.slice().sort((a, b) => a.time - b.time)
  const defY   = valToY(defVal)

  // Polyline: flat from 0 to first pt, then interpolated, then flat to end
  const lineXY: [number, number][] = []
  if (sorted.length === 0) {
    lineXY.push([0, defY], [pxWidth, defY])
  } else {
    lineXY.push([0, valToY(sorted[0].value)])
    for (const p of sorted) lineXY.push([timeToX(p.time), valToY(p.value)])
    lineXY.push([pxWidth, valToY(sorted[sorted.length - 1].value)])
  }

  const handleBgDown = (e: React.MouseEvent<SVGElement>) => {
    if (e.button !== 0) return
    if ((e.target as Element).tagName.toLowerCase() === 'circle') return
    const r = e.currentTarget.getBoundingClientRect()
    const t = xToTime(e.clientX - r.left)
    const v = yToVal(e.clientY - r.top)
    onPointAdd({ id: Math.random().toString(36).slice(2), time: t, value: v })
  }

  const handlePtDown = (e: React.MouseEvent<SVGCircleElement>, pt: AutomPoint) => {
    e.stopPropagation()
    if (e.button !== 0) return
    const sx = e.clientX, sy = e.clientY
    const ox = timeToX(pt.time), oy = valToY(pt.value)
    const track = (me: MouseEvent) => {
      onPointUpdate(pt.id, { time: xToTime(ox + me.clientX - sx), value: yToVal(oy + me.clientY - sy) })
    }
    const up = () => { window.removeEventListener('mousemove', track); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', track); window.addEventListener('mouseup', up)
  }

  const fillPts = `0,${AUTOM_H} ${lineXY.map(([x, y]) => `${x},${y}`).join(' ')} ${pxWidth},${AUTOM_H}`
  const linePts = lineXY.map(([x, y]) => `${x},${y}`).join(' ')

  return (
    <div style={{ display: 'flex', height: AUTOM_H, borderTop: '1px solid rgba(139,92,246,0.12)', background: 'var(--bg-card)' }}>
      {/* Label stub */}
      <div style={{ width: 140, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 6px' }}>
        <span style={{ fontSize: 8, fontWeight: 700, color: 'rgba(139,92,246,0.75)', letterSpacing: '0.07em' }}>{AUTOM_LABEL[def.param]}</span>
        <span onClick={onRemove} style={{ fontSize: 9, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1 }}>×</span>
      </div>
      {/* Timeline SVG */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', cursor: 'crosshair' }}>
        <svg width={pxWidth} height={AUTOM_H} style={{ display: 'block', overflow: 'visible' }}
          onMouseDown={handleBgDown}>
          {/* Default value reference */}
          <line x1={0} y1={defY} x2={pxWidth} y2={defY} stroke="rgba(255,255,255,0.08)" strokeWidth={1} strokeDasharray="3,3" />
          {/* Fill */}
          <polygon points={fillPts} fill="rgba(139,92,246,0.1)" />
          {/* Curve line */}
          <polyline points={linePts} fill="none" stroke="rgba(139,92,246,0.75)" strokeWidth={1.5} />
          {/* Point handles */}
          {sorted.map(pt => (
            <circle key={pt.id} cx={timeToX(pt.time)} cy={valToY(pt.value)} r={4.5}
              fill="rgba(139,92,246,1)" stroke="rgba(255,255,255,0.85)" strokeWidth={1.2}
              style={{ cursor: 'grab' }}
              onMouseDown={e => handlePtDown(e, pt)}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onPointDelete(pt.id) }} />
          ))}
        </svg>
      </div>
    </div>
  )
}

// ── FxSlot — a single effect card inside the FX strip ────────────────────────

type FxParamSpec = { key: string; label: string; min: number; max: number; step?: number; decimals?: number }

const FX_PARAM_SPECS: Record<LaneEffectType, FxParamSpec[]> = {
  eq3:        [{ key: 'low', label: 'Low', min: -12, max: 12, decimals: 0 }, { key: 'mid', label: 'Mid', min: -12, max: 12, decimals: 0 }, { key: 'high', label: 'Hi', min: -12, max: 12, decimals: 0 }, { key: 'midFreq', label: 'Freq', min: 200, max: 8000, step: 10, decimals: 0 }],
  comp:       [{ key: 'threshold', label: 'Thr', min: -60, max: 0, decimals: 0 }, { key: 'ratio', label: 'Rat', min: 1, max: 20, decimals: 1 }, { key: 'attack', label: 'Att', min: 0, max: 0.5, step: 0.001, decimals: 3 }, { key: 'release', label: 'Rel', min: 0, max: 2, step: 0.01, decimals: 2 }],
  crush:      [{ key: 'bits', label: 'Bits', min: 1, max: 16, decimals: 0 }],
  reverb:     [{ key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, decimals: 2 }, { key: 'decay', label: 'Decay', min: 0.2, max: 8, step: 0.1, decimals: 1 }],
  delay:      [{ key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, decimals: 2 }, { key: 'time', label: 'Time', min: 0.01, max: 2, step: 0.01, decimals: 2 }, { key: 'feedback', label: 'FB', min: 0, max: 0.95, step: 0.01, decimals: 2 }],
  chorus:     [{ key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, decimals: 2 }, { key: 'rate', label: 'Rate', min: 0.1, max: 8, step: 0.1, decimals: 1 }, { key: 'depth', label: 'Depth', min: 0.001, max: 0.02, step: 0.001, decimals: 3 }],
  phaser:     [{ key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, decimals: 2 }, { key: 'rate', label: 'Rate', min: 0.1, max: 8, step: 0.1, decimals: 1 }, { key: 'depth', label: 'Depth', min: 100, max: 4000, step: 10, decimals: 0 }],
  flanger:    [{ key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, decimals: 2 }, { key: 'rate', label: 'Rate', min: 0.05, max: 4, step: 0.05, decimals: 2 }, { key: 'depth', label: 'Depth', min: 0.001, max: 0.015, step: 0.001, decimals: 3 }, { key: 'feedback', label: 'FB', min: 0, max: 0.9, step: 0.01, decimals: 2 }],
  autofilter: [{ key: 'freq', label: 'Freq', min: 80, max: 16000, step: 10, decimals: 0 }, { key: 'Q', label: 'Q', min: 0.5, max: 18, step: 0.1, decimals: 1 }, { key: 'lfoRate', label: 'LFO', min: 0.1, max: 16, step: 0.1, decimals: 1 }, { key: 'lfoDepth', label: 'Dpth', min: 0, max: 8000, step: 50, decimals: 0 }],
  saturator:  [{ key: 'drive', label: 'Drive', min: 1, max: 20, step: 0.5, decimals: 1 }, { key: 'wet', label: 'Wet', min: 0, max: 1, step: 0.01, decimals: 2 }],
  lfo:        [{ key: 'rate', label: 'Rate', min: 0.1, max: 20, step: 0.1, decimals: 1 }, { key: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, decimals: 2 }, { key: 'shape', label: 'Shape', min: 0, max: 2, step: 1, decimals: 0 }],
  beatrepeat: [{ key: 'grid', label: 'Grid', min: 0.03125, max: 1, step: 0.03125, decimals: 3 }, { key: 'chance', label: 'Prob', min: 0, max: 1, step: 0.01, decimals: 2 }, { key: 'pitch', label: 'Pitch', min: -12, max: 12, step: 1, decimals: 0 }, { key: 'feedback', label: 'FB', min: 0, max: 0.9, step: 0.01, decimals: 2 }],
}

function FxSlot({ fx, onToggleEnabled, onRemove, onParamChange, sidechainLane, allLaneTypes, onSidechainChange }: {
  fx: LaneEffect
  onToggleEnabled: () => void
  onRemove: () => void
  onParamChange: (key: string, val: number) => void
  sidechainLane?: string
  allLaneTypes?: string[]
  onSidechainChange?: (val: string) => void
}) {
  const specs = FX_PARAM_SPECS[fx.type]

  const startKnobDrag = (spec: FxParamSpec, e: React.MouseEvent) => {
    e.stopPropagation(); e.preventDefault()
    const startY = e.clientY
    const startVal = fx.params[spec.key] ?? spec.min
    const range = spec.max - spec.min
    const sensitivity = range / 100
    const track = (me: MouseEvent) => {
      const delta = (startY - me.clientY) * sensitivity
      const clamped = Math.max(spec.min, Math.min(spec.max, startVal + delta))
      const stepped = spec.step ? Math.round(clamped / spec.step) * spec.step : clamped
      onParamChange(spec.key, stepped)
    }
    const up = () => { window.removeEventListener('mousemove', track); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', track); window.addEventListener('mouseup', up)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderRadius: 6, border: `1px solid ${fx.enabled ? 'rgba(139,92,246,0.35)' : 'var(--border)'}`, background: fx.enabled ? 'rgba(139,92,246,0.06)' : 'var(--bg-card)', padding: '5px 7px', marginRight: 6, minWidth: 80, flexShrink: 0, opacity: fx.enabled ? 1 : 0.5 }}>
      {/* Header row: toggle + name + × */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 5 }}>
        <div onClick={onToggleEnabled} style={{ width: 10, height: 10, borderRadius: '50%', background: fx.enabled ? 'rgba(139,92,246,0.8)' : 'var(--border)', cursor: 'pointer', flexShrink: 0 }} />
        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.06em', flex: 1 }}>{LANE_EFFECT_LABELS[fx.type]}</span>
        <span onClick={onRemove} style={{ fontSize: 9, color: 'var(--text-muted)', cursor: 'pointer', lineHeight: 1 }}>×</span>
      </div>
      {/* Parameter knobs */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {specs.map(spec => (
          <div key={spec.key} onMouseDown={e => startKnobDrag(spec, e)} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'ns-resize', userSelect: 'none', gap: 1 }}>
            <span style={{ fontSize: 7, color: 'var(--text-muted)', lineHeight: 1 }}>{spec.label}</span>
            <span style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1 }}>
              {fx.type === 'lfo' && spec.key === 'shape'
                ? (['Sine', 'Sq', 'Saw'] as const)[Math.round(fx.params.shape ?? 0)] ?? 'Sine'
                : (fx.params[spec.key] ?? spec.min).toFixed(spec.decimals ?? 1)}
            </span>
          </div>
        ))}
      </div>
      {/* Sidechain select — only shown for comp effects with available lanes */}
      {fx.type === 'comp' && allLaneTypes && allLaneTypes.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={{ fontSize: 7, color: 'var(--text-muted)', marginBottom: 2, letterSpacing: '0.04em' }}>Sidechain</div>
          <select
            value={sidechainLane ?? ''}
            onChange={e => { e.stopPropagation(); onSidechainChange?.(e.target.value) }}
            onClick={e => e.stopPropagation()}
            style={{ fontSize: 8, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 3, padding: '1px 2px', width: '100%', cursor: 'pointer' }}
          >
            <option value=''>Off</option>
            {allLaneTypes.map(lt => <option key={lt} value={lt}>{lt}</option>)}
          </select>
        </div>
      )}
    </div>
  )
}

interface LaneProps {
  type: BeatType
  hits: BeatHit[]
  clips: AudioClipShape[]
  duration: number
  pxWidth: number
  selectedIds: Set<string>
  muted: boolean
  aiSuggestions?: Map<string, BeatType> | null
  aiDeletions?: Set<string>
  typeOverrides: TypeOverrides
  isCustom: boolean
  isActiveLane: boolean
  snapInterval?: number
  onSelectHit: (id: string, additive: boolean) => void
  onSelectLane: () => void
  onOpenPianoRoll?: () => void
  onOpenStepSeq?: () => void
  onOpenChordBuilder?: () => void
  onMoveHit: (id: string, t: number, note: number) => void
  onDeleteHit: (id: string) => void
  onAddHit: (t: number, note: number) => void
  onLibraryDrop?: (entryId: string, time: number) => void
  onToggleMute: () => void
  onLaneContextMenu: (e: React.MouseEvent) => void
  onHitRightClick: (e: React.MouseEvent, id: string) => void
  onClipRightClick: (e: React.MouseEvent, clipId: string) => void
  onClipDelete: (clipId: string) => void
  onClipSelect: (clipId: string, additive: boolean) => void
  onMultiSelect: (clipIds: string[], additive: boolean) => void
  selectedClipIds: Set<string>
  onClipUpdate: (clipId: string, update: Partial<Pick<AudioClipShape, 'startTime' | 'gain' | 'stretchDuration' | 'loopDuration' | 'gateThreshold' | 'fadeIn' | 'fadeOut' | 'color' | 'reversed' | 'warpMarkers' | 'gainEnvelope'>>) => void
  // Mixer
  pan: number; soloed: boolean; anySoloed: boolean
  onPanChange: (v: number) => void; onSoloToggle: () => void
  // FX chain
  effects: LaneEffect[]
  fxOpen: boolean
  fxAddOpen: boolean
  onFxToggleOpen: () => void
  onFxAddOpen: () => void
  onFxAddClose: () => void
  onFxAdd: (type: LaneEffectType) => void
  onFxRemove: (id: string) => void
  onFxToggleEnabled: (id: string) => void
  onFxParamChange: (id: string, key: string, val: number) => void
  onFxRandomize: () => void
  // Automation
  automLanes: AutomLaneDef[]
  automOpen: boolean
  automAddOpen: boolean
  onAutomToggle: () => void
  onAutomAddOpen: () => void
  onAutomAddClose: () => void
  onAutomAdd: (param: AutomParam) => void
  onAutomRemove: (id: string) => void
  onAutomPointAdd: (id: string, pt: AutomPoint) => void
  onAutomPointUpdate: (id: string, ptId: string, update: Partial<AutomPoint>) => void
  onAutomPointDelete: (id: string, ptId: string) => void
  level?: number  // RMS 0–1 from AnalyserNode, updated during playback
  miniMode?: boolean
  spectrumOpen?: boolean
  analyserNode?: AnalyserNode | null
  onToggleMini?: () => void
  onToggleSpectrum?: () => void
  loopBeats?: number  // 0 = follow global
  onLoopBeatsChange?: (beats: number) => void
  inputArmed?: boolean
  inputSource?: string
  onToggleInput?: () => void
  onOpenInputPicker?: () => void
  // Sidechain routing
  allLaneTypes?: string[]
  sidechains?: Record<string, string>  // key: effectId, value: source lane type
  onSidechainChange?: (effectId: string, val: string) => void
}

function Lane({ type, hits, clips, duration, pxWidth, selectedIds, muted, aiSuggestions, aiDeletions, typeOverrides, isCustom, isActiveLane, snapInterval, onSelectHit, onSelectLane, onOpenPianoRoll, onOpenStepSeq, onOpenChordBuilder, onMoveHit, onDeleteHit, onAddHit, onLibraryDrop, onToggleMute, onLaneContextMenu, onHitRightClick, onClipRightClick, onClipDelete, onClipSelect, onMultiSelect, selectedClipIds, onClipUpdate, pan, soloed, anySoloed, onPanChange, onSoloToggle, effects, fxOpen, fxAddOpen, onFxToggleOpen, onFxAddOpen, onFxAddClose, onFxAdd, onFxRemove, onFxToggleEnabled, onFxParamChange, onFxRandomize, automLanes, automOpen, automAddOpen, onAutomToggle, onAutomAddOpen, onAutomAddClose, onAutomAdd, onAutomRemove, onAutomPointAdd, onAutomPointUpdate, onAutomPointDelete, level = 0, miniMode = false, spectrumOpen = false, analyserNode, onToggleMini, onToggleSpectrum, loopBeats = 0, onLoopBeatsChange, inputArmed = false, inputSource, onToggleInput, onOpenInputPicker, allLaneTypes, sidechains, onSidechainChange }: LaneProps) {
  const color = typeColor(type, typeOverrides)
  const label = typeLabel(type, typeOverrides)

  const [dotMenuOpen,   setDotMenuOpen]   = useState(false)
  const [libDragOver,   setLibDragOver]   = useState(false)

  function startPanDrag(e: React.MouseEvent) {
    e.stopPropagation(); e.preventDefault()
    const sx = e.clientX, orig = pan
    const move = (me: MouseEvent) => onPanChange(Math.max(-1, Math.min(1, orig + (me.clientX - sx) / 28)))
    const up   = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }

  function calcLaneHit(e: React.MouseEvent<HTMLDivElement>): [number, number] {
    const rect = e.currentTarget.getBoundingClientRect()
    let t = ((e.clientX - rect.left) / rect.width) * duration
    if (snapInterval && snapInterval > 0) t = Math.round(t / snapInterval) * snapInterval
    const note = Math.round(NOTE_MAX - ((e.clientY - rect.top) / rect.height) * NOTE_RANGE)
    return [Math.max(0, Math.min(duration - 0.01, t)), Math.max(NOTE_MIN, Math.min(NOTE_MAX, note))]
  }

  function handleLaneClick(e: React.MouseEvent<HTMLDivElement>) {
    const [t, note] = calcLaneHit(e)
    onAddHit(t, note)
  }

  function handleLaneRightClick(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault()
    onLaneContextMenu(e)
  }

  const dimmed = muted || (anySoloed && !soloed)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)', opacity: dimmed ? 0.45 : 1 }}>
    <div style={{ display: 'flex', alignItems: 'stretch', height: miniMode ? 28 : LANE_HEIGHT }}>
      {/* Lane header: label + M/S + ··· menu */}
      <div
        onContextMenu={e => { e.preventDefault(); onLaneContextMenu(e) }}
        style={{
          width: 140, flexShrink: 0, borderRight: '1px solid var(--border)',
          background: isActiveLane ? 'var(--accent-subtle)' : 'var(--bg-surface)',
          display: 'flex', flexDirection: 'column', userSelect: 'none',
          borderLeft: isActiveLane ? `2px solid ${color}` : '2px solid transparent',
          position: 'sticky', left: 24, zIndex: 3,
        }}
      >
        {/* Label row */}
        <Tooltip content={`Click to inspect\nDouble-click to ${miniMode ? 'expand' : 'collapse'}`} placement="right" delay={900}>
        <div onClick={onSelectLane} onDoubleClick={onToggleMini} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, padding: '4px 4px 2px', cursor: 'pointer' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: dimmed ? 'var(--border-light)' : color }} />
          <span style={{ fontSize: 9, fontWeight: 600, color: isActiveLane ? 'var(--text-primary)' : dimmed ? 'var(--text-muted)' : 'var(--text-secondary)', letterSpacing: '0.04em', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'center' }}>
            {label}
          </span>
          {!miniMode && hits.length > 0 && <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>{hits.length}</span>}
          {!miniMode && loopBeats > 0 && <span style={{ fontSize: 7, color: 'rgba(167,139,250,0.8)', fontFamily: 'monospace' }}>{loopBeats}b⟳</span>}
        </div>
        </Tooltip>

        {/* M · S · ··· row */}
        {!miniMode && (
          <div style={{ display: 'flex', gap: 2, padding: '0 3px 3px', justifyContent: 'center' }}>
            <Tooltip content={muted ? 'Unmute lane' : 'Mute lane (silences this track)'} placement="right">
              <button
                data-hint="Mute (M)||Silences this track in the mix. The track still plays internally but its output is blocked. Useful for A/B comparing tracks or temporarily disabling a part."
                onClick={e => { e.stopPropagation(); onToggleMute() }}
                style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
                  background: muted ? 'rgba(239,68,68,0.18)' : 'var(--bg-card)',
                  border: `1px solid ${muted ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                  color: muted ? '#ef4444' : 'var(--text-muted)' }}
              >M</button>
            </Tooltip>
            <Tooltip content={soloed ? 'Unsolo lane' : 'Solo lane (mutes all other tracks)'} placement="right">
              <button
                data-hint="Solo (S)||Mutes every other track so you only hear this one. Great for checking a specific part without distractions. Click again or solo another track to remove solo."
                onClick={e => { e.stopPropagation(); onSoloToggle() }}
                style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
                  background: soloed ? 'rgba(251,191,36,0.18)' : 'var(--bg-card)',
                  border: `1px solid ${soloed ? 'rgba(251,191,36,0.5)' : 'var(--border)'}`,
                  color: soloed ? 'rgb(251,191,36)' : 'var(--text-muted)' }}
              >S</button>
            </Tooltip>
            {/* ··· menu */}
            <div style={{ position: 'relative' }}>
              <Tooltip content="FX, automation, piano roll, step sequencer, spectrum…" placement="right" disabled={dotMenuOpen}>
                <button
                  onClick={e => { e.stopPropagation(); setDotMenuOpen(v => !v) }}
                  style={{ fontSize: 11, fontWeight: 700, padding: '1px 4px', borderRadius: 3, cursor: 'pointer', lineHeight: 1,
                    background: dotMenuOpen || effects.length > 0 || automLanes.length > 0 ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)',
                    border: `1px solid ${dotMenuOpen || effects.length > 0 || automLanes.length > 0 ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`,
                    color: dotMenuOpen || effects.length > 0 || automLanes.length > 0 ? 'rgba(167,139,250,1)' : 'var(--text-muted)' }}
                >···</button>
              </Tooltip>
              {dotMenuOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={() => setDotMenuOpen(false)} />
                  <div style={{ position: 'absolute', left: '100%', top: 0, marginLeft: 4, zIndex: 400, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 0', minWidth: 160, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
                    {[
                      { label: `FX Chain${effects.length > 0 ? ` (${effects.length})` : ''}`, action: () => { onFxToggleOpen(); setDotMenuOpen(false) }, active: fxOpen || effects.length > 0, color: 'rgba(139,92,246,1)' },
                      { label: `Automation${automLanes.length > 0 ? ` (${automLanes.length})` : ''}`, action: () => { onAutomToggle(); setDotMenuOpen(false) }, active: automOpen || automLanes.length > 0, color: 'rgba(56,189,248,1)' },
                      ...(onOpenStepSeq ? [{ label: 'Step Sequencer', action: () => { onOpenStepSeq!(); setDotMenuOpen(false) }, active: false, color: 'rgba(167,139,250,1)' }] : []),
                      ...(onOpenPianoRoll ? [{ label: 'Piano Roll', action: () => { onOpenPianoRoll!(); setDotMenuOpen(false) }, active: false, color: 'rgba(167,139,250,1)' }] : []),
                      ...(onOpenChordBuilder ? [{ label: 'Chord Builder', action: () => { onOpenChordBuilder!(); setDotMenuOpen(false) }, active: false, color: 'rgba(167,139,250,1)' }] : []),
                      ...(onToggleSpectrum ? [{ label: `Spectrum${spectrumOpen ? ' ✓' : ''}`, action: () => { onToggleSpectrum!(); setDotMenuOpen(false) }, active: spectrumOpen, color: 'rgba(34,211,238,1)' }] : []),
                    ].map(item => (
                      <button key={item.label} onClick={item.action}
                        style={{ display: 'block', width: '100%', padding: '6px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 11, color: item.active ? item.color : 'var(--text-secondary)', fontWeight: item.active ? 600 : 400 }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                      >{item.label}</button>
                    ))}
                    {/* Polyrhythm loop length */}
                    {onLoopBeatsChange && (
                      <div style={{ display: 'flex', alignItems: 'center', padding: '5px 10px', gap: 6, borderTop: '1px solid var(--border)', marginTop: 2 }}>
                        <span style={{ fontSize: 10, color: 'var(--text-muted)', flex: 1 }}>Loop</span>
                        <button onClick={() => onLoopBeatsChange(Math.max(0, loopBeats - (loopBeats <= 4 ? 1 : 4)))} style={{ width: 18, height: 18, padding: 0, borderRadius: 3, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>−</button>
                        <span style={{ fontSize: 10, color: 'var(--text-primary)', minWidth: 28, textAlign: 'center', fontFamily: 'monospace' }}>{loopBeats === 0 ? 'off' : `${loopBeats}b`}</span>
                        <button onClick={() => onLoopBeatsChange(loopBeats === 0 ? 1 : loopBeats < 4 ? loopBeats + 1 : loopBeats + 4)} style={{ width: 18, height: 18, padding: 0, borderRadius: 3, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, lineHeight: 1 }}>+</button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {/* Input arm row */}
        {!miniMode && onToggleInput && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '0 6px 4px' }}>
            <Tooltip content={inputArmed ? 'Disarm input' : 'Arm track for input (mic or MIDI)'} placement="right">
              <button
                onClick={e => { e.stopPropagation(); onToggleInput() }}
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 5, cursor: 'pointer',
                  background: inputArmed ? 'rgba(220,38,38,0.18)' : 'var(--bg-card)',
                  border: `1px solid ${inputArmed ? 'rgba(220,38,38,0.5)' : 'var(--border)'}`,
                  color: inputArmed ? '#ef4444' : 'var(--text-muted)' }}
              >
                <span style={{ fontSize: 10, lineHeight: 1 }}>⏺</span> Input
              </button>
            </Tooltip>
            {/* Source icon — click to change */}
            {inputArmed && onOpenInputPicker && (
              <Tooltip content={`${inputSource === 'midi' ? 'MIDI' : 'Mic'} — click to change source`} placement="right">
                <button
                  onClick={e => { e.stopPropagation(); onOpenInputPicker() }}
                  style={{ fontSize: 13, padding: '2px 5px', borderRadius: 4, cursor: 'pointer', border: '1px solid rgba(220,38,38,0.35)', background: 'rgba(220,38,38,0.08)', color: '#ef4444', lineHeight: 1 }}
                >
                  {inputSource === 'midi' ? '♪' : '🎙'}
                </button>
              </Tooltip>
            )}
          </div>
        )}

        {/* Mini-mode: just M button */}
        {miniMode && (
          <button
            onClick={e => { e.stopPropagation(); onToggleMute() }}
            style={{ position: 'absolute', right: 3, top: '50%', transform: 'translateY(-50%)', fontSize: 8, fontWeight: 700, padding: '1px 3px', borderRadius: 2, cursor: 'pointer',
              background: muted ? 'rgba(239,68,68,0.18)' : 'transparent',
              border: `1px solid ${muted ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
              color: muted ? '#ef4444' : 'var(--text-muted)' }}
          >M</button>
        )}

        {/* Level meter — always visible */}
        <div style={{ padding: miniMode ? '0 5px' : '0 5px 2px' }}>
          <div style={{ position: 'relative', height: 4, background: 'var(--bg-base)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              position: 'absolute', left: 0, top: 0, bottom: 0,
              width: `${Math.min(100, level * 400)}%`,
              background: level > 0.7 ? '#ef4444' : level > 0.4 ? '#f59e0b' : color,
              borderRadius: 2,
              transition: 'width 60ms linear',
            }} />
          </div>
        </div>

        {/* Pan drag bar — hidden in mini mode */}
        {!miniMode && <div style={{ padding: '0 5px 5px' }}>
          <div
            title={`Pan: ${pan >= 0 ? '+' : ''}${Math.round(pan * 100)}`}
            onMouseDown={startPanDrag}
            onDoubleClick={() => onPanChange(0)}
            style={{ position: 'relative', height: 8, background: 'var(--bg-base)', borderRadius: 4, cursor: 'ew-resize', border: '1px solid var(--border)' }}
          >
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: 'var(--border)', transform: 'translateX(-50%)' }} />
            <div style={{
              position: 'absolute', top: '50%',
              left: `${Math.round(((pan + 1) / 2) * 100)}%`,
              transform: 'translate(-50%,-50%)',
              width: 7, height: 7, borderRadius: '50%',
              background: pan === 0 ? 'var(--text-muted)' : color,
              boxShadow: pan !== 0 ? `0 0 3px ${color}` : 'none',
            }} />
          </div>
        </div>}
      </div>

      {/* Hit area — left-click adds, right-click adds (snapped), drop to place library clip */}
      <div
        data-hit-area="1"
        data-lane-type={type}
        onClick={miniMode ? undefined : handleLaneClick}
        onContextMenu={miniMode ? undefined : handleLaneRightClick}
        onDragOver={e => {
          if (!e.dataTransfer.types.includes('application/x-library-entry-id')) return
          e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setLibDragOver(true)
        }}
        onDragLeave={() => setLibDragOver(false)}
        onDrop={e => {
          const entryId = e.dataTransfer.getData('application/x-library-entry-id')
          setLibDragOver(false)
          if (!entryId || !onLibraryDrop) return
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          const t    = Math.max(0, ((e.clientX - rect.left) / rect.width) * duration)
          onLibraryDrop(entryId, t)
        }}
        style={{
          flex: 1, position: 'relative', cursor: miniMode ? 'default' : muted ? 'default' : 'crosshair', height: miniMode ? 28 : LANE_HEIGHT,
          background: libDragOver ? 'rgba(139,92,246,0.08)' : 'var(--bg-card)',
          backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent calc(12.5% - 1px), var(--border) calc(12.5% - 1px), var(--border) 12.5%)',
          outline: libDragOver ? '2px solid rgba(139,92,246,0.5)' : 'none',
          outlineOffset: -2,
          transition: 'background 0.08s',
        }}
      >
        <NoteGrid />
        {hits.map(hit => (
          <HitBlock
            key={hit.id}
            hit={hit}
            duration={duration}
            pxWidth={pxWidth}
            selected={selectedIds.has(hit.id)}
            muted={muted}
            aiSuggestion={aiSuggestions?.get(hit.id)}
            aiDeleteSuggestion={aiDeletions?.has(hit.id)}
            typeOverrides={typeOverrides}
            snapInterval={snapInterval}
            onSelect={additive => onSelectHit(hit.id, additive)}
            onMove={onMoveHit}
            onDelete={() => onDeleteHit(hit.id)}
            onRightClick={onHitRightClick}
          />
        ))}
        {/* Audio clips */}
        {clips.map(clip => {
          const effDur = clipEffectiveDuration(clip)
          const left   = duration > 0 ? (clip.startTime / duration) * pxWidth : 0
          const wid    = duration > 0 ? Math.min((effDur / duration) * pxWidth, pxWidth - left) : 0
          if (wid <= 0) return null
          const isConverting = clip.name === 'Converting…'
          const clipBaseColor = clip.color ?? '#8b5cf6'
          const waveColor = clip.muted ? 'rgba(130,130,160,0.45)' : `${clipBaseColor}a0`

          return (
            <div
              key={clip.id}
              onClick={e => e.stopPropagation()}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onClipRightClick(e, clip.id) }}
              onMouseMove={e => {
                if (isConverting) return
                const r = e.currentTarget.getBoundingClientRect()
                const zone = getClipZone(e.clientX - r.left, e.clientY - r.top, r.width, r.height, clip.warpMarkers)
                e.currentTarget.style.cursor = ZONE_CURSOR[zone] ?? 'grab'
              }}
              onMouseLeave={e => { e.currentTarget.style.cursor = isConverting ? 'wait' : 'grab' }}
              onMouseDown={e => {
                if (e.button !== 0 || isConverting) return
                e.stopPropagation(); e.preventDefault()
                const r = e.currentTarget.getBoundingClientRect()
                const rx = e.clientX - r.left
                const ry = e.clientY - r.top
                const zone = getClipZone(rx, ry, r.width, r.height, clip.warpMarkers)
                const sx = e.clientX, sy = e.clientY
                const pxPerSec = duration > 0 ? pxWidth / duration : 1
                let moved = false

                // Alt+click in move zone: gain envelope editing
                if (e.altKey && zone === 'move') {
                  const clickT = Math.max(0, Math.min(1, rx / r.width))
                  const clickV = Math.max(0, Math.min(1, 1 - ry / r.height))
                  const envelope: { t: number; v: number }[] =
                    clip.gainEnvelope && clip.gainEnvelope.length >= 2
                      ? clip.gainEnvelope
                      : [{ t: 0, v: 1 }, { t: 1, v: 1 }]
                  const handleIdx = envelope.findIndex(pt =>
                    Math.hypot(rx - pt.t * r.width, ry - (1 - pt.v) * r.height) < 8
                  )
                  if (handleIdx >= 0) {
                    let didMove = false
                    const origEnv = envelope.slice()
                    const onEnvMove = (me: MouseEvent) => {
                      didMove = true
                      const newT = Math.max(0, Math.min(1, (me.clientX - r.left) / r.width))
                      const newV = Math.max(0, Math.min(1, 1 - (me.clientY - r.top) / r.height))
                      const prevT = handleIdx > 0 ? origEnv[handleIdx - 1].t : 0
                      const nextT = handleIdx < origEnv.length - 1 ? origEnv[handleIdx + 1].t : 1
                      const clampedT = Math.max(prevT, Math.min(nextT, newT))
                      onClipUpdate(clip.id, { gainEnvelope: origEnv.map((p, i) => i === handleIdx ? { t: clampedT, v: newV } : p) })
                    }
                    const onEnvUp = () => {
                      if (!didMove && origEnv.length > 2)
                        onClipUpdate(clip.id, { gainEnvelope: origEnv.filter((_, i) => i !== handleIdx) })
                      window.removeEventListener('mousemove', onEnvMove)
                      window.removeEventListener('mouseup', onEnvUp)
                    }
                    window.addEventListener('mousemove', onEnvMove)
                    window.addEventListener('mouseup', onEnvUp)
                  } else {
                    const newEnv = [...envelope, { t: clickT, v: clickV }].sort((a, b) => a.t - b.t)
                    onClipUpdate(clip.id, { gainEnvelope: newEnv })
                  }
                  return
                }

                const drag = (mv: (me: MouseEvent) => void) => {
                  const track = (me: MouseEvent) => {
                    if (Math.abs(me.clientX - sx) > 3 || Math.abs(me.clientY - sy) > 3) moved = true
                    mv(me)
                  }
                  const up = (me: MouseEvent) => {
                    if (!moved && zone === 'move') onClipSelect(clip.id, me.ctrlKey || me.metaKey)
                    window.removeEventListener('mousemove', track); window.removeEventListener('mouseup', up)
                  }
                  window.addEventListener('mousemove', track); window.addEventListener('mouseup', up)
                }

                if (zone === 'move') {
                  const orig = clip.startTime
                  drag(me => onClipUpdate(clip.id, { startTime: Math.max(0, orig + (me.clientX - sx) / pxPerSec) }))

                } else if (zone === 'right-stretch') {
                  const orig = clip.stretchDuration ?? clip.buf.duration
                  drag(me => onClipUpdate(clip.id, { stretchDuration: Math.max(0.05, orig + (me.clientX - sx) / pxPerSec), loopDuration: null }))

                } else if (zone === 'left-stretch') {
                  const origStart = clip.startTime
                  const origEnd   = origStart + (clip.stretchDuration ?? clip.buf.duration)
                  drag(me => {
                    const newStart = Math.max(0, Math.min(origEnd - 0.05, origStart + (me.clientX - sx) / pxPerSec))
                    onClipUpdate(clip.id, { startTime: newStart, stretchDuration: origEnd - newStart, loopDuration: null })
                  })

                } else if (zone === 'right-loop') {
                  const cycleDur = clip.stretchDuration ?? clip.buf.duration
                  const orig = clip.loopDuration ?? cycleDur
                  drag(me => onClipUpdate(clip.id, { loopDuration: Math.max(cycleDur * 0.1, orig + (me.clientX - sx) / pxPerSec) }))

                } else if (zone === 'left-loop') {
                  const cycleDur  = clip.stretchDuration ?? clip.buf.duration
                  const origLoop  = clip.loopDuration ?? cycleDur
                  const origStart = clip.startTime
                  drag(me => {
                    const dt      = (me.clientX - sx) / pxPerSec
                    const newLoop = Math.max(cycleDur * 0.1, origLoop - dt)
                    const newStart = Math.max(0, origStart + dt)
                    onClipUpdate(clip.id, { startTime: newStart, loopDuration: newLoop })
                  })

                } else if (zone === 'midline') {
                  const orig = clip.gain
                  drag(me => onClipUpdate(clip.id, { gain: Math.max(0, Math.min(8, orig - (me.clientY - sy) / 50)) }))

                } else if (zone === 'top-edge' || zone === 'bottom-edge') {
                  const orig = clip.gateThreshold
                  const sign = zone === 'top-edge' ? 1 : -1
                  drag(me => onClipUpdate(clip.id, { gateThreshold: Math.max(0, Math.min(0.98, orig + sign * (me.clientY - sy) / 80)) }))

                } else if (zone === 'fade-in') {
                  const origFade = clip.fadeIn
                  const cEffDur = clipEffectiveDuration(clip)
                  drag(me => {
                    const newFadeIn = Math.max(0, Math.min(cEffDur * 0.9, origFade + (me.clientX - sx) / pxPerSec))
                    onClipUpdate(clip.id, { fadeIn: newFadeIn })
                  })

                } else if (zone === 'fade-out') {
                  const origFade = clip.fadeOut
                  const cEffDur = clipEffectiveDuration(clip)
                  drag(me => {
                    const newFadeOut = Math.max(0, Math.min(cEffDur * 0.9, origFade - (me.clientX - sx) / pxPerSec))
                    onClipUpdate(clip.id, { fadeOut: newFadeOut })
                  })

                } else if (zone === 'warp-marker') {
                  const hitIdx = clip.warpMarkers.findIndex(m => Math.abs(m.timeFrac * r.width - rx) < 5)
                  if (hitIdx >= 0) {
                    const origTimeFrac = clip.warpMarkers[hitIdx].timeFrac
                    drag(me => {
                      const newTimeFrac = Math.max(0.01, Math.min(0.99, origTimeFrac + (me.clientX - sx) / r.width))
                      const updated = [...clip.warpMarkers]
                      updated[hitIdx] = { ...updated[hitIdx], timeFrac: newTimeFrac }
                      onClipUpdate(clip.id, { warpMarkers: updated.sort((a, b) => a.timeFrac - b.timeFrac) })
                    })
                  }
                }
              }}
              style={{
                position: 'absolute', left, width: Math.max(wid, 8),
                top: 3, bottom: 3, borderRadius: 3, zIndex: 1,
                background: isConverting ? 'rgba(139,92,246,0.08)' : clip.muted ? 'rgba(80,80,100,0.1)' : `${clipBaseColor}26`,
                border: `1px solid ${isConverting ? 'rgba(139,92,246,0.3)' : selectedClipIds.has(clip.id) ? 'rgba(250,250,100,0.85)' : clip.muted ? 'rgba(100,100,120,0.25)' : `${clipBaseColor}80`}`,
                boxShadow: selectedClipIds.has(clip.id) ? '0 0 0 1px rgba(250,250,100,0.4)' : 'none',
                overflow: 'hidden', cursor: isConverting ? 'wait' : 'grab',
              }}
            >
              {!isConverting && (
                <WaveformCanvas buf={clip.buf} color={waveColor}
                  gain={clip.gain} gateThreshold={clip.gateThreshold}
                  loopDuration={clip.loopDuration} stretchDuration={clip.stretchDuration}
                  fadeIn={clip.fadeIn} fadeOut={clip.fadeOut}
                  reversed={clip.reversed} warpMarkers={clip.warpMarkers}
                  gainEnvelope={clip.gainEnvelope} />
              )}
              <span style={{
                position: 'absolute', top: 2, left: 5, fontSize: 8, fontWeight: 500, pointerEvents: 'none',
                color: isConverting ? 'rgba(139,92,246,0.6)' : clip.muted ? 'var(--text-muted)' : 'rgba(230,210,255,0.95)',
                textShadow: '0 1px 2px rgba(0,0,0,0.6)', whiteSpace: 'nowrap',
              }}>
                {clip.reversed ? '⟵ ' : ''}{clip.name} · {effDur.toFixed(1)}s{clip.loopDuration != null ? ' ↻' : clip.stretchDuration != null ? ' ⇔' : ''}
              </span>
            </div>
          )
        })}
      </div>
    </div>

    {/* Automation sub-lanes */}
    {(automOpen || automLanes.length > 0) && (
      <div style={{ display: 'flex', flexDirection: 'column', background: 'rgba(14,20,32,0.6)' }}>
        {automLanes.map(al => (
          <AutomLaneView key={al.id} def={al} duration={duration} pxWidth={pxWidth}
            onPointAdd={pt => onAutomPointAdd(al.id, pt)}
            onPointUpdate={(ptId, upd) => onAutomPointUpdate(al.id, ptId, upd)}
            onPointDelete={ptId => onAutomPointDelete(al.id, ptId)}
            onRemove={() => onAutomRemove(al.id)} />
        ))}
        {/* Add automation lane button */}
        {automOpen && (
          <div style={{ display: 'flex', alignItems: 'center', borderTop: automLanes.length > 0 ? '1px solid rgba(56,189,248,0.1)' : 'none' }}>
            <div style={{ width: 140, flexShrink: 0, borderRight: '1px solid var(--border)', height: '100%', background: 'var(--bg-base)' }} />
            <div style={{ position: 'relative', padding: '4px 8px' }}>
              <button
                onClick={e => { e.stopPropagation(); onAutomAddOpen() }}
                style={{ fontSize: 10, padding: '3px 10px', borderRadius: 5, border: '1px dashed rgba(56,189,248,0.35)', background: 'transparent', color: 'rgba(56,189,248,0.7)', cursor: 'pointer' }}
              >+ Automation</button>
              {automAddOpen && (
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={onAutomAddClose} />
                  <div style={{ position: 'absolute', top: '100%', left: 8, zIndex: 400, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, boxShadow: '0 6px 20px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 100 }}>
                    {(['volume', 'pan'] as AutomParam[]).map(p => (
                      <button key={p} onClick={() => onAutomAdd(p)}
                        style={{ textAlign: 'left', padding: '5px 10px', borderRadius: 5, border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)' }}>
                        {p === 'volume' ? 'Volume' : 'Pan'}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    )}

    {/* FX chain strip */}
    {fxOpen && (
      <div style={{ display: 'flex', alignItems: 'stretch', background: 'var(--bg-surface)', borderTop: '1px solid rgba(139,92,246,0.15)', minHeight: 80 }}>
        {/* Left stub aligns with lane header */}
        <div style={{ width: 140, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 9, color: 'rgba(139,92,246,0.7)', fontWeight: 700, letterSpacing: '0.08em' }}>FX</span>
        </div>
        {/* Horizontal chain of effect slots */}
        <div style={{ flex: 1, display: 'flex', alignItems: 'stretch', gap: 0, overflowX: 'auto', padding: '6px 6px' }}>
          {effects.map(fx => (
            <FxSlot key={fx.id} fx={fx}
              onToggleEnabled={() => onFxToggleEnabled(fx.id)}
              onRemove={() => onFxRemove(fx.id)}
              onParamChange={(key, val) => onFxParamChange(fx.id, key, val)}
              sidechainLane={sidechains?.[fx.id] ?? ''}
              allLaneTypes={allLaneTypes?.filter(lt => lt !== (type as string))}
              onSidechainChange={val => onSidechainChange?.(fx.id, val)} />
          ))}
          {/* Rnd button */}
          {effects.length > 0 && (
            <button
              onClick={e => { e.stopPropagation(); onFxRandomize() }}
              title="Randomize enabled FX parameters"
              style={{ fontSize: 10, fontWeight: 700, padding: '3px 7px', borderRadius: 4, border: '1px solid rgba(139,92,246,0.35)', background: 'transparent', color: 'rgba(139,92,246,0.7)', cursor: 'pointer', whiteSpace: 'nowrap', margin: '0 4px', alignSelf: 'center' }}
            >Rnd</button>
          )}
          {/* Add FX button */}
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <button
              data-hint="Add Effect||Insert a plugin into this lane's signal chain. Effects process left-to-right in the order they appear. Options: EQ3, Compressor, Bit Crusher, Reverb, Delay, Chorus, Phaser, Flanger, Auto Filter, Saturator, LFO, Beat Repeat."
              onClick={e => { e.stopPropagation(); onFxAddOpen() }}
              style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px dashed rgba(139,92,246,0.35)', background: 'transparent', color: 'rgba(139,92,246,0.7)', cursor: 'pointer', whiteSpace: 'nowrap', margin: '0 4px' }}
            >+ Add FX</button>
            {fxAddOpen && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 399 }} onClick={onFxAddClose} />
                <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 400, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 6, boxShadow: '0 6px 20px rgba(0,0,0,0.4)', display: 'flex', flexDirection: 'column', gap: 2, minWidth: 110 }}>
                  {(['eq3', 'comp', 'crush', 'reverb', 'delay', 'chorus', 'phaser', 'flanger', 'autofilter', 'saturator', 'lfo', 'beatrepeat'] as LaneEffectType[]).map(t => (
                    <button key={t} onClick={() => onFxAdd(t)}
                      style={{ textAlign: 'left', padding: '5px 10px', borderRadius: 5, border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)' }}>
                      {LANE_EFFECT_LABELS[t]}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    )}

    {/* Spectrum Analyzer sub-view */}
    {spectrumOpen && !miniMode && (
      <div style={{ display: 'flex', alignItems: 'stretch', background: 'var(--bg-base)', borderTop: '1px solid rgba(34,211,238,0.15)' }}>
        <div style={{ width: 140, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--bg-base)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 8, color: 'rgba(34,211,238,0.7)', fontWeight: 700, letterSpacing: '0.08em' }}>FFT</span>
        </div>
        <div style={{ flex: 1, padding: '4px 8px', overflow: 'hidden' }}>
          <Suspense fallback={null}>
            <SpectrumAnalyzer analyser={analyserNode ?? null} active={true} height={44} />
          </Suspense>
        </div>
      </div>
    )}
    </div>
  )
}

// ── Playhead ─────────────────────────────────────────────────────────────────

function Playhead({ time, duration, pxWidth }: { time: number; duration: number; pxWidth: number }) {
  if (time < 0) return null
  return (
    <div style={{
      position: 'absolute', left: (time / duration) * pxWidth + HEADER_W, top: 0, bottom: 0,
      width: 1, background: 'var(--accent)', pointerEvents: 'none', zIndex: 20,
    }} />
  )
}

// ── BeatLab ───────────────────────────────────────────────────────────────────

interface BeatLabProps {
  projectId?: string
  onExport?: (hits: BeatHit[], bpm: number | null) => void
  hasSong?: boolean
  onRequestSongPlay?: () => void
  onRequestSongStop?: () => void
  requestedFamily?: string | null
  onHitsChange?: (hits: BeatHit[], duration: number, bpm: number | null) => void
  onAddTrack?: (entry: BeatTrackEntry) => void
  requestRecord?: number  // increment to trigger recording (plays song automatically)
  onPhaseChange?: (phase: Phase) => void
  lanesContainer?: Element | null  // when set, lane editor renders into this element via portal
  analyzeStemUrl?: string | null   // when set, fetch + analyze this audio URL directly (bypasses mic)
  stemLabel?: string               // display name for the stem being analyzed e.g. "drums stem"
  onStemAnalyzed?: () => void      // called after stem analysis completes (or fails)
}

function WaveViz({ buf, color = '#a855f7', width = 480, height = 52 }: { buf: AudioBuffer | null; color?: string; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !buf) return
    const ctx2d = canvas.getContext('2d')
    if (!ctx2d) return
    const W = canvas.width, H = canvas.height
    ctx2d.clearRect(0, 0, W, H)
    const data = buf.getChannelData(0)
    const bars = Math.floor(W / 3)
    const sPerBar = Math.floor(data.length / bars)
    ctx2d.fillStyle = color
    for (let i = 0; i < bars; i++) {
      let peak = 0
      for (let j = 0; j < sPerBar; j++) peak = Math.max(peak, Math.abs(data[i * sPerBar + j] ?? 0))
      const bh = Math.max(2, peak * H * 0.9)
      ctx2d.fillRect(i * 3, (H - bh) / 2, 2, bh)
    }
  }, [buf, color])
  return <canvas ref={ref} width={width} height={height} style={{ width: '100%', height, display: 'block', opacity: buf ? 1 : 0 }} />
}

// Stacked alignment canvas — reference on top, beatbox on bottom, both drawn at their
// respective time positions so the user can see and correct the offset between them.
function AlignCanvas({ refBuf, boxBuf, offset }: { refBuf: AudioBuffer; boxBuf: AudioBuffer; offset: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    const rowH = H / 2
    ctx.clearRect(0, 0, W, H)

    // Total timeline duration to fit both tracks
    const refStart  = offset < 0 ? -offset : 0
    const boxStart  = offset > 0 ?  offset : 0
    const totalDur  = Math.max(refStart + refBuf.duration, boxStart + boxBuf.duration) * 1.02
    const pixPerSec = W / totalDur

    function drawTrack(buf: AudioBuffer, startSec: number, yOff: number, color: string) {
      const data    = buf.getChannelData(0)
      const startPx = startSec * pixPerSec
      const trackW  = buf.duration * pixPerSec
      const bars    = Math.max(1, Math.floor(trackW / 2))
      const sPerBar = Math.floor(buf.length / bars)
      ctx!.fillStyle = color
      for (let i = 0; i < bars; i++) {
        let peak = 0
        const base = i * sPerBar
        for (let j = 0; j < sPerBar; j++) peak = Math.max(peak, Math.abs(data[base + j] ?? 0))
        const bh = Math.max(2, peak * rowH * 0.85)
        ctx!.fillRect(startPx + i * (trackW / bars), yOff + (rowH - bh) / 2, Math.max(1, trackW / bars - 1), bh)
      }
    }

    // Reference track (top half) — yellow
    ctx.fillStyle = 'rgba(250,204,21,0.06)'
    ctx.fillRect(0, 0, W, rowH)
    drawTrack(refBuf, refStart, 0, 'rgba(250,204,21,0.75)')

    // Beatbox track (bottom half) — blue
    ctx.fillStyle = 'rgba(96,165,250,0.06)'
    ctx.fillRect(0, rowH, W, rowH)
    drawTrack(boxBuf, boxStart, rowH, 'rgba(96,165,250,0.75)')

    // Divider
    ctx.strokeStyle = 'rgba(255,255,255,0.12)'
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(0, rowH); ctx.lineTo(W, rowH); ctx.stroke()

    // Playhead at time 0 of each track (so user can see where each starts)
    const drawMark = (xSec: number, color: string) => {
      const x = xSec * pixPerSec
      ctx!.strokeStyle = color; ctx!.lineWidth = 1.5
      ctx!.setLineDash([3, 3])
      ctx!.beginPath(); ctx!.moveTo(x, 0); ctx!.lineTo(x, H); ctx!.stroke()
      ctx!.setLineDash([])
    }
    drawMark(refStart, 'rgba(250,204,21,0.5)')
    drawMark(boxStart, 'rgba(96,165,250,0.5)')
  }, [refBuf, boxBuf, offset])

  return <canvas ref={canvasRef} width={640} height={80}
    style={{ width: '100%', height: 80, display: 'block', borderRadius: 6, border: '1px solid rgba(255,255,255,0.07)' }} />
}

export default function BeatLab({ projectId, onExport, hasSong, onRequestSongPlay, onRequestSongStop, requestedFamily, onHitsChange, onAddTrack, requestRecord, onPhaseChange, lanesContainer, analyzeStemUrl, stemLabel, onStemAnalyzed }: BeatLabProps) {
  const [phase, setPhase] = useState<Phase>('editing')
  const [analysis, setAnalysis] = useState<BeatAnalysis | null>(null)
  const [hits, setHits] = useState<BeatHit[]>([])
  const hitsRef = useRef<BeatHit[]>([])
  useEffect(() => { hitsRef.current = hits }, [hits])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeLaneType, setActiveLaneType] = useState<BeatType | null>(null)
  const activeLaneTypeRef = useRef<BeatType | null>(null)
  useEffect(() => { activeLaneTypeRef.current = activeLaneType }, [activeLaneType])
  const [zoomLevel, setZoomLevel] = useState(1)
  const [laneMenu, setLaneMenu] = useState<{ type: BeatType; x: number; y: number } | null>(null)
  const [laneMenuEdit, setLaneMenuEdit] = useState<{ label: string; color: string } | null>(null)
  const [laneMenuChanging, setLaneMenuChanging] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playhead, setPlayhead] = useState(0)
  const [recordingTime, setRecordingTime] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  function showToast(msg: string) {
    setToast(msg)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 4500)
  }

  interface SynthTunerIteration { title: string; analysis: string; changes: string }
  interface SynthTunerState {
    clipId:           string
    status:           'running' | 'waiting' | 'done' | 'error'
    iteration:        number
    iterations:       SynthTunerIteration[]
    preAiBuf:         AudioBuffer | null  // snapshot before AI touched the clip
    errorMsg?:        string
    features?:        ProfileFeatures     // recording characteristics, used to save/match profiles
    learnedProfileId?: string            // set when result came from a stored profile (no AI used)
  }
  const [synthTuner, setSynthTuner] = useState<SynthTunerState | null>(null)
  const synthResumeRef        = useRef<((feedback: string) => void) | null>(null)
  const synthCancelledRef     = useRef(false)
  const synthPassAcceptedRef  = useRef(true)   // true = keep pass result, false = revert on resume
  const synthFeedbackInputRef = useRef<HTMLTextAreaElement | null>(null)
  const synthCurrentCodeRef   = useRef('')      // latest accepted code, read when saving a profile
  const synthTunerArgsRef     = useRef<{ clipId: string; pitchCurve: import('@/lib/pitch-detector').PitchFrame[]; source: AudioBuffer; opts: SynthOptions; referenceBuf?: AudioBuffer | null } | null>(null)
  const [bpm, setBpm] = useState<number | null>(null)
  const [duration, setDuration] = useState(8)
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const [mutedTypes, setMutedTypes] = useState<Set<BeatType>>(new Set())
  const [audioBuf, setAudioBuf] = useState<AudioBuffer | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<Set<BeatType>>(new Set(DEFAULT_ENABLED))

  // External trigger: increment requestRecord to start a recording with song auto-playing
  const prevRequestRecordRef = useRef(0)
  useEffect(() => {
    const cur = requestRecord ?? 0
    if (cur <= prevRequestRecordRef.current) return
    prevRequestRecordRef.current = cur
    if (phase !== 'idle') return
    onRequestSongPlay?.()
    startedSongRef.current = true
    void startRecording()
  }, [requestRecord, phase]) // eslint-disable-line
  const [recMode, setRecMode] = useState<RecMode>('hits')
  // Loop mode state
  const [loopBuffer, setLoopBuffer] = useState<AudioBuffer | null>(null)
  const [loopDetectedBpm, setLoopDetectedBpm] = useState<number | null>(null)
  const [loopTargetBpm, setLoopTargetBpm] = useState<number>(120)
  const [loopPlaying, setLoopPlaying] = useState(false)

  const [playSongDuringRec, setPlaySongDuringRec] = useState(false)

  // AI classifier state
  const [aiSuggestions, setAiSuggestions] = useState<Map<string, BeatType> | null>(null)
  const [aiDeletions, setAiDeletions]     = useState<Set<string>>(new Set())
  const [aiLoading, setAiLoading]         = useState(false)
  const [groundTruth, setGroundTruth] = useState('')
  const [showGroundTruth, setShowGroundTruth] = useState(false)

  // Feedback loop state — set after Apply All, cleared on confirm/dismiss
  interface FeedbackItem {
    hitId:    string
    time:     number
    original: BeatType   // machine label before AI ran
    current:  BeatType   // label after AI (user can change this)
    spectral?: HitSpectral
  }
  const [feedbackItems, setFeedbackItems]         = useState<FeedbackItem[] | null>(null)
  const [feedbackRetries, setFeedbackRetries]     = useState(0)
  const [feedbackLoading, setFeedbackLoading]     = useState(false)
  const [reflection, setReflection]               = useState<string | null>(null)
  const MAX_RETRIES = 3

  // AI feedback card
  const [showFeedbackCard, setShowFeedbackCard] = useState(false)

  // User-initiated feedback mode
  const [userFeedbackMode, setUserFeedbackMode]     = useState(false)
  const [userFeedbackNotes, setUserFeedbackNotes]   = useState('')
  const [feedbackSnapshot, setFeedbackSnapshot]     = useState<Map<string, BeatType> | null>(null)
  const [feedbackSending, setFeedbackSending]       = useState(false)

  // Custom track types — label/color overrides for built-ins + new user-created lanes
  const [typeOverrides, setTypeOverrides] = useState<TypeOverrides>({})

  // ── Ableton project bridge ────────────────────────────────────────────────
  const [abletonProject,     setAbletonProject]     = useState<AbletonProject | null>(null)
  const [abletonImportOpen,  setAbletonImportOpen]  = useState(false)
  const [abletonSelected,    setAbletonSelected]    = useState<Set<string>>(new Set())
  const [abletonLoading,     setAbletonLoading]     = useState(false)
  const [abletonProgress,    setAbletonProgress]    = useState('')

  // ── Match Studio ──────────────────────────────────────────────────────────
  const [matchStudioOpen,  setMatchStudioOpen]  = useState(false)
  const [matchTarget,      setMatchTarget]      = useState<AudioBuffer | null>(null)
  const [matchTargetName,  setMatchTargetName]  = useState('')
  const [matchVocal,       setMatchVocal]       = useState<AudioBuffer | null>(null)
  const [matchVocalName,   setMatchVocalName]   = useState('')
  const [matchResult,      setMatchResult]      = useState<AudioBuffer | null>(null)
  const [matchLoading,     setMatchLoading]     = useState(false)
  const [matchProgress,    setMatchProgress]    = useState('')
  const [matchStrength,    setMatchStrength]    = useState(80)   // 0-100
  const [matchGapFill,     setMatchGapFill]     = useState(40)   // 0-100
  const [matchTargetUrl,   setMatchTargetUrl]   = useState('')
  const [matchPlayingSlot, setMatchPlayingSlot] = useState<'target' | 'vocal' | 'result' | null>(null)
  const [matchRecording,   setMatchRecording]   = useState(false)
  const matchRecordRef = useRef<MediaRecorder | null>(null)
  const matchPlayRef   = useRef<{ src: AudioBufferSourceNode; ctx: AudioContext } | null>(null)

  function matchStopPlay() {
    if (matchPlayRef.current) {
      try { matchPlayRef.current.src.stop() } catch { /* already stopped */ }
      matchPlayRef.current.ctx.close()
      matchPlayRef.current = null
    }
    setMatchPlayingSlot(null)
  }

  async function matchPlaySlot(slot: 'target' | 'vocal' | 'result') {
    matchStopPlay()
    const buf = slot === 'target' ? matchTarget : slot === 'vocal' ? matchVocal : matchResult
    if (!buf) return
    const ctx = new AudioContext()
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.onended = () => { ctx.close(); setMatchPlayingSlot(null) }
    src.start(0)
    matchPlayRef.current = { src, ctx }
    setMatchPlayingSlot(slot)
  }

  async function matchLoadFile(file: File, slot: 'target' | 'vocal') {
    try {
      const decoded = await decodeAudio(file)
      if (slot === 'target') { setMatchTarget(decoded); setMatchTargetName(file.name) }
      else                   { setMatchVocal(decoded);  setMatchVocalName(file.name) }
    } catch { showToast('Could not decode audio file') }
  }

  async function matchFetchUrl() {
    const url = matchTargetUrl.trim()
    if (!url) return
    setMatchProgress('Fetching track…')
    try {
      const res = await fetch(`/api/fetch-audio?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const decoded = await decodeAudio(new Blob([await res.arrayBuffer()]))
      const name = url.split('/').pop()?.split('?')[0] ?? 'Track'
      setMatchTarget(decoded)
      setMatchTargetName(name)
      setMatchTargetUrl('')
    } catch (e) {
      showToast(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    setMatchProgress('')
  }

  async function startMatchRecord() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
      const chunks: BlobPart[] = []
      const mr = new MediaRecorder(stream)
      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        try {
          const blob = new Blob(chunks, { type: mr.mimeType })
          const ctx = new AudioContext()
          const decoded = await ctx.decodeAudioData(await blob.arrayBuffer()).finally(() => ctx.close())
          setMatchVocal(decoded)
          setMatchVocalName('Recording')
        } catch { showToast('Recording decode failed') }
        setMatchRecording(false)
      }
      matchRecordRef.current = mr
      mr.start()
      setMatchRecording(true)
    } catch { showToast('Microphone access denied') }
  }

  function stopMatchRecord() {
    matchRecordRef.current?.stop()
    matchRecordRef.current = null
  }

  async function runMatchStudio() {
    if (!matchTarget || !matchVocal) return
    setMatchLoading(true)
    setMatchProgress('Uploading to server…')
    setMatchResult(null)
    try {
      const form = new FormData()
      form.append('vocal',  new Blob([audioBufToWav(matchVocal)],  { type: 'audio/wav' }), 'vocal.wav')
      form.append('target', new Blob([audioBufToWav(matchTarget)], { type: 'audio/wav' }), 'target.wav')
      form.append('opts', JSON.stringify({ strength: matchStrength / 100, gapFill: matchGapFill / 100 }))
      setMatchProgress('Processing…')
      const res = await fetch('/api/match-vocal', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(err?.error ?? `Server error ${res.status}`)
      }
      setMatchProgress('Decoding result…')
      const result = await wavToAudioBuf(await res.arrayBuffer())
      setMatchResult(result)
    } catch (e) {
      showToast(`Match failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    setMatchProgress('')
    setMatchLoading(false)
  }

  function addMatchResultToTimeline() {
    if (!matchResult) return
    const laneId = addCustomLane()
    const clipId = crypto.randomUUID()
    setAudioClips(prev => [...prev, mkClip(clipId, laneId, matchResult, 0, `Match — ${matchTargetName || 'Track'}`)])
    showToast('Added to timeline')
    setMatchStudioOpen(false)
  }

  function exportMatchResult() {
    if (!matchResult) return
    const wav = audioBufToWav(matchResult)
    const blob = new Blob([wav], { type: 'audio/wav' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `match-${matchTargetName || 'result'}.wav`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Beat Studio ────────────────────────────────────────────────────────────
  // Guided workflow: load a beat → listen to it → record beatbox → transform.
  // Uses the same /api/match-vocal pipeline as Match Studio but with defaults
  // tuned for rhythm reproduction (low strength preserves beatbox pattern;
  // high gap-fill pulls in bass, synths, and production elements from the target).

  const [beatStudioOpen,  setBeatStudioOpen]  = useState(false)
  const [beatRef,         setBeatRef]         = useState<AudioBuffer | null>(null)
  const [beatRefName,     setBeatRefName]     = useState('')
  const [beatRefBpm,      setBeatRefBpm]      = useState<number | null>(null)
  const [beatBox,         setBeatBox]         = useState<AudioBuffer | null>(null)
  const [beatBoxName,     setBeatBoxName]     = useState('')
  // beatBoxOffset: seconds the beatbox starts AFTER the reference (negative = beatbox starts before ref)
  const [beatBoxOffset,   setBeatBoxOffset]   = useState(0)
  const [beatResult,        setBeatResult]        = useState<AudioBuffer | null>(null)
  const [beatLoading,       setBeatLoading]       = useState(false)
  const [beatProgress,      setBeatProgress]      = useState('')
  const [beatStrength,      setBeatStrength]      = useState(55)
  const [beatGapFill,       setBeatGapFill]       = useState(72)
  const [beatFeedback,      setBeatFeedback]      = useState('')
  const [beatAiAdjusting,   setBeatAiAdjusting]   = useState(false)
  const [beatAiExplanation, setBeatAiExplanation] = useState<string | null>(null)
  const [beatRefUrl,        setBeatRefUrl]        = useState('')
  const [beatRecording,   setBeatRecording]   = useState(false)
  const [beatCountdown,   setBeatCountdown]   = useState<number | null>(null)   // 3 → 2 → 1 → null (recording)
  const [beatMetronomeOn, setBeatMetronomeOn] = useState(true)
  const [beatPlayingSlot, setBeatPlayingSlot] = useState<'ref' | 'beatbox' | 'result' | null>(null)
  const [beatLooping,     setBeatLooping]     = useState(false)
  const [beatStep,        setBeatStep]        = useState<1|2|3>(1)
  const beatRecordRef    = useRef<MediaRecorder | null>(null)
  const beatMetroRef     = useRef<AudioContext | null>(null)
  const beatPlayRef   = useRef<{ src: AudioBufferSourceNode; ctx: AudioContext } | null>(null)

  // BPM estimation via onset-energy autocorrelation (runs client-side, no server needed)
  function quickBpmEstimate(buf: AudioBuffer): number | null {
    const sr       = buf.sampleRate
    const data     = buf.getChannelData(0)
    const hopSize  = Math.round(0.01 * sr)   // 10 ms per frame
    const numFrames = Math.floor(data.length / hopSize)
    if (numFrames < 200) return null          // need ≥2 s

    // RMS envelope
    const env = new Float32Array(numFrames)
    for (let i = 0; i < numFrames; i++) {
      let sum = 0
      for (let j = 0; j < hopSize; j++) sum += (data[i * hopSize + j] ?? 0) ** 2
      env[i] = Math.sqrt(sum / hopSize)
    }

    // Positive onset strength
    const onset = new Float32Array(numFrames)
    for (let i = 1; i < numFrames; i++) onset[i] = Math.max(0, env[i] - env[i - 1])

    // Autocorrelation over tempo range 60–200 BPM
    const envSr    = sr / hopSize
    const minLag   = Math.floor(envSr * 60 / 200)
    const maxLag   = Math.floor(envSr * 60 / 60)
    let bestLag = minLag, bestCorr = 0
    const scanFrames = Math.min(numFrames - maxLag, 600)
    for (let lag = minLag; lag <= maxLag; lag++) {
      let corr = 0
      for (let i = 0; i < scanFrames; i++) corr += onset[i] * onset[i + lag]
      if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
    }

    let bpm = Math.round(60 / (bestLag / envSr))
    while (bpm < 60)  bpm *= 2
    while (bpm > 220) bpm /= 2
    return bpm
  }

  // Cross-correlation on RMS envelopes to find how many seconds beatBox is offset from ref.
  // Returns positive value = beatbox starts AFTER ref, negative = beatbox starts BEFORE ref.
  function autoAlignBeatBox() {
    if (!beatRef || !beatBox) return
    const FRAME_MS  = 20                         // 20ms per RMS frame
    const MAX_LAG_S = Math.min(10, Math.min(beatRef.duration, beatBox.duration) * 0.8)

    function rmsEnv(buf: AudioBuffer): Float32Array {
      const sr       = buf.sampleRate
      const hopSize  = Math.round((FRAME_MS / 1000) * sr)
      const n        = Math.floor(buf.length / hopSize)
      const data     = buf.getChannelData(0)
      const out      = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        let sum = 0
        for (let j = 0; j < hopSize; j++) sum += (data[i * hopSize + j] ?? 0) ** 2
        out[i] = Math.sqrt(sum / hopSize)
      }
      return out
    }

    const refEnv = rmsEnv(beatRef)
    const boxEnv = rmsEnv(beatBox)
    const maxLagFrames = Math.floor(MAX_LAG_S / (FRAME_MS / 1000))

    // Normalize envelopes (zero-mean)
    const mean = (a: Float32Array) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length }
    const refMu = mean(refEnv), boxMu = mean(boxEnv)
    const refN = refEnv.map(v => v - refMu)
    const boxN = boxEnv.map(v => v - boxMu)

    let bestLag = 0, bestCorr = -Infinity
    for (let lag = -maxLagFrames; lag <= maxLagFrames; lag++) {
      let corr = 0, count = 0
      for (let i = 0; i < refN.length; i++) {
        const j = i - lag
        if (j >= 0 && j < boxN.length) { corr += refN[i] * boxN[j]; count++ }
      }
      if (count > 0) { const norm = corr / count; if (norm > bestCorr) { bestCorr = norm; bestLag = lag } }
    }

    const offsetSec = parseFloat((bestLag * FRAME_MS / 1000).toFixed(3))
    setBeatBoxOffset(offsetSec)
  }

  function beatStopPlay() {
    if (beatPlayRef.current) {
      try { beatPlayRef.current.src.stop() } catch { /* already ended */ }
      beatPlayRef.current.ctx.close()
      beatPlayRef.current = null
    }
    setBeatPlayingSlot(null)
    setBeatLooping(false)
  }

  function beatPlaySlot(slot: 'ref' | 'beatbox' | 'result', loop = false) {
    beatStopPlay()
    const buf = slot === 'ref' ? beatRef : slot === 'beatbox' ? beatBox : beatResult
    if (!buf) return
    const ctx = new AudioContext()
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.loop   = loop
    src.connect(ctx.destination)
    src.onended = () => { if (!loop) { ctx.close(); setBeatPlayingSlot(null); setBeatLooping(false) } }
    src.start(0)
    beatPlayRef.current = { src, ctx }
    setBeatPlayingSlot(slot)
    setBeatLooping(loop)
  }

  async function beatLoadRef(file: File) {
    try {
      const decoded = await decodeAudio(file)
      // Clear all previous session data before loading the new reference
      setBeatBox(null); setBeatBoxName(''); setBeatBoxOffset(0)
      setDtHits(null); setDtBpm(null)
      setBeatResult(null)
      setBeatRef(decoded)
      setBeatRefName(file.name)
      setBeatRefBpm(quickBpmEstimate(decoded))
      setBeatStep(1)
    } catch { showToast('Could not decode audio file') }
  }

  async function beatFetchUrl() {
    const url = beatRefUrl.trim()
    if (!url) return
    setBeatProgress('Fetching…')
    try {
      const res = await fetch(`/api/fetch-audio?url=${encodeURIComponent(url)}`)
      if (!res.ok) throw new Error(`Server returned ${res.status}`)
      const decoded = await decodeAudio(new Blob([await res.arrayBuffer()]))
      const name = url.split('/').pop()?.split('?')[0] ?? 'Beat'
      setBeatBox(null); setBeatBoxName(''); setBeatBoxOffset(0)
      setDtHits(null); setDtBpm(null)
      setBeatResult(null)
      setBeatRef(decoded)
      setBeatRefName(name)
      setBeatRefBpm(quickBpmEstimate(decoded))
      setBeatRefUrl('')
      setBeatStep(1)
    } catch (e) {
      showToast(`Fetch failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    setBeatProgress('')
  }

  // Synthesize a single metronome click: accent=true → louder, higher pitch
  function makeMetroClick(ctx: AudioContext, accent: boolean): AudioBuffer {
    const sr  = ctx.sampleRate
    const dur = accent ? 0.045 : 0.032
    const n   = Math.floor(sr * dur)
    const buf = ctx.createBuffer(1, n, sr)
    const d   = buf.getChannelData(0)
    const f0  = accent ? 1600 : 1000   // Hz
    const f1  = accent ?  900 :  600
    for (let i = 0; i < n; i++) {
      const t   = i / sr
      const env = Math.exp(-t / (accent ? 0.018 : 0.012))
      d[i] = (Math.sin(2 * Math.PI * f0 * t) * 0.55 +
              Math.sin(2 * Math.PI * f1 * t) * 0.25) * env
    }
    return buf
  }

  // Schedule metronome clicks into an already-running AudioContext starting at `fromWhen`
  // Returns the AudioContext so the caller can close it later
  function scheduleMetro(ctx: AudioContext, bpm: number, timeSig: [number,number], fromWhen: number, durationSec: number) {
    const beatLen = 60 / bpm
    const [num]   = timeSig
    const accent  = makeMetroClick(ctx, true)
    const normal  = makeMetroClick(ctx, false)
    let beat = 0
    for (let t = 0; t < durationSec; t += beatLen) {
      const when = fromWhen + t
      const isAccent = (beat % num) === 0
      const src = ctx.createBufferSource()
      src.buffer = isAccent ? accent : normal
      const gain = ctx.createGain(); gain.gain.value = isAccent ? 0.7 : 0.45
      src.connect(gain); gain.connect(ctx.destination)
      src.start(when)
      beat++
    }
  }

  async function startBeatRecord() {
    beatStopPlay()
    const bpm     = beatRefBpm
    const useMet  = beatMetronomeOn && bpm != null
    const timeSig = beatTimeSig

    // Raw audio — no noise suppression or echo cancellation so beatbox sounds
    // aren't filtered out before they reach the analyzer
    const audioConstraints: MediaTrackConstraints = {
      echoCancellation:  false,
      noiseSuppression:  false,
      autoGainControl:   false,
    }
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false }) }
    catch { showToast('Microphone access denied'); return }

    if (useMet && bpm) {
      const beatLen    = 60 / bpm
      const countBeats = timeSig[0] * 3   // 3 full bars of countdown
      const ctx        = new AudioContext()
      beatMetroRef.current = ctx
      // Schedule ONE continuous click track covering the full countdown + recording session.
      // Two separate scheduleMetro calls would overlap and cause doubled/drifted clicks.
      scheduleMetro(ctx, bpm, timeSig, ctx.currentTime, countBeats * beatLen + 180)

      for (let bar = 3; bar >= 1; bar--) {
        setBeatCountdown(bar)
        await new Promise<void>(res => setTimeout(res, beatLen * timeSig[0] * 1000))
        if (!beatMetroRef.current) {
          stream.getTracks().forEach(t => t.stop())
          ctx.close()
          setBeatCountdown(null)
          return
        }
      }
      setBeatCountdown(null)
    }

    const chunks: BlobPart[] = []
    const mr = new MediaRecorder(stream)
    mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data) }
    mr.onstop = async () => {
      stream.getTracks().forEach(t => t.stop())
      beatMetroRef.current?.close()
      beatMetroRef.current = null
      try {
        const blob    = new Blob(chunks, { type: mr.mimeType })
        const decoded = await decodeAudio(blob)
        setBeatBox(decoded)
        setBeatBoxName('Beatbox recording')
        setBeatBoxOffset(0)
        setBeatStep(3)
      } catch { showToast('Recording decode failed') }
      setBeatRecording(false)
    }
    beatRecordRef.current = mr
    mr.start()
    setBeatRecording(true)
  }

  function stopBeatRecord() {
    beatRecordRef.current?.stop()
    beatRecordRef.current = null
    beatMetroRef.current?.close()
    beatMetroRef.current = null
    setBeatCountdown(null)
  }

  async function runBeatStudio(overrideStrength?: number, overrideGapFill?: number) {
    if (!beatRef || !beatBox) return
    setBeatLoading(true)
    setBeatProgress('Uploading…')
    setBeatResult(null)
    const str = overrideStrength ?? beatStrength
    const gap = overrideGapFill  ?? beatGapFill
    try {
      const form = new FormData()
      form.append('vocal',  new Blob([audioBufToWav(beatBox)],  { type: 'audio/wav' }), 'beatbox.wav')
      form.append('target', new Blob([audioBufToWav(beatRef)],  { type: 'audio/wav' }), 'beat.wav')
      form.append('opts', JSON.stringify({ strength: str / 100, gapFill: gap / 100 }))
      setBeatProgress('Transforming…')
      const res = await fetch('/api/match-vocal', { method: 'POST', body: form })
      if (!res.ok) {
        const err = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(err?.error ?? `Server error ${res.status}`)
      }
      setBeatProgress('Decoding…')
      const result = await wavToAudioBuf(await res.arrayBuffer())
      setBeatResult(result)
    } catch (e) {
      showToast(`Beat transform failed: ${e instanceof Error ? e.message : String(e)}`)
    }
    setBeatProgress('')
    setBeatLoading(false)
  }

  async function runBeatWithFeedback() {
    if (!beatFeedback.trim() || beatAiAdjusting) return
    setBeatAiAdjusting(true)
    setBeatAiExplanation(null)
    try {
      const res = await fetch('/api/beat-adjust', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ feedback: beatFeedback, strength: beatStrength, gapFill: beatGapFill }),
      })
      if (!res.ok) { showToast('AI adjustment failed'); setBeatAiAdjusting(false); return }
      const { strength, gapFill, explanation } = await res.json() as { strength: number; gapFill: number; explanation: string }
      setBeatStrength(strength)
      setBeatGapFill(gapFill)
      setBeatAiExplanation(explanation)
      setBeatFeedback('')
      setBeatAiAdjusting(false)
      // Pass values directly so the re-run doesn't capture stale state
      await runBeatStudio(strength, gapFill)
    } catch {
      showToast('AI adjustment failed')
      setBeatAiAdjusting(false)
    }
  }

  function resetBeatTranscription() {
    beatSepGenRef.current++
    dtGenRef.current++
    stopBeatRecord()
    beatStopPlay()
    setBeatBox(null)
    setBeatBoxName('')
    setBeatBoxOffset(0)
    setBeatRef(null)
    setBeatRefName('')
    setBeatRefBpm(null)
    setBeatResult(null)
    setBeatStep(1)
    setDtHits(null)
    setDtBpm(null)
  }

  function closeBeatStudio() {
    resetBeatTranscription()
    setBeatStudioOpen(false)
  }

  function addBeatResultToTimeline() {
    if (!beatResult) return
    const laneId = addCustomLane()
    setAudioClips(prev => [...prev, mkClip(crypto.randomUUID(), laneId, beatResult, 0, `Beat — ${beatRefName || 'result'}`)])
    showToast('Added to timeline')
    closeBeatStudio()
  }

  // ── Drum transcription state ──────────────────────────────────────────────
  const [beatKitCustom,         setBeatKitCustom]         = useState<Record<string, AudioBuffer>>({})
  const [beatTranscribeLoading,  setBeatTranscribeLoading]  = useState(false)
  const beatSepGenRef = useRef(0)  // incremented on reset to discard in-flight async results
  const [beatTimeSig,           setBeatTimeSig]           = useState<[number, number]>([4, 4])
  // ── New drum transcription state ──────────────────────────────────────────
  const [dtHits,    setDtHits]    = useState<BeatHit[] | null>(null)
  const [dtLoading, setDtLoading] = useState(false)
  const [dtBpm,     setDtBpm]     = useState<number | null>(null)
  const dtGenRef    = useRef(0)
  const dtCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // Snap a time value to the nearest allowed subdivision position
  function snapToGrid(time: number, bpm: number, subdiv: number): number {
    const subLen = (60 / bpm) * (4 / subdiv)  // e.g. 8ths = 0.25s at 120 BPM
    return Math.round(time / subLen) * subLen
  }

  async function runDrumDetect() {
    if (!beatBox || dtLoading) return
    const myGen = ++dtGenRef.current
    setDtLoading(true)
    setDtHits(null)
    try {
      const DRUM_TYPES: BeatType[] = ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'rim']
      const result = await analyzeBeats(beatBox, { allowedTypes: DRUM_TYPES, referenceSounds })
      if (myGen !== dtGenRef.current) return
      setDtHits(result.hits)
      if (!dtBpm && !beatRefBpm && result.bpm) setDtBpm(result.bpm)
    } catch {
      if (myGen === dtGenRef.current) showToast('Drum detection failed')
    } finally {
      if (myGen === dtGenRef.current) setDtLoading(false)
    }
  }

  async function dtCommitToTimeline() {
    const hits = dtHits
    if (!hits || hits.length === 0 || !beatBox) return
    captureHistory()
    const byType = new Map<string, BeatHit[]>()
    for (const h of hits) {
      if (!byType.has(h.type)) byType.set(h.type, [])
      byType.get(h.type)!.push(h)
    }
    for (const arr of byType.values()) arr.sort((a, b) => a.time - b.time)

    const MAX_DUR = 0.32  // hard cap per clip (seconds)
    const ctx = new AudioContext()
    const sr  = beatBox.sampleRate

    for (const [type, typeHits] of byType.entries()) {
      const laneId = addCustomLane()
      const label  = DRUM_LABELS[type] ?? type
      setTypeOverrides(prev => ({ ...prev, [laneId]: { label, color: TYPE_COLORS[type as BeatType] ?? '#6b7280' } }))
      const newClips: AudioClip[] = []
      for (let i = 0; i < typeHits.length; i++) {
        const hit     = typeHits[i]
        const nextHit = typeHits[i + 1]
        // Trim to 95% of the gap to the next same-type hit, capped at MAX_DUR
        const gap = nextHit ? (nextHit.time - hit.time) * 0.95 : MAX_DUR
        const dur = Math.min(gap, MAX_DUR)
        const s   = Math.floor(hit.time * sr)
        const e   = Math.min(beatBox.length, s + Math.floor(dur * sr))
        const buf = ctx.createBuffer(1, Math.max(1, e - s), sr)
        buf.getChannelData(0).set(beatBox.getChannelData(0).subarray(s, e))
        newClips.push(mkClip(crypto.randomUUID(), laneId, buf, hit.time, label))
      }
      setAudioClips(prev => [...prev, ...newClips])
    }
    ctx.close()
    setDtHits(null)
    showToast(`Added ${hits.length} hits across ${byType.size} lanes`)
  }

  useEffect(() => {
    const canvas = dtCanvasRef.current
    if (!canvas || !dtHits || !beatBox) { if (canvas) { const c = canvas.getContext('2d'); c?.clearRect(0, 0, canvas.width, canvas.height) }; return }
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const W = canvas.width, H = canvas.height
    ctx.clearRect(0, 0, W, H)
    // waveform background
    const ch = beatBox.getChannelData(0)
    const step = Math.max(1, Math.floor(ch.length / W))
    ctx.fillStyle = 'rgba(234,179,8,0.12)'
    for (let x = 0; x < W; x++) {
      let max = 0
      for (let i = 0; i < step; i++) { const v = Math.abs(ch[x * step + i] ?? 0); if (v > max) max = v }
      const h = Math.round(max * (H / 2))
      ctx.fillRect(x, (H / 2) - h, 1, h * 2)
    }
    // hit dots
    const dur = beatBox.duration
    for (const hit of dtHits) {
      const x = Math.round((hit.time / dur) * W)
      ctx.fillStyle = DRUM_COLORS[hit.type] ?? '#888'
      ctx.beginPath(); ctx.arc(x, H / 2, 5, 0, Math.PI * 2); ctx.fill()
    }
  }, [dtHits, beatBox])

  function exportBeatResult() {
    if (!beatResult) return
    const blob = new Blob([audioBufToWav(beatResult)], { type: 'audio/wav' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `beatbox-match-${beatRefName || 'result'}.wav`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  async function openAbletonProject() {
    try {
      const dir = await (window as unknown as { showDirectoryPicker: (o?: object) => Promise<FileSystemDirectoryHandle> })
        .showDirectoryPicker({ id: 'ableton-project', mode: 'read' })
      setAbletonLoading(true)
      setAbletonProgress('Reading project…')
      const project = await parseAbletonProject(dir)
      setAbletonProject(project)
      // Pre-select all tracks that have clips
      setAbletonSelected(new Set(project.tracks.map(t => t.id)))
      setAbletonImportOpen(true)
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        showToast(`Ableton import failed: ${(e as Error).message}`)
      }
    } finally {
      setAbletonLoading(false)
      setAbletonProgress('')
    }
  }

  async function importAbletonTracks() {
    if (!abletonProject) return
    const chosen = abletonProject.tracks.filter(t => abletonSelected.has(t.id))
    if (chosen.length === 0) return
    setAbletonImportOpen(false)
    setAbletonLoading(true)

    let imported = 0
    for (const track of chosen) {
      // Create a custom lane for this track
      const laneId = `ableton_${track.id}`
      const hue = (chosen.indexOf(track) * 47) % 360
      const color = `hsl(${hue},65%,55%)`
      setTypeOverrides(prev => ({ ...prev, [laneId]: { label: track.name, color } }))
      setExtraLaneIds(prev => prev.includes(laneId) ? prev : [...prev, laneId])

      for (const clip of track.clips) {
        setAbletonProgress(`Loading "${clip.name}" (${imported + 1}/${chosen.reduce((n, t) => n + t.clips.length, 0)})…`)
        try {
          const buf = await loadClipAudio(abletonProject.dir, clip)
          const newClip = mkClip(crypto.randomUUID(), laneId, buf, clip.timeSec, clip.name)
          // Apply track volume from Ableton's mixer
          newClip.gain = track.volume
          setAudioClips(prev => [...prev, newClip])
          imported++
        } catch (e) {
          showToast(`Skipped "${clip.name}": ${(e as Error).message}`)
        }
      }
    }

    if (abletonProject.bpm && !bpm) setBpm(abletonProject.bpm)
    setAbletonLoading(false)
    setAbletonProgress('')
    showToast(`Imported ${imported} clip${imported !== 1 ? 's' : ''} from ${abletonProject.name}`)
  }
  const [extraLaneIds, setExtraLaneIds]   = useState<string[]>([])

  function renameType(typeId: string, label: string, color: string) {
    setTypeOverrides(prev => ({ ...prev, [typeId]: { label, color } }))
  }
  function addCustomLane() {
    const id = `cust_${crypto.randomUUID()}`
    setTypeOverrides(prev => ({ ...prev, [id]: { label: 'New Sound', color: '#6b7280' } }))
    setExtraLaneIds(prev => [...prev, id])
    return id
  }

  // Seed one default track on fresh project load
  useEffect(() => {
    setExtraLaneIds(prev => {
      if (prev.length > 0) return prev
      const id = `cust_${crypto.randomUUID()}`
      setTypeOverrides(o => ({ ...o, [id]: { label: 'Track 1', color: '#8b5cf6' } }))
      // Select it so Rec is available immediately
      setTimeout(() => { setActiveLaneType(id as BeatType); setSelectedLane(id as BeatType) }, 0)
      return [id]
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  function removeCustomLane(id: string) {
    setTypeOverrides(prev => { const n = { ...prev }; delete n[id]; return n })
    setExtraLaneIds(prev => prev.filter(x => x !== id))
    setHits(prev => prev.filter(h => h.type !== id as BeatType))
    setAudioClips(prev => prev.filter(c => c.laneType !== id))
  }

  function removeLane(type: BeatType) {
    // Works on any lane (built-in or custom); built-ins just disappear when they have no hits
    setTypeOverrides(prev => { const n = { ...prev }; delete n[type as string]; return n })
    setExtraLaneIds(prev => prev.filter(x => x !== type as string))
    setHits(prev => prev.filter(h => h.type !== type))
    setAudioClips(prev => prev.filter(c => c.laneType !== type as string))
    if (activeLaneType === type) setActiveLaneType(null)
  }

  function reassignLane(fromType: BeatType, toType: BeatType) {
    setHits(prev => prev.map(h => h.type === fromType ? { ...h, type: toType } : h))
    setLaneMenu(null)
    setLaneMenuEdit(null)
    if (activeLaneType === fromType) setActiveLaneType(toType)
  }

  // ── Group tracks (bus lanes) ──────────────────────────────────────────────
  interface GroupDef {
    id: string
    label: string
    color: string
    childTypes: string[]
    collapsed: boolean
  }
  const [groupDefs, setGroupDefs] = useState<GroupDef[]>([])
  const groupDefsRef = useRef<GroupDef[]>([])
  useEffect(() => { groupDefsRef.current = groupDefs }, [groupDefs])
  const groupBusRef = useRef<Map<string, GainNode>>(new Map())

  function createGroup(selectedChildTypes?: string[]) {
    const id = `grp_${Date.now()}`
    const children = selectedChildTypes ?? []
    const color = '#6b7280'
    setGroupDefs(prev => [...prev, { id, label: 'Group', color, childTypes: children, collapsed: false }])
    setExtraLaneIds(prev => [...prev, id])
    setTypeOverrides(prev => ({ ...prev, [id]: { label: 'Group', color } }))
  }

  function toggleGroupCollapse(groupId: string) {
    setGroupDefs(prev => prev.map(g => g.id === groupId ? { ...g, collapsed: !g.collapsed } : g))
  }

  function addLaneToGroup(laneType: string, groupId: string) {
    setGroupDefs(prev => prev.map(g => {
      if (g.id !== groupId) return { ...g, childTypes: g.childTypes.filter(t => t !== laneType) }
      return { ...g, childTypes: [...new Set([...g.childTypes, laneType])] }
    }))
  }

  function removeLaneFromGroup(laneType: string) {
    setGroupDefs(prev => prev.map(g => ({ ...g, childTypes: g.childTypes.filter(t => t !== laneType) })))
  }

  // ── Lane drag-to-group ────────────────────────────────────────────────────
  const [dragLane,         setDragLane]         = useState<string | null>(null)
  const [dragOverLane,     setDragOverLane]     = useState<string | null>(null)
  const [dragInsertBefore, setDragInsertBefore] = useState<string | null>(null) // lane id the dragged lane would be inserted before
  const [laneOrder,        setLaneOrder]        = useState<string[] | null>(null)

  function handleLaneDrop(droppedLane: string, insertBeforeLane: string | null) {
    if (droppedLane === insertBeforeLane) return
    setLaneOrder(prev => {
      const current = prev ?? activeLaneTypes.map(t => t as string)
      const without = current.filter(id => id !== droppedLane)
      if (insertBeforeLane === null) return [...without, droppedLane]
      const idx = without.indexOf(insertBeforeLane)
      if (idx < 0) return [...without, droppedLane]
      const next = [...without]
      next.splice(idx, 0, droppedLane)
      return next
    })
  }

  // ── Arpeggiator state ─────────────────────────────────────────────────────
  const [arpLane, setArpLane] = useState<BeatType | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [selectedLane, setSelectedLane] = useState<BeatType | null>(null)

  // Sample pack: active AudioBuffer + rootNote per BeatType for pitch-shifted playback
  const [sampleBuffers, setSampleBuffers] = useState<Map<BeatType, AudioBuffer>>(new Map())
  const [sampleRoots,   setSampleRoots]   = useState<Map<BeatType, number>>(new Map())

  useEffect(() => {
    async function loadSamples() {
      try {
        const all = await sampleGetAll()
        // Keep only the active entry per type (isActive or most recent for legacy entries)
        const activeByType = new Map<BeatType, typeof all[0]>()
        for (const e of all) {
          if (e.isActive) { activeByType.set(e.beatType, e); continue }
          if (!activeByType.has(e.beatType)) activeByType.set(e.beatType, e)
        }
        if (activeByType.size === 0) return
        const ctx  = new AudioContext()
        const bufs = new Map<BeatType, AudioBuffer>()
        const roots = new Map<BeatType, number>()
        await Promise.all([...activeByType.entries()].map(async ([type, e]) => {
          try {
            const ab  = await e.audioBlob.arrayBuffer()
            const buf = await ctx.decodeAudioData(ab)
            bufs.set(type, buf)
            roots.set(type, e.rootNote ?? 60)
          } catch { /* skip bad blobs */ }
        }))
        await ctx.close()
        setSampleBuffers(bufs)
        setSampleRoots(roots)
      } catch { /* graceful degradation to synth */ }
    }
    loadSamples()
  }, [])

  // Voice synth: pitch-follow recorded audio through a sample pack sound.
  // Completely independent of the hit/beat system — produces a single continuous
  // audio file that can be previewed and downloaded. Does NOT create hits.
  // Audio clips — raw recordings and synth renders, stored per-lane and played as AudioBuffers
  interface AudioClip {
    id: string; laneType: string; buf: AudioBuffer; startTime: number; muted: boolean; name: string
    gain: number; stretchDuration: number | null; loopDuration: number | null; gateThreshold: number
    originalBuf: AudioBuffer | null  // preserved across conversions so re-converting re-derives from source
    fadeIn: number; fadeOut: number
    color: string | null
    reversed: boolean
    warpMarkers: WarpMarker[]
    gainEnvelope?: { t: number; v: number }[]
    segments?: { id: string; startSec: number; endSec: number; midi: number; noteName: string; amplitude: number }[]
  }
  function mkClip(id: string, laneType: string, buf: AudioBuffer, startTime: number, name: string): AudioClip {
    return { id, laneType, buf, startTime, muted: false, name, gain: 1, stretchDuration: null, loopDuration: null, gateThreshold: 0, originalBuf: null, fadeIn: 0, fadeOut: 0, color: null, reversed: false, warpMarkers: [] }
  }

  async function handleLibraryDropOnLane(laneType: string, entryId: string, time: number) {
    const all   = await libraryGetAll()
    const entry = all.find(e => e.id === entryId)
    if (!entry) return
    try {
      const ctx = new AudioContext()
      const buf = await ctx.decodeAudioData(await entry.audioBlob.arrayBuffer())
      await ctx.close()
      const clip = mkClip(crypto.randomUUID(), laneType, buf, time, entry.name)
      setAudioClips(prev => [...prev, clip])
      setDuration(d => Math.max(d, time + buf.duration + 0.5))
    } catch { showToast('Could not decode library sound') }
  }

  const [audioClips, setAudioClips] = useState<AudioClip[]>([])
  const [selectedClipIds, setSelectedClipIds] = useState<Set<string>>(new Set())
  const [compGroups, setCompGroups] = useState<CompGroup[]>([])
  const [openCompGroup, setOpenCompGroup] = useState<string | null>(null)
  const clipboardRef = useRef<AudioClip[]>([])
  const [clipMenu, setClipMenu] = useState<{ clipId: string; x: number; y: number; convertOpen?: boolean; applyOpen?: boolean } | null>(null)
  const [applyLibraryEntries, setApplyLibraryEntries] = useState<import('@/lib/sound-library').LibraryEntry[]>([])
  const [segmentPanel, setSegmentPanel] = useState<string | null>(null)  // clipId whose segments are shown
  const [saveToLibBuf, setSaveToLibBuf] = useState<AudioBuffer | null>(null)  // open AddToLibraryModal pre-loaded

  // ── Wave Manager ──────────────────────────────────────────────────────────
  interface BandDef { id: string; label: string; lo: number; hi: number; color: string }
  const FREQ_BANDS: BandDef[] = [
    { id: 'sub',      label: 'Sub-bass',  lo: 20,    hi: 80,    color: '#7c3aed' },
    { id: 'bass',     label: 'Bass',      lo: 80,    hi: 250,   color: '#2563eb' },
    { id: 'lowmid',   label: 'Low-mid',   lo: 250,   hi: 500,   color: '#059669' },
    { id: 'mid',      label: 'Mid',       lo: 500,   hi: 2000,  color: '#d97706' },
    { id: 'himid',    label: 'Hi-mid',    lo: 2000,  hi: 4000,  color: '#dc2626' },
    { id: 'presence', label: 'Presence',  lo: 4000,  hi: 8000,  color: '#db2777' },
    { id: 'air',      label: 'Air',       lo: 8000,  hi: 22050, color: '#0891b2' },
  ]
  interface BandState { def: BandDef; buf: AudioBuffer | null; muted: boolean; loading: boolean }
  const [waveMgrPanel, setWaveMgrPanel] = useState<string | null>(null)
  const [clipBands, setClipBands] = useState<Record<string, BandState[]>>({})
  const [waveMgrIsolated, setWaveMgrIsolated] = useState<number | null>(null)  // index of isolated band
  const waveMgrPlayRef = useRef<{ src: AudioBufferSourceNode; ctx: AudioContext } | null>(null)

  function wavelengthStr(hz: number): string {
    const m = 343 / hz
    return m >= 1 ? `~${m.toFixed(1)} m` : `~${(m * 100).toFixed(0)} cm`
  }

  async function extractFreqBand(src: AudioBuffer, lo: number, hi: number): Promise<AudioBuffer> {
    const ctx = new OfflineAudioContext(src.numberOfChannels, src.length, src.sampleRate)
    const node = ctx.createBufferSource(); node.buffer = src
    let last: AudioNode = node
    const sr2 = src.sampleRate / 2
    const safeHi = Math.min(hi, sr2 - 10)
    if (lo <= 20) {
      for (let i = 0; i < 2; i++) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = safeHi; f.Q.value = 0.707
        last.connect(f); last = f
      }
    } else if (hi >= sr2) {
      for (let i = 0; i < 2; i++) {
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = lo; f.Q.value = 0.707
        last.connect(f); last = f
      }
    } else {
      for (let i = 0; i < 2; i++) {
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = safeHi; f.Q.value = 0.707
        last.connect(f); last = f
      }
      for (let i = 0; i < 2; i++) {
        const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = lo; f.Q.value = 0.707
        last.connect(f); last = f
      }
    }
    last.connect(ctx.destination); node.start(0)
    return ctx.startRendering()
  }

  async function openWaveManager(clipId: string) {
    setWaveMgrPanel(clipId)
    if (clipBands[clipId]) return  // already loaded
    const clip = audioClips.find(c => c.id === clipId)
    if (!clip) return
    setClipBands(prev => ({
      ...prev,
      [clipId]: FREQ_BANDS.map(def => ({ def, buf: null, muted: false, loading: true })),
    }))
    for (let i = 0; i < FREQ_BANDS.length; i++) {
      const def = FREQ_BANDS[i]
      try {
        const buf = await extractFreqBand(clip.buf, def.lo, def.hi)
        setClipBands(prev => ({
          ...prev,
          [clipId]: (prev[clipId] ?? []).map((b, j) => j === i ? { ...b, buf, loading: false } : b),
        }))
      } catch {
        setClipBands(prev => ({
          ...prev,
          [clipId]: (prev[clipId] ?? []).map((b, j) => j === i ? { ...b, loading: false } : b),
        }))
      }
    }
  }

  function sumBuffers(bufs: AudioBuffer[]): AudioBuffer {
    const first = bufs[0]
    const out = new AudioBuffer({ numberOfChannels: first.numberOfChannels, length: first.length, sampleRate: first.sampleRate })
    for (let ch = 0; ch < first.numberOfChannels; ch++) {
      const dst = out.getChannelData(ch)
      for (const b of bufs) {
        const s = b.getChannelData(Math.min(ch, b.numberOfChannels - 1))
        for (let i = 0; i < dst.length; i++) dst[i] += s[i]
      }
    }
    return out
  }

  function toggleBandMute(clipId: string, bandIdx: number) {
    setClipBands(prev => ({
      ...prev,
      [clipId]: (prev[clipId] ?? []).map((b, j) => j === bandIdx ? { ...b, muted: !b.muted } : b),
    }))
  }

  function applyBandMutes(clipId: string) {
    const bands = clipBands[clipId]
    if (!bands) return
    const active = bands.filter(b => !b.muted && b.buf)
    if (active.length === 0) { showToast('All bands muted — unmute at least one'); return }
    const first = active[0].buf!
    const mixed = new AudioBuffer({ numberOfChannels: first.numberOfChannels, length: first.length, sampleRate: first.sampleRate })
    for (let ch = 0; ch < first.numberOfChannels; ch++) {
      const dst = mixed.getChannelData(ch)
      for (const { buf } of active) {
        const s = buf!.getChannelData(Math.min(ch, buf!.numberOfChannels - 1))
        for (let i = 0; i < dst.length; i++) dst[i] += s[i]
      }
    }
    setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, buf: mixed } : c))
    showToast('Band mix applied to clip')
  }
  type BeatSensitivity = 'low' | 'medium' | 'high'
  const [convertCard, setConvertCard] = useState<{
    clipId: string
    mode: 'synth' | 'beats'
    synthOpts: SynthOptions
    sensitivity: BeatSensitivity
    referenceBuf?: AudioBuffer | null
    referenceId?: string
    referenceLoading?: boolean
    harmProfile?: Float32Array | null
    refSearch?: string
    refCategory?: string
  } | null>(null)

  function openConvertCard(clipId: string, mode: 'synth' | 'beats') {
    setClipMenu(null)
    setConvertCard({ clipId, mode, synthOpts: { ...DEFAULT_SYNTH_OPTIONS }, sensitivity: 'medium' })
  }

  async function runConvertToBeats(clipId: string, sensitivity: BeatSensitivity) {
    const clip = audioClips.find(c => c.id === clipId)
    if (!clip) return
    setConvertCard(null)
    setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Converting…' } : c))
    const multipliers: Record<BeatSensitivity, number> = { low: 2.5, medium: 1.5, high: 0.8 }
    try {
      const result  = await analyzeBeats(clip.buf, { allowedTypes: [clip.laneType as BeatType], referenceSounds, sensitivityMultiplier: multipliers[sensitivity] })
      const newHits = result.hits.map(h => ({ ...h, id: crypto.randomUUID(), time: h.time + clip.startTime, type: clip.laneType as BeatType }))
      setHits(prev => [...prev, ...newHits])
      setAudioClips(prev => prev.filter(c => c.id !== clipId))
      if (result.duration + clip.startTime > duration) setDuration(result.duration + clip.startTime)
    } catch (e) {
      showToast(`Beat conversion failed: ${e instanceof Error ? e.message : String(e)}`)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Voice' } : c))
    }
  }

  // ── Server-side synth processing ─────────────────────────────────────────
  // Encode an AudioBuffer as WAV for upload to the API route.
  function audioBufToWav(buf: AudioBuffer): ArrayBuffer {
    const channels: Float32Array[] = []
    for (let ch = 0; ch < buf.numberOfChannels; ch++) channels.push(buf.getChannelData(ch))
    return encodeWav(channels, buf.sampleRate)
  }

  // Decode a WAV ArrayBuffer (from the API response) back into an AudioBuffer.
  async function wavToAudioBuf(ab: ArrayBuffer): Promise<AudioBuffer> {
    const { channels, sampleRate } = decodeWav(ab)
    const ctx = new AudioContext()
    try {
      const out = ctx.createBuffer(channels.length, channels[0].length, sampleRate)
      for (let ch = 0; ch < channels.length; ch++) out.getChannelData(ch).set(channels[ch])
      return out
    } finally { ctx.close() }
  }

  // Send audio to the server-side pipeline and receive the processed result.
  async function processSynthOnServer(
    srcBuf: AudioBuffer,
    refBuf: AudioBuffer | null | undefined,
    opts: SynthOptions,
    harmProfile: Float32Array | null | undefined,
  ): Promise<AudioBuffer> {
    const form = new FormData()
    form.append('audio', new Blob([audioBufToWav(srcBuf)], { type: 'audio/wav' }), 'src.wav')
    if (refBuf) form.append('refAudio', new Blob([audioBufToWav(refBuf)], { type: 'audio/wav' }), 'ref.wav')
    form.append('opts', JSON.stringify({
      harmProfile: harmProfile ? Array.from(harmProfile) : null,
      filterCutoff: opts.filterCutoff,
      pitchShift: opts.pitchShift,
    }))
    const res = await fetch('/api/process-synth', { method: 'POST', body: form })
    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: string } | null
      throw new Error(err?.error ?? `Server error ${res.status}`)
    }
    return wavToAudioBuf(await res.arrayBuffer())
  }

  async function runConvertToSynth(clipId: string, opts: SynthOptions, referenceBuf?: AudioBuffer | null, harmProfile?: Float32Array | null) {
    const clip = audioClips.find(c => c.id === clipId)
    if (!clip) return
    setConvertCard(null)
    setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Converting…' } : c))
    const source = clip.originalBuf ?? clip.buf
    const fullOpts: SynthOptions = harmProfile ? { ...opts, harmProfile } : opts

    try {
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Processing on server…' } : c))

      // Full pipeline runs server-side (HPSS + per-band synthesis + spectral smoothing
      // + reference envelope morphing + spectral match). Client only handles UI state.
      const rendered = await processSynthOnServer(source, referenceBuf, opts, harmProfile)

      // Still detect pitch client-side for note segments (fast, lightweight)
      const rawCurve = await detectPitchCurveAsync(source)
      const curve    = smoothPitchCurve(rawCurve)
      const midiNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
      const noteSegs = extractNoteEvents(curve).map(n => ({
        id: crypto.randomUUID(),
        startSec: n.start,
        endSec: n.end,
        midi: n.midi,
        noteName: `${midiNames[n.midi % 12]}${Math.floor(n.midi / 12) - 1}`,
        amplitude: n.amplitude,
      }))

      setAudioClips(prev => prev.map(c => c.id === clipId
        ? { ...c, buf: rendered, name: 'Synth', originalBuf: c.originalBuf ?? c.buf, segments: noteSegs }
        : c
      ))
      runSynthTuner(clipId, curve, source, fullOpts, referenceBuf)
    } catch (e) {
      showToast(`Synth conversion failed: ${e instanceof Error ? e.message : String(e)}`)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Voice' } : c))
    }
  }

  // Re-synthesize a single note segment and splice it back into the clip
  async function reConvertSegment(clipId: string, segId: string, opts: SynthOptions, referenceBuf?: AudioBuffer | null, harmProfile?: Float32Array | null) {
    const clip = audioClips.find(c => c.id === clipId)
    const seg  = clip?.segments?.find(s => s.id === segId)
    if (!clip || !seg) return
    const source = clip.originalBuf ?? clip.buf
    const fullOpts: SynthOptions = harmProfile ? { ...opts, harmProfile } : opts
    showToast('Re-converting note…')
    try {
      const subBuf = extractSubBuffer(source, seg.startSec, seg.endSec)
      const segResult = await processSynthOnServer(subBuf, referenceBuf, opts, harmProfile)
      const newFull   = spliceSegmentBack(clip.buf, segResult, seg.startSec)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, buf: newFull } : c))
      showToast('Note re-converted')
    } catch (e) {
      showToast(`Re-convert failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  async function runSynthTuner(
    clipId: string,
    pitchCurve: import('@/lib/pitch-detector').PitchFrame[],
    source: AudioBuffer,
    opts: SynthOptions,
    referenceBuf?: AudioBuffer | null,
    skipLearning = false,
  ) {
    synthTunerArgsRef.current = { clipId, pitchCurve, source, opts, referenceBuf }

    // Snapshot the pre-tuning buffer so the × button can revert
    const preAiClip = audioClips.find(c => c.id === clipId)
    const preAiBuf = preAiClip?.buf ?? null

    setSynthTuner({ clipId, status: 'running', iteration: 1, iterations: [], preAiBuf })

    let currentCode = ''
    try {
      const codeRes = await fetch('/api/synth-code')
      if (!codeRes.ok) {
        setSynthTuner(prev => prev ? { ...prev, status: 'error', errorMsg: `/api/synth-code returned ${codeRes.status}` } : null)
        return
      }
      ;({ code: currentCode } = await codeRes.json() as { code: string })
    } catch (e) {
      setSynthTuner(prev => prev ? { ...prev, status: 'error', errorMsg: `Failed to load code: ${String(e)}` } : null)
      return
    }

    const notes = extractNoteEvents(pitchCurve)

    // Per-note pitch statistics derived from raw pitch frames
    const noteStats = notes.map(n => {
      const frames = pitchCurve.filter(f => f.time >= n.start && f.time <= n.end && f.freq != null)
      if (frames.length < 2) return { pitchVarianceCents: 0, sustainLevel: 1, attackMs: 0 }
      const freqs = frames.map(f => f.freq!)
      const avgFreq = freqs.reduce((s, x) => s + x, 0) / freqs.length
      const cents = freqs.map(f => 1200 * Math.log2(f / avgFreq))
      const pitchVarianceCents = Math.round(Math.sqrt(cents.reduce((s, c) => s + c * c, 0) / cents.length))
      // Amplitude: peak and sustain (last 30% of note frames)
      const amps = frames.map(f => f.amplitude)
      const peakAmp = Math.max(...amps)
      const tail = amps.slice(Math.max(0, Math.floor(amps.length * 0.7)))
      const sustainLevel = peakAmp > 0 ? Math.round((tail.reduce((s, x) => s + x, 0) / tail.length / peakAmp) * 100) / 100 : 1
      // Attack: time from note start to first frame at 80% of peak amplitude
      const attackFrame = frames.findIndex(f => f.amplitude >= peakAmp * 0.8)
      const attackMs = attackFrame >= 0 ? Math.round((frames[attackFrame].time - n.start) * 1000) : 0
      return { pitchVarianceCents, sustainLevel, attackMs }
    })

    // Note transitions: gap between consecutive notes and pitch jump
    const transitions = notes.slice(1).map((n, i) => ({
      gapMs: Math.round((n.start - notes[i].end) * 1000),
      pitchJumpSemitones: +(n.midi - notes[i].midi).toFixed(1),
    }))

    // Downsampled pitch trajectory: ~80 points covering the whole recording
    const step = Math.max(1, Math.floor(pitchCurve.length / 80))
    const trajectory = pitchCurve
      .filter((_, i) => i % step === 0)
      .map(f => ({
        t:   +f.time.toFixed(2),
        hz:  f.freq  != null ? +f.freq.toFixed(1) : null,
        amp: +f.amplitude.toFixed(2),
      }))

    const pitchSummary = {
      totalDuration: source.duration,
      noteCount:     notes.length,
      avgDurationMs: Math.round(notes.reduce((s, n) => s + (n.end - n.start), 0) / Math.max(1, notes.length) * 1000),
      pitchRangeMidi: notes.length > 0
        ? { min: Math.min(...notes.map(n => n.midi)), max: Math.max(...notes.map(n => n.midi)) }
        : null,
      notes,          // all notes
      noteStats,      // per-note pitch variance, sustain level, attack speed
      transitions,    // gap/jump between consecutive notes
      trajectory,     // downsampled pitch+amplitude curve for the full recording
    }

    // Build feature vector for this recording
    const avgVariance = noteStats.length
      ? Math.round(noteStats.reduce((s, x) => s + x.pitchVarianceCents, 0) / noteStats.length)
      : 0
    const medianMidi = notes.length > 0
      ? notes.slice().sort((a, b) => a.midi - b.midi)[Math.floor(notes.length / 2)].midi
      : 60
    const gapCount = transitions.filter(t => t.gapMs > 30).length
    const features: ProfileFeatures = {
      noteCount:          notes.length,
      avgDurationMs:      pitchSummary.avgDurationMs,
      pitchVarianceCents: avgVariance,
      medianMidi,
      gapRatio:           transitions.length > 0 ? gapCount / transitions.length : 0,
      totalDuration:      source.duration,
    }

    // Check for a stored learned profile that matches this recording
    if (!skipLearning) {
      const match = findBestMatch(features)
      if (match) {
        try {
          const factory = new Function('extractNoteEvents', 'midiToFreq', 'freqToMidi',
            `${match.code}\nreturn transformVoiceToSynth`)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          const fn = factory(extractNoteEvents, midiToFreq, freqToMidi) as typeof transformVoiceToSynth
          const { harmonic: hSrc, percussive: pSrc } = await separateHarmonicPercussive(source)
          const profileBands: AudioBuffer[] = []
          for (const band of FREQ_BANDS) {
            const bb = await extractFreqBand(hSrc, band.lo, band.hi)
            profileBands.push(await fn(bb, pitchCurve, source.sampleRate, source.duration, opts))
          }
          let rendered = mixBuffers(sumBuffers(profileBands), pSrc)
          if (referenceBuf && !opts.harmProfile) rendered = await matchBuffer(rendered, hSrc, referenceBuf)
          setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, buf: rendered } : c))
          synthCurrentCodeRef.current = match.code
          incrementUsage(match.id)
          setSynthTuner({ clipId, status: 'done', iteration: 0, iterations: [], preAiBuf, features, learnedProfileId: match.id })
          return
        } catch (e) {
          console.warn('[SynthTuner] Learned profile failed, falling back to AI:', e)
        }
      }
    }

    const originalCode = currentCode  // never changes — each pass starts from this
    const completedIterations: SynthTunerIteration[] = []
    const userFeedbacks: string[] = []  // indexed by iteration-1 (feedback collected before that iteration)
    synthCancelledRef.current = false

    // Store features in state so the "Keep AI version" button can save a profile
    setSynthTuner(prev => prev ? { ...prev, features } : null)

    // Checkpoint buffer: advances only when user accepts a pass.
    // On reject we revert the clip to this buffer before the next pass runs.
    let lastAcceptedBuf: AudioBuffer | null = preAiBuf
    let lastRenderedBuf: AudioBuffer | null = preAiBuf

    for (let i = 1 as 1 | 2 | 3; i <= 3; i++) {
      if (synthCancelledRef.current) break
      setSynthTuner(prev => prev ? { ...prev, status: 'running', iteration: i } : null)
      const userFeedback = userFeedbacks[i - 2] ?? ''  // feedback from user after seeing pass i-1
      try {
        const res = await fetch('/api/synth-tune', {
          method:  'POST',
          headers: { 'content-type': 'application/json' },
          // Always the original code — don't chain on potentially broken output.
          // Pass previous iterations so Claude learns what was tried.
          body:    JSON.stringify({ code: originalCode, pitchSummary, iteration: i, previousIterations: completedIterations, userFeedback }),
        })
        if (!res.ok) {
          const errBody = await res.json().catch(() => null) as { error?: string } | null
          setSynthTuner(prev => prev ? { ...prev, status: 'error', errorMsg: errBody?.error ?? `API error ${res.status}` } : null)
          return
        }

        const { iteration: iterData, improvedCode } = await res.json() as {
          iteration:   SynthTunerIteration
          improvedCode: string
        }

        completedIterations.push(iterData)
        setSynthTuner(prev => prev ? { ...prev, iterations: [...prev.iterations, iterData] } : null)

        // Apply the improved function immediately via eval
        try {
          const factory = new Function('extractNoteEvents', 'midiToFreq', 'freqToMidi',
            `${improvedCode}\nreturn transformVoiceToSynth`)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call
          const improvedFn = factory(extractNoteEvents, midiToFreq, freqToMidi) as typeof transformVoiceToSynth
          const { harmonic: hImproved, percussive: pImproved } = await separateHarmonicPercussive(source)
          const improvedBands: AudioBuffer[] = []
          for (const band of FREQ_BANDS) {
            const bb = await extractFreqBand(hImproved, band.lo, band.hi)
            improvedBands.push(await improvedFn(bb, pitchCurve, source.sampleRate, source.duration, opts))
          }
          let rendered = mixBuffers(sumBuffers(improvedBands), pImproved)
          // opts already contains harmProfile; matchBuffer only needed when reference exists but profile extraction failed
          if (referenceBuf && !opts.harmProfile) rendered = await matchBuffer(rendered, hImproved, referenceBuf)
          setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, buf: rendered } : c))
          lastRenderedBuf = rendered
          currentCode = improvedCode  // track latest applied code for the final save
          synthCurrentCodeRef.current = improvedCode
        } catch (evalErr) {
          console.warn(`[SynthTuner] Iteration ${i} eval failed:`, evalErr)
        }

        // Between iterations: pause, let user accept or reject, collect feedback
        if (i < 3 && !synthCancelledRef.current) {
          synthPassAcceptedRef.current = true  // default: accept if user dismisses without deciding
          const feedback = await new Promise<string>(resolve => {
            synthResumeRef.current = resolve
            setSynthTuner(prev => prev ? { ...prev, status: 'waiting' } : null)
          })
          synthResumeRef.current = null
          if (synthCancelledRef.current) break

          if (synthPassAcceptedRef.current) {
            lastAcceptedBuf = lastRenderedBuf  // advance checkpoint
          } else if (lastAcceptedBuf) {
            // Revert clip to last accepted state and let the next pass try again
            const revertTo = lastAcceptedBuf
            setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, buf: revertTo } : c))
          }
          userFeedbacks.push(feedback)
        }
      } catch (fetchErr) {
        console.warn(`[SynthTuner] Iteration ${i} fetch failed:`, fetchErr)
      }
    }

    // Persist the final improved code to disk (dev only)
    try {
      await fetch('/api/apply-synth-code', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ code: currentCode }),
      })
    } catch { /* non-critical */ }

    setSynthTuner(prev => prev ? { ...prev, status: 'done' } : null)
  }

  // + Track popover state

  // ── Separate Sounds ───────────────────────────────────────────────────────
  // Right-click flow: analyze an audio clip, slice out each hit, create one
  // lane per drum type with real audio excerpts from the source clip.
  async function runSeparateSounds(clipId: string) {
    const clip = audioClips.find(c => c.id === clipId)
    if (!clip) return
    setClipMenu(null)
    showToast('Detecting sounds…')
    captureHistory()
    try {
      const DRUM_ALLOWED: BeatType[] = ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'rim']
      const result = await analyzeBeats(clip.buf, { allowedTypes: DRUM_ALLOWED, referenceSounds })
      if (result.hits.length === 0) {
        showToast('No drum sounds detected in this clip')
        return
      }
      const byType = new Map<string, BeatHit[]>()
      for (const h of result.hits) {
        if (!byType.has(h.type)) byType.set(h.type, [])
        byType.get(h.type)!.push(h)
      }
      const ctx = new AudioContext()
      const sr = ctx.sampleRate
      const srcBuf = clip.buf
      const newClips: AudioClip[] = []
      for (const [type, typeHits] of byType.entries()) {
        // Use a 400ms excerpt from the source at the first hit as the per-lane sample
        let sampleBuf: AudioBuffer
        if (beatKitCustom[type]) {
          sampleBuf = beatKitCustom[type]
        } else {
          const firstHit = typeHits[0]
          const srcSr = srcBuf.sampleRate
          const s = Math.floor(firstHit.time * srcSr)
          const e = Math.min(srcBuf.length, s + Math.floor(0.4 * srcSr))
          const len = Math.max(1, e - s)
          sampleBuf = ctx.createBuffer(1, len, srcSr)
          sampleBuf.getChannelData(0).set(srcBuf.getChannelData(0).subarray(s, e))
        }
        const laneId = addCustomLane()
        setTypeOverrides(prev => ({ ...prev, [laneId]: { label: DRUM_LABELS[type] ?? type, color: TYPE_COLORS[type as BeatType] ?? '#6b7280' } }))
        newClips.push(...typeHits.map(h => mkClip(crypto.randomUUID(), laneId, sampleBuf, h.time, DRUM_LABELS[type] ?? type)))
      }
      setAudioClips(prev => [...prev, ...newClips])
      ctx.close()
      showToast(`Separated ${result.hits.length} hits → ${byType.size} track${byType.size !== 1 ? 's' : ''}`)
    } catch (e) {
      showToast(`Separation failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Beat Studio calibration flow: analyze beatRef and queue results for review
  async function runSeparateFromRef() {
    if (!beatRef) return
    const myGen = ++beatSepGenRef.current
    const capturedRef = beatRef          // capture before the await so state changes can't affect it
    setBeatTranscribeLoading(true)
    setDtHits(null)
    setBeatBox(null)                     // immediately collapse Drum Transcription section
    try {
      const DRUM_ALLOWED: BeatType[] = ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'rim']
      const result = await analyzeBeats(capturedRef, { allowedTypes: DRUM_ALLOWED, sensitivityMultiplier: 0.55 })
      if (myGen !== beatSepGenRef.current) return  // studio was reset while analyzing — discard
      if (result.hits.length === 0) {
        showToast('No drum sounds detected — try adjusting sensitivity or a different file')
      } else {
        setBeatBox(capturedRef)
        setBeatBoxName(beatRefName ?? 'Reference')
        setDtHits(result.hits)
      }
    } catch (e) {
      if (myGen === beatSepGenRef.current) {
        showToast(`Separation failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (myGen === beatSepGenRef.current) setBeatTranscribeLoading(false)
  }

  // handleTapTempo was a legacy duplicate that only set bpm (not masterBpm).
  // Replaced with a direct alias to tapTempo, which sets both.
  const handleTapTempo = tapTempo

  // ── Per-lane input mode ────────────────────────────────────────────────────
  // inputLanes: which lanes have input armed
  // inputSource: per lane — 'midi' | audio deviceId string ('default' = system default)
  const [inputLanes,  setInputLanes]  = useState<Set<string>>(new Set())
  const [inputSource, setInputSource] = useState<Record<string, string>>({})
  const [inputSourcePickerLane, setInputSourcePickerLane] = useState<string | null>(null)
  const [pickerDevices, setPickerDevices] = useState<MediaDeviceInfo[]>([])
  const inputLanesRef  = useRef<Set<string>>(new Set())
  const inputSourceRef = useRef<Record<string, string>>({})
  useEffect(() => { inputLanesRef.current  = inputLanes  }, [inputLanes])
  useEffect(() => { inputSourceRef.current = inputSource }, [inputSource])

  // Enumerate audio devices when picker opens; request permission once to unlock labels
  useEffect(() => {
    if (!inputSourcePickerLane) return
    let cancelled = false
    async function enumerate() {
      try {
        const probe = await navigator.mediaDevices.enumerateDevices()
        const hasLabels = probe.some(d => d.kind === 'audioinput' && d.label)
        if (!hasLabels) {
          const tmp = await navigator.mediaDevices.getUserMedia({ audio: true })
          tmp.getTracks().forEach(t => t.stop())
        }
      } catch { /* denied — show devices with generic labels */ }
      if (cancelled) return
      const all = await navigator.mediaDevices.enumerateDevices()
      if (!cancelled) setPickerDevices(all.filter(d => d.kind === 'audioinput'))
    }
    enumerate()
    return () => { cancelled = true }
  }, [inputSourcePickerLane])

  function toggleInputLane(laneType: string) {
    setInputLanes(prev => {
      const next = new Set(prev)
      if (next.has(laneType)) {
        next.delete(laneType)
      } else {
        next.add(laneType)
        // default source to system default audio input
        setInputSource(s => s[laneType] ? s : { ...s, [laneType]: 'default' })
      }
      return next
    })
  }

  // ── Sidechain routing: key = `${laneType}:${effectId}`, value = source lane type or '' ───
  const [laneSidechains, setLaneSidechains] = useState<Record<string, string>>({})
  const laneSidechainsRef = useRef<Record<string, string>>({})
  useEffect(() => { laneSidechainsRef.current = laneSidechains }, [laneSidechains])

  // ── MIDI CC mapping ───────────────────────────────────────────────────────
  const [midiMappings,  setMidiMappings]  = useState<MidiMapping[]>([])
  const [midiLearning,  setMidiLearning]  = useState<MidiMappingTarget | null>(null)
  const [showMidiPanel, setShowMidiPanel] = useState(false)
  const [showKeyboard,  setShowKeyboard]  = useState(false)
  const [lastMappedId,  setLastMappedId]  = useState<string | null>(null)
  const midiMappingsRef  = useRef<MidiMapping[]>([])
  const midiLearningRef  = useRef<MidiMappingTarget | null>(null)
  useEffect(() => { midiMappingsRef.current = midiMappings },  [midiMappings])
  useEffect(() => { midiLearningRef.current = midiLearning },  [midiLearning])

  function applyMappingTarget(target: MidiMappingTarget, value: number) {
    switch (target.type) {
      case 'masterVolume': setMasterVolume(Math.max(0, Math.min(2, value))); break
      case 'bpm': setBpm(Math.max(20, Math.min(300, Math.round(value)))); setMasterBpm(Math.max(20, Math.min(300, Math.round(value)))); break
      case 'laneLevel':  setLaneLevels(prev => ({ ...prev, [target.laneType]: Math.max(0, Math.min(1, value)) })); break
      case 'lanePan':    setLanePans(prev => ({ ...prev, [target.laneType]: Math.max(-1, Math.min(1, value)) })); break
      case 'laneReverb': setLaneReverb(prev => ({ ...prev, [target.laneType]: Math.max(0, Math.min(1, value)) })); break
      case 'laneDelay':  setLaneDelay(prev => ({ ...prev, [target.laneType]: Math.max(0, Math.min(1, value)) })); break
      case 'fxParam':    updateLaneEffectParam(target.laneType, target.effectId, target.paramKey, value); break
      case 'automPoint':
        setAutomLanes(prev => prev.map(a => {
          if (a.id !== target.automLaneId) return a
          const near = a.points.find(p => Math.abs(p.time - playhead) < 0.05)
          if (near) return { ...a, points: a.points.map(p => p.id === near.id ? { ...p, value } : p) }
          return { ...a, points: [...a.points, { id: crypto.randomUUID(), time: playhead, value }].sort((x, y) => x.time - y.time) }
        }))
        break
    }
  }

  function handleMidiExport() {
    const json = JSON.stringify(serializeMappings({ mappings: midiMappings, learningTarget: null }), null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a'); a.href = url; a.download = 'midi-mappings.json'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  // ── Live MIDI input — routes to all midi-sourced input lanes ──────────────
  const midiAccessRef  = useRef<MIDIAccess | null>(null)
  const midiArmed      = Array.from(inputLanes).some(l => inputSource[l] === 'midi')

  useEffect(() => {
    if (!midiArmed && midiMappings.length === 0) {
      if (midiAccessRef.current) {
        for (const inp of midiAccessRef.current.inputs.values()) inp.onmidimessage = null
      }
      return
    }
    if (!navigator.requestMIDIAccess) return
    navigator.requestMIDIAccess().then(access => {
      midiAccessRef.current = access
      const handler = (e: MIDIMessageEvent) => {
        if (!e.data) return
        const status = e.data[0]

        // CC messages (0xB0–0xBF) — handle MIDI learn and parameter control
        if (status >= 0xB0 && status <= 0xBF) {
          const channel = (status - 0xB0) + 1
          const cc      = e.data[1]
          const value   = e.data[2]
          if (midiLearningRef.current) {
            const newMapping: MidiMapping = {
              id: crypto.randomUUID(), channel, cc,
              target: midiLearningRef.current,
              min: 0, max: 1, curve: 'linear',
              label: targetLabel(midiLearningRef.current),
            }
            setMidiMappings(prev => [...prev, newMapping])
            setLastMappedId(newMapping.id)
            setMidiLearning(null)
          } else {
            for (const mapping of midiMappingsRef.current) {
              if ((mapping.channel === 'any' || mapping.channel === channel) && mapping.cc === cc) {
                applyMappingTarget(mapping.target, applyCCValue(value, mapping))
              }
            }
          }
          return
        }

        // Note-on messages (0x90–0x9F)
        const note = e.data[1]; const velocity = e.data[2]
        if ((status & 0xF0) !== 0x90 || velocity === 0) return
        const vel = velocity / 127
        const midiTargets = Array.from(inputLanesRef.current).filter(l => inputSourceRef.current[l] === 'midi')
        const ts = playStartRef.current
          ? playStartRef.current.beatTime + (performance.now() - playStartRef.current.wallTime) / 1000
          : playhead
        setHits(prev => [
          ...prev,
          ...midiTargets.map(t => ({ id: crypto.randomUUID(), time: ts, type: t as BeatType, velocity: vel, note })),
        ].sort((a, b) => a.time - b.time))
      }
      for (const inp of access.inputs.values()) inp.onmidimessage = handler
      access.onstatechange = () => {
        for (const inp of access.inputs.values()) inp.onmidimessage = handler
      }
    }).catch(() => {})
    return () => {
      if (midiAccessRef.current) {
        for (const inp of midiAccessRef.current.inputs.values()) inp.onmidimessage = null
      }
    }
  }, [midiArmed, midiMappings.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── View mode: Arrangement vs Session ────────────────────────────────────
  const [viewMode, setViewMode] = useState<'arrangement' | 'session'>('arrangement')
  const [pianoRollLane, setPianoRollLane] = useState<BeatType | null>(null)
  const [samplerLane, setSamplerLane] = useState<string | null>(null)
  const [wavetableLane, setWavetableLane] = useState<string | null>(null)
  const [fmSynthLane, setFmSynthLane] = useState<string | null>(null)
  // Patch state for instrument editors
  const [samplerPatch, setSamplerPatch] = useState<import('@/lib/sampler-engine').SamplerPatch | null>(null)
  const [wavetablePatch, setWavetablePatch] = useState<import('@/lib/wavetable-synth').WavetablePatch | null>(null)
  const [fmPatch, setFmPatch] = useState<import('@/lib/fm-synth').FMPatch | null>(null)
  const [stepSeqLane, setStepSeqLane] = useState<BeatType | null>(null)
  const [chordBuilderLane, setChordBuilderLane] = useState<BeatType | null>(null)

  // Session view clip grid: Record<laneType, (SceneClip | null)[]>
  const [sessionClips, setSessionClips] = useState<Record<string, (SceneClip | null)[]>>({})
  const [sessionPlaying, setSessionPlaying] = useState<Record<string, number | null>>({})
  // Per-lane session playback timers (loop reschedule) and active scene info
  const sessionTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const sessionPlayingSceneRef = useRef<Map<string, number>>(new Map())

  function getSessionLaneClips(laneType: string): (SceneClip | null)[] {
    const existing = sessionClips[laneType]
    if (existing && existing.length === SCENE_COUNT) return existing
    return Array(SCENE_COUNT).fill(null)
  }

  // Stop session audio for one lane (does not update sessionPlaying state — caller must do that)
  function stopSessionLaneAudio(laneType: string) {
    const timer = sessionTimersRef.current.get(laneType)
    if (timer != null) clearTimeout(timer)
    sessionTimersRef.current.delete(laneType)
    sessionPlayingSceneRef.current.delete(laneType)
  }

  // Start looping a session clip's hits for a lane. Re-schedules itself before each loop boundary.
  async function startSessionClipAudio(laneType: string, sceneIdx: number) {
    stopSessionLaneAudio(laneType)
    const clip = sessionClips[laneType]?.[sceneIdx]
    if (!clip) return
    const ctx = getAudioCtx()
    const bpmVal = effectiveBpmRef.current || 120
    const lapSec = Math.max(0.1, clip.durationBars * 4 * (60 / bpmVal))
    const laneHits = hitsRef.current.filter(h => h.type === laneType && h.time < lapSec)
    sessionPlayingSceneRef.current.set(laneType, sceneIdx)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let drumMod: any, melMod: any
    try {
      drumMod = await import('@/lib/drum-samples')
      melMod  = await import('@/lib/instrument-synth')
    } catch { stopSessionLaneAudio(laneType); return }
    const playDrumHit:    (ctx: AudioContext, mode: string, type: string, when: number, vel: number, note: number, buf?: AudioBuffer, dest?: AudioNode) => void = drumMod.playDrumHit
    const playMelodicNote: (ctx: AudioContext, type: string, note: number, when: number, vel: number, dest?: AudioNode) => void = melMod.playMelodicNote
    const MELODIC_TYPES:   Set<string> = melMod.MELODIC_TYPES

    function playLap(lapStart: number) {
      if (sessionPlayingSceneRef.current.get(laneType) !== sceneIdx) return
      for (const hit of laneHits) {
        const when = lapStart + hit.time
        if (when < ctx.currentTime - 0.01) continue
        if (MELODIC_TYPES.has(hit.type)) playMelodicNote(ctx, hit.type, hit.note, when, hit.velocity, ctx.destination)
        else playDrumHit(ctx, 'synth', hit.type, when, hit.velocity, hit.note ?? 60, undefined, ctx.destination)
      }
      // Schedule follow action / loop before end of lap
      const nextLap = lapStart + lapSec
      const msUntilNext = (nextLap - ctx.currentTime) * 1000 - 80
      const timer = setTimeout(() => {
        if (sessionPlayingSceneRef.current.get(laneType) !== sceneIdx) return
        const followAction = clip?.followAction ?? 'loop'
        if (followAction === 'stop') {
          stopSessionLaneAudio(laneType)
          setSessionPlaying(prev => ({ ...prev, [laneType]: null }))
        } else if (followAction === 'next') {
          const nextSceneIdx = sceneIdx + 1
          if (sessionClips[laneType]?.[nextSceneIdx]) {
            setSessionPlaying(prev => ({ ...prev, [laneType]: nextSceneIdx }))
            void startSessionClipAudio(laneType, nextSceneIdx)
          } else {
            stopSessionLaneAudio(laneType)
            setSessionPlaying(prev => ({ ...prev, [laneType]: null }))
          }
        } else {
          playLap(nextLap)
        }
      }, Math.max(0, msUntilNext))
      sessionTimersRef.current.set(laneType, timer)
    }
    playLap(ctx.currentTime)
  }

  // ── Locators ──────────────────────────────────────────────────────────────
  const [locators, setLocators] = useState<Locator[]>([])
  const locatorCountRef = useRef(0)

  function addLocator(t: number) {
    captureHistory()
    locatorCountRef.current += 1
    const label = bpm
      ? `${Math.round(t / (60 / bpm / 4) / 4) + 1}`
      : `M${locatorCountRef.current}`
    setLocators(prev => [...prev, { id: crypto.randomUUID(), time: t, label }].sort((a, b) => a.time - b.time))
  }

  function removeLocator(id: string) {
    captureHistory()
    setLocators(prev => prev.filter(l => l.id !== id))
  }

  // ── Quantize / Groove ─────────────────────────────────────────────────────
  const [quantizeSwing, setQuantizeSwing] = useState(0)

  function quantizeHits() {
    captureHistory()
    const grid = snapInterval > 0 ? snapInterval : (bpm ? 60 / bpm / 4 : 0)
    if (!grid) return
    const swing = quantizeSwing
    setHits(prev => prev.map(h => {
      const stepIdx = Math.round(h.time / grid)
      const isOdd = stepIdx % 2 === 1
      const swingOffset = isOdd ? grid * swing * 0.14 : 0
      return { ...h, time: Math.max(0, stepIdx * grid + swingOffset) }
    }).sort((a, b) => a.time - b.time))
  }

  // Per-lane recording — mic button in editing toolbar records into the active lane only
  const [laneRecording,     setLaneRecording]     = useState(false)
  const [laneRecordingTime, setLaneRecordingTime]  = useState(0)
  const laneRecTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Each entry = one device being recorded + which lanes it feeds
  const laneRecordersRef = useRef<{ recorder: MediaRecorder; chunks: Blob[]; lanes: string[] }[]>([])
  const laneRecStartPlayheadRef = useRef(0)

  async function startLaneRecording() {
    setError(null)
    // Warn if AB loop is active — recording will auto-create a CompGroup which may surprise the user
    if (abLoopEnabled && abLoop && !window.confirm(
      'AB loop is active. Recording will automatically create a Comp Group for this loop range.\n\nContinue?'
    )) return
    // Stop active playback so the metronome click doesn't bleed into the mic
    if (isPlaying) stopPlayback()
    try {
      // Count-in: play click track for 1 bar before recording
      if (countIn) {
        const ebpm    = effectiveBpmRef.current
        const beatSec = 60 / ebpm
        const ctx     = getAudioCtx()
        for (let beat = 0; beat < 4; beat++) {
          const when = ctx.currentTime + beat * beatSec
          playMetronomeClick(ctx, when, beat === 0)
        }
        setCountingIn(true)
        for (let beat = 1; beat <= 4; beat++) {
          setCountInBeat(beat)
          await new Promise<void>(res => setTimeout(res, beatSec * 1000))
        }
        setCountingIn(false)
        setCountInBeat(0)
      }

      // Group mic-armed lanes by device ID so each physical input gets its own recorder
      const micLanes = Array.from(inputLanesRef.current).filter(l => inputSourceRef.current[l] !== 'midi')
      const byDevice = new Map<string, string[]>()
      for (const lane of micLanes) {
        const dev = inputSourceRef.current[lane] ?? 'default'
        if (!byDevice.has(dev)) byDevice.set(dev, [])
        byDevice.get(dev)!.push(lane)
      }
      if (byDevice.size === 0 && activeLaneType) byDevice.set('default', [activeLaneType])

      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg'
      const entries: { recorder: MediaRecorder; chunks: Blob[]; lanes: string[] }[] = []

      for (const [deviceId, lanes] of byDevice) {
        const constraint: MediaTrackConstraints =
          deviceId && deviceId !== 'default'
            ? { deviceId: { exact: deviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            : { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        const stream = await navigator.mediaDevices.getUserMedia({ audio: constraint, video: false })
        const entry = { recorder: null as unknown as MediaRecorder, chunks: [] as Blob[], lanes }
        const recorder = new MediaRecorder(stream, { mimeType })
        entry.recorder = recorder
        recorder.ondataavailable = e => { if (e.data.size > 0) entry.chunks.push(e.data) }
        recorder.start(100)
        entries.push(entry)
      }

      laneRecordersRef.current = entries
      laneRecStartPlayheadRef.current = playhead
      setLaneRecording(true)
      setLaneRecordingTime(0)
      laneRecTimerRef.current = setInterval(() => {
        setLaneRecordingTime(t => {
          const newT = t + 0.1
          setDuration(prev => Math.max(prev, laneRecStartPlayheadRef.current + newT + 2))
          return newT
        })
      }, 100)
      startPlaybackFrom(playhead)
    } catch {
      setError('Microphone access denied.')
      setCountingIn(false)
      setCountInBeat(0)
    }
  }

  async function stopLaneRecording() {
    const entries = laneRecordersRef.current
    if (entries.length === 0) return
    if (laneRecTimerRef.current) clearInterval(laneRecTimerRef.current)

    // Stop all recorders simultaneously
    entries.forEach(e => { e.recorder.stop(); e.recorder.stream.getTracks().forEach(t => t.stop()) })
    stopPlayback()
    await Promise.all(entries.map(e => new Promise<void>(res => { e.recorder.onstop = () => res() })))

    setLaneRecording(false)
    laneRecordersRef.current = []
    const offset = laneRecStartPlayheadRef.current

    // Decode each device's recording independently and place into its lanes
    const newClips: AudioClip[] = []
    let maxEnd = duration
    await Promise.all(entries.map(async entry => {
      if (entry.chunks.length === 0) return
      try {
        const blob = new Blob(entry.chunks, { type: entry.chunks[0]?.type ?? 'audio/webm' })
        const buf  = await decodeAudio(blob)
        for (const laneType of entry.lanes) {
          newClips.push(mkClip(crypto.randomUUID(), laneType, buf, offset, 'Voice'))
        }
        maxEnd = Math.max(maxEnd, buf.duration + offset)
      } catch { /* skip if this device's recording is undecodable */ }
    }))
    if (newClips.length > 0) {
      setAudioClips(prev => [...prev, ...newClips])
      setDuration(maxEnd)
      // Auto-group loop-recorded takes into comp groups when AB loop is active
      if (abLoopEnabledRef.current && abLoopRef.current) {
        const loopStart = abLoopRef.current.start
        const loopEnd   = abLoopRef.current.end
        newClips.forEach(clip => {
          setCompGroups(prev => addTakeToGroup(prev, clip, loopStart, loopEnd))
        })
      }
    }
  }

  // Reference sounds from Sound Library (used by analyzeBeats for classification)
  const [referenceSounds, setReferenceSounds] = useState<ReferenceSound[]>([])
  useEffect(() => {
    async function loadReferences() {
      correctionsClear().catch(() => {})  // clear old learning data
      const library = await libraryGetAll().catch(() => [] as import('@/lib/sound-library').LibraryEntry[])
      const fromLibrary: ReferenceSound[] = library
        .filter(e => e.spectral && e.category !== 'voice' && e.category !== 'custom')
        .map(e => ({ category: e.category as BeatType, spectral: e.spectral! }))
      setReferenceSounds(fromLibrary)
    }
    loadReferences()
  }, [])

  // Report hits/duration/bpm to parent whenever they change
  useEffect(() => {
    onHitsChange?.(hits, duration, bpm)
  }, [hits, duration, bpm]) // eslint-disable-line

  // ── Tier-1 DAW features ───────────────────────────────────────────────────
  // Master BPM (user-set; detection overrides it when analysis runs)
  const [masterBpm, setMasterBpm] = useState(120)
  const [bpmEditing, setBpmEditing] = useState(false)
  const [bpmInputVal, setBpmInputVal] = useState('120')
  const tapTimesRef = useRef<number[]>([])
  // Effective BPM = detected bpm (from analysis) ?? user-set master
  // Used for metronome, count-in, and bar ruler labels.
  const effectiveBpmRef = useRef(120)

  // Metronome
  const [metronomeOn, setMetronomeOn] = useState(false)
  const metronomeOnRef = useRef(false)
  useEffect(() => { metronomeOnRef.current = metronomeOn }, [metronomeOn])

  // Count-in (bars before recording starts)
  const [countIn, setCountIn] = useState(false)
  const [countingIn, setCountingIn] = useState(false)
  const [countInBeat, setCountInBeat] = useState(0) // 1-based beat display

  // A/B loop
  const [abLoop, setAbLoop] = useState<{ start: number; end: number } | null>(null)
  const [abLoopEnabled, setAbLoopEnabled] = useState(false)
  const abLoopRef = useRef<{ start: number; end: number } | null>(null)
  const abLoopEnabledRef = useRef(false)
  useEffect(() => { abLoopRef.current = abLoop }, [abLoop])
  useEffect(() => { abLoopEnabledRef.current = abLoopEnabled }, [abLoopEnabled])

  // Keep effectiveBpm ref current
  useEffect(() => {
    effectiveBpmRef.current = bpm ?? masterBpm
    setBpmInputVal(String(bpm ?? masterBpm))
  }, [bpm, masterBpm])

  function tapTempo() {
    const now = performance.now()
    const taps = tapTimesRef.current
    // Reset if last tap was more than 2 seconds ago
    if (taps.length > 0 && now - taps[taps.length - 1] > 2000) taps.length = 0
    taps.push(now)
    if (taps.length > 8) taps.shift()
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i])
      const avg = intervals.reduce((a, b) => a + b) / intervals.length
      const newBpm = Math.round(60000 / avg)
      if (newBpm >= 20 && newBpm <= 300) {
        setMasterBpm(newBpm)
        setBpm(newBpm)
      }
    }
  }

  function commitBpmEdit(raw: string) {
    const n = parseInt(raw, 10)
    if (n >= 20 && n <= 300) { setMasterBpm(n); setBpm(n) }
    setBpmEditing(false)
  }

  // ── Tier-2 mixer ─────────────────────────────────────────────────────────────
  const [lanePans,   setLanePans]   = useState<Record<string, number>>({})
  const [soloedLanes, setSoloedLanes] = useState<Set<string>>(new Set())
  const [laneReverb, setLaneReverb] = useState<Record<string, number>>({})
  const [laneDelay,  setLaneDelay]  = useState<Record<string, number>>({})
  const [masterVolume, setMasterVolume] = useState(1.0)

  const lanePansRef    = useRef<Record<string, number>>({})
  const soloedLanesRef = useRef<Set<string>>(new Set())
  const laneReverbRef  = useRef<Record<string, number>>({})
  const laneDelayRef   = useRef<Record<string, number>>({})
  const masterVolumeRef = useRef(1.0)
  const masterGainNodeRef = useRef<GainNode | null>(null)

  useEffect(() => { lanePansRef.current    = lanePans },    [lanePans])
  useEffect(() => { soloedLanesRef.current = soloedLanes }, [soloedLanes])
  useEffect(() => { laneReverbRef.current  = laneReverb },  [laneReverb])
  useEffect(() => { laneDelayRef.current   = laneDelay },   [laneDelay])
  useEffect(() => { masterVolumeRef.current = masterVolume; if (masterGainNodeRef.current) masterGainNodeRef.current.gain.setTargetAtTime(masterVolume, audioCtxRef.current?.currentTime ?? 0, 0.02) }, [masterVolume])

  // ── Tier 4: Per-lane FX chain ─────────────────────────────────────────────
  const [laneEffects, setLaneEffects] = useState<Record<string, LaneEffect[]>>({})
  const laneEffectsRef = useRef<Record<string, LaneEffect[]>>({})
  useEffect(() => { laneEffectsRef.current = laneEffects }, [laneEffects])
  const [fxOpenLanes, setFxOpenLanes] = useState<Set<string>>(new Set())
  const [fxAddOpen, setFxAddOpen] = useState<string | null>(null)  // laneType with open "add" dropdown

  // ── Polyrhythm: per-lane loop length in beats (default = global loop = 0) ──
  const [laneLoopBeats, setLaneLoopBeats] = useState<Record<string, number>>({}) // 0 = follow global
  const laneLoopBeatsRef = useRef<Record<string, number>>({})
  useEffect(() => { laneLoopBeatsRef.current = laneLoopBeats }, [laneLoopBeats])

  // ── Tier 5: Automation lanes ────────────────────────────────────────────────
  const [automLanes, setAutomLanes] = useState<AutomLaneDef[]>([])
  const automLanesRef = useRef<AutomLaneDef[]>([])
  useEffect(() => { automLanesRef.current = automLanes }, [automLanes])
  const [automOpenLanes, setAutomOpenLanes] = useState<Set<string>>(new Set())
  const [automAddOpen, setAutomAddOpen] = useState<string | null>(null)

  function addAutomLane(laneType: string, param: AutomParam) {
    captureHistory()
    setAutomLanes(prev => [...prev, { id: Math.random().toString(36).slice(2), laneType, param, points: [] }])
    setAutomAddOpen(null)
  }
  function removeAutomLane(id: string) {
    captureHistory()
    setAutomLanes(prev => prev.filter(a => a.id !== id))
  }
  function addAutomPoint(automId: string, pt: AutomPoint) {
    captureHistory()
    setAutomLanes(prev => prev.map(a => a.id === automId ? { ...a, points: [...a.points, pt] } : a))
  }
  function updateAutomPoint(automId: string, ptId: string, update: Partial<AutomPoint>) {
    setAutomLanes(prev => prev.map(a => a.id === automId ? { ...a, points: a.points.map(p => p.id === ptId ? { ...p, ...update } : p) } : a))
  }
  function deleteAutomPoint(automId: string, ptId: string) {
    captureHistory()
    setAutomLanes(prev => prev.map(a => a.id === automId ? { ...a, points: a.points.filter(p => p.id !== ptId) } : a))
  }

  function addLaneEffect(laneType: string, type: LaneEffectType) {
    captureHistory()
    const fx: LaneEffect = { id: Math.random().toString(36).slice(2), type, enabled: true, params: { ...LANE_EFFECT_DEFAULTS[type] } }
    setLaneEffects(prev => ({ ...prev, [laneType]: [...(prev[laneType] ?? []), fx] }))
    setFxAddOpen(null)
  }
  function removeLaneEffect(laneType: string, id: string) {
    captureHistory()
    setLaneEffects(prev => ({ ...prev, [laneType]: (prev[laneType] ?? []).filter(f => f.id !== id) }))
  }
  function updateLaneEffect(laneType: string, id: string, update: Partial<LaneEffect>) {
    setLaneEffects(prev => ({ ...prev, [laneType]: (prev[laneType] ?? []).map(f => f.id === id ? { ...f, ...update } : f) }))
  }
  function updateLaneEffectParam(laneType: string, id: string, key: string, val: number) {
    setLaneEffects(prev => ({ ...prev, [laneType]: (prev[laneType] ?? []).map(f => f.id === id ? { ...f, params: { ...f.params, [key]: val } } : f) }))
  }

  function toggleSolo(laneType: string) {
    setSoloedLanes(prev => {
      const next = new Set(prev)
      if (next.has(laneType)) next.delete(laneType); else next.add(laneType)
      soloedLanesRef.current = next
      return next
    })
  }

  function playMetronomeClick(ctx: AudioContext, when: number, accent: boolean) {
    const osc = ctx.createOscillator()
    const g   = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = accent ? 1500 : 1000
    g.gain.setValueAtTime(accent ? 0.5 : 0.3, when)
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.04)
    osc.connect(g); g.connect(ctx.destination)
    osc.start(when); osc.stop(when + 0.05)
  }

  // ── Undo / Redo ──────────────────────────────────────────────────────────────
  interface HistorySnapshot {
    hits: BeatHit[]
    laneEffects: Record<string, LaneEffect[]>
    lanePans: Record<string, number>
    automLanes: AutomLaneDef[]
    locators: Locator[]
    typeOverrides: TypeOverrides
    groupDefs: GroupDef[]
  }
  const historyRef    = useRef<HistorySnapshot[]>([])
  const historyIdxRef = useRef(-1)

  function captureHistory() {
    const snap: HistorySnapshot = {
      hits: [...hits],
      laneEffects: Object.fromEntries(Object.entries(laneEffects).map(([k, v]) => [k, [...v]])),
      lanePans: { ...lanePans },
      automLanes: automLanes.map(a => ({ ...a, points: [...a.points] })),
      locators: [...locators],
      typeOverrides: { ...typeOverrides },
      groupDefs: groupDefsRef.current.map(g => ({ ...g, childTypes: [...g.childTypes] })),
    }
    historyRef.current = historyRef.current.slice(0, historyIdxRef.current + 1)
    historyRef.current.push(snap)
    if (historyRef.current.length > 60) historyRef.current.shift()
    else historyIdxRef.current++
  }

  function applySnapshot(snap: HistorySnapshot) {
    setHits(snap.hits)
    setLaneEffects(snap.laneEffects)
    setLanePans(snap.lanePans)
    setAutomLanes(snap.automLanes)
    setLocators(snap.locators)
    setTypeOverrides(snap.typeOverrides)
    if (snap.groupDefs) setGroupDefs(snap.groupDefs)
  }

  function undo() {
    if (historyIdxRef.current <= 0) return
    historyIdxRef.current--
    applySnapshot(historyRef.current[historyIdxRef.current])
  }

  function redo() {
    if (historyIdxRef.current >= historyRef.current.length - 1) return
    historyIdxRef.current++
    applySnapshot(historyRef.current[historyIdxRef.current])
  }

  // ── UI: command palette, file menu, mini lanes, spectrum lanes ──────────────
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false)
  const [showFileMenu,   setShowFileMenu]   = useState(false)
  const [showEditMenu,   setShowEditMenu]   = useState(false)
  const [miniLanes,      setMiniLanes]      = useState<Set<string>>(new Set())
  const [exportingStems,    setExportingStems]    = useState(false)
  const [snapshotPanelOpen, setSnapshotPanelOpen] = useState(false)
  const [snapshots,         setSnapshots]         = useState<import('@/lib/snapshot-store').SnapshotEntry[]>([])
  const [snapshotName,      setSnapshotName]      = useState('')
  const [savingSnapshot,    setSavingSnapshot]    = useState(false)
  const [loadingSnapshots,  setLoadingSnapshots]  = useState(false)
  const [specLanes,      setSpecLanes]      = useState<Set<string>>(new Set())

  // Cross-lane drag-select
  interface SelBox { x1: number; y1: number; x2: number; y2: number }
  const [globalSelBox, setGlobalSelBox] = useState<SelBox | null>(null)
  const laneRowsRef = useRef<HTMLDivElement>(null)

  function startGlobalDrag(e: React.MouseEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const target = e.target as HTMLElement
    if (!target.closest('[data-hit-area]')) return   // only on lane backgrounds

    const container = laneRowsRef.current
    if (!container) return

    const cRect = container.getBoundingClientRect()
    const snapScrollTop  = () => container.scrollTop

    const toX = (clientX: number) => clientX - cRect.left
    const toY = (clientY: number) => clientY - cRect.top + snapScrollTop()

    const startX = toX(e.clientX)
    const startY = toY(e.clientY)

    e.preventDefault()

    let box: SelBox = { x1: startX, y1: startY, x2: startX, y2: startY }
    let dragged = false

    const onMove = (me: MouseEvent) => {
      const x2 = toX(me.clientX)
      const y2 = toY(me.clientY)
      if (!dragged && Math.hypot(x2 - startX, y2 - startY) < 5) return
      dragged = true
      box = { x1: startX, y1: startY, x2, y2 }
      setGlobalSelBox({ ...box })
    }

    const onUp = (me: MouseEvent) => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup',  onUp)
      setGlobalSelBox(null)

      if (!dragged) {
        if (!me.ctrlKey && !me.metaKey && !me.shiftKey) {
          setSelectedClipIds(new Set())
          setSelectedIds(new Set())
        }
        return
      }

      const pxPerSec = duration > 0 ? (timelinePx * zoomLevel) / duration : 1
      const t1 = Math.max(0, (Math.min(box.x1, box.x2) - HEADER_W) / pxPerSec)
      const t2 = Math.max(0, (Math.max(box.x1, box.x2) - HEADER_W) / pxPerSec)

      // Which hit areas overlap the selection rectangle vertically?
      const scrollTop = snapScrollTop()
      const rectTop    = cRect.top + Math.min(box.y1, box.y2) - scrollTop
      const rectBottom = cRect.top + Math.max(box.y1, box.y2) - scrollTop

      const lanesInBox = new Set<string>()
      document.querySelectorAll<HTMLElement>('[data-hit-area]').forEach(el => {
        const r = el.getBoundingClientRect()
        if (r.bottom > rectTop && r.top < rectBottom) {
          const lt = el.dataset.laneType
          if (lt) lanesInBox.add(lt)
        }
      })

      const additive = me.ctrlKey || me.metaKey || me.shiftKey

      const clipMatches = audioClips
        .filter(c => {
          const end = c.startTime + (c.stretchDuration ?? c.buf?.duration ?? 0)
          return lanesInBox.has(c.laneType) && c.startTime < t2 && end > t1
        })
        .map(c => c.id)

      const hitMatches = hits
        .filter(h => lanesInBox.has(h.type) && h.time >= t1 && h.time <= t2)
        .map(h => h.id)

      setSelectedClipIds(prev => {
        const next = additive ? new Set(prev) : new Set<string>()
        clipMatches.forEach(id => next.add(id))
        return next
      })
      setSelectedIds(prev => {
        const next = additive ? new Set(prev) : new Set<string>()
        hitMatches.forEach(id => next.add(id))
        return next
      })
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup',  onUp)
  }

  function toggleMiniLane(type: string) {
    setMiniLanes(prev => { const s = new Set(prev); s.has(type) ? s.delete(type) : s.add(type); return s })
  }
  function toggleSpecLane(type: string) {
    setSpecLanes(prev => { const s = new Set(prev); s.has(type) ? s.delete(type) : s.add(type); return s })
  }

  // ── Project save / load ───────────────────────────────────────────────────
  function saveProject() {
    const state = {
      version: '1.0',
      hits, laneEffects, lanePans, laneReverb, laneDelay,
      automLanes, typeOverrides, locators, bpm, masterVolume,
      quantizeSwing, sessionClips, extraLaneIds, groupDefs,
    }
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'beatlab-project.json'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  function loadProjectFromFile(file: File) {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const s = JSON.parse(e.target?.result as string)
        captureHistory()
        if (s.hits)         setHits(s.hits)
        if (s.laneEffects)  setLaneEffects(s.laneEffects)
        if (s.lanePans)     setLanePans(s.lanePans)
        if (s.laneReverb)   setLaneReverb(s.laneReverb)
        if (s.laneDelay)    setLaneDelay(s.laneDelay)
        if (s.automLanes)   setAutomLanes(s.automLanes)
        if (s.typeOverrides) setTypeOverrides(s.typeOverrides)
        if (s.locators)     setLocators(s.locators)
        if (s.bpm != null)  { setBpm(s.bpm); setMasterBpm(s.bpm ?? 120) }
        if (s.masterVolume != null) setMasterVolume(s.masterVolume)
        if (s.quantizeSwing != null) setQuantizeSwing(s.quantizeSwing)
        if (s.sessionClips)  setSessionClips(s.sessionClips)
        if (s.extraLaneIds)  setExtraLaneIds(s.extraLaneIds)
        if (s.groupDefs)     setGroupDefs(s.groupDefs as GroupDef[])
      } catch { /* ignore bad files */ }
    }
    reader.readAsText(file)
  }

  // Project-scoped autosave key.
  // Saved projects restore from their server projectId slot.
  // Unsaved (new) projects get a unique key per mount so they never inherit old autosave data.
  const localSessionId = useRef(`local-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const autosaveKey = `beatlab-autosave-${projectId ?? localSessionId.current}`

  // ── Named project snapshots ───────────────────────────────────────────────
  async function loadSnapshots() {
    setLoadingSnapshots(true)
    const { snapshotGetAll } = await import('@/lib/snapshot-store')
    const all = await snapshotGetAll().catch(() => [])
    setSnapshots(all)
    setLoadingSnapshots(false)
  }

  async function saveSnapshot(name: string) {
    if (!name.trim()) return
    setSavingSnapshot(true)
    try {
      const { snapshotSave } = await import('@/lib/snapshot-store')
      const audioClipsMeta = audioClips.map(c => ({
        id: c.id, laneType: c.laneType, startTime: c.startTime, muted: c.muted, name: c.name,
        gain: c.gain, stretchDuration: c.stretchDuration, loopDuration: c.loopDuration,
        gateThreshold: c.gateThreshold, fadeIn: c.fadeIn, fadeOut: c.fadeOut,
        color: c.color, reversed: c.reversed, warpMarkers: c.warpMarkers, gainEnvelope: c.gainEnvelope,
      }))
      await snapshotSave({
        id:        crypto.randomUUID(),
        name:      name.trim(),
        createdAt: new Date().toISOString(),
        state: {
          version: '1.0', hits, laneEffects, lanePans, laneReverb, laneDelay,
          automLanes, typeOverrides, locators, bpm: bpm ?? masterBpm, masterVolume, quantizeSwing,
          sessionClips, extraLaneIds, groupDefs, audioClipsMeta,
        },
      })
      await loadSnapshots()
      setSnapshotName('')
      showToast(`Snapshot "${name.trim()}" saved`)
    } finally {
      setSavingSnapshot(false)
    }
  }

  async function restoreSnapshot(entry: import('@/lib/snapshot-store').SnapshotEntry) {
    if (!confirm(`Restore snapshot "${entry.name}"? Current unsaved changes will be lost.`)) return
    captureHistory()
    const s = entry.state
    if (s.hits)          setHits(s.hits as typeof hits)
    if (s.laneEffects)   setLaneEffects(s.laneEffects as typeof laneEffects)
    if (s.lanePans)      setLanePans(s.lanePans as typeof lanePans)
    if (s.laneReverb)    setLaneReverb(s.laneReverb as typeof laneReverb)
    if (s.laneDelay)     setLaneDelay(s.laneDelay as typeof laneDelay)
    if (s.automLanes)    setAutomLanes(s.automLanes as typeof automLanes)
    if (s.typeOverrides) setTypeOverrides(s.typeOverrides as typeof typeOverrides)
    if (s.locators)      setLocators(s.locators as typeof locators)
    if (s.bpm != null)   { setBpm(s.bpm); setMasterBpm(s.bpm) }
    if (s.masterVolume != null) setMasterVolume(s.masterVolume)
    if (s.sessionClips)  setSessionClips(s.sessionClips as typeof sessionClips)
    if (s.extraLaneIds)  setExtraLaneIds(s.extraLaneIds)
    if (s.groupDefs)     setGroupDefs(s.groupDefs as typeof groupDefs)
    showToast(`Restored "${entry.name}"`)
    setSnapshotPanelOpen(false)
  }

  async function deleteSnapshot(id: string) {
    const { snapshotDelete } = await import('@/lib/snapshot-store')
    await snapshotDelete(id)
    await loadSnapshots()
  }

  // Restore audio clips from IndexedDB on mount
  useEffect(() => {
    async function restoreClips() {
      if (!autosaveKey) return
      try {
        const raw = typeof window !== 'undefined' ? localStorage.getItem(autosaveKey) : null
        if (!raw) return
        const s = JSON.parse(raw) as Record<string, unknown>
        const meta = s.audioClipsMeta
        if (!Array.isArray(meta) || meta.length === 0) return
        const idbClips = await loadAllClips()
        type ClipMeta = {
          id: string; laneType: string; startTime: number; muted: boolean; name: string
          gain: number; stretchDuration: number | null; loopDuration: number | null
          gateThreshold: number; fadeIn: number; fadeOut: number; color: string | null
          reversed: boolean; warpMarkers: WarpMarker[]; gainEnvelope?: { t: number; v: number }[]
        }
        const restored: AudioClip[] = []
        for (const m of meta as ClipMeta[]) {
          const entry = idbClips.get(m.id)
          if (!entry) continue
          restored.push({
            id: m.id, laneType: m.laneType, buf: entry.buf,
            startTime: m.startTime ?? 0, muted: m.muted ?? false, name: m.name ?? 'Voice',
            gain: m.gain ?? 1, stretchDuration: m.stretchDuration ?? null,
            loopDuration: m.loopDuration ?? null, gateThreshold: m.gateThreshold ?? 0,
            originalBuf: entry.originalBuf ?? null, fadeIn: m.fadeIn ?? 0, fadeOut: m.fadeOut ?? 0,
            color: m.color ?? null, reversed: m.reversed ?? false,
            warpMarkers: m.warpMarkers ?? [], gainEnvelope: m.gainEnvelope,
          })
          savedClipBufsRef.current.set(m.id, entry.buf)
        }
        if (restored.length > 0) setAudioClips(restored)
      } catch { /* ignore — degrade gracefully */ }
    }
    restoreClips()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save to localStorage (debounced 2s, project-scoped — skipped for new projects)
  useEffect(() => {
    if (!autosaveKey) return
    const t = setTimeout(() => {
      try {
        const audioClipsMeta = audioClips.map(c => ({
          id: c.id, laneType: c.laneType, startTime: c.startTime, name: c.name,
          muted: c.muted, gain: c.gain, stretchDuration: c.stretchDuration,
          loopDuration: c.loopDuration, gateThreshold: c.gateThreshold,
          fadeIn: c.fadeIn, fadeOut: c.fadeOut, color: c.color,
          reversed: c.reversed, warpMarkers: c.warpMarkers, gainEnvelope: c.gainEnvelope,
        }))
        localStorage.setItem(autosaveKey, JSON.stringify({ hits, laneEffects, lanePans, automLanes, locators, typeOverrides, bpm, masterVolume, quantizeSwing, audioClipsMeta }))
      } catch { /* quota exceeded */ }
    }, 2000)
    return () => clearTimeout(t)
  }, [hits, laneEffects, lanePans, automLanes, locators, typeOverrides, bpm, masterVolume, quantizeSwing, audioClips, autosaveKey]) // eslint-disable-line

  // ── Audio clip IndexedDB persistence ──────────────────────────────────────
  const savedClipBufsRef = useRef<Map<string, AudioBuffer>>(new Map())
  useEffect(() => {
    for (const clip of audioClips) {
      if (savedClipBufsRef.current.get(clip.id) !== clip.buf) {
        savedClipBufsRef.current.set(clip.id, clip.buf)
        saveClip(clip.id, clip.buf, clip.originalBuf).catch(() => {})
      }
    }
    const currentIds = new Set(audioClips.map(c => c.id))
    const toDelete: string[] = []
    for (const id of savedClipBufsRef.current.keys()) {
      if (!currentIds.has(id)) toDelete.push(id)
    }
    for (const id of toDelete) {
      savedClipBufsRef.current.delete(id)
      deleteClip(id).catch(() => {})
    }
  }, [audioClips])

  // ── Humanizer ────────────────────────────────────────────────────────────────
  function humanizeHits(amount = 0.5) {
    captureHistory()
    const grid = bpm ? 60 / bpm / 4 : 0.05
    const maxJitter = grid * 0.5 * amount
    setHits(prev => prev.map(h => ({
      ...h,
      time: Math.max(0, h.time + (Math.random() - 0.5) * 2 * maxJitter),
      velocity: Math.max(0.1, Math.min(1, h.velocity + (Math.random() - 0.5) * 0.3 * amount)),
    })).sort((a, b) => a.time - b.time))
  }

  const recorderRef    = useRef<MediaRecorder | null>(null)
  const startedSongRef = useRef(false)
  const chunksRef    = useRef<Blob[]>([])
  const recTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const playRafRef   = useRef<number>(0)
  const playStartRef = useRef<{ wallTime: number; beatTime: number } | null>(null)
  const laneAnalysersRef = useRef<Map<string, AnalyserNode>>(new Map())
  const levelBufRef      = useRef(new Float32Array(512))
  const levelFrameRef    = useRef(0)
  const [laneLevels, setLaneLevels] = useState<Record<string, number>>({})
  const durationRef  = useRef(duration)
  const loopSrcRef   = useRef<AudioBufferSourceNode | null>(null)
  const loopCtxRef   = useRef<AudioContext | null>(null)
  // Callback ref so the ResizeObserver re-attaches when the element moves from
  // the toolbar into the portal — a plain useRef only observed the first element,
  // and the browser fires a 0-width update when that element unmounts, making
  // pxWidth go negative and the playhead move right-to-left.
  const [timelineEl, setTimelineEl] = useState<HTMLDivElement | null>(null)
  const timelineRef = useCallback((el: HTMLDivElement | null) => setTimelineEl(el), [])
  const [timelinePx, setTimelinePx] = useState(800)

  // Keep durationRef current so the RAF closure doesn't stale-capture duration
  useEffect(() => { durationRef.current = duration }, [duration])

  // ── Keyboard shortcuts ───────────────────────────────────────────────────
  const selectedClipIdsRef = useRef<Set<string>>(new Set())
  useEffect(() => { selectedClipIdsRef.current = selectedClipIds }, [selectedClipIds])
  const audioClipsRef = useRef<AudioClip[]>([])
  useEffect(() => { audioClipsRef.current = audioClips }, [audioClips])
  const isPlayingRef = useRef(false)
  useEffect(() => { isPlayingRef.current = isPlaying }, [isPlaying])
  const playheadKbRef = useRef(0)
  useEffect(() => { playheadKbRef.current = playhead }, [playhead])
  const togglePlayRef = useRef<() => void>(() => {})
  togglePlayRef.current = () => { if (isPlaying) stopPlayback(); else startPlayback() }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const inInput = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (e.code === 'Space' && !inInput) {
        // Only claim Space when BeatLab has content or is actively playing;
        // otherwise AudioEditor's song transport handles it.
        if (!isPlayingRef.current && hitsRef.current.length === 0 && audioClipsRef.current.length === 0) return
        e.preventDefault()
        e.stopImmediatePropagation()
        togglePlayRef.current()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && !inInput) {
        const ids = selectedClipIdsRef.current
        const copied = audioClipsRef.current.filter(c => ids.has(c.id))
        if (copied.length) clipboardRef.current = copied
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyV' && !inInput) {
        e.preventDefault()
        const clips = clipboardRef.current
        if (!clips.length) return
        const minStart = Math.min(...clips.map(c => c.startTime))
        const offset   = playheadKbRef.current - minStart
        setAudioClips(prev => [...prev, ...clips.map(c => ({ ...c, id: crypto.randomUUID(), startTime: Math.max(0, c.startTime + offset) }))])
        return
      }
      if ((e.code === 'Delete' || e.code === 'Backspace') && !inInput && selectedClipIdsRef.current.size > 0) {
        const ids = selectedClipIdsRef.current
        setAudioClips(prev => prev.filter(c => !ids.has(c.id)))
        setSelectedClipIds(new Set())
        return
      }
      // T → tap tempo
      if (e.code === 'KeyT' && !inInput) { tapTempo(); return }
      // S → solo active lane
      if (e.code === 'KeyS' && !inInput) { if (activeLaneType) toggleSolo(activeLaneType); return }
      // Cmd+Z → undo, Cmd+Shift+Z / Cmd+Y → redo
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
      if (((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) || ((e.metaKey || e.ctrlKey) && e.key === 'y')) { e.preventDefault(); redo(); return }
      // Cmd+K → command palette
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setCmdPaletteOpen(v => !v); return }
      // I → inspector panel
      if (e.key === 'i' && !inInput && !e.metaKey && !e.ctrlKey) { setInspectorOpen(v => !v); return }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, []) // stable — reads from refs

  // 88px = 64px lane label + 24px note axis
  useEffect(() => {
    if (!timelineEl) return
    const ro = new ResizeObserver(([e]) => setTimelinePx(e.contentRect.width - HEADER_W))
    ro.observe(timelineEl)
    return () => ro.disconnect()
  }, [timelineEl])

  // Cancel RAF on unmount to avoid dangling callbacks
  useEffect(() => () => cancelAnimationFrame(playRafRef.current), [])
  // ── Recording ──────────────────────────────────────────────────────────────

  async function startRecording() {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false })
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg' })
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.start(100)
      recorderRef.current = recorder
      setPhase('recording')
      setRecordingTime(0)
      recTimerRef.current = setInterval(() => setRecordingTime(t => t + 0.1), 100)
      if (playSongDuringRec && onRequestSongPlay && !startedSongRef.current) {
        onRequestSongPlay()
        startedSongRef.current = true
      }
    } catch {
      setError('Microphone access denied.')
    }
  }

  // Shared analysis pipeline — called from both stopRecording() and stem URL analysis.
  async function runAnalysis(buf: AudioBuffer, isStem = false) {
    if (recMode === 'loop') {
      const result = await analyzeBeats(buf, { allowedTypes: ['kick', 'snare'], stemMode: isStem })
      const detectedBpm = result.bpm ?? 120
      setLoopBuffer(buf)
      setLoopDetectedBpm(detectedBpm)
      setLoopTargetBpm(detectedBpm)
      setLoopPlaying(false)
      setPhase('editing')
    } else {
      const allowed = selectedTypes.size > 0 ? Array.from(selectedTypes) : undefined
      const result = await analyzeBeats(buf, { allowedTypes: allowed, referenceSounds, stemMode: isStem })
      setAudioBuf(buf)
      setAnalysis(result)
      setHits(result.hits)
      setBpm(result.bpm)
      setDuration(result.duration)
      setPlayhead(0)
      setMutedTypes(new Set())
      setAiSuggestions(null)
      setPhase('editing')
      if (result.hits.some(h => h.spectral)) {
        setAiLoading(true)
        aiClassifyHits(result.hits, allowed ?? [], groundTruth.trim() || undefined).then(aiResult => {
          if (aiResult) {
            setAiSuggestions(aiResult.suggestions.size > 0 ? aiResult.suggestions : null)
            setAiDeletions(aiResult.deletions)
          } else {
            setAiSuggestions(null)
            setAiDeletions(new Set())
          }
          setAiLoading(false)
        })
      }
    }
  }

  async function stopRecording() {
    const recorder = recorderRef.current
    if (!recorder) return
    if (recTimerRef.current) clearInterval(recTimerRef.current)
    if (startedSongRef.current) {
      onRequestSongStop?.()
      startedSongRef.current = false
    }
    setPhase('analyzing')
    recorder.stop()
    recorder.stream.getTracks().forEach(t => t.stop())
    await new Promise<void>(res => { recorder.onstop = () => res() })
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type ?? 'audio/webm' })
    try {
      const buf = await decodeAudio(blob)
      await runAnalysis(buf, false)
    } catch {
      setError('Could not analyze audio. Try again with a clearer beatbox.')
      setPhase('idle')
    }
  }

  // Stem URL analysis — triggered by parent passing analyzeStemUrl prop
  const prevStemUrlRef = useRef<string | null>(null)
  useEffect(() => {
    if (!analyzeStemUrl || analyzeStemUrl === prevStemUrlRef.current) return
    prevStemUrlRef.current = analyzeStemUrl
    async function analyzeFromUrl() {
      setError(null)
      setPhase('analyzing')
      try {
        const res = await fetch(analyzeStemUrl!)
        if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
        const ab  = await res.arrayBuffer()
        const ctx = new AudioContext()
        const buf = await ctx.decodeAudioData(ab)
        await ctx.close()
        await runAnalysis(buf, true)
      } catch {
        setError('Could not analyze stem. Make sure the URL is accessible.')
        setPhase('idle')
      } finally {
        onStemAnalyzed?.()
      }
    }
    void analyzeFromUrl()
  }, [analyzeStemUrl]) // eslint-disable-line

  // ── Playback ───────────────────────────────────────────────────────────────

  function getAudioCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') audioCtxRef.current = new AudioContext()
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  function interpAutom(sorted: AutomPoint[], t: number, def: number): number {
    if (sorted.length === 0) return def
    if (t <= sorted[0].time) return sorted[0].value
    if (t >= sorted[sorted.length - 1].time) return sorted[sorted.length - 1].value
    for (let i = 0; i < sorted.length - 1; i++) {
      const a = sorted[i], b = sorted[i + 1]
      if (t >= a.time && t <= b.time) {
        const frac = (t - a.time) / (b.time - a.time)
        return a.value + frac * (b.value - a.value)
      }
    }
    return def
  }

  function startPlaybackFrom(startFrom: number) {
    if (duration <= 0) return
    const ctx = getAudioCtx()
    const now = ctx.currentTime

    // ── Routing graph ────────────────────────────────────────────────────────
    // master gain → brickwall limiter → destination
    const masterGain = ctx.createGain()
    masterGain.gain.value = masterVolumeRef.current
    masterGainNodeRef.current = masterGain
    const masterLimiter = ctx.createDynamicsCompressor()
    masterLimiter.threshold.value = -0.3
    masterLimiter.knee.value      = 0
    masterLimiter.ratio.value     = 20
    masterLimiter.attack.value    = 0.001
    masterLimiter.release.value   = 0.1
    masterGain.connect(masterLimiter)
    masterLimiter.connect(ctx.destination)

    // reverb return
    const reverb = ctx.createConvolver()
    reverb.buffer = makeReverbIR(ctx)
    const reverbReturn = ctx.createGain(); reverbReturn.gain.value = 0.75
    reverb.connect(reverbReturn); reverbReturn.connect(masterGain)

    // delay return (8th-note, BPM-synced)
    const delayBeat = Math.min(1.9, Math.max(0.05, 60 / effectiveBpmRef.current / 2))
    const delay = ctx.createDelay(2.0); delay.delayTime.value = delayBeat
    const dlFb = ctx.createGain(); dlFb.gain.value = 0.35
    const delayReturn = ctx.createGain(); delayReturn.gain.value = 0.6
    delay.connect(dlFb); dlFb.connect(delay)     // feedback loop
    delay.connect(delayReturn); delayReturn.connect(masterGain)

    // per-lane panner + sends cache (created on first use per lane)
    // Build a Web Audio node pair (input + output) for a single FX slot
    function buildFxNodes(fx: LaneEffect): { in: AudioNode; out: AudioNode } | null {
      const p = fx.params
      switch (fx.type) {
        case 'eq3': {
          const low  = ctx.createBiquadFilter(); low.type  = 'lowshelf';  low.frequency.value  = 200;         low.gain.value  = p.low
          const mid  = ctx.createBiquadFilter(); mid.type  = 'peaking';   mid.frequency.value  = p.midFreq;   mid.Q.value = 0.8; mid.gain.value = p.mid
          const high = ctx.createBiquadFilter(); high.type = 'highshelf'; high.frequency.value = 4000;        high.gain.value = p.high
          low.connect(mid); mid.connect(high)
          return { in: low, out: high }
        }
        case 'comp': {
          const comp = ctx.createDynamicsCompressor()
          comp.threshold.value = p.threshold
          comp.ratio.value     = p.ratio
          comp.attack.value    = p.attack
          comp.release.value   = p.release
          comp.knee.value      = p.knee
          return { in: comp, out: comp }
        }
        case 'crush': {
          const bits  = Math.max(1, Math.min(16, Math.round(p.bits)))
          const steps = Math.pow(2, bits - 1)
          const curve = new Float32Array(2048)
          for (let i = 0; i < 2048; i++) {
            const x = i * 2 / 2047 - 1
            curve[i] = Math.round(x * steps) / steps
          }
          const ws = ctx.createWaveShaper(); ws.curve = curve; ws.oversample = 'none'
          return { in: ws, out: ws }
        }
        case 'reverb': {
          const wet = Math.max(0, Math.min(1, p.wet))
          const ir = makeReverbIR(ctx, p.decay ?? 2, 2)
          const conv = ctx.createConvolver(); conv.buffer = ir
          const dryG = ctx.createGain(); dryG.gain.value = 1 - wet
          const wetG = ctx.createGain(); wetG.gain.value = wet
          const inp  = ctx.createGain(); const out = ctx.createGain()
          inp.connect(dryG); dryG.connect(out)
          inp.connect(wetG); wetG.connect(conv); conv.connect(out)
          return { in: inp, out }
        }
        case 'delay': {
          const wet = Math.max(0, Math.min(1, p.wet))
          const dly = ctx.createDelay(5); dly.delayTime.value = Math.max(0.01, Math.min(5, p.time))
          const fb  = ctx.createGain(); fb.gain.value = Math.max(0, Math.min(0.95, p.feedback))
          dly.connect(fb); fb.connect(dly)
          const dryG = ctx.createGain(); dryG.gain.value = 1 - wet
          const wetG = ctx.createGain(); wetG.gain.value = wet
          const inp  = ctx.createGain(); const out = ctx.createGain()
          inp.connect(dryG); dryG.connect(out)
          inp.connect(wetG); wetG.connect(dly); dly.connect(out)
          return { in: inp, out }
        }
        case 'chorus': {
          const wet   = Math.max(0, Math.min(1, p.wet))
          const rate  = Math.max(0.1, p.rate ?? 1.2)
          const depth = Math.max(0.001, p.depth ?? 0.003)
          const baseDelay = Math.max(0.01, p.delay ?? 0.025)
          // Two detuned voices: LFO modulates delay time
          const inp = ctx.createGain(); const out = ctx.createGain()
          const dryG = ctx.createGain(); dryG.gain.value = 1 - wet
          const wetG = ctx.createGain(); wetG.gain.value = wet
          inp.connect(dryG); dryG.connect(out)
          for (const sign of [1, -1]) {
            const dly = ctx.createDelay(0.5); dly.delayTime.value = baseDelay
            const lfo = ctx.createOscillator(); lfo.frequency.value = rate * (sign > 0 ? 1 : 1.1)
            const lfoG = ctx.createGain(); lfoG.gain.value = depth
            lfo.connect(lfoG); lfoG.connect(dly.delayTime)
            lfo.start()
            inp.connect(wetG); wetG.connect(dly); dly.connect(out)
          }
          return { in: inp, out }
        }
        case 'phaser': {
          const wet   = Math.max(0, Math.min(1, p.wet))
          const rate  = Math.max(0.1, p.rate ?? 0.5)
          const depth = Math.max(100, p.depth ?? 1000)
          const inp = ctx.createGain(); const out = ctx.createGain()
          const dryG = ctx.createGain(); dryG.gain.value = 1 - wet
          const wetG = ctx.createGain(); wetG.gain.value = wet
          inp.connect(dryG); dryG.connect(out)
          // 4-stage allpass chain with LFO sweeping center frequency
          let prev: AudioNode = wetG
          const lfo = ctx.createOscillator(); lfo.frequency.value = rate
          const lfoG = ctx.createGain(); lfoG.gain.value = depth
          lfo.connect(lfoG); lfo.start()
          for (let i = 0; i < 4; i++) {
            const ap = ctx.createBiquadFilter(); ap.type = 'allpass'
            ap.frequency.value = 800 + i * 400
            ap.Q.value = 8
            lfoG.connect(ap.frequency)
            prev.connect(ap); prev = ap
          }
          ;(prev as AudioNode).connect(out)
          inp.connect(wetG)
          return { in: inp, out }
        }
        case 'flanger': {
          const wet      = Math.max(0, Math.min(1, p.wet))
          const rate     = Math.max(0.05, p.rate ?? 0.25)
          const depth    = Math.max(0.001, p.depth ?? 0.005)
          const baseD    = Math.max(0.001, p.delay ?? 0.005)
          const feedback = Math.max(0, Math.min(0.9, p.feedback ?? 0.5))
          const inp  = ctx.createGain(); const out = ctx.createGain()
          const dryG = ctx.createGain(); dryG.gain.value = 1 - wet
          const wetG = ctx.createGain(); wetG.gain.value = wet
          const dly  = ctx.createDelay(0.5); dly.delayTime.value = baseD
          const fbG  = ctx.createGain(); fbG.gain.value = feedback
          const lfo  = ctx.createOscillator(); lfo.frequency.value = rate
          const lfoG = ctx.createGain(); lfoG.gain.value = depth
          lfo.connect(lfoG); lfoG.connect(dly.delayTime); lfo.start()
          inp.connect(dryG); dryG.connect(out)
          inp.connect(wetG); wetG.connect(dly); dly.connect(out)
          dly.connect(fbG); fbG.connect(dly)
          return { in: inp, out }
        }
        case 'autofilter': {
          const filt = ctx.createBiquadFilter()
          filt.type = 'lowpass'
          filt.frequency.value = Math.max(80, p.freq ?? 800)
          filt.Q.value = Math.max(0.5, p.Q ?? 1.5)
          const lfo  = ctx.createOscillator(); lfo.frequency.value = Math.max(0.1, p.lfoRate ?? 1)
          const lfoG = ctx.createGain(); lfoG.gain.value = Math.max(0, p.lfoDepth ?? 600)
          lfo.connect(lfoG); lfoG.connect(filt.frequency); lfo.start()
          return { in: filt, out: filt }
        }
        case 'saturator': {
          const drive = Math.max(1, Math.min(20, p.drive ?? 3))
          const wet   = Math.max(0, Math.min(1, p.wet ?? 1))
          const curve = new Float32Array(2048)
          for (let i = 0; i < 2048; i++) {
            const x = (i * 2 / 2047 - 1) * drive
            curve[i] = Math.tanh(x) / Math.tanh(drive)
          }
          const ws   = ctx.createWaveShaper(); ws.curve = curve; ws.oversample = '4x'
          const inp  = ctx.createGain(); const out = ctx.createGain()
          const dryG = ctx.createGain(); dryG.gain.value = 1 - wet
          const wetG = ctx.createGain(); wetG.gain.value = wet
          inp.connect(dryG); dryG.connect(out)
          inp.connect(wetG); wetG.connect(ws); ws.connect(out)
          return { in: inp, out }
        }
        case 'lfo': {
          // Tremolo: LFO modulates gain
          const shapes: OscillatorType[] = ['sine', 'square', 'sawtooth']
          const rate  = Math.max(0.1, Math.min(20, p.rate ?? 2))
          const depth = Math.max(0, Math.min(1, p.depth ?? 0.6))
          const inp   = ctx.createGain(); inp.gain.value = 1
          const lfo   = ctx.createOscillator()
          lfo.type = shapes[Math.round(p.shape ?? 0)] ?? 'sine'
          lfo.frequency.value = rate
          // LFO output range: -depth..+depth, bias to 1-depth..1
          const lfoGain = ctx.createGain(); lfoGain.gain.value = depth * 0.5
          const bias    = ctx.createConstantSource(); bias.offset.value = 1 - depth * 0.5
          const ampMod  = ctx.createGain()
          lfo.connect(lfoGain); lfoGain.connect(ampMod.gain)
          bias.connect(ampMod.gain)
          inp.connect(ampMod)
          lfo.start(); bias.start()
          return { in: inp, out: ampMod }
        }
        case 'beatrepeat': {
          // Comb-filter stutter: delay + variable feedback
          const grid     = Math.max(0.03125, Math.min(1, p.grid ?? 0.125))
          const feedback = Math.max(0, Math.min(0.9, p.feedback ?? 0.5))
          const pitchSt  = p.pitch ?? 0
          const inp  = ctx.createGain()
          const dly  = ctx.createDelay(2); dly.delayTime.value = grid
          const fbGn = ctx.createGain(); fbGn.gain.value = feedback
          const out  = ctx.createGain()
          // Optional pitch shift via playback-rate trick: use a second delay at semitone offset
          const pitchRatio = Math.pow(2, pitchSt / 12)
          const pitchShift = ctx.createGain(); pitchShift.gain.value = pitchRatio
          inp.connect(out); inp.connect(dly)
          dly.connect(pitchShift); pitchShift.connect(fbGn); fbGn.connect(dly)
          dly.connect(out)
          return { in: inp, out }
        }
      }
    }

    const laneInputs    = new Map<string, GainNode>()
    const laneAutoGains = new Map<string, GainNode>()
    const sidechainConnections: Array<{ keyInput: AudioNode; sourceLaneType: string }> = []
    const lanePanners   = new Map<string, StereoPannerNode>()

    function getLaneInput(laneType: string): GainNode {
      if (laneInputs.has(laneType)) return laneInputs.get(laneType)!
      const input    = ctx.createGain()
      const autoGain = ctx.createGain(); autoGain.gain.value = 1  // automation target
      input.connect(autoGain)

      // FX insert chain
      let chainOut: AudioNode = autoGain
      for (const fx of laneEffectsRef.current[laneType] ?? []) {
        if (!fx.enabled) continue
        // comp with sidechain: use envelope-follower VCA instead of DynamicsCompressor
        if (fx.type === 'comp') {
          const scSrc = laneSidechainsRef.current[`${laneType}:${fx.id}`] ?? ''
          if (scSrc) {
            const proc = createSidechainProcessor(ctx, {
              threshold: fx.params.threshold ?? -24,
              ratio:     fx.params.ratio     ?? 4,
              attack:    fx.params.attack    ?? 0.003,
              release:   fx.params.release   ?? 0.25,
            })
            sidechainConnections.push({ keyInput: proc.keyInput, sourceLaneType: scSrc })
            chainOut.connect(proc.signalIn)
            chainOut = proc.signalOut
            continue
          }
        }
        const nodes = buildFxNodes(fx)
        if (nodes) { chainOut.connect(nodes.in); chainOut = nodes.out }
      }

      const panner  = ctx.createStereoPanner(); panner.pan.value = lanePansRef.current[laneType] ?? 0
      const revSend = ctx.createGain(); revSend.gain.value = laneReverbRef.current[laneType] ?? 0
      const dlySend = ctx.createGain(); dlySend.gain.value = laneDelayRef.current[laneType] ?? 0

      // Level meter — create or reuse AnalyserNode, insert between panner and master
      if (!laneAnalysersRef.current.has(laneType)) {
        const an = ctx.createAnalyser(); an.fftSize = 512; an.smoothingTimeConstant = 0.75
        laneAnalysersRef.current.set(laneType, an)
      }
      const analyser = laneAnalysersRef.current.get(laneType)!

      // Group bus routing: child lanes → group bus → master
      const groupForLane = groupDefsRef.current.find(g => g.childTypes.includes(laneType))
      let laneDest: AudioNode = masterGain
      if (groupForLane) {
        const gId = groupForLane.id
        if (!groupBusRef.current.has(gId)) {
          const bus = ctx.createGain()
          bus.gain.value = 1
          bus.connect(masterGain)
          groupBusRef.current.set(gId, bus)
        }
        laneDest = groupBusRef.current.get(gId)!
      }
      chainOut.connect(panner); panner.connect(analyser); analyser.connect(laneDest)
      chainOut.connect(revSend); revSend.connect(reverb)
      chainOut.connect(dlySend); dlySend.connect(delay)

      laneInputs.set(laneType, input)
      laneAutoGains.set(laneType, autoGain)
      lanePanners.set(laneType, panner)
      return input
    }

    const soloActive = soloedLanesRef.current.size > 0
    // ── Hits ─────────────────────────────────────────────────────────────────
    const kickTimes = hits.filter(h => h.type === 'kick' && !mutedTypes.has('kick')).map(h => h.time).sort((a, b) => a - b)
    const beatSec = bpm ? 60 / bpm : 0.5

    // Group hits by lane for polyrhythm repetition
    const hitsByLane = new Map<string, BeatHit[]>()
    for (const hit of hits) { const arr = hitsByLane.get(hit.type) ?? []; arr.push(hit); hitsByLane.set(hit.type, arr) }

    const scheduledHitTimes: { hit: BeatHit; absoluteTime: number }[] = []
    for (const [laneType, laneHits] of hitsByLane) {
      const loopBeats = laneLoopBeatsRef.current[laneType] ?? 0
      const loopSec   = loopBeats > 0 ? loopBeats * beatSec : 0 // 0 = no per-lane loop
      if (loopSec > 0) {
        // Repeat hits for each loop cycle within the global duration
        const cycles = Math.ceil((duration - startFrom) / loopSec)
        for (let c = 0; c < cycles; c++) {
          for (const hit of laneHits) {
            const absTime = hit.time + c * loopSec
            if (absTime >= startFrom - 0.01 && absTime < duration) {
              scheduledHitTimes.push({ hit, absoluteTime: absTime })
            }
          }
        }
      } else {
        for (const hit of laneHits) {
          if (hit.time >= startFrom - 0.01) scheduledHitTimes.push({ hit, absoluteTime: hit.time })
        }
      }
    }

    for (const { hit, absoluteTime } of scheduledHitTimes) {
      if (mutedTypes.has(hit.type)) continue
      if (soloActive && !soloedLanesRef.current.has(hit.type)) continue
      const when = Math.max(now, now + (absoluteTime - startFrom))
      const laneDest = getLaneInput(hit.type)

      const sampleBuf  = sampleBuffers.get(hit.type)
      const sampleRoot = sampleRoots.get(hit.type) ?? 60
      if (sampleBuf) {
        const src = ctx.createBufferSource()
        src.buffer = sampleBuf
        const targetNote = hit.note ?? sampleRoot
        src.playbackRate.value = Math.pow(2, (targetNote - sampleRoot) / 12)
        const gain = ctx.createGain(); gain.gain.value = hit.velocity
        src.connect(gain); gain.connect(laneDest)
        src.start(when)
      } else if (MELODIC_TYPES.has(hit.type)) {
        playMelodicNote(ctx, hit.type, hit.note, when, hit.velocity, laneDest)
      } else {
        const maxKickDur = hit.type === 'kick'
          ? (() => { const idx = kickTimes.indexOf(absoluteTime); const next = kickTimes[idx + 1] ?? Infinity; return Math.min(0.45, next - absoluteTime - 0.01) })()
          : 0.45
        playDrumHit(ctx, 'synth', hit.type, when, hit.velocity, hit.note, maxKickDur, laneDest)
      }
    }

    // ── Audio clips ───────────────────────────────────────────────────────────
    // Pre-build crossfade overlap map: for each clip, find overlapping clips on same lane
    type XFade = { inDur: number; outDur: number }
    const xfadeMap = new Map<string, XFade>()
    const visibleClips = audioClips.filter(c => !c.muted && !mutedTypes.has(c.laneType as BeatType) && !(soloActive && !soloedLanesRef.current.has(c.laneType)))
    for (let i = 0; i < visibleClips.length; i++) {
      const a = visibleClips[i]
      const aEnd = a.startTime + (a.loopDuration ?? a.stretchDuration ?? a.buf.duration)
      for (let j = i + 1; j < visibleClips.length; j++) {
        const b = visibleClips[j]
        if (b.laneType !== a.laneType) continue
        const bEnd = b.startTime + (b.loopDuration ?? b.stretchDuration ?? b.buf.duration)
        const overlapStart = Math.max(a.startTime, b.startTime)
        const overlapEnd   = Math.min(aEnd, bEnd)
        if (overlapEnd > overlapStart) {
          const xdur = overlapEnd - overlapStart
          const ax = xfadeMap.get(a.id) ?? { inDur: 0, outDur: 0 }
          xfadeMap.set(a.id, { inDur: ax.inDur, outDur: Math.max(ax.outDur, xdur) })
          const bx = xfadeMap.get(b.id) ?? { inDur: 0, outDur: 0 }
          xfadeMap.set(b.id, { inDur: Math.max(bx.inDur, xdur), outDur: bx.outDur })
        }
      }
    }

    for (const clip of visibleClips) {
      const effDur = clip.loopDuration ?? clip.stretchDuration ?? clip.buf.duration
      const clipEnd = clip.startTime + effDur
      if (clipEnd <= startFrom) continue

      // Gate processing
      let bufToPlay = clip.buf
      if (clip.gateThreshold > 0) {
        const sr = clip.buf.sampleRate
        const raw = clip.buf.getChannelData(0)
        const gated = new Float32Array(raw.length)
        const ramp = Math.floor(sr * 0.002)
        let holdLeft = 0
        let env = 0
        for (let i = 0; i < raw.length; i++) {
          if (Math.abs(raw[i]) >= clip.gateThreshold) holdLeft = Math.floor(sr * 0.020)
          else if (holdLeft > 0) holdLeft--
          const target = holdLeft > 0 || Math.abs(raw[i]) >= clip.gateThreshold ? 1 : 0
          env += (target - env) * (1 / ramp)
          gated[i] = raw[i] * env
        }
        bufToPlay = new AudioBuffer({ numberOfChannels: 1, length: raw.length, sampleRate: bufToPlay.sampleRate })
        bufToPlay.copyToChannel(gated, 0)
      }

      const peakGain = 0.82 * clip.gain
      const clipAudioStart = clip.startTime >= startFrom ? now + (clip.startTime - startFrom) : now
      const clipAudioEnd   = now + Math.max(0, clipEnd - startFrom)

      // Crossfade durations (auto-generated from overlap) merged with explicit fades
      const xf = xfadeMap.get(clip.id) ?? { inDur: 0, outDur: 0 }
      const fadeInDur  = Math.max(clip.fadeIn,  xf.inDur)
      const fadeOutDur = Math.max(clip.fadeOut, xf.outDur)

      // Warp markers: piecewise playback
      if (clip.warpMarkers.length > 0 && clip.loopDuration == null) {
        const markers: WarpMarker[] = [
          { bufFrac: 0, timeFrac: 0 },
          ...clip.warpMarkers.slice().sort((a, b) => a.timeFrac - b.timeFrac),
          { bufFrac: 1, timeFrac: 1 },
        ]
        const bufDur = bufToPlay.duration
        const playRate = clip.stretchDuration != null ? clip.buf.duration / clip.stretchDuration : 1

        for (let mi = 0; mi < markers.length - 1; mi++) {
          const m0 = markers[mi], m1 = markers[mi + 1]
          const segTimeDur  = (m1.timeFrac - m0.timeFrac) * effDur
          const segBufDur   = (m1.bufFrac  - m0.bufFrac)  * bufDur
          if (segTimeDur <= 0 || segBufDur <= 0) continue
          const segTimeStart = clip.startTime + m0.timeFrac * effDur
          const segTimeEnd   = segTimeStart + segTimeDur
          if (segTimeEnd <= startFrom) continue

          const segAudioStart = segTimeStart >= startFrom ? now + (segTimeStart - startFrom) : now
          const segAudioEnd   = now + Math.max(0, segTimeEnd - startFrom)
          const segRate = segBufDur / segTimeDur * playRate

          const src = ctx.createBufferSource()
          src.buffer = bufToPlay
          src.playbackRate.value = segRate
          const gn = ctx.createGain(); gn.gain.value = peakGain
          src.connect(gn); gn.connect(getLaneInput(clip.laneType))

          // Apply fade-in on first segment, fade-out on last
          if (mi === 0 && fadeInDur > 0 && clip.startTime >= startFrom) {
            gn.gain.setValueAtTime(0, segAudioStart)
            gn.gain.linearRampToValueAtTime(peakGain, segAudioStart + fadeInDur)
          }
          if (mi === markers.length - 2 && fadeOutDur > 0) {
            const foStart = Math.max(segAudioStart, segAudioEnd - fadeOutDur)
            gn.gain.setValueAtTime(peakGain, foStart)
            gn.gain.linearRampToValueAtTime(0, segAudioEnd)
          }

          const bufOffset = segTimeStart >= startFrom
            ? m0.bufFrac * bufDur
            : m0.bufFrac * bufDur + (startFrom - segTimeStart) * segRate
          src.start(segAudioStart, Math.min(bufOffset, bufDur - 0.001))
          src.stop(segAudioEnd)
        }
        continue
      }

      // Standard playback (no warp markers)
      const src = ctx.createBufferSource()
      src.buffer = bufToPlay
      const playRate = clip.stretchDuration != null ? clip.buf.duration / clip.stretchDuration : 1
      src.playbackRate.value = playRate
      if (clip.loopDuration != null) { src.loop = true; src.loopStart = 0; src.loopEnd = bufToPlay.duration }

      const gainNode = ctx.createGain()
      src.connect(gainNode)
      if (clip.gainEnvelope && clip.gainEnvelope.length >= 2) {
        const envGain = ctx.createGain(); envGain.gain.value = clip.gainEnvelope[0].v
        gainNode.connect(envGain); envGain.connect(getLaneInput(clip.laneType))
        const clipLen = clipAudioEnd - clipAudioStart
        for (const pt of clip.gainEnvelope)
          envGain.gain.setValueAtTime(pt.v, Math.max(ctx.currentTime, clipAudioStart + pt.t * clipLen))
      } else {
        gainNode.connect(getLaneInput(clip.laneType))
      }

      // Fade-in gain automation
      if (fadeInDur > 0 && clip.startTime >= startFrom) {
        gainNode.gain.setValueAtTime(0, clipAudioStart)
        gainNode.gain.linearRampToValueAtTime(peakGain, clipAudioStart + fadeInDur)
      } else {
        gainNode.gain.setValueAtTime(peakGain, clipAudioStart)
      }

      // Fade-out gain automation
      if (fadeOutDur > 0) {
        const foStart = Math.max(clipAudioStart, clipAudioEnd - fadeOutDur)
        gainNode.gain.setValueAtTime(peakGain, foStart)
        gainNode.gain.linearRampToValueAtTime(0, clipAudioEnd)
      }

      if (clip.startTime >= startFrom) {
        src.start(clipAudioStart, 0)
      } else {
        const elapsed = startFrom - clip.startTime
        const bufOffset = clip.loopDuration != null ? elapsed % bufToPlay.duration : elapsed * playRate
        src.start(now, Math.min(bufOffset, bufToPlay.duration - 0.001))
      }
      if (clip.loopDuration != null) src.stop(clipAudioEnd)
    }

    // ── Automation scheduling ─────────────────────────────────────────────────
    for (const al of automLanesRef.current) {
      if (al.points.length === 0) continue
      const sorted = al.points.slice().sort((a, b) => a.time - b.time)
      const [, max] = AUTOM_RANGE[al.param]

      if (al.param === 'volume') {
        const gn = laneAutoGains.get(al.laneType); if (!gn) continue
        // Determine value at startFrom via interpolation
        const initVal = interpAutom(sorted, startFrom, AUTOM_DEFAULT.volume)
        gn.gain.setValueAtTime(initVal, now)
        for (const pt of sorted) {
          if (pt.time <= startFrom) continue
          gn.gain.linearRampToValueAtTime(Math.max(0, Math.min(max, pt.value)), now + (pt.time - startFrom))
        }
      } else if (al.param === 'pan') {
        const pan = lanePanners.get(al.laneType); if (!pan) continue
        const initVal = interpAutom(sorted, startFrom, AUTOM_DEFAULT.pan)
        pan.pan.setValueAtTime(Math.max(-1, Math.min(1, initVal)), now)
        for (const pt of sorted) {
          if (pt.time <= startFrom) continue
          pan.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, pt.value)), now + (pt.time - startFrom))
        }
      }
    }

    // ── Sidechain tap connections ─────────────────────────────────────────────
    if (sidechainConnections.length > 0) {
      for (const { sourceLaneType } of sidechainConnections) {
        if (!laneInputs.has(sourceLaneType)) getLaneInput(sourceLaneType)
      }
      const sidechainTaps = new Map<string, GainNode>()
      for (const { keyInput, sourceLaneType } of sidechainConnections) {
        if (!sidechainTaps.has(sourceLaneType)) {
          const tap = ctx.createGain(); tap.gain.value = 1
          laneInputs.get(sourceLaneType)!.connect(tap)
          sidechainTaps.set(sourceLaneType, tap)
        }
        sidechainTaps.get(sourceLaneType)!.connect(keyInput)
      }
    }

    // Metronome: schedule click sounds at every beat position
    if (metronomeOnRef.current) {
      const ebpm    = effectiveBpmRef.current
      const beatSec = 60 / ebpm
      const firstBeat = Math.ceil((startFrom / beatSec) + 0.0001) * beatSec
      for (let t = firstBeat; t < duration + beatSec; t += beatSec) {
        if (t > duration + 0.1) break
        const when    = now + (t - startFrom)
        const beatNum = Math.round(t / beatSec)
        playMetronomeClick(ctx, Math.max(now, when), beatNum % 4 === 0)
      }
    }

    playStartRef.current = { wallTime: performance.now(), beatTime: startFrom }
    setIsPlaying(true)

    // Manage RAF directly — NOT via useEffect — so seeking while playing
    // always gets a fresh loop regardless of whether isPlaying state changed.
    cancelAnimationFrame(playRafRef.current)
    const tick = () => {
      if (!playStartRef.current) return
      const elapsed = (performance.now() - playStartRef.current.wallTime) / 1000
      const t = playStartRef.current.beatTime + elapsed

      // A/B loop: restart when playhead reaches loop end
      if (abLoopEnabledRef.current && abLoopRef.current && t >= abLoopRef.current.end) {
        startPlaybackFrom(abLoopRef.current.start)
        return
      }

      if (t >= durationRef.current) {
        playStartRef.current = null
        setIsPlaying(false)
        setPlayhead(0)
        groupBusRef.current.clear()
        laneAnalysersRef.current.clear()
        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
          audioCtxRef.current.close()
          audioCtxRef.current = null
        }
        return
      }
      setPlayhead(t)

      // Level meters — read analysers every 6th frame (~10fps) to avoid thrashing React
      levelFrameRef.current = (levelFrameRef.current + 1) % 6
      if (levelFrameRef.current === 0 && laneAnalysersRef.current.size > 0) {
        const levels: Record<string, number> = {}
        const buf = levelBufRef.current
        for (const [laneType, an] of laneAnalysersRef.current) {
          an.getFloatTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
          levels[laneType] = Math.sqrt(sum / buf.length)
        }
        setLaneLevels(levels)
      }

      playRafRef.current = requestAnimationFrame(tick)
    }
    playRafRef.current = requestAnimationFrame(tick)
  }

  function startPlayback() { startPlaybackFrom(playhead >= duration ? 0 : playhead) }

  function stopPlayback() {
    cancelAnimationFrame(playRafRef.current)
    setIsPlaying(false)
    playStartRef.current = null
    groupBusRef.current.clear()
    // AnalyserNodes are tied to their AudioContext — clear so next playback
    // creates fresh ones on the new context (reusing old nodes throws cross-context errors)
    laneAnalysersRef.current.clear()
    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      audioCtxRef.current.close()
      audioCtxRef.current = null
    }
  }

  function handleSeek(t: number) {
    const wasPlaying = isPlaying
    stopPlayback()
    setPlayhead(t)
    if (wasPlaying) startPlaybackFrom(t)
  }

  function togglePlay() { if (isPlaying) stopPlayback(); else startPlayback() }

  // ── Loop playback ─────────────────────────────────────────────────────────

  function startLoopPlayback() {
    if (!loopBuffer) return
    stopLoopPlayback()
    const ctx = new AudioContext()
    loopCtxRef.current = ctx
    const src = ctx.createBufferSource()
    src.buffer = loopBuffer
    src.loop = true
    if (loopDetectedBpm && loopTargetBpm) {
      src.playbackRate.value = loopTargetBpm / loopDetectedBpm
    }
    src.connect(ctx.destination)
    src.start()
    loopSrcRef.current = src
    src.onended = () => setLoopPlaying(false)
    setLoopPlaying(true)
  }

  function stopLoopPlayback() {
    loopSrcRef.current?.stop()
    loopSrcRef.current = null
    loopCtxRef.current?.close()
    loopCtxRef.current = null
    setLoopPlaying(false)
  }

  function updateLoopRate(targetBpm: number) {
    setLoopTargetBpm(targetBpm)
    if (loopSrcRef.current && loopDetectedBpm) {
      loopSrcRef.current.playbackRate.value = targetBpm / loopDetectedBpm
    }
  }

  // ── Hit editing ────────────────────────────────────────────────────────────

  const moveHit = useCallback((id: string, t: number, note: number) => {
    captureHistory()
    setHits(prev => prev.map(h => h.id === id ? { ...h, time: t, note } : h).sort((a, b) => a.time - b.time))
  }, []) // eslint-disable-line

  const deleteHit = useCallback((id: string) => {
    captureHistory()
    setHits(prev => prev.filter(h => h.id !== id))
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
  }, []) // eslint-disable-line

  // ── Hit property editing (from right-click context menu) ──────────────────
  const [hitMenu, setHitMenu] = useState<{ hitId: string; x: number; y: number } | null>(null)

  function changeHitType(id: string, newType: BeatType) {
    setHits(prev => prev.map(h => h.id !== id ? h : { ...h, type: newType }))
  }
  function changeHitVelocity(id: string, v: number) {
    setHits(prev => prev.map(h => h.id === id ? { ...h, velocity: v } : h))
  }
  function changeHitDuration(id: string, d: number) {
    setHits(prev => prev.map(h => h.id === id ? { ...h, duration: d } : h))
  }
  function changeHitNote(id: string, note: number) {
    setHits(prev => prev.map(h => h.id === id ? { ...h, note } : h))
  }

  // ── Phase change notification ─────────────────────────────────────────────
  useEffect(() => { onPhaseChange?.(phase) }, [phase]) // eslint-disable-line

  // ── Snap interval for quantized editing ──────────────────────────────────
  const snapInterval = bpm && bpm > 0 ? 60 / bpm / 4 : duration > 0 ? duration / 32 : 0

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (phase !== 'editing') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedIds.size > 0) {
        e.preventDefault()
        selectedIds.forEach(id => deleteHit(id))
        setSelectedIds(new Set())
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [phase, selectedIds, deleteHit])

  function selectHit(id: string, additive: boolean) {
    if (additive) {
      setSelectedIds(prev => { const n = new Set(prev); prev.has(id) ? n.delete(id) : n.add(id); return n })
    } else {
      setSelectedIds(new Set([id]))
    }
  }

  function addHit(type: BeatType, t: number, note: number) {
    captureHistory()
    const newHit: BeatHit = { id: crypto.randomUUID(), time: t, type, velocity: 0.7, note }
    setHits(prev => [...prev, newHit].sort((a, b) => a.time - b.time))
    setSelectedIds(new Set([newHit.id]))
  }

  function changeSelectedType(type: BeatType) {
    if (selectedIds.size === 0) return
    captureHistory()
    setHits(prev => prev.map(h => selectedIds.has(h.id) ? { ...h, type } : h))
    setShowTypeMenu(false)
  }

  function rejectAiForHit(hitId: string) {
    if (!aiSuggestions) return
    setAiSuggestions(prev => {
      if (!prev) return null
      const next = new Map(prev)
      next.delete(hitId)
      return next.size > 0 ? next : null
    })
  }

  function acceptAiDeleteForHit(hitId: string) {
    setHits(prev => prev.filter(h => h.id !== hitId))
    setAiDeletions(prev => { const next = new Set(prev); next.delete(hitId); return next })
    setSelectedIds(prev => { const n = new Set(prev); n.delete(hitId); return n })
  }

  function rejectAiDeleteForHit(hitId: string) {
    setAiDeletions(prev => { const next = new Set(prev); next.delete(hitId); return next })
  }

  function applyAiSuggestions() {
    if (!aiSuggestions && aiDeletions.size === 0) return
    const sixteenth = bpm ? (60 / bpm) / 4 : null
    const items: FeedbackItem[] = []
    const toDelete = new Set(aiDeletions)

    setHits(prev => {
      let updated = prev
        .filter(h => !toDelete.has(h.id))
        .map(h => {
          const suggested = aiSuggestions?.get(h.id)
          if (!suggested || suggested === h.type) return h
          items.push({ hitId: h.id, time: h.time, original: h.type, current: suggested, spectral: h.spectral })
          return { ...h, type: suggested }
        })
      if (sixteenth) {
        updated = updated.map(h => ({ ...h, time: Math.round(h.time / sixteenth) * sixteenth }))
      }
      return updated
    })
    setAiSuggestions(null)
    setAiDeletions(new Set())
    setReflection(null)
    if (items.length > 0) {
      setFeedbackItems(items)
      setFeedbackRetries(0)
    }
  }

  // Update a single feedback item's label (also updates the hit on the timeline)
  function updateFeedbackType(hitId: string, type: BeatType) {
    setFeedbackItems(prev => prev
      ? prev.map(f => f.hitId === hitId ? { ...f, current: type } : f)
      : prev
    )
    setHits(prev => prev.map(h => h.id === hitId ? { ...h, type } : h))
  }

  // Re-run AI on the current hit state and update feedback items
  async function retryAi() {
    if (!feedbackItems || feedbackLoading || feedbackRetries >= MAX_RETRIES) return
    setFeedbackLoading(true)
    try {
      const aiResult = await aiClassifyHits(hits, Array.from(selectedTypes), groundTruth.trim() || undefined)
      if (aiResult && (aiResult.suggestions.size > 0 || aiResult.deletions.size > 0)) {
        const sixteenth = bpm ? (60 / bpm) / 4 : null
        setHits(prev => {
          let updated = prev
            .filter(h => !aiResult.deletions.has(h.id))
            .map(h => {
              const s = aiResult.suggestions.get(h.id)
              return s ? { ...h, type: s } : h
            })
          if (sixteenth) updated = updated.map(h => ({ ...h, time: Math.round(h.time / sixteenth) * sixteenth }))
          return updated
        })
        setFeedbackItems(prev => {
          if (!prev) return prev
          return prev
            .filter(f => !aiResult.deletions.has(f.hitId))
            .map(f => {
              const s = aiResult.suggestions.get(f.hitId)
              return s ? { ...f, current: s } : f
            })
        })
      }
      setFeedbackRetries(n => n + 1)
    } catch {
      // swallow — UI stays in feedback mode
    } finally {
      setFeedbackLoading(false)
    }
  }

  // User confirms the feedback panel — request AI reflection
  async function confirmFeedback() {
    if (!feedbackItems) return
    const changed = feedbackItems.filter(f => f.current !== f.original)
    setFeedbackItems(null)
    if (changed.length === 0) return

    // Ask AI to reflect on what it learned from these corrections
    setFeedbackLoading(true)
    try {
      const res = await fetch('/api/beat-reflection', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          corrections: changed.map(f => ({
            time:       f.time,
            machineLabel: f.original,
            aiLabel:    f.original,  // before retry sequence
            finalLabel: f.current,
            spectral:   f.spectral,
          })),
        }),
      })
      if (res.ok) {
        const data = await res.json() as { reflection?: string }
        if (data.reflection) setReflection(data.reflection)
      }
    } catch { /* swallow */ } finally {
      setFeedbackLoading(false)
    }
  }

  // ── Add to project ───────────────────────────────────────────────────────

  function addToProject() {
    if (!onAddTrack || hits.length === 0) return
    onAddTrack({
      id:            crypto.randomUUID(),
      name:          'Beat',
      hits:          [...hits],
      bpm,
      duration,
      typeOverrides: { ...typeOverrides },
      createdAt:     new Date().toISOString(),
    })
    reset()
  }

  // ── User-initiated feedback ───────────────────────────────────────────────

  function enterFeedbackMode() {
    setFeedbackSnapshot(new Map(hits.map(h => [h.id, h.type])))
    setUserFeedbackMode(true)
    setUserFeedbackNotes('')
  }

  function exitFeedbackMode(restore: boolean) {
    if (restore && feedbackSnapshot) {
      setHits(prev => prev.map(h => {
        const orig = feedbackSnapshot.get(h.id)
        return orig !== undefined ? { ...h, type: orig } : h
      }))
    }
    setUserFeedbackMode(false)
    setUserFeedbackNotes('')
    setFeedbackSnapshot(null)
  }

  async function sendFeedback() {
    if (feedbackSending) return
    const corrections: Array<{ time: number; machineLabel: string; finalLabel: string; spectral?: HitSpectral }> = []

    for (const hit of hits) {
      const original = feedbackSnapshot?.get(hit.id)
      if (original !== undefined && original !== hit.type) {
        corrections.push({ time: hit.time, machineLabel: original, finalLabel: hit.type, spectral: hit.spectral })
      }
    }

    const notes = userFeedbackNotes.trim()
    if (corrections.length === 0 && !notes) {
      exitFeedbackMode(false)
      return
    }

    setFeedbackSending(true)
    try {
      const res = await fetch('/api/beat-reflection', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ corrections, userNotes: notes || undefined }),
      })
      if (res.ok) {
        const data = await res.json() as { reflection?: string }
        if (data.reflection) setReflection(data.reflection)
      }
    } catch { /* swallow */ } finally {
      setFeedbackSending(false)
    }

    exitFeedbackMode(false)
  }

  function acceptAiForHit(hitId: string) {
    if (!aiSuggestions) return
    const suggested = aiSuggestions.get(hitId)
    if (!suggested) return
    setHits(prev => prev.map(h => h.id !== hitId ? h : { ...h, type: suggested }))
    setAiSuggestions(prev => {
      if (!prev) return null
      const next = new Map(prev)
      next.delete(hitId)
      return next.size > 0 ? next : null
    })
  }

  function programWasRight() {
    if (!aiSuggestions && aiDeletions.size === 0) return
    // Dismiss all AI suggestions — no corrections to save
    setAiSuggestions(null)
    setAiDeletions(new Set())
    setShowFeedbackCard(false)
  }

  function aiWasRight() {
    if (!aiSuggestions && aiDeletions.size === 0) return
    const sixteenth = bpm ? (60 / bpm) / 4 : null
    const toDelete = new Set(aiDeletions)
    setHits(prev => {
      let updated = prev
        .filter(h => !toDelete.has(h.id))
        .map(h => {
          const suggested = aiSuggestions?.get(h.id)
          if (!suggested || suggested === h.type) return h
          return { ...h, type: suggested }
        })
      if (sixteenth) updated = updated.map(h => ({ ...h, time: Math.round(h.time / sixteenth) * sixteenth }))
      return updated
    })
    setAiSuggestions(null)
    setAiDeletions(new Set())
    setShowFeedbackCard(false)
  }

  function reset() {
    stopPlayback()
    setPhase('idle')
    setHits([])
    setAnalysis(null)
    setBpm(null)
    setDuration(0)
    setSelectedIds(new Set())
    setActiveLaneType(null)
    setZoomLevel(1)
    setPlayhead(0)
    setError(null)
    setAudioBuf(null)
    setMutedTypes(new Set())
    setAiSuggestions(null)
    setAiDeletions(new Set())
    setAiLoading(false)
    setFeedbackItems(null)
    setFeedbackRetries(0)
    setReflection(null)
    setShowFeedbackCard(false)
    setUserFeedbackMode(false)
    setUserFeedbackNotes('')
    setFeedbackSnapshot(null)
    stopLoopPlayback()
    setLoopBuffer(null)
    setLoopDetectedBpm(null)
    setAudioClips([])
  }

  function toggleMute(type: BeatType) {
    setMutedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type); else next.add(type)
      return next
    })
  }

  function toggleSelectedType(type: BeatType) {
    setSelectedTypes(prev => {
      const next = new Set(prev)
      if (next.has(type) && next.size > 1) next.delete(type)
      else next.add(type)
      return next
    })
  }

  // Lanes: selected drum types + hit types + extra/custom lanes + lanes that have audio clips
  const activeLaneTypes = useMemo(() => {
    const set = new Set<BeatType>()
    selectedTypes.forEach(t => set.add(t))
    hits.forEach(h => set.add(h.type))
    extraLaneIds.forEach(id => set.add(id as BeatType))
    audioClips.forEach(c => set.add(c.laneType as BeatType))
    return Array.from(set).sort((a, b) => {
      const ai = ALL_DRUM_TYPES.indexOf(a), bi = ALL_DRUM_TYPES.indexOf(b)
      if (ai !== -1 && bi !== -1) return ai - bi
      if (ai !== -1) return -1
      if (bi !== -1) return 1
      return a.localeCompare(b)
    })
  }, [hits, selectedTypes, extraLaneIds, audioClips])

  // Keep laneOrder in sync as active lanes come and go
  useEffect(() => {
    setLaneOrder(prev => {
      if (!prev) return null
      const activeSet = new Set(activeLaneTypes.map(t => t as string))
      // Keep only lanes that are still active, preserving user order
      const pruned = prev.filter(id => activeSet.has(id))
      // Append new lanes the user hasn't ordered yet
      const inOrder = new Set(pruned)
      const extras  = activeLaneTypes.filter(t => !inOrder.has(t as string)).map(t => t as string)
      return pruned.length === prev.length && extras.length === 0 ? prev : [...pruned, ...extras]
    })
  }, [activeLaneTypes])

  // Display order: user-controlled when laneOrder is set, otherwise computed
  const displayedLaneTypes = useMemo<BeatType[]>(() => {
    if (!laneOrder) return activeLaneTypes
    const activeSet = new Set(activeLaneTypes.map(t => t as string))
    const ordered   = laneOrder.filter(id => activeSet.has(id)) as BeatType[]
    const inOrder   = new Set(ordered.map(t => t as string))
    const remaining = activeLaneTypes.filter(t => !inOrder.has(t as string))
    return [...ordered, ...remaining]
  }, [laneOrder, activeLaneTypes])

  const audioClipsByLane = useMemo(() => {
    const map = new Map<string, AudioClip[]>()
    for (const clip of audioClips) {
      const arr = map.get(clip.laneType) ?? []
      arr.push(clip)
      map.set(clip.laneType, arr)
    }
    return map
  }, [audioClips])

  // All type IDs available in the Change dropdown (active lanes + empty custom lanes)
  const allAvailableTypes = useMemo(() => [
    ...activeLaneTypes,
    ...extraLaneIds.filter(id => !activeLaneTypes.includes(id as BeatType)),
  ] as BeatType[], [activeLaneTypes, extraLaneIds])

  const hitsByType = useMemo(() => {
    const map = new Map<BeatType, BeatHit[]>()
    for (const t of activeLaneTypes) map.set(t, [])
    for (const h of hits) {
      if (!map.has(h.type)) map.set(h.type, [])
      map.get(h.type)!.push(h)
    }
    return map
  }, [hits, activeLaneTypes])

  function exportMidi() {
    if (!hits.length || !duration) return
    const bps = (bpm ?? 120) / 60
    const ticksPerBeat = 480
    const tempo = Math.round(60_000_000 / (bpm ?? 120))

    // Collect unique lane types (one MIDI track per lane)
    const laneTypes = Array.from(new Set(hits.map(h => h.type)))

    // Build raw MIDI bytes
    const trackChunks: number[][] = []
    for (const laneType of laneTypes) {
      const laneHits = hits.filter(h => h.type === laneType).sort((a, b) => a.time - b.time)
      const events: Array<{ tick: number; bytes: number[] }> = []
      for (const h of laneHits) {
        const tick = Math.round(h.time * bps * ticksPerBeat)
        const vel = Math.round(Math.max(1, Math.min(127, h.velocity * 127)))
        const note = Math.max(0, Math.min(127, h.note))
        const durTick = Math.round((h.duration ?? 0.1) * bps * ticksPerBeat)
        events.push({ tick, bytes: [0x90, note, vel] })
        events.push({ tick: tick + Math.max(1, durTick), bytes: [0x80, note, 0] })
      }
      events.sort((a, b) => a.tick - b.tick)
      const evBytes: number[] = []
      let lastTick = 0
      for (const ev of events) {
        const delta = ev.tick - lastTick; lastTick = ev.tick
        evBytes.push(...encodeVarLen(delta), ...ev.bytes)
      }
      // End of track
      evBytes.push(0x00, 0xFF, 0x2F, 0x00)
      trackChunks.push(evBytes)
    }

    function encodeVarLen(n: number): number[] {
      if (n < 0x80) return [n]
      const out: number[] = []
      let v = n
      out.unshift(v & 0x7F); v >>= 7
      while (v > 0) { out.unshift((v & 0x7F) | 0x80); v >>= 7 }
      return out
    }

    // Header chunk
    const numTracks = trackChunks.length
    const header = [
      0x4D, 0x54, 0x68, 0x64,  // MThd
      0, 0, 0, 6,               // length = 6
      0, 1,                     // format 1 (multi-track)
      (numTracks >> 8) & 0xFF, numTracks & 0xFF,
      (ticksPerBeat >> 8) & 0xFF, ticksPerBeat & 0xFF,
    ]

    // Tempo track
    const tempoTrack = [
      0x00, 0xFF, 0x51, 0x03,
      (tempo >> 16) & 0xFF, (tempo >> 8) & 0xFF, tempo & 0xFF,
      0x00, 0xFF, 0x2F, 0x00,
    ]
    const tempoChunk = [0x4D, 0x54, 0x72, 0x6B, 0, 0, 0, tempoTrack.length, ...tempoTrack]

    const allBytes: number[] = [...header, ...tempoChunk]
    for (const track of trackChunks) {
      const len = track.length
      allBytes.push(0x4D, 0x54, 0x72, 0x6B)
      allBytes.push((len >> 24) & 0xFF, (len >> 16) & 0xFF, (len >> 8) & 0xFF, len & 0xFF)
      allBytes.push(...track)
    }

    const blob = new Blob([new Uint8Array(allBytes)], { type: 'audio/midi' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'beatlab-export.mid'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  async function exportMasterMix() {
    if (!duration || duration <= 0) return
    const sr = 44100
    const totalSamples = Math.ceil(sr * (duration + 2))
    const offCtx = new OfflineAudioContext(2, totalSamples, sr)

    // Master chain: gain → brickwall limiter → destination
    const masterGain = offCtx.createGain()
    masterGain.gain.value = masterVolume
    const exportLimiter = offCtx.createDynamicsCompressor()
    exportLimiter.threshold.value = -0.3; exportLimiter.knee.value = 0
    exportLimiter.ratio.value = 20; exportLimiter.attack.value = 0.001; exportLimiter.release.value = 0.1
    masterGain.connect(exportLimiter); exportLimiter.connect(offCtx.destination)

    // Global reverb return (synthetic IR)
    const revIR   = makeReverbIR(offCtx as unknown as AudioContext)
    const revNode = offCtx.createConvolver(); revNode.buffer = revIR; revNode.connect(masterGain)
    const dlyNode = offCtx.createDelay(5)
    dlyNode.delayTime.value = effectiveBpmRef.current > 0 ? 60 / effectiveBpmRef.current / 2 : 0.25
    const dlyFb = offCtx.createGain(); dlyFb.gain.value = 0.4
    dlyNode.connect(dlyFb); dlyFb.connect(dlyNode); dlyNode.connect(masterGain)

    // Build group buses (mirrors live playback)
    const groupBuses = new Map<string, GainNode>()
    for (const g of groupDefsRef.current) {
      const bus = offCtx.createGain(); bus.gain.value = 1; bus.connect(masterGain)
      groupBuses.set(g.id, bus)
    }

    // Build per-lane signal chain: input → FX → pan → group|master + sends
    const laneInputs = new Map<string, GainNode>()
    function getLaneNode(laneType: string): GainNode {
      if (laneInputs.has(laneType)) return laneInputs.get(laneType)!

      const inp = offCtx.createGain()
      // FX chain — replicate live buildFxNodes using the offline context
      let chainOut: AudioNode = inp
      for (const fx of laneEffectsRef.current[laneType] ?? []) {
        if (!fx.enabled) continue
        const p = fx.params
        try {
          switch (fx.type) {
            case 'eq3': {
              const lo  = offCtx.createBiquadFilter(); lo.type  = 'lowshelf';  lo.frequency.value = 200;  lo.gain.value = p.low  ?? 0
              const mid = offCtx.createBiquadFilter(); mid.type = 'peaking';   mid.frequency.value = p.midFreq ?? 1000; mid.Q.value = 1; mid.gain.value = p.mid ?? 0
              const hi  = offCtx.createBiquadFilter(); hi.type  = 'highshelf'; hi.frequency.value = 8000; hi.gain.value = p.high ?? 0
              chainOut.connect(lo); lo.connect(mid); mid.connect(hi); chainOut = hi; break
            }
            case 'comp': {
              const comp = offCtx.createDynamicsCompressor()
              comp.threshold.value = p.threshold ?? -24; comp.ratio.value = p.ratio ?? 4
              comp.attack.value = p.attack ?? 0.003; comp.release.value = p.release ?? 0.25; comp.knee.value = p.knee ?? 6
              chainOut.connect(comp); chainOut = comp; break
            }
            case 'saturator': {
              const drive = Math.max(1, Math.min(20, p.drive ?? 3)); const wet = Math.max(0, Math.min(1, p.wet ?? 1))
              const curve = new Float32Array(2048)
              for (let i = 0; i < 2048; i++) { const x = (i * 2 / 2047 - 1) * drive; curve[i] = Math.tanh(x) / Math.tanh(drive) }
              const ws = offCtx.createWaveShaper(); ws.curve = curve; ws.oversample = '4x'
              const i2 = offCtx.createGain(); const o2 = offCtx.createGain()
              const dryG = offCtx.createGain(); dryG.gain.value = 1 - wet
              const wetG = offCtx.createGain(); wetG.gain.value = wet
              i2.connect(dryG); dryG.connect(o2); i2.connect(wetG); wetG.connect(ws); ws.connect(o2)
              chainOut.connect(i2); chainOut = o2; break
            }
            case 'crush': {
              const bits = Math.max(1, Math.min(16, p.bits ?? 8))
              const step = Math.pow(2, bits); const curve = new Float32Array(2048)
              for (let i = 0; i < 2048; i++) { const x = i * 2 / 2047 - 1; curve[i] = Math.round(x * step) / step }
              const ws = offCtx.createWaveShaper(); ws.curve = curve
              chainOut.connect(ws); chainOut = ws; break
            }
            case 'delay': {
              const wet = Math.max(0, Math.min(1, p.wet ?? 0.3))
              const dly = offCtx.createDelay(5); dly.delayTime.value = Math.max(0.01, Math.min(5, p.time ?? 0.25))
              const fb  = offCtx.createGain(); fb.gain.value = Math.max(0, Math.min(0.95, p.feedback ?? 0.4))
              dly.connect(fb); fb.connect(dly)
              const i2 = offCtx.createGain(); const o2 = offCtx.createGain()
              const dryG = offCtx.createGain(); dryG.gain.value = 1 - wet; const wetG = offCtx.createGain(); wetG.gain.value = wet
              i2.connect(dryG); dryG.connect(o2); i2.connect(wetG); wetG.connect(dly); dly.connect(o2)
              chainOut.connect(i2); chainOut = o2; break
            }
            case 'autofilter': {
              const filt = offCtx.createBiquadFilter(); filt.type = 'lowpass'
              filt.frequency.value = Math.max(80, p.freq ?? 800); filt.Q.value = Math.max(0.5, p.Q ?? 1.5)
              chainOut.connect(filt); chainOut = filt; break
            }
            // chorus, phaser, flanger, lfo, beatrepeat: LFOs not supported in OfflineAudioContext reliably
            // — pass audio through dry to preserve timing
            default: break
          }
        } catch { /* skip broken FX in export */ }
      }

      const panner = offCtx.createStereoPanner(); panner.pan.value = lanePansRef.current[laneType] ?? 0
      chainOut.connect(panner)

      // Route to group bus or master
      const groupForLane = groupDefsRef.current.find(g => g.childTypes.includes(laneType))
      const dest = groupForLane ? (groupBuses.get(groupForLane.id) ?? masterGain) : masterGain
      panner.connect(dest)

      // Reverb and delay sends
      const revSend = offCtx.createGain(); revSend.gain.value = laneReverbRef.current[laneType] ?? 0
      const dlySend = offCtx.createGain(); dlySend.gain.value = laneDelayRef.current[laneType] ?? 0
      panner.connect(revSend); revSend.connect(revNode)
      panner.connect(dlySend); dlySend.connect(dlyNode)

      // Automation: volume and pan lanes applied via scheduled gain/pan values
      for (const al of automLanes.filter(a => a.laneType === laneType)) {
        const sorted = [...al.points].sort((a, b) => a.time - b.time)
        if (sorted.length < 2) continue
        if (al.param === 'volume') {
          for (const pt of sorted) inp.gain.setValueAtTime(pt.value, pt.time)
        } else if (al.param === 'pan') {
          for (const pt of sorted) panner.pan.setValueAtTime(pt.value * 2 - 1, pt.time)
        }
      }

      laneInputs.set(laneType, inp)
      return inp
    }

    // Render all hits
    const allLaneTypes = Array.from(new Set(hits.map(h => h.type)))
    for (const laneType of allLaneTypes) {
      if (mutedTypes.has(laneType as BeatType)) continue
      for (const hit of hits.filter(h => h.type === laneType)) {
        if (hit.time > duration) continue
        try {
          const { playDrumHit } = await import('@/lib/drum-samples')
          const { playMelodicNote, MELODIC_TYPES } = await import('@/lib/instrument-synth')
          if (MELODIC_TYPES.has(hit.type)) {
            playMelodicNote(offCtx as unknown as AudioContext, hit.type, hit.note, hit.time, hit.velocity, getLaneNode(laneType))
          } else {
            playDrumHit(offCtx as unknown as AudioContext, 'synth', hit.type, hit.time, hit.velocity, hit.note, undefined, getLaneNode(laneType))
          }
        } catch { /* ignore */ }
      }
    }

    // Render all audio clips
    for (const clip of audioClips) {
      if (clip.muted || mutedTypes.has(clip.laneType as BeatType)) continue
      const effDur = clip.loopDuration ?? clip.stretchDuration ?? clip.buf.duration
      const clipEnd = clip.startTime + effDur
      if (clipEnd <= 0 || clip.startTime > duration) continue
      const peakGain = 0.82 * clip.gain
      const src = offCtx.createBufferSource()
      src.buffer = clip.buf
      const playRate = clip.stretchDuration != null ? clip.buf.duration / clip.stretchDuration : 1
      src.playbackRate.value = clip.reversed ? -playRate : playRate
      if (clip.loopDuration != null) { src.loop = true; src.loopStart = 0; src.loopEnd = clip.buf.duration }
      const gn = offCtx.createGain(); gn.gain.value = peakGain
      src.connect(gn)
      if (clip.gainEnvelope && clip.gainEnvelope.length >= 2) {
        const envGn = offCtx.createGain(); envGn.gain.value = clip.gainEnvelope[0].v
        gn.connect(envGn); envGn.connect(getLaneNode(clip.laneType))
        for (const pt of clip.gainEnvelope)
          envGn.gain.setValueAtTime(pt.v, clip.startTime + pt.t * effDur)
      } else {
        gn.connect(getLaneNode(clip.laneType))
      }
      if (clip.fadeIn > 0) {
        gn.gain.setValueAtTime(0, clip.startTime)
        gn.gain.linearRampToValueAtTime(peakGain, clip.startTime + clip.fadeIn)
      }
      if (clip.fadeOut > 0) {
        const foStart = clipEnd - clip.fadeOut
        gn.gain.setValueAtTime(peakGain, Math.max(clip.startTime, foStart))
        gn.gain.linearRampToValueAtTime(0, clipEnd)
      }
      src.start(clip.startTime)
      if (clip.loopDuration != null) src.stop(clipEnd)
    }

    try {
      const rendered = await offCtx.startRendering()
      const wav = audioBufferToWav(rendered)
      const url = URL.createObjectURL(wav)
      const a = document.createElement('a'); a.href = url; a.download = 'beatlab-mix.wav'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
    } catch (e) { showToast(`Export failed: ${String(e)}`) }
  }

  function splitClipAtPlayhead(clipId: string) {
    const clip = audioClips.find(c => c.id === clipId)
    if (!clip) return
    const splitAt = playheadKbRef.current
    const relSplit = splitAt - clip.startTime
    const effDur = clip.stretchDuration ?? clip.buf.duration
    if (relSplit <= 0.05 || relSplit >= effDur - 0.05) return

    // Slice the AudioBuffer at the split point
    const sr = clip.buf.sampleRate
    const ch = clip.buf.numberOfChannels
    const splitSample = Math.round(relSplit * (clip.buf.length / effDur))

    const leftLen  = Math.max(1, splitSample)
    const rightLen = Math.max(1, clip.buf.length - splitSample)

    const leftBuf  = new AudioBuffer({ numberOfChannels: ch, length: leftLen,  sampleRate: sr })
    const rightBuf = new AudioBuffer({ numberOfChannels: ch, length: rightLen, sampleRate: sr })
    for (let c2 = 0; c2 < ch; c2++) {
      leftBuf.copyToChannel(clip.buf.getChannelData(c2).slice(0, leftLen), c2)
      rightBuf.copyToChannel(clip.buf.getChannelData(c2).slice(splitSample), c2)
    }

    const leftClip:  AudioClip = { ...clip, id: crypto.randomUUID(), buf: leftBuf,  stretchDuration: null, loopDuration: null, fadeOut: 0 }
    const rightClip: AudioClip = { ...clip, id: crypto.randomUUID(), buf: rightBuf, stretchDuration: null, loopDuration: null, fadeIn: 0, startTime: splitAt }

    captureHistory()
    setAudioClips(prev => prev.flatMap(c => c.id === clipId ? [leftClip, rightClip] : [c]))
    setClipMenu(null)
  }

  async function exportStems() {
    if (!duration || duration <= 0 || audioClips.length === 0) return
    setExportingStems(true)
    try {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      const sr = 44100
      const totalSamples = Math.ceil(sr * (duration + 1))

      // Get unique lane types that have clips
      const lanesWithClips = [...new Set(audioClips.filter(c => !c.muted).map(c => c.laneType))]

      for (const laneType of lanesWithClips) {
        const laneName = (typeOverrides[laneType]?.label ?? laneType).replace(/[^a-zA-Z0-9_\- ]/g, '').trim() || laneType
        const laneClips = audioClips.filter(c => c.laneType === laneType && !c.muted)
        if (laneClips.length === 0) continue

        const offCtx = new OfflineAudioContext(2, totalSamples, sr)

        const stemGain = offCtx.createGain()
        stemGain.gain.value = 1
        stemGain.connect(offCtx.destination)

        const panner = offCtx.createStereoPanner()
        panner.pan.value = lanePans[laneType] ?? 0
        const fxInput = offCtx.createGain()
        fxInput.connect(panner)
        panner.connect(stemGain)

        // Schedule clips
        for (const clip of laneClips) {
          if (!clip.buf) continue
          const src = offCtx.createBufferSource()
          src.buffer = clip.buf
          const clipGain = offCtx.createGain()
          clipGain.gain.value = clip.gain ?? 1
          src.connect(clipGain)
          clipGain.connect(fxInput)
          src.start(clip.startTime)
        }

        const rendered = await offCtx.startRendering()
        const channels: Float32Array[] = []
        for (let ch = 0; ch < rendered.numberOfChannels; ch++) channels.push(rendered.getChannelData(ch))
        const wav = encodeWav(channels, sr)
        zip.file(`${laneName}.wav`, wav)
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href = url; a.download = 'stems.zip'
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      showToast(`Downloaded ${lanesWithClips.length} stems`)
    } catch (err) {
      showToast('Stem export failed')
      console.error(err)
    } finally {
      setExportingStems(false)
    }
  }

  function audioBufferToWav(buf: AudioBuffer): Blob {
    const numCh = buf.numberOfChannels
    const numSamples = buf.length
    const sampleRate = buf.sampleRate
    const byteCount = 44 + numSamples * numCh * 2
    const ab = new ArrayBuffer(byteCount)
    const view = new DataView(ab)
    const writeStr = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)) }
    const writeU16 = (o: number, v: number) => view.setUint16(o, v, true)
    const writeU32 = (o: number, v: number) => view.setUint32(o, v, true)
    writeStr(0, 'RIFF'); writeU32(4, byteCount - 8); writeStr(8, 'WAVE')
    writeStr(12, 'fmt '); writeU32(16, 16); writeU16(20, 1); writeU16(22, numCh)
    writeU32(24, sampleRate); writeU32(28, sampleRate * numCh * 2)
    writeU16(32, numCh * 2); writeU16(34, 16)
    writeStr(36, 'data'); writeU32(40, numSamples * numCh * 2)
    let offset = 44
    for (let i = 0; i < numSamples; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, buf.getChannelData(c)[i]))
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true)
        offset += 2
      }
    }
    return new Blob([ab], { type: 'audio/wav' })
  }

  // For the toolbar, show info for whichever single hit is selected (or the first if multiple)
  const selectedHit = selectedIds.size === 1 ? (hits.find(h => selectedIds.has(h.id)) ?? null) : null
  const activeHitCount = hits.filter(h => !mutedTypes.has(h.type)).length

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <TooltipModeProvider>
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', userSelect: 'none' }}>

      {/* ── Global error toast ────────────────────────────────────────────── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#1e1e32', border: '1px solid #ef4444', color: '#fca5a5',
          borderRadius: 8, padding: '10px 18px', fontSize: 13, fontWeight: 500,
          zIndex: 9999, boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          maxWidth: 480, textAlign: 'center', pointerEvents: 'none',
        }}>
          {toast}
        </div>
      )}

      {/* ── AI Synth Tuner overlay — rendered via portal to escape stacking contexts ── */}
      {synthTuner && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', bottom: 24, right: 24, width: 360,
          background: '#12121e', border: '1px solid rgba(139,92,246,0.45)',
          borderRadius: 12, padding: '14px 16px', zIndex: 99999,
          boxShadow: '0 8px 40px rgba(0,0,0,0.8)',
          display: 'flex', flexDirection: 'column', gap: 10,
          fontFamily: 'inherit',
        }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13 }}>🎛</span>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#a78bfa', letterSpacing: 0.3 }}>
                AI Conversion Tuner
              </span>
              {synthTuner.status === 'running' && (
                <span style={{ fontSize: 10, color: '#6b7280' }}>
                  — pass {synthTuner.iteration}/3
                </span>
              )}
            </div>
            <button
              onClick={() => {
                synthCancelledRef.current = true
                synthResumeRef.current?.('')  // unblock any waiting Promise
                if (synthTuner.preAiBuf && synthTuner.iterations.length > 0) {
                  setAudioClips(prev => prev.map(c => c.id === synthTuner.clipId ? { ...c, buf: synthTuner.preAiBuf! } : c))
                }
                setSynthTuner(null)
              }}
              title={synthTuner.iterations.length > 0 ? 'Dismiss and revert audio to pre-AI version' : 'Dismiss'}
              style={{ background: 'none', border: 'none', color: '#6b7280', cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 2px' }}
            >×</button>
          </div>

          {/* Loading state (no cards yet) */}
          {synthTuner.status === 'running' && synthTuner.iterations.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 11 }}>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
              Analyzing pitch data and synthesis algorithm…
            </div>
          )}

          {/* Iteration cards */}
          {synthTuner.iterations.map((iter, idx) => (
            <div key={idx} style={{
              background: '#1a1a2e', borderRadius: 8, padding: '10px 12px',
              borderLeft: '3px solid #7c3aed',
              animation: 'slideUp 0.3s ease',
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#a78bfa', marginBottom: 5 }}>
                {iter.title}
              </div>
              <div style={{ fontSize: 11, color: '#9ca3af', lineHeight: 1.55, marginBottom: 6 }}>
                {iter.analysis}
              </div>
              <div style={{ fontSize: 10, color: '#8b5cf6', fontStyle: 'italic' }}>
                → {iter.changes}
              </div>
            </div>
          ))}

          {/* Accept / reject between iterations */}
          {synthTuner.status === 'waiting' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#a78bfa', fontWeight: 600 }}>
                Pass {synthTuner.iterations.length} complete — listen, then decide:
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => {
                    synthPassAcceptedRef.current = true
                    const feedback = synthFeedbackInputRef.current?.value ?? ''
                    if (synthFeedbackInputRef.current) synthFeedbackInputRef.current.value = ''
                    synthResumeRef.current?.(feedback)
                  }}
                  style={{ flex: 1, padding: '6px 0', borderRadius: 6, background: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.35)', color: '#34d399', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                >✓ Keep &amp; next pass</button>
                <button
                  onClick={() => {
                    synthPassAcceptedRef.current = false
                    const feedback = synthFeedbackInputRef.current?.value ?? ''
                    if (synthFeedbackInputRef.current) synthFeedbackInputRef.current.value = ''
                    synthResumeRef.current?.(feedback)
                  }}
                  style={{ flex: 1, padding: '6px 0', borderRadius: 6, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                >✗ Undo &amp; retry</button>
              </div>
              <div style={{ fontSize: 10, color: '#6b7280' }}>Optional — describe the issue for the next pass:</div>
              <textarea
                ref={synthFeedbackInputRef}
                placeholder="e.g. still jarring between notes, too thin, too much resonance…"
                rows={2}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: '#0e0e1a', border: '1px solid rgba(139,92,246,0.35)',
                  borderRadius: 6, padding: '6px 8px',
                  color: '#e5e7eb', fontSize: 11, fontFamily: 'inherit',
                  resize: 'none', outline: 'none',
                }}
              />
            </div>
          )}

          {/* Spinner between iterations */}
          {synthTuner.status === 'running' && synthTuner.iterations.length > 0 && synthTuner.iterations.length < 3 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6b7280', fontSize: 11 }}>
              <span style={{ display: 'inline-block', animation: 'spin 1s linear infinite' }}>⟳</span>
              Re-synthesizing and running next pass…
            </div>
          )}

          {/* Done — learned profile path */}
          {synthTuner.status === 'done' && synthTuner.learnedProfileId && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 600 }}>
                ⚡ Learned profile applied — no AI needed
              </div>
              <div style={{ fontSize: 10, color: '#6b7280', lineHeight: 1.5 }}>
                This profile was saved from a previous session with a similar recording.
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setSynthTuner(null)}
                  style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                >Keep this</button>
                <button
                  onClick={() => {
                    // Re-run with AI, skipping the learned profile
                    const args = synthTunerArgsRef.current
                    if (args) runSynthTuner(args.clipId, args.pitchCurve, args.source, args.opts, args.referenceBuf, true)
                  }}
                  style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.45)', color: '#a78bfa', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                >Refine with AI →</button>
              </div>
              <button
                onClick={() => {
                  if (synthTuner.preAiBuf) setAudioClips(prev => prev.map(c => c.id === synthTuner.clipId ? { ...c, buf: synthTuner.preAiBuf! } : c))
                  setSynthTuner(null)
                }}
                style={{ padding: '4px 0', borderRadius: 6, background: 'transparent', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 10, cursor: 'pointer' }}
              >Revert to original</button>
            </div>
          )}

          {/* Done — AI path */}
          {synthTuner.status === 'done' && !synthTuner.learnedProfileId && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 11, color: '#34d399' }}>
                ✓ All passes complete
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    // Save this as a learned profile for future similar recordings
                    if (synthTuner.features && synthCurrentCodeRef.current) {
                      saveProfile(synthTuner.features, synthCurrentCodeRef.current, profileLabel(synthTuner.features))
                      showToast('Profile saved — future similar recordings will skip the AI')
                    }
                    setSynthTuner(null)
                  }}
                  style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: 'rgba(52,211,153,0.15)', border: '1px solid rgba(52,211,153,0.3)', color: '#34d399', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                >Keep &amp; save profile</button>
                <button
                  onClick={() => {
                    if (synthTuner.preAiBuf) setAudioClips(prev => prev.map(c => c.id === synthTuner.clipId ? { ...c, buf: synthTuner.preAiBuf! } : c))
                    setSynthTuner(null)
                  }}
                  style={{ flex: 1, padding: '5px 0', borderRadius: 6, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', fontSize: 11, cursor: 'pointer' }}
                >Revert</button>
              </div>
            </div>
          )}

          {/* Error */}
          {synthTuner.status === 'error' && (
            <div style={{ fontSize: 11, color: '#f87171' }}>
              ✗ {synthTuner.errorMsg ?? 'Tuning failed'}
            </div>
          )}
        </div>,
        document.body,
      )}

      {/* ── Toolbar ───────────────────────────────────────────────────────── */}
      <div style={{
        height: 44, display: 'flex', alignItems: 'center', gap: 10,
        padding: '0 14px', borderBottom: '1px solid var(--border)',
        background: 'var(--bg-surface)', flexShrink: 0,
      }}>
        {phase === 'idle' && (
          <Tooltip content="Record audio — tap or sing your beat" placement="bottom">
            <button onClick={startRecording} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              <Mic size={13} /> Sing the Beat
            </button>
          </Tooltip>
        )}
        {phase === 'recording' && (
          <>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', animation: 'pulse 1s ease-in-out infinite' }} />
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: '#dc2626', minWidth: 52 }}>{recordingTime.toFixed(1)}s</span>
            <button onClick={stopRecording} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              <Square size={11} fill="currentColor" /> Stop
            </button>
          </>
        )}
        {phase === 'analyzing' && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 7 }}>
            <RefreshCw size={13} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing…
          </span>
        )}

        {phase === 'editing' && (
          <>
            <Tooltip content={isPlaying ? 'Pause (Space)' : 'Play (Space)'} placement="bottom">
              <button onClick={togglePlay} data-hint="Play / Pause||Starts or pauses playback from the current playhead position. Shortcut: Space bar. The playhead shows you exactly where you are in the timeline." style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
                {isPlaying ? <Pause size={13} fill="#fff" /> : <Play size={13} fill="#fff" style={{ marginLeft: 1 }} />}
              </button>
            </Tooltip>

            {/* Record — only when at least one mic-input lane is armed */}
            {!laneRecording && Array.from(inputLanes).some(l => inputSource[l] !== 'midi') && (
              <Tooltip content={`Record into ${Array.from(inputLanes).filter(l => inputSource[l] !== 'midi').length} armed track(s)`} placement="bottom">
                <button
                  onClick={startLaneRecording}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 6, background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}
                >
                  <Mic size={11} /> Rec
                </button>
              </Tooltip>
            )}
            {laneRecording && (
              <>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#dc2626', animation: 'pulse 1s ease-in-out infinite', flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#dc2626', minWidth: 40 }}>{laneRecordingTime.toFixed(1)}s</span>
                <button onClick={stopLaneRecording} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                  <Square size={10} fill="currentColor" /> Stop
                </button>
              </>
            )}

            {/* BPM — always visible, click to edit, T to tap */}
            <div data-hint="Tempo (BPM)||The beats per minute of your project. Click the number to type a new value, or tap the T button repeatedly in rhythm to set tempo by feel. All hits snap to this grid." style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px' }}>
              <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>BPM</span>
              {bpmEditing ? (
                <input
                  autoFocus
                  type="number" min={20} max={300}
                  value={bpmInputVal}
                  onChange={e => setBpmInputVal(e.target.value)}
                  onBlur={e => commitBpmEdit(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') commitBpmEdit(bpmInputVal); if (e.key === 'Escape') setBpmEditing(false) }}
                  style={{ width: 40, fontSize: 12, fontWeight: 700, fontFamily: 'monospace', background: 'transparent', border: 'none', outline: 'none', color: 'var(--text-primary)' }}
                />
              ) : (
                <span
                  onClick={() => setBpmEditing(true)}
                  style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace', cursor: 'text', minWidth: 28, textAlign: 'center' }}
                  title="Click to edit BPM"
                >{bpm ?? masterBpm}</span>
              )}
              <Tooltip content="Tap tempo (T)" placement="bottom">
                <button
                  onClick={tapTempo}
                  style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
                >TAP</button>
              </Tooltip>
            </div>

            {/* Metronome toggle */}
            <Tooltip content="Metronome click while playing" placement="bottom">
              <button
                onClick={() => setMetronomeOn(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, border: '1px solid', fontSize: 11, cursor: 'pointer', fontWeight: 600,
                  background: metronomeOn ? 'rgba(139,92,246,0.18)' : 'var(--bg-card)',
                  borderColor: metronomeOn ? 'rgba(139,92,246,0.5)' : 'var(--border)',
                  color: metronomeOn ? 'var(--accent-light)' : 'var(--text-muted)' }}
              >♩</button>
            </Tooltip>

            {/* Count-in toggle */}
            <Tooltip content="1-bar count-in before recording starts" placement="bottom">
              <button
                onClick={() => setCountIn(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, border: '1px solid', fontSize: 10, cursor: 'pointer', fontWeight: 600,
                  background: countIn ? 'rgba(251,191,36,0.15)' : 'var(--bg-card)',
                  borderColor: countIn ? 'rgba(251,191,36,0.5)' : 'var(--border)',
                  color: countIn ? 'rgb(251,191,36)' : 'var(--text-muted)' }}
              >{countingIn ? `${countInBeat}` : '1•2•3•4'}</button>
            </Tooltip>

            {/* A/B loop toggle */}
            <Tooltip content="Loop between A and B markers\nShift+drag on the ruler to set range" placement="bottom">
              <button
                onClick={() => setAbLoopEnabled(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 6, border: '1px solid', fontSize: 10, cursor: 'pointer', fontWeight: 700,
                  background: abLoopEnabled ? 'rgba(251,191,36,0.15)' : 'var(--bg-card)',
                  borderColor: abLoopEnabled && abLoop ? 'rgba(251,191,36,0.5)' : 'var(--border)',
                  color: abLoopEnabled && abLoop ? 'rgb(251,191,36)' : 'var(--text-muted)',
                  opacity: !abLoop ? 0.5 : 1 }}
              >A–B</button>
            </Tooltip>

            {/* Selection toolbar — shows when clips or hits are selected */}
            {(selectedIds.size > 0 || selectedClipIds.size > 0) && (() => {
              const totalSel = selectedIds.size + selectedClipIds.size
              const parts: string[] = []
              if (selectedClipIds.size > 0) parts.push(`${selectedClipIds.size} clip${selectedClipIds.size !== 1 ? 's' : ''}`)
              if (selectedIds.size > 0)     parts.push(`${selectedIds.size} hit${selectedIds.size !== 1 ? 's' : ''}`)

              function deleteSelected() {
                captureHistory()
                selectedIds.forEach(id => deleteHit(id))
                setSelectedIds(new Set())
                const ids = selectedClipIds
                setAudioClips(prev => prev.filter(c => !ids.has(c.id)))
                ids.forEach(id => { deleteClip(id).catch(() => {}) })
                setSelectedClipIds(new Set())
              }

              function repeatSelected() {
                captureHistory()
                // Find the rightmost end of all selected items, then place copies there
                const selClips = audioClips.filter(c => selectedClipIds.has(c.id))
                const selHits  = hits.filter(h => selectedIds.has(h.id))

                if (selClips.length > 0) {
                  const rightEdge = Math.max(...selClips.map(c => c.startTime + clipEffectiveDuration(c)))
                  const leftEdge  = Math.min(...selClips.map(c => c.startTime))
                  const offset    = rightEdge - leftEdge
                  const newClips  = selClips.map(c => ({
                    ...c,
                    id: crypto.randomUUID(),
                    startTime: c.startTime + offset,
                  }))
                  setAudioClips(prev => [...prev, ...newClips])
                  setDuration(d => Math.max(d, rightEdge + offset + 0.5))
                  setSelectedClipIds(new Set(newClips.map(c => c.id)))
                }

                if (selHits.length > 0) {
                  const rightEdge = Math.max(...selHits.map(h => h.time))
                  const leftEdge  = Math.min(...selHits.map(h => h.time))
                  const offset    = rightEdge - leftEdge + (60 / (bpm ?? 120))
                  const newHits   = selHits.map(h => ({ ...h, id: crypto.randomUUID(), time: h.time + offset }))
                  setHits(prev => [...prev, ...newHits])
                  setSelectedIds(new Set(newHits.map(h => h.id)))
                }
              }

              return (
                <div data-hint="Selection Toolbar||Controls for the currently selected clips and hits. Delete removes them permanently. Repeat duplicates them immediately after their current position. Deselect (✕) or click empty space to clear the selection." style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 6, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.4)', flexShrink: 0 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(167,139,250,0.9)', whiteSpace: 'nowrap' }}>{parts.join(' + ')}</span>
                  <div style={{ width: 1, height: 12, background: 'rgba(99,102,241,0.3)', margin: '0 2px' }} />
                  <button
                    onClick={repeatSelected}
                    title="Duplicate selected items immediately after their current position"
                    style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(99,102,241,0.15)', color: 'rgba(167,139,250,1)', border: '1px solid rgba(99,102,241,0.35)', cursor: 'pointer', letterSpacing: '0.03em' }}
                  >⊕ Repeat</button>
                  <button
                    onClick={deleteSelected}
                    title="Delete selected items (Backspace)"
                    style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3, background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer' }}
                  >✕ Delete</button>
                  <button
                    onClick={() => { setSelectedClipIds(new Set()); setSelectedIds(new Set()) }}
                    title="Deselect all"
                    style={{ fontSize: 12, padding: '0 3px', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(167,139,250,0.5)', lineHeight: 1 }}
                  >×</button>
                </div>
              )
            })()}

            {/* Selected hit */}
            {selectedHit && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6, background: 'var(--bg-card)', border: '1px solid var(--border)', marginLeft: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: typeColor(selectedHit.type, typeOverrides), flexShrink: 0 }} />
                <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                  {typeLabel(selectedHit.type, typeOverrides)} @ {selectedHit.time.toFixed(2)}s
                  {selectedHit.note !== undefined && <span style={{ marginLeft: 5, color: 'var(--accent-light)' }}>{midiName(selectedHit.note)}</span>}
                </span>
                {aiDeletions.has(selectedHit.id) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)' }}>
                    <span style={{ fontSize: 9, color: 'rgba(239,68,68,0.85)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI: noise</span>
                    <button onClick={() => acceptAiDeleteForHit(selectedHit.id)} title="Accept — remove this hit" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.8)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700 }}>✓ remove</button>
                    <button onClick={() => rejectAiDeleteForHit(selectedHit.id)} title="Keep — this hit is real" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'transparent', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontWeight: 700 }}>✕ keep</button>
                  </div>
                )}
                {aiSuggestions?.get(selectedHit.id) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}>
                    <span style={{ fontSize: 9, color: 'rgba(139,92,246,0.8)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>AI says</span>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: typeColor(aiSuggestions.get(selectedHit.id)!, typeOverrides) }} />
                    <span style={{ fontSize: 10, color: 'var(--accent-light)' }}>{typeLabel(aiSuggestions.get(selectedHit.id)!, typeOverrides)}</span>
                    <button onClick={() => acceptAiForHit(selectedHit.id)} title="Accept — AI is right" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 700 }}>✓</button>
                    <button onClick={() => rejectAiForHit(selectedHit.id)} title="Reject — current label is correct" style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer', fontWeight: 700 }}>✕</button>
                  </div>
                )}
                <div style={{ position: 'relative' }}>
                  <button onClick={() => setShowTypeMenu(v => !v)} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10, padding: '2px 5px', borderRadius: 4, background: 'var(--border)', color: 'var(--text-secondary)', border: 'none', cursor: 'pointer' }}>
                    Change <ChevronDown size={10} />
                  </button>
                  {showTypeMenu && (
                    <>
                      <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setShowTypeMenu(false)} />
                      <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, zIndex: 50, overflow: 'hidden', minWidth: 130, maxHeight: 280, overflowY: 'auto' }}>
                        {allAvailableTypes.map(t => (
                          <button key={t} onClick={() => changeSelectedType(t)} style={{ display: 'flex', alignItems: 'center', gap: 7, width: '100%', padding: '6px 10px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--text-primary)', textAlign: 'left' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: typeColor(t, typeOverrides), flexShrink: 0 }} /> {typeLabel(t, typeOverrides)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <button onClick={() => { selectedIds.forEach(id => deleteHit(id)); setSelectedIds(new Set()) }} style={{ padding: '2px 5px', borderRadius: 4, background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444' }}>
                  <Trash2 size={11} />
                </button>
              </div>
            )}

            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* Sample pack / reference status */}
              {sampleBuffers.size > 0 && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)' }} title="Sample pack loaded">
                  ♪ {sampleBuffers.size} samples
                </span>
              )}
              {referenceSounds.length > 0 && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  ◈ {referenceSounds.length} ref
                </span>
              )}
              {/* AI status */}
              {aiLoading && (
                <span style={{ fontSize: 10, color: 'var(--accent-light)', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> AI checking…
                </span>
              )}
              {((aiSuggestions?.size ?? 0) + aiDeletions.size > 0) && !aiLoading && (
                <button
                  onClick={() => setShowFeedbackCard(true)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, padding: '3px 10px', borderRadius: 6, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', color: 'var(--accent-light)', cursor: 'pointer', fontWeight: 600 }}
                >
                  {(() => { const n = (aiSuggestions?.size ?? 0) + aiDeletions.size; return `✦ AI: ${n} suggestion${n !== 1 ? 's' : ''}` })()}
                </button>
              )}
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {activeHitCount} active{mutedTypes.size > 0 && ` · ${hits.length - activeHitCount} muted`}
              </span>
              {/* Master volume */}
              <div data-hint="Master Volume||Controls the overall output level of the entire mix — this is the last gain stage before your speakers or headphones. 100% is unity gain (0 dB). Avoid going above 100% to prevent digital clipping." style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 7px' }}>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>VOL</span>
                <input
                  type="range" min={0} max={2} step={0.01} value={masterVolume}
                  onChange={e => setMasterVolume(Number(e.target.value))}
                  style={{ width: 60, accentColor: 'var(--accent)', cursor: 'pointer' }}
                  title={`Master volume: ${Math.round(masterVolume * 100)}%`}
                />
                <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-muted)', minWidth: 24 }}>{Math.round(masterVolume * 100)}%</span>
              </div>
              {/* Tap Tempo */}
              <button
                onClick={handleTapTempo}
                title="Tap tempo (click in rhythm to set BPM)"
                style={{ fontSize: 10, fontWeight: 700, padding: '3px 9px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', letterSpacing: '0.04em' }}
              >
                Tap
              </button>
              {/* Quantize strip */}
              <div data-hint="Quantize & Swing||Q snaps all hits to the nearest grid division so your rhythm is perfectly on the beat. Swing adds a shuffle feel by pushing the off-beats slightly later — 0 is straight, 1 is maximum swing (triplet feel)." style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden', padding: '2px 4px' }}>
                <Tooltip content="Snap all hits to the nearest grid line (Q)" placement="bottom">
                  <button onClick={quantizeHits} style={{ padding: '2px 7px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 10, fontWeight: 700 }}>Q</button>
                </Tooltip>
                <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
                <span style={{ fontSize: 9, color: 'var(--text-muted)', paddingLeft: 4 }}>Swing</span>
                <input
                  type="range" min={0} max={1} step={0.01} value={quantizeSwing}
                  onChange={e => setQuantizeSwing(Number(e.target.value))}
                  style={{ width: 44, accentColor: '#f59e0b', cursor: 'pointer' }}
                  title={`Swing: ${Math.round(quantizeSwing * 100)}%`}
                />
                <span style={{ fontSize: 9, color: 'var(--text-muted)', minWidth: 22 }}>{Math.round(quantizeSwing * 100)}%</span>
              </div>
              {/* Edit menu */}
              <div style={{ position: 'relative' }}>
                <Tooltip content="Undo, redo, quantize, humanize, command palette" placement="bottom" disabled={showEditMenu}>
                  <button onClick={() => { setShowEditMenu(v => !v); setShowFileMenu(false) }}
                    style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: showEditMenu ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)', border: `1px solid ${showEditMenu ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, color: showEditMenu ? 'rgba(167,139,250,1)' : 'var(--text-muted)', cursor: 'pointer' }}>
                    Edit ▾
                  </button>
                </Tooltip>
                {showEditMenu && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 499 }} onClick={() => setShowEditMenu(false)} />
                    <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 500, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 0', minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
                      {[
                        { label: 'Undo', shortcut: '⌘Z', action: () => { undo(); setShowEditMenu(false) } },
                        { label: 'Redo', shortcut: '⌘⇧Z', action: () => { redo(); setShowEditMenu(false) } },
                        { label: '─', action: null },
                        { label: 'Quantize to Grid', shortcut: 'Q', action: () => { quantizeHits(); setShowEditMenu(false) } },
                        { label: 'Humanize (light)', action: () => { humanizeHits(0.25); setShowEditMenu(false) } },
                        { label: 'Humanize (heavy)', action: () => { humanizeHits(0.7); setShowEditMenu(false) } },
                        { label: '─', action: null },
                        { label: 'Command Palette', shortcut: '⌘K', action: () => { setCmdPaletteOpen(true); setShowEditMenu(false) } },
                      ].map((item, i) => item.action === null
                        ? <div key={i} style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
                        : <button key={item.label} onClick={item.action!}
                            style={{ display: 'flex', alignItems: 'center', width: '100%', padding: '7px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 11, color: 'var(--text-primary)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                          >
                            <span style={{ flex: 1 }}>{item.label}</span>
                            {item.shortcut && <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 12 }}>{item.shortcut}</span>}
                          </button>
                      )}
                    </div>
                  </>
                )}
              </div>
              {/* File menu */}
              <div style={{ position: 'relative' }}>
                <Tooltip content="Save / load project, export stems and MIDI" placement="bottom" disabled={showFileMenu}>
                  <button data-hint="File menu||Save and load project files, export to WAV or MIDI, and open Ableton projects. Your project is also auto-saved to browser storage every few seconds." onClick={() => { setShowFileMenu(v => !v); setShowEditMenu(false) }}
                    style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: showFileMenu ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)', border: `1px solid ${showFileMenu ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, color: showFileMenu ? 'rgba(167,139,250,1)' : 'var(--text-muted)', cursor: 'pointer' }}>
                    File ▾
                  </button>
                </Tooltip>
                {showFileMenu && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 499 }} onClick={() => setShowFileMenu(false)} />
                    <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 500, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '4px 0', minWidth: 180, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
                      {[
                        { label: 'Save Project', action: () => { saveProject(); setShowFileMenu(false) } },
                        { label: 'Load Project…', action: () => {
                          const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json'
                          inp.onchange = (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) loadProjectFromFile(f) }
                          inp.click(); setShowFileMenu(false)
                        }},
                        { label: 'Open Ableton Project…', action: () => { void openAbletonProject(); setShowFileMenu(false) } },
                        { label: '─', action: null },
                        { label: 'Export Master Mix (WAV)', action: () => { void exportMasterMix(); setShowFileMenu(false) } },
                        { label: exportingStems ? 'Downloading stems…' : 'Download Stems (ZIP)', action: () => { void exportStems(); setShowFileMenu(false) } },
                        { label: 'Export MIDI', action: () => { exportMidi(); setShowFileMenu(false) } },
                      ].map((item, i) => item.action === null
                        ? <div key={i} style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
                        : <button key={item.label} onClick={item.action!}
                            style={{ display: 'block', width: '100%', padding: '7px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 11, color: 'var(--text-primary)' }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                          >{item.label}</button>
                      )}
                    </div>
                  </>
                )}
              </div>
              {/* Download Stems button */}
              <button
                data-hint="Export each track as its own WAV file, bundled into a ZIP — perfect for handing off to a mixing engineer or uploading stems to Splice or similar platforms."
                onClick={() => { void exportStems() }}
                disabled={exportingStems}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5,
                  background: exportingStems ? 'rgba(139,92,246,0.12)' : 'var(--bg-card)',
                  border: `1px solid ${exportingStems ? 'rgba(139,92,246,0.35)' : 'var(--border)'}`,
                  color: exportingStems ? 'rgba(167,139,250,1)' : 'var(--text-muted)',
                  cursor: exportingStems ? 'default' : 'pointer', opacity: exportingStems ? 0.7 : 1,
                }}
              >
                {exportingStems ? '⏳ Stems…' : '⬇ Stems'}
              </button>
              {/* MIDI Mapping button */}
              <Tooltip content="MIDI controller mapping — map knobs/faders to parameters" placement="bottom" disabled={showMidiPanel}>
                <button
                  data-hint="MIDI Mapping||Connect a MIDI controller (keyboard, pad, knob box) and map any hardware control to BPM, volume, effects, or lane parameters. Click a parameter then move a physical control to create a mapping."
                  onClick={() => setShowMidiPanel(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5,
                    background: showMidiPanel || midiLearning !== null ? 'rgba(249,115,22,0.15)' : midiMappings.length > 0 ? 'rgba(139,92,246,0.12)' : 'var(--bg-card)',
                    border: `1px solid ${showMidiPanel || midiLearning !== null ? 'rgba(249,115,22,0.45)' : midiMappings.length > 0 ? 'rgba(139,92,246,0.35)' : 'var(--border)'}`,
                    color: showMidiPanel || midiLearning !== null ? '#f97316' : midiMappings.length > 0 ? 'rgba(167,139,250,1)' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  MIDI{midiMappings.length > 0 && <span style={{ fontSize: 9 }}>{midiMappings.length}</span>}
                </button>
              </Tooltip>
              {/* Digital keyboard button */}
              <Tooltip content="Digital MIDI keyboard — play notes with mouse, touch, or keyboard shortcuts" placement="bottom" disabled={showKeyboard}>
                <button
                  data-hint="Piano Keyboard||A virtual MIDI keyboard you can play with your mouse or touchscreen. Each lane can receive MIDI input — arm a lane and play to record notes in real time."
                  onClick={() => setShowKeyboard(v => !v)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5,
                    background: showKeyboard ? 'rgba(139,92,246,0.2)' : 'var(--bg-card)',
                    border: `1px solid ${showKeyboard ? 'rgba(139,92,246,0.5)' : 'var(--border)'}`,
                    color: showKeyboard ? 'rgba(167,139,250,1)' : 'var(--text-muted)',
                    cursor: 'pointer',
                  }}
                >
                  ♩ Keys
                </button>
              </Tooltip>
              {/* View toggle: Arrangement / Session */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                <Tooltip content="Arrangement view — timeline with audio clips and hits" placement="bottom" disabled={viewMode === 'arrangement'}>
                  <button data-hint="Arrangement View||The classic DAW timeline view. Audio clips and instrument hits are laid out left-to-right in time. Drag clips, resize them, and build song structure here." onClick={() => setViewMode('arrangement')} style={{ padding: '3px 9px', background: viewMode === 'arrangement' ? 'rgba(139,92,246,0.18)' : 'none', border: 'none', cursor: 'pointer', color: viewMode === 'arrangement' ? 'rgba(167,139,250,1)' : 'var(--text-muted)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>ARR</button>
                </Tooltip>
                <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
                <Tooltip content="Session view — clip launcher for live performance" placement="bottom" disabled={viewMode === 'session'}>
                  <button data-hint="Session View||A clip launcher grid inspired by Ableton Live. Each cell is a loop that you can trigger independently during live performance. Great for building songs on the fly." onClick={() => setViewMode('session')} style={{ padding: '3px 9px', background: viewMode === 'session' ? 'rgba(139,92,246,0.18)' : 'none', border: 'none', cursor: 'pointer', color: viewMode === 'session' ? 'rgba(167,139,250,1)' : 'var(--text-muted)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>SES</button>
                </Tooltip>
              </div>
              {/* Zoom controls */}
              <div data-hint="Timeline Zoom||Zoom in or out on the timeline. At 1× you see the full song; zoom in to see individual beats more clearly. You can also scroll the timeline with the scrollbar at the bottom." style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                <Tooltip content="Zoom out (scroll left to right shows more time)" placement="bottom">
                  <button onClick={() => setZoomLevel(z => Math.max(0.5, +(z / 1.5).toFixed(2)))} style={{ padding: '3px 7px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1 }}>−</button>
                </Tooltip>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 30, textAlign: 'center' }}>{zoomLevel === 1 ? '1×' : `${zoomLevel.toFixed(1)}×`}</span>
                <Tooltip content="Zoom in (fits more detail into the visible window)" placement="bottom">
                  <button onClick={() => setZoomLevel(z => Math.min(8, +(z * 1.5).toFixed(2)))} style={{ padding: '3px 7px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1 }}>+</button>
                </Tooltip>
              </div>
              {/* Inspector toggle */}
              <Tooltip content="Inspector panel — lane details, pan, tools (I)" placement="bottom" disabled={inspectorOpen}>
                <button
                  data-hint="Inspector||Shows detailed controls for the selected lane: stereo pan, send amounts for reverb and delay, clip editing tools, and more. Shortcut: I key."
                  onClick={() => setInspectorOpen(v => !v)}
                  style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: inspectorOpen ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)', border: `1px solid ${inspectorOpen ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, color: inspectorOpen ? 'rgba(167,139,250,1)' : 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Inspector
                </button>
              </Tooltip>

              {/* Named snapshots */}
              <button
                data-hint="Project Snapshots||Save named checkpoints of your project — like Git commits for music. Name it something like 'before verse rewrite' and restore any version with one click. Snapshots are stored in your browser."
                onClick={() => { setSnapshotPanelOpen(v => !v); if (!snapshotPanelOpen) loadSnapshots() }}
                style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: snapshotPanelOpen ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)', border: `1px solid ${snapshotPanelOpen ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, color: snapshotPanelOpen ? 'rgba(167,139,250,1)' : 'var(--text-muted)', cursor: 'pointer' }}
              >
                📸 Snapshots
              </button>

              {/* Help / tooltip mode toggle */}
              <TooltipModeToggle />

              {/* Match Studio button */}
              <Tooltip content="Match Studio — sing to a track, AI matches your voice to it" placement="bottom" disabled={matchStudioOpen}>
                <button
                  data-hint="Match Studio||Record your voice singing a melody, then AI transforms it to match the pitch and timbre of a reference track — like Auto-Tune but trained on your own sound."
                  onClick={() => setMatchStudioOpen(v => !v)}
                  style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: matchStudioOpen ? 'rgba(236,72,153,0.15)' : 'var(--bg-card)', border: `1px solid ${matchStudioOpen ? 'rgba(236,72,153,0.4)' : 'var(--border)'}`, color: matchStudioOpen ? 'rgba(244,114,182,1)' : 'var(--text-muted)', cursor: 'pointer' }}
                >
                  ♪ Match
                </button>
              </Tooltip>

              {/* Beat Studio button */}
              <Tooltip content="Beat Studio — beatbox a track, AI reproduces it using only your beatbox" placement="bottom" disabled={beatStudioOpen}>
                <button
                  data-hint="Beat Studio||Beatbox into your microphone and the AI detects each drum hit — kick, snare, hi-hat, clap — and places them as separate clips on their own lanes. Works best in a quiet environment."
                  onClick={() => beatStudioOpen ? closeBeatStudio() : setBeatStudioOpen(true)}
                  style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: beatStudioOpen ? 'rgba(234,179,8,0.15)' : 'var(--bg-card)', border: `1px solid ${beatStudioOpen ? 'rgba(234,179,8,0.4)' : 'var(--border)'}`, color: beatStudioOpen ? 'rgba(250,204,21,1)' : 'var(--text-muted)', cursor: 'pointer' }}
                >
                  ▣ Beat
                </button>
              </Tooltip>

              {/* + Track button */}
              <Tooltip content="Add a new track" placement="bottom">
                <button
                  onClick={() => {
                    const id = addCustomLane()
                    setTimeout(() => { setActiveLaneType(id as BeatType); setSelectedLane(id as BeatType) }, 0)
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  + Track
                </button>
              </Tooltip>

              {!userFeedbackMode ? (
                <button
                  onClick={enterFeedbackMode}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  Feedback
                </button>
              ) : (
                <>
                  <button
                    onClick={sendFeedback}
                    disabled={feedbackSending}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: feedbackSending ? 'var(--bg-card)' : 'var(--accent)', border: 'none', color: feedbackSending ? 'var(--text-muted)' : '#fff', cursor: feedbackSending ? 'default' : 'pointer', fontWeight: 600 }}
                  >
                    <Send size={11} /> {feedbackSending ? 'Sending…' : 'Send Feedback'}
                  </button>
                  <button
                    onClick={() => exitFeedbackMode(true)}
                    style={{ fontSize: 11, padding: '4px 7px', borderRadius: 5, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  >
                    cancel
                  </button>
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'row', minHeight: 0 }}>
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}>

        {phase === 'idle' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 40, overflowY: 'auto' }}>
            {/* Mode selector */}
            <div style={{ display: 'flex', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
              {(['hits', 'loop'] as RecMode[]).map(m => (
                <button key={m} onClick={() => setRecMode(m)} style={{ padding: '5px 16px', borderRadius: 6, border: 'none', cursor: 'pointer', background: recMode === m ? 'var(--border-light)' : 'transparent', color: recMode === m ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 12, fontWeight: recMode === m ? 600 : 400, transition: 'all 0.15s' }}>
                  {m === 'hits' ? 'Beat Grid' : 'Loop'}
                </button>
              ))}
            </div>

            <div style={{ width: 64, height: 64, borderRadius: '50%', background: 'rgba(220,38,38,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(220,38,38,0.3)' }}>
              <Mic size={28} color="#dc2626" />
            </div>
            <div style={{ textAlign: 'center', maxWidth: 360 }}>
              {recMode === 'hits' ? (
                <>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Beatbox your rhythm</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    Select which sounds you&apos;ll beatbox, then hit Record.
                    Hits snap to the detected tempo grid.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 6 }}>Record a loop</p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
                    Record any rhythm or sound. 100Lights detects the tempo and
                    creates a loopable clip you can stretch to any BPM.
                  </p>
                </>
              )}
            </div>

            {/* Sound type selector — hits mode only */}
            {recMode === 'hits' && <div style={{ width: '100%', maxWidth: 420 }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, textAlign: 'center' }}>
                Sounds to detect
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                {ALL_DRUM_TYPES.map(type => {
                  const active = selectedTypes.has(type)
                  const color = TYPE_COLORS[type]
                  return (
                    <button key={type} onClick={() => toggleSelectedType(type)} style={{
                      padding: '8px 4px', borderRadius: 7,
                      border: `1.5px solid ${active ? color : 'var(--border)'}`,
                      background: active ? `${color}18` : 'var(--bg-card)',
                      cursor: 'pointer', color: active ? color : 'var(--text-muted)',
                      fontSize: 11, fontWeight: active ? 700 : 400,
                      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                      transition: 'all 0.15s',
                    }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? color : 'var(--border)' }} />
                      {TYPE_LABELS[type]}
                    </button>
                  )
                })}
              </div>
            </div>}

            {hasSong && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={playSongDuringRec}
                  onChange={e => setPlaySongDuringRec(e.target.checked)}
                  style={{ width: 14, height: 14, accentColor: 'var(--accent)', cursor: 'pointer' }}
                />
                Play song while recording
              </label>
            )}
            {error && <p style={{ fontSize: 12, color: '#ef4444', textAlign: 'center' }}>{error}</p>}
            <button onClick={startRecording} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 22px', borderRadius: 8, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
              <Mic size={15} /> {recMode === 'loop' ? 'Record Loop' : 'Sing the Beat'}
            </button>

            {/* Ground truth — helps AI correct misclassifications */}
            {recMode === 'hits' && (
              <div style={{ width: '100%', maxWidth: 320 }}>
                <button
                  onClick={() => setShowGroundTruth(v => !v)}
                  style={{ fontSize: 11, color: groundTruth.trim() ? 'var(--accent-light)' : 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3 }}
                >
                  {groundTruth.trim()
                    ? `✓ Pattern declared — AI will use as ground truth`
                    : '+ Declare your pattern (helps AI learn)'}
                </button>
                {showGroundTruth && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.6, margin: 0 }}>
                      Describe what you&apos;ll beatbox, e.g. &quot;kick snare kick snare with hihats on every beat&quot;.
                      AI will compare its detections against this and fix mistakes.
                    </p>
                    <textarea
                      value={groundTruth}
                      onChange={e => setGroundTruth(e.target.value)}
                      placeholder="e.g. 4-on-floor kick pattern, snare on 2 and 4, closed hihats on every 8th note"
                      rows={2}
                      style={{ width: '100%', padding: '7px 10px', borderRadius: 7, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 11, lineHeight: 1.5, resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
                    />
                  </div>
                )}
              </div>
            )}

          </div>
        )}

        {phase === 'recording' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 20 }}>
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(220,38,38,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid rgba(220,38,38,0.5)', animation: 'pulse 0.8s ease-in-out infinite' }}>
              <Mic size={36} color="#dc2626" />
            </div>
            <div style={{ textAlign: 'center' }}>
              <p style={{ fontSize: 32, fontFamily: 'monospace', fontWeight: 700, color: '#dc2626' }}>{recordingTime.toFixed(1)}s</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
                {recMode === 'loop'
                  ? 'Recording loop…'
                  : selectedTypes.size > 0
                    ? `Detecting: ${Array.from(selectedTypes).map(t => TYPE_LABELS[t]).join(', ')}`
                    : 'Detecting all drum sounds'}
              </p>
              {startedSongRef.current && (
                <p style={{ fontSize: 11, color: 'var(--accent-light)', marginTop: 2 }}>♪ Song playing in background</p>
              )}
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Click Stop when done</p>
            </div>
          </div>
        )}

        {phase === 'analyzing' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14 }}>
            <RefreshCw size={32} color="var(--accent)" style={{ animation: 'spin 1s linear infinite' }} />
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {stemLabel ? `Analyzing ${stemLabel}…` : 'Detecting hits and snapping to grid…'}
            </p>
            {stemLabel && (
              <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Stem mode — lower noise floor, tighter hit detection
              </p>
            )}
          </div>
        )}

        {/* ── Loop editing ──────────────────────────────────────────────── */}
        {phase === 'editing' && recMode === 'loop' && loopBuffer && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 24, padding: 40 }}>
            <Waveform audioBuffer={loopBuffer} pxWidth={Math.min(600, timelinePx || 600)} />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
              {loopDetectedBpm && (
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Detected BPM: <strong style={{ color: 'var(--text-primary)' }}>{loopDetectedBpm}</strong>
                </p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 70 }}>Target BPM</span>
                <input
                  type="range" min={40} max={220} step={1} value={loopTargetBpm}
                  onChange={e => updateLoopRate(Number(e.target.value))}
                  style={{ width: 180 }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: 'var(--text-primary)', minWidth: 36 }}>
                  {loopTargetBpm}
                </span>
                {loopDetectedBpm && loopTargetBpm !== loopDetectedBpm && (
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {((loopTargetBpm / loopDetectedBpm) * 100 - 100).toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={loopPlaying ? stopLoopPlayback : startLoopPlayback} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 18px', borderRadius: 7, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                {loopPlaying ? <><Pause size={14} fill="#fff" /> Stop</> : <><Play size={14} fill="#fff" style={{ marginLeft: 1 }} /> Play Loop</>}
              </button>
              <button onClick={reset} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 14px', borderRadius: 7, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
                <RefreshCw size={12} /> Re-record
              </button>
            </div>
          </div>
        )}

        {/* ── AI Feedback panel ─────────────────────────────────────────────── */}
        {feedbackItems && (
          <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                AI changed {feedbackItems.length} hit{feedbackItems.length !== 1 ? 's' : ''} — does this look right?
              </span>
              {feedbackRetries > 0 && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>retry {feedbackRetries}/{MAX_RETRIES}</span>
              )}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                {feedbackRetries < MAX_RETRIES && (
                  <button
                    onClick={retryAi}
                    disabled={feedbackLoading}
                    style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: feedbackLoading ? 'var(--text-muted)' : 'var(--text-secondary)', cursor: feedbackLoading ? 'default' : 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                  >
                    {feedbackLoading ? <><RefreshCw size={10} style={{ animation: 'spin 1s linear infinite' }} /> Retrying…</> : '↺ Run again'}
                  </button>
                )}
                <button
                  onClick={confirmFeedback}
                  disabled={feedbackLoading}
                  style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                >
                  Confirm ✓
                </button>
                <button
                  onClick={() => setFeedbackItems(null)}
                  style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Dismiss
                </button>
              </div>
            </div>

            {/* Change list */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {feedbackItems.map(f => (
                <div key={f.hitId} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '3px 8px', borderRadius: 6, background: 'var(--bg-surface)', border: '1px solid var(--border)', fontSize: 11 }}>
                  <span style={{ color: 'var(--text-muted)' }}>{f.time.toFixed(2)}s</span>
                  <span style={{ color: '#ef4444', textDecoration: 'line-through' }}>{typeLabel(f.original, typeOverrides)}</span>
                  <span style={{ color: 'var(--text-muted)' }}>→</span>
                  {/* Editable type picker */}
                  <div style={{ position: 'relative' }}>
                    <select
                      value={f.current}
                      onChange={e => updateFeedbackType(f.hitId, e.target.value as BeatType)}
                      style={{ fontSize: 11, padding: '1px 4px', borderRadius: 4, background: 'var(--bg-card)', color: typeColor(f.current, typeOverrides) ?? 'var(--text-primary)', border: `1px solid ${typeColor(f.current, typeOverrides) ?? 'var(--border)'}`, cursor: 'pointer', fontWeight: 600 }}
                    >
                      {ALL_DRUM_TYPES.map(t => (
                        <option key={t} value={t}>{typeLabel(t, typeOverrides)}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>

            {/* AI reflection (shows after confirm) */}
            {reflection && (
              <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.06em', marginRight: 6 }}>AI reflection</span>
                {reflection}
                <button onClick={() => setReflection(null)} style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            )}
          </div>
        )}

        {/* Reflection shown after feedback dismissed */}
        {!feedbackItems && reflection && (
          <div style={{ borderBottom: '1px solid var(--border)', background: 'rgba(139,92,246,0.06)', padding: '8px 14px', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent-light)', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', marginTop: 1 }}>AI reflection</span>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6, flex: 1 }}>{reflection}</span>
            <button onClick={() => setReflection(null)} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>✕</button>
          </div>
        )}

        {/* ── User feedback panel ───────────────────────────────────────────── */}
        {userFeedbackMode && phase === 'editing' && (
          <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-card)', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Feedback for AI</span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Notes and/or correct any hits below, then press Send Feedback</span>
            </div>
            <textarea
              value={userFeedbackNotes}
              onChange={e => setUserFeedbackNotes(e.target.value)}
              placeholder="Optional: describe what was wrong — e.g. &quot;the kick on beat 2 was labelled as snare&quot;"
              rows={2}
              style={{ width: '100%', padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-primary)', fontSize: 11, lineHeight: 1.5, resize: 'none', boxSizing: 'border-box', fontFamily: 'inherit' }}
            />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {hits.map(h => {
                const original = feedbackSnapshot?.get(h.id)
                const changed = original !== undefined && original !== h.type
                return (
                  <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 5, background: changed ? 'rgba(139,92,246,0.1)' : 'var(--bg-surface)', border: `1px solid ${changed ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, fontSize: 10 }}>
                    <span style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>{h.time.toFixed(2)}s</span>
                    {changed && (
                      <span style={{ color: '#ef4444', textDecoration: 'line-through', fontSize: 9 }}>{typeLabel(original as BeatType, typeOverrides)}</span>
                    )}
                    <select
                      value={h.type}
                      onChange={e => setHits(prev => prev.map(p => p.id === h.id ? { ...p, type: e.target.value as BeatType } : p))}
                      style={{ fontSize: 10, padding: '1px 3px', borderRadius: 3, background: 'transparent', color: changed ? 'var(--accent-light)' : typeColor(h.type, typeOverrides), border: 'none', cursor: 'pointer', fontWeight: changed ? 700 : 400 }}
                    >
                      {allAvailableTypes.map(t => (
                        <option key={t} value={t}>{typeLabel(t, typeOverrides)}</option>
                      ))}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {phase === 'editing' && recMode === 'hits' && duration > 0 && (() => {
          // Render inside AudioEditor's timeline when lanesContainer is provided (portal),
          // otherwise render inline inside the BeatLab panel.
          const inPortal = !!lanesContainer
          const content = (
            <div
              ref={timelineRef}
              style={inPortal
                ? { display: 'flex', flexDirection: 'column', position: 'relative', borderTop: '2px solid rgba(139,92,246,0.3)' }
                : { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
            >
              {/* Horizontal scroll wrapper for zoomed content */}
              <div
                style={{ flex: inPortal ? undefined : 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}
                onWheel={e => {
                  // Ctrl/Cmd+wheel → zoom; plain wheel scrolls horizontally
                  if (e.ctrlKey || e.metaKey) {
                    e.preventDefault()
                    setZoomLevel(z => Math.max(0.25, Math.min(8, z * (e.deltaY > 0 ? 0.85 : 1.18))))
                  }
                }}
              >
                {/* Fixed-width inner column at zoom level */}
                <div style={{ width: HEADER_W + (timelinePx * zoomLevel), minWidth: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  <Playhead time={playhead} duration={duration} pxWidth={timelinePx * zoomLevel} />

                  {/* Ruler — offset HEADER_W to align with hit area */}
                  <div style={{ paddingLeft: HEADER_W }}>
                    <RulerTicks
                      duration={duration} px={timelinePx * zoomLevel}
                      bpm={bpm ?? (masterBpm !== 120 ? masterBpm : null)}
                      abLoop={abLoop} abLoopEnabled={abLoopEnabled}
                      onSeek={handleSeek}
                      onAbLoopDrag={loop => { setAbLoop(loop) }}
                      locators={locators}
                      onLocatorAdd={addLocator}
                      onLocatorRemove={removeLocator}
                    />
                  </div>

                  {/* Waveform */}
                  {audioBuf && <Waveform audioBuffer={audioBuf} pxWidth={timelinePx * zoomLevel} />}

                  {/* Lanes — Arrangement or Session */}
                  {viewMode === 'session' ? (
                    <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto' }}>
                      <Suspense fallback={null}>
                      <SessionView
                        bpm={bpm ?? masterBpm}
                        lanes={activeLaneTypes.map(type => ({
                          type,
                          label: typeLabel(type, typeOverrides),
                          color: typeColor(type, typeOverrides),
                          clips: getSessionLaneClips(type),
                          muted: mutedTypes.has(type),
                        }) satisfies SessionLane)}
                        playing={sessionPlaying}
                        onLaunchScene={sceneIdx => {
                          activeLaneTypes.forEach(t => {
                            if (sessionClips[t]?.[sceneIdx]) {
                              setSessionPlaying(prev => ({ ...prev, [t]: sceneIdx }))
                              void startSessionClipAudio(t, sceneIdx)
                            } else {
                              stopSessionLaneAudio(t)
                              setSessionPlaying(prev => ({ ...prev, [t]: null }))
                            }
                          })
                        }}
                        onLaunchClip={(laneType, sceneIdx) => {
                          setSessionPlaying(prev => ({ ...prev, [laneType]: sceneIdx }))
                          void startSessionClipAudio(laneType, sceneIdx)
                        }}
                        onStopLane={laneType => {
                          stopSessionLaneAudio(laneType)
                          setSessionPlaying(prev => ({ ...prev, [laneType]: null }))
                        }}
                        onStopAll={() => {
                          for (const lt of sessionTimersRef.current.keys()) stopSessionLaneAudio(lt)
                          setSessionPlaying({})
                        }}
                        onAddClip={(laneType, sceneIdx, clip) => {
                          setSessionClips(prev => {
                            const row = getSessionLaneClips(laneType).slice()
                            row[sceneIdx] = clip
                            return { ...prev, [laneType]: row }
                          })
                        }}
                        onRemoveClip={(laneType, sceneIdx) => {
                          setSessionClips(prev => {
                            const row = getSessionLaneClips(laneType).slice()
                            row[sceneIdx] = null
                            return { ...prev, [laneType]: row }
                          })
                          setSessionPlaying(prev => prev[laneType] === sceneIdx ? { ...prev, [laneType]: null } : prev)
                        }}
                        onEditClip={(laneType) => {
                          setViewMode('arrangement')
                          setActiveLaneType(laneType as BeatType)
                        }}
                      />
                      </Suspense>
                    </div>
                  ) : (
                  <div
                    ref={laneRowsRef}
                    onMouseDown={startGlobalDrag}
                    style={inPortal ? { position: 'relative' } : { flex: 1, overflowY: 'auto', position: 'relative' }}
                  >
                    {/* Cross-lane drag-select rectangle */}
                    {globalSelBox && (
                      <div style={{
                        position: 'absolute',
                        zIndex: 50,
                        pointerEvents: 'none',
                        left:   Math.min(globalSelBox.x1, globalSelBox.x2),
                        top:    Math.min(globalSelBox.y1, globalSelBox.y2),
                        width:  Math.abs(globalSelBox.x2 - globalSelBox.x1),
                        height: Math.abs(globalSelBox.y2 - globalSelBox.y1),
                        background: 'rgba(99,102,241,0.08)',
                        border: '1px solid rgba(99,102,241,0.6)',
                        borderRadius: 2,
                      }} />
                    )}
                    {(() => {
                      const renderedSet = new Set<string>()

                      const renderLaneRow = (type: string, indented = false) => {
                        const isGroupBus   = groupDefs.some(g => g.id === type)
                        const isDropTarget = dragInsertBefore === type && dragLane !== type
                        return (
                          <div
                            key={type}
                            onDragOver={e => {
                              if (!dragLane || dragLane === type) return
                              e.preventDefault(); e.dataTransfer.dropEffect = 'move'
                              const rect = e.currentTarget.getBoundingClientRect()
                              const mid  = rect.top + rect.height / 2
                              setDragInsertBefore(e.clientY < mid ? type : null)
                            }}
                            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragInsertBefore(null) }}
                            onDrop={e => {
                              e.preventDefault()
                              const insertBefore = dragInsertBefore === type ? type : null
                              setDragInsertBefore(null)
                              if (dragLane) handleLaneDrop(dragLane, insertBefore)
                              setDragLane(null)
                            }}
                            style={{
                              opacity: dragLane === type ? 0.3 : 1,
                              borderTop: isDropTarget ? '2px solid var(--accent)' : '2px solid transparent',
                              borderLeft: indented ? '3px solid rgba(139,92,246,0.25)' : '3px solid transparent',
                              transition: 'border-color 0.08s, opacity 0.08s',
                            }}
                          >
                          <div style={{ display: 'flex' }}>
                            <Tooltip content="Drag to reorder track" placement="right" delay={600}>
                            <div
                              draggable={!isGroupBus}
                              onDragStart={e => { if (!isGroupBus) { e.dataTransfer.effectAllowed = 'move'; setDragLane(type); if (!laneOrder) setLaneOrder(activeLaneTypes.map(t => t as string)) } }}
                              onDragEnd={() => { setDragLane(null); setDragInsertBefore(null) }}
                              style={{
                                width: 24, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                cursor: isGroupBus ? 'default' : 'grab', color: 'var(--text-muted)', fontSize: 10,
                                opacity: 0.5, userSelect: 'none',
                                position: 'sticky', left: 0, zIndex: 4,
                                background: 'var(--bg-surface)',
                              }}
                            >
                              {!isGroupBus && '⠿'}
                            </div>
                          </Tooltip>
                        <Lane
                          type={type as BeatType}
                          hits={hitsByType.get(type as BeatType) ?? []}
                          clips={audioClipsByLane.get(type as BeatType) ?? []}
                          duration={duration}
                          pxWidth={timelinePx * zoomLevel}
                          selectedIds={selectedIds}
                          muted={mutedTypes.has(type as BeatType)}
                          aiSuggestions={aiSuggestions}
                          aiDeletions={aiDeletions}
                          typeOverrides={typeOverrides}
                          isCustom={extraLaneIds.includes(type)}
                          isActiveLane={activeLaneType === type}
                          snapInterval={snapInterval}
                          onSelectHit={selectHit}
                          onSelectLane={() => { setActiveLaneType(type as BeatType); setSelectedLane(type as BeatType); setInspectorOpen(true) }}
                          onOpenPianoRoll={MELODIC_TYPES.has(type as BeatType) ? () => setPianoRollLane(type as BeatType) : undefined}
                          onOpenStepSeq={() => setStepSeqLane(type as BeatType)}
                          onOpenChordBuilder={MELODIC_TYPES.has(type as BeatType) ? () => setChordBuilderLane(type as BeatType) : undefined}
                          level={laneLevels[type] ?? 0}
                          pan={lanePans[type] ?? 0}
                          soloed={soloedLanes.has(type)}
                          anySoloed={soloedLanes.size > 0}
                          onPanChange={v => setLanePans(prev => ({ ...prev, [type]: v }))}
                          onSoloToggle={() => toggleSolo(type)}
                          effects={laneEffects[type] ?? []}
                          fxOpen={fxOpenLanes.has(type)}
                          fxAddOpen={fxAddOpen === type}
                          onFxToggleOpen={() => setFxOpenLanes(prev => { const s = new Set(prev); s.has(type) ? s.delete(type) : s.add(type); return s })}
                          onFxAddOpen={() => setFxAddOpen(type)}
                          onFxAddClose={() => setFxAddOpen(null)}
                          onFxAdd={t => addLaneEffect(type, t)}
                          onFxRemove={id => removeLaneEffect(type, id)}
                          onFxToggleEnabled={id => updateLaneEffect(type, id, { enabled: !laneEffects[type]?.find(f => f.id === id)?.enabled })}
                          onFxParamChange={(id, key, val) => updateLaneEffectParam(type, id, key, val)}
                          onFxRandomize={() => {
                            setLaneEffects(prev => {
                              const effects = prev[type] ?? []
                              return {
                                ...prev,
                                [type]: effects.map(fx => {
                                  if (!fx.enabled) return fx
                                  const specs = FX_PARAM_SPECS[fx.type] ?? []
                                  const newParams = { ...fx.params }
                                  for (const spec of specs) {
                                    const cur = fx.params[spec.key] ?? ((spec.min + spec.max) / 2)
                                    const range = spec.max - spec.min
                                    const jitter = (Math.random() - 0.5) * range * 0.4
                                    newParams[spec.key] = Math.max(spec.min, Math.min(spec.max, cur + jitter))
                                  }
                                  return { ...fx, params: newParams }
                                }),
                              }
                            })
                          }}
                          automLanes={automLanes.filter(a => a.laneType === type)}
                          automOpen={automOpenLanes.has(type)}
                          automAddOpen={automAddOpen === type}
                          onAutomToggle={() => setAutomOpenLanes(prev => { const s = new Set(prev); s.has(type) ? s.delete(type) : s.add(type); return s })}
                          onAutomAddOpen={() => setAutomAddOpen(type)}
                          onAutomAddClose={() => setAutomAddOpen(null)}
                          onAutomAdd={param => addAutomLane(type, param)}
                          onAutomRemove={id => removeAutomLane(id)}
                          onAutomPointAdd={(id, pt) => addAutomPoint(id, pt)}
                          onAutomPointUpdate={(id, ptId, upd) => updateAutomPoint(id, ptId, upd)}
                          onAutomPointDelete={(id, ptId) => deleteAutomPoint(id, ptId)}
                          onClipRightClick={(e, clipId) => setClipMenu({ clipId, x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 160) })}
                          onClipDelete={clipId => { setAudioClips(prev => prev.filter(c => c.id !== clipId)); setSelectedClipIds(prev => { const n = new Set(prev); n.delete(clipId); return n }) }}
                          onClipSelect={(clipId, additive) => setSelectedClipIds(prev => {
                            if (additive) { const n = new Set(prev); prev.has(clipId) ? n.delete(clipId) : n.add(clipId); return n }
                            return prev.has(clipId) && prev.size === 1 ? new Set() : new Set([clipId])
                          })}
                          onMultiSelect={(clipIds, additive) => setSelectedClipIds(prev => {
                            if (additive) { const n = new Set(prev); clipIds.forEach(id => n.add(id)); return n }
                            return new Set(clipIds)
                          })}
                          selectedClipIds={selectedClipIds}
                          onClipUpdate={(clipId, update) => {
                            setAudioClips(prev => prev.map(c => {
                              if (c.id !== clipId) return c
                              const next = { ...c, ...update }
                              const effEnd = next.startTime + (next.loopDuration ?? next.stretchDuration ?? next.buf.duration)
                              setDuration(d => Math.max(d, effEnd + 0.5))
                              return next
                            }))
                          }}
                          onMoveHit={moveHit}
                          onDeleteHit={deleteHit}
                          onAddHit={(t, note) => addHit(type as BeatType, t, note)}
                          onLibraryDrop={(entryId, t) => handleLibraryDropOnLane(type, entryId, t)}
                          onToggleMute={() => toggleMute(type as BeatType)}
                          onLaneContextMenu={e => setLaneMenu({ type: type as BeatType, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 200) })}
                          onHitRightClick={(e, id) => setHitMenu({ hitId: id, x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - 340) })}
                          miniMode={miniLanes.has(type)}
                          spectrumOpen={specLanes.has(type)}
                          analyserNode={laneAnalysersRef.current.get(type as BeatType) ?? null}
                          onToggleMini={() => toggleMiniLane(type)}
                          onToggleSpectrum={() => toggleSpecLane(type)}
                          loopBeats={laneLoopBeats[type] ?? 0}
                          onLoopBeatsChange={beats => setLaneLoopBeats(prev => ({ ...prev, [type]: beats }))}
                          inputArmed={inputLanes.has(type)}
                          inputSource={inputSource[type]}
                          onToggleInput={() => toggleInputLane(type)}
                          onOpenInputPicker={() => setInputSourcePickerLane(type)}
                          allLaneTypes={activeLaneTypes}
                          sidechains={Object.fromEntries(
                            Object.entries(laneSidechains)
                              .filter(([k]) => k.startsWith(`${type as string}:`))
                              .map(([k, v]) => [k.slice((type as string).length + 1), v])
                          )}
                          onSidechainChange={(effectId, val) =>
                            setLaneSidechains(prev => ({ ...prev, [`${type as string}:${effectId}`]: val }))
                          }
                        />
                          </div>
                          </div>
                        )
                      }

                      return displayedLaneTypes.flatMap(type => {
                        if (renderedSet.has(type)) return []
                        renderedSet.add(type)

                        const isGroupBus = groupDefs.some(g => g.id === type)
                        const group      = groupDefs.find(g => g.id === type)
                        const inGroup    = groupDefs.some(g => g.childTypes.includes(type))

                        // Ungrouped child lane (orphan) — render normally
                        if (!isGroupBus && !inGroup) return [renderLaneRow(type)]

                        // Lane that belongs to a group but we haven't hit its group bus yet — skip (rendered below)
                        if (!isGroupBus && inGroup) return []

                        // Group bus — render header + bus lane + all children inline
                        const children = (group?.childTypes ?? []).filter(c => activeLaneTypes.includes(c as BeatType))
                        children.forEach(c => renderedSet.add(c))

                        const isGroupDropTarget = dragInsertBefore === type && dragLane !== type
                        return [
                          // Folder header (shows insert-before indicator for groups too)
                          <div
                            key={`hdr-${type}`}
                            onDragOver={e => {
                              if (!dragLane || dragLane === type) return
                              e.preventDefault(); e.dataTransfer.dropEffect = 'move'
                              const rect = e.currentTarget.getBoundingClientRect()
                              setDragInsertBefore(e.clientY < rect.top + rect.height / 2 ? type : null)
                            }}
                            onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragInsertBefore(null) }}
                            onDrop={e => {
                              e.preventDefault()
                              const insertBefore = dragInsertBefore === type ? type : null
                              setDragInsertBefore(null)
                              if (dragLane) handleLaneDrop(dragLane, insertBefore)
                              setDragLane(null)
                            }}
                            style={{ display: 'flex', alignItems: 'center', height: 26, background: 'var(--bg-surface)', borderTop: isGroupDropTarget ? '2px solid var(--accent)' : '2px solid transparent', borderBottom: '1px solid rgba(139,92,246,0.2)', paddingLeft: HEADER_W, transition: 'border-color 0.08s', cursor: 'default' }}>
                            <button onClick={() => toggleGroupCollapse(type)}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, padding: '0 6px' }}>
                              {group?.collapsed ? '▶' : '▼'}
                            </button>
                            <div style={{ width: 7, height: 7, borderRadius: '50%', background: group?.color ?? '#6b7280', marginRight: 5, flexShrink: 0 }} />
                            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>{group?.label ?? 'Group'}</span>
                            <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>{children.length} tracks</span>
                          </div>,
                          // Children (only if not collapsed)
                          ...(group?.collapsed ? [] : children.map(c => renderLaneRow(c, true))),
                        ]
                      })
                    })()}
                    {/* Drop-at-end zone */}
                    {dragLane && (
                      <div
                        onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragInsertBefore(null) }}
                        onDrop={e => { e.preventDefault(); if (dragLane) handleLaneDrop(dragLane, null); setDragLane(null); setDragInsertBefore(null) }}
                        style={{ height: 28, borderTop: dragInsertBefore === null ? '2px solid var(--accent)' : '2px solid transparent', transition: 'border-color 0.08s' }}
                      />
                    )}
                  </div>
                  )}

                  {/* Legend */}
                  <div style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    {activeLaneTypes.map(t => (
                      <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: mutedTypes.has(t) ? 'var(--text-muted)' : 'var(--text-secondary)', opacity: mutedTypes.has(t) ? 0.5 : 1 }}>
                        <div style={{ width: 7, height: 7, borderRadius: '50%', background: typeColor(t, typeOverrides) }} />
                        {typeLabel(t, typeOverrides)} ({hitsByType.get(t)?.length ?? 0})
                      </span>
                    ))}
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
                      {onAddTrack && hits.length > 0 && (
                        <button
                          onClick={addToProject}
                          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 12px', borderRadius: 5, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                        >
                          + Add to Project
                        </button>
                      )}
                      <span style={{ fontSize: 10, color: 'var(--border-light)' }}>
                        Click lane to select · Right-click lane for options · Shift+click notes to multi-select
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )
          return inPortal ? createPortal(content, lanesContainer!) : content
        })()}

      </div>{/* end inner column */}

      {/* ── Inspector Panel ───────────────────────────────────────────────── */}
      {inspectorOpen && (
        <Suspense fallback={null}>
          <InspectorPanel
            lane={selectedLane ? (() => {
              const t = selectedLane
              const lvl = laneLevels[t] ?? 0
              return {
                type: t,
                label: typeLabel(t, typeOverrides),
                color: typeColor(t, typeOverrides),
                hitCount: hitsByType.get(t)?.length ?? 0,
                level: lvl,
                pan: lanePans[t] ?? 0,
                muted: mutedTypes.has(t),
                soloed: soloedLanes.has(t),
                effectCount: (laneEffects[t] ?? []).length,
                automCount: automLanes.filter(a => a.laneType === t).length,
              }
            })() : null}
            bpm={bpm}
            duration={duration}
            totalHits={hits.length}
            laneCount={activeLaneTypes.length}
            onClose={() => setInspectorOpen(false)}
            onMute={() => selectedLane && toggleMute(selectedLane)}
            onSolo={() => selectedLane && toggleSolo(selectedLane)}
            onPanChange={v => selectedLane && setLanePans(prev => ({ ...prev, [selectedLane]: v }))}
            onOpenPianoRoll={selectedLane && MELODIC_TYPES.has(selectedLane) ? () => { setPianoRollLane(selectedLane!); setInspectorOpen(false) } : undefined}
            onOpenStepSeq={selectedLane ? () => { setStepSeqLane(selectedLane!); setInspectorOpen(false) } : undefined}
            onOpenChordBuilder={selectedLane && MELODIC_TYPES.has(selectedLane) ? () => { setChordBuilderLane(selectedLane!); setInspectorOpen(false) } : undefined}
            onOpenArpeggiator={selectedLane ? () => { setArpLane(selectedLane!); setInspectorOpen(false) } : undefined}
            onToggleFx={() => selectedLane && setFxOpenLanes(prev => { const s = new Set(prev); s.has(selectedLane!) ? s.delete(selectedLane!) : s.add(selectedLane!); return s })}
            onToggleAutom={() => selectedLane && setAutomOpenLanes(prev => { const s = new Set(prev); s.has(selectedLane!) ? s.delete(selectedLane!) : s.add(selectedLane!); return s })}
          />
        </Suspense>
      )}

      </div>{/* end outer row */}

      {/* AI Feedback card modal */}
      {showFeedbackCard && ((aiSuggestions?.size ?? 0) > 0 || aiDeletions.size > 0) && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setShowFeedbackCard(false)}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
            zIndex: 201, background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 24, width: 320, boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            {(() => {
              const reclassify = aiSuggestions?.size ?? 0
              const del = aiDeletions.size
              const total = reclassify + del
              return (
                <>
                  <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
                    AI made {total} suggestion{total !== 1 ? 's' : ''}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: del > 0 ? 6 : 16, lineHeight: 1.5 }}>
                    How does the current detection look to you?
                  </p>
                  {del > 0 && (
                    <p style={{ fontSize: 11, color: 'rgba(239,68,68,0.8)', marginBottom: 16, lineHeight: 1.4 }}>
                      ✕ {del} hit{del !== 1 ? 's' : ''} flagged as noise/false detection
                      {reclassify > 0 && ` · ${reclassify} reclassification${reclassify !== 1 ? 's' : ''}`}
                    </p>
                  )}
                </>
              )
            })()}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button
                onClick={() => { setAiSuggestions(null); setAiDeletions(new Set()); setShowFeedbackCard(false) }}
                style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Good</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Current labels look fine — no changes needed</div>
              </button>
              <button
                onClick={programWasRight}
                style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Program was right</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Machine detection was correct, AI made mistakes — teach it</div>
              </button>
              <button
                onClick={aiWasRight}
                style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.4)', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-light)', marginBottom: 2 }}>AI was right</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Apply all AI corrections and save for learning</div>
              </button>
              <button
                onClick={() => { applyAiSuggestions(); setShowFeedbackCard(false) }}
                style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card)', border: '1px solid var(--border)', cursor: 'pointer', textAlign: 'left', width: '100%' }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 2 }}>Correct</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Apply AI changes and fine-tune each hit manually</div>
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Hit right-click context menu ─────────────────────────────────── */}
      {hitMenu && (() => {
        const hit = hits.find(h => h.id === hitMenu.hitId)
        if (!hit) return null
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setHitMenu(null)} onContextMenu={e => { e.preventDefault(); setHitMenu(null) }} />
            <div style={{
              position: 'fixed', left: hitMenu.x, top: hitMenu.y, zIndex: 300,
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '12px 14px', width: 240, boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: 11,
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>Edit Hit</span>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace' }}>@ {hit.time.toFixed(3)}s</span>
              </div>

              {/* Type */}
              <div>
                <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Sound Type</p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {allAvailableTypes.map(t => (
                    <button
                      key={t}
                      onClick={() => changeHitType(hit.id, t)}
                      style={{
                        fontSize: 10, padding: '3px 7px', borderRadius: 4, cursor: 'pointer', fontWeight: hit.type === t ? 700 : 400,
                        background: hit.type === t ? `${typeColor(t, typeOverrides)}22` : 'var(--bg-card)',
                        border: `1px solid ${hit.type === t ? typeColor(t, typeOverrides) : 'var(--border)'}`,
                        color: hit.type === t ? typeColor(t, typeOverrides) : 'var(--text-muted)',
                      }}
                    >{typeLabel(t, typeOverrides)}</button>
                  ))}
                </div>
              </div>

              {/* Velocity */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Velocity</p>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{Math.round(hit.velocity * 100)}%</span>
                </div>
                <input type="range" min={0.05} max={1} step={0.05} value={hit.velocity}
                  onChange={e => changeHitVelocity(hit.id, Number(e.target.value))}
                  style={{ width: '100%' }} className="cf-slider" />
              </div>

              {/* Length */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <p style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Length</p>
                  <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{Math.round((hit.duration ?? 0.05) * 1000)}ms</span>
                </div>
                <input type="range" min={0.02} max={0.6} step={0.01} value={hit.duration ?? 0.05}
                  onChange={e => changeHitDuration(hit.id, Number(e.target.value))}
                  style={{ width: '100%' }} className="cf-slider" />
              </div>

              {/* Delete */}
              <button
                onClick={() => { deleteHit(hit.id); setHitMenu(null) }}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
              >
                <Trash2 size={12} /> Delete Hit
              </button>
            </div>
          </>
        )
      })()}

      {/* ── Lane right-click context menu ─────────────────────────────────── */}
      {laneMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => { setLaneMenu(null); setLaneMenuEdit(null); setLaneMenuChanging(false) }} onContextMenu={e => { e.preventDefault(); setLaneMenu(null); setLaneMenuEdit(null); setLaneMenuChanging(false) }} />
          <div style={{
            position: 'fixed', left: laneMenu.x, top: laneMenu.y, zIndex: 300,
            background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 10, padding: 8, minWidth: 190, boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: 2,
          }}>
            {laneMenuEdit ? (
              /* Rename form */
              <div style={{ padding: '6px 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  autoFocus
                  value={laneMenuEdit.label}
                  onChange={e => setLaneMenuEdit(m => m && ({ ...m, label: e.target.value }))}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { renameType(laneMenu.type, laneMenuEdit.label, laneMenuEdit.color); setLaneMenu(null); setLaneMenuEdit(null) }
                    if (e.key === 'Escape') setLaneMenuEdit(null)
                  }}
                  placeholder="Track name"
                  style={{ fontSize: 12, padding: '4px 8px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
                />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {CUSTOM_PALETTE.map(c => (
                    <button key={c} onClick={() => setLaneMenuEdit(m => m && ({ ...m, color: c }))}
                      style={{ width: 16, height: 16, borderRadius: '50%', background: c, border: laneMenuEdit.color === c ? '2px solid #fff' : '2px solid transparent', cursor: 'pointer', outline: laneMenuEdit.color === c ? `2px solid ${c}` : 'none' }} />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => { renameType(laneMenu.type, laneMenuEdit.label, laneMenuEdit.color); setLaneMenu(null); setLaneMenuEdit(null) }}
                    style={{ flex: 1, fontSize: 11, padding: '4px 0', borderRadius: 5, background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Save</button>
                  <button onClick={() => setLaneMenuEdit(null)}
                    style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}>Cancel</button>
                </div>
              </div>
            ) : laneMenuChanging ? (
              /* Change type picker */
              <div style={{ padding: '4px 2px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 6px 6px' }}>
                  <button onClick={() => setLaneMenuChanging(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, fontSize: 14, lineHeight: 1 }}>‹</button>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)' }}>Change instrument to…</span>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 4px' }}>
                  {allAvailableTypes.filter(t => t !== laneMenu.type).map(t => (
                    <button
                      key={t}
                      onClick={() => { reassignLane(laneMenu.type, t); setLaneMenuChanging(false) }}
                      style={{ fontSize: 10, padding: '3px 7px', borderRadius: 4, cursor: 'pointer', background: `${typeColor(t, typeOverrides)}15`, border: `1px solid ${typeColor(t, typeOverrides)}55`, color: typeColor(t, typeOverrides), fontWeight: 600 }}
                    >{typeLabel(t, typeOverrides)}</button>
                  ))}
                </div>
              </div>
            ) : (
              /* Main menu items */
              <>
                {[
                  { label: 'Rename', action: () => setLaneMenuEdit({ label: typeLabel(laneMenu.type, typeOverrides), color: typeColor(laneMenu.type, typeOverrides) }) },
                  { label: 'Change instrument', action: () => setLaneMenuChanging(true) },
                  { label: mutedTypes.has(laneMenu.type) ? 'Unmute' : 'Mute', action: () => { toggleMute(laneMenu.type); setLaneMenu(null) } },
                  { label: soloedLanes.has(laneMenu.type) ? 'Unsolo' : 'Solo', action: () => { toggleSolo(laneMenu.type); setLaneMenu(null) } },
                  { label: '──────', action: null, danger: false },
                  ...(MELODIC_TYPES.has(laneMenu.type) ? [{ label: 'Open Piano Roll', action: () => { setPianoRollLane(laneMenu.type); setLaneMenu(null) } }] : []),
                  { label: 'Step Sequencer', action: () => { setStepSeqLane(laneMenu.type); setLaneMenu(null) } },
                  ...(MELODIC_TYPES.has(laneMenu.type) ? [{ label: 'Chord Builder', action: () => { setChordBuilderLane(laneMenu.type); setLaneMenu(null) } }] : []),
                  { label: 'Arpeggiator', action: () => { setArpLane(laneMenu.type as BeatType); setLaneMenu(null) } },
                  { label: 'Open Sampler', action: async () => { const { DEFAULT_SAMPLER_PATCH } = await import('@/lib/sampler-engine'); setSamplerPatch(DEFAULT_SAMPLER_PATCH); setSamplerLane(laneMenu.type); setLaneMenu(null) } },
                  { label: 'Open Wavetable Synth', action: async () => { const { WAVETABLE_PRESETS } = await import('@/lib/wavetable-synth'); setWavetablePatch(Object.values(WAVETABLE_PRESETS)[0]); setWavetableLane(laneMenu.type); setLaneMenu(null) } },
                  { label: 'Open FM Synth', action: async () => { const { FM_PRESETS } = await import('@/lib/fm-synth'); setFmPatch(Object.values(FM_PRESETS)[0]); setFmSynthLane(laneMenu.type); setLaneMenu(null) } },
                  { label: `FX Chain${(laneEffects[laneMenu.type]?.length ?? 0) > 0 ? ` (${laneEffects[laneMenu.type].length})` : ''}`, action: () => { setFxOpenLanes(prev => { const s = new Set(prev); s.add(laneMenu!.type); return s }); setLaneMenu(null) } },
                  { label: `Automation`, action: () => { setAutomOpenLanes(prev => { const s = new Set(prev); s.add(laneMenu!.type); return s }); setLaneMenu(null) } },
                  { label: `Spectrum ${specLanes.has(laneMenu.type) ? '✓' : ''}`, action: () => { toggleSpecLane(laneMenu.type); setLaneMenu(null) } },
                  { label: miniLanes.has(laneMenu.type) ? 'Expand lane' : 'Collapse lane', action: () => { toggleMiniLane(laneMenu.type); setLaneMenu(null) } },
                  { label: '──────', action: null, danger: false },
                  ...(groupDefs.find(g => g.childTypes.includes(laneMenu.type))
                    ? [{ label: 'Remove from group', action: () => { removeLaneFromGroup(laneMenu.type); setLaneMenu(null) } }]
                    : groupDefs.length > 0
                      ? groupDefs.map(g => ({ label: `Add to: ${g.label}`, action: () => { addLaneToGroup(laneMenu.type, g.id); setLaneMenu(null) } }))
                      : []),
                  { label: 'Create new group', action: () => { createGroup(); setLaneMenu(null) } },
                  { label: '──────', action: null, danger: false },
                  ...(activeLaneTypes.length > 1
                    ? [{ label: 'Delete lane', action: () => { removeLane(laneMenu.type); setLaneMenu(null) }, danger: true }]
                    : []),
                ].map((item, idx) => item.action === null
                  ? <div key={idx} style={{ height: 1, background: 'var(--border)', margin: '3px 8px' }} />
                  : <button key={item.label} onClick={item.action ?? undefined}
                      style={{ width: '100%', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12, color: (item as {danger?: boolean}).danger ? '#ef4444' : 'var(--text-primary)', borderRadius: 6 }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >{item.label}</button>
                )}
                {/* Sends */}
                <div style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 6, padding: '6px 10px 4px' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Sends</div>
                  {[
                    { label: 'Reverb', key: laneMenu.type, val: laneReverb[laneMenu.type] ?? 0, set: (v: number) => setLaneReverb(p => ({ ...p, [laneMenu!.type]: v })) },
                    { label: 'Delay',  key: laneMenu.type, val: laneDelay[laneMenu.type]  ?? 0, set: (v: number) => setLaneDelay(p => ({ ...p, [laneMenu!.type]: v })) },
                  ].map(({ label, val, set }) => (
                    <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                      <span style={{ fontSize: 10, color: 'var(--text-secondary)', minWidth: 36 }}>{label}</span>
                      <input type="range" min={0} max={1} step={0.01} value={val}
                        onChange={e => set(Number(e.target.value))}
                        style={{ flex: 1, accentColor: 'var(--accent)', cursor: 'pointer' }} />
                      <span style={{ fontSize: 9, fontFamily: 'monospace', color: 'var(--text-muted)', minWidth: 26, textAlign: 'right' }}>{Math.round(val * 100)}%</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Save to Library modal ────────────────────────────────────────── */}
      {saveToLibBuf && (
        <AddToLibraryModal
          initialBuffer={saveToLibBuf}
          onClose={() => setSaveToLibBuf(null)}
          onAdded={() => setSaveToLibBuf(null)}
        />
      )}

      {/* ── Convert card modal ────────────────────────────────────────────── */}
      {convertCard && (() => {
        const clip = audioClips.find(c => c.id === convertCard.clipId)
        if (!clip) return null
        const mode = convertCard.mode
        const isSynth = mode === 'synth'
        const o = convertCard.synthOpts
        const srcDur = (clip.originalBuf ?? clip.buf).duration

        const sectionLabel = (text: string) => (
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, marginTop: 14 }}>{text}</div>
        )
        const chipGroup = (options: { label: string; value: string }[], current: string, set: (v: string) => void) => (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {options.map(opt => (
              <button key={opt.value} onClick={() => set(opt.value)} style={{
                padding: '5px 12px', borderRadius: 6, border: '1px solid',
                fontSize: 12, cursor: 'pointer', fontWeight: current === opt.value ? 600 : 400,
                background: current === opt.value ? 'rgba(139,92,246,0.18)' : 'var(--bg-card)',
                borderColor: current === opt.value ? 'rgba(139,92,246,0.5)' : 'var(--border)',
                color: current === opt.value ? 'var(--accent-light)' : 'var(--text-secondary)',
              }}>{opt.label}</button>
            ))}
          </div>
        )

        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.45)' }} onClick={() => setConvertCard(null)} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              zIndex: 201, background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 14, padding: 24, width: isSynth ? 400 : 340, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                Convert to {isSynth ? 'Synth' : 'Beats'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                {clip.name} · {srcDur.toFixed(1)}s{clip.originalBuf ? ' · from original' : ''}
              </div>

              {isSynth ? (() => {
                const search = (convertCard.refSearch ?? '').toLowerCase()
                const cat    = convertCard.refCategory ?? 'all'
                const CATS   = ['all', 'lead', 'pad', 'bass', 'keys', 'strings', 'experimental'] as const
                const filtered = SAMPLE_LIBRARY.filter(p =>
                  (cat === 'all' || p.category === cat) &&
                  (!search || p.name.toLowerCase().includes(search) || p.description.toLowerCase().includes(search))
                )
                const selectedPreset = SAMPLE_LIBRARY.find(p => p.id === convertCard.referenceId)
                return (
                  <>
                    {/* Search */}
                    <input
                      placeholder="Search sounds…"
                      value={convertCard.refSearch ?? ''}
                      onChange={e => setConvertCard(c => c ? { ...c, refSearch: e.target.value } : c)}
                      style={{
                        width: '100%', boxSizing: 'border-box', marginTop: 10,
                        background: 'var(--bg-card)', border: '1px solid var(--border)',
                        borderRadius: 7, padding: '7px 10px', fontSize: 12,
                        color: 'var(--text-primary)', outline: 'none',
                      }}
                      onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)' }}
                      onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)' }}
                    />

                    {/* Category tabs */}
                    <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                      {CATS.map(c => (
                        <button key={c} onClick={() => setConvertCard(cc => cc ? { ...cc, refCategory: c } : cc)} style={{
                          padding: '3px 9px', borderRadius: 5, border: '1px solid', fontSize: 10, cursor: 'pointer',
                          fontWeight: cat === c ? 600 : 400, textTransform: 'capitalize',
                          background: cat === c ? 'rgba(139,92,246,0.18)' : 'transparent',
                          borderColor: cat === c ? 'rgba(139,92,246,0.5)' : 'var(--border)',
                          color: cat === c ? 'var(--accent-light)' : 'var(--text-muted)',
                        }}>{c}</button>
                      ))}
                    </div>

                    {/* Sample grid */}
                    <div style={{
                      display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
                      marginTop: 8, maxHeight: 200, overflowY: 'auto',
                      paddingRight: 2,
                    }}>
                      {filtered.map(preset => {
                        const isSelected = convertCard.referenceId === preset.id
                        const isLoading  = convertCard.referenceLoading && isSelected
                        return (
                          <button key={preset.id} onClick={async () => {
                            if (isSelected) return
                            setConvertCard(c => c ? { ...c, referenceId: preset.id, referenceLoading: true } : c)
                            const buf = await getSampleBuffer(preset.id)
                            const profile = buf ? extractHarmonicProfile(buf, 261.63) : null
                            setConvertCard(c => c ? { ...c, referenceBuf: buf, harmProfile: profile, referenceLoading: false } : c)
                          }} style={{
                            textAlign: 'left', padding: '8px 10px', borderRadius: 7, border: '1px solid',
                            cursor: 'pointer', background: isSelected ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)',
                            borderColor: isSelected ? 'rgba(139,92,246,0.55)' : 'var(--border)',
                            opacity: isLoading ? 0.5 : 1, transition: 'border-color 0.1s, background 0.1s',
                          }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: isSelected ? 'var(--accent-light)' : 'var(--text-primary)', marginBottom: 2 }}>
                              {isLoading ? '…' : preset.name}
                            </div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                              {preset.description}
                            </div>
                          </button>
                        )
                      })}
                      {filtered.length === 0 && (
                        <div style={{ gridColumn: '1/-1', fontSize: 11, color: 'var(--text-muted)', padding: '16px 0', textAlign: 'center' }}>
                          No sounds match
                        </div>
                      )}
                      {/* Custom upload — always shown at end */}
                      <label style={{
                        textAlign: 'left', padding: '8px 10px', borderRadius: 7,
                        border: `1px dashed ${convertCard.referenceId === 'custom' ? 'rgba(139,92,246,0.55)' : 'var(--border)'}`,
                        cursor: 'pointer', background: convertCard.referenceId === 'custom' ? 'rgba(139,92,246,0.15)' : 'transparent',
                      }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: convertCard.referenceId === 'custom' ? 'var(--accent-light)' : 'var(--text-secondary)' }}>
                          Upload file ↑
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>
                          Any audio file
                        </div>
                        <input type="file" accept="audio/*" hidden onChange={async e => {
                          const file = e.target.files?.[0]
                          if (!file) return
                          setConvertCard(c => c ? { ...c, referenceId: 'custom', referenceLoading: true } : c)
                          try {
                            const buf = await decodeAudio(file)
                            const profile = extractHarmonicProfile(buf)
                            setConvertCard(c => c ? { ...c, referenceBuf: buf, harmProfile: profile, referenceLoading: false } : c)
                          } catch {
                            setConvertCard(c => c ? { ...c, referenceId: undefined, referenceLoading: false } : c)
                            showToast('Could not decode reference audio')
                          }
                          e.target.value = ''
                        }} />
                      </label>
                    </div>

                    {/* Selected description */}
                    {(selectedPreset || convertCard.referenceId === 'custom') && (
                      <div style={{ marginTop: 8, fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        {convertCard.referenceId === 'custom'
                          ? 'Harmonic profile extracted from your file — conversion will match its tonal character.'
                          : selectedPreset?.description}
                      </div>
                    )}
                  </>
                )
              })() : (
                <>
                  {sectionLabel('Sensitivity')}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Higher sensitivity detects quieter hits; lower avoids false positives.
                  </div>
                  {chipGroup(
                    [{ label: 'Low', value: 'low' }, { label: 'Medium', value: 'medium' }, { label: 'High', value: 'high' }],
                    convertCard.sensitivity,
                    v => setConvertCard(c => c ? { ...c, sensitivity: v as BeatSensitivity } : c)
                  )}
                </>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
                <button onClick={() => setConvertCard(null)} style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: 13 }}>
                  Cancel
                </button>
                <button
                  onClick={() => {
                    if (isSynth) runConvertToSynth(convertCard.clipId, convertCard.synthOpts, convertCard.referenceBuf, convertCard.harmProfile)
                    else runConvertToBeats(convertCard.clipId, convertCard.sensitivity)
                  }}
                  style={{ flex: 2, padding: '9px 0', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                >
                  Convert
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* ── Audio clip right-click context menu ───────────────────────────── */}
      {clipMenu && (() => {
        const clip = audioClips.find(c => c.id === clipMenu.clipId)
        if (!clip) return null
        const btnStyle = (danger = false): React.CSSProperties => ({
          textAlign: 'left', padding: '6px 10px', borderRadius: 6, border: 'none',
          background: 'none', cursor: 'pointer', fontSize: 13, width: '100%',
          color: danger ? '#ef4444' : 'var(--text-primary)',
        })
        const sliderRow = (label: string, value: number, min: number, max: number, step: number, fmt: (v: number) => string, onChange: (v: number) => void) => (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{label}</span>
              <span style={{ fontSize: 10, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{fmt(value)}</span>
            </div>
            <input type="range" min={min} max={max} step={step} value={value}
              onChange={e => onChange(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--accent)', margin: 0 }}
            />
          </div>
        )
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setClipMenu(null)} onContextMenu={e => { e.preventDefault(); setClipMenu(null) }} />
            {/* Wrapper so menu + settings panel sit side by side */}
            <div style={{ position: 'fixed', left: clipMenu.x, top: clipMenu.y, zIndex: 300, display: 'flex', gap: 6, alignItems: 'flex-start' }}>
            <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 8, minWidth: 170, boxShadow: '0 8px 28px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '2px 6px 6px', fontWeight: 600 }}>
                {clip.name} · {clip.buf.duration.toFixed(1)}s
              </div>

              {/* Convert submenu */}
              <button
                onClick={() => setClipMenu(m => m ? { ...m, convertOpen: !m.convertOpen } : m)}
                style={{ ...btnStyle(), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Convert <span style={{ opacity: 0.5, fontSize: 10 }}>{clipMenu.convertOpen ? '▲' : '▶'}</span>
              </button>
              {clipMenu.convertOpen && (
                <div style={{ marginLeft: 8, display: 'flex', flexDirection: 'column', gap: 1, borderLeft: '2px solid var(--border)', paddingLeft: 6 }}>
                  <button onClick={() => openConvertCard(clip.id, 'synth')} style={btnStyle()}>Synth</button>
                  <button onClick={() => openConvertCard(clip.id, 'beats')} style={btnStyle()}>Beat</button>
                </div>
              )}

              <button
                onClick={() => void runSeparateSounds(clip.id)}
                style={{ ...btnStyle(), color: 'rgba(250,204,21,0.9)', fontWeight: 600 }}
              >
                ▣ Separate Sounds
              </button>

              <button
                onClick={() => { setSaveToLibBuf(clip.buf); setClipMenu(null) }}
                style={{ ...btnStyle(), color: 'rgba(134,239,172,0.9)', fontWeight: 600 }}
              >
                + Save to Library
              </button>

              <button
                onClick={() => {
                  setClipMenu(m => m ? { ...m, applyOpen: !m.applyOpen } : m)
                  if (!clipMenu?.applyOpen) libraryGetAll().then(setApplyLibraryEntries).catch(() => {})
                }}
                style={{ ...btnStyle(), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Apply sample <span style={{ opacity: 0.5, fontSize: 10 }}>{clipMenu?.applyOpen ? '▲' : '▶'}</span>
              </button>
              {clipMenu?.applyOpen && (
                <div style={{ marginLeft: 8, borderLeft: '2px solid var(--border)', paddingLeft: 6, maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {applyLibraryEntries.length === 0 ? (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', padding: '4px 0' }}>No library samples yet</div>
                  ) : applyLibraryEntries.map(entry => (
                    <button
                      key={entry.id}
                      onClick={async () => {
                        try {
                          const ctx = new AudioContext()
                          const buf = await ctx.decodeAudioData(await entry.audioBlob.arrayBuffer())
                          await ctx.close()
                          setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, buf, name: entry.name, originalBuf: c.buf } : c))
                          setClipMenu(null)
                        } catch { showToast('Could not decode sample') }
                      }}
                      style={{ ...btnStyle(), fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{entry.name}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>{entry.duration.toFixed(1)}s</span>
                    </button>
                  ))}
                </div>
              )}

              {clip.segments && clip.segments.length > 0 && (
                <button
                  onClick={() => { setSegmentPanel(clip.id); setClipMenu(null) }}
                  style={{ ...btnStyle(), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  View Segments
                  <span style={{ fontSize: 10, color: 'var(--accent-light)', marginLeft: 6, background: 'rgba(139,92,246,0.18)', padding: '1px 6px', borderRadius: 4 }}>
                    {clip.segments.length}
                  </span>
                </button>
              )}
              <button
                onClick={() => { openWaveManager(clip.id); setClipMenu(null) }}
                style={{ ...btnStyle(), display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                Wave Manager
                <span style={{ fontSize: 10, color: '#0891b2', marginLeft: 6, opacity: 0.8 }}>7 bands</span>
              </button>
              {clip.originalBuf && (
                <button
                  onClick={() => {
                    setAudioClips(prev => prev.map(c => c.id === clip.id
                      ? { ...c, buf: c.originalBuf!, name: 'Voice', originalBuf: null }
                      : c
                    ))
                    setClipMenu(null)
                  }}
                  style={btnStyle()}
                >
                  Revert to original
                </button>
              )}
              {compGroups.some(g => g.takes.some(t => t.clipId === clip.id)) && (
                <button
                  onClick={() => {
                    const g = compGroups.find(g => g.takes.some(t => t.clipId === clip.id))
                    if (g) setOpenCompGroup(g.id)
                    setClipMenu(null)
                  }}
                  style={btnStyle()}
                >
                  Open Comp Editor
                </button>
              )}

              <div style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />

              {/* Color picker */}
              <div style={{ padding: '4px 10px 2px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>Color</div>
              <div style={{ display: 'flex', gap: 5, padding: '0 10px 6px', flexWrap: 'wrap' }}>
                {['#8b5cf6','#3b82f6','#10b981','#f59e0b','#ef4444','#ec4899','#06b6d4','#f97316'].map(c => (
                  <div key={c} onClick={() => { setAudioClips(prev => prev.map(cl => cl.id === clip.id ? { ...cl, color: c } : cl)); setClipMenu(null) }}
                    style={{ width: 18, height: 18, borderRadius: 4, background: c, cursor: 'pointer', border: clip.color === c ? '2px solid white' : '1px solid rgba(255,255,255,0.2)' }} />
                ))}
                <div onClick={() => { setAudioClips(prev => prev.map(cl => cl.id === clip.id ? { ...cl, color: null } : cl)); setClipMenu(null) }}
                  style={{ width: 18, height: 18, borderRadius: 4, background: 'var(--bg-card)', cursor: 'pointer', border: '1px solid var(--border)', fontSize: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>✕</div>
              </div>

              <div style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
              <button onClick={() => {
                const buf = clip.buf
                const rev = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate })
                for (let ch = 0; ch < buf.numberOfChannels; ch++) {
                  const src = buf.getChannelData(ch); const dst = rev.getChannelData(ch)
                  for (let i = 0; i < src.length; i++) dst[i] = src[src.length - 1 - i]
                }
                setAudioClips(prev => prev.map(cl => cl.id === clip.id ? { ...cl, buf: rev, reversed: !cl.reversed } : cl))
                setClipMenu(null)
              }} style={btnStyle()}>
                {clip.reversed ? 'Un-reverse' : 'Reverse'}
              </button>
              <button onClick={async () => {
                setClipMenu(null)
                try {
                  const { analyzeBeats } = await import('@/lib/beat-analyzer')
                  const result = await analyzeBeats(clip.buf, { allowedTypes: ['kick', 'snare'], referenceSounds })
                  if (result.bpm && result.bpm >= 40 && result.bpm <= 300) {
                    captureHistory()
                    setBpm(result.bpm); setMasterBpm(result.bpm)
                    showToast(`BPM detected: ${result.bpm}`)
                  } else {
                    showToast('Could not detect BPM from this clip')
                  }
                } catch { showToast('BPM detection failed') }
              }} style={btnStyle()}>
                Detect BPM from clip
              </button>
              <button onClick={async () => {
                setClipMenu(null)
                const projectBpm = effectiveBpmRef.current
                if (!projectBpm || projectBpm <= 0) { showToast('Set a project BPM first'); return }
                showToast('Detecting clip BPM…')
                try {
                  const { analyzeBeats } = await import('@/lib/beat-analyzer')
                  const result = await analyzeBeats(clip.buf, { allowedTypes: ['kick', 'snare'], referenceSounds })
                  if (result.bpm && result.bpm >= 40 && result.bpm <= 300) {
                    const ratio = projectBpm / result.bpm
                    const newDuration = clip.buf.duration * ratio
                    captureHistory()
                    setAudioClips(prev => prev.map(c => c.id === clip.id
                      ? { ...c, stretchDuration: newDuration, loopDuration: null, warpMarkers: [] }
                      : c
                    ))
                    showToast(`Warped ${result.bpm.toFixed(1)} → ${projectBpm} BPM`)
                  } else {
                    showToast('Could not detect tempo in this clip')
                  }
                } catch { showToast('Auto-warp failed') }
              }} style={btnStyle()}>
                Auto-warp to Project BPM
              </button>
              <button onClick={() => splitClipAtPlayhead(clip.id)} style={btnStyle()}>
                Split at Playhead
              </button>
              {clip.gainEnvelope && clip.gainEnvelope.length > 0 && (
                <button onClick={() => { setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, gainEnvelope: undefined } : c)); setClipMenu(null) }} style={btnStyle()}>
                  Clear Volume Envelope
                </button>
              )}
              <button onClick={() => { setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, muted: !c.muted } : c)); setClipMenu(null) }} style={btnStyle()}>
                {clip.muted ? 'Unmute' : 'Mute'}
              </button>
              <button onClick={() => { setAudioClips(prev => prev.filter(c => c.id !== clip.id)); setClipMenu(null) }} style={btnStyle(true)}>
                Delete
              </button>
            </div>{/* end dropdown */}

            {/* ── Sound settings panel ── */}
            <div style={{
              background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '12px 14px', width: 200,
              boxShadow: '0 8px 28px rgba(0,0,0,0.5)',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginBottom: -4 }}>
                Sound Settings
              </div>

              {sliderRow(
                'Volume', clip.gain, 0, 2, 0.01,
                v => `${Math.round(v * 100)}%`,
                v => setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, gain: v } : c)),
              )}

              {sliderRow(
                'Fade In', clip.fadeIn, 0, 3, 0.05,
                v => v === 0 ? 'off' : `${v.toFixed(2)}s`,
                v => setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, fadeIn: v } : c)),
              )}

              {sliderRow(
                'Fade Out', clip.fadeOut, 0, 3, 0.05,
                v => v === 0 ? 'off' : `${v.toFixed(2)}s`,
                v => setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, fadeOut: v } : c)),
              )}

              {sliderRow(
                'Noise Gate', clip.gateThreshold, 0, 0.5, 0.005,
                v => v === 0 ? 'off' : `${Math.round(v * 200)}%`,
                v => setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, gateThreshold: v } : c)),
              )}
            </div>

            </div>{/* end wrapper */}
          </>
        )
      })()}

      {/* ── Wave Manager panel ────────────────────────────────────────────── */}
      {waveMgrPanel && (() => {
        const clip = audioClips.find(c => c.id === waveMgrPanel)
        if (!clip) { setWaveMgrPanel(null); return null }
        const bands = clipBands[waveMgrPanel] ?? FREQ_BANDS.map(def => ({ def, buf: null, muted: false, loading: true }))
        const allMuted = bands.every(b => b.muted)
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,0.45)' }} onClick={() => setWaveMgrPanel(null)} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              zIndex: 300, background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 14, padding: 20, width: 560,
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
              display: 'flex', flexDirection: 'column', gap: 12,
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Wave Manager — {clip.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    Mute frequency bands to isolate the character causing problems. Apply writes the mix to the clip.
                  </div>
                </div>
                <button onClick={() => setWaveMgrPanel(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px', flexShrink: 0 }}>×</button>
              </div>

              {/* Global playback + mute controls */}
              {(() => {
                const stopPlaying = () => {
                  try { waveMgrPlayRef.current?.src.stop() } catch { /* already stopped */ }
                  waveMgrPlayRef.current = null
                }
                const playBufs = (bufs: (AudioBuffer | null)[]) => {
                  stopPlaying()
                  const valid = bufs.filter((b): b is AudioBuffer => !!b)
                  if (valid.length === 0) return
                  const first = valid[0]
                  const actx = new AudioContext()
                  // Mix the selected buffers
                  const mixed = new AudioBuffer({ numberOfChannels: first.numberOfChannels, length: first.length, sampleRate: first.sampleRate })
                  for (let ch = 0; ch < first.numberOfChannels; ch++) {
                    const dst = mixed.getChannelData(ch)
                    for (const b of valid) {
                      const s = b.getChannelData(Math.min(ch, b.numberOfChannels - 1))
                      for (let i = 0; i < dst.length; i++) dst[i] += s[i]
                    }
                  }
                  const src = actx.createBufferSource()
                  src.buffer = mixed; src.connect(actx.destination); src.start()
                  src.onended = () => { waveMgrPlayRef.current = null }
                  waveMgrPlayRef.current = { src, ctx: actx }
                }

                const allLoaded = bands.every(b => !b.loading)
                const activeBufs = bands.filter(b => !b.muted).map(b => b.buf)
                const isolatedBuf = waveMgrIsolated !== null ? bands[waveMgrIsolated]?.buf : null

                return (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    {/* Play all non-muted */}
                    <button
                      disabled={!allLoaded}
                      onClick={() => playBufs(activeBufs)}
                      title="Play all non-muted bands together"
                      style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12, cursor: allLoaded ? 'pointer' : 'default', opacity: allLoaded ? 1 : 0.5, fontWeight: 600 }}
                    >▶ Play mix</button>

                    {/* Play isolated band */}
                    <button
                      disabled={!isolatedBuf}
                      onClick={() => isolatedBuf && playBufs([isolatedBuf])}
                      title={waveMgrIsolated !== null ? `Play ${bands[waveMgrIsolated]?.def.label} in isolation` : 'Select a band to isolate first'}
                      style={{
                        padding: '6px 14px', borderRadius: 6, border: '1px solid',
                        borderColor: waveMgrIsolated !== null ? (bands[waveMgrIsolated]?.def.color ?? 'var(--border)') + '88' : 'var(--border)',
                        background: waveMgrIsolated !== null ? (bands[waveMgrIsolated]?.def.color ?? 'transparent') + '22' : 'transparent',
                        color: waveMgrIsolated !== null ? (bands[waveMgrIsolated]?.def.color ?? 'var(--text-muted)') : 'var(--text-muted)',
                        fontSize: 12, cursor: isolatedBuf ? 'pointer' : 'default',
                        opacity: isolatedBuf ? 1 : 0.5, fontWeight: 600,
                      }}
                    >▶ {waveMgrIsolated !== null ? bands[waveMgrIsolated]?.def.label : 'Isolated'}</button>

                    {waveMgrIsolated !== null && (
                      <button onClick={() => setWaveMgrIsolated(null)}
                        style={{ padding: '4px 8px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 10, cursor: 'pointer' }}>
                        ✕ clear
                      </button>
                    )}

                    <div style={{ flex: 1 }} />
                    <button onClick={() => setClipBands(prev => ({ ...prev, [waveMgrPanel]: bands.map(b => ({ ...b, muted: false })) }))}
                      style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>All on</button>
                    <button onClick={() => setClipBands(prev => ({ ...prev, [waveMgrPanel]: bands.map(b => ({ ...b, muted: true })) }))}
                      style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>All off</button>
                    <button onClick={() => applyBandMutes(waveMgrPanel)}
                      style={{ padding: '4px 14px', borderRadius: 5, border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(52,211,153,0.12)', color: '#34d399', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}>
                      Apply →
                    </button>
                  </div>
                )
              })()}

              {/* Band rows */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {bands.map((band, idx) => {
                  const { def, buf, muted, loading } = band
                  const isIsolated = waveMgrIsolated === idx
                  const peaks: number[] = []
                  if (buf) {
                    const data = buf.getChannelData(0)
                    const step = Math.max(1, Math.floor(data.length / 50))
                    for (let i = 0; i < 50; i++) {
                      let p = 0
                      for (let j = 0; j < step; j++) p = Math.max(p, Math.abs(data[i * step + j] ?? 0))
                      peaks.push(p)
                    }
                  }
                  const maxPeak = Math.max(...peaks, 0.001)

                  return (
                    <div key={def.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '8px 12px', borderRadius: 8,
                      background: isIsolated ? def.color + '18' : muted ? 'rgba(255,255,255,0.02)' : 'var(--bg-card)',
                      border: `1px solid ${isIsolated ? def.color + 'aa' : muted ? 'var(--border)' : def.color + '44'}`,
                      opacity: muted && !isIsolated ? 0.45 : 1,
                      transition: 'all 0.15s',
                    }}>
                      {/* Color bar */}
                      <div style={{ width: 4, height: 42, borderRadius: 2, background: def.color, flexShrink: 0 }} />

                      {/* Labels */}
                      <div style={{ width: 78, flexShrink: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{def.label}</div>
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                          {def.lo >= 1000 ? `${def.lo/1000}k` : def.lo}–{def.hi >= 1000 ? `${def.hi/1000}k` : def.hi} Hz
                        </div>
                        <div style={{ fontSize: 9, color: def.color, marginTop: 1, opacity: 0.9 }}>
                          {wavelengthStr(Math.sqrt(def.lo * def.hi))}
                        </div>
                      </div>

                      {/* Mini waveform */}
                      <div style={{ flex: 1, height: 32, display: 'flex', alignItems: 'center', gap: 1 }}>
                        {loading ? (
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Analyzing…</div>
                        ) : peaks.length > 0 ? peaks.map((p, i) => {
                          const h = Math.max(2, (p / maxPeak) * 30)
                          return <div key={i} style={{ width: '100%', height: h, background: def.color, borderRadius: 1, opacity: muted && !isIsolated ? 0.35 : 0.85 }} />
                        }) : <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>No signal</div>}
                      </div>

                      {/* Isolate toggle */}
                      <button
                        disabled={!buf}
                        onClick={() => setWaveMgrIsolated(isIsolated ? null : idx)}
                        title={isIsolated ? 'Clear isolation' : 'Isolate this band for solo playback'}
                        style={{
                          padding: '5px 9px', borderRadius: 5, border: '1px solid',
                          borderColor: isIsolated ? def.color : 'var(--border)',
                          background: isIsolated ? def.color + '30' : 'transparent',
                          color: isIsolated ? def.color : 'var(--text-muted)',
                          fontSize: 10, fontWeight: 700, cursor: buf ? 'pointer' : 'default',
                          opacity: buf ? 1 : 0.4, flexShrink: 0, letterSpacing: 0.3,
                        }}
                      >{isIsolated ? '◎' : '○'}</button>

                      {/* Mute toggle */}
                      <button
                        onClick={() => toggleBandMute(waveMgrPanel, idx)}
                        title={muted ? 'Unmute' : 'Mute this band'}
                        style={{
                          width: 34, padding: '5px 0', borderRadius: 5, border: '1px solid',
                          borderColor: muted ? 'rgba(239,68,68,0.55)' : 'var(--border)',
                          background: muted ? 'rgba(239,68,68,0.15)' : 'transparent',
                          color: muted ? '#f87171' : 'var(--text-muted)',
                          fontSize: 10, fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                        }}
                      >M</button>
                    </div>
                  )
                })}
              </div>

              <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                Click <strong style={{ color: 'var(--text-secondary)' }}>○</strong> to isolate a band, then <strong style={{ color: 'var(--text-secondary)' }}>▶ Isolated</strong> to hear it alone. Use <strong style={{ color: 'var(--text-secondary)' }}>M</strong> to mute bands that sound wrong, then <strong style={{ color: 'var(--text-secondary)' }}>Apply →</strong> to bake the mix.
              </div>
            </div>
          </>
        )
      })()}

      {/* ── Ableton import modal ──────────────────────────────────────────── */}
      {/* ── Beat Studio ──────────────────────────────────────────────────── */}
      {beatStudioOpen && (() => {
        const btnBase: React.CSSProperties = { padding: '7px 16px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600 }
        const stepActive = (n: number) => beatStep === n
        const stepDone   = (n: number) => beatStep > n || (n === 1 && !!beatRef) || (n === 2 && !!beatBox)

        const stepHeaderStyle = (n: 1|2|3): React.CSSProperties => ({
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
        })
        const stepNumStyle = (n: 1|2|3): React.CSSProperties => ({
          width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 12, fontWeight: 700, flexShrink: 0,
          background: stepDone(n) ? 'rgba(234,179,8,0.25)' : stepActive(n) ? 'rgba(234,179,8,0.15)' : 'rgba(255,255,255,0.04)',
          border: `1px solid ${stepDone(n) ? 'rgba(234,179,8,0.6)' : stepActive(n) ? 'rgba(234,179,8,0.3)' : 'var(--border)'}`,
          color: stepDone(n) ? 'rgba(250,204,21,1)' : stepActive(n) ? 'rgba(250,204,21,0.7)' : 'var(--text-muted)',
        })

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 801, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) closeBeatStudio() }}>
            <div style={{ background: 'var(--bg-modal, #18181b)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, width: 'min(680px,94vw)', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 0 }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>▣ Beat Studio</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Load a beat, listen to it, then beatbox it — the AI reproduces it using only your beatbox recording as source material</div>
                </div>
                <button onClick={closeBeatStudio} style={{ ...btnBase, background: 'var(--bg-card)', color: 'var(--text-muted)', padding: '5px 10px' }}>✕</button>
              </div>

              {/* ── Step 1: Load the beat ── */}
              <div style={{ background: 'var(--bg-card)', border: `1px solid ${beatRef ? 'rgba(234,179,8,0.3)' : 'var(--border)'}`, borderRadius: 10, padding: 18, marginBottom: 12 }}>
                <div style={stepHeaderStyle(1)}>
                  <div style={stepNumStyle(1)}>{stepDone(1) ? '✓' : '1'}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Load the beat you want to replicate</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>Drop a file, paste a URL, or browse — WAV, MP3, AIFF all work</div>
                  </div>
                  {beatRef && beatRefBpm && (
                    <div style={{ marginLeft: 'auto', background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 6, padding: '3px 10px', fontSize: 11, fontWeight: 700, color: 'rgba(250,204,21,1)' }}>
                      ~{beatRefBpm} BPM
                    </div>
                  )}
                </div>

                {/* Drop zone */}
                <div
                  style={{ border: '1.5px dashed var(--border)', borderRadius: 8, padding: '16px 12px', textAlign: 'center', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', marginBottom: 10 }}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) beatLoadRef(f) }}
                  onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*,.aif,.aiff'; inp.onchange = () => { const f = inp.files?.[0]; if (f) beatLoadRef(f) }; inp.click() }}
                >
                  {beatRef
                    ? <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{beatRefName}</span>
                    : <><div style={{ fontSize: 20, marginBottom: 4 }}>🎵</div>Drop your beat here or click to browse</>}
                </div>

                {/* URL import */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <input value={beatRefUrl} onChange={e => setBeatRefUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && beatFetchUrl()}
                    placeholder="Or paste a direct audio URL…"
                    style={{ flex: 1, fontSize: 10, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-input, #27272a)', border: '1px solid var(--border)', color: 'var(--text-primary)' }} />
                  <button onClick={beatFetchUrl} style={{ ...btnBase, background: 'rgba(234,179,8,0.12)', color: 'rgba(250,204,21,1)', border: '1px solid rgba(234,179,8,0.3)', padding: '5px 12px', fontSize: 10 }}>Fetch</button>
                </div>

                {/* Waveform + playback */}
                {beatRef && (
                  <>
                    <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '6px 8px', marginBottom: 8 }}>
                      <WaveViz buf={beatRef} color="rgba(250,204,21,0.75)" />
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        onClick={() => beatLooping ? beatStopPlay() : beatPlaySlot('ref', true)}
                        style={{ ...btnBase, background: beatLooping ? 'rgba(234,179,8,0.2)' : 'rgba(234,179,8,0.08)', color: beatLooping ? 'rgba(250,204,21,1)' : 'rgba(250,204,21,0.6)', border: '1px solid rgba(234,179,8,0.3)', padding: '6px 14px' }}
                      >
                        {beatLooping ? '■ Stop loop' : '↻ Loop to memorise'}
                      </button>
                      <button
                        onClick={() => beatPlayingSlot === 'ref' && !beatLooping ? beatStopPlay() : beatPlaySlot('ref', false)}
                        style={{ ...btnBase, background: beatPlayingSlot === 'ref' && !beatLooping ? 'rgba(234,179,8,0.15)' : 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', padding: '6px 12px' }}
                      >
                        {beatPlayingSlot === 'ref' && !beatLooping ? '■' : '▶'}
                      </button>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{beatRef.duration.toFixed(1)}s</span>
                      <button
                        onClick={resetBeatTranscription}
                        title="Clear reference audio and reset"
                        style={{ ...btnBase, padding: '6px 10px', color: 'var(--text-muted)', border: '1px solid var(--border)', background: 'transparent' }}
                      >
                        ✕ Clear
                      </button>
                      {beatStep === 1 && beatRef && (
                        <button onClick={() => setBeatStep(2)}
                          style={{ ...btnBase, marginLeft: 'auto', background: 'rgba(234,179,8,0.12)', color: 'rgba(250,204,21,1)', border: '1px solid rgba(234,179,8,0.3)', padding: '6px 14px' }}>
                          Ready to beatbox →
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── Separate Sounds — calibration tool ── */}
              <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(250,204,21,0.2)', borderRadius: 10, padding: 18, marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>▣ Separate Sounds</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Detect each drum type from the reference beat — review results before placing on the timeline</div>
                </div>

                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.6 }}>
                  {beatRef
                    ? <>Loaded: <strong style={{ color: 'var(--text-secondary)' }}>{beatRefName}</strong> — click below to detect drum tracks and review in the grid</>
                    : 'Load a reference beat in Step 1 first, then separate its drum sounds here.'}
                </div>

                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    onClick={runSeparateFromRef}
                    disabled={!beatRef || beatTranscribeLoading}
                    style={{ ...btnBase, flex: 1,
                      background: beatRef ? 'rgba(250,204,21,0.15)' : 'rgba(255,255,255,0.04)',
                      color: beatRef ? 'rgba(250,204,21,1)' : 'var(--text-muted)',
                      border: `1px solid ${beatRef ? 'rgba(234,179,8,0.4)' : 'var(--border)'}` }}>
                    {beatTranscribeLoading ? 'Detecting…' : '▣ Separate Sounds from Beat'}
                  </button>
                  <button
                    onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*,.aif,.aiff'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { const d = await decodeAudio(f); setBeatBox(null); setBeatBoxName(''); setBeatRef(d); setBeatRefName(f.name) } catch { showToast('Could not decode file') } }; inp.click() }}
                    style={{ ...btnBase, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)', padding: '7px 14px', fontSize: 10 }}>
                    Import Beat
                  </button>
                </div>

              </div>

              {/* ── Step 2: Record beatbox ── */}
              <div style={{ background: 'var(--bg-card)', border: `1px solid ${beatBox ? 'rgba(234,179,8,0.3)' : 'var(--border)'}`, borderRadius: 10, padding: 18, marginBottom: 12, position: 'relative' }}>
                <div style={stepHeaderStyle(2)}>
                  <div style={stepNumStyle(2)}>{stepDone(2) ? '✓' : '2'}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Record your beatbox <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>(or import a file)</span></div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>Beatbox or import any audio — a reference beat in step 1 is optional but improves accuracy</div>
                  </div>
                  {/* Metronome toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Metronome</span>
                    <button onClick={() => setBeatMetronomeOn(v => !v)}
                      style={{ ...btnBase, padding: '4px 10px', fontSize: 10,
                        background: beatMetronomeOn ? 'rgba(250,204,21,0.15)' : 'var(--bg-card)',
                        color: beatMetronomeOn ? 'rgba(250,204,21,1)' : 'var(--text-muted)',
                        border: `1px solid ${beatMetronomeOn ? 'rgba(234,179,8,0.4)' : 'var(--border)'}` }}>
                      {beatMetronomeOn ? '♩ On' : '♩ Off'}
                    </button>
                  </div>
                </div>

                {/* BPM reminder + countdown info */}
                {beatMetronomeOn && (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10, background: 'rgba(250,204,21,0.05)', border: '1px solid rgba(234,179,8,0.15)', borderRadius: 7, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span>♩</span>
                    {beatRefBpm
                      ? <>Metronome at <strong style={{ color: 'rgba(250,204,21,0.9)' }}>{beatRefBpm} BPM · {beatTimeSig[0]}/{beatTimeSig[1]}</strong> — 3-bar countdown then record starts automatically</>
                      : <>No BPM detected yet — load a reference beat to auto-detect it</>
                    }
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                  <button
                    data-hint="Record Beatbox||Start beatboxing into your mic. When you stop, the AI analyzes your audio and finds each drum hit — kick, snare, hi-hat, clap. If a metronome BPM is set, a 3-bar countdown plays first so you can get in rhythm."
                    onClick={() => beatRecording ? stopBeatRecord() : startBeatRecord()}
                    disabled={beatCountdown !== null}
                    style={{ ...btnBase, flex: 1,
                      background: beatRecording ? 'rgba(239,68,68,0.18)' : beatCountdown !== null ? 'rgba(234,179,8,0.06)' : 'rgba(234,179,8,0.12)',
                      color: beatRecording ? '#f87171' : beatCountdown !== null ? 'rgba(250,204,21,0.5)' : 'rgba(250,204,21,1)',
                      border: `1px solid ${beatRecording ? 'rgba(239,68,68,0.4)' : 'rgba(234,179,8,0.3)'}` }}
                  >
                    {beatRecording ? '■ Stop recording' : '⏺ Record beatbox'}
                  </button>
                  <button
                    onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*,.aif,.aiff'; inp.onchange = async () => { const f = inp.files?.[0]; if (!f) return; try { const d = await decodeAudio(f); setBeatBox(d); setBeatBoxName(f.name); setBeatBoxOffset(0); setBeatStep(3) } catch { showToast('Could not decode file') } }; inp.click() }}
                    style={{ ...btnBase, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                  >
                    Browse file
                  </button>
                </div>

                {/* Countdown overlay */}
                {beatCountdown !== null && (
                  <div style={{ position: 'absolute', inset: 0, borderRadius: 10, background: 'rgba(0,0,0,0.82)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, zIndex: 10 }}>
                    <div style={{ fontSize: 72, fontWeight: 900, color: 'rgba(250,204,21,1)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{beatCountdown}</div>
                    <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.6)' }}>Get ready… recording starts at 1</div>
                    <button onClick={() => { stopBeatRecord(); setBeatCountdown(null) }}
                      style={{ ...btnBase, marginTop: 8, padding: '6px 18px', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', fontSize: 11 }}>
                      Cancel
                    </button>
                  </div>
                )}

                {beatRecording && (
                  <div style={{ border: '1.5px dashed rgba(239,68,68,0.4)', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(239,68,68,0.04)', marginBottom: 8 }}>
                    <span style={{ fontSize: 16, animation: 'pulse 1s infinite' }}>🔴</span>
                    <span style={{ fontSize: 11, color: '#f87171', flex: 1 }}>Recording… beatbox the rhythm, then tap Stop</span>
                    {beatMetronomeOn && beatRefBpm && (
                      <span style={{ fontSize: 10, color: 'rgba(250,204,21,0.6)' }}>♩ {beatRefBpm} BPM</span>
                    )}
                  </div>
                )}

                {beatBox && !beatRecording && (
                  <>
                    <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '6px 8px', marginBottom: 8 }}>
                      <WaveViz buf={beatBox} color="rgba(234,179,8,0.75)" />
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <button
                        onClick={() => beatPlayingSlot === 'beatbox' ? beatStopPlay() : beatPlaySlot('beatbox')}
                        style={{ ...btnBase, background: beatPlayingSlot === 'beatbox' ? 'rgba(234,179,8,0.15)' : 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', padding: '6px 12px' }}
                      >
                        {beatPlayingSlot === 'beatbox' ? '■' : '▶'} {beatBoxName}
                      </button>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{beatBox.duration.toFixed(1)}s</span>
                      {beatStep === 2 && (
                        <button onClick={() => setBeatStep(3)}
                          style={{ ...btnBase, marginLeft: 'auto', background: 'rgba(234,179,8,0.12)', color: 'rgba(250,204,21,1)', border: '1px solid rgba(234,179,8,0.3)', padding: '6px 14px' }}>
                          Transform →
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── Alignment panel (shown when both ref and beatbox are loaded) ── */}
              {beatRef && beatBox && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(96,165,250,0.25)', borderRadius: 10, padding: 18, marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>Align tracks</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                        Drag the slider or click Auto-align to sync the beatbox (blue) with the reference (yellow). The AI trains more accurately when they line up.
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button onClick={autoAlignBeatBox}
                        style={{ ...btnBase, background: 'rgba(96,165,250,0.12)', color: 'rgba(96,165,250,1)', border: '1px solid rgba(96,165,250,0.35)', padding: '5px 12px', fontSize: 10 }}>
                        ⟳ Auto-align
                      </button>
                      <button onClick={() => setBeatBoxOffset(0)}
                        style={{ ...btnBase, background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border)', padding: '5px 10px', fontSize: 10 }}>
                        Reset
                      </button>
                    </div>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <AlignCanvas refBuf={beatRef} boxBuf={beatBox} offset={beatBoxOffset} />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', flexShrink: 0, minWidth: 56, textAlign: 'right' }}>
                      {beatBoxOffset >= 0 ? '+' : ''}{(beatBoxOffset * 1000).toFixed(0)} ms
                    </span>
                    <input
                      type="range"
                      min={-Math.min(5, beatRef.duration * 0.8)}
                      max={Math.min(5, beatBox.duration * 0.8)}
                      step={0.01}
                      value={beatBoxOffset}
                      onChange={e => setBeatBoxOffset(parseFloat(e.target.value))}
                      style={{ flex: 1, accentColor: 'rgba(96,165,250,1)' }}
                    />
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <span style={{ fontSize: 9, color: 'rgba(250,204,21,0.8)', background: 'rgba(250,204,21,0.08)', borderRadius: 3, padding: '1px 5px' }}>■ Ref</span>
                      <span style={{ fontSize: 9, color: 'rgba(96,165,250,0.8)', background: 'rgba(96,165,250,0.08)', borderRadius: 3, padding: '1px 5px' }}>■ Box</span>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Step 3: Transform & result ── */}
              <div style={{ background: 'var(--bg-card)', border: `1px solid ${beatResult ? 'rgba(234,179,8,0.4)' : 'var(--border)'}`, borderRadius: 10, padding: 18, opacity: beatRef && beatBox ? 1 : 0.4, pointerEvents: beatRef && beatBox ? 'auto' : 'none' }}>
                <div style={stepHeaderStyle(3)}>
                  <div style={stepNumStyle(3)}>{beatResult ? '✓' : '3'}</div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Transform</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>The AI uses your beatbox as the rhythmic skeleton and fills in the beat's sound</div>
                  </div>
                </div>

                {/* Sliders */}
                <div style={{ display: 'flex', gap: 20, marginBottom: 16, flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                      Beatbox presence <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{beatStrength}%</span>
                    </div>
                    <input type="range" min={20} max={100} value={beatStrength} onChange={e => setBeatStrength(+e.target.value)}
                      style={{ width: '100%', accentColor: 'rgba(250,204,21,0.9)' }} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>Lower = more of the target sound; higher = more of your original beatbox</div>
                  </div>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 5 }}>
                      Beat fill <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{beatGapFill}%</span>
                    </div>
                    <input type="range" min={0} max={100} value={beatGapFill} onChange={e => setBeatGapFill(+e.target.value)}
                      style={{ width: '100%', accentColor: 'rgba(250,204,21,0.9)' }} />
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>How much bass, synths, and production from the target to blend in</div>
                  </div>
                </div>

                <div style={{ textAlign: 'center', marginBottom: 16 }}>
                  <button onClick={() => runBeatStudio()} disabled={!beatRef || !beatBox || beatLoading}
                    style={{ ...btnBase, fontSize: 13, padding: '10px 40px', background: (!beatRef || !beatBox || beatLoading) ? 'rgba(234,179,8,0.1)' : 'rgba(234,179,8,0.85)', color: beatLoading ? 'rgba(250,204,21,0.6)' : '#000', cursor: (!beatRef || !beatBox || beatLoading) ? 'not-allowed' : 'pointer', opacity: (!beatRef || !beatBox) ? 0.5 : 1 }}>
                    {beatLoading ? beatProgress || 'Processing…' : '▣ Transform Beat'}
                  </button>
                </div>

                {/* Result */}
                {beatResult && (
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(250,204,21,1)' }}>Result</div>
                    <div style={{ background: 'rgba(0,0,0,0.25)', borderRadius: 8, padding: '6px 8px' }}>
                      <WaveViz buf={beatResult} color="rgba(250,204,21,0.9)" />
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        onClick={() => beatPlayingSlot === 'result' ? beatStopPlay() : beatPlaySlot('result')}
                        style={{ ...btnBase, background: beatPlayingSlot === 'result' ? 'rgba(234,179,8,0.2)' : 'var(--bg-card)', color: beatPlayingSlot === 'result' ? 'rgba(250,204,21,1)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
                      >
                        {beatPlayingSlot === 'result' ? '■ Stop' : '▶ Play result'}
                      </button>
                      <button onClick={() => runBeatStudio()}
                        style={{ ...btnBase, background: 'rgba(234,179,8,0.08)', color: 'rgba(250,204,21,0.7)', border: '1px solid rgba(234,179,8,0.2)' }}>
                        ↺ Retry
                      </button>
                      <button onClick={addBeatResultToTimeline}
                        style={{ ...btnBase, background: 'rgba(234,179,8,0.12)', color: 'rgba(250,204,21,1)', border: '1px solid rgba(234,179,8,0.3)' }}>
                        + Add to timeline
                      </button>
                      <button onClick={exportBeatResult}
                        style={{ ...btnBase, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                        ↓ Export WAV
                      </button>
                      <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text-muted)' }}>{beatResult.duration.toFixed(1)}s</span>
                    </div>

                    {/* AI feedback + retry */}
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {beatAiExplanation && (
                        <div style={{ fontSize: 10, color: 'rgba(196,181,253,0.9)', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)', borderRadius: 7, padding: '7px 10px', lineHeight: 1.5 }}>
                          ♦ {beatAiExplanation} <span style={{ color: 'var(--text-muted)' }}>(strength {beatStrength}%, fill {beatGapFill}%)</span>
                        </div>
                      )}
                      <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)' }}>Not right? Tell the AI what to fix:</div>
                      <textarea
                        value={beatFeedback}
                        onChange={e => setBeatFeedback(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) runBeatWithFeedback() }}
                        placeholder='e.g. "Too much of my voice, need more drums and bass" · "Sounds too robotic" · "More of the original beat please"'
                        rows={2}
                        style={{ width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 7, color: 'var(--text-primary)', fontSize: 11, padding: '8px 10px', resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
                      />
                      <button
                        onClick={runBeatWithFeedback}
                        disabled={!beatFeedback.trim() || beatAiAdjusting || beatLoading}
                        style={{ ...btnBase, background: (!beatFeedback.trim() || beatAiAdjusting || beatLoading) ? 'rgba(139,92,246,0.08)' : 'rgba(139,92,246,0.18)', color: 'rgba(196,181,253,1)', border: '1px solid rgba(139,92,246,0.35)', width: '100%', fontSize: 12, padding: '9px 0' }}>
                        {beatAiAdjusting ? '♦ Adjusting…' : beatLoading ? 'Retrying…' : '♦ Retry with AI →'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* ── Drum Transcription ── */}
              {beatBox && (
                <div style={{ background: 'var(--bg-card)', border: `1px solid ${dtHits ? 'rgba(250,204,21,0.4)' : 'var(--border)'}`, borderRadius: 10, padding: 18, marginTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>▣ Drum Transcription</div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Detect drum hits in your beatbox and place them on separate lanes</div>
                  </div>

                  <button
                    data-hint="Detect Drum Hits||Runs beat detection on your beatbox recording. The AI listens for rhythmic transients and classifies each as kick, snare, hi-hat, clap, or tom. Results appear on the waveform below — click a dot to remove a false detection."
                    onClick={runDrumDetect}
                    disabled={dtLoading}
                    style={{ ...btnBase, background: dtLoading ? 'rgba(234,179,8,0.08)' : 'rgba(234,179,8,0.15)', color: 'rgba(250,204,21,1)', border: '1px solid rgba(234,179,8,0.3)', padding: '7px 16px', fontSize: 12, fontWeight: 600, marginBottom: 12 }}
                  >
                    {dtLoading ? '⟳ Detecting hits…' : '▣ Detect Drum Hits'}
                  </button>

                  {dtHits && dtHits.length === 0 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>No drum hits detected — try with a clearer beatbox recording.</div>
                  )}

                  {dtHits && dtHits.length > 0 && (() => {
                    const byType = new Map<string, BeatHit[]>()
                    for (const h of dtHits) {
                      if (!byType.has(h.type)) byType.set(h.type, [])
                      byType.get(h.type)!.push(h)
                    }
                    return (
                      <>
                        <div style={{ fontSize: 11, color: 'rgba(250,204,21,0.9)', marginBottom: 10 }}>
                          {dtHits.length} hits detected across {byType.size} sound type{byType.size !== 1 ? 's' : ''}
                        </div>

                        {/* Waveform + hit dots */}
                        <canvas
                          ref={dtCanvasRef}
                          width={560} height={60}
                          style={{ width: '100%', height: 60, display: 'block', borderRadius: 6, background: 'rgba(0,0,0,0.25)', marginBottom: 12, cursor: 'crosshair' }}
                          onClick={e => {
                            const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
                            const frac = (e.clientX - rect.left) / rect.width
                            const time = frac * (beatBox?.duration ?? 0)
                            setDtHits(prev => prev ? prev.filter(h => Math.abs(h.time - time) > 0.05) : null)
                          }}
                          title="Click near a dot to remove that hit"
                        />

                        {/* Hit type breakdown */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14 }}>
                          {[...byType.entries()].map(([type, typeHits]) => (
                            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 8, height: 8, borderRadius: '50%', background: DRUM_COLORS[type] ?? '#888', flexShrink: 0, display: 'inline-block' }} />
                              <span style={{ fontSize: 11, color: 'var(--text-primary)', minWidth: 80 }}>{DRUM_LABELS[type] ?? type}</span>
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{typeHits.length} hit{typeHits.length !== 1 ? 's' : ''}</span>
                            </div>
                          ))}
                        </div>

                        <button
                          data-hint="Place Hits on Timeline||Creates a clip for every detected hit, sliced from the exact moment in your beatbox recording. Each clip type gets its own lane (kick → kick lane, snare → snare lane, etc). Clips are trimmed so they never overlap."
                          onClick={dtCommitToTimeline}
                          style={{ ...btnBase, background: 'rgba(250,204,21,0.15)', color: 'rgba(250,204,21,1)', border: '1px solid rgba(234,179,8,0.4)', padding: '8px 18px', fontSize: 12, fontWeight: 600 }}
                        >
                          Place {dtHits.length} hits on timeline →
                        </button>
                      </>
                    )
                  })()}
                </div>
              )}


            </div>
          </div>
        )
      })()}

      {/* ── Match Studio ─────────────────────────────────────────────────── */}
      {matchStudioOpen && (() => {
        const slotStyle = (active: boolean): React.CSSProperties => ({
          flex: 1, background: 'var(--bg-card)', border: `1px solid ${active ? 'rgba(236,72,153,0.5)' : 'var(--border)'}`,
          borderRadius: 10, padding: 16, display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0,
        })
        const dropZoneStyle: React.CSSProperties = {
          border: '1.5px dashed var(--border)', borderRadius: 8, padding: '20px 12px',
          textAlign: 'center', cursor: 'pointer', fontSize: 11, color: 'var(--text-muted)',
          background: 'rgba(255,255,255,0.02)',
        }
        const btnBase: React.CSSProperties = {
          padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 600,
        }

        return (
          <div style={{ position: 'fixed', inset: 0, zIndex: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) { matchStopPlay(); setMatchStudioOpen(false) } }}>
            <div style={{ background: 'var(--bg-modal, #18181b)', border: '1px solid var(--border)', borderRadius: 14, padding: 24, width: 'min(900px,94vw)', maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>

              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>♪ Match Studio</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Load a track, record yourself singing it — the AI matches your voice and fills in what's missing</div>
                </div>
                <button onClick={() => { matchStopPlay(); setMatchStudioOpen(false) }} style={{ ...btnBase, background: 'var(--bg-card)', color: 'var(--text-muted)' }}>✕</button>
              </div>

              {/* Two columns */}
              <div style={{ display: 'flex', gap: 14 }}>

                {/* ── Reference track ── */}
                <div style={slotStyle(!!matchTarget)}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(244,114,182,0.9)' }}>Reference Track</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>The song or beat you want to sound like</div>

                  {/* Drop zone */}
                  <div style={dropZoneStyle}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) matchLoadFile(f, 'target') }}
                    onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) matchLoadFile(f, 'target') }; inp.click() }}
                  >
                    {matchTarget
                      ? <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{matchTargetName}</span>
                      : <><div style={{ fontSize: 18, marginBottom: 4 }}>🎵</div>Drop audio file or click to browse</>
                    }
                  </div>

                  {/* URL import */}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      value={matchTargetUrl}
                      onChange={e => setMatchTargetUrl(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') matchFetchUrl() }}
                      placeholder="Paste direct audio URL…"
                      style={{ flex: 1, fontSize: 10, padding: '5px 8px', borderRadius: 6, background: 'var(--bg-input, #27272a)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <button onClick={matchFetchUrl} style={{ ...btnBase, background: 'rgba(236,72,153,0.15)', color: 'rgba(244,114,182,1)', border: '1px solid rgba(236,72,153,0.3)' }}>Fetch</button>
                  </div>

                  {/* Waveform */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '6px 8px', minHeight: 68 }}>
                    <WaveViz buf={matchTarget} color="rgba(244,114,182,0.8)" />
                    {!matchTarget && <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 8 }}>No track loaded</div>}
                  </div>

                  {/* Playback */}
                  {matchTarget && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => matchPlayingSlot === 'target' ? matchStopPlay() : matchPlaySlot('target')}
                        style={{ ...btnBase, background: matchPlayingSlot === 'target' ? 'rgba(236,72,153,0.2)' : 'var(--bg-card)', color: matchPlayingSlot === 'target' ? 'rgba(244,114,182,1)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
                      >
                        {matchPlayingSlot === 'target' ? '■ Stop' : '▶ Play'}
                      </button>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{matchTarget.duration.toFixed(1)}s · {matchTarget.sampleRate / 1000}kHz</span>
                    </div>
                  )}
                </div>

                {/* ── Your voice ── */}
                <div style={slotStyle(!!matchVocal)}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(139,92,246,0.9)' }}>Your Voice</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Your vocal recording (sing the track, or a melody you want matched)</div>

                  {/* Record button */}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => matchRecording ? stopMatchRecord() : startMatchRecord()}
                      style={{ ...btnBase, flex: 1, background: matchRecording ? 'rgba(239,68,68,0.2)' : 'rgba(139,92,246,0.12)', color: matchRecording ? '#f87171' : 'rgba(167,139,250,1)', border: `1px solid ${matchRecording ? 'rgba(239,68,68,0.4)' : 'rgba(139,92,246,0.3)'}` }}
                    >
                      {matchRecording ? '■ Stop Recording' : '⏺ Record'}
                    </button>
                    <button
                      onClick={() => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'audio/*'; inp.onchange = () => { const f = inp.files?.[0]; if (f) matchLoadFile(f, 'vocal') }; inp.click() }}
                      style={{ ...btnBase, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                    >
                      Browse
                    </button>
                  </div>

                  {/* Drop zone (when no recording) */}
                  {!matchVocal && !matchRecording && (
                    <div style={dropZoneStyle}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) matchLoadFile(f, 'vocal') }}
                    >
                      <div style={{ fontSize: 18, marginBottom: 4 }}>🎤</div>
                      Drop a vocal file, or record above
                    </div>
                  )}
                  {matchRecording && (
                    <div style={{ ...dropZoneStyle, borderColor: 'rgba(239,68,68,0.4)', color: '#f87171', background: 'rgba(239,68,68,0.04)' }}>
                      <div style={{ fontSize: 18, marginBottom: 4 }}>🔴</div>Recording… tap Stop when done
                    </div>
                  )}

                  {/* Waveform */}
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '6px 8px', minHeight: 68 }}>
                    <WaveViz buf={matchVocal} color="rgba(167,139,250,0.8)" />
                    {!matchVocal && <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', paddingTop: 8 }}>No voice loaded</div>}
                  </div>

                  {/* Playback */}
                  {matchVocal && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button
                        onClick={() => matchPlayingSlot === 'vocal' ? matchStopPlay() : matchPlaySlot('vocal')}
                        style={{ ...btnBase, background: matchPlayingSlot === 'vocal' ? 'rgba(139,92,246,0.2)' : 'var(--bg-card)', color: matchPlayingSlot === 'vocal' ? 'rgba(167,139,250,1)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
                      >
                        {matchPlayingSlot === 'vocal' ? '■ Stop' : '▶ Play'}
                      </button>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{matchVocal.duration.toFixed(1)}s · {matchVocal.sampleRate / 1000}kHz</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Controls */}
              <div style={{ background: 'var(--bg-card)', borderRadius: 10, padding: '14px 18px', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Match Strength <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{matchStrength}%</span>
                  </div>
                  <input type="range" min={20} max={100} value={matchStrength} onChange={e => setMatchStrength(+e.target.value)}
                    style={{ width: '100%', accentColor: 'rgba(244,114,182,0.9)' }} />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>How strongly your voice is pushed toward the reference timbre</div>
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Gap Fill <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{matchGapFill}%</span>
                  </div>
                  <input type="range" min={0} max={100} value={matchGapFill} onChange={e => setMatchGapFill(+e.target.value)}
                    style={{ width: '100%', accentColor: 'rgba(139,92,246,0.9)' }} />
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>Blends in content from the reference track for frequencies your voice doesn&apos;t cover</div>
                </div>
              </div>

              {/* Match button */}
              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={runMatchStudio}
                  disabled={!matchTarget || !matchVocal || matchLoading}
                  style={{ ...btnBase, fontSize: 13, padding: '10px 36px', background: (!matchTarget || !matchVocal || matchLoading) ? 'rgba(236,72,153,0.1)' : 'rgba(236,72,153,0.85)', color: '#fff', border: 'none', cursor: (!matchTarget || !matchVocal || matchLoading) ? 'not-allowed' : 'pointer', opacity: (!matchTarget || !matchVocal) ? 0.5 : 1 }}
                >
                  {matchLoading ? matchProgress || 'Processing…' : '▶ Match →'}
                </button>
                {!matchTarget && !matchVocal && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Load a reference track and your voice to get started</div>}
                {matchTarget && !matchVocal && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Record or load your voice</div>}
                {!matchTarget && matchVocal && <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 6 }}>Load a reference track</div>}
              </div>

              {/* Result */}
              {matchResult && (
                <div style={{ background: 'var(--bg-card)', border: '1px solid rgba(236,72,153,0.25)', borderRadius: 10, padding: '14px 18px' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'rgba(244,114,182,1)', marginBottom: 10 }}>Result</div>
                  <div style={{ background: 'rgba(0,0,0,0.2)', borderRadius: 8, padding: '6px 8px', marginBottom: 10 }}>
                    <WaveViz buf={matchResult} color="rgba(244,114,182,0.9)" />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      onClick={() => matchPlayingSlot === 'result' ? matchStopPlay() : matchPlaySlot('result')}
                      style={{ ...btnBase, background: matchPlayingSlot === 'result' ? 'rgba(236,72,153,0.2)' : 'var(--bg-card)', color: matchPlayingSlot === 'result' ? 'rgba(244,114,182,1)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}
                    >
                      {matchPlayingSlot === 'result' ? '■ Stop' : '▶ Play Result'}
                    </button>
                    <button onClick={addMatchResultToTimeline}
                      style={{ ...btnBase, background: 'rgba(139,92,246,0.15)', color: 'rgba(167,139,250,1)', border: '1px solid rgba(139,92,246,0.3)' }}
                    >
                      + Add to timeline
                    </button>
                    <button onClick={exportMatchResult}
                      style={{ ...btnBase, background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                    >
                      ↓ Export WAV
                    </button>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 'auto' }}>{matchResult.duration.toFixed(1)}s</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {abletonImportOpen && abletonProject && (() => {
        const totalClips = abletonProject.tracks.filter(t => abletonSelected.has(t.id)).reduce((n, t) => n + t.clips.length, 0)
        const dbLabel = (v: number) => {
          const db = 20 * Math.log10(Math.max(v, 0.001))
          return db >= -0.1 ? '0 dB' : `${db.toFixed(1)} dB`
        }
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 399, background: 'rgba(0,0,0,0.55)' }} onClick={() => setAbletonImportOpen(false)} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              zIndex: 400, background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 14, padding: 22, width: 520, maxHeight: '80vh',
              display: 'flex', flexDirection: 'column', gap: 14,
              boxShadow: '0 16px 48px rgba(0,0,0,0.7)',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{abletonProject.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {abletonProject.bpm} BPM · {abletonProject.tracks.length} audio track{abletonProject.tracks.length !== 1 ? 's' : ''}
                  </div>
                </div>
                <button onClick={() => setAbletonImportOpen(false)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
              </div>

              {/* Track list */}
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                {abletonProject.tracks.map(track => {
                  const checked = abletonSelected.has(track.id)
                  const panPct = Math.round(track.pan * 100)
                  return (
                    <label key={track.id} style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
                      background: checked ? 'var(--bg-card)' : 'transparent',
                      border: `1px solid ${checked ? 'var(--border)' : 'transparent'}`,
                      opacity: track.muted ? 0.45 : 1,
                    }}>
                      <input type="checkbox" checked={checked} onChange={e => {
                        setAbletonSelected(prev => {
                          const n = new Set(prev)
                          e.target.checked ? n.add(track.id) : n.delete(track.id)
                          return n
                        })
                      }} style={{ accentColor: 'var(--accent)', width: 14, height: 14, flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {track.name}{track.muted ? ' (muted)' : ''}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
                          {track.clips.length} clip{track.clips.length !== 1 ? 's' : ''}
                          · Vol {dbLabel(track.volume)}
                          {track.pan !== 0 ? ` · Pan ${panPct > 0 ? 'R' : 'L'}${Math.abs(panPct)}%` : ''}
                        </div>
                      </div>
                      {/* Mini volume bar */}
                      <div style={{ width: 48, height: 4, background: 'var(--border)', borderRadius: 2, flexShrink: 0 }}>
                        <div style={{ width: `${Math.min(100, track.volume * 100)}%`, height: '100%', background: 'var(--accent)', borderRadius: 2 }} />
                      </div>
                    </label>
                  )
                })}
              </div>

              {/* Footer */}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={() => setAbletonSelected(new Set(abletonProject.tracks.map(t => t.id)))}
                  style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>
                  All
                </button>
                <button onClick={() => setAbletonSelected(new Set())}
                  style={{ padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}>
                  None
                </button>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {totalClips} clip{totalClips !== 1 ? 's' : ''} selected
                </div>
                <div style={{ flex: 1 }} />
                <button onClick={() => void importAbletonTracks()} disabled={totalClips === 0}
                  style={{ padding: '8px 20px', borderRadius: 7, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: totalClips > 0 ? 'pointer' : 'default', opacity: totalClips > 0 ? 1 : 0.5 }}>
                  Import {totalClips > 0 ? totalClips : ''} clip{totalClips !== 1 ? 's' : ''} →
                </button>
              </div>
            </div>
          </>
        )
      })()}

      {/* Ableton loading overlay */}
      {abletonLoading && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 500, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 18px', fontSize: 12, color: 'var(--text-primary)', boxShadow: '0 4px 20px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 14, height: 14, border: '2px solid var(--accent)', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          {abletonProgress || 'Loading…'}
        </div>
      )}

      {/* ── Segment panel ─────────────────────────────────────────────────── */}
      {segmentPanel && (() => {
        const clip = audioClips.find(c => c.id === segmentPanel)
        if (!clip?.segments?.length) { setSegmentPanel(null); return null }
        const segs = clip.segments
        const totalDur = clip.buf.duration
        // Assign a hue per MIDI note (chromatic wheel)
        const noteHue = (midi: number) => (midi % 12) * 30
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 299, background: 'rgba(0,0,0,0.45)' }} onClick={() => setSegmentPanel(null)} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              zIndex: 300, background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 14, padding: 20, width: 520, maxHeight: '80vh',
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}>
              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Note Segments — {clip.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                    {segs.length} notes · {totalDur.toFixed(1)}s · Preview or re-convert individual notes
                  </div>
                </div>
                <button onClick={() => setSegmentPanel(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20, lineHeight: 1, padding: '0 2px' }}>×</button>
              </div>

              {/* Note timeline bar */}
              <div style={{ display: 'flex', height: 32, borderRadius: 6, overflow: 'hidden', gap: 1, background: 'var(--bg-card)' }}>
                {segs.map(seg => {
                  const w = ((seg.endSec - seg.startSec) / totalDur) * 100
                  const color = `hsl(${noteHue(seg.midi)}, 70%, 55%)`
                  return (
                    <div key={seg.id} title={`${seg.noteName}: ${seg.startSec.toFixed(2)}s – ${seg.endSec.toFixed(2)}s`}
                      style={{
                        width: `${w}%`, background: color, minWidth: 2,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, fontWeight: 700, color: 'white', textShadow: '0 1px 2px rgba(0,0,0,0.7)',
                        overflow: 'hidden', whiteSpace: 'nowrap',
                      }}
                    >{w > 6 ? seg.noteName : ''}</div>
                  )
                })}
              </div>

              {/* Note list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, overflowY: 'auto', maxHeight: 340 }}>
                {segs.map((seg, idx) => {
                  const dur = (seg.endSec - seg.startSec).toFixed(2)
                  const color = `hsl(${noteHue(seg.midi)}, 70%, 55%)`
                  return (
                    <div key={seg.id} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '7px 10px', borderRadius: 7,
                      background: 'var(--bg-card)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ width: 8, height: 34, borderRadius: 3, background: color, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                          {seg.noteName}
                          <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>note {idx + 1}</span>
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {seg.startSec.toFixed(2)}s – {seg.endSec.toFixed(2)}s · {dur}s · vol {Math.round(seg.amplitude * 100)}%
                        </div>
                      </div>
                      <button
                        onClick={() => {
                          const subBuf = extractSubBuffer(clip.buf, seg.startSec, seg.endSec)
                          const actx = new AudioContext()
                          const src = actx.createBufferSource()
                          src.buffer = subBuf; src.connect(actx.destination)
                          src.onended = () => actx.close()
                          src.start()
                        }}
                        title="Preview this note"
                        style={{ padding: '5px 9px', borderRadius: 5, border: '1px solid var(--border)', background: 'var(--bg-surface)', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }}
                      >▶</button>
                      <button
                        onClick={() => reConvertSegment(clip.id, seg.id, DEFAULT_SYNTH_OPTIONS)}
                        title="Re-synthesize just this note"
                        style={{ padding: '5px 9px', borderRadius: 5, border: '1px solid rgba(139,92,246,0.4)', background: 'rgba(139,92,246,0.1)', color: 'var(--accent-light)', fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >Re-convert</button>
                    </div>
                  )
                })}
              </div>

              <div style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                If a specific note sounds wrong, preview it to confirm, then re-convert it or describe the problem to the AI Conversion Tuner.
              </div>
            </div>
          </>
        )
      })()}

      {/* ── Piano Roll overlay ─────────────────────────────────────────────── */}
      {pianoRollLane && (
        <Suspense fallback={null}>
        <PianoRoll
          laneType={pianoRollLane}
          laneColor={typeColor(pianoRollLane, typeOverrides)}
          hits={(hitsByType.get(pianoRollLane) ?? []).filter(h => h.type === pianoRollLane)}
          duration={duration}
          bpm={effectiveBpmRef.current}
          onClose={() => setPianoRollLane(null)}
          onHitsChange={nextHits => {
            setHits(prev => [
              ...prev.filter(h => h.type !== pianoRollLane),
              ...nextHits,
            ])
          }}
        />
        </Suspense>
      )}
      {stepSeqLane && (
        <Suspense fallback={null}>
        <StepSequencer
          laneType={stepSeqLane}
          laneColor={typeColor(stepSeqLane, typeOverrides)}
          hits={(hitsByType.get(stepSeqLane) ?? []).filter(h => h.type === stepSeqLane)}
          duration={duration}
          bpm={effectiveBpmRef.current}
          onClose={() => setStepSeqLane(null)}
          onHitsChange={nextHits => {
            setHits(prev => [
              ...prev.filter(h => h.type !== stepSeqLane),
              ...nextHits,
            ])
          }}
        />
        </Suspense>
      )}
      {chordBuilderLane && (
        <Suspense fallback={null}>
        <ChordProgressionBuilder
          laneType={chordBuilderLane}
          bpm={effectiveBpmRef.current}
          duration={duration}
          onClose={() => setChordBuilderLane(null)}
          onHitsChange={nextHits => {
            setHits(prev => [
              ...prev.filter(h => h.type !== chordBuilderLane),
              ...nextHits,
            ])
          }}
        />
        </Suspense>
      )}

      {/* ── Arpeggiator ─────────────────────────────────────────────────── */}
      {arpLane && (
        <Suspense fallback={null}>
          <Arpeggiator
            laneType={arpLane}
            laneColor={typeColor(arpLane, typeOverrides)}
            existingHits={(hitsByType.get(arpLane) ?? []).filter(h => h.type === arpLane)}
            bpm={effectiveBpmRef.current}
            duration={duration}
            onClose={() => setArpLane(null)}
            onHitsChange={nextHits => {
              captureHistory()
              setHits(prev => [...prev.filter(h => h.type !== arpLane), ...nextHits])
            }}
          />
        </Suspense>
      )}

      {/* ── Input source picker ────────────────────────────────────────── */}
      {inputSourcePickerLane && (() => {
        const curSrc = inputSource[inputSourcePickerLane] ?? 'default'
        const selectSrc = (src: string) => {
          setInputSource(prev => ({ ...prev, [inputSourcePickerLane]: src }))
          setInputSourcePickerLane(null)
        }
        const srcBtn = (key: string, icon: string, label: string, sub: string) => {
          const active = curSrc === key
          return (
            <button key={key} onClick={() => selectSrc(key)} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', width: '100%',
              borderRadius: 8, cursor: 'pointer', textAlign: 'left',
              background: active ? 'rgba(220,38,38,0.1)' : 'var(--bg-card)',
              border: `1px solid ${active ? 'rgba(220,38,38,0.45)' : 'var(--border)'}`,
            }}>
              <span style={{ fontSize: 18, lineHeight: 1, flexShrink: 0 }}>{icon}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: active ? '#ef4444' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>
              </div>
              {active && <span style={{ fontSize: 12, color: '#ef4444', flexShrink: 0 }}>✓</span>}
            </button>
          )
        }
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 499 }} onClick={() => setInputSourcePickerLane(null)} />
            <div style={{
              position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
              zIndex: 500, background: 'var(--bg-surface)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 20, width: 320, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
              maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            }}>
              {/* Header */}
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: typeColor(inputSourcePickerLane as BeatType, typeOverrides), marginRight: 8, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>
                  Input — {typeLabel(inputSourcePickerLane as BeatType, typeOverrides)}
                </span>
                <button onClick={() => setInputSourcePickerLane(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 18, lineHeight: 1 }}>✕</button>
              </div>

              {/* Audio inputs */}
              <div style={{ overflowY: 'auto', flex: 1 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Audio input</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {pickerDevices.length === 0
                    ? <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 0' }}>Requesting device access…</div>
                    : pickerDevices.map((d, i) =>
                        srcBtn(
                          d.deviceId,
                          '🎙',
                          d.label || `Microphone ${i + 1}`,
                          d.deviceId === 'default' ? 'System default audio input' : d.deviceId === 'communications' ? 'Default communications device' : 'Audio input device',
                        )
                      )
                  }
                </div>

                {/* MIDI section */}
                {'requestMIDIAccess' in navigator && (
                  <>
                    <div style={{ borderTop: '1px solid var(--border)', margin: '14px 0 10px' }} />
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>MIDI</div>
                    {srcBtn('midi', '♪', 'MIDI input', 'Routes MIDI note-ons from any connected device into this track')}
                  </>
                )}
              </div>
            </div>
          </>
        )
      })()}

      {/* ── Command Palette (Cmd+K) ─────────────────────────────────────── */}
      <Suspense fallback={null}>
        <CommandPalette
          open={cmdPaletteOpen}
          onClose={() => setCmdPaletteOpen(false)}
          actions={[
            // Transport
            { id: 'play', label: 'Play / Pause', group: 'Transport', shortcut: 'Space', action: () => { if (isPlaying) stopPlayback(); else startPlayback(); setCmdPaletteOpen(false) } },
            { id: 'undo', label: 'Undo', group: 'Edit', shortcut: '⌘Z', action: () => { undo(); setCmdPaletteOpen(false) } },
            { id: 'redo', label: 'Redo', group: 'Edit', shortcut: '⌘⇧Z', action: () => { redo(); setCmdPaletteOpen(false) } },
            { id: 'quantize', label: 'Quantize hits to grid', group: 'Edit', shortcut: 'Q', action: () => { quantizeHits(); setCmdPaletteOpen(false) } },
            { id: 'humanize-light', label: 'Humanize (light)', group: 'Edit', action: () => { humanizeHits(0.25); setCmdPaletteOpen(false) } },
            { id: 'humanize-heavy', label: 'Humanize (heavy)', group: 'Edit', action: () => { humanizeHits(0.7); setCmdPaletteOpen(false) } },
            { id: 'tap', label: 'Tap tempo', group: 'Transport', shortcut: 'T', action: () => { tapTempo(); setCmdPaletteOpen(false) } },
            { id: 'metronome', label: metronomeOn ? 'Disable metronome' : 'Enable metronome', group: 'Transport', action: () => { setMetronomeOn(v => !v); setCmdPaletteOpen(false) } },
            // Export
            { id: 'save', label: 'Save project', group: 'File', action: () => { saveProject(); setCmdPaletteOpen(false) } },
            { id: 'export-stems', label: 'Export stems (WAV)', group: 'File', action: () => { void exportStems(); setCmdPaletteOpen(false) } },
            { id: 'export-midi', label: 'Export MIDI', group: 'File', action: () => { exportMidi(); setCmdPaletteOpen(false) } },
            // Views
            { id: 'view-arr', label: 'Switch to Arrangement view', group: 'View', action: () => { setViewMode('arrangement'); setCmdPaletteOpen(false) } },
            { id: 'view-ses', label: 'Switch to Session view', group: 'View', action: () => { setViewMode('session'); setCmdPaletteOpen(false) } },
            { id: 'zoom-in', label: 'Zoom in', group: 'View', action: () => { setZoomLevel(z => Math.min(8, +(z * 1.5).toFixed(2))); setCmdPaletteOpen(false) } },
            { id: 'zoom-out', label: 'Zoom out', group: 'View', action: () => { setZoomLevel(z => Math.max(0.5, +(z / 1.5).toFixed(2))); setCmdPaletteOpen(false) } },
            { id: 'add-track', label: 'Add custom track', group: 'Tracks', action: () => { addCustomLane(); setCmdPaletteOpen(false) } },
            // Per-lane actions
            ...activeLaneTypes.flatMap(type => {
              const lbl = typeLabel(type, typeOverrides)
              const actions = [
                { id: `mute-${type}`, label: `${mutedTypes.has(type) ? 'Unmute' : 'Mute'}: ${lbl}`, group: 'Lanes', action: () => { toggleMute(type); setCmdPaletteOpen(false) } },
                { id: `solo-${type}`, label: `${soloedLanes.has(type) ? 'Unsolo' : 'Solo'}: ${lbl}`, group: 'Lanes', action: () => { toggleSolo(type); setCmdPaletteOpen(false) } },
                { id: `stepseq-${type}`, label: `Open Step Sequencer: ${lbl}`, group: 'Lanes', action: () => { setStepSeqLane(type); setCmdPaletteOpen(false) } },
                { id: `spec-${type}`, label: `${specLanes.has(type) ? 'Hide' : 'Show'} Spectrum: ${lbl}`, group: 'Lanes', action: () => { toggleSpecLane(type); setCmdPaletteOpen(false) } },
                { id: `mini-${type}`, label: `${miniLanes.has(type) ? 'Expand' : 'Collapse'} Lane: ${lbl}`, group: 'Lanes', action: () => { toggleMiniLane(type); setCmdPaletteOpen(false) } },
              ]
              if (MELODIC_TYPES.has(type)) {
                actions.push({ id: `piano-${type}`, label: `Open Piano Roll: ${lbl}`, group: 'Lanes', action: () => { setPianoRollLane(type); setCmdPaletteOpen(false) } })
                actions.push({ id: `chord-${type}`, label: `Open Chord Builder: ${lbl}`, group: 'Lanes', action: () => { setChordBuilderLane(type); setCmdPaletteOpen(false) } })
              }
              return actions
            }),
          ]}
        />
      </Suspense>

      {/* ── Instrument editor overlays ──────────────────────────────────────── */}
      {samplerLane && samplerPatch && (
        <Suspense fallback={null}>
          <SamplerEditor patch={samplerPatch} onPatchChange={setSamplerPatch} onClose={() => { setSamplerLane(null); setSamplerPatch(null) }} />
        </Suspense>
      )}
      {wavetableLane && wavetablePatch && (
        <Suspense fallback={null}>
          <WavetableSynthEditor patch={wavetablePatch} onPatchChange={setWavetablePatch} onClose={() => { setWavetableLane(null); setWavetablePatch(null) }} />
        </Suspense>
      )}
      {fmSynthLane && fmPatch && (
        <Suspense fallback={null}>
          <FMSynthEditor patch={fmPatch} onPatchChange={setFmPatch} onClose={() => { setFmSynthLane(null); setFmPatch(null) }} />
        </Suspense>
      )}

      {/* ── Comp Editor overlay ─────────────────────────────────────────────── */}
      {openCompGroup && (() => {
        const group = compGroups.find(g => g.id === openCompGroup)
        if (!group) return null
        return (
          <Suspense fallback={null}>
            <CompEditor
              group={group}
              clips={audioClips}
              onGroupChange={updated => setCompGroups(prev => prev.map(g => g.id === updated.id ? updated : g))}
              onRenderComp={async (g) => {
                const rendered = await renderComp(g, audioClips)
                const clip = mkClip(crypto.randomUUID(), g.laneType, rendered, g.loopStart, 'Comp')
                setAudioClips(prev => [...prev, clip])
                setOpenCompGroup(null)
              }}
              onClose={() => setOpenCompGroup(null)}
            />
          </Suspense>
        )
      })()}

      {/* ── Snapshot Panel ───────────────────────────────────────────────── */}
      {snapshotPanelOpen && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 499 }} onClick={() => setSnapshotPanelOpen(false)} />
          <div style={{ position: 'fixed', top: 48, right: 12, zIndex: 500, width: 320, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', overflow: 'hidden' }}>
            <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>📸 Project Snapshots</span>
              <button onClick={() => setSnapshotPanelOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 16, lineHeight: 1, padding: 0 }}>×</button>
            </div>
            <div style={{ padding: 12 }}>
              <div data-hint="Save Snapshot||Give this checkpoint a descriptive name so you remember what state you're saving. You can restore it later even after making many changes." style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                <input
                  type="text" placeholder="Name this snapshot…" value={snapshotName}
                  onChange={e => setSnapshotName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && snapshotName.trim() && saveSnapshot(snapshotName)}
                  style={{ flex: 1, fontSize: 11, padding: '5px 8px', borderRadius: 5, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
                />
                <button
                  data-hint="Save Snapshot||Captures the full state of your project right now — all hits, clips, effects, BPM, groups — and stores it with the name you typed."
                  onClick={() => saveSnapshot(snapshotName)}
                  disabled={!snapshotName.trim() || savingSnapshot}
                  style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 5, background: 'rgba(139,92,246,0.18)', border: '1px solid rgba(139,92,246,0.4)', color: 'rgba(167,139,250,1)', cursor: snapshotName.trim() ? 'pointer' : 'default', opacity: snapshotName.trim() ? 1 : 0.5 }}
                >
                  {savingSnapshot ? '…' : 'Save'}
                </button>
              </div>
              <div style={{ maxHeight: 340, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {loadingSnapshots && <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: 8 }}>Loading…</div>}
                {!loadingSnapshots && snapshots.length === 0 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '12px 4px' }}>No snapshots yet — save one above to create a restore point.</div>
                )}
                {snapshots.map(snap => (
                  <div key={snap.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', borderRadius: 7, background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snap.name}</div>
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginTop: 1 }}>
                        {new Date(snap.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <button
                      data-hint="Restore Snapshot||Replaces the current project state with this snapshot. Your current changes will be lost — make a new snapshot first if you want to keep them."
                      onClick={() => restoreSnapshot(snap)}
                      style={{ fontSize: 9, fontWeight: 600, padding: '3px 7px', borderRadius: 4, background: 'rgba(139,92,246,0.12)', border: '1px solid rgba(139,92,246,0.3)', color: 'rgba(167,139,250,0.9)', cursor: 'pointer', flexShrink: 0 }}
                    >Restore</button>
                    <button
                      onClick={() => deleteSnapshot(snap.id)}
                      style={{ fontSize: 9, padding: '3px 5px', borderRadius: 4, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', cursor: 'pointer', flexShrink: 0 }}
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── MIDI Mapping Panel ────────────────────────────────────────────── */}
      <MidiMappingPanel
        open={showMidiPanel}
        mappings={midiMappings}
        learningTarget={midiLearning}
        onStartLearn={(t) => setMidiLearning(t)}
        onStopLearn={() => setMidiLearning(null)}
        onUpdateMapping={(id, update) => setMidiMappings(prev => prev.map(m => m.id === id ? { ...m, ...update } : m))}
        onDeleteMapping={(id) => setMidiMappings(prev => prev.filter(m => m.id !== id))}
        onImport={(imported) => setMidiMappings(imported)}
        onExport={handleMidiExport}
        onClose={() => setShowMidiPanel(false)}
        activeLaneTypes={activeLaneTypes}
        laneLabels={Object.fromEntries(activeLaneTypes.map(t => [t, typeLabel(t, typeOverrides)]))}
        lastAddedId={lastMappedId}
      />

      {/* ── Digital MIDI Keyboard ─────────────────────────────────────────── */}
      <MidiKeyboard
        open={showKeyboard}
        onClose={() => setShowKeyboard(false)}
        bpm={bpm ?? 120}
      />
    </div>
    </TooltipModeProvider>
  )
}
