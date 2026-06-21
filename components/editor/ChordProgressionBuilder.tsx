'use client'

import { useState, useCallback, useMemo } from 'react'
import type { BeatHit, BeatType } from '@/lib/beat-analyzer'
import {
  SCALE_LABELS,
  ROOT_NOTES,
  SCALE_INTERVALS,
  type ScaleType,
  type RootNote,
} from '@/lib/scale-constants'

// ── Types ──────────────────────────────────────────────────────────────────────

interface ChordProgressionBuilderProps {
  laneType: string
  bpm: number
  duration: number       // total loop length in seconds
  onClose: () => void
  onHitsChange: (hits: BeatHit[]) => void
}

type ChordQuality = 'major' | 'minor' | 'diminished' | 'other'

interface ChordDef {
  id: string
  numeral: string      // 'I', 'ii', 'vii°'
  name: string         // 'C Major'
  notes: number[]      // MIDI notes [root, third, fifth]
  quality: ChordQuality
}

interface ProgressionChord extends ChordDef {
  slotId: string
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ROMAN_NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII']
const C3_MIDI = 48    // C in octave 3
const ACCENT_COLOR = '#7c3aed'
const ACCENT_RGBA_70 = 'rgba(124,58,237,0.7)'

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildChords(rootNote: RootNote, scaleType: ScaleType): ChordDef[] {
  const intervals = SCALE_INTERVALS[scaleType]
  const n = intervals.length
  const rootIndex = ROOT_NOTES.indexOf(rootNote)
  const baseMidi = C3_MIDI + rootIndex

  return intervals.map((interval, i) => {
    const rootMidi = baseMidi + interval

    // Pick every other scale note: root (i), third (i+2), fifth (i+4)
    let thirdMidi = baseMidi + intervals[(i + 2) % n]
    let fifthMidi  = baseMidi + intervals[(i + 4) % n]

    // Ensure notes ascend (octave-correct wrapping)
    if (thirdMidi <= rootMidi) thirdMidi += 12
    if (fifthMidi <= thirdMidi) fifthMidi += 12

    const intervalToThird = thirdMidi - rootMidi
    const intervalToFifth = fifthMidi - rootMidi

    let quality: ChordQuality
    if (intervalToThird === 4) {
      quality = 'major'
    } else if (intervalToThird === 3 && intervalToFifth === 6) {
      quality = 'diminished'
    } else if (intervalToThird === 3) {
      quality = 'minor'
    } else {
      quality = 'other'
    }

    const romanBase = ROMAN_NUMERALS[i] ?? String(i + 1)
    let numeral: string
    if (quality === 'major') {
      numeral = romanBase
    } else if (quality === 'diminished') {
      numeral = `${romanBase.toLowerCase()}°`
    } else if (quality === 'minor') {
      numeral = romanBase.toLowerCase()
    } else {
      numeral = romanBase
    }

    const noteName = ROOT_NOTES[(rootIndex + interval) % 12]
    const qualityLabel =
      quality === 'major'      ? 'Major' :
      quality === 'minor'      ? 'Minor' :
      quality === 'diminished' ? 'Dim'   : 'Chord'
    const name = `${noteName} ${qualityLabel}`

    return {
      id: `degree-${i}`,
      numeral,
      name,
      notes: [rootMidi, thirdMidi, fifthMidi],
      quality,
    }
  })
}

function qualityBorderColor(quality: ChordQuality): string {
  if (quality === 'major')      return '#7c3aed'
  if (quality === 'minor')      return '#3b82f6'
  if (quality === 'diminished') return '#ef4444'
  return 'var(--border)'
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function ChordProgressionBuilder({
  laneType,
  bpm,
  duration,
  onClose,
  onHitsChange,
}: ChordProgressionBuilderProps) {
  const [rootNote,    setRootNote]    = useState<RootNote>('C')
  const [scaleType,   setScaleType]   = useState<ScaleType>('major')
  const [progression, setProgression] = useState<ProgressionChord[]>([])
  const [barsPerChord, setBarsPerChord] = useState<1 | 2 | 4>(1)

  const chords = useMemo(() => buildChords(rootNote, scaleType), [rootNote, scaleType])

  // Set of chromatic indices (0–11) that belong to the current key
  const scaleNoteSet = useMemo<Set<number>>(() => {
    const rootIndex = ROOT_NOTES.indexOf(rootNote)
    const set = new Set<number>()
    for (const interval of SCALE_INTERVALS[scaleType]) {
      set.add((rootIndex + interval) % 12)
    }
    return set
  }, [rootNote, scaleType])

  const addChord = useCallback((chord: ChordDef) => {
    setProgression(prev => [
      ...prev,
      {
        ...chord,
        slotId: `slot-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      },
    ])
  }, [])

  const removeChord = useCallback((slotId: string) => {
    setProgression(prev => prev.filter(c => c.slotId !== slotId))
  }, [])

  const clearProgression = useCallback(() => setProgression([]), [])

  const handleStamp = useCallback(() => {
    if (progression.length === 0) return

    const beatDuration  = 60 / bpm
    const barDuration   = beatDuration * 4
    const chordDuration = barsPerChord * barDuration - 0.05
    const type          = laneType as BeatType

    const newHits: BeatHit[] = []

    progression.forEach((chord, chordIdx) => {
      const chordStart = chordIdx * barsPerChord * barDuration
      if (chordStart >= duration) return

      chord.notes.forEach((midiNote, noteIdx) => {
        newHits.push({
          id:       `chord-${Date.now()}-${chordIdx}-${noteIdx}-${Math.random().toString(36).slice(2)}`,
          time:     chordStart,
          type,
          velocity: 0.75,
          note:     midiNote,
          duration: chordDuration,
        })
      })
    })

    onHitsChange(newHits)
    onClose()
  }, [progression, bpm, barsPerChord, duration, laneType, onHitsChange, onClose])

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        position:   'fixed',
        inset:      0,
        zIndex:     500,
        background: 'rgba(10,10,14,0.94)',
        display:    'flex',
        flexDirection: 'column',
        overflow:   'hidden',
      }}
    >
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          height:       50,
          flexShrink:   0,
          display:      'flex',
          alignItems:   'center',
          gap:          10,
          padding:      '0 16px',
          borderBottom: '1px solid var(--border)',
          background:   'var(--bg-surface)',
        }}
      >
        <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 14, whiteSpace: 'nowrap', marginRight: 4 }}>
          Chord Progression Builder
        </span>

        {/* Root note selector */}
        <select
          value={rootNote}
          onChange={e => setRootNote(e.target.value as RootNote)}
          style={{
            background:   'var(--bg-card)',
            border:       '1px solid var(--border)',
            borderRadius: 6,
            color:        'var(--text-primary)',
            padding:      '3px 8px',
            fontSize:     13,
            cursor:       'pointer',
          }}
        >
          {ROOT_NOTES.map(note => (
            <option key={note} value={note}>{note}</option>
          ))}
        </select>

        {/* Scale selector */}
        <select
          value={scaleType}
          onChange={e => setScaleType(e.target.value as ScaleType)}
          style={{
            background:   'var(--bg-card)',
            border:       '1px solid var(--border)',
            borderRadius: 6,
            color:        'var(--text-primary)',
            padding:      '3px 8px',
            fontSize:     13,
            cursor:       'pointer',
          }}
        >
          {(Object.keys(SCALE_LABELS) as ScaleType[]).map(key => (
            <option key={key} value={key}>{SCALE_LABELS[key]}</option>
          ))}
        </select>

        <div style={{ flex: 1 }} />

        <button
          onClick={onClose}
          style={{
            background: 'none',
            border:     'none',
            color:      'var(--text-muted)',
            cursor:     'pointer',
            fontSize:   20,
            lineHeight: 1,
            padding:    '4px 8px',
          }}
        >
          ✕
        </button>
      </div>

      {/* ── Scrollable body ─────────────────────────────────────────────────── */}
      <div
        style={{
          flex:          1,
          overflowY:     'auto',
          padding:       24,
          display:       'flex',
          flexDirection: 'column',
          gap:           24,
        }}
      >
        {/* ── Key / Scale info ──────────────────────────────────────────────── */}
        <section>
          <div
            style={{
              color:          'var(--text-muted)',
              fontSize:       11,
              textTransform:  'uppercase',
              letterSpacing:  1,
              marginBottom:   10,
            }}
          >
            {rootNote} {SCALE_LABELS[scaleType]} — notes in scale
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ROOT_NOTES.map((name, idx) => {
              const inScale = scaleNoteSet.has(idx)
              return (
                <div
                  key={name}
                  style={{
                    minWidth:    34,
                    padding:     '5px 8px',
                    borderRadius: 6,
                    textAlign:   'center',
                    fontSize:    12,
                    fontWeight:  inScale ? 600 : 400,
                    background:  inScale ? 'rgba(124,58,237,0.22)' : 'var(--bg-card)',
                    color:       inScale ? '#c4b5fd' : 'var(--text-muted)',
                    border:      `1px solid ${inScale ? 'rgba(124,58,237,0.45)' : 'var(--border)'}`,
                    transition:  'all 0.12s',
                  }}
                >
                  {name}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── Chord palette ─────────────────────────────────────────────────── */}
        <section>
          <div
            style={{
              color:         'var(--text-muted)',
              fontSize:      11,
              textTransform: 'uppercase',
              letterSpacing: 1,
              marginBottom:  12,
            }}
          >
            Chord Palette — click to add
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {chords.map(chord => (
              <button
                key={chord.id}
                onClick={() => addChord(chord)}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-subtle)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-card)' }}
                style={{
                  width:         80,
                  height:        64,
                  display:       'flex',
                  flexDirection: 'column',
                  alignItems:    'center',
                  justifyContent: 'center',
                  gap:           4,
                  background:    'var(--bg-card)',
                  border:        '1px solid var(--border)',
                  borderLeft:    `3px solid ${qualityBorderColor(chord.quality)}`,
                  borderRadius:  6,
                  cursor:        'pointer',
                  color:         'var(--text-primary)',
                  transition:    'background 0.12s',
                  padding:       '6px 4px',
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 700, color: '#c4b5fd' }}>
                  {chord.numeral}
                </span>
                <span
                  style={{
                    fontSize:   10,
                    color:      'var(--text-muted)',
                    textAlign:  'center',
                    lineHeight: 1.3,
                    whiteSpace: 'pre-wrap',
                  }}
                >
                  {chord.name}
                </span>
              </button>
            ))}
          </div>
        </section>

        {/* ── Progression timeline ──────────────────────────────────────────── */}
        <section>
          {/* Controls row */}
          <div
            style={{
              display:     'flex',
              alignItems:  'center',
              gap:         10,
              marginBottom: 10,
              flexWrap:    'wrap',
            }}
          >
            <span
              style={{
                color:         'var(--text-muted)',
                fontSize:      11,
                textTransform: 'uppercase',
                letterSpacing: 1,
              }}
            >
              Progression
            </span>

            <div style={{ flex: 1 }} />

            {/* Bars per chord */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Bars per chord:</span>
              {([1, 2, 4] as const).map(bars => (
                <button
                  key={bars}
                  onClick={() => setBarsPerChord(bars)}
                  style={{
                    padding:      '3px 10px',
                    borderRadius: 4,
                    border:       '1px solid var(--border)',
                    background:   barsPerChord === bars ? ACCENT_COLOR : 'var(--bg-card)',
                    color:        barsPerChord === bars ? '#fff' : 'var(--text-muted)',
                    cursor:       'pointer',
                    fontSize:     12,
                    fontWeight:   barsPerChord === bars ? 600 : 400,
                    transition:   'background 0.12s',
                  }}
                >
                  {bars}
                </button>
              ))}
            </div>

            <button
              onClick={clearProgression}
              style={{
                background:   'none',
                border:       '1px solid var(--border)',
                borderRadius: 4,
                color:        'var(--text-muted)',
                cursor:       'pointer',
                padding:      '3px 10px',
                fontSize:     12,
              }}
            >
              Clear
            </button>
          </div>

          {/* Slot row */}
          <div
            style={{
              minHeight:    60,
              border:       '1px dashed var(--border)',
              borderRadius: 8,
              padding:      '10px 14px',
              display:      'flex',
              flexWrap:     'wrap',
              gap:          8,
              alignItems:   'center',
            }}
          >
            {progression.length === 0 ? (
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Click chords above to build your progression
              </span>
            ) : (
              progression.map(chord => (
                <button
                  key={chord.slotId}
                  onClick={() => removeChord(chord.slotId)}
                  title="Click to remove"
                  onMouseEnter={e => { e.currentTarget.style.opacity = '0.8' }}
                  onMouseLeave={e => { e.currentTarget.style.opacity = '1' }}
                  style={{
                    padding:      '6px 12px',
                    borderRadius: 20,
                    border:       'none',
                    background:   ACCENT_RGBA_70,
                    color:        '#fff',
                    cursor:       'pointer',
                    fontSize:     13,
                    fontWeight:   600,
                    display:      'flex',
                    alignItems:   'center',
                    gap:          6,
                    transition:   'opacity 0.1s',
                  }}
                >
                  <span>{chord.numeral}</span>
                  <span style={{ fontWeight: 400, opacity: 0.85, fontSize: 11 }}>{chord.name}</span>
                  <span style={{ opacity: 0.55, fontSize: 10, marginLeft: 2 }}>✕</span>
                </button>
              ))
            )}
          </div>
        </section>

        {/* ── Stamp button ──────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingBottom: 8 }}>
          <button
            onClick={handleStamp}
            disabled={progression.length === 0}
            style={{
              background:   progression.length === 0 ? 'var(--bg-card)' : ACCENT_COLOR,
              border:       'none',
              borderRadius: 8,
              color:        progression.length === 0 ? 'var(--text-muted)' : '#fff',
              cursor:       progression.length === 0 ? 'not-allowed' : 'pointer',
              padding:      '10px 28px',
              fontSize:     14,
              fontWeight:   600,
              transition:   'background 0.15s',
            }}
          >
            Stamp to Lane
          </button>
        </div>
      </div>
    </div>
  )
}
