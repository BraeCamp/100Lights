'use client'

// Firefly — the voice-first sketchpad. Sing a melody, add a beat, then open the sketch in the
// full 100Lights studio to finish it. It COMPOSES the existing tuned surfaces rather than
// forking them: <VoiceMidi> (the sing→instrument engine) is the hero input and <BeatMaker> the
// beat, each surfacing its result via a callback. "Open in 100Lights" folds both into a real,
// editable two-track project (openSketchInStudio). Supersedes the old standalone Flutter app.
import { useCallback, useMemo, useState } from 'react'
import VoiceMidi, { type RecNote } from '@/components/apps/VoiceMidi'
import BeatMaker from '@/components/apps/BeatMaker'
import { openSketchInStudio } from '@/lib/open-in-studio'
import type { MidiNote } from '@/lib/daw-types'

export default function Firefly() {
  const [melody, setMelody] = useState<RecNote[]>([])
  const [bpm, setBpm] = useState(100)
  const [beat, setBeat] = useState<MidiNote[]>([])

  const onNotes = useCallback((notes: RecNote[], tempo: number) => { setMelody(notes); setBpm(tempo) }, [])
  const onPattern = useCallback((notes: MidiNote[]) => setBeat(notes), [])

  const beatHits = beat.length
  const hasContent = melody.length > 0 || beatHits > 0

  // Convert the voice take (SECONDS) to beat-based MidiNotes at the take tempo, then hand both
  // tracks to the studio. Drum notes are already beat-based (16th grid), tempo-agnostic.
  const openInStudio = useCallback(() => {
    const melodyMidi: MidiNote[] = melody.map(m => ({
      id: crypto.randomUUID(),
      pitch: m.midi,
      startBeat: (m.startSec * bpm) / 60,
      durationBeats: Math.max(0.0625, (m.durSec * bpm) / 60),
      velocity: m.velocity <= 1 ? Math.max(1, Math.round(m.velocity * 127)) : Math.round(m.velocity),
    }))
    openSketchInStudio(melodyMidi, beat, { tempo: bpm, name: 'Firefly sketch' })
  }, [melody, beat, bpm])

  const summary = useMemo(() => {
    const parts: string[] = []
    if (melody.length) parts.push(`${melody.length} note${melody.length === 1 ? '' : 's'}`)
    if (beatHits) parts.push(`${beatHits} drum hit${beatHits === 1 ? '' : 's'}`)
    return parts.join(' · ')
  }, [melody.length, beatHits])

  const step = (n: string, label: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '0 0 12px' }}>
      <span style={{ display: 'grid', placeItems: 'center', width: 24, height: 24, borderRadius: 999, background: 'var(--accent)', color: '#0e0d12', fontSize: 13, fontWeight: 800 }}>{n}</span>
      <h2 style={{ fontSize: 17, fontWeight: 750, color: 'var(--text-primary)', margin: 0, letterSpacing: '-0.01em' }}>{label}</h2>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-base)', paddingBottom: 88 }}>
      <main id="main" className="max-w-2xl mx-auto px-6 py-12">
        <header style={{ marginBottom: 28 }}>
          <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent)', margin: '0 0 10px' }}>
            100Lights · Firefly
          </p>
          <h1 style={{ fontSize: 34, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 12px', letterSpacing: '-0.02em' }}>
            Sketch a song with your voice
          </h1>
          <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.65, margin: 0, maxWidth: '54ch' }}>
            Hum a melody and it becomes playable notes, add a beat underneath, then open the whole
            sketch in the 100Lights studio to finish it. Catch the idea now, produce it later.
          </p>
        </header>

        <section style={{ marginBottom: 36 }}>
          {step('1', 'Sing your melody')}
          <VoiceMidi onNotes={onNotes} />
        </section>

        <section>
          {step('2', 'Add a beat')}
          <BeatMaker onPattern={onPattern} />
        </section>
      </main>

      {/* Sticky action bar — the Firefly payoff: carry the sketch into the real studio. */}
      <div
        style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
          borderTop: '1px solid var(--border)', background: 'var(--bg-card)',
          backdropFilter: 'blur(8px)', padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--text-secondary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {hasContent ? `Sketch: ${summary}` : 'Sing a melody or tap a beat to start'}
        </span>
        <button
          type="button"
          onClick={openInStudio}
          disabled={!hasContent}
          style={{
            flexShrink: 0, padding: '10px 18px', borderRadius: 10, border: 'none',
            fontSize: 14, fontWeight: 750, cursor: hasContent ? 'pointer' : 'not-allowed',
            background: hasContent ? 'var(--accent)' : 'var(--border)',
            color: hasContent ? '#0e0d12' : 'var(--text-muted, var(--text-secondary))',
            transition: 'background 120ms',
          }}
        >
          Open in 100Lights →
        </button>
      </div>
    </div>
  )
}
