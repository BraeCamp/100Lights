'use client'

import { useState } from 'react'
import {
  ROOT_NOTES,
  SCALE_INTERVALS,
  SCALE_LABELS,
  isNoteInScale,
  type ScaleType,
  type RootNote,
} from '@/lib/scale-constants'
import { playMelodicNote } from '@/lib/instrument-synth'

// ── Audio (lazy AudioContext) ─────────────────────────────────────────────────
let _ctx: AudioContext | null = null
const getCtx = () => (_ctx ??= new AudioContext())

function playNote(midi: number) {
  const ctx = getCtx()
  if (ctx.state === 'suspended') void ctx.resume()
  const gain = ctx.createGain()
  gain.gain.value = 0.9
  gain.connect(ctx.destination)
  // 'guitar-acoustic' is a valid MELODIC_TYPES / BeatType voice.
  playMelodicNote(ctx, 'guitar-acoustic', midi, ctx.currentTime, 0.9, gain)
  setTimeout(() => gain.disconnect(), 1500)
}

// ── Fretboard geometry ────────────────────────────────────────────────────────
const FRETS = 15
// Standard tuning, open-string MIDI, LOW → HIGH.
const OPEN_LOW_TO_HIGH = [40, 45, 50, 55, 59, 64] // E2 A2 D3 G3 B3 E4
// Render with the high E at the top and the thick low E at the bottom.
const STRINGS_TOP_TO_BOTTOM = [...OPEN_LOW_TO_HIGH].reverse() // [64,59,55,50,45,40]
const INLAY_FRETS = [3, 5, 7, 9, 12, 15]

const OPEN_X = 24
const NUT_X = 52
const FRET_W = 56
const TOP_PAD = 30
const STRING_GAP = 38
const R = 13

const fretLineX = (f: number) => NUT_X + f * FRET_W
const dotX = (f: number) => (f === 0 ? OPEN_X : NUT_X + (f - 0.5) * FRET_W)
const stringY = (i: number) => TOP_PAD + i * STRING_GAP

const BOARD_TOP = stringY(0)
const BOARD_BOTTOM = stringY(5)
const WIDTH = fretLineX(FRETS) + 24
const HEIGHT = BOARD_BOTTOM + 44

const noteName = (midi: number) => ROOT_NOTES[((midi % 12) + 12) % 12]

const SCALE_KEYS = Object.keys(SCALE_INTERVALS) as ScaleType[]

export default function Fretboard() {
  const [root, setRoot] = useState<RootNote>('E')
  const [scale, setScale] = useState<ScaleType>('pentatonic-minor')

  const rootIdx = ROOT_NOTES.indexOf(root)

  // Precompute every marked position.
  const dots: { x: number; y: number; midi: number; isRoot: boolean }[] = []
  STRINGS_TOP_TO_BOTTOM.forEach((open, i) => {
    for (let f = 0; f <= FRETS; f++) {
      const midi = open + f
      if (!isNoteInScale(midi, root, scale)) continue
      dots.push({
        x: dotX(f),
        y: stringY(i),
        midi,
        isRoot: ((midi % 12) + 12) % 12 === rootIdx,
      })
    }
  })

  const btnBase: React.CSSProperties = {
    padding: '7px 0',
    minWidth: 40,
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg-card)',
    color: 'var(--text-secondary)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  }

  return (
    <div>
      {/* Controls */}
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
          Root note
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 18 }}>
          {ROOT_NOTES.map((n) => {
            const active = n === root
            return (
              <button
                key={n}
                type="button"
                onClick={() => setRoot(n)}
                style={{
                  ...btnBase,
                  ...(active
                    ? { background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
                    : {}),
                }}
              >
                {n}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Scale
          </div>
          <select
            value={scale}
            onChange={(e) => setScale(e.target.value as ScaleType)}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              border: '1px solid var(--border)',
              background: 'var(--bg-card)',
              color: 'var(--text-primary)',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {SCALE_KEYS.map((s) => (
              <option key={s} value={s}>
                {SCALE_LABELS[s]}
              </option>
            ))}
          </select>
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent-light)' }}>
            {root} {SCALE_LABELS[scale]}
          </div>
        </div>
      </div>

      {/* Fretboard */}
      <div style={{ overflowX: 'auto', paddingBottom: 6 }}>
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-label={`${root} ${SCALE_LABELS[scale]} scale on a guitar fretboard`}
          style={{ display: 'block' }}
        >
          {/* Board */}
          <rect
            x={NUT_X}
            y={BOARD_TOP - 6}
            width={fretLineX(FRETS) - NUT_X}
            height={BOARD_BOTTOM - BOARD_TOP + 12}
            rx={4}
            fill="var(--bg-card)"
          />

          {/* Inlay markers */}
          {INLAY_FRETS.map((f) => {
            const cx = dotX(f)
            if (f === 12) {
              return (
                <g key={f}>
                  <circle cx={cx} cy={stringY(1) + STRING_GAP / 2} r={4} fill="var(--text-muted)" opacity={0.35} />
                  <circle cx={cx} cy={stringY(3) + STRING_GAP / 2} r={4} fill="var(--text-muted)" opacity={0.35} />
                </g>
              )
            }
            return (
              <circle key={f} cx={cx} cy={(BOARD_TOP + BOARD_BOTTOM) / 2} r={4} fill="var(--text-muted)" opacity={0.35} />
            )
          })}

          {/* Fret lines */}
          {Array.from({ length: FRETS + 1 }, (_, f) => (
            <line
              key={f}
              x1={fretLineX(f)}
              y1={BOARD_TOP - 6}
              x2={fretLineX(f)}
              y2={BOARD_BOTTOM + 6}
              stroke={f === 0 ? 'var(--text-muted)' : 'var(--border)'}
              strokeWidth={f === 0 ? 4 : 1.5}
            />
          ))}

          {/* String lines */}
          {STRINGS_TOP_TO_BOTTOM.map((open, i) => (
            <line
              key={open}
              x1={NUT_X}
              y1={stringY(i)}
              x2={fretLineX(FRETS)}
              y2={stringY(i)}
              stroke="var(--border)"
              strokeWidth={1 + i * 0.5}
            />
          ))}

          {/* Fret numbers */}
          {Array.from({ length: FRETS + 1 }, (_, f) => (
            <text
              key={f}
              x={f === 0 ? OPEN_X : dotX(f)}
              y={BOARD_BOTTOM + 28}
              textAnchor="middle"
              fontSize={11}
              fontWeight={600}
              fill="var(--text-muted)"
            >
              {f}
            </text>
          ))}

          {/* Scale note dots */}
          {dots.map((d, idx) => (
            <g
              key={idx}
              onClick={() => playNote(d.midi)}
              style={{ cursor: 'pointer' }}
              role="button"
              aria-label={`Play ${noteName(d.midi)}`}
            >
              <circle
                cx={d.x}
                cy={d.y}
                r={R}
                fill={d.isRoot ? 'var(--accent)' : 'rgba(139,92,246,0.22)'}
                stroke={d.isRoot ? '#fff' : 'var(--accent-light)'}
                strokeWidth={d.isRoot ? 2 : 1.5}
              />
              <text
                x={d.x}
                y={d.y + 3.5}
                textAnchor="middle"
                fontSize={10}
                fontWeight={700}
                fill={d.isRoot ? '#fff' : 'var(--text-primary)'}
                style={{ pointerEvents: 'none' }}
              >
                {noteName(d.midi)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 12.5, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'var(--accent)', border: '2px solid #fff', display: 'inline-block' }} />
          Root note
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(139,92,246,0.22)', border: '1.5px solid var(--accent-light)', display: 'inline-block' }} />
          Scale note
        </span>
        <span style={{ color: 'var(--text-muted)' }}>Click any dot to hear it.</span>
      </div>
    </div>
  )
}
