'use client'

// A scale runs up; you name it. Major is happy, minor dark, Dorian minor-but-
// hopeful, Phrygian Spanish/menacing, Mixolydian bluesy-bright. You learn the
// flavours by ear, matching sound to name and keeping score.

import { useState } from 'react'
import { mixCtx, Frame } from './article/mix-kit'
import { GameBar, ChoiceGrid, Verdict, mtof, type Choice } from './article/challenge-kit'

const SCALES: { id: string; label: string; semis: number[] }[] = [
  { id: 'major', label: 'Major',      semis: [0, 2, 4, 5, 7, 9, 11, 12] },
  { id: 'minor', label: 'Minor',      semis: [0, 2, 3, 5, 7, 8, 10, 12] },
  { id: 'dor',   label: 'Dorian',     semis: [0, 2, 3, 5, 7, 9, 10, 12] },
  { id: 'phr',   label: 'Phrygian',   semis: [0, 1, 3, 5, 7, 8, 10, 12] },
  { id: 'mix',   label: 'Mixolydian', semis: [0, 2, 4, 5, 7, 9, 10, 12] },
  { id: 'harm',  label: 'Harm. minor',semis: [0, 2, 3, 5, 7, 8, 11, 12] },
]
const CHOICES: Choice[] = SCALES.map(s => ({ id: s.id, label: s.label }))

export default function ArticleScaleId({ caption }: { caption?: string }) {
  const [answer, setAnswer] = useState<string | null>(null)
  const [root, setRoot] = useState(60)
  const [guess, setGuess] = useState<string | null>(null)
  const [score, setScore] = useState({ right: 0, total: 0 })

  function playScale(r: number, semis: number[]) {
    const c = mixCtx(); void c.resume()
    let t = c.currentTime + 0.05
    for (const s of semis) {
      const f = mtof(r + s)
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = f
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
      o.connect(g); g.connect(c.destination)
      o.start(t); o.stop(t + 0.25)
      t += 0.16
    }
  }

  function next() {
    const sc = SCALES[Math.floor(Math.random() * SCALES.length)]
    const r = 57 + Math.floor(Math.random() * 6)
    setAnswer(sc.id); setRoot(r); setGuess(null)
    playScale(r, sc.semis)
  }
  function replay() { const sc = SCALES.find(x => x.id === answer); if (sc) playScale(root, sc.semis) }
  function pick(id: string) {
    if (guess != null || answer == null) return
    setGuess(id)
    setScore(s => ({ right: s.right + (id === answer ? 1 : 0), total: s.total + 1 }))
  }

  return (
    <Frame caption={caption}>
      <GameBar started={answer != null} onNew={next} onReplay={replay} score={score} newLabel="New scale" />
      <ChoiceGrid choices={CHOICES} answered={guess != null} correctId={answer} guessId={guess} onPick={pick} cols={3} />
      {guess != null && answer != null && (
        <Verdict correct={guess === answer} answer={SCALES.find(s => s.id === answer)!.label} />
      )}
    </Frame>
  )
}
