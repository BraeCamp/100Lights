/**
 * Seeds the "100lights Audio" default samples into the user's sound library.
 * Runs once per browser profile (keyed by localStorage flags).
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

const SEEDED_KEY      = '100lights-audio-seeded-v1'
const NOTES_SEEDED_KEY = '100lights-notes-seeded-v2'  // bumped: longer note durations
const PARENT          = '100lights Audio'

async function renderDrum(type: BeatType, durationSec: number): Promise<AudioBuffer> {
  const SR  = 44100
  const ctx = new OfflineAudioContext(1, Math.ceil(durationSec * SR), SR)
  playDrumHit(ctx as unknown as AudioContext, 'synth', type, 0, 0.85, undefined, 0.45, ctx.destination)
  return ctx.startRendering()
}

async function renderMelodic(type: BeatType, midiNote: number, durationSec: number, channels = 2): Promise<AudioBuffer> {
  const SR  = 44100
  const ctx = new OfflineAudioContext(channels, Math.ceil(durationSec * SR), SR)
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
  { name: 'Piano',          type: 'piano-grand',    note: 60, dur: 4.0 },
  { name: 'Electric Piano', type: 'piano-electric', note: 60, dur: 3.0 },
  { name: 'Rhodes',         type: 'piano-rhodes',   note: 60, dur: 3.0 },
  { name: 'Synth Lead',     type: 'synth-lead',     note: 60, dur: 2.5 },
  { name: 'Synth Pad',      type: 'synth-pad',      note: 60, dur: 3.5 },
  { name: 'Bass',           type: 'synth-bass',     note: 36, dur: 2.0 },
]

// ── Keyboard note presets ─────────────────────────────────────────────────────

const NOTE_NAMES_12 = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
function midiNoteName(midi: number): string {
  return `${NOTE_NAMES_12[midi % 12]}${Math.floor(midi / 12) - 1}`
}

interface KeyboardPreset {
  type:     BeatType
  folder:   string
  minMidi:  number
  maxMidi:  number
  duration: number
  channels: number
}

const KEYBOARD_PRESETS: KeyboardPreset[] = [
  { type: 'piano-grand',    folder: 'Piano – All Notes',         minMidi: 36, maxMidi: 84, duration: 4.5, channels: 2 },
  { type: 'piano-electric', folder: 'Elec. Piano – All Notes',   minMidi: 36, maxMidi: 84, duration: 4.0, channels: 2 },
  { type: 'piano-rhodes',   folder: 'Rhodes – All Notes',        minMidi: 36, maxMidi: 84, duration: 4.0, channels: 2 },
  { type: 'synth-lead',     folder: 'Synth Lead – All Notes',    minMidi: 48, maxMidi: 72, duration: 3.0, channels: 1 },
  { type: 'synth-bass',     folder: 'Bass – All Notes',          minMidi: 24, maxMidi: 48, duration: 3.5, channels: 1 },
]

// ── Public entry points ───────────────────────────────────────────────────────

export async function seedDefaultSamples(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(SEEDED_KEY)) {
    // Seed keyboard notes even if main samples already done (separate flag)
    seedKeyboardNotes().catch(() => {})
    return
  }

  const existing = await libraryGetAll()
  if (existing.some(e => e.parentFolder === PARENT)) {
    localStorage.setItem(SEEDED_KEY, '1')
    seedKeyboardNotes().catch(() => {})
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
    } catch { /* skip */ }
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

  // Keyboard notes run in background after drums/keys are done
  seedKeyboardNotes().catch(() => {})
}

export async function seedKeyboardNotes(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(NOTES_SEEDED_KEY)) return

  const existing = await libraryGetAll()
  if (existing.some(e => e.parentFolder === PARENT && KEYBOARD_PRESETS.some(p => p.folder === e.folder))) {
    localStorage.setItem(NOTES_SEEDED_KEY, '1')
    return
  }

  const now = new Date().toISOString()

  for (const preset of KEYBOARD_PRESETS) {
    for (let midi = preset.minMidi; midi <= preset.maxMidi; midi++) {
      try {
        const buf = await renderMelodic(preset.type, midi, preset.duration, preset.channels)
        await libraryAdd({
          id:           crypto.randomUUID(),
          name:         midiNoteName(midi),
          category:     preset.type as LibraryCategory,
          audioBlob:    toWavBlob(buf),
          duration:     buf.duration,
          addedAt:      now,
          folder:       preset.folder,
          parentFolder: PARENT,
        })
      } catch { /* skip */ }
    }
  }

  localStorage.setItem(NOTES_SEEDED_KEY, '1')
}
