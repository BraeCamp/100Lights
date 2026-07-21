'use client'

/**
 * Interactive Circle of Fifths.
 *
 * Twelve major keys ride the outer ring (clockwise from C at 12 o'clock),
 * each with its relative minor on the inner ring. Click a key to select it,
 * hear its I chord, and reveal the seven diatonic chords that sound "in key".
 * Every button plays through the shared piano-grand synth.
 */

import { useState } from 'react'
import { playMelodicNote } from '@/lib/instrument-synth'

// ── Music data ────────────────────────────────────────────────
// The 12 major keys clockwise from 12 o'clock, with pitch class and relative minor.
interface Key {
  name: string      // short display label (may include enharmonic)
  pc: number        // pitch class of the root, C = 0
  minor: string     // relative minor label
}

const KEYS: Key[] = [
  { name: 'C', pc: 0, minor: 'Am' },
  { name: 'G', pc: 7, minor: 'Em' },
  { name: 'D', pc: 2, minor: 'Bm' },
  { name: 'A', pc: 9, minor: 'F♯m' },
  { name: 'E', pc: 4, minor: 'C♯m' },
  { name: 'B', pc: 11, minor: 'G♯m' },
  { name: 'F♯/G♭', pc: 6, minor: 'D♯m' },
  { name: 'C♯/D♭', pc: 1, minor: 'A♯m' },
  { name: 'G♯/A♭', pc: 8, minor: 'Fm' },
  { name: 'D♯/E♭', pc: 3, minor: 'Cm' },
  { name: 'A♯/B♭', pc: 10, minor: 'Gm' },
  { name: 'F', pc: 5, minor: 'Dm' },
]

// Sharp note names by pitch class, used to spell diatonic chord roots.
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

// Major scale degrees (semitones above the tonic) and the quality on each degree.
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
type Quality = 'major' | 'minor' | 'dim'
const DEGREE_QUALITY: Quality[] = ['major', 'minor', 'minor', 'major', 'major', 'minor', 'dim']
const ROMAN = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
const QUALITY_SUFFIX: Record<Quality, string> = { major: '', minor: 'm', dim: 'dim' }
const TRIAD: Record<Quality, number[]> = { major: [0, 4, 7], minor: [0, 3, 7], dim: [0, 3, 6] }

interface Chord {
  roman: string
  label: string      // e.g. "Dm", "Bdim"
  midi: number[]     // triad around octave 4
}

function diatonicChords(key: Key): Chord[] {
  return MAJOR_SCALE.map((step, i) => {
    const rootPc = (key.pc + step) % 12
    const quality = DEGREE_QUALITY[i]
    const rootMidi = 60 + rootPc
    return {
      roman: ROMAN[i],
      label: NOTE_NAMES[rootPc] + QUALITY_SUFFIX[quality],
      midi: TRIAD[quality].map(t => rootMidi + t),
    }
  })
}

// ── Audio ─────────────────────────────────────────────────────
let _ctx: AudioContext | undefined
const ctx = () => (_ctx ??= new AudioContext())

function playChord(midi: number[]) {
  const c = ctx()
  if (c.state === 'suspended') void c.resume()
  const gain = c.createGain()
  gain.gain.value = 0.7
  gain.connect(c.destination)
  for (const m of midi) playMelodicNote(c, 'piano-grand', m, c.currentTime + 0.01, 0.9, gain)
  setTimeout(() => gain.disconnect(), 1600)
}

// ── Geometry ──────────────────────────────────────────────────
const SIZE = 360
const CX = SIZE / 2
const CY = SIZE / 2
const MAJOR_R = 142   // outer ring radius (major key nodes)
const MINOR_R = 92    // inner ring radius (relative minor nodes)
const MAJOR_NODE = 27
const MINOR_NODE = 21

function pos(i: number, r: number) {
  const rad = ((-90 + i * 30) * Math.PI) / 180
  return { x: CX + r * Math.cos(rad), y: CY + r * Math.sin(rad) }
}

export default function CircleOfFifths() {
  const [selected, setSelected] = useState<number>(0)
  const key = KEYS[selected]
  const chords = diatonicChords(key)

  function selectKey(i: number) {
    setSelected(i)
    // Play the selected key's I chord.
    const rootMidi = 60 + KEYS[i].pc
    playChord(TRIAD.major.map(t => rootMidi + t))
  }

  return (
    <div>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        role="img"
        aria-label="Circle of fifths"
        style={{ display: 'block', width: '100%', maxWidth: 360, margin: '0 auto' }}
      >
        {/* Ring guides */}
        <circle cx={CX} cy={CY} r={MAJOR_R + MAJOR_NODE - 2} fill="none" stroke="var(--border)" strokeWidth={1} opacity={0.5} />
        <circle cx={CX} cy={CY} r={MINOR_R + MINOR_NODE - 2} fill="none" stroke="var(--border)" strokeWidth={1} opacity={0.4} />

        {KEYS.map((k, i) => {
          const isSel = i === selected
          const outer = pos(i, MAJOR_R)
          const inner = pos(i, MINOR_R)
          return (
            <g key={k.pc} onClick={() => selectKey(i)} style={{ cursor: 'pointer' }}>
              {/* Major node */}
              <circle
                cx={outer.x}
                cy={outer.y}
                r={MAJOR_NODE}
                fill={isSel ? 'var(--accent)' : 'var(--bg-card)'}
                stroke={isSel ? 'var(--accent-light)' : 'var(--border)'}
                strokeWidth={isSel ? 2.5 : 1}
              />
              <text
                x={outer.x}
                y={outer.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={k.name.length > 2 ? 9.5 : 14}
                fontWeight={700}
                fill={isSel ? '#fff' : 'var(--text-primary)'}
                style={{ pointerEvents: 'none' }}
              >
                {k.name}
              </text>

              {/* Relative minor node */}
              <circle
                cx={inner.x}
                cy={inner.y}
                r={MINOR_NODE}
                fill={isSel ? 'rgba(124,58,237,0.28)' : 'var(--bg-base)'}
                stroke={isSel ? 'var(--accent-light)' : 'var(--border)'}
                strokeWidth={isSel ? 2 : 1}
              />
              <text
                x={inner.x}
                y={inner.y}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontWeight={600}
                fill={isSel ? 'var(--text-primary)' : 'var(--text-secondary)'}
                style={{ pointerEvents: 'none' }}
              >
                {k.minor}
              </text>
            </g>
          )
        })}
      </svg>

      {/* Selected key detail */}
      <div style={{ marginTop: 22, textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
          {key.name.split('/')[0]} major
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text-muted)', marginTop: 2 }}>
          relative minor: <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{key.minor}</span>
        </div>
      </div>

      {/* Diatonic chords */}
      <div style={{ marginTop: 18 }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginBottom: 10 }}>
          The seven chords that sound in key — tap to hear
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
          {chords.map((ch, i) => (
            <button
              key={i}
              onClick={() => playChord(ch.midi)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                minWidth: 56,
                padding: '8px 10px',
                borderRadius: 10,
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-light)' }}>{ch.roman}</span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{ch.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
