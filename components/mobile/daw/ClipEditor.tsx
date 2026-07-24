'use client'

// Clip editor: drum clips get a step grid, melodic clips get a step-style piano
// roll (real pitches). Both edit the clip's MIDI notes via ADD/REMOVE_MIDI_NOTE
// and audition the sound through the same instrument the engine plays.

import { useMemo } from 'react'
import type { MobileDaw } from './engine-hook'
import { STEP } from './seed'
import { playInstrumentNote, preloadDrumInstrument } from '@/lib/daw-instruments'
import { DRUM_LANES } from '@/lib/drum-presets'
import { isMidiClip, type MidiClip, type MidiNote } from '@/lib/daw-types'

const uid = () => crypto.randomUUID()
const DRUM_KEYS = ['kick', 'snare', 'clap', 'closedHat', 'openHat', 'rim', 'tomLo', 'crash']
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(((p % 12) + 12) % 12)
const noteName = (p: number) => `${NOTE_NAMES[((p % 12) + 12) % 12]}${Math.floor(p / 12) - 1}`

export function ClipEditor({ daw, clipId, onClose }: { daw: MobileDaw; clipId: string; onClose: () => void }) {
  const { project, dispatch, engine } = daw
  const clip = project.arrangementClips.find(c => c.id === clipId)
  const track = clip ? project.tracks.find(t => t.id === clip.trackId) : undefined

  const rows = useMemo(() => {
    if (!clip || !isMidiClip(clip)) return [] as { pitch: number; label: string; black?: boolean }[]
    if (clip.isDrumClip) {
      return DRUM_KEYS.map(k => DRUM_LANES.find(l => l.key === k)).filter(Boolean)
        .map(l => ({ pitch: l!.pitch, label: l!.label }))
    }
    // Melodic: 2 octaves, high note on top, chromatic.
    const rr: { pitch: number; label: string; black: boolean }[] = []
    for (let p = 76; p >= 48; p--) rr.push({ pitch: p, label: noteName(p), black: isBlack(p) })
    return rr
  }, [clip])

  if (!clip || !isMidiClip(clip) || !track) return null
  const steps = Math.max(16, Math.round(clip.durationBeats / STEP))
  const isDrum = !!clip.isDrumClip

  // note lookup: pitch -> Set of step indices, and pitch,step -> noteId
  const noteAt = (pitch: number, step: number): MidiNote | undefined =>
    (clip as MidiClip).notes.find(n => n.pitch === pitch && Math.round(n.startBeat / STEP) === step)

  const toggle = (pitch: number, step: number) => {
    const existing = noteAt(pitch, step)
    if (existing) {
      dispatch({ type: 'REMOVE_MIDI_NOTE', clipId, noteId: existing.id })
      return
    }
    dispatch({ type: 'ADD_MIDI_NOTE', clipId, note: { id: uid(), pitch, startBeat: step * STEP, durationBeats: STEP, velocity: 100 } })
    // audition
    try {
      if (isDrum) preloadDrumInstrument(engine.ctx, track.instrument)
      playInstrumentNote(engine.ctx, engine.masterGain, track.instrument, pitch, 100, engine.ctx.currentTime, isDrum ? 0.25 : 0.4)
    } catch { /* audio not ready */ }
  }

  const cellW = 26
  const cellH = isDrum ? 26 : 20

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end' }}>
      <div onClick={e => e.stopPropagation()} style={{ width: '100%', maxHeight: '82vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-surface)', borderTop: '1px solid var(--border)', borderRadius: '18px 18px 0 0', paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 16px 10px' }}>
          <span style={{ width: 10, height: 10, borderRadius: 3, background: track.color }} />
          <strong style={{ fontSize: 14.5, flex: 1 }}>{track.name} · {clip.name}</strong>
          <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{isDrum ? 'Beat' : 'Notes'}</span>
          <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>

        <div style={{ overflow: 'auto', padding: '4px 12px 18px' }}>
          <div style={{ width: 'max-content', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {rows.map(row => (
              <div key={row.pitch} style={{ display: 'flex', alignItems: 'center', gap: 4, height: cellH }}>
                <div style={{ width: 42, flexShrink: 0, position: 'sticky', left: 0, zIndex: 1, background: 'var(--bg-surface)', fontSize: 9.5, fontWeight: 700, color: (row as { black?: boolean }).black ? 'var(--text-muted)' : 'var(--text-secondary)', textAlign: 'right', paddingRight: 4 }}>{row.label}</div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {Array.from({ length: steps }, (_, s) => {
                    const on = !!noteAt(row.pitch, s)
                    const beat = s % 4 === 0, barLine = s % 16 === 0
                    const now = daw.playing && Math.floor(daw.position / STEP) % steps === s
                    return (
                      <button key={s} onClick={() => toggle(row.pitch, s)} aria-label={`${row.label} step ${s + 1}`} style={{
                        width: cellW, height: cellH, flexShrink: 0, borderRadius: 4, padding: 0, cursor: 'pointer',
                        marginLeft: barLine && s !== 0 ? 8 : beat && s !== 0 ? 3 : 0,
                        border: `1px solid ${now ? 'var(--accent-light)' : 'var(--border)'}`,
                        background: on ? (now ? 'var(--accent-light)' : track.color) : (now ? 'rgba(139,92,246,0.2)' : (row as { black?: boolean }).black ? 'var(--bg-base)' : beat ? 'var(--bg-card)' : 'var(--bg-base)'),
                      }} />
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
