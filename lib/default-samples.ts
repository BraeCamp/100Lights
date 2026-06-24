/**
 * Seeds the "100lights Audio" default samples into the user's sound library.
 * Runs once per browser profile (keyed by localStorage flag).
 *
 * Sounds are synthesized on the fly using the same drum/melodic engines used
 * by the live DAW, then encoded as WAV and stored in IndexedDB.
 */

import { libraryAdd, libraryGetAll } from './sound-library'
import { playDrumHit }     from './drum-samples'
import { playMelodicNote } from './instrument-synth'
import { encodeWav }       from './wav-codec'
import type { BeatType }   from './beat-analyzer'
import type { LibraryCategory } from './sound-library'

const SEEDED_KEY = '100lights-audio-seeded-v1'
const PARENT     = '100lights Audio'

// OfflineAudioContext implements BaseAudioContext, which is all the synth fns need.
// The `as unknown as AudioContext` cast is safe — every method called is on BaseAudioContext.

async function renderDrum(type: BeatType, durationSec: number): Promise<AudioBuffer> {
  const SR  = 44100
  const ctx = new OfflineAudioContext(1, Math.ceil(durationSec * SR), SR)
  playDrumHit(ctx as unknown as AudioContext, 'synth', type, 0, 0.85, undefined, 0.45, ctx.destination)
  return ctx.startRendering()
}

async function renderMelodic(type: BeatType, midiNote: number, durationSec: number): Promise<AudioBuffer> {
  const SR  = 44100
  const ctx = new OfflineAudioContext(2, Math.ceil(durationSec * SR), SR)
  playMelodicNote(ctx as unknown as AudioContext, type, midiNote, 0, 0.75, ctx.destination)
  return ctx.startRendering()
}

function toWavBlob(buf: AudioBuffer): Blob {
  const channels = Array.from({ length: buf.numberOfChannels }, (_, ch) => buf.getChannelData(ch))
  return new Blob([encodeWav(channels, buf.sampleRate)], { type: 'audio/wav' })
}

// ── Catalog ───────────────────────────────────────────────────────────────────

const DRUMS: Array<{ name: string; type: BeatType; dur: number }> = [
  { name: 'Kick',     type: 'kick',       dur: 0.65 },
  { name: 'Snare',    type: 'snare',      dur: 0.35 },
  { name: 'Hi-Hat',   type: 'hihat',      dur: 0.12 },
  { name: 'Open Hat', type: 'open-hihat', dur: 0.65 },
  { name: 'Clap',     type: 'clap',       dur: 0.35 },
  { name: 'Tom',      type: 'tom',        dur: 0.55 },
  { name: 'Crash',    type: 'crash',      dur: 2.1  },
  { name: 'Rim',      type: 'rim',        dur: 0.18 },
]

const KEYS: Array<{ name: string; type: BeatType; note: number; dur: number }> = [
  { name: 'Piano',         type: 'piano-grand',   note: 60, dur: 4.0 },
  { name: 'Electric Piano',type: 'piano-electric', note: 60, dur: 3.0 },
  { name: 'Rhodes',        type: 'piano-rhodes',   note: 60, dur: 3.0 },
  { name: 'Synth Lead',    type: 'synth-lead',     note: 60, dur: 2.5 },
  { name: 'Synth Pad',     type: 'synth-pad',      note: 60, dur: 3.5 },
  { name: 'Bass',          type: 'synth-bass',     note: 36, dur: 2.0 },
]

// ── Public entry point ────────────────────────────────────────────────────────

export async function seedDefaultSamples(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(SEEDED_KEY)) return

  // Double-check: don't re-seed if entries already exist (e.g. flag was cleared)
  const existing = await libraryGetAll()
  if (existing.some(e => e.parentFolder === PARENT)) {
    localStorage.setItem(SEEDED_KEY, '1')
    return
  }

  const now = new Date().toISOString()

  for (const d of DRUMS) {
    try {
      const buf = await renderDrum(d.type, d.dur)
      await libraryAdd({
        id:           crypto.randomUUID(),
        name:         d.name,
        category:     d.type as LibraryCategory,
        audioBlob:    toWavBlob(buf),
        duration:     buf.duration,
        addedAt:      now,
        folder:       'Drums',
        parentFolder: PARENT,
      })
    } catch { /* skip this sound on render failure */ }
  }

  for (const k of KEYS) {
    try {
      const buf = await renderMelodic(k.type, k.note, k.dur)
      await libraryAdd({
        id:           crypto.randomUUID(),
        name:         k.name,
        category:     k.type as LibraryCategory,
        audioBlob:    toWavBlob(buf),
        duration:     buf.duration,
        addedAt:      now,
        folder:       'Keys',
        parentFolder: PARENT,
      })
    } catch { /* skip */ }
  }

  localStorage.setItem(SEEDED_KEY, '1')
}
