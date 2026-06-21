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

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Mic, Square, Play, Pause, Trash2, RefreshCw, ChevronDown, Volume2, VolumeX, Send } from 'lucide-react'
import type { BeatHit, BeatAnalysis, BeatType, BeatTrackEntry, ReferenceSound, HitSpectral } from '@/lib/beat-analyzer'
import { analyzeBeats } from '@/lib/beat-analyzer'
import { playDrumHit } from '@/lib/drum-samples'
import { playMelodicNote, MELODIC_TYPES } from '@/lib/instrument-synth'
import { aiClassifyHits } from '@/lib/ai-beat-classifier'
import { correctionsAdd, correctionsGetAll } from '@/lib/correction-store'
import { libraryGetAll } from '@/lib/sound-library'
import { sampleGetAll } from '@/lib/sample-pack'
import { detectPitchCurve, synthesizeFromPitchCurve } from '@/lib/pitch-detector'

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
    <div style={{ paddingLeft: 88, borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
      <svg width={pxWidth} height={height} style={{ display: 'block' }}>
        <path d={path} fill="rgba(139,92,246,0.2)" stroke="rgba(139,92,246,0.35)" strokeWidth={0.5} />
      </svg>
    </div>
  )
}

// ── Time ruler ────────────────────────────────────────────────────────────────

function RulerTicks({ duration, px, onSeek }: { duration: number; px: number; onSeek?: (t: number) => void }) {
  const step = duration <= 4 ? 0.5 : duration <= 10 ? 1 : 2
  const ticks: number[] = []
  for (let t = 0; t <= duration; t += step) ticks.push(t)
  return (
    <div
      style={{ position: 'relative', height: 18, borderBottom: '1px solid var(--border)', cursor: onSeek ? 'pointer' : 'default' }}
      onClick={e => {
        if (!onSeek) return
        const rect = e.currentTarget.getBoundingClientRect()
        onSeek(Math.max(0, Math.min(duration, ((e.clientX - rect.left) / rect.width) * duration)))
      }}
    >
      {ticks.map(t => (
        <div key={t} style={{ position: 'absolute', left: (t / duration) * px, top: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
          <span style={{ fontSize: 9, color: 'var(--text-muted)', userSelect: 'none', whiteSpace: 'nowrap' }}>
            {t.toFixed(t < 1 ? 1 : 0)}s
          </span>
          <div style={{ width: 1, height: 5, background: 'var(--border-light)', marginTop: 2 }} />
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

interface AudioClipShape { id: string; startTime: number; buf: { duration: number }; muted: boolean; name: string }

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
  onMoveHit: (id: string, t: number, note: number) => void
  onDeleteHit: (id: string) => void
  onAddHit: (t: number, note: number) => void
  onToggleMute: () => void
  onLaneContextMenu: (e: React.MouseEvent) => void
  onHitRightClick: (e: React.MouseEvent, id: string) => void
  onClipRightClick: (e: React.MouseEvent, clipId: string) => void
  onClipMove: (clipId: string, newStart: number) => void
  onClipDelete: (clipId: string) => void
}

function Lane({ type, hits, clips, duration, pxWidth, selectedIds, muted, aiSuggestions, aiDeletions, typeOverrides, isCustom, isActiveLane, snapInterval, onSelectHit, onSelectLane, onMoveHit, onDeleteHit, onAddHit, onToggleMute, onLaneContextMenu, onHitRightClick, onClipRightClick, onClipMove, onClipDelete }: LaneProps) {
  const color = typeColor(type, typeOverrides)
  const label = typeLabel(type, typeOverrides)

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

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: LANE_HEIGHT, borderBottom: '1px solid var(--border)', opacity: muted ? 0.45 : 1 }}>
      {/* Label — left-click selects, right-click opens context menu */}
      <div
        onClick={onSelectLane}
        onContextMenu={e => { e.preventDefault(); onLaneContextMenu(e) }}
        style={{
          width: 64, flexShrink: 0, position: 'relative', borderRight: '1px solid var(--border)',
          background: isActiveLane ? 'var(--accent-subtle)' : 'var(--bg-surface)',
          cursor: 'pointer', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 3, userSelect: 'none',
          borderLeft: isActiveLane ? `2px solid ${color}` : '2px solid transparent',
        }}
      >
        <div style={{ width: 7, height: 7, borderRadius: '50%', background: muted ? 'var(--border-light)' : color }} />
        <span style={{ fontSize: 10, fontWeight: 600, color: isActiveLane ? 'var(--text-primary)' : muted ? 'var(--text-muted)' : 'var(--text-secondary)', letterSpacing: '0.04em', maxWidth: 56, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
        </span>
        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{hits.length}</span>
        {/* Mute indicator */}
        {muted && <VolumeX size={9} color="#ef4444" style={{ position: 'absolute', bottom: 4 }} />}
      </div>

      {/* Hit area — left-click adds, right-click adds (snapped) */}
      <div
        onClick={handleLaneClick}
        onContextMenu={handleLaneRightClick}
        style={{
          flex: 1, position: 'relative', cursor: muted ? 'default' : 'crosshair', height: LANE_HEIGHT,
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
        {/* Audio clips — raw recordings and synth renders sitting on this lane */}
        {clips.map(clip => {
          const left = duration > 0 ? (clip.startTime / duration) * pxWidth : 0
          const wid  = duration > 0 ? Math.min((clip.buf.duration / duration) * pxWidth, pxWidth - left) : 0
          if (wid <= 0) return null
          const isConverting = clip.name === 'Converting…'
          return (
            <div
              key={clip.id}
              onClick={e => e.stopPropagation()}
              onContextMenu={e => { e.preventDefault(); e.stopPropagation(); onClipRightClick(e, clip.id) }}
              onMouseDown={e => {
                if (e.button !== 0) return
                e.stopPropagation()
                e.preventDefault()
                const startX = e.clientX
                const startTime = clip.startTime
                const handleMove = (me: MouseEvent) => {
                  const dt = ((me.clientX - startX) / pxWidth) * duration
                  onClipMove(clip.id, Math.max(0, startTime + dt))
                }
                const handleUp = () => { window.removeEventListener('mousemove', handleMove); window.removeEventListener('mouseup', handleUp) }
                window.addEventListener('mousemove', handleMove)
                window.addEventListener('mouseup', handleUp)
              }}
              style={{
                position: 'absolute', left, width: Math.max(wid, 8),
                top: 3, bottom: 3, borderRadius: 3, zIndex: 1,
                background: isConverting ? 'rgba(139,92,246,0.1)' : clip.muted ? 'rgba(80,80,100,0.13)' : 'rgba(139,92,246,0.22)',
                border: `1px solid ${isConverting ? 'rgba(139,92,246,0.3)' : clip.muted ? 'rgba(100,100,120,0.25)' : 'rgba(139,92,246,0.55)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                paddingLeft: 5, paddingRight: 3, overflow: 'hidden',
                cursor: isConverting ? 'wait' : 'grab',
              }}
            >
              <span style={{ fontSize: 8, color: isConverting ? 'rgba(139,92,246,0.6)' : clip.muted ? 'var(--text-muted)' : 'rgba(210,190,255,0.9)', whiteSpace: 'nowrap', pointerEvents: 'none', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {clip.name} · {clip.buf.duration.toFixed(1)}s
              </span>
              {!isConverting && wid > 28 && (
                <button
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => { e.stopPropagation(); onClipDelete(clip.id) }}
                  style={{ flexShrink: 0, width: 12, height: 12, borderRadius: '50%', border: 'none', background: 'rgba(239,68,68,0.7)', color: '#fff', cursor: 'pointer', fontSize: 8, lineHeight: '12px', textAlign: 'center', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Playhead ─────────────────────────────────────────────────────────────────

function Playhead({ time, duration, pxWidth }: { time: number; duration: number; pxWidth: number }) {
  if (time < 0) return null
  return (
    <div style={{
      position: 'absolute', left: (time / duration) * pxWidth + 88, top: 0, bottom: 0,
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
  }
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
  const [voiceSynthOpen,      setVoiceSynthOpen]      = useState(false)
  const [voiceSynthRendering, setVoiceSynthRendering]  = useState(false)
  // Audio clips — raw recordings and synth renders, stored per-lane and played as AudioBuffers
  interface AudioClip { id: string; laneType: string; buf: AudioBuffer; startTime: number; muted: boolean; name: string }
  const [audioClips, setAudioClips] = useState<AudioClip[]>([])
  const [clipMenu, setClipMenu] = useState<{ clipId: string; x: number; y: number; convertOpen?: boolean } | null>(null)

  // Voice Synth self-contained recorder (independent of the main beat recording)
  const [vsRecording,  setVsRecording]  = useState(false)
  const [vsRecTime,    setVsRecTime]    = useState(0)
  const [vsAudioBuf,   setVsAudioBuf]   = useState<AudioBuffer | null>(null)
  const vsRecTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const vsRecChunksRef = useRef<Blob[]>([])
  const vsRecorderRef  = useRef<MediaRecorder | null>(null)

  async function startVsRecording() {
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg' })
      vsRecChunksRef.current = []
      recorder.ondataavailable = e => { if (e.data.size > 0) vsRecChunksRef.current.push(e.data) }
      recorder.start(100)
      vsRecorderRef.current = recorder
      setVsRecording(true)
      setVsRecTime(0)
      setVsAudioBuf(null)
      vsRecTimerRef.current = setInterval(() => setVsRecTime(t => t + 0.1), 100)
    } catch { setError('Microphone access denied.') }
  }

  async function stopVsRecording() {
    const recorder = vsRecorderRef.current
    if (!recorder) return
    if (vsRecTimerRef.current) clearInterval(vsRecTimerRef.current)
    recorder.stop()
    recorder.stream.getTracks().forEach(t => t.stop())
    await new Promise<void>(res => { recorder.onstop = () => res() })
    setVsRecording(false)
    const blob = new Blob(vsRecChunksRef.current, { type: vsRecChunksRef.current[0]?.type ?? 'audio/webm' })
    const buf  = await decodeAudio(blob).catch(() => null)
    if (buf) setVsAudioBuf(buf)
  }

  async function runVoiceSynth() {
    const source = vsAudioBuf ?? audioBuf
    if (!source) return
    setVoiceSynthRendering(true)
    // Determine target lane
    let laneType: string
    if (activeLaneType) {
      laneType = activeLaneType
    } else {
      const newId = `cust_${Date.now()}`
      setTypeOverrides(prev => ({ ...prev, [newId]: { label: 'Synth', color: '#8b5cf6' } }))
      setExtraLaneIds(prev => [...prev, newId])
      setActiveLaneType(newId as BeatType)
      laneType = newId
    }
    try {
      const curve    = detectPitchCurve(source)
      const rendered = await synthesizeFromPitchCurve(curve, source.sampleRate, 60, source.duration)
      setAudioClips(prev => [...prev, { id: crypto.randomUUID(), laneType, buf: rendered, startTime: playhead, muted: false, name: 'Synth' }])
      if (playhead + rendered.duration > duration) setDuration(playhead + rendered.duration)
    } catch (e) {
      setError(`Voice synth failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setVoiceSynthRendering(false)
    }
  }

  async function convertClipToBeats(clipId: string) {
    const clip = audioClips.find(c => c.id === clipId)
    if (!clip) return
    setClipMenu(null)
    setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Converting…' } : c))
    try {
      const result  = await analyzeBeats(clip.buf, { allowedTypes: [clip.laneType as BeatType], referenceSounds })
      const newHits = result.hits.map(h => ({ ...h, id: crypto.randomUUID(), time: h.time + clip.startTime, type: clip.laneType as BeatType }))
      setHits(prev => [...prev, ...newHits])
      setAudioClips(prev => prev.filter(c => c.id !== clipId))
      if (result.duration + clip.startTime > duration) setDuration(result.duration + clip.startTime)
    } catch (e) {
      setError(`Beat conversion failed: ${e instanceof Error ? e.message : String(e)}`)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Voice' } : c))
    }
  }

  async function convertClipToSynth(clipId: string) {
    const clip = audioClips.find(c => c.id === clipId)
    if (!clip) return
    setClipMenu(null)
    // Show in-progress state on the clip block
    setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Converting…' } : c))
    try {
      const curve    = detectPitchCurve(clip.buf)
      const rendered = await synthesizeFromPitchCurve(curve, clip.buf.sampleRate, 60, clip.buf.duration)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, buf: rendered, name: 'Synth' } : c))
    } catch (e) {
      setError(`Synth conversion failed: ${e instanceof Error ? e.message : String(e)}`)
      setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, name: 'Voice' } : c))
    }
  }

  // + Track popover state
  const [addTrackOpen,   setAddTrackOpen]   = useState(false)
  const [addTrackFamily, setAddTrackFamily] = useState<InstrumentFamily>('drums')

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
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
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
          // Keep timeline at least 2s ahead of the recording cursor so the RAF
          // playhead never reaches the end and "resets" while still recording
          const projectedEnd = laneRecStartPlayheadRef.current + newT
          setDuration(prev => Math.max(prev, projectedEnd + 2))
          return newT
        })
      }, 100)
      // Also start beat playback from current playhead so user can hear the existing beat while recording
      startPlaybackFrom(playhead)
    } catch {
      setError('Microphone access denied.')
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
      // Determine target lane — use the active lane or auto-create one
      let laneType: string
      if (activeLaneType) {
        laneType = activeLaneType
      } else {
        const newId = `cust_${Date.now()}`
        setTypeOverrides(prev => ({ ...prev, [newId]: { label: 'Voice', color: '#8b5cf6' } }))
        setExtraLaneIds(prev => [...prev, newId])
        setActiveLaneType(newId as BeatType)
        laneType = newId
      }
      setAudioClips(prev => [...prev, { id: crypto.randomUUID(), laneType, buf, startTime: offset, muted: false, name: 'Voice' }])
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

  const recorderRef    = useRef<MediaRecorder | null>(null)
  const startedSongRef = useRef(false)
  const chunksRef    = useRef<Blob[]>([])
  const recTimerRef  = useRef<ReturnType<typeof setInterval> | null>(null)
  const audioCtxRef  = useRef<AudioContext | null>(null)
  const playRafRef   = useRef<number>(0)
  const playStartRef = useRef<{ wallTime: number; beatTime: number } | null>(null)
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

  // 88px = 64px lane label + 24px note axis
  useEffect(() => {
    if (!timelineEl) return
    const ro = new ResizeObserver(([e]) => setTimelinePx(e.contentRect.width - 88))
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

  function startPlaybackFrom(startFrom: number) {
    if (duration <= 0) return
    const ctx = getAudioCtx()
    const now = ctx.currentTime
    const kickTimes = hits.filter(h => h.type === 'kick' && !mutedTypes.has('kick')).map(h => h.time).sort((a, b) => a - b)

    for (const hit of hits) {
      if (hit.time < startFrom - 0.01) continue
      if (mutedTypes.has(hit.type)) continue
      const when = Math.max(now, now + (hit.time - startFrom))

      // Use sample pack buffer if available, pitch-shifted to match the hit's MIDI note
      const sampleBuf  = sampleBuffers.get(hit.type)
      const sampleRoot = sampleRoots.get(hit.type) ?? 60
      if (sampleBuf) {
        const src = ctx.createBufferSource()
        src.buffer = sampleBuf
        // Transpose sample to hit's actual note
        const targetNote = hit.note ?? sampleRoot
        src.playbackRate.value = Math.pow(2, (targetNote - sampleRoot) / 12)
        const gain = ctx.createGain()
        gain.gain.value = hit.velocity
        src.connect(gain)
        gain.connect(ctx.destination)
        src.start(when)
      } else if (MELODIC_TYPES.has(hit.type)) {
        playMelodicNote(ctx, hit.type, hit.note, when, hit.velocity)
      } else {
        const maxKickDur = hit.type === 'kick'
          ? (() => {
              const idx = kickTimes.indexOf(hit.time)
              const next = kickTimes[idx + 1] ?? Infinity
              return Math.min(0.45, next - hit.time - 0.01)
            })()
          : 0.45
        playDrumHit(ctx, 'synth', hit.type, when, hit.velocity, hit.note, maxKickDur)
      }
    }

    // Audio clips — play raw recordings and synth renders at their lane positions
    for (const clip of audioClips) {
      if (clip.muted) continue
      const clipEnd = clip.startTime + clip.buf.duration
      if (clipEnd <= startFrom) continue
      const src  = ctx.createBufferSource()
      src.buffer = clip.buf
      const gain = ctx.createGain()
      gain.gain.value = 0.82
      src.connect(gain)
      gain.connect(ctx.destination)
      if (clip.startTime >= startFrom) {
        src.start(now + (clip.startTime - startFrom), 0)
      } else {
        src.start(now, startFrom - clip.startTime)
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
      playRafRef.current = requestAnimationFrame(tick)
    }
    playRafRef.current = requestAnimationFrame(tick)
  }

  function startPlayback() { startPlaybackFrom(playhead >= duration ? 0 : playhead) }

  function stopPlayback() {
    cancelAnimationFrame(playRafRef.current)
    setIsPlaying(false)
    playStartRef.current = null
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
    setHits(prev => prev.map(h => h.id === id ? { ...h, time: t, note } : h).sort((a, b) => a.time - b.time))
  }, [])

  const deleteHit = useCallback((id: string) => {
    setHits(prev => prev.filter(h => h.id !== id))
    setSelectedIds(prev => { const n = new Set(prev); n.delete(id); return n })
  }, [])

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
    const newHit: BeatHit = { id: crypto.randomUUID(), time: t, type, velocity: 0.7, note }
    setHits(prev => [...prev, newHit].sort((a, b) => a.time - b.time))
    setSelectedIds(new Set([newHit.id]))
  }

  function changeSelectedType(type: BeatType) {
    if (selectedIds.size === 0) return
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
          <button onClick={startRecording} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 6, background: '#dc2626', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
            <Mic size={13} /> Sing the Beat
          </button>
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
            <button onClick={togglePlay} style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent)', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', flexShrink: 0 }}>
              {isPlaying ? <Pause size={13} fill="#fff" /> : <Play size={13} fill="#fff" style={{ marginLeft: 1 }} />}
            </button>

            {/* Record voice as audio clip — always available */}
            {!laneRecording && (
              <button
                onClick={startLaneRecording}
                title="Record voice — adds as audio clip at playhead"
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 6, background: 'rgba(220,38,38,0.12)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', cursor: 'pointer', fontSize: 11, fontWeight: 600, flexShrink: 0 }}
              >
                <Mic size={11} /> Rec
              </button>
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

            {/* BPM */}
            {bpm && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>BPM</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', fontFamily: 'monospace' }}>{bpm}</span>
              </div>
            )}

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
              {/* Zoom controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 5, overflow: 'hidden' }}>
                <button onClick={() => setZoomLevel(z => Math.max(0.5, +(z / 1.5).toFixed(2)))} title="Zoom out" style={{ padding: '3px 7px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1 }}>−</button>
                <span style={{ fontSize: 10, color: 'var(--text-muted)', minWidth: 30, textAlign: 'center' }}>{zoomLevel === 1 ? '1×' : `${zoomLevel.toFixed(1)}×`}</span>
                <button onClick={() => setZoomLevel(z => Math.min(8, +(z * 1.5).toFixed(2)))} title="Zoom in" style={{ padding: '3px 7px', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1 }}>+</button>
              </div>
              {/* + Track button */}
              <div style={{ position: 'relative' }}>
                <button
                  onClick={() => setAddTrackOpen(v => !v)}
                  style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: addTrackOpen ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)', border: `1px solid ${addTrackOpen ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, color: addTrackOpen ? 'var(--accent-light)' : 'var(--text-secondary)', cursor: 'pointer' }}
                >
                  + Track
                </button>
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

              <button
                onClick={() => setVoiceSynthOpen(v => !v)}
                title="Record and synthesize any sound as an instrument layer"
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: voiceSynthOpen ? 'rgba(139,92,246,0.15)' : 'var(--bg-card)', border: `1px solid ${voiceSynthOpen ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`, color: voiceSynthOpen ? 'var(--accent-light)' : 'var(--text-secondary)', cursor: 'pointer' }}
              >
                🎙 Voice Synth
              </button>
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

      {/* ── Voice Synth Panel ─────────────────────────────────────────────── */}
      {voiceSynthOpen && phase === 'editing' && (
        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(139,92,246,0.06)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-light)' }}>Voice Synth</span>

          {/* Self-contained mic recorder */}
          {vsRecording ? (
            <>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#dc2626', animation: 'pulse 0.8s ease-in-out infinite', flexShrink: 0 }} />
              <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#dc2626', minWidth: 40 }}>{vsRecTime.toFixed(1)}s</span>
              <button onClick={stopVsRecording}
                style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer', fontWeight: 600 }}>
                <Square size={10} fill="currentColor" /> Stop
              </button>
            </>
          ) : (
            <button onClick={startVsRecording}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 9px', borderRadius: 5, background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}>
              <Mic size={11} /> {vsAudioBuf ? `Re-record (${vsAudioBuf.duration.toFixed(1)}s)` : 'Record'}
            </button>
          )}

          {vsAudioBuf && !vsRecording && (
            <button onClick={runVoiceSynth} disabled={voiceSynthRendering}
              style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, padding: '4px 12px', borderRadius: 5, background: voiceSynthRendering ? 'var(--bg-card)' : 'var(--accent)', border: 'none', color: voiceSynthRendering ? 'var(--text-muted)' : '#fff', cursor: voiceSynthRendering ? 'default' : 'pointer', fontWeight: 600 }}>
              {voiceSynthRendering
                ? <><RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> Rendering…</>
                : '+ Add Synth Layer'}
            </button>
          )}

          {audioClips.filter(c => c.name === 'Synth').length > 0 && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {audioClips.filter(c => c.name === 'Synth').length} synth layer{audioClips.filter(c => c.name === 'Synth').length !== 1 ? 's' : ''} added · press Play to hear
            </span>
          )}
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────────────────── */}
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
              <div style={{ flex: inPortal ? undefined : 1, overflowX: 'auto', overflowY: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {/* Fixed-width inner column at zoom level */}
                <div style={{ width: 88 + (timelinePx * zoomLevel), minWidth: '100%', flexShrink: 0, display: 'flex', flexDirection: 'column', position: 'relative' }}>
                  <Playhead time={playhead} duration={duration} pxWidth={timelinePx * zoomLevel} />

                  {/* Ruler — offset 88px to align with hit area (64 label + 24 note axis) */}
                  <div style={{ paddingLeft: 88 }}>
                    <RulerTicks duration={duration} px={timelinePx * zoomLevel} onSeek={handleSeek} />
                  </div>

                  {/* Waveform */}
                  {audioBuf && <Waveform audioBuffer={audioBuf} pxWidth={timelinePx * zoomLevel} />}

                  {/* Lanes */}
                  <div style={inPortal ? {} : { flex: 1, overflowY: 'auto' }}>
                    {activeLaneTypes.map(type => (
                      <div key={type} style={{ display: 'flex' }}>
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
                          onSelectLane={() => setActiveLaneType(type)}
                          onClipRightClick={(e, clipId) => setClipMenu({ clipId, x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 160) })}
                          onClipMove={(clipId, newStart) => setAudioClips(prev => prev.map(c => c.id === clipId ? { ...c, startTime: newStart } : c))}
                          onClipDelete={clipId => setAudioClips(prev => prev.filter(c => c.id !== clipId))}
                          onMoveHit={moveHit}
                          onDeleteHit={deleteHit}
                          onAddHit={(t, note) => addHit(type, t, note)}
                          onToggleMute={() => toggleMute(type)}
                          onLaneContextMenu={e => setLaneMenu({ type, x: Math.min(e.clientX, window.innerWidth - 200), y: Math.min(e.clientY, window.innerHeight - 200) })}
                          onHitRightClick={(e, id) => setHitMenu({ hitId: id, x: Math.min(e.clientX, window.innerWidth - 250), y: Math.min(e.clientY, window.innerHeight - 340) })}
                        />
                      </div>
                    ))}
                    {/* Add new lane */}
                    <div style={{ display: 'flex', height: 36, alignItems: 'center', paddingLeft: 88, borderBottom: '1px solid var(--border)' }}>
                      <button
                        onClick={addCustomLane}
                        style={{ fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                      >
                        + Add track
                      </button>
                    </div>
                  </div>

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

      </div>

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
                  ...(activeLaneTypes.length > 1
                    ? [{ label: 'Delete lane', action: () => { removeLane(laneMenu.type); setLaneMenu(null) }, danger: true }]
                    : []),
                ].map(item => (
                  <button key={item.label} onClick={item.action}
                    style={{ width: '100%', padding: '7px 10px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12, color: (item as {danger?: boolean}).danger ? '#ef4444' : 'var(--text-primary)', borderRadius: 6 }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--border)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                  >{item.label}</button>
                ))}
              </>
            )}
          </div>
        </>
      )}

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
                  <button onClick={() => convertClipToSynth(clip.id)} style={btnStyle()}>Synth</button>
                  <button onClick={() => convertClipToBeats(clip.id)} style={btnStyle()}>Beat</button>
                </div>
              )}

              <div style={{ height: 1, background: 'var(--border)', margin: '3px 0' }} />
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
    </div>
  )
}
