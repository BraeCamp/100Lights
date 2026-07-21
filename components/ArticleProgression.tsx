'use client'

// Interactive chord-progression viewer for Learn articles. Shows the audio
// player, then a "See more" that expands (animated) into a digital piano
// lighting the keys of the active chord, a key/transpose selector, and a
// play button that steps the highlight through the progression in time.
//
// Data-driven by the recipe's real notes (passed inline in the @progression
// marker), so it's exact and needs no fetch. SEO note: the chord names and
// key render as real text and stay in the DOM even when collapsed.

import { useState, useRef, useEffect, useMemo } from 'react'
import { Play, Square, ChevronDown, Download } from 'lucide-react'
import { playMelodicNote } from '@/lib/instrument-synth'
import { KEY_NAMES, transposeChords, type Chord } from '@/lib/chord-analysis'
import { writeMidiFile } from '@/lib/midi-file'

export interface ProgressionData {
  chords: Chord[]
  audioUrl?: string
  caption?: string
  originalKey?: number   // pitch class the recipe was authored in (default C = 0)
}

let _ctx: AudioContext | null = null
const ctx = () => (_ctx ??= new AudioContext())

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)
// Octave number in the common "middle C = C4" convention (MIDI 60 → C4).
const octaveOf = (m: number) => Math.floor(m / 12) - 1
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (m: number) => `${PC_NAMES[((m % 12) + 12) % 12]}${octaveOf(m)}`

export default function ArticleProgression({ data, defaultOpen = false }: { data: ProgressionData; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [keyPc, setKeyPc] = useState(data.originalKey ?? 0)
  const [active, setActive] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [octave, setOctave] = useState(0)
  const [pressed, setPressed] = useState<Set<number>>(new Set())
  const stopRef = useRef<() => void>(() => {})

  const semis = (keyPc - (data.originalKey ?? 0)) + octave * 12
  const chords = useMemo(() => transposeChords(data.chords, semis), [data.chords, semis])

  useEffect(() => () => stopRef.current(), [])

  // Tap-to-play: click any key to hear that exact note
  function pressKey(midi: number) {
    const c = ctx()
    void c.resume()
    const g = c.createGain()
    g.gain.value = 0.85
    g.connect(c.destination)
    playMelodicNote(c, 'piano-grand', midi, c.currentTime + 0.01, 0.9, g)
    setTimeout(() => g.disconnect(), 1600)
    setPressed(prev => new Set(prev).add(midi))
    setTimeout(() => setPressed(prev => { const n = new Set(prev); n.delete(midi); return n }), 220)
  }

  // Range spans EVERY note so the piano doesn't resize between chords; only the
  // active chord's EXACT notes light (the specific C that plays, not all C's).
  const allNotes = chords.flatMap(c => c.pitches)
  const litNotes = new Set(chords[active ?? 0]?.pitches ?? [])
  // Octave headroom guards — keep the shifted notes on a real piano
  const canUp = Math.max(...allNotes) + 12 <= 100
  const canDown = Math.min(...allNotes) - 12 >= 24

  // The recipe's distinct notes → a real MIDI file, built client-side from the
  // CURRENTLY transposed chords, so the download matches the selected key. This
  // is the note data itself (which key/when/how long) — the format a pianist
  // actually wants, unlike a rendered audio recording.
  function downloadMidi() {
    const notes = chords.flatMap(ch => ch.pitches.map(p => ({ pitch: p, startBeat: ch.beat, durationBeats: ch.dur, velocity: 100 })))
    const name = `${(data.caption || 'progression').replace(/[^\w-]+/g, '-')}-${KEY_NAMES[keyPc]}`
    const blob = writeMidiFile(notes, 100, name)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${name}.mid`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  function playFrom(index: number, sequence: boolean) {
    stopRef.current()
    const c = ctx()
    void c.resume()
    const g = c.createGain()
    g.gain.value = 0.7
    g.connect(c.destination)
    const spb = 60 / 100
    const t0 = c.currentTime + 0.05
    const timers: number[] = []
    let clock = 0
    const list = sequence ? chords.slice(index) : [chords[index]]
    list.forEach((chord, i) => {
      const when = t0 + clock
      for (const p of chord.pitches) playMelodicNote(c, 'piano-grand', p, when, 0.9, g)
      const idx = index + i
      timers.push(window.setTimeout(() => setActive(idx), clock * 1000))
      clock += Math.max(0.5, chord.dur) * spb
    })
    setPlaying(true)
    const done = window.setTimeout(() => stopRef.current(), clock * 1000 + 400)
    stopRef.current = () => {
      timers.forEach(clearTimeout); clearTimeout(done)
      g.gain.setTargetAtTime(0, c.currentTime, 0.03)
      setTimeout(() => g.disconnect(), 250)
      setPlaying(false)
      stopRef.current = () => {}
    }
  }

  return (
    <figure style={{ margin: '24px 0' }}>
      {data.audioUrl && (
        <audio controls preload="none" src={data.audioUrl} style={{ width: '100%', height: 40, display: 'block' }} aria-label={data.caption || 'Chord progression'} />
      )}
      {/* Always in the DOM (crawlable): chord names + key */}
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
        {data.caption && <span style={{ fontWeight: 600 }}>{data.caption} · </span>}
        Chords: {chords.map(c => c.name).join(' – ')} <span style={{ color: 'var(--text-muted)' }}>(key of {KEY_NAMES[keyPc]})</span>
      </div>

      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 8,
          fontSize: 12, fontWeight: 700, padding: '5px 12px', borderRadius: 8,
          border: '1px solid var(--border)', background: 'var(--bg-card)', color: '#a78bfa', cursor: 'pointer',
        }}
      >
        <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
        {open ? 'Hide the piano' : 'See more — show it on a piano'}
      </button>

      {/* Animated expander. Kept in the DOM; the piano SVG only mounts once
          opened, so it stays lazy. */}
      <div
        style={{
          // Fixed generous ceiling (content is a fixed-height piano + wrapping
          // chips, always well under this) so the reveal animates without
          // reading layout during render
          maxHeight: open ? 900 : 0,
          overflow: 'hidden', transition: 'max-height 0.35s ease',
        }}
      >
        {open && (
          <div style={{ padding: '14px 2px 2px' }}>
            {/* Key selector */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginRight: 2 }}>KEY</span>
              {KEY_NAMES.map((k, pc) => (
                <button key={k} onClick={() => setKeyPc(pc)}
                  style={{
                    fontSize: 11, fontWeight: 700, minWidth: 26, padding: '3px 6px', borderRadius: 6, cursor: 'pointer',
                    border: pc === keyPc ? '1px solid #a78bfa' : '1px solid var(--border)',
                    background: pc === keyPc ? 'rgba(167,139,250,0.18)' : 'transparent',
                    color: pc === keyPc ? '#a78bfa' : 'var(--text-secondary)',
                  }}>{k}</button>
              ))}
              <span style={{ width: 1, height: 18, background: 'var(--border)', margin: '0 2px' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>OCT</span>
              <button onClick={() => setOctave(o => o - 1)} disabled={!canDown} aria-label="Octave down"
                style={{ fontSize: 13, fontWeight: 800, width: 26, padding: '2px 0', borderRadius: 6, cursor: canDown ? 'pointer' : 'default', border: '1px solid var(--border)', background: 'transparent', color: canDown ? 'var(--text-secondary)' : 'var(--text-muted)', opacity: canDown ? 1 : 0.4 }}>–</button>
              <button onClick={() => setOctave(o => o + 1)} disabled={!canUp} aria-label="Octave up"
                style={{ fontSize: 13, fontWeight: 800, width: 26, padding: '2px 0', borderRadius: 6, cursor: canUp ? 'pointer' : 'default', border: '1px solid var(--border)', background: 'transparent', color: canUp ? 'var(--text-secondary)' : 'var(--text-muted)', opacity: canUp ? 1 : 0.4 }}>+</button>
            </div>

            <Piano notes={allNotes} lit={litNotes} pressed={pressed} onPress={pressKey} />

            {/* Chord chips + play */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
              <button
                onClick={() => playing ? stopRef.current() : playFrom(0, true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700,
                  padding: '6px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                  background: playing ? 'var(--accent)' : 'rgba(167,139,250,0.18)', color: playing ? '#fff' : '#a78bfa',
                }}
              >
                {playing ? <Square size={12} fill="currentColor" /> : <Play size={13} />} {playing ? 'Stop' : 'Play chords'}
              </button>
              {chords.map((c, i) => (
                <button key={i}
                  onClick={() => { setActive(i); playFrom(i, false) }}
                  onMouseEnter={() => !playing && setActive(i)}
                  style={{
                    fontSize: 12, fontWeight: 700, padding: '5px 11px', borderRadius: 8, cursor: 'pointer',
                    border: active === i ? '1px solid #a78bfa' : '1px solid var(--border)',
                    background: active === i ? 'rgba(167,139,250,0.2)' : 'var(--bg-card)',
                    color: active === i ? '#a78bfa' : 'var(--text-primary)',
                  }}>{c.name}</button>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 }}>
              <button
                onClick={downloadMidi}
                style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                <Download size={12} /> Download MIDI ({KEY_NAMES[keyPc]})
              </button>
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>Open it in any DAW or notation app — it carries the exact notes, in the key you picked.</span>
            </div>
            <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 8 }}>
              Purple keys are the highlighted chord. <strong style={{ color: 'var(--text-secondary)' }}>Tap any key to play it.</strong> Change the KEY to transpose, or the octave with –/+.
            </p>
          </div>
        )}
      </div>
    </figure>
  )
}

function Piano({ notes, lit, pressed, onPress }: {
  notes: number[]; lit: Set<number>; pressed: Set<number>; onPress: (midi: number) => void
}) {
  // Whole-octave window that comfortably contains the progression's notes
  const lo = Math.floor(Math.min(...notes) / 12) * 12
  const hi = (Math.floor(Math.max(...notes) / 12) + 1) * 12   // exclusive
  const keys = Array.from({ length: hi - lo }, (_, i) => lo + i)
  const whites = keys.filter(m => !isBlack(m))
  const W = 30, H = 108, BW = 18, BH = 66
  const width = whites.length * W
  const whiteFill = (m: number) => pressed.has(m) ? '#34d399' : lit.has(m) ? '#a78bfa' : '#f4f4f8'
  const blackFill = (m: number) => pressed.has(m) ? '#10b981' : lit.has(m) ? '#7c3aed' : '#1a1a22'
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-base)', padding: 8 }}>
      <svg viewBox={`0 0 ${width} ${H}`} width={width} height={H} style={{ display: 'block', maxWidth: '100%', minWidth: Math.min(width, 320), touchAction: 'manipulation' }} role="group" aria-label="Interactive piano — tap keys to play">
        {whites.map((m, i) => (
          <g key={m}>
            <rect x={i * W} y={0} width={W - 1} height={H} rx={3} fill={whiteFill(m)} stroke="#3a3a44" strokeWidth={0.5}
              style={{ cursor: 'pointer' }} onPointerDown={e => { e.preventDefault(); onPress(m) }}>
              <title>{noteName(m)}</title>
            </rect>
            {m % 12 === 0 && (
              <text x={i * W + (W - 1) / 2} y={H - 6} textAnchor="middle" fontSize={8} fill={lit.has(m) || pressed.has(m) ? '#2a1a4a' : '#8a8a9a'} fontWeight={700} style={{ pointerEvents: 'none' }}>C{octaveOf(m)}</text>
            )}
          </g>
        ))}
        {keys.filter(isBlack).map(m => {
          const whiteIndex = whites.filter(w => w < m).length
          return <rect key={m} x={whiteIndex * W - BW / 2} y={0} width={BW} height={BH} rx={2}
            fill={blackFill(m)} stroke="#000" strokeWidth={0.5}
            style={{ cursor: 'pointer' }} onPointerDown={e => { e.preventDefault(); onPress(m) }} />
        })}
      </svg>
    </div>
  )
}
