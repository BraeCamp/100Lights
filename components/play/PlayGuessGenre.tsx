'use client'

// "Same four chords, guess the genre." Plays one of the five same-progression
// genre renditions (/api/demo-audio/sfc-*) and asks the listener to name it.
// Shows the punchline — the chords never changed — after each guess.

import { useEffect, useRef, useState } from 'react'

const GENRES = [
  { id: 'sfc-pop', name: 'Pop' },
  { id: 'sfc-neosoul', name: 'Neo-soul' },
  { id: 'sfc-cinematic', name: 'Cinematic' },
  { id: 'sfc-blues', name: 'Blues' },
  { id: 'sfc-electronic', name: 'Electronic' },
]

export default function PlayGuessGenre() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [target, setTarget] = useState<number>(0)
  const [guess, setGuess] = useState<number | null>(null)
  const [round, setRound] = useState(0)
  const [score, setScore] = useState(0)
  const [playing, setPlaying] = useState(false)

  const pick = () => Math.floor(Math.random() * GENRES.length)

  const startRound = (idx: number) => {
    setTarget(idx); setGuess(null)
    const a = audioRef.current
    if (a) { a.src = `/api/demo-audio/${GENRES[idx].id}`; a.currentTime = 0; void a.play().catch(() => {}) }
  }

  // First round on mount (autoplay may be blocked until a tap — the ▶ button covers that).
  useEffect(() => { setTarget(pick()) }, [])

  const replay = () => {
    const a = audioRef.current
    if (!a) return
    if (!a.src) a.src = `/api/demo-audio/${GENRES[target].id}`
    a.currentTime = 0; void a.play().catch(() => {})
  }

  const answer = (i: number) => {
    if (guess !== null) return
    setGuess(i)
    setRound(r => r + 1)
    if (i === target) setScore(s => s + 1)
  }

  const next = () => startRound(pick())

  const correct = guess === target

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 460, margin: '0 auto', width: '100%' }}>
      <audio ref={audioRef} preload="auto" onPlay={() => setPlaying(true)} onEnded={() => setPlaying(false)} onPause={() => setPlaying(false)} style={{ display: 'none' }} />

      {/* Play / score row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={replay} aria-label="Play the clip" style={{
          flexShrink: 0, width: 60, height: 60, borderRadius: 30, border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)', color: '#fff', fontSize: 22,
          display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 18px rgba(124,58,237,0.45)',
        }}>{playing ? '❚❚' : '▶'}</button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e9e6f2' }}>{playing ? 'Listening…' : 'Tap to hear the clip'}</div>
          <div style={{ fontSize: 11, color: '#8b8397' }}>Round {round + (guess === null ? 1 : 0) || 1} · Score {score}</div>
        </div>
      </div>

      {/* Options */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        {GENRES.map((g, i) => {
          const isTarget = i === target
          const chosen = guess === i
          const reveal = guess !== null
          let bg = 'rgba(255,255,255,0.05)', border = '1px solid rgba(255,255,255,0.14)', color = '#e9e6f2'
          if (reveal && isTarget) { bg = 'rgba(52,211,153,0.18)'; border = '1px solid #34d399'; color = '#34d399' }
          else if (reveal && chosen && !isTarget) { bg = 'rgba(239,68,68,0.16)'; border = '1px solid #ef4444'; color = '#f87171' }
          return (
            <button key={g.id} onClick={() => answer(i)} disabled={reveal}
              style={{ padding: '15px 10px', borderRadius: 12, cursor: reveal ? 'default' : 'pointer', border, background: bg, color, fontSize: 15, fontWeight: 800, transition: 'all 0.12s' }}>
              {g.name}{reveal && isTarget ? ' ✓' : reveal && chosen ? ' ✕' : ''}
            </button>
          )
        })}
        {/* fifth option centered on its own row */}
      </div>

      {/* Reveal / next */}
      <div style={{ minHeight: 64, textAlign: 'center' }}>
        {guess !== null ? (
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: correct ? '#34d399' : '#f59e0b', marginBottom: 4 }}>
              {correct ? 'Nailed it.' : `That was ${GENRES[target].name}.`}
            </div>
            <div style={{ fontSize: 12.5, color: '#b8b3c6', lineHeight: 1.5, marginBottom: 12 }}>
              Same four chords every time — <strong style={{ color: '#e9e6f2' }}>C, G, Am, F</strong>. Only the rhythm, sound, and space changed. That’s arrangement, and it’s all yours to move.
            </div>
            <button onClick={next} style={{ padding: '11px 22px', borderRadius: 10, border: '1px solid rgba(167,139,250,0.5)', background: 'rgba(139,92,246,0.14)', color: '#c4b5fd', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
              Another one ▸
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: '#6f6982', paddingTop: 8 }}>Listen, then tap the genre you hear.</div>
        )}
      </div>
    </div>
  )
}
