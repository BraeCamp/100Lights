/**
 * Seeds the "100lights Audio" default samples into the user's sound library.
 * Runs once per browser profile (keyed by localStorage flags).
 *
 * v3+: entries are stored as stubs (no audioBlob) and rendered on demand via
 * libraryFulfill(). This makes the first load instant.
 */

import { libraryAdd, libraryGetAll, libraryDelete, libraryGetById } from './sound-library'
import type { LibraryEntry, RenderSpec } from './sound-library'
import { playDrumHit }     from './drum-samples'
import { playMelodicNote } from './instrument-synth'
import { encodeWav }       from './wav-codec'
import type { BeatType }   from './beat-analyzer'
import type { LibraryCategory } from './sound-library'

const SEEDED_KEY          = '100lights-audio-seeded-v4'
const NOTES_SEEDED_KEY    = '100lights-notes-seeded-v4'
const DARKWAVE_SEEDED_KEY = '100lights-darkwave-seeded-v1'
const PARENT              = '100lights Audio'

// ── Audio renderers ───────────────────────────────────────────────────────────

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
  { name: 'Strings',        type: 'synth-strings',  note: 60, dur: 4.5 },
  { name: 'Organ',          type: 'synth-organ',    note: 60, dur: 3.5 },
  { name: 'Choir',          type: 'synth-choir',    note: 60, dur: 3.8 },
  { name: 'Bass',           type: 'synth-bass',     note: 36, dur: 2.0 },
]

const DARKWAVE: Array<{ name: string; type: BeatType; note: number; dur: number }> = [
  { name: 'Dark Synth',      type: 'synth-dark',  note: 55, dur: 4.0 },
  { name: 'Cold Wave',       type: 'synth-dark',  note: 60, dur: 4.0 },
  { name: 'Drone',           type: 'synth-drone', note: 48, dur: 5.0 },
  { name: 'Void Drone',      type: 'synth-drone', note: 43, dur: 5.0 },
  { name: 'Metallic Pluck',  type: 'synth-pluck', note: 60, dur: 1.2 },
  { name: 'Steel Pulse',     type: 'synth-pluck', note: 55, dur: 1.2 },
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
  { type: 'synth-strings',  folder: 'Strings – All Notes',       minMidi: 36, maxMidi: 84, duration: 4.5, channels: 2 },
  { type: 'synth-organ',    folder: 'Organ – All Notes',         minMidi: 36, maxMidi: 84, duration: 3.5, channels: 2 },
  { type: 'synth-choir',    folder: 'Choir – All Notes',         minMidi: 36, maxMidi: 84, duration: 3.8, channels: 2 },
  { type: 'synth-bass',     folder: 'Bass – All Notes',          minMidi: 24, maxMidi: 48, duration: 3.5, channels: 1 },
  { type: 'synth-dark',     folder: 'Dark Synth – All Notes',    minMidi: 36, maxMidi: 72, duration: 4.0, channels: 2 },
  { type: 'synth-pluck',    folder: 'Metallic Pluck – All Notes', minMidi: 36, maxMidi: 72, duration: 1.3, channels: 1 },
]

// ── Stub helpers ──────────────────────────────────────────────────────────────

function makeStub(
  name: string,
  category: LibraryCategory,
  renderSpec: RenderSpec,
  folder: string,
  now: string,
): LibraryEntry {
  return {
    id:           crypto.randomUUID(),
    name,
    category,
    renderSpec,
    duration:     renderSpec.duration,
    addedAt:      now,
    folder,
    parentFolder: PARENT,
  }
}

// ── On-demand fulfillment ─────────────────────────────────────────────────────

/**
 * Renders the audio for a stub entry (one with renderSpec but no audioBlob),
 * persists the result to IndexedDB, and returns the fulfilled entry.
 * If the entry already has a blob, returns it as-is.
 */
export async function libraryFulfill(id: string): Promise<LibraryEntry | null> {
  const entry = await libraryGetById(id)
  if (!entry) return null
  if (entry.audioBlob) return entry

  const spec = entry.renderSpec
  if (!spec) return null

  try {
    let buf: AudioBuffer
    if (spec.kind === 'drum') {
      buf = await renderDrum(spec.beatType as BeatType, spec.duration)
    } else {
      buf = await renderMelodic(spec.beatType as BeatType, spec.midiNote ?? 60, spec.duration, spec.channels)
    }
    const fulfilled: LibraryEntry = { ...entry, audioBlob: toWavBlob(buf), duration: buf.duration }
    await libraryAdd(fulfilled)  // put() replaces the stub
    return fulfilled
  } catch {
    return null
  }
}

// ── Public entry points ───────────────────────────────────────────────────────

export async function seedDefaultSamples(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(SEEDED_KEY)) {
    seedKeyboardNotes().catch(() => {})
    seedDarkwave().catch(() => {})
    return
  }

  // Migration: delete any old pre-rendered 100lights entries (v1/v2 blobs)
  const existing = await libraryGetAll()
  const oldEntries = existing.filter(e => e.parentFolder === PARENT && !e.renderSpec)
  await Promise.all(oldEntries.map(e => libraryDelete(e.id)))

  const now = new Date().toISOString()

  for (const d of DRUMS) {
    await libraryAdd(makeStub(d.name, d.type as LibraryCategory, {
      kind: 'drum', beatType: d.type, duration: d.dur, channels: 1,
    }, 'Drums', now))
  }

  for (const k of KEYS) {
    await libraryAdd(makeStub(k.name, k.type as LibraryCategory, {
      kind: 'melodic', beatType: k.type, midiNote: k.note, duration: k.dur, channels: 2,
    }, 'Keys', now))
  }

  localStorage.setItem(SEEDED_KEY, '1')
  seedKeyboardNotes().catch(() => {})
  seedDarkwave().catch(() => {})
}

export async function seedDarkwave(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(DARKWAVE_SEEDED_KEY)) return

  const now = new Date().toISOString()
  for (const k of DARKWAVE) {
    await libraryAdd(makeStub(k.name, k.type as LibraryCategory, {
      kind: 'melodic', beatType: k.type, midiNote: k.note, duration: k.dur, channels: 2,
    }, 'Darkwave', now))
  }
  localStorage.setItem(DARKWAVE_SEEDED_KEY, '1')
}

export async function seedKeyboardNotes(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(NOTES_SEEDED_KEY)) return

  // Migration: delete any old pre-rendered keyboard notes
  const existing = await libraryGetAll()
  const oldNotes = existing.filter(
    e => e.parentFolder === PARENT && !e.renderSpec &&
         KEYBOARD_PRESETS.some(p => p.folder === e.folder)
  )
  await Promise.all(oldNotes.map(e => libraryDelete(e.id)))

  const now = new Date().toISOString()

  for (const preset of KEYBOARD_PRESETS) {
    for (let midi = preset.minMidi; midi <= preset.maxMidi; midi++) {
      await libraryAdd(makeStub(midiNoteName(midi), preset.type as LibraryCategory, {
        kind: 'melodic', beatType: preset.type, midiNote: midi,
        duration: preset.duration, channels: preset.channels,
      }, preset.folder, now))
    }
  }

  localStorage.setItem(NOTES_SEEDED_KEY, '1')
}
