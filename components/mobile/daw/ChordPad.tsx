'use client'

// Beginner "chord strips": tap a diatonic chord and it plays + drops into the
// selected melodic track's clip, one bar at a time — build a progression with
// no theory and no wrong notes. Writes real MIDI, so the piano roll can refine it.

import { useEffect, useMemo, useState } from 'react'
import { useDaw, makeMidiClip } from '@/lib/daw-state'
import { isMidiClip } from '@/lib/daw-types'
import { previewNote } from '@/lib/daw-instruments'
import { SCALE_INTERVALS, ROOT_NOTES, type ScaleType } from '@/lib/scale-constants'

const uid = () => crypto.randomUUID()
const BASE = 48 // C3

// Diatonic triad (root/third/fifth stacked in scale-thirds) for a scale degree.
function triad(key: number, scale: string, degree: number): number[] {
  const iv = SCALE_INTERVALS[(scale as ScaleType)] ?? SCALE_INTERVALS.major
  const n = iv.length
  const pc = (i: number) => iv[i % n] + 12 * Math.floor(i / n)
  return [degree, degree + 2, degree + 4].map(i => BASE + key + pc(i))
}

function chordName(pitches: number[]): string {
  const [r, t, f] = pitches
  const third = ((t - r) % 12 + 12) % 12
  const fifth = ((f - r) % 12 + 12) % 12
  const q = third === 3 && fifth === 6 ? '°' : third === 3 ? 'm' : third === 4 && fifth === 8 ? '+' : ''
  return ROOT_NOTES[((r % 12) + 12) % 12] + q
}

export default function ChordPad({ trackId }: { trackId: string }) {
  const { project, dispatch, engine, expandedPianoRollClipId } = useDaw()
  const track = project.tracks.find(t => t.id === trackId)
  const [writeBar, setWriteBar] = useState(0)
  const barBeats = project.timeSignatureNum || 4

  // Target = the clip open in the roll, else this track's first melodic clip.
  const clip = useMemo(() => {
    const clips = project.arrangementClips.filter(isMidiClip)
    return clips.find(c => c.id === expandedPianoRollClipId)
      ?? clips.find(c => c.trackId === trackId && !c.isDrumClip)
  }, [project.arrangementClips, trackId, expandedPianoRollClipId])

  // Make a 4-bar clip to hold chords if the track has none yet.
  useEffect(() => {
    if (!track || track.instrument.type === 'drum') return
    if (!clip) dispatch({ type: 'ADD_CLIP', clip: makeMidiClip(trackId, 'Chords', 0, barBeats * 4) })
  }, [clip, track, trackId, barBeats, dispatch])

  if (!track || track.instrument.type === 'drum') {
    return <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Chords need a melodic track — pick Drums&apos; neighbour (Bass, Keys…) above.</div>
  }

  const bars = clip ? Math.max(1, Math.round(clip.durationBeats / barBeats)) : 4
  const degrees = Array.from({ length: Math.min(7, SCALE_INTERVALS[(project.scale as ScaleType)]?.length ?? 7) }, (_, i) => i)
  const chords = degrees.map(d => triad(project.key, project.scale, d))

  function play(pitches: number[]) {
    for (const p of pitches) { try { previewNote(engine.ctx, engine.masterGain, track!.instrument, p) } catch { /* ok */ } }
  }
  function place(pitches: number[]) {
    play(pitches)
    if (!clip) return
    const start = writeBar * barBeats, end = start + barBeats
    const kept = clip.notes.filter(nt => nt.startBeat < start - 1e-6 || nt.startBeat >= end - 1e-6)
    const added = pitches.map(p => ({ id: uid(), pitch: p, startBeat: start, durationBeats: barBeats, velocity: 78 }))
    dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: [...kept, ...added] } })
    setWriteBar(b => (b + 1) % bars)
  }

  const btn: React.CSSProperties = { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, padding: '18px 6px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-primary)', cursor: 'pointer' }

  return (
    <div style={{ padding: '12px 14px 22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>Tap a chord — it plays and drops into bar</span>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: 'var(--accent-light)', background: 'rgba(139,92,246,0.14)', borderRadius: 7, padding: '2px 8px' }}>{writeBar + 1}/{bars}</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(4, chords.length)}, 1fr)`, gap: 9 }}>
        {chords.map((c, i) => (
          <button key={i} onPointerDown={() => place(c)} style={btn}>
            <span style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em' }}>{chordName(c)}</span>
            <span style={{ fontSize: 9.5, color: 'var(--text-muted)' }}>{['I','II','III','IV','V','VI','VII'][i]}</span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button onClick={() => { setWriteBar(0); if (clip) dispatch({ type: 'UPDATE_CLIP', clipId: clip.id, patch: { notes: [] } }) }}
          style={{ flex: 1, padding: '11px 0', borderRadius: 10, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Clear chords</button>
        <button onClick={() => setWriteBar(b => (b + 1) % bars)}
          style={{ padding: '11px 16px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Skip bar →</button>
      </div>
      <p style={{ fontSize: 11.5, color: 'var(--text-muted)', margin: '12px 0 0' }}>Chords are locked to <b style={{ color: 'var(--text-secondary)' }}>{ROOT_NOTES[project.key]} {project.scale}</b> (change it in transport ⚙). Refine anything in the piano roll.</p>
    </div>
  )
}
