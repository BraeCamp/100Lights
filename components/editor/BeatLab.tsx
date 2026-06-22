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
import type { BeatHit, BeatAnalysis, BeatType, BeatTrackEntry, ReferenceSound, HitSpectral } from '@/lib/beat-analyzer'
import { analyzeBeats } from '@/lib/beat-analyzer'
import { playDrumHit } from '@/lib/drum-samples'
import { playMelodicNote, MELODIC_TYPES } from '@/lib/instrument-synth'
import { aiClassifyHits } from '@/lib/ai-beat-classifier'
import { correctionsAdd, correctionsGetAll } from '@/lib/correction-store'
import { libraryGetAll } from '@/lib/sound-library'
import { sampleGetAll } from '@/lib/sample-pack'
import { detectPitchCurve, detectPitchCurveAsync, synthesizeFromPitchCurve, extractNoteEvents, synthesizeInstrument, DEFAULT_SYNTH_OPTIONS, type SynthOptions } from '@/lib/pitch-detector'
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

// ── Constants ────────────────────────────────────────────────────────────────

const ALL_DRUM_TYPES: BeatType[] = ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'crash', 'rim']
const DEFAULT_ENABLED: BeatType[] = []

type InstrumentFamily = 'drums' | 'guitar' | 'piano' | 'synth'
const FAMILY_LABEL: Record<InstrumentFamily, string> = { drums: 'Drums', guitar: 'Guitar', piano: 'Piano', synth: 'Synth' }
const FAMILY_VARIANTS: Record<Exclude<InstrumentFamily, 'drums'>, BeatType[]> = {
  guitar: ['guitar-acoustic', 'guitar-electric', 'guitar-nylon'],
  piano:  ['piano-grand', 'piano-electric', 'piano-rhodes'],
  synth:  ['synth-lead', 'synth-pad', 'synth-bass', 'synth-arp'],
}

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
  const ab  = await blob.arrayBuffer()
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
}

function clipEffectiveDuration(c: AudioClipShape) {
  return c.loopDuration ?? c.stretchDuration ?? c.buf.duration
}

function WaveformCanvas({ buf, color, gain = 1, gateThreshold = 0, loopDuration = null, stretchDuration = null, fadeIn = 0, fadeOut = 0, reversed = false, warpMarkers = [] }: {
  buf: AudioClipShape['buf']; color: string
  gain?: number; gateThreshold?: number; loopDuration?: number | null; stretchDuration?: number | null
  fadeIn?: number; fadeOut?: number; reversed?: boolean; warpMarkers?: WarpMarker[]
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
  }, [buf, color, gain, gateThreshold, loopDuration, stretchDuration, fadeIn, fadeOut, reversed, warpMarkers])
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

function FxSlot({ fx, onToggleEnabled, onRemove, onParamChange }: {
  fx: LaneEffect
  onToggleEnabled: () => void
  onRemove: () => void
  onParamChange: (key: string, val: number) => void
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
  onToggleMute: () => void
  onLaneContextMenu: (e: React.MouseEvent) => void
  onHitRightClick: (e: React.MouseEvent, id: string) => void
  onClipRightClick: (e: React.MouseEvent, clipId: string) => void
  onClipDelete: (clipId: string) => void
  onClipSelect: (clipId: string) => void
  selectedClipId: string | null
  onClipUpdate: (clipId: string, update: Partial<Pick<AudioClipShape, 'startTime' | 'gain' | 'stretchDuration' | 'loopDuration' | 'gateThreshold' | 'fadeIn' | 'fadeOut' | 'color' | 'reversed' | 'warpMarkers'>>) => void
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
}

function Lane({ type, hits, clips, duration, pxWidth, selectedIds, muted, aiSuggestions, aiDeletions, typeOverrides, isCustom, isActiveLane, snapInterval, onSelectHit, onSelectLane, onOpenPianoRoll, onOpenStepSeq, onOpenChordBuilder, onMoveHit, onDeleteHit, onAddHit, onToggleMute, onLaneContextMenu, onHitRightClick, onClipRightClick, onClipDelete, onClipSelect, selectedClipId, onClipUpdate, pan, soloed, anySoloed, onPanChange, onSoloToggle, effects, fxOpen, fxAddOpen, onFxToggleOpen, onFxAddOpen, onFxAddClose, onFxAdd, onFxRemove, onFxToggleEnabled, onFxParamChange, onFxRandomize, automLanes, automOpen, automAddOpen, onAutomToggle, onAutomAddOpen, onAutomAddClose, onAutomAdd, onAutomRemove, onAutomPointAdd, onAutomPointUpdate, onAutomPointDelete, level = 0, miniMode = false, spectrumOpen = false, analyserNode, onToggleMini, onToggleSpectrum, loopBeats = 0, onLoopBeatsChange, inputArmed = false, inputSource, onToggleInput, onOpenInputPicker }: LaneProps) {
  const color = typeColor(type, typeOverrides)
  const label = typeLabel(type, typeOverrides)

  const [dotMenuOpen, setDotMenuOpen] = useState(false)

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
    const [t, note] = calcLaneHit(e)
    onAddHit(t, note)
  }

  const dimmed = muted || (anySoloed && !soloed)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)', opacity: dimmed ? 0.45 : 1 }}>
    <div style={{ display: 'flex', alignItems: 'stretch', height: miniMode ? 28 : LANE_HEIGHT }}>
      {/* Lane header: label + M/S + ··· menu */}
      <div
        onContextMenu={e => { e.preventDefault(); onLaneContextMenu(e) }}
        style={{
          width: 140, flexShrink: 0, position: 'relative', borderRight: '1px solid var(--border)',
          background: isActiveLane ? 'var(--accent-subtle)' : 'var(--bg-surface)',
          display: 'flex', flexDirection: 'column', userSelect: 'none',
          borderLeft: isActiveLane ? `2px solid ${color}` : '2px solid transparent',
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
                onClick={e => { e.stopPropagation(); onToggleMute() }}
                style={{ fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, cursor: 'pointer',
                  background: muted ? 'rgba(239,68,68,0.18)' : 'var(--bg-card)',
                  border: `1px solid ${muted ? 'rgba(239,68,68,0.4)' : 'var(--border)'}`,
                  color: muted ? '#ef4444' : 'var(--text-muted)' }}
              >M</button>
            </Tooltip>
            <Tooltip content={soloed ? 'Unsolo lane' : 'Solo lane (mutes all other tracks)'} placement="right">
              <button
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

      {/* Hit area — left-click adds, right-click adds (snapped) */}
      <div
        onClick={miniMode ? undefined : handleLaneClick}
        onContextMenu={miniMode ? undefined : handleLaneRightClick}
        style={{
          flex: 1, position: 'relative', cursor: miniMode ? 'default' : muted ? 'default' : 'crosshair', height: miniMode ? 28 : LANE_HEIGHT,
          background: 'var(--bg-card)',
          backgroundImage: 'repeating-linear-gradient(90deg, transparent, transparent calc(12.5% - 1px), var(--border) calc(12.5% - 1px), var(--border) 12.5%)',
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

                // Alt+click in move zone: drop or remove a warp marker
                if (e.altKey && zone === 'move') {
                  const timeFrac = Math.max(0.01, Math.min(0.99, rx / r.width))
                  const bufFrac  = timeFrac
                  const existing = clip.warpMarkers.findIndex(m => Math.abs(m.timeFrac - timeFrac) < 0.04)
                  if (existing >= 0) {
                    onClipUpdate(clip.id, { warpMarkers: clip.warpMarkers.filter((_, i) => i !== existing) })
                  } else {
                    const updated = [...clip.warpMarkers, { bufFrac, timeFrac }].sort((a, b) => a.timeFrac - b.timeFrac)
                    onClipUpdate(clip.id, { warpMarkers: updated })
                  }
                  return
                }

                const drag = (mv: (me: MouseEvent) => void) => {
                  const track = (me: MouseEvent) => {
                    if (Math.abs(me.clientX - sx) > 3 || Math.abs(me.clientY - sy) > 3) moved = true
                    mv(me)
                  }
                  const up = () => {
                    if (!moved && zone === 'move') onClipSelect(clip.id)
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
                border: `1px solid ${isConverting ? 'rgba(139,92,246,0.3)' : selectedClipId === clip.id ? 'rgba(250,250,100,0.85)' : clip.muted ? 'rgba(100,100,120,0.25)' : `${clipBaseColor}80`}`,
                boxShadow: selectedClipId === clip.id ? '0 0 0 1px rgba(250,250,100,0.4)' : 'none',
                overflow: 'hidden', cursor: isConverting ? 'wait' : 'grab',
              }}
            >
              {!isConverting && (
                <WaveformCanvas buf={clip.buf} color={waveColor}
                  gain={clip.gain} gateThreshold={clip.gateThreshold}
                  loopDuration={clip.loopDuration} stretchDuration={clip.stretchDuration}
                  fadeIn={clip.fadeIn} fadeOut={clip.fadeOut}
                  reversed={clip.reversed} warpMarkers={clip.warpMarkers} />
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
              onParamChange={(key, val) => onFxParamChange(fx.id, key, val)} />
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
  onExport?: (hits: BeatHit[], bpm: number | null) => void
  hasSong?: boolean
  onRequestSongPlay?: () => void
  onRequestSongStop?: () => void
  requestedFamily?: InstrumentFamily | null
  onHitsChange?: (hits: BeatHit[], duration: number, bpm: number | null) => void
  onAddTrack?: (entry: BeatTrackEntry) => void
  requestRecord?: number  // increment to trigger recording (plays song automatically)
  onPhaseChange?: (phase: Phase) => void
  lanesContainer?: Element | null  // when set, lane editor renders into this element via portal
  analyzeStemUrl?: string | null   // when set, fetch + analyze this audio URL directly (bypasses mic)
  stemLabel?: string               // display name for the stem being analyzed e.g. "drums stem"
  onStemAnalyzed?: () => void      // called after stem analysis completes (or fails)
}

export default function BeatLab({ onExport, hasSong, onRequestSongPlay, onRequestSongStop, requestedFamily, onHitsChange, onAddTrack, requestRecord, onPhaseChange, lanesContainer, analyzeStemUrl, stemLabel, onStemAnalyzed }: BeatLabProps) {
  const [phase, setPhase] = useState<Phase>('editing')
  const [analysis, setAnalysis] = useState<BeatAnalysis | null>(null)
  const [hits, setHits] = useState<BeatHit[]>([])
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
  const [bpm, setBpm] = useState<number | null>(null)
  const [duration, setDuration] = useState(8)
  const [showTypeMenu, setShowTypeMenu] = useState(false)
  const [mutedTypes, setMutedTypes] = useState<Set<BeatType>>(new Set())
  const [audioBuf, setAudioBuf] = useState<AudioBuffer | null>(null)
  const [selectedTypes, setSelectedTypes] = useState<Set<BeatType>>(new Set(DEFAULT_ENABLED))
  const [instrumentFamily, setInstrumentFamily] = useState<InstrumentFamily>('drums')
  const [melodicVariant, setMelodicVariant] = useState<BeatType>('piano-grand')

  // Let the parent switch modes (e.g. AudioEditor's "Voice Transcription" button)
  useEffect(() => {
    if (requestedFamily) setInstrumentFamily(requestedFamily)
  }, [requestedFamily])

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
  const [extraLaneIds, setExtraLaneIds]   = useState<string[]>([])

  function renameType(typeId: string, label: string, color: string) {
    setTypeOverrides(prev => ({ ...prev, [typeId]: { label, color } }))
  }
  function addCustomLane() {
    const id = `cust_${Date.now()}`
    setTypeOverrides(prev => ({ ...prev, [id]: { label: 'New Sound', color: '#6b7280' } }))
    setExtraLaneIds(prev => [...prev, id])
    return id
  }

  // Seed one default track on fresh project load
  useEffect(() => {
    setExtraLaneIds(prev => {
      if (prev.length > 0) return prev
      const id = `cust_${Date.now()}`
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
  }

  function removeLane(type: BeatType) {
    // Works on any lane (built-in or custom); built-ins just disappear when they have no hits
    setTypeOverrides(prev => { const n = { ...prev }; delete n[type as string]; return n })
    setExtraLaneIds(prev => prev.filter(x => x !== type as string))
    setHits(prev => prev.filter(h => h.type !== type))
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
  }
  function mkClip(id: string, laneType: string, buf: AudioBuffer, startTime: number, name: string): AudioClip {
    return { id, laneType, buf, startTime, muted: false, name, gain: 1, stretchDuration: null, loopDuration: null, gateThreshold: 0, originalBuf: null, fadeIn: 0, fadeOut: 0, color: null, reversed: false, warpMarkers: [] }
  }
  const [audioClips, setAudioClips] = useState<AudioClip[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const clipboardRef = useRef<AudioClip[]>([])
  const [clipMenu, setClipMenu] = useState<{ clipId: string; x: number; y: number; convertOpen?: boolean } | null>(null)
  type BeatSensitivity = 'low' | 'medium' | 'high'
  type InstrumentPreset = 'piano' | 'strings' | 'bells' | 'bass' | 'organ'
  const [convertCard, setConvertCard] = useState<{
    clipId: string
    mode: 'synth' | 'beats' | 'instrument'
    synthOpts: SynthOptions
    sensitivity: BeatSensitivity
    instrument: InstrumentPreset
  } | null>(null)

  function openConvertCard(clipId: string, mode: 'synth' | 'beats' | 'instrument') {
    setClipMenu(null)
    setConvertCard({ clipId, mode, synthOpts: { ...DEFAULT_SYNTH_OPTIONS }, sensitivity: 'medium', instrument: 'piano' })
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
      setError(`Beat conversion failed: ${e instanceof Error ? e.message : String(e)}`)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Voice' } : c))
    }
  }

  async function runConvertToSynth(clipId: string, opts: SynthOptions) {
    const clip = audioClips.find(c => c.id === clipId)
    if (!clip) return
    setConvertCard(null)
    setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Converting…' } : c))
    const source = clip.originalBuf ?? clip.buf  // always derive from original recording
    try {
      const curve    = await detectPitchCurveAsync(source)
      const rendered = await synthesizeFromPitchCurve(curve, source.sampleRate, 60, source.duration, opts)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, buf: rendered, name: 'Synth', originalBuf: c.originalBuf ?? c.buf } : c))
    } catch (e) {
      setError(`Synth conversion failed: ${e instanceof Error ? e.message : String(e)}`)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Voice' } : c))
    }
  }

  async function runConvertToInstrument(clipId: string, preset: InstrumentPreset) {
    const clip = audioClips.find(c => c.id === clipId)
    if (!clip) return
    setConvertCard(null)
    setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Converting…' } : c))
    const source = clip.originalBuf ?? clip.buf
    try {
      const curve  = await detectPitchCurveAsync(source)
      const notes  = extractNoteEvents(curve)
      if (notes.length === 0) throw new Error('No notes detected — try humming or singing a clear melody.')
      const rendered = await synthesizeInstrument(notes, source.duration, source.sampleRate, preset)
      const label: Record<InstrumentPreset, string> = { piano: 'Piano', strings: 'Strings', bells: 'Bells', bass: 'Bass', organ: 'Organ' }
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, buf: rendered, name: label[preset], originalBuf: c.originalBuf ?? c.buf } : c))
    } catch (e) {
      setError(`Instrument conversion failed: ${e instanceof Error ? e.message : String(e)}`)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: clip.name } : c))
    }
  }

  // + Track popover state
  const [addTrackOpen,   setAddTrackOpen]   = useState(false)
  const [addTrackFamily, setAddTrackFamily] = useState<InstrumentFamily>('drums')

  // ── Tap tempo ──────────────────────────────────────────────────────────────
  function handleTapTempo() {
    const now = Date.now()
    tapTimesRef.current = [...tapTimesRef.current, now].filter(t => now - t < 3000).slice(-8)
    const taps = tapTimesRef.current
    if (taps.length >= 2) {
      const intervals = taps.slice(1).map((t, i) => t - taps[i])
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length
      const detected = Math.round(60000 / avg)
      if (detected >= 40 && detected <= 300) setBpm(detected)
    }
  }

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

  // ── Live MIDI input — routes to all midi-sourced input lanes ──────────────
  const midiAccessRef  = useRef<MIDIAccess | null>(null)
  const midiArmed      = Array.from(inputLanes).some(l => inputSource[l] === 'midi')

  useEffect(() => {
    if (!midiArmed) {
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
        const status = e.data[0]; const note = e.data[1]; const velocity = e.data[2]
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
  }, [midiArmed]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── View mode: Arrangement vs Session ────────────────────────────────────
  const [viewMode, setViewMode] = useState<'arrangement' | 'session'>('arrangement')
  const [pianoRollLane, setPianoRollLane] = useState<BeatType | null>(null)
  const [stepSeqLane, setStepSeqLane] = useState<BeatType | null>(null)
  const [chordBuilderLane, setChordBuilderLane] = useState<BeatType | null>(null)

  // Session view clip grid: Record<laneType, (SceneClip | null)[]>
  const [sessionClips, setSessionClips] = useState<Record<string, (SceneClip | null)[]>>({})
  const [sessionPlaying, setSessionPlaying] = useState<Record<string, number | null>>({})

  function getSessionLaneClips(laneType: string): (SceneClip | null)[] {
    const existing = sessionClips[laneType]
    if (existing && existing.length === SCENE_COUNT) return existing
    return Array(SCENE_COUNT).fill(null)
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
  const laneRecChunksRef = useRef<Blob[]>([])
  const laneRecorderRef  = useRef<MediaRecorder | null>(null)

  // Track the playhead at the moment recording starts so we can offset hits correctly
  const laneRecStartPlayheadRef = useRef(0)

  async function startLaneRecording() {
    setError(null)
    try {
      // Count-in: play click track for 1 bar before recording
      if (countIn) {
        const ebpm    = effectiveBpmRef.current
        const beatSec = 60 / ebpm
        const barSec  = beatSec * 4
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

      const firstMicLane = Array.from(inputLanesRef.current).find(l => inputSourceRef.current[l] !== 'midi')
      const deviceId     = firstMicLane ? inputSourceRef.current[firstMicLane] : 'default'
      const audioConstraint: MediaTrackConstraints | boolean =
        deviceId && deviceId !== 'default' ? { deviceId: { exact: deviceId } } : true
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: audioConstraint, video: false })
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg' })
      laneRecChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) laneRecChunksRef.current.push(e.data) }
      recorder.start(100)
      laneRecorderRef.current = recorder
      laneRecStartPlayheadRef.current = playhead
      setLaneRecording(true)
      setLaneRecordingTime(0)
      laneRecTimerRef.current = setInterval(() => {
        setLaneRecordingTime(t => {
          const newT = t + 0.1
          const projectedEnd = laneRecStartPlayheadRef.current + newT
          setDuration(prev => Math.max(prev, projectedEnd + 2))
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
    const recorder = laneRecorderRef.current
    if (!recorder) return
    if (laneRecTimerRef.current) clearInterval(laneRecTimerRef.current)
    recorder.stop()
    recorder.stream.getTracks().forEach(t => t.stop())
    stopPlayback()
    await new Promise<void>(res => { recorder.onstop = () => res() })
    setLaneRecording(false)
    const blob = new Blob(laneRecChunksRef.current, { type: laneRecChunksRef.current[0]?.type ?? 'audio/webm' })
    const offset = laneRecStartPlayheadRef.current
    try {
      const buf = await decodeAudio(blob)
      // Record into all mic-input lanes; fall back to active lane if none armed
      const micLanes = Array.from(inputLanesRef.current).filter(l => inputSourceRef.current[l] !== 'midi')
      const targets  = micLanes.length > 0 ? micLanes : activeLaneType ? [activeLaneType] : []
      setAudioClips(prev => [
        ...prev,
        ...targets.map(laneType => mkClip(crypto.randomUUID(), laneType, buf, offset, 'Voice')),
      ])
      if (buf.duration + offset > duration) setDuration(buf.duration + offset)
    } catch {
      setError('Could not decode the recording. Try again.')
    }
  }

  // Two-sided learning: reference sounds from Sound Library (Side A) + accepted corrections (Side B)
  const [referenceSounds, setReferenceSounds] = useState<ReferenceSound[]>([])
  useEffect(() => {
    async function loadReferences() {
      const [library, corrections] = await Promise.all([
        libraryGetAll().catch(() => []),
        correctionsGetAll().catch(() => []),
      ])
      const fromLibrary: ReferenceSound[] = library
        .filter(e => e.spectral && e.category !== 'voice' && e.category !== 'custom')
        .map(e => ({ category: e.category as BeatType, spectral: e.spectral! }))
      const fromCorrections: ReferenceSound[] = corrections
        .map(e => ({ category: e.correctedTo, spectral: e.spectral }))
      setReferenceSounds([...fromLibrary, ...fromCorrections])
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
  const [specLanes,      setSpecLanes]      = useState<Set<string>>(new Set())

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
      quantizeSwing, sessionClips, extraLaneIds,
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
      } catch { /* ignore bad files */ }
    }
    reader.readAsText(file)
  }

  // Auto-save to localStorage (debounced 2s)
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem('beatlab-autosave', JSON.stringify({ hits, laneEffects, lanePans, automLanes, locators, typeOverrides, bpm, masterVolume, quantizeSwing }))
      } catch { /* quota exceeded */ }
    }, 2000)
    return () => clearTimeout(t)
  }, [hits, laneEffects, lanePans, automLanes, locators, typeOverrides, bpm, masterVolume, quantizeSwing]) // eslint-disable-line

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
  const selectedClipIdRef = useRef<string | null>(null)
  useEffect(() => { selectedClipIdRef.current = selectedClipId }, [selectedClipId])
  const audioClipsRef = useRef<AudioClip[]>([])
  useEffect(() => { audioClipsRef.current = audioClips }, [audioClips])
  const playheadKbRef = useRef(0)
  useEffect(() => { playheadKbRef.current = playhead }, [playhead])
  const togglePlayRef = useRef<() => void>(() => {})
  togglePlayRef.current = () => { if (isPlaying) stopPlayback(); else startPlayback() }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      const inInput = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable
      if (e.code === 'Space' && !inInput) {
        e.preventDefault()
        togglePlayRef.current()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyC' && !inInput) {
        const clip = audioClipsRef.current.find(c => c.id === selectedClipIdRef.current)
        if (clip) clipboardRef.current = [clip]
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
      if ((e.code === 'Delete' || e.code === 'Backspace') && !inInput && selectedClipIdRef.current) {
        setAudioClips(prev => prev.filter(c => c.id !== selectedClipIdRef.current))
        setSelectedClipId(null)
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
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
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
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
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
      // Universal mode: detect all types. Nearest-neighbour against the sample
      // pack gives us the best type match across drums AND melodic sounds.
      // If sample fingerprints are loaded as referenceSounds, the NN classifier
      // handles the melodic/drum distinction automatically.
      const allAllowed = instrumentFamily === 'drums'
        ? Array.from(selectedTypes)
        : undefined  // undefined = all types (universal)

      const opts = instrumentFamily !== 'drums'
        ? { melodicType: melodicVariant, stemMode: isStem }
        : { allowedTypes: allAllowed, referenceSounds, stemMode: isStem }

      const result = await analyzeBeats(buf, opts)
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
        const allowedForAi = instrumentFamily === 'drums' ? Array.from(selectedTypes) : undefined
        aiClassifyHits(result.hits, allowedForAi ?? [], groundTruth.trim() || undefined).then(aiResult => {
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
    if (phase !== 'idle') return
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
  }, [analyzeStemUrl, phase]) // eslint-disable-line

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
    // master gain → destination
    const masterGain = ctx.createGain()
    masterGain.gain.value = masterVolumeRef.current
    masterGainNodeRef.current = masterGain
    masterGain.connect(ctx.destination)

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
    const visibleClips = audioClips.filter(c => !c.muted && !(soloActive && !soloedLanesRef.current.has(c.laneType)))
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
      src.connect(gainNode); gainNode.connect(getLaneInput(clip.laneType))

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
    setHits(prev => prev.map(h => {
      if (h.id !== id) return h
      if (newType !== h.type && h.spectral) {
        correctionsAdd({ id: crypto.randomUUID(), spectral: h.spectral, detectedAs: h.type, correctedTo: newType, savedAt: new Date().toISOString() }).catch(() => {})
      }
      return { ...h, type: newType }
    }))
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
    setHits(prev => prev.map(h => {
      if (!selectedIds.has(h.id)) return h
      if (type !== h.type && h.spectral) {
        correctionsAdd({
          id:          crypto.randomUUID(),
          spectral:    h.spectral,
          detectedAs:  h.type,
          correctedTo: type,
          savedAt:     new Date().toISOString(),
        }).catch(() => {})
      }
      return { ...h, type }
    }))
    setShowTypeMenu(false)
  }

  function rejectAiForHit(hitId: string) {
    if (!aiSuggestions) return
    const suggested = aiSuggestions.get(hitId)
    if (!suggested) return
    // Save inverse: AI said X, but the current label Y is correct
    const hit = hits.find(h => h.id === hitId)
    if (hit && hit.spectral && suggested !== hit.type) {
      correctionsAdd({
        id:          crypto.randomUUID(),
        spectral:    hit.spectral,
        detectedAs:  suggested,
        correctedTo: hit.type,
        savedAt:     new Date().toISOString(),
      }).catch(() => {})
    }
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

  // User confirms the feedback panel — save corrections + request AI reflection
  async function confirmFeedback() {
    if (!feedbackItems) return
    const now = new Date().toISOString()
    for (const f of feedbackItems) {
      if (f.current !== f.original && f.spectral) {
        correctionsAdd({
          id:          crypto.randomUUID(),
          spectral:    f.spectral,
          detectedAs:  f.original,
          correctedTo: f.current,
          savedAt:     now,
        }).catch(() => {})
      }
    }
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
    const now = new Date().toISOString()
    const corrections: Array<{ time: number; machineLabel: string; finalLabel: string; spectral?: HitSpectral }> = []

    for (const hit of hits) {
      const original = feedbackSnapshot?.get(hit.id)
      if (original !== undefined && original !== hit.type) {
        if (hit.spectral) {
          correctionsAdd({
            id:          crypto.randomUUID(),
            spectral:    hit.spectral,
            detectedAs:  original,
            correctedTo: hit.type,
            savedAt:     now,
          }).catch(() => {})
        }
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
    setHits(prev => prev.map(h => {
      if (h.id !== hitId) return h
      if (h.spectral && suggested !== h.type) {
        correctionsAdd({
          id:          crypto.randomUUID(),
          spectral:    h.spectral,
          detectedAs:  h.type,
          correctedTo: suggested,
          savedAt:     new Date().toISOString(),
        }).catch(() => {})
      }
      return { ...h, type: suggested }
    }))
    setAiSuggestions(prev => {
      if (!prev) return null
      const next = new Map(prev)
      next.delete(hitId)
      return next.size > 0 ? next : null
    })
  }

  function programWasRight() {
    if (!aiSuggestions && aiDeletions.size === 0) return
    const now = new Date().toISOString()
    if (aiSuggestions) {
      for (const [hitId, suggested] of aiSuggestions.entries()) {
        const hit = hits.find(h => h.id === hitId)
        if (hit && hit.spectral && suggested !== hit.type) {
          correctionsAdd({
            id:          crypto.randomUUID(),
            spectral:    hit.spectral,
            detectedAs:  suggested,
            correctedTo: hit.type,
            savedAt:     now,
          }).catch(() => {})
        }
      }
    }
    // Deletion suggestions: AI was wrong to flag these — no correction type to save, just dismiss
    setAiSuggestions(null)
    setAiDeletions(new Set())
    setShowFeedbackCard(false)
  }

  function aiWasRight() {
    if (!aiSuggestions && aiDeletions.size === 0) return
    const sixteenth = bpm ? (60 / bpm) / 4 : null
    const now = new Date().toISOString()
    const toDelete = new Set(aiDeletions)
    setHits(prev => {
      let updated = prev
        .filter(h => !toDelete.has(h.id))
        .map(h => {
          const suggested = aiSuggestions?.get(h.id)
          if (!suggested || suggested === h.type) return h
          if (h.spectral) {
            correctionsAdd({
              id:          crypto.randomUUID(),
              spectral:    h.spectral,
              detectedAs:  h.type,
              correctedTo: suggested,
              savedAt:     now,
            }).catch(() => {})
          }
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

  async function exportStems() {
    if (!duration || duration <= 0) return
    const sr = 44100
    const allLaneTypes = Array.from(new Set(hits.map(h => h.type)))
    for (const laneType of allLaneTypes) {
      const laneHits = hits.filter(h => h.type === laneType)
      if (!laneHits.length) continue
      const offCtx = new OfflineAudioContext(2, Math.ceil(sr * (duration + 1)), sr)
      const dest = offCtx.destination
      for (const hit of laneHits) {
        if (hit.time > duration) continue
        try {
          const { playDrumHit } = await import('@/lib/drum-samples')
          const { playMelodicNote, MELODIC_TYPES } = await import('@/lib/instrument-synth')
          if (MELODIC_TYPES.has(hit.type)) {
            playMelodicNote(offCtx as unknown as AudioContext, hit.type, hit.note, hit.time, hit.velocity, dest)
          } else {
            playDrumHit(offCtx as unknown as AudioContext, 'synth', hit.type, hit.time, hit.velocity, hit.note, undefined, dest)
          }
        } catch { /* ignore per-hit errors */ }
      }
      try {
        const rendered = await offCtx.startRendering()
        const wavBlob = audioBufferToWav(rendered)
        const url = URL.createObjectURL(wavBlob)
        const a = document.createElement('a')
        a.href = url; a.download = `stem-${laneType}.wav`
        document.body.appendChild(a); a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 5000)
      } catch { /* ignore render errors */ }
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
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--bg-base)', userSelect: 'none' }}>

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
              <button onClick={togglePlay} style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 6px' }}>
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

            {/* Multi-select badge */}
            {selectedIds.size > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', borderRadius: 6, background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)' }}>
                <span style={{ fontSize: 11, color: 'var(--accent-light)' }}>{selectedIds.size} selected</span>
                <button onClick={() => { selectedIds.forEach(id => deleteHit(id)); setSelectedIds(new Set()) }}
                  style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer' }}>
                  Delete all
                </button>
                <button onClick={() => setSelectedIds(new Set())}
                  style={{ fontSize: 10, padding: '1px 4px', borderRadius: 3, background: 'none', color: 'var(--text-muted)', border: 'none', cursor: 'pointer' }}>✕</button>
              </div>
            )}

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
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 7px' }}>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden', padding: '2px 4px' }}>
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
                  <button onClick={() => { setShowFileMenu(v => !v); setShowEditMenu(false) }}
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
                        { label: '─', action: null },
                        { label: 'Export Stems (WAV)', action: () => { void exportStems(); setShowFileMenu(false) } },
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
              {/* View toggle: Arrangement / Session */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                <button onClick={() => setViewMode('arrangement')} title="Arrangement view" style={{ padding: '3px 9px', background: viewMode === 'arrangement' ? 'rgba(139,92,246,0.18)' : 'none', border: 'none', cursor: 'pointer', color: viewMode === 'arrangement' ? 'rgba(167,139,250,1)' : 'var(--text-muted)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>ARR</button>
                <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
                <button onClick={() => setViewMode('session')} title="Session view" style={{ padding: '3px 9px', background: viewMode === 'session' ? 'rgba(139,92,246,0.18)' : 'none', border: 'none', cursor: 'pointer', color: viewMode === 'session' ? 'rgba(167,139,250,1)' : 'var(--text-muted)', fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>SES</button>
              </div>
              {/* Zoom controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                <button onClick={() => setZoomLevel(z => Math.max(0.5, +(z / 1.5).toFixed(2)))} title="Zoom out" style={{ padding: '3px 7px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1 }}>−</button>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 30, textAlign: 'center' }}>{zoomLevel === 1 ? '1×' : `${zoomLevel.toFixed(1)}×`}</span>
                <button onClick={() => setZoomLevel(z => Math.min(8, +(z * 1.5).toFixed(2)))} title="Zoom in" style={{ padding: '3px 7px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1 }}>+</button>
              </div>
              {/* Inspector toggle */}
              <Tooltip content="Inspector panel — lane details, pan, tools (I)" placement="bottom" disabled={inspectorOpen}>
                <button
                  onClick={() => setInspectorOpen(v => !v)}
                  style={{ fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 5, background: inspectorOpen ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)', border: `1px solid ${inspectorOpen ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, color: inspectorOpen ? 'rgba(167,139,250,1)' : 'var(--text-muted)', cursor: 'pointer' }}
                >
                  Inspector
                </button>
              </Tooltip>

              {/* + Track button */}
              <div style={{ position: 'relative' }}>
                <Tooltip content="Add a new instrument or drum track" placement="bottom" disabled={addTrackOpen}>
                  <button
                    onClick={() => setAddTrackOpen(v => !v)}
                    style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: addTrackOpen ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)', border: `1px solid ${addTrackOpen ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, color: addTrackOpen ? 'var(--accent-light)' : 'var(--text-secondary)', cursor: 'pointer' }}
                  >
                    + Track
                  </button>
                </Tooltip>
                {addTrackOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setAddTrackOpen(false)} />
                    <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 50, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 8, minWidth: 200, boxShadow: '0 8px 24px rgba(0,0,0,0.35)' }}>
                      {/* Family tabs */}
                      <div style={{ display: 'flex', gap: 2, marginBottom: 8, background: 'var(--bg-surface)', borderRadius: 6, padding: 2 }}>
                        {(['drums', 'guitar', 'piano', 'synth'] as InstrumentFamily[]).map(f => (
                          <button key={f} onClick={() => setAddTrackFamily(f)}
                            style={{ flex: 1, padding: '3px 4px', borderRadius: 4, border: 'none', cursor: 'pointer', background: addTrackFamily === f ? 'var(--border-light)' : 'transparent', color: addTrackFamily === f ? 'var(--text-primary)' : 'var(--text-muted)', fontSize: 10, fontWeight: addTrackFamily === f ? 600 : 400 }}>
                            {FAMILY_LABEL[f]}
                          </button>
                        ))}
                      </div>
                      {/* Types */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {addTrackFamily === 'drums'
                          ? ALL_DRUM_TYPES.map(t => (
                              <button key={t} onClick={() => { toggleSelectedType(t); }}
                                style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px', borderRadius: 5, border: 'none', cursor: 'pointer', background: selectedTypes.has(t) ? 'rgba(139,92,246,0.12)' : 'transparent', color: selectedTypes.has(t) ? 'var(--accent-light)' : 'var(--text-secondary)', fontSize: 11, textAlign: 'left' }}>
                                <div style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_COLORS[t] ?? 'var(--border)', flexShrink: 0 }} />
                                {TYPE_LABELS[t] ?? t}
                                {selectedTypes.has(t) && <span style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.6 }}>✓</span>}
                              </button>
                            ))
                          : FAMILY_VARIANTS[addTrackFamily as Exclude<InstrumentFamily, 'drums'>].map(t => {
                              const already = activeLaneTypes.includes(t) || extraLaneIds.includes(t as string)
                              return (
                                <button key={t}
                                  onClick={() => { if (!already) setExtraLaneIds(prev => [...prev, t as string]); setAddTrackOpen(false) }}
                                  style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '5px 8px', borderRadius: 5, border: 'none', cursor: already ? 'default' : 'pointer', background: already ? 'rgba(139,92,246,0.08)' : 'transparent', color: already ? 'var(--text-muted)' : 'var(--text-secondary)', fontSize: 11, textAlign: 'left', opacity: already ? 0.6 : 1 }}>
                                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: TYPE_COLORS[t] ?? 'var(--border)', flexShrink: 0 }} />
                                  {TYPE_LABELS[t] ?? t}
                                  {already && <span style={{ marginLeft: 'auto', fontSize: 9, opacity: 0.6 }}>added</span>}
                                </button>
                              )
                            })
                        }
                      </div>
                    </div>
                  </>
                )}
              </div>

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

        {false && phase === 'idle' && (
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

            {/* Instrument selector — hits mode only */}
            {recMode === 'hits' && <div style={{ width: '100%', maxWidth: 420 }}>
              {/* Family tabs */}
              <div style={{ display: 'flex', gap: 3, marginBottom: 12, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
                {(['drums', 'guitar', 'piano', 'synth'] as InstrumentFamily[]).map(f => (
                  <button key={f} onClick={() => setInstrumentFamily(f)} style={{
                    flex: 1, padding: '5px 8px', borderRadius: 6, border: 'none', cursor: 'pointer',
                    background: instrumentFamily === f ? 'var(--border-light)' : 'transparent',
                    color: instrumentFamily === f ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: 12, fontWeight: instrumentFamily === f ? 600 : 400, transition: 'all 0.15s',
                  }}>
                    {FAMILY_LABEL[f]}
                  </button>
                ))}
              </div>

              {/* Drums: sound type grid */}
              {instrumentFamily === 'drums' && (
                <>
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
                </>
              )}

              {/* Melodic: variant picker */}
              {instrumentFamily !== 'drums' && (
                <>
                  <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, textAlign: 'center' }}>
                    Select variant
                  </p>
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                    {FAMILY_VARIANTS[instrumentFamily as Exclude<InstrumentFamily, 'drums'>].map(type => {
                      const active = melodicVariant === type
                      const color = TYPE_COLORS[type]
                      return (
                        <button key={type} onClick={() => setMelodicVariant(type)} style={{
                          padding: '10px 16px', borderRadius: 8, flex: 1,
                          border: `1.5px solid ${active ? color : 'var(--border)'}`,
                          background: active ? `${color}18` : 'var(--bg-card)',
                          cursor: 'pointer', color: active ? color : 'var(--text-muted)',
                          fontSize: 12, fontWeight: active ? 700 : 400,
                          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5,
                          transition: 'all 0.15s',
                        }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: active ? color : 'var(--border)' }} />
                          {TYPE_LABELS[type]}
                        </button>
                      )
                    })}
                  </div>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 10, lineHeight: 1.6 }}>
                    Hum or play a melody — each note will be mapped to the {FAMILY_LABEL[instrumentFamily].toLowerCase()} sound
                  </p>
                </>
              )}
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
            {instrumentFamily === 'drums' && (
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
                  : instrumentFamily === 'drums'
                    ? `Detecting: ${Array.from(selectedTypes).map(t => TYPE_LABELS[t]).join(', ')}`
                    : `Detecting melody → ${TYPE_LABELS[melodicVariant]} (${FAMILY_LABEL[instrumentFamily]})`}
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
                        bpm={effectiveBpmRef.current}
                        lanes={activeLaneTypes.map(type => ({
                          type,
                          label: typeLabel(type, typeOverrides),
                          color: typeColor(type, typeOverrides),
                          clips: getSessionLaneClips(type),
                          muted: mutedTypes.has(type),
                        }) satisfies SessionLane)}
                        playing={sessionPlaying}
                        onLaunchScene={sceneIdx => {
                          setSessionPlaying(prev => {
                            const next = { ...prev }
                            activeLaneTypes.forEach(t => { next[t] = sessionClips[t]?.[sceneIdx] ? sceneIdx : null })
                            return next
                          })
                        }}
                        onLaunchClip={(laneType, sceneIdx) => {
                          setSessionPlaying(prev => ({ ...prev, [laneType]: sceneIdx }))
                        }}
                        onStopLane={laneType => setSessionPlaying(prev => ({ ...prev, [laneType]: null }))}
                        onStopAll={() => setSessionPlaying({})}
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
                  <div style={inPortal ? {} : { flex: 1, overflowY: 'auto' }}>
                    {activeLaneTypes.map(type => {
                      const parentGroup = groupDefs.find(g => g.childTypes.includes(type))
                      const isGroupBus  = groupDefs.some(g => g.id === type)
                      const group       = groupDefs.find(g => g.id === type)
                      // If this lane belongs to a collapsed group, skip rendering
                      if (parentGroup?.collapsed) return null
                      return (
                      <div key={type}>
                      {/* Group header row (only for the group bus lane) */}
                      {isGroupBus && group && (
                        <div style={{ display: 'flex', alignItems: 'center', height: 26, background: 'var(--bg-surface)', borderBottom: '1px solid rgba(139,92,246,0.2)', paddingLeft: HEADER_W }}>
                          <button onClick={() => toggleGroupCollapse(group.id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 11, padding: '0 6px' }}>
                            {group.collapsed ? '▶' : '▼'}
                          </button>
                          <div style={{ width: 7, height: 7, borderRadius: '50%', background: group.color, marginRight: 5, flexShrink: 0 }} />
                          <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)', letterSpacing: '0.04em' }}>{group.label}</span>
                          <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 6 }}>{group.childTypes.length} tracks</span>
                        </div>
                      )}
                      <div style={{ display: 'flex' }}>
                        <div style={{ width: 24, flexShrink: 0 }} />
                        <Lane
                          type={type}
                          hits={hitsByType.get(type) ?? []}
                          clips={audioClipsByLane.get(type) ?? []}
                          duration={duration}
                          pxWidth={timelinePx * zoomLevel}
                          selectedIds={selectedIds}
                          muted={mutedTypes.has(type)}
                          aiSuggestions={aiSuggestions}
                          aiDeletions={aiDeletions}
                          typeOverrides={typeOverrides}
                          isCustom={extraLaneIds.includes(type)}
                          isActiveLane={activeLaneType === type}
                          snapInterval={snapInterval}
                          onSelectHit={selectHit}
                          onSelectLane={() => { setActiveLaneType(type); setSelectedLane(type); setInspectorOpen(true) }}
                          onOpenPianoRoll={MELODIC_TYPES.has(type) ? () => setPianoRollLane(type) : undefined}
                          onOpenStepSeq={() => setStepSeqLane(type)}
                          onOpenChordBuilder={MELODIC_TYPES.has(type) ? () => setChordBuilderLane(type) : undefined}
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
                          onClipDelete={clipId => { setAudioClips(prev => prev.filter(c => c.id !== clipId)); if (selectedClipId === clipId) setSelectedClipId(null) }}
                          onClipSelect={clipId => setSelectedClipId(prev => prev === clipId ? null : clipId)}
                          selectedClipId={selectedClipId}
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
                          onAddHit={(t, note) => addHit(type, t, note)}
                          onToggleMute={() => toggleMute(type)}
                          onLaneContextMenu={e => setLaneMenu({ type, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 200) })}
                          onHitRightClick={(e, id) => setHitMenu({ hitId: id, x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - 340) })}
                          miniMode={miniLanes.has(type)}
                          spectrumOpen={specLanes.has(type)}
                          analyserNode={laneAnalysersRef.current.get(type) ?? null}
                          onToggleMini={() => toggleMiniLane(type)}
                          onToggleSpectrum={() => toggleSpecLane(type)}
                          loopBeats={laneLoopBeats[type] ?? 0}
                          onLoopBeatsChange={beats => setLaneLoopBeats(prev => ({ ...prev, [type]: beats }))}
                          inputArmed={inputLanes.has(type)}
                          inputSource={inputSource[type]}
                          onToggleInput={() => toggleInputLane(type)}
                          onOpenInputPicker={() => setInputSourcePickerLane(type)}
                        />
                      </div>
                      </div>
                    )})}
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

      {/* ── Convert card modal ────────────────────────────────────────────── */}
      {convertCard && (() => {
        const clip = audioClips.find(c => c.id === convertCard.clipId)
        if (!clip) return null
        const mode = convertCard.mode
        const isSynth = mode === 'synth'
        const isInstrument = mode === 'instrument'
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
              borderRadius: 14, padding: 24, width: 340, boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>
                Convert to {isSynth ? 'Synth' : isInstrument ? 'Instrument' : 'Beats'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                {clip.name} · {srcDur.toFixed(1)}s{clip.originalBuf ? ' · from original' : ''}
              </div>

              {isSynth ? (
                <>
                  {sectionLabel('Waveform')}
                  {chipGroup(
                    [{ label: 'Sawtooth', value: 'sawtooth' }, { label: 'Sine', value: 'sine' }, { label: 'Square', value: 'square' }, { label: 'Triangle', value: 'triangle' }],
                    o.waveform,
                    v => setConvertCard(c => c ? { ...c, synthOpts: { ...c.synthOpts, waveform: v as OscillatorType } } : c)
                  )}

                  {sectionLabel('Brightness')}
                  {chipGroup(
                    [{ label: 'Muffled', value: '400' }, { label: 'Warm', value: '1400' }, { label: 'Bright', value: '2800' }, { label: 'Full', value: '8000' }],
                    String(o.filterCutoff),
                    v => setConvertCard(c => c ? { ...c, synthOpts: { ...c.synthOpts, filterCutoff: Number(v) } } : c)
                  )}

                  {sectionLabel('Pitch')}
                  {chipGroup(
                    [{ label: 'Steady', value: 'false' }, { label: 'Follow melody', value: 'true' }],
                    String(o.followPitch),
                    v => setConvertCard(c => c ? { ...c, synthOpts: { ...c.synthOpts, followPitch: v === 'true' } } : c)
                  )}
                  {o.followPitch && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                      Oscillator frequency follows detected pitch frame-by-frame. Best for singing or humming; may sound choppy on speech.
                    </div>
                  )}

                  {sectionLabel('Volume')}
                  {chipGroup(
                    [{ label: 'Steady', value: 'false' }, { label: 'Follow dynamics', value: 'true' }],
                    String(o.followDynamics),
                    v => setConvertCard(c => c ? { ...c, synthOpts: { ...c.synthOpts, followDynamics: v === 'true' } } : c)
                  )}
                  {o.followDynamics && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
                      Gain follows the RMS envelope of the source — louder moments in the recording become louder in the synth.
                    </div>
                  )}

                  {sectionLabel(`Pitch shift: ${o.pitchShift > 0 ? '+' : ''}${o.pitchShift} semitones`)}
                  <input
                    type="range" min={-12} max={12} step={1} value={o.pitchShift}
                    onChange={e => setConvertCard(c => c ? { ...c, synthOpts: { ...c.synthOpts, pitchShift: Number(e.target.value) } } : c)}
                    style={{ width: '100%', accentColor: 'var(--accent)' }}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    <span>-12</span><span>0</span><span>+12</span>
                  </div>
                </>
              ) : isInstrument ? (
                <>
                  {sectionLabel('Instrument')}
                  {chipGroup(
                    [{ label: 'Piano', value: 'piano' }, { label: 'Strings', value: 'strings' }, { label: 'Bells', value: 'bells' }, { label: 'Bass', value: 'bass' }, { label: 'Organ', value: 'organ' }],
                    convertCard.instrument,
                    v => setConvertCard(c => c ? { ...c, instrument: v as InstrumentPreset } : c)
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, lineHeight: 1.4 }}>
                    Detects stable notes in your recording and renders each as a synthesized instrument. Hum or sing a melody for best results.
                    {clip.originalBuf && <span style={{ color: 'var(--accent-light)' }}> Always re-converts from your original recording.</span>}
                  </div>
                </>
              ) : (
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
                    if (isSynth) runConvertToSynth(convertCard.clipId, convertCard.synthOpts)
                    else if (isInstrument) runConvertToInstrument(convertCard.clipId, convertCard.instrument)
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
        return (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 299 }} onClick={() => setClipMenu(null)} onContextMenu={e => { e.preventDefault(); setClipMenu(null) }} />
            <div style={{ position: 'fixed', left: clipMenu.x, top: clipMenu.y, zIndex: 300, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 8, minWidth: 170, boxShadow: '0 8px 28px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: 2 }}>
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
                  <button onClick={() => openConvertCard(clip.id, 'instrument')} style={btnStyle()}>Instrument</button>
                  <button onClick={() => openConvertCard(clip.id, 'beats')} style={btnStyle()}>Beat</button>
                </div>
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
              <button onClick={() => { setAudioClips(prev => prev.map(c => c.id === clip.id ? { ...c, muted: !c.muted } : c)); setClipMenu(null) }} style={btnStyle()}>
                {clip.muted ? 'Unmute' : 'Mute'}
              </button>
              <button onClick={() => { setAudioClips(prev => prev.filter(c => c.id !== clip.id)); setClipMenu(null) }} style={btnStyle(true)}>
                Delete
              </button>
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
    </div>
  )
}
