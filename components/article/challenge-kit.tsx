'use client'

// Shared atoms for the "learn by doing, no words" article challenges — the
// match-by-ear tools and the guess-the-sound games. Kept tiny and consistent so
// each widget stays short. Audio context + ACCENT come from mix-kit.

import React from 'react'
import { Play, RotateCcw } from 'lucide-react'
import { ACCENT, clamp, Frame } from './mix-kit'

export { Frame }
export const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
export const GOOD = '#34d399'
export const BAD = '#f87171'
export const WARN = '#f59e0b'

/** 0..1 accuracy/closeness bar — green when you're on it, red when you're cold. */
export function Meter({ value, hint }: { value: number; hint?: string }) {
  const v = clamp(value, 0, 1)
  const col = v > 0.9 ? GOOD : v > 0.6 ? ACCENT : v > 0.3 ? WARN : BAD
  return (
    <div style={{ margin: '4px 0 12px' }}>
      <div style={{ height: 12, borderRadius: 6, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', border: '1px solid var(--border)' }}>
        <div style={{ height: '100%', width: `${v * 100}%`, background: col, borderRadius: 6, transition: 'width 0.12s ease, background 0.2s' }} />
      </div>
      {hint && <div style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 5, textAlign: 'center' }}>{hint}</div>}
    </div>
  )
}

/** Start / New + optional Replay + a running score, shared by the guess games. */
export function GameBar({ started, onNew, onReplay, score, newLabel, replayLabel = 'Replay' }: {
  started: boolean
  onNew: () => void
  onReplay?: () => void
  score?: { right: number; total: number }
  newLabel?: string
  replayLabel?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
      <button onClick={onNew} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: ACCENT, color: '#fff' }}>
        <Play size={14} /> {started ? (newLabel ?? 'New one') : 'Start'}
      </button>
      {started && onReplay && (
        <button onClick={onReplay} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <RotateCcw size={12} /> {replayLabel}
        </button>
      )}
      {score && (
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {score.total > 0 ? `${score.right} / ${score.total}` : 'Score'}
        </span>
      )}
    </div>
  )
}

export interface Choice { id: string; label: string; title?: string }

/** A grid of answer buttons with right/wrong colouring once answered. */
export function ChoiceGrid({ choices, answered, correctId, guessId, onPick, cols = 4 }: {
  choices: Choice[]
  answered: boolean
  correctId: string | null
  guessId: string | null
  onPick: (id: string) => void
  cols?: number
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 6 }}>
      {choices.map(c => {
        const isCorrect = answered && c.id === correctId
        const isWrong = answered && c.id === guessId && c.id !== correctId
        return (
          <button
            key={c.id}
            onClick={() => onPick(c.id)}
            disabled={answered || correctId === null}
            title={c.title ?? c.label}
            style={{
              fontSize: 11.5, fontWeight: 700, padding: '9px 4px', borderRadius: 8,
              cursor: answered || correctId === null ? 'default' : 'pointer',
              border: `1px solid ${isCorrect ? GOOD : isWrong ? BAD : 'var(--border)'}`,
              background: isCorrect ? 'rgba(52,211,153,0.16)' : isWrong ? 'rgba(248,113,113,0.16)' : 'var(--bg-card)',
              color: isCorrect ? GOOD : isWrong ? BAD : 'var(--text-secondary)',
              opacity: correctId === null ? 0.55 : 1,
            }}
          >{c.label}</button>
        )
      })}
    </div>
  )
}

/** Right/wrong line under a guess grid. */
export function Verdict({ correct, answer }: { correct: boolean; answer: string }) {
  return (
    <p style={{ fontSize: 12, marginTop: 12, fontWeight: 600, color: correct ? GOOD : BAD }}>
      {correct ? '✓ Right — ' : '✗ Not quite — it was '}
      <span style={{ color: 'var(--text-primary)' }}>{answer}</span>.
    </p>
  )
}
