'use client'

/**
 * Interval ear trainer — plays two notes, you name the interval, it scores you.
 * The most on-brand tool: "a studio that trains your ears," as a standalone.
 */

import { useEffect, useRef, useState } from 'react'
import { playMelodicNote } from '@/lib/instrument-synth'

const INTERVALS = [
  { semis: 1, name: 'Minor 2nd', short: 'm2' },
  { semis: 2, name: 'Major 2nd', short: 'M2' },
  { semis: 3, name: 'Minor 3rd', short: 'm3' },
  { semis: 4, name: 'Major 3rd', short: 'M3' },
  { semis: 5, name: 'Perfect 4th', short: 'P4' },
  { semis: 6, name: 'Tritone', short: 'TT' },
  { semis: 7, name: 'Perfect 5th', short: 'P5' },
  { semis: 8, name: 'Minor 6th', short: 'm6' },
  { semis: 9, name: 'Major 6th', short: 'M6' },
  { semis: 10, name: 'Minor 7th', short: 'm7' },
  { semis: 11, name: 'Major 7th', short: 'M7' },
  { semis: 12, name: 'Octave', short: 'P8' },
]
type Direction = 'up' | 'down' | 'harmonic'

let _ctx: AudioContext | null = null
const ctx = () => (_ctx ??= new AudioContext())

// A deterministic-enough source of randomness is fine here; Math.random is
// unavailable in some sandboxes but fine in the browser.
const rand = (n: number) => Math.floor(Math.random() * n)

export default function IntervalTrainer() {
  const [dir, setDir] = useState<Direction>('up')
  const [pool, setPool] = useState<Set<number>>(new Set(INTERVALS.map(i => i.semis))) // which intervals are in play
  const [current, setCurrent] = useState<{ root: number; semis: number } | null>(null)
  const [guess, setGuess] = useState<number | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })
  const dirRef = useRef(dir)
  useEffect(() => { dirRef.current = dir }, [dir])

  useEffect(() => () => { void _ctx?.close(); _ctx = null }, [])

  function play(root: number, semis: number, direction = dirRef.current) {
    const c = ctx()
    void c.resume()
    const g = c.createGain(); g.gain.value = 0.75; g.connect(c.destination)
    const other = root + semis
    if (direction === 'harmonic') {
      playMelodicNote(c, 'piano-grand', root, c.currentTime + 0.02, 0.9, g)
      playMelodicNote(c, 'piano-grand', other, c.currentTime + 0.02, 0.9, g)
    } else {
      const [a, b] = direction === 'up' ? [root, other] : [other, root]
      playMelodicNote(c, 'piano-grand', a, c.currentTime + 0.02, 0.9, g)
      playMelodicNote(c, 'piano-grand', b, c.currentTime + 0.65, 0.9, g)
    }
    setTimeout(() => g.disconnect(), 2400)
  }

  function next() {
    const options = [...pool]
    if (!options.length) return
    const semis = options[rand(options.length)]
    const root = 55 + rand(8) // G3..D4-ish, keeps both notes on the keyboard
    setCurrent({ root, semis })
    setGuess(null)
    play(root, semis)
  }

  function answer(semis: number) {
    if (!current || guess !== null) return
    setGuess(semis)
    setScore(s => ({ right: s.right + (semis === current.semis ? 1 : 0), total: s.total + 1 }))
  }

  const correct = current && guess === current.semis
  const answered = guess !== null

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: '20px 18px', background: 'var(--bg-card)' }}>
      {/* Direction + score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 9, background: 'var(--bg-base)' }}>
          {(['up', 'down', 'harmonic'] as Direction[]).map(d => (
            <button key={d} onClick={() => setDir(d)} style={{
              padding: '5px 11px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, textTransform: 'capitalize',
              background: dir === d ? 'var(--accent)' : 'transparent', color: dir === d ? '#fff' : 'var(--text-muted)',
            }}>{d}</button>
          ))}
        </div>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>
          Score: <strong style={{ color: 'var(--text-primary)' }}>{score.right}</strong> / {score.total}
          {score.total > 0 && <span style={{ color: 'var(--text-muted)' }}> · {Math.round(score.right / score.total * 100)}%</span>}
        </span>
      </div>

      {/* Play / replay */}
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        {!current ? (
          <button onClick={next} style={bigBtn}>▶ Start</button>
        ) : (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => play(current.root, current.semis)} style={{ ...bigBtn, background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>↻ Replay</button>
            {answered && <button onClick={next} style={bigBtn}>Next →</button>}
          </div>
        )}
      </div>

      {/* Answers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
        {INTERVALS.map(iv => {
          const inPool = pool.has(iv.semis)
          const isAnswer = current?.semis === iv.semis
          const picked = guess === iv.semis
          let bg = 'var(--bg-base)', bd = 'var(--border)', col = 'var(--text-primary)'
          if (answered && isAnswer) { bg = 'rgba(52,211,153,0.2)'; bd = '#34d399'; col = '#34d399' }
          else if (answered && picked) { bg = 'rgba(239,68,68,0.15)'; bd = '#ef4444'; col = '#ef4444' }
          return (
            <button key={iv.semis} onClick={() => answer(iv.semis)} disabled={!current || answered || !inPool} style={{
              padding: '9px 6px', borderRadius: 9, cursor: (!current || answered || !inPool) ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 700,
              border: `1px solid ${bd}`, background: bg, color: col, opacity: inPool ? 1 : 0.3,
            }}>{iv.name}</button>
          )
        })}
      </div>

      {answered && (
        <p style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, marginTop: 14, marginBottom: 0, color: correct ? '#34d399' : '#f59e0b' }}>
          {correct ? 'Correct!' : `It was a ${INTERVALS.find(i => i.semis === current!.semis)!.name}.`}
        </p>
      )}

      {/* Which intervals to include */}
      <details style={{ marginTop: 16 }}>
        <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>Choose which intervals to practise</summary>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
          {INTERVALS.map(iv => (
            <button key={iv.semis} onClick={() => setPool(prev => {
              const n = new Set(prev); if (n.has(iv.semis)) n.delete(iv.semis); else n.add(iv.semis)
              return n.size ? n : prev // never empty
            })} style={{
              fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 99, cursor: 'pointer',
              border: `1px solid ${pool.has(iv.semis) ? 'var(--accent)' : 'var(--border)'}`,
              background: pool.has(iv.semis) ? 'rgba(124,58,237,0.15)' : 'transparent',
              color: pool.has(iv.semis) ? 'var(--accent-light)' : 'var(--text-muted)',
            }}>{iv.short}</button>
          ))}
        </div>
      </details>
    </div>
  )
}

const bigBtn: React.CSSProperties = {
  padding: '10px 24px', borderRadius: 10, border: 'none', fontSize: 14, fontWeight: 700, cursor: 'pointer',
  background: 'var(--accent)', color: '#fff',
}
