'use client'

// Interactive "practice bench" for Learn articles about writing melodies.
//
// The article's @progression widgets stay on top and SHOW how a progression
// works (read-only, transposable). This is the hands-on twin: a button that
// slides a bench up from the bottom of the screen — deliberately a PARTIAL
// sheet, so the MIDI viewer above stays visible while you try the advice —
// where you build your own note/chord progression step by step and play it
// back. It reuses the viewer's exact piano look (purple lit keys, the same
// key rects and colors) so a reader who just watched the viewer already knows
// how to drive this.
//
// Nothing here fetches or persists — it's a scratchpad. The one export is the
// finished note data as a MIDI download, so a good idea can leave the article
// and land in the actual DAW.

import { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Play, Square, Download, X, Eraser, Music2 } from 'lucide-react'
import { playMelodicNote } from '@/lib/instrument-synth'
import { KEY_NAMES } from '@/lib/chord-analysis'
import { writeMidiFile } from '@/lib/midi-file'

let _ctx: AudioContext | null = null
const ctx = () => (_ctx ??= new AudioContext())

const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12)
const octaveOf = (m: number) => Math.floor(m / 12) - 1
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const noteName = (m: number) => `${PC_NAMES[((m % 12) + 12) % 12]}${octaveOf(m)}`

// Fixed 3-octave window (C3–B5) so the keyboard never resizes as you edit and
// every diatonic triad in any key fits on screen.
const LO = 48
const HI = 84 // exclusive
const INITIAL_STEPS = 8
const MIN_STEPS = 1
const MAX_STEPS = 16
const MIN_BPM = 40
const MAX_BPM = 220

// Major scale, laid out across three octaves so a triad is just three tones
// two scale-steps apart (degree, degree+2, degree+4).
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const SCALE_TONES: number[] = []
for (let o = 0; o < 3; o++) for (const s of MAJOR) SCALE_TONES.push(s + o * 12)
// Diatonic triad qualities in a major key (I ii iii IV V vi vii°).
const QUALITY = ['', 'm', 'm', '', '', 'm', '°']
const ROMAN = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']

/** The three MIDI notes of the `degree`-th diatonic triad in `keyPc`, voiced
 *  from the low C of the keyboard so it always lands in range. */
function diatonicTriad(keyPc: number, degree: number): number[] {
  const base = LO + keyPc
  return [SCALE_TONES[degree], SCALE_TONES[degree + 2], SCALE_TONES[degree + 4]].map(t => base + t)
}
function triadName(keyPc: number, degree: number): string {
  return PC_NAMES[(keyPc + MAJOR[degree]) % 12] + QUALITY[degree]
}

export default function ArticlePracticeBuilder({ label }: { label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ margin: '20px 0' }}>
      <button
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700,
          padding: '9px 16px', borderRadius: 10, cursor: 'pointer',
          border: '1px solid #a78bfa', background: 'rgba(167,139,250,0.14)', color: '#a78bfa',
        }}
      >
        <Music2 size={15} /> {label || 'Try it yourself — build a progression'}
      </button>
      {open && <Bench onClose={() => setOpen(false)} />}
    </div>
  )
}

function Bench({ onClose }: { onClose: () => void }) {
  const [keyPc, setKeyPc] = useState(0)
  const [bpm, setBpm] = useState(100)
  // Each step holds a set of MIDI notes (a chord, a single note, or empty).
  const [steps, setSteps] = useState<number[][]>(() => Array.from({ length: INITIAL_STEPS }, () => []))
  const [editStep, setEditStep] = useState(0)
  const [playStep, setPlayStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const [pressed, setPressed] = useState<Set<number>>(new Set())
  const stopRef = useRef<() => void>(() => {})
  // Mirror of editStep read by tap handlers, so two fast taps (before React
  // re-renders) still land on consecutive steps instead of colliding on one.
  const stepRef = useRef(0)
  const setEdit = (i: number) => { stepRef.current = i; setEditStep(i) }

  useEffect(() => () => stopRef.current(), [])
  // Slide-up on mount.
  const [shown, setShown] = useState(false)
  useEffect(() => { const t = window.setTimeout(() => setShown(true), 10); return () => window.clearTimeout(t) }, [])

  const lit = useMemo(() => new Set(steps[editStep] ?? []), [steps, editStep])
  const hasNotes = steps.some(s => s.length)

  function audition(midi: number) {
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

  // Tap a key: toggle it in the current step, and play it so you hear the edit.
  function toggleKey(midi: number) {
    audition(midi)
    const cur = stepRef.current
    setSteps(prev => {
      const next = prev.map(s => s.slice())
      const s = next[cur]
      const i = s.indexOf(midi)
      if (i >= 0) s.splice(i, 1)
      else s.push(midi)
      return next
    })
  }

  // Tap a chord: drop the whole triad on the current step, sound it, and walk
  // to the next step so laying down I–V–vi–IV is four quick taps.
  function placeChord(degree: number) {
    const triad = diatonicTriad(keyPc, degree)
    const cur = stepRef.current
    setSteps(prev => { const next = prev.map(s => s.slice()); next[cur] = triad; return next })
    const c = ctx()
    void c.resume()
    const g = c.createGain()
    g.gain.value = 0.7
    g.connect(c.destination)
    for (const p of triad) playMelodicNote(c, 'piano-grand', p, c.currentTime + 0.01, 0.9, g)
    setTimeout(() => g.disconnect(), 1600)
    setPressed(new Set(triad))
    setTimeout(() => setPressed(new Set()), 240)
    setEdit(Math.min(steps.length - 1, cur + 1))
  }

  function clearStep() {
    const cur = stepRef.current
    setSteps(prev => { const next = prev.map(s => s.slice()); next[cur] = []; return next })
  }
  function clearAll() {
    setSteps(prev => Array.from({ length: prev.length }, () => []))
    setEdit(0)
  }

  // Add a step at the end; remove the current step (keeping at least one).
  function addStep() {
    setSteps(prev => prev.length >= MAX_STEPS ? prev : [...prev, []])
  }
  function removeStep() {
    setSteps(prev => {
      if (prev.length <= MIN_STEPS) return prev
      const cur = stepRef.current
      const next = prev.filter((_, i) => i !== cur)
      setEdit(Math.min(cur, next.length - 1))
      return next
    })
  }

  // Shift the current step's notes by an octave, but only while every note
  // stays on the visible keyboard (so a shifted note is never invisible).
  function shiftOctave(dir: 1 | -1) {
    const cur = stepRef.current
    setSteps(prev => {
      const s = prev[cur]
      if (!s.length) return prev
      const shifted = s.map(n => n + dir * 12)
      if (Math.min(...shifted) < LO || Math.max(...shifted) >= HI) return prev
      const next = prev.map(x => x.slice())
      next[cur] = shifted
      return next
    })
  }

  function play() {
    stopRef.current()
    const c = ctx()
    void c.resume()
    const g = c.createGain()
    g.gain.value = 0.7
    g.connect(c.destination)
    const spb = 60 / bpm
    const t0 = c.currentTime + 0.06
    const timers: number[] = []
    steps.forEach((notes, i) => {
      const when = t0 + i * spb
      for (const p of notes) playMelodicNote(c, 'piano-grand', p, when, 0.9, g)
      timers.push(window.setTimeout(() => setPlayStep(i), i * spb * 1000))
    })
    setPlaying(true)
    const done = window.setTimeout(() => stopRef.current(), steps.length * spb * 1000 + 400)
    stopRef.current = () => {
      timers.forEach(clearTimeout); clearTimeout(done)
      g.gain.setTargetAtTime(0, c.currentTime, 0.03)
      setTimeout(() => g.disconnect(), 250)
      setPlaying(false); setPlayStep(null)
      stopRef.current = () => {}
    }
  }

  function downloadMidi() {
    const notes = steps.flatMap((s, i) => s.map(p => ({ pitch: p, startBeat: i, durationBeats: 1, velocity: 100 })))
    if (!notes.length) return
    const name = `my-progression-${KEY_NAMES[keyPc]}`
    const blob = writeMidiFile(notes, bpm, name)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${name}.mid`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  // Portal to <body>: the article wraps each widget in a `content-visibility`
  // container, which is a containing block for position:fixed — rendering here
  // would pin the sheet to the widget, not the viewport. The portal escapes it.
  return createPortal(
    <>
      {/* Transparent catcher — closes on tap-away WITHOUT dimming the article,
          so the progression viewer above stays readable while you practice. */}
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'transparent' }} />
      <div
        role="dialog"
        aria-label="Progression practice bench"
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 61,
          transform: shown ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.28s cubic-bezier(0.2,0.8,0.2,1)',
          maxHeight: '78vh', overflowY: 'auto',
          background: 'var(--bg-card, #14141b)', borderTop: '1px solid var(--border)',
          borderTopLeftRadius: 16, borderTopRightRadius: 16,
          boxShadow: '0 -12px 40px rgba(0,0,0,0.45)',
          padding: '10px 14px 20px',
        }}
      >
        {/* grab handle + header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Music2 size={15} color="#a78bfa" />
            <span style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--text-primary)' }}>Build a progression</span>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ display: 'flex', padding: 6, borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', cursor: 'pointer' }}><X size={16} /></button>
        </div>

        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {/* Key selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', margin: '12px 0 10px' }}>
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
          </div>

          {/* Chord shortcuts — the seven diatonic triads of the chosen key */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginRight: 2 }}>CHORDS</span>
            {ROMAN.map((r, d) => (
              <button key={r} onClick={() => placeChord(d)}
                title={`Drop ${triadName(keyPc, d)} on step ${editStep + 1}`}
                style={{
                  display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.1,
                  fontWeight: 700, padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
                  border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-primary)',
                }}>
                <span style={{ fontSize: 13 }}>{triadName(keyPc, d)}</span>
                <span style={{ fontSize: 9, color: 'var(--text-muted)', fontWeight: 600 }}>{r}</span>
              </button>
            ))}
          </div>

          {/* Tempo + step-count controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>TEMPO</span>
              <input type="range" min={MIN_BPM} max={MAX_BPM} value={bpm} onChange={e => setBpm(Number(e.target.value))}
                aria-label="Tempo (BPM)" style={{ width: 120, accentColor: '#a78bfa', cursor: 'pointer' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', minWidth: 58 }}>{bpm} BPM</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)' }}>STEPS</span>
              <button onClick={removeStep} disabled={steps.length <= MIN_STEPS} aria-label="Remove step"
                style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: steps.length <= MIN_STEPS ? 'default' : 'pointer', opacity: steps.length <= MIN_STEPS ? 0.4 : 1, fontSize: 15, lineHeight: 1 }}>−</button>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', minWidth: 18, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{steps.length}</span>
              <button onClick={addStep} disabled={steps.length >= MAX_STEPS} aria-label="Add step"
                style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: steps.length >= MAX_STEPS ? 'default' : 'pointer', opacity: steps.length >= MAX_STEPS ? 0.4 : 1, fontSize: 15, lineHeight: 1 }}>+</button>
            </div>
          </div>

          {/* Step timeline — the progression you're building */}
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))`, gap: 5, marginBottom: 12 }}>
            {steps.map((notes, i) => {
              const isEdit = i === editStep
              const isPlay = i === playStep
              return (
                <button key={i} onClick={() => setEdit(i)}
                  style={{
                    minHeight: 52, padding: '5px 3px', borderRadius: 8, cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1,
                    border: isEdit ? '1.5px solid #a78bfa' : '1px solid var(--border)',
                    background: isPlay ? 'rgba(167,139,250,0.34)' : isEdit ? 'rgba(167,139,250,0.12)' : 'var(--bg-base)',
                    transition: 'background 0.08s',
                  }}>
                  {notes.length === 0
                    ? <span style={{ fontSize: 16, color: 'var(--text-muted)', opacity: 0.5 }}>·</span>
                    : notes.slice().sort((a, b) => a - b).slice(0, 3).map(n => (
                      <span key={n} style={{ fontSize: 9.5, fontWeight: 700, color: isPlay ? '#fff' : '#a78bfa' }}>{noteName(n)}</span>
                    ))}
                  <span style={{ fontSize: 8, color: 'var(--text-muted)', marginTop: 2, fontWeight: 700 }}>{i + 1}</span>
                </button>
              )
            })}
          </div>

          {/* Piano — same look as the viewer; taps toggle notes on the current step */}
          <BenchPiano lit={lit} pressed={pressed} onPress={toggleKey} />

          {/* Transport + edit controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <button onClick={() => playing ? stopRef.current() : play()}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 700,
                padding: '8px 16px', borderRadius: 9, border: 'none', cursor: 'pointer',
                background: playing ? 'var(--accent)' : 'rgba(167,139,250,0.18)', color: playing ? '#fff' : '#a78bfa',
              }}>
              {playing ? <Square size={12} fill="currentColor" /> : <Play size={13} />} {playing ? 'Stop' : 'Play'}
            </button>
            {/* Octave shift for the current step */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, border: '1px solid var(--border)', borderRadius: 9, padding: '3px 4px 3px 8px', background: 'var(--bg-base)' }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--text-muted)' }}>OCT</span>
              <button onClick={() => shiftOctave(-1)} disabled={!steps[editStep]?.length} title={`Step ${editStep + 1} down an octave`} aria-label="Octave down"
                style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: steps[editStep]?.length ? 'pointer' : 'default', opacity: steps[editStep]?.length ? 1 : 0.4, fontSize: 14, lineHeight: 1 }}>▽</button>
              <button onClick={() => shiftOctave(1)} disabled={!steps[editStep]?.length} title={`Step ${editStep + 1} up an octave`} aria-label="Octave up"
                style={{ width: 24, height: 24, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', cursor: steps[editStep]?.length ? 'pointer' : 'default', opacity: steps[editStep]?.length ? 1 : 0.4, fontSize: 14, lineHeight: 1 }}>△</button>
            </div>
            <button onClick={clearStep}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              <Eraser size={12} /> Clear step {editStep + 1}
            </button>
            <button onClick={clearAll}
              style={{ fontSize: 11.5, fontWeight: 700, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-base)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
              Clear all
            </button>
            <button onClick={downloadMidi} disabled={!hasNotes}
              style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, fontWeight: 700, padding: '7px 12px', borderRadius: 9, border: '1px solid var(--border)', background: 'var(--bg-base)', color: hasNotes ? 'var(--text-secondary)' : 'var(--text-muted)', cursor: hasNotes ? 'pointer' : 'default', opacity: hasNotes ? 1 : 0.5, marginLeft: 'auto' }}>
              <Download size={12} /> Download MIDI
            </button>
          </div>

          <p style={{ fontSize: 10.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
            Tap a <strong style={{ color: 'var(--text-secondary)' }}>chord</strong> to drop it on the highlighted step, or tap piano keys to place notes one at a time. Pick a step to edit it, nudge its <strong style={{ color: 'var(--text-secondary)' }}>octave</strong> up or down, add or remove steps, set the <strong style={{ color: 'var(--text-secondary)' }}>tempo</strong>, then hit Play. Try <strong style={{ color: 'var(--text-secondary)' }}>I – V – vi – IV</strong> to start.
          </p>
        </div>
      </div>
    </>,
    document.body,
  )
}

function BenchPiano({ lit, pressed, onPress }: {
  lit: Set<number>; pressed: Set<number>; onPress: (midi: number) => void
}) {
  const keys = Array.from({ length: HI - LO }, (_, i) => LO + i)
  const whites = keys.filter(m => !isBlack(m))
  const W = 30, H = 108, BW = 18, BH = 66
  const width = whites.length * W
  const whiteFill = (m: number) => pressed.has(m) ? '#34d399' : lit.has(m) ? '#a78bfa' : '#f4f4f8'
  const blackFill = (m: number) => pressed.has(m) ? '#10b981' : lit.has(m) ? '#7c3aed' : '#1a1a22'
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-base)', padding: 8 }}>
      <svg viewBox={`0 0 ${width} ${H}`} width={width} height={H} style={{ display: 'block', maxWidth: '100%', minWidth: Math.min(width, 320), touchAction: 'manipulation' }} role="group" aria-label="Interactive piano — tap keys to place notes">
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
