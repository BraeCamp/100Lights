'use client'

// See and hear a chord move. Pick a quality and an inversion; the notes light up
// on the keyboard and play as a block. Inversions are the same chord with a
// different note on the bottom — the trick behind smooth voice-leading.

import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import { ACCENT, mixCtx, Frame, StudioButton } from './article/mix-kit'
import { useSharedRoot } from './article/article-state'
import { openMidiInStudio } from '@/lib/open-in-studio'

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const QUALITIES: Record<string, number[]> = {
  Major: [0, 4, 7], Minor: [0, 3, 7], Maj7: [0, 4, 7, 11], Min7: [0, 3, 7, 10], Dom7: [0, 4, 7, 10],
}
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function invert(notes: number[], n: number): number[] {
  let out = [...notes]
  for (let i = 0; i < n; i++) out = [...out.slice(1), out[0] + 12]
  return out
}

// 2-octave keyboard geometry from C4.
const WHITE_SEMI = [0, 2, 4, 5, 7, 9, 11]
const BLACK_SEMI = [1, 3, 6, 8, 10]

export default function ArticleVoicing({ caption }: { caption?: string }) {
  const ROOT = 60 + useSharedRoot(0)   // C4, shifted by the shared key
  const [quality, setQuality] = useState('Major')
  const [inv, setInv] = useState(0)
  const chord = QUALITIES[quality]
  const maxInv = chord.length - 1
  const invNames = ['Root', '1st', '2nd', '3rd']
  const notes = invert(chord.map(s => ROOT + s), Math.min(inv, maxInv))

  function play() {
    const c = mixCtx(); void c.resume()
    const t = c.currentTime + 0.04
    notes.forEach((m, i) => {
      const o = c.createOscillator(); o.type = 'triangle'; o.frequency.value = mtof(m)
      const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = mtof(m) * 2
      const g = c.createGain(); g.gain.setValueAtTime(0.0001, t)
      g.gain.exponentialRampToValueAtTime(0.24, t + 0.01 + i * 0.005)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1)
      const g2 = c.createGain(); g2.gain.value = 0.1
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(c.destination)
      o.start(t); o.stop(t + 1.15); o2.start(t); o2.stop(t + 1.15)
    })
  }
  // Play whenever the chord/inversion changes (skip the very first mount).
  const first = useRef(true)
  useEffect(() => { if (first.current) { first.current = false; return } play() }, [quality, inv]) // eslint-disable-line react-hooks/exhaustive-deps

  const on = new Set(notes)
  const W = 336, H = 96, whiteW = W / 14, blackW = whiteW * 0.62

  return (
    <Frame caption={caption}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <button onClick={play} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, padding: '9px 18px', borderRadius: 10, border: 'none', cursor: 'pointer', background: ACCENT, color: '#fff' }}>
          <Play size={14} /> Play chord
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)' }}>
          {notes.map(m => NAMES[m % 12]).join(' – ')}
        </span>
      </div>

      {/* Keyboard */}
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} style={{ display: 'block', marginBottom: 14 }} aria-hidden="true">
        {Array.from({ length: 14 }, (_, i) => {
          const pitch = ROOT + Math.floor(i / 7) * 12 + WHITE_SEMI[i % 7]
          const active = on.has(pitch)
          return <rect key={i} x={i * whiteW} y={0} width={whiteW - 1} height={H} rx={3}
            fill={active ? ACCENT : 'var(--bg-card)'} stroke="var(--border)" strokeWidth={1} />
        })}
        {Array.from({ length: 14 }, (_, i) => {
          // Black keys sit after white indices 0,1,3,4,5 within each octave.
          const idxInOct = i % 7
          if (![0, 1, 3, 4, 5].includes(idxInOct)) return null
          const semi = BLACK_SEMI[[0, 1, 3, 4, 5].indexOf(idxInOct)]
          const pitch = ROOT + Math.floor(i / 7) * 12 + semi
          const active = on.has(pitch)
          const x = i * whiteW + whiteW - blackW / 2
          return <rect key={`b${i}`} x={x} y={0} width={blackW} height={H * 0.62} rx={2}
            fill={active ? ACCENT : '#181820'} stroke={active ? ACCENT : '#000'} strokeWidth={1} />
        })}
      </svg>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>QUALITY</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.keys(QUALITIES).map(q => (
            <button key={q} onClick={() => { setQuality(q); setInv(iv => Math.min(iv, QUALITIES[q].length - 1)) }} style={{
              flex: '1 1 0', fontSize: 11, fontWeight: 700, padding: '7px 0', borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${quality === q ? ACCENT : 'var(--border)'}`,
              background: quality === q ? 'rgba(167,139,250,0.18)' : 'var(--bg-card)', color: quality === q ? ACCENT : 'var(--text-secondary)',
            }}>{q}</button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 5 }}>INVERSION</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: maxInv + 1 }, (_, n) => (
            <button key={n} onClick={() => setInv(n)} style={{
              flex: 1, fontSize: 11, fontWeight: 700, padding: '7px 0', borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${inv === n ? ACCENT : 'var(--border)'}`,
              background: inv === n ? 'rgba(167,139,250,0.18)' : 'var(--bg-card)', color: inv === n ? ACCENT : 'var(--text-secondary)',
            }}>{invNames[n]}</button>
          ))}
        </div>
      </div>

      <StudioButton
        label="Open this chord in the studio"
        onClick={() => openMidiInStudio(
          notes.map(m => ({ id: '', pitch: m, startBeat: 0, durationBeats: 4, velocity: 90 })),
          { name: `${NAMES[notes[0] % 12]} ${quality}` },
        )}
      />

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        Every inversion is the <em>same chord</em> — same notes, different one on the bottom. Root position stacks them in order; an inversion lifts the lowest note up an octave. Choosing inversions so the notes barely move between chords is <strong style={{ color: 'var(--text-secondary)' }}>voice-leading</strong>, and it&rsquo;s what makes a progression sound smooth instead of jumpy.
      </p>
    </Frame>
  )
}
