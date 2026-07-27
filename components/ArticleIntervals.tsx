'use client'

// Train your ear on intervals. Two notes play; you name the distance between them.
// Immediate right/wrong feedback and a running score turn the abstract list of
// interval names into something you can actually recognize.

import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { ACCENT, mixCtx, Frame } from './article/mix-kit'

// Per-interval recurrence weights, persisted. Missed intervals quietly come up
// more often (the drill), known ones ease off — never surfaced to the reader.
const WEIGHTS_KEY = '100lights-interval-weights'

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const INTERVALS = [
  { s: 1, name: 'Minor 2nd', short: 'm2' }, { s: 2, name: 'Major 2nd', short: 'M2' },
  { s: 3, name: 'Minor 3rd', short: 'm3' }, { s: 4, name: 'Major 3rd', short: 'M3' },
  { s: 5, name: 'Perfect 4th', short: 'P4' }, { s: 6, name: 'Tritone', short: 'TT' },
  { s: 7, name: 'Perfect 5th', short: 'P5' }, { s: 8, name: 'Minor 6th', short: 'm6' },
  { s: 9, name: 'Major 6th', short: 'M6' }, { s: 10, name: 'Minor 7th', short: 'm7' },
  { s: 11, name: 'Major 7th', short: 'M7' }, { s: 12, name: 'Octave', short: 'P8' },
]

export default function ArticleIntervals({ caption }: { caption?: string }) {
  const [semi, setSemi] = useState<number | null>(null)   // current question (null = not started)
  const [root, setRoot] = useState(60)
  const [guess, setGuess] = useState<number | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })
  const weightsRef = useRef<Record<number, number>>({})
  useEffect(() => { try { weightsRef.current = JSON.parse(localStorage.getItem(WEIGHTS_KEY) || '{}') } catch { /* ignore */ } }, [])

  function tone(freq: number, t: number) {
    const c = mixCtx()
    const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = freq
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55)
    const g2 = c.createGain(); g2.gain.value = 0.12
    o.connect(g); o2.connect(g2); g2.connect(g); g.connect(c.destination)
    o.start(t); o.stop(t + 0.6); o2.start(t); o2.stop(t + 0.6)
  }
  function playPair(r: number, s: number) {
    const c = mixCtx(); void c.resume()
    const t = c.currentTime + 0.05
    tone(mtof(r), t); tone(mtof(r + s), t + 0.6)
  }

  function pickSemi(): number {
    const w = weightsRef.current
    const total = INTERVALS.reduce((a, iv) => a + Math.max(1, w[iv.s] ?? 1), 0)
    let r = Math.random() * total
    for (const iv of INTERVALS) { r -= Math.max(1, w[iv.s] ?? 1); if (r <= 0) return iv.s }
    return INTERVALS[INTERVALS.length - 1].s
  }
  function next() {
    const s = pickSemi()
    const r = 55 + Math.floor(Math.random() * 10)
    setSemi(s); setRoot(r); setGuess(null)
    playPair(r, s)
  }
  function choose(s: number) {
    if (guess != null || semi == null) return
    setGuess(s)
    const correct = s === semi
    // Quietly steer the mix of future questions: what gets missed comes back more,
    // what's known eases off. Never announced.
    const w = weightsRef.current
    w[semi] = correct ? Math.max(1, (w[semi] ?? 1) * 0.7) : Math.min(6, (w[semi] ?? 1) * 1.9)
    try { localStorage.setItem(WEIGHTS_KEY, JSON.stringify(w)) } catch { /* ignore */ }
    setScore(sc => ({ right: sc.right + (correct ? 1 : 0), total: sc.total + 1 }))
  }

  const answered = guess != null

  return (
    <Frame caption={caption}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <button onClick={next} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: ACCENT, color: '#fff' }}>
          <Play size={14} /> {semi == null ? 'Start' : 'New interval'}
        </button>
        {semi != null && (
          <button onClick={() => playPair(root, semi)} style={{ fontSize: 12, fontWeight: 700, padding: '9px 14px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
            Replay
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 700, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
          {score.total > 0 ? `${score.right} / ${score.total}` : 'Score'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
        {INTERVALS.map(iv => {
          const isCorrect = answered && iv.s === semi
          const isWrongPick = answered && iv.s === guess && iv.s !== semi
          return (
            <button
              key={iv.s}
              onClick={() => choose(iv.s)}
              disabled={semi == null || answered}
              title={iv.name}
              style={{
                fontSize: 11.5, fontWeight: 700, padding: '9px 0', borderRadius: 8, cursor: semi == null || answered ? 'default' : 'pointer',
                border: `1px solid ${isCorrect ? '#34d399' : isWrongPick ? '#f87171' : 'var(--border)'}`,
                background: isCorrect ? 'rgba(52,211,153,0.16)' : isWrongPick ? 'rgba(248,113,113,0.16)' : 'var(--bg-card)',
                color: isCorrect ? '#34d399' : isWrongPick ? '#f87171' : 'var(--text-secondary)',
                opacity: semi == null ? 0.55 : 1,
              }}
            >{iv.short}</button>
          )
        })}
      </div>

      {answered && semi != null && (
        <p style={{ fontSize: 12, marginTop: 12, fontWeight: 600, color: guess === semi ? '#34d399' : '#f87171' }}>
          {guess === semi ? '✓ Right — ' : '✗ Not quite — it was a '}
          <span style={{ color: 'var(--text-primary)' }}>{INTERVALS.find(i => i.s === semi)!.name}</span>.
        </p>
      )}

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        Hum the two notes and find the song that starts that way — a Perfect 5th is the first two notes of <em>Twinkle Twinkle</em>, a Major 3rd opens <em>When the Saints</em>. Anchoring intervals to tunes you know is the fastest way to start hearing them by name.
      </p>
    </Frame>
  )
}
