'use client'

// Hold a chord, get a riff. The three notes of a C-major triad are played one at
// a time in the chosen order and speed, optionally across octaves — an arpeggiator,
// the engine behind a huge amount of electronic music. Watch the notes light up.

import { useEffect, useRef, useState } from 'react'
import { ACCENT, mixCtx, Frame, Transport, Control, rangeStyle, StudioButton, SaveButton } from './article/mix-kit'
import { useSharedTempo, useSharedRoot } from './article/article-state'
import { openMidiInStudio } from '@/lib/open-in-studio'
import { saveRecipe } from '@/lib/article-save'

const TRIAD = [60, 64, 67]   // C E G (root position, transposed by the shared key)
const NAMES: Record<number, string> = { 0: 'C', 1: 'C#', 2: 'D', 3: 'D#', 4: 'E', 5: 'F', 6: 'F#', 7: 'G', 8: 'G#', 9: 'A', 10: 'A#', 11: 'B' }
const noteName = (m: number) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

type Pattern = 'up' | 'down' | 'updown' | 'random'
const RATES = [{ label: '1/8', spb: 2 }, { label: '1/8T', spb: 3 }, { label: '1/16', spb: 4 }, { label: '1/16T', spb: 6 }]

function buildSeq(pattern: Pattern, octaves: number, root: number): number[] {
  let notes: number[] = []
  for (let o = 0; o < octaves; o++) notes.push(...TRIAD.map(n => n + o * 12 + root))
  if (pattern === 'down') notes = notes.slice().reverse()
  else if (pattern === 'updown' && notes.length > 2) notes = [...notes, ...notes.slice(1, -1).reverse()]
  return notes
}

export default function ArticleArp({ caption }: { caption?: string }) {
  const BPM = useSharedTempo(120)
  const rootOff = useSharedRoot(0)
  const [pattern, setPattern] = useState<Pattern>('up')
  const [rateIdx, setRateIdx] = useState(2)   // 1/16
  const [octaves, setOctaves] = useState(2)
  const [playing, setPlaying] = useState(false)
  const [active, setActive] = useState(-1)

  const outRef = useRef<GainNode | null>(null)
  const timerRef = useRef<number | null>(null)
  const p = useRef({ pattern, rateIdx, octaves, bpm: BPM, root: rootOff })
  p.current = { pattern, rateIdx, octaves, bpm: BPM, root: rootOff }

  useEffect(() => {
    const c = mixCtx()
    const out = c.createGain(); out.gain.value = 0.7; out.connect(c.destination)
    outRef.current = out
    return () => { out.disconnect() }
  }, [])

  function pluck(freq: number, t: number) {
    const c = mixCtx(), out = outRef.current!
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 2600; f.Q.value = 2
    const g = c.createGain()
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
    o.connect(f); f.connect(g); g.connect(out); o.start(t); o.stop(t + 0.24)
  }

  function start() {
    const c = mixCtx(); void c.resume()
    if (!outRef.current) return
    let i = 0
    let next = c.currentTime + 0.12
    setPlaying(true)
    timerRef.current = window.setInterval(() => {
      const now = c.currentTime
      while (next < now + 0.14) {
        const { pattern: pat, rateIdx: ri, octaves: oc, bpm, root } = p.current
        const seq = buildSeq(pat, oc, root)
        const idx = pat === 'random' ? Math.floor(Math.random() * seq.length) : i % seq.length
        const note = seq[idx]
        pluck(mtof(note), next)
        const t = next, showIdx = idx
        window.setTimeout(() => setActive(showIdx), Math.max(0, (t - c.currentTime + (c.outputLatency || 0)) * 1000))
        i++
        next += 60 / bpm / RATES[ri].spb
      }
    }, 25)
  }
  function stop() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    setPlaying(false); setActive(-1)
  }
  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const seq = buildSeq(pattern, octaves, rootOff)
  const arpNotes = () => {
    const s = buildSeq(pattern, octaves, rootOff)
    const stepBeats = 1 / RATES[rateIdx].spb
    return Array.from({ length: 32 }, (_, i) => ({
      id: '', pitch: s[i % s.length], startBeat: i * stepBeats, durationBeats: stepBeats * 0.9, velocity: 90,
    }))
  }

  return (
    <Frame caption={caption}>
      <Transport ready playing={playing} onPlay={start} onStop={stop} playLabel="Play the arp"
        onReset={() => { setPattern('up'); setRateIdx(2); setOctaves(2) }} />

      {/* Note sequence — lights up as it plays */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 14, minHeight: 30 }}>
        {seq.map((n, i) => (
          <span key={i} style={{
            fontSize: 11, fontWeight: 700, fontVariantNumeric: 'tabular-nums', padding: '5px 9px', borderRadius: 6,
            border: `1px solid ${active === i ? ACCENT : 'var(--border)'}`,
            background: active === i ? ACCENT : 'var(--bg-card)', color: active === i ? '#fff' : 'var(--text-secondary)',
            transition: 'background 60ms, color 60ms, border-color 60ms',
          }}>{noteName(n)}</span>
        ))}
      </div>

      <Control label="Pattern" value={pattern === 'updown' ? 'Up-Down' : pattern[0].toUpperCase() + pattern.slice(1)}>
        <div style={{ display: 'flex', gap: 6 }}>
          {(['up', 'down', 'updown', 'random'] as Pattern[]).map(pt => (
            <button key={pt} onClick={() => setPattern(pt)} style={{
              flex: 1, fontSize: 10.5, fontWeight: 700, padding: '6px 0', borderRadius: 7, cursor: 'pointer',
              border: `1px solid ${pattern === pt ? ACCENT : 'var(--border)'}`,
              background: pattern === pt ? 'rgba(167,139,250,0.18)' : 'var(--bg-card)', color: pattern === pt ? ACCENT : 'var(--text-secondary)',
            }}>{pt === 'updown' ? 'Up-Down' : pt[0].toUpperCase() + pt.slice(1)}</button>
          ))}
        </div>
      </Control>
      <Control label="Rate" value={RATES[rateIdx].label}>
        <input type="range" min={0} max={RATES.length - 1} step={1} value={rateIdx} onChange={e => setRateIdx(+e.target.value)} style={rangeStyle} aria-label="Rate" />
      </Control>
      <Control label="Octaves" value={`${octaves}`}>
        <input type="range" min={1} max={3} step={1} value={octaves} onChange={e => setOctaves(+e.target.value)} style={rangeStyle} aria-label="Octaves" />
      </Control>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <StudioButton label="Open in studio" onClick={() => openMidiInStudio(arpNotes(), { tempo: BPM, name: 'Arp' })} />
        <SaveButton onSave={() => saveRecipe(arpNotes(), { title: 'Arp', tagline: 'Arpeggio from a lesson' })} />
      </div>

      <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 12, lineHeight: 1.65 }}>
        Same three notes every time — the <strong style={{ color: 'var(--text-secondary)' }}>pattern</strong> is just the order they&rsquo;re played in, the <strong style={{ color: 'var(--text-secondary)' }}>rate</strong> is how fast, and <strong style={{ color: 'var(--text-secondary)' }}>octaves</strong> stacks copies higher up for range. Hold a chord, let the arp move it, and a static shape becomes a running line.
      </p>
    </Frame>
  )
}
