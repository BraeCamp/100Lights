'use client'

// Blind A/B/X. Two versions of the same chord — one darker, one brighter. A
// hidden X is one of them; you decide whether X matches A or B. It trains the
// thing every mixing decision rests on: hearing a small difference reliably.

import { useState } from 'react'
import { ACCENT, mixCtx, Frame } from './article/mix-kit'
import { GOOD, BAD, mtof } from './article/challenge-kit'

const DARK = 1300, BRIGHT = 4600

export default function ArticleABX({ caption }: { caption?: string }) {
  const [root, setRoot] = useState(57)
  const [xIsA, setXIsA] = useState(true)
  const [started, setStarted] = useState(false)
  const [guess, setGuess] = useState<'A' | 'B' | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })

  function playChord(r: number, cutoff: number) {
    const c = mixCtx(); void c.resume()
    const t = c.currentTime + 0.04
    const filt = c.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = cutoff; filt.Q.value = 0.7
    const mix = c.createGain(); mix.gain.setValueAtTime(0.0001, t)
    mix.gain.exponentialRampToValueAtTime(0.3, t + 0.02); mix.gain.exponentialRampToValueAtTime(0.0001, t + 1.3)
    mix.connect(filt); filt.connect(c.destination)
    for (const s of [0, 4, 7, 12]) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(r + s)
      const g = c.createGain(); g.gain.value = 0.25
      o.connect(g); g.connect(mix); o.start(t); o.stop(t + 1.4)
    }
  }
  const play = (which: 'A' | 'B' | 'X') => {
    const cut = which === 'A' ? DARK : which === 'B' ? BRIGHT : (xIsA ? DARK : BRIGHT)
    playChord(root, cut)
  }

  function next() {
    setStarted(true); setGuess(null)
    setRoot(52 + Math.floor(Math.random() * 12))
    setXIsA(Math.random() < 0.5)
  }
  function answer(pick: 'A' | 'B') {
    if (guess != null || !started) return
    setGuess(pick)
    const correct = (pick === 'A') === xIsA
    setScore(s => ({ right: s.right + (correct ? 1 : 0), total: s.total + 1 }))
  }

  const answered = guess != null
  const correctLabel = xIsA ? 'A' : 'B'

  return (
    <Frame caption={caption}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={next} style={{ fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: ACCENT, color: '#fff' }}>
          {started ? 'New round' : 'Start'}
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {score.total > 0 ? `${score.right} / ${score.total}` : 'Score'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12 }}>
        {(['A', 'B', 'X'] as const).map(w => (
          <button key={w} onClick={() => started && play(w)} disabled={!started}
            style={{ fontSize: 15, fontWeight: 800, padding: '14px 0', borderRadius: 10, cursor: started ? 'pointer' : 'default',
              border: `1px solid ${w === 'X' ? ACCENT : 'var(--border)'}`, background: w === 'X' ? 'rgba(167,139,250,0.12)' : 'var(--bg-card)',
              color: w === 'X' ? ACCENT : 'var(--text-secondary)', opacity: started ? 1 : 0.5 }}>
            ▶ {w === 'X' ? '?' : w}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {(['A', 'B'] as const).map(pick => {
          const isCorrect = answered && pick === correctLabel
          const isWrong = answered && pick === guess && pick !== correctLabel
          return (
            <button key={pick} onClick={() => answer(pick)} disabled={!started || answered}
              style={{ fontSize: 12.5, fontWeight: 700, padding: '10px 0', borderRadius: 9, cursor: !started || answered ? 'default' : 'pointer',
                border: `1px solid ${isCorrect ? GOOD : isWrong ? BAD : 'var(--border)'}`,
                background: isCorrect ? 'rgba(52,211,153,0.16)' : isWrong ? 'rgba(248,113,113,0.16)' : 'var(--bg-card)',
                color: isCorrect ? GOOD : isWrong ? BAD : 'var(--text-secondary)', opacity: started ? 1 : 0.5 }}>
              X is {pick}
            </button>
          )
        })}
      </div>

      {answered && (
        <p style={{ fontSize: 12, marginTop: 12, fontWeight: 600, color: (guess === correctLabel) ? GOOD : BAD }}>
          {(guess === correctLabel) ? '✓ Right — ' : '✗ Nope — '}X was <span style={{ color: 'var(--text-primary)' }}>{correctLabel}</span> (the {xIsA ? 'darker' : 'brighter'} one).
        </p>
      )}
    </Frame>
  )
}
