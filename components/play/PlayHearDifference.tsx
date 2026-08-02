'use client'

// Blind A/B listening test for social. Same beat, one production move applied to
// one clip. Play both, commit to which is treated, then reveal. Rotates through
// a few real demo pairs (sidechain, loop click, arrangement drop).

import { useEffect, useRef, useState } from 'react'

interface Pair { plain: string; treated: string; question: string; answer: string }
const PAIRS: Pair[] = [
  { plain: 'duck-off', treated: 'duck-on', question: 'Same kick, same bass. In which clip does the kick punch through?', answer: 'Nothing was compressed away — the bass just ducks under each kick, so the two low sounds take turns instead of fighting. That’s sidechain.' },
  { plain: 'loop-clean', treated: 'loop-click', question: 'One of these loops clicks on every repeat. Which one?', answer: 'The click is a discontinuity — the loop restarts at a different point on the waveform. Trim to a zero-crossing or add a tiny fade and it’s gone.' },
  { plain: 'eight-static', treated: 'eight-developed', question: 'One clip drops an element for a single bar at bar 8. Which has the event?', answer: 'You didn’t add anything — you removed something — and the listener hears the absence as arrival. That’s what bar 8 is for.' },
]

export default function PlayHearDifference() {
  const aRef = useRef<HTMLAudioElement>(null)
  const bRef = useRef<HTMLAudioElement>(null)
  const [pairIdx, setPairIdx] = useState(0)
  const [treatedSlot, setTreatedSlot] = useState<'A' | 'B'>('A')
  const [playingSlot, setPlayingSlot] = useState<'A' | 'B' | null>(null)
  const [guess, setGuess] = useState<'A' | 'B' | null>(null)

  const pair = PAIRS[pairIdx]

  const load = (idx: number, slot: 'A' | 'B') => {
    const p = PAIRS[idx]
    const aId = slot === 'A' ? p.treated : p.plain
    const bId = slot === 'A' ? p.plain : p.treated
    if (aRef.current) aRef.current.src = `/api/demo-audio/${aId}`
    if (bRef.current) bRef.current.src = `/api/demo-audio/${bId}`
  }

  useEffect(() => { const s: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B'; setTreatedSlot(s); load(0, s) }, [])

  const play = (slot: 'A' | 'B') => {
    const el = (slot === 'A' ? aRef : bRef).current
    const other = (slot === 'A' ? bRef : aRef).current
    if (!el) return
    other?.pause()
    if (el.paused) { el.currentTime = 0; void el.play().catch(() => {}); setPlayingSlot(slot) }
    else { el.pause(); setPlayingSlot(null) }
  }

  const answer = (slot: 'A' | 'B') => { if (guess === null) setGuess(slot) }

  const next = () => {
    aRef.current?.pause(); bRef.current?.pause(); setPlayingSlot(null)
    const ni = (pairIdx + 1) % PAIRS.length
    const s: 'A' | 'B' = Math.random() < 0.5 ? 'A' : 'B'
    setPairIdx(ni); setTreatedSlot(s); setGuess(null); load(ni, s)
  }

  useEffect(() => {
    const clear = () => setPlayingSlot(null)
    const a = aRef.current, b = bRef.current
    a?.addEventListener('ended', clear); b?.addEventListener('ended', clear)
    return () => { a?.removeEventListener('ended', clear); b?.removeEventListener('ended', clear) }
  }, [])

  const correct = guess === treatedSlot

  const clipBtn = (slot: 'A' | 'B') => {
    const isPlaying = playingSlot === slot
    const reveal = guess !== null
    const isTreated = slot === treatedSlot
    let border = '1px solid rgba(255,255,255,0.16)', bg = 'rgba(255,255,255,0.05)'
    if (reveal && isTreated) { border = '1px solid #34d399'; bg = 'rgba(52,211,153,0.14)' }
    return (
      <button onClick={() => play(slot)} style={{ flex: 1, padding: '20px 10px', borderRadius: 14, cursor: 'pointer', border, background: bg, color: '#f4f2f7', fontSize: 16, fontWeight: 800, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 24 }}>{isPlaying ? '❚❚' : '▶'}</span>
        Clip {slot}{reveal && isTreated ? ' ✓' : ''}
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 460, margin: '0 auto', width: '100%' }}>
      <audio ref={aRef} preload="auto" style={{ display: 'none' }} />
      <audio ref={bRef} preload="auto" style={{ display: 'none' }} />

      <p style={{ fontSize: 14, fontWeight: 700, color: '#e9e6f2', textAlign: 'center', margin: 0, lineHeight: 1.4 }}>{pair.question}</p>

      <div style={{ display: 'flex', gap: 12 }}>{clipBtn('A')}{clipBtn('B')}</div>

      {guess === null ? (
        <div style={{ display: 'flex', gap: 10 }}>
          {(['A', 'B'] as const).map(s => (
            <button key={s} onClick={() => answer(s)} style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid rgba(167,139,250,0.4)', background: 'rgba(139,92,246,0.1)', color: '#c4b5fd', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
              It’s Clip {s}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: correct ? '#34d399' : '#f59e0b', marginBottom: 4 }}>
            {correct ? 'Correct — that was the treated one.' : `Not this time — it was Clip ${treatedSlot}.`}
          </div>
          <div style={{ fontSize: 12.5, color: '#b8b3c6', lineHeight: 1.5, marginBottom: 12 }}>{pair.answer}</div>
          <button onClick={next} style={{ padding: '11px 22px', borderRadius: 10, border: '1px solid rgba(167,139,250,0.5)', background: 'rgba(139,92,246,0.14)', color: '#c4b5fd', fontSize: 14, fontWeight: 800, cursor: 'pointer' }}>
            Next test ▸
          </button>
        </div>
      )}
    </div>
  )
}
