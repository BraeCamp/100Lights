'use client'

// Hear a chord, name its quality. Major sounds bright, minor sad, diminished
// tense, augmented uneasy — you learn the colours by matching sound to name,
// with a score to chase. No theory required to start.

import { useState } from 'react'
import { mixCtx, Frame } from './article/mix-kit'
import { GameBar, ChoiceGrid, Verdict, mtof, type Choice } from './article/challenge-kit'

const QUALITIES: { id: string; label: string; semis: number[] }[] = [
  { id: 'maj',  label: 'Major',      semis: [0, 4, 7] },
  { id: 'min',  label: 'Minor',      semis: [0, 3, 7] },
  { id: 'dim',  label: 'Diminished', semis: [0, 3, 6] },
  { id: 'aug',  label: 'Augmented',  semis: [0, 4, 8] },
  { id: 'sus4', label: 'Sus4',       semis: [0, 5, 7] },
  { id: 'dom7', label: 'Dom 7',      semis: [0, 4, 7, 10] },
  { id: 'maj7', label: 'Major 7',    semis: [0, 4, 7, 11] },
  { id: 'min7', label: 'Minor 7',    semis: [0, 3, 7, 10] },
]
const CHOICES: Choice[] = QUALITIES.map(q => ({ id: q.id, label: q.label }))

export default function ArticleChordQuality({ caption }: { caption?: string }) {
  const [answer, setAnswer] = useState<string | null>(null)   // current question quality id
  const [root, setRoot] = useState(60)
  const [guess, setGuess] = useState<string | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })

  function playChord(r: number, semis: number[]) {
    const c = mixCtx(); void c.resume()
    const t = c.currentTime + 0.04
    const mix = c.createGain(); mix.gain.setValueAtTime(0.0001, t)
    mix.gain.exponentialRampToValueAtTime(0.28, t + 0.02); mix.gain.exponentialRampToValueAtTime(0.0001, t + 1.5)
    mix.connect(c.destination)
    for (const s of semis) {
      const f = mtof(r + s)
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f
      const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2
      const g2 = c.createGain(); g2.gain.value = 0.35
      o.connect(mix); o2.connect(g2); g2.connect(mix)
      o.start(t); o.stop(t + 1.6); o2.start(t); o2.stop(t + 1.6)
    }
  }

  function next() {
    const q = QUALITIES[Math.floor(Math.random() * QUALITIES.length)]
    const r = 57 + Math.floor(Math.random() * 8)
    setAnswer(q.id); setRoot(r); setGuess(null)
    playChord(r, q.semis)
  }
  function replay() { const q = QUALITIES.find(x => x.id === answer); if (q) playChord(root, q.semis) }
  function pick(id: string) {
    if (guess != null || answer == null) return
    setGuess(id)
    setScore(s => ({ right: s.right + (id === answer ? 1 : 0), total: s.total + 1 }))
  }

  return (
    <Frame caption={caption}>
      <GameBar started={answer != null} onNew={next} onReplay={replay} score={score} newLabel="New chord" />
      <ChoiceGrid choices={CHOICES} answered={guess != null} correctId={answer} guessId={guess} onPick={pick} cols={4} />
      {guess != null && answer != null && (
        <Verdict correct={guess === answer} answer={QUALITIES.find(q => q.id === answer)!.label} />
      )}
    </Frame>
  )
}
