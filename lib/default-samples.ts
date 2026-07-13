/**
 * Seeds the "100lights Audio" default samples into the user's sound library.
 * Runs once per browser profile (keyed by localStorage flags).
 *
 * v7+: full library overhaul — instrument family parent groups, note tags,
 * corrected render durations, new soundfont packs (bass, cello, brass, wind, guitar).
 *
 * Entries are stored as stubs (no audioBlob) and rendered on demand via
 * libraryFulfill(). This makes the first load instant.
 */

import { libraryAdd, libraryGetAll, libraryDelete, libraryGetById, getLibraryUserId } from './sound-library'
import type { LibraryEntry, RenderSpec } from './sound-library'
import { playDrumHit }     from './drum-samples'
import { playMelodicNote } from './instrument-synth'
import { encodeWav }       from './wav-codec'
import type { BeatType }   from './beat-analyzer'
import type { LibraryCategory } from './sound-library'

// ── Seed keys (bump version to force re-seed) ─────────────────────────────────

const SEEDED_KEY          = '100lights-audio-seeded-v7'
const NOTES_SEEDED_KEY    = '100lights-notes-seeded-v7'
const DARKWAVE_SEEDED_KEY = '100lights-darkwave-seeded-v4'
const STRINGS_SEEDED_KEY  = '100lights-strings-seeded-v7'  // v7: violin AND viola render as synth bowed string with the vibrato LFO removed
const PERCUSSION_SEEDED_KEY = '100lights-percussion-seeded-v3'
const FX_SEEDED_KEY       = '100lights-fx-seeded-v3'
const ARP_SEEDED_KEY      = '100lights-arp-seeded-v3'
const BASS_SEEDED_KEY     = '100lights-bass-seeded-v1'
const BRASS_SEEDED_KEY    = '100lights-brass-seeded-v1'
const WIND_SEEDED_KEY     = '100lights-wind-seeded-v1'
const DEDUP_KEY           = '100lights-dedup-v5'  // v5: prefer deterministic seed ids over legacy random-id built-ins
const MIGRATION_V7_KEY    = '100lights-migration-v7'

function sk(base: string) {
  const uid = getLibraryUserId()
  return uid ? `${base}-u-${uid}` : base
}

// ── Soundfont URLs ────────────────────────────────────────────────────────────

const SF_BASE           = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM'
const CELLO_SF_URL      = `${SF_BASE}/cello-mp3.js`
const FRETLESS_BASS_URL = `${SF_BASE}/fretless_bass-mp3.js`
const ELEC_BASS_URL     = `${SF_BASE}/electric_bass_finger-mp3.js`
const ACOUSTIC_BASS_URL = `${SF_BASE}/acoustic_bass-mp3.js`
const TRUMPET_URL       = `${SF_BASE}/trumpet-mp3.js`
const TROMBONE_URL      = `${SF_BASE}/trombone-mp3.js`
const FRENCH_HORN_URL   = `${SF_BASE}/french_horn-mp3.js`
const FLUTE_URL         = `${SF_BASE}/flute-mp3.js`
const CLARINET_URL      = `${SF_BASE}/clarinet-mp3.js`

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

// ── Soundfont helpers ─────────────────────────────────────────────────────────

const SF_NOTE_NAMES  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']
const SF_NOTE_SHARP  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const sfCache        = new Map<string, Record<string, string>>()

function midiToSfKey(midi: number): string {
  return `${SF_NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

function sfKeyToMidi(key: string): number {
  const m = key.match(/^([A-G]b?)(-?\d+)$/)
  if (!m) return -1
  const pc = SF_NOTE_NAMES.indexOf(m[1])
  return pc >= 0 ? (parseInt(m[2]) + 1) * 12 + pc : -1
}

export function parseSoundfontText(text: string): Record<string, string> {
  const assignIdx = text.lastIndexOf('= {')
  const start = assignIdx >= 0 ? text.indexOf('{', assignIdx) : text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('Could not parse soundfont JS')
  const raw = text.slice(start, end + 1).replace(/,\s*}$/, '}')
  return JSON.parse(raw) as Record<string, string>
}

export async function importSoundfontToLibrary(
  text: string,
  folderName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ count: number; loNote: number; hiNote: number }> {
  const map = parseSoundfontText(text)
  const now = new Date().toISOString()

  const sfNoteMap = new Map<number, string>()
  for (const [key, dataUrl] of Object.entries(map)) {
    const midi = sfKeyToMidi(key)
    if (midi >= 0 && dataUrl.startsWith('data:')) sfNoteMap.set(midi, dataUrl)
  }
  if (sfNoteMap.size === 0) throw new Error('No valid notes found in soundfont')

  const available = [...sfNoteMap.keys()].sort((a, b) => a - b)
  const loNote    = available[0]
  const hiNote    = available[available.length - 1]
  const total     = hiNote - loNote + 1

  const decodingCtx = new AudioContext()
  const decodedSrc  = new Map<number, AudioBuffer>()

  const decodeSource = async (srcMidi: number): Promise<AudioBuffer> => {
    if (decodedSrc.has(srcMidi)) return decodedSrc.get(srcMidi)!
    const dataUrl = sfNoteMap.get(srcMidi)!
    const base64  = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const binary  = atob(base64)
    const bytes   = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const buf = await decodingCtx.decodeAudioData(bytes.buffer.slice(0))
    decodedSrc.set(srcMidi, buf)
    return buf
  }

  const findNearest = (target: number): number =>
    available.reduce((best, m) =>
      Math.abs(m - target) < Math.abs(best - target) ? m : best
    )

  const SR      = 44100
  const entries: LibraryEntry[] = []

  for (let midi = loNote; midi <= hiNote; midi++) {
    const nearestMidi = findNearest(midi)
    const semitones   = midi - nearestMidi
    const name        = `${SF_NOTE_SHARP[midi % 12]}${Math.floor(midi / 12) - 1}`
    const letter      = SF_NOTE_SHARP[midi % 12]
    const tags        = [letter, name]

    if (semitones === 0) {
      const srcBuf  = await decodeSource(midi)
      const dataUrl = sfNoteMap.get(midi)!
      const base64  = dataUrl.slice(dataUrl.indexOf(',') + 1)
      const binary  = atob(base64)
      const mp3Bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) mp3Bytes[i] = binary.charCodeAt(i)
      entries.push({
        id:         crypto.randomUUID(),
        name,
        category:   'custom',
        audioBlob:  new Blob([mp3Bytes], { type: 'audio/mp3' }),
        duration:   srcBuf.duration,
        addedAt:    now,
        folder:     folderName,
        renderSpec: { kind: 'soundfont', beatType: 'custom', midiNote: midi, duration: srcBuf.duration, channels: 2 },
        tags,
      })
    } else {
      const srcBuf     = await decodeSource(nearestMidi)
      const rate       = Math.pow(2, semitones / 12)
      const shiftedDur = srcBuf.duration / rate
      const ctx        = new OfflineAudioContext(2, Math.ceil(shiftedDur * SR), SR)
      const src        = ctx.createBufferSource()
      src.buffer       = srcBuf
      src.detune.value = semitones * 100
      src.connect(ctx.destination)
      src.start(0)
      const finalBuf   = await ctx.startRendering()
      entries.push({
        id:         crypto.randomUUID(),
        name,
        category:   'custom',
        audioBlob:  toWavBlob(finalBuf),
        duration:   finalBuf.duration,
        addedAt:    now,
        folder:     folderName,
        renderSpec: { kind: 'soundfont', beatType: 'custom', midiNote: midi, duration: finalBuf.duration, channels: 2 },
        tags,
      })
    }

    onProgress?.(midi - loNote + 1, total)
  }

  decodingCtx.close()
  for (const e of entries) await libraryAdd(e)
  return { count: entries.length, loNote, hiNote }
}

async function fetchSoundfont(url: string): Promise<Record<string, string>> {
  if (sfCache.has(url)) return sfCache.get(url)!
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Soundfont fetch failed: ${resp.status}`)
  const text     = await resp.text()
  const assignIdx = text.lastIndexOf('= {')
  const start = assignIdx >= 0 ? text.indexOf('{', assignIdx) : text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('Could not parse soundfont JS')
  const raw = text.slice(start, end + 1).replace(/,\s*}$/, '}')
  const map = JSON.parse(raw) as Record<string, string>
  sfCache.set(url, map)
  return map
}

export async function renderSoundfont(
  soundfontUrl: string,
  targetMidi:   number,
): Promise<AudioBuffer> {
  const map       = await fetchSoundfont(soundfontUrl)
  const available = Object.keys(map).map(sfKeyToMidi).filter(m => m >= 0)
  if (available.length === 0) throw new Error('Soundfont has no usable notes')

  const nearestMidi = available.reduce((best, m) =>
    Math.abs(m - targetMidi) < Math.abs(best - targetMidi) ? m : best
  )
  const semitones = targetMidi - nearestMidi
  const dataUrl   = map[midiToSfKey(nearestMidi)]
  if (!dataUrl) throw new Error(`No sample for ${midiToSfKey(nearestMidi)} in soundfont`)

  const base64  = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary  = atob(base64)
  const bytes   = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const tmpCtx    = new AudioContext()
  const sourceBuf = await tmpCtx.decodeAudioData(bytes.buffer)
  tmpCtx.close()

  const SR  = 44100
  const dur = sourceBuf.duration
  const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR)
  const src = ctx.createBufferSource()
  src.buffer = sourceBuf
  if (semitones !== 0) src.detune.value = semitones * 100
  src.connect(ctx.destination)
  src.start(0)
  return ctx.startRendering()
}

// ── Note tag helpers ──────────────────────────────────────────────────────────

const NOTE_LETTERS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

function midiNoteName(midi: number): string {
  return `${NOTE_LETTERS[midi % 12]}${Math.floor(midi / 12) - 1}`
}

/** Returns [letter, letterWithOctave] tags, e.g. ['C#', 'C#3'] for midi=61 */
function noteTags(midi: number): [string, string] {
  const name = midiNoteName(midi)
  return [NOTE_LETTERS[midi % 12], name]
}

// ── Catalog constants ─────────────────────────────────────────────────────────

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

const PERCUSSION: Array<{ name: string; type: BeatType; dur: number }> = [
  { name: 'Shaker',     type: 'hihat',       dur: 0.12 },
  { name: 'Tambourine', type: 'open-hihat',  dur: 0.50 },
  { name: 'Cowbell',    type: 'rim',         dur: 0.60 },
  { name: 'Woodblock',  type: 'rim',         dur: 0.15 },
  { name: 'Triangle',   type: 'crash',       dur: 1.10 },
  { name: 'Clave',      type: 'rim',         dur: 0.10 },
  { name: 'Bongo Hi',   type: 'tom',         dur: 0.22 },
  { name: 'Bongo Lo',   type: 'tom',         dur: 0.38 },
  { name: 'Conga Hi',   type: 'tom',         dur: 0.40 },
  { name: 'Conga Lo',   type: 'tom',         dur: 0.60 },
  { name: 'Cabasa',     type: 'hihat',       dur: 0.18 },
  { name: 'Agogo Hi',   type: 'rim',         dur: 0.22 },
  { name: 'Agogo Lo',   type: 'rim',         dur: 0.28 },
]

// Single-note accessible items per instrument family
// dur values reflect internal synth decay + buffer — see instrument-synth.ts for reference
interface SingleNote {
  name: string; type: BeatType; note: number; dur: number
  parentGroup: string; folder: string; typeTags: string[]; charTags: string[]
}

const SINGLES: SingleNote[] = [
  // Keyboards
  { name: 'Piano',          type: 'piano-grand',    note: 60, dur: 7.0, parentGroup: 'Keyboards', folder: 'Keys',   typeTags: ['Keys'],    charTags: ['Bright'] },
  { name: 'Electric Piano', type: 'piano-electric', note: 60, dur: 7.0, parentGroup: 'Keyboards', folder: 'Keys',   typeTags: ['Keys'],    charTags: ['Warm'] },
  { name: 'Rhodes',         type: 'piano-rhodes',   note: 60, dur: 7.0, parentGroup: 'Keyboards', folder: 'Keys',   typeTags: ['Keys'],    charTags: ['Warm', 'Soft'] },
  { name: 'Organ',          type: 'synth-organ',    note: 60, dur: 4.5, parentGroup: 'Keyboards', folder: 'Keys',   typeTags: ['Keys'],    charTags: [] },
  // Synth
  { name: 'Synth Lead',     type: 'synth-lead',     note: 60, dur: 1.5, parentGroup: 'Synth',     folder: 'Synth',  typeTags: ['Lead'],    charTags: ['Bright'] },
  { name: 'Synth Pad',      type: 'synth-pad',      note: 60, dur: 3.5, parentGroup: 'Synth',     folder: 'Synth',  typeTags: ['Pad'],     charTags: ['Warm', 'Ambient'] },
  { name: 'Strings',        type: 'synth-strings',  note: 60, dur: 5.5, parentGroup: 'Synth',     folder: 'Synth',  typeTags: ['Strings'], charTags: ['Warm', 'Soft'] },
  // Vocals
  { name: 'Choir',          type: 'synth-choir',    note: 60, dur: 5.0, parentGroup: 'Vocals',    folder: 'Choir',  typeTags: ['Voice'],   charTags: ['Warm'] },
  // Bass (synth)
  { name: 'Synth Bass',     type: 'synth-bass',     note: 36, dur: 1.0, parentGroup: 'Bass',      folder: 'Bass',   typeTags: ['Bass'],    charTags: ['Dark'] },
]

const DARKWAVE_SINGLES: Array<{ name: string; type: BeatType; note: number; dur: number }> = [
  { name: 'Dark Synth',     type: 'synth-dark',  note: 55, dur: 5.0 },
  { name: 'Cold Wave',      type: 'synth-dark',  note: 60, dur: 5.0 },
  { name: 'Drone',          type: 'synth-drone', note: 48, dur: 6.5 },
  { name: 'Void Drone',     type: 'synth-drone', note: 43, dur: 6.5 },
  { name: 'Metallic Pluck', type: 'synth-pluck', note: 60, dur: 1.5 },
  { name: 'Steel Pulse',    type: 'synth-pluck', note: 55, dur: 1.5 },
]

const FX_CATALOG: Array<{ name: string; type: BeatType; note: number; dur: number; tags: string[] }> = [
  { name: 'Riser',        type: 'synth-dark',  note: 72, dur: 5.0, tags: ['FX', 'Bright'] },
  { name: 'Dark Impact',  type: 'synth-dark',  note: 36, dur: 5.0, tags: ['FX', 'Dark', 'Hard'] },
  { name: 'Atmosphere',   type: 'synth-drone', note: 60, dur: 6.5, tags: ['FX', 'Dark', 'Ambient'] },
  { name: 'Deep Sweep',   type: 'synth-drone', note: 48, dur: 6.5, tags: ['FX', 'Ambient'] },
  { name: 'Shimmer',      type: 'synth-pad',   note: 72, dur: 3.5, tags: ['FX', 'Bright', 'Ambient'] },
  { name: 'Metallic Hit', type: 'synth-pluck', note: 60, dur: 1.5, tags: ['FX', 'Hard', 'Crunchy'] },
  { name: 'Void Tone',    type: 'synth-drone', note: 43, dur: 6.5, tags: ['FX', 'Dark', 'Ambient'] },
  { name: 'Whoosh',       type: 'synth-dark',  note: 80, dur: 5.0, tags: ['FX', 'Bright'] },
  { name: 'Tension Rise', type: 'synth-dark',  note: 65, dur: 5.0, tags: ['FX', 'Dark', 'Hard'] },
  { name: 'Glass Bell',   type: 'synth-pluck', note: 76, dur: 1.5, tags: ['FX', 'Bright', 'Soft'] },
]

const ARP_CATALOG: Array<{ name: string; type: BeatType; note: number; dur: number; tags: string[] }> = [
  { name: 'Arp C4',  type: 'synth-arp', note: 60, dur: 0.4, tags: ['Arp', 'Bright', 'C', 'C4'] },
  { name: 'Arp D4',  type: 'synth-arp', note: 62, dur: 0.4, tags: ['Arp', 'Bright', 'D', 'D4'] },
  { name: 'Arp E4',  type: 'synth-arp', note: 64, dur: 0.4, tags: ['Arp', 'Bright', 'E', 'E4'] },
  { name: 'Arp F4',  type: 'synth-arp', note: 65, dur: 0.4, tags: ['Arp', 'Bright', 'F', 'F4'] },
  { name: 'Arp G4',  type: 'synth-arp', note: 67, dur: 0.4, tags: ['Arp', 'Bright', 'G', 'G4'] },
  { name: 'Arp A4',  type: 'synth-arp', note: 69, dur: 0.4, tags: ['Arp', 'Bright', 'A', 'A4'] },
  { name: 'Arp B4',  type: 'synth-arp', note: 71, dur: 0.4, tags: ['Arp', 'Bright', 'B', 'B4'] },
  { name: 'Arp C5',  type: 'synth-arp', note: 72, dur: 0.4, tags: ['Arp', 'Bright', 'C', 'C5'] },
  { name: 'Arp C3',  type: 'synth-arp', note: 48, dur: 0.4, tags: ['Arp', 'Dark',   'C', 'C3'] },
  { name: 'Arp E3',  type: 'synth-arp', note: 52, dur: 0.4, tags: ['Arp', 'Dark',   'E', 'E3'] },
  { name: 'Arp G3',  type: 'synth-arp', note: 55, dur: 0.4, tags: ['Arp', 'Dark',   'G', 'G3'] },
  { name: 'Arp A3',  type: 'synth-arp', note: 57, dur: 0.4, tags: ['Arp', 'Warm',   'A', 'A3'] },
]

// ── Per-note keyboard presets ─────────────────────────────────────────────────
// dur = render context length in seconds — must be >= the synth's internal decay.
// See instrument-synth.ts for actual durations per type.

interface KeyboardPreset {
  type:        BeatType
  folder:      string
  parentGroup: string
  minMidi:     number
  maxMidi:     number
  duration:    number   // seconds — must cover the full note decay
  channels:    number
  typeTags:    string[]
  charTags:    string[]
}

const KEYBOARD_PRESETS: KeyboardPreset[] = [
  // ── Keyboards ────────────────────────────────────────────────────────────────
  // Piano sustain: max(0.8, min(4.5, ...)) → render at 7s covers all notes
  { type: 'piano-grand',    folder: 'Piano – All Notes',          parentGroup: 'Keyboards', minMidi: 36, maxMidi: 84, duration: 7.0, channels: 2, typeTags: ['Keys'],    charTags: ['Bright'] },
  { type: 'piano-electric', folder: 'Elec. Piano – All Notes',    parentGroup: 'Keyboards', minMidi: 36, maxMidi: 84, duration: 7.0, channels: 2, typeTags: ['Keys'],    charTags: ['Warm'] },
  { type: 'piano-rhodes',   folder: 'Rhodes – All Notes',         parentGroup: 'Keyboards', minMidi: 36, maxMidi: 84, duration: 7.0, channels: 2, typeTags: ['Keys'],    charTags: ['Warm', 'Soft'] },
  // Organ: sustains through 3.2s, ramps to 0 at 3.5s, stops at 3.6s
  { type: 'synth-organ',    folder: 'Organ – All Notes',          parentGroup: 'Keyboards', minMidi: 36, maxMidi: 84, duration: 4.5, channels: 2, typeTags: ['Keys'],    charTags: [] },
  // ── Synth ────────────────────────────────────────────────────────────────────
  // Lead: decays by 0.65s, stops at 0.7s
  { type: 'synth-lead',     folder: 'Synth Lead – All Notes',     parentGroup: 'Synth',     minMidi: 48, maxMidi: 72, duration: 1.5, channels: 1, typeTags: ['Lead'],    charTags: ['Bright'] },
  // Pad: decays by 3.0s, stops at 3.0s
  { type: 'synth-pad',      folder: 'Synth Pad – All Notes',      parentGroup: 'Synth',     minMidi: 36, maxMidi: 84, duration: 3.5, channels: 2, typeTags: ['Pad'],     charTags: ['Warm', 'Ambient'] },
  // Strings: ramp to 0 at 4.5s, stops at 4.6s
  { type: 'synth-strings',  folder: 'Synth Strings – All Notes',  parentGroup: 'Synth',     minMidi: 36, maxMidi: 84, duration: 5.5, channels: 2, typeTags: ['Strings'], charTags: ['Warm', 'Soft'] },
  // Choir: ramp to 0 at 3.8s, stops at 4.0s
  { type: 'synth-choir',    folder: 'Choir – All Notes',          parentGroup: 'Vocals',    minMidi: 36, maxMidi: 84, duration: 5.0, channels: 2, typeTags: ['Voice'],   charTags: ['Warm'] },
  // Dark synth: ramp to 0 at 3.8s, stops at 4.0s
  { type: 'synth-dark',     folder: 'Dark Synth – All Notes',     parentGroup: 'Synth',     minMidi: 36, maxMidi: 72, duration: 5.0, channels: 2, typeTags: ['Lead'],    charTags: ['Dark'] },
  // Drone: ramp to 0 at 5.2s, stops at 5.3s
  { type: 'synth-drone',    folder: 'Drone – All Notes',          parentGroup: 'Synth',     minMidi: 36, maxMidi: 60, duration: 6.5, channels: 2, typeTags: ['Pad'],     charTags: ['Dark', 'Ambient'] },
  // Pluck: decays by 1.1s, stops at 1.2s
  { type: 'synth-pluck',    folder: 'Metallic Pluck – All Notes', parentGroup: 'Synth',     minMidi: 36, maxMidi: 72, duration: 1.5, channels: 1, typeTags: ['Lead'],    charTags: ['Hard', 'Crunchy'] },
  // ── Bass ─────────────────────────────────────────────────────────────────────
  // Synth bass: decays by 0.45s, stops at 0.5s
  { type: 'synth-bass',     folder: 'Synth Bass – All Notes',     parentGroup: 'Bass',      minMidi: 24, maxMidi: 48, duration: 1.0, channels: 1, typeTags: ['Bass'],    charTags: ['Dark'] },
  // ── Guitar (Karplus-Strong physical model, natural decay ≈ 3.5s) ────────────
  { type: 'guitar-acoustic', folder: 'Acoustic Guitar – All Notes', parentGroup: 'Guitar',  minMidi: 40, maxMidi: 76, duration: 4.0, channels: 1, typeTags: ['Guitar'],  charTags: ['Warm'] },
  { type: 'guitar-electric', folder: 'Electric Guitar – All Notes', parentGroup: 'Guitar',  minMidi: 40, maxMidi: 76, duration: 4.0, channels: 1, typeTags: ['Guitar'],  charTags: ['Bright'] },
  { type: 'guitar-nylon',    folder: 'Nylon Guitar – All Notes',    parentGroup: 'Guitar',  minMidi: 40, maxMidi: 76, duration: 3.5, channels: 1, typeTags: ['Guitar'],  charTags: ['Warm', 'Soft'] },
  // ── Strings (soundfont) — seeded separately by seedStrings() ────────────────
  { type: 'violin', folder: 'Violin – All Notes', parentGroup: 'Strings', minMidi: 55, maxMidi: 88, duration: 5.0, channels: 2, typeTags: ['Strings'], charTags: ['Bright'] },
  { type: 'viola',  folder: 'Viola – All Notes',  parentGroup: 'Strings', minMidi: 48, maxMidi: 77, duration: 5.0, channels: 2, typeTags: ['Strings'], charTags: ['Warm'] },
]

// ── Soundfont packs ───────────────────────────────────────────────────────────

interface SoundfontPack {
  name:        string
  url:         string
  folder:      string
  parentGroup: string
  category:    LibraryCategory
  minMidi:     number
  maxMidi:     number
  typeTags:    string[]
  charTags:    string[]
}

const SOUNDFONT_PACKS: SoundfontPack[] = [
  // Bass
  { name: 'Fretless Bass', url: FRETLESS_BASS_URL, folder: 'Fretless Bass – All Notes', parentGroup: 'Bass',
    category: 'synth-bass', minMidi: 24, maxMidi: 67, typeTags: ['Bass'], charTags: ['Warm'] },
  { name: 'Electric Bass',  url: ELEC_BASS_URL,     folder: 'Electric Bass – All Notes', parentGroup: 'Bass',
    category: 'synth-bass', minMidi: 24, maxMidi: 67, typeTags: ['Bass'], charTags: [] },
  { name: 'Acoustic Bass',  url: ACOUSTIC_BASS_URL, folder: 'Acoustic Bass – All Notes', parentGroup: 'Bass',
    category: 'synth-bass', minMidi: 24, maxMidi: 55, typeTags: ['Bass'], charTags: ['Warm'] },
  // Strings
  { name: 'Cello', url: CELLO_SF_URL, folder: 'Cello – All Notes', parentGroup: 'Strings',
    category: 'viola', minMidi: 36, maxMidi: 81, typeTags: ['Strings'], charTags: ['Warm'] },
  // Brass
  { name: 'Trumpet',     url: TRUMPET_URL,     folder: 'Trumpet – All Notes',     parentGroup: 'Brass',
    category: 'other', minMidi: 52, maxMidi: 84, typeTags: ['Brass'], charTags: ['Bright'] },
  { name: 'Trombone',    url: TROMBONE_URL,    folder: 'Trombone – All Notes',    parentGroup: 'Brass',
    category: 'other', minMidi: 40, maxMidi: 77, typeTags: ['Brass'], charTags: ['Warm'] },
  { name: 'French Horn', url: FRENCH_HORN_URL, folder: 'French Horn – All Notes', parentGroup: 'Brass',
    category: 'other', minMidi: 35, maxMidi: 77, typeTags: ['Brass'], charTags: ['Warm', 'Soft'] },
  // Wind
  { name: 'Flute',    url: FLUTE_URL,    folder: 'Flute – All Notes',    parentGroup: 'Wind',
    category: 'other', minMidi: 60, maxMidi: 96, typeTags: ['Wind'], charTags: ['Bright', 'Soft'] },
  { name: 'Clarinet', url: CLARINET_URL, folder: 'Clarinet – All Notes', parentGroup: 'Wind',
    category: 'other', minMidi: 50, maxMidi: 93, typeTags: ['Wind'], charTags: ['Warm'] },
]

// ── Stub builder ──────────────────────────────────────────────────────────────

function makeStub(
  name: string,
  category: LibraryCategory,
  renderSpec: RenderSpec,
  folder: string,
  now: string,
  tags?: string[],
  parentFolder?: string,
): LibraryEntry {
  return {
    // Deterministic id: libraryAdd() is a put, so re-seeding overwrites the
    // same entry instead of duplicating it — idempotent by construction.
    id:           `seed:${parentFolder ?? '100lights Audio'}:${folder}:${name}`,
    name,
    category,
    renderSpec,
    duration:     renderSpec.duration,
    addedAt:      now,
    folder,
    parentFolder: parentFolder ?? '100lights Audio',
    ...(tags && tags.length > 0 ? { tags } : {}),
  }
}

// ── On-demand fulfillment ─────────────────────────────────────────────────────

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
    } else if (spec.kind === 'soundfont' && spec.soundfontUrl) {
      buf = await renderSoundfont(spec.soundfontUrl, spec.midiNote ?? 60)
    } else {
      buf = await renderMelodic(spec.beatType as BeatType, spec.midiNote ?? 60, spec.duration, spec.channels)
    }
    const fulfilled: LibraryEntry = { ...entry, audioBlob: toWavBlob(buf), duration: buf.duration }
    libraryAdd(fulfilled).catch(() => {})
    return fulfilled
  } catch (err) {
    console.error('[libraryFulfill] render failed for', id, err)
    return null
  }
}

// ── Dedup ─────────────────────────────────────────────────────────────────────

async function dedupLibrary(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(DEDUP_KEY))) return
  const all = await libraryGetAll()
  const seen = new Map<string, LibraryEntry>()
  const toDelete: string[] = []
  for (const e of all) {
    const key  = `${e.parentFolder ?? ''}|${e.folder ?? ''}|${e.name}`
    const prev = seen.get(key)
    if (!prev) { seen.set(key, e); continue }
    // Deterministic seed entries (seed:*) are canonical — they carry the
    // current renderSpec. Legacy random-id built-ins lose even when fulfilled,
    // otherwise stale sounds (e.g. the old vibrato violin) shadow new ones.
    const eSeed = e.id.startsWith('seed:'), pSeed = prev.id.startsWith('seed:')
    const keepNew = eSeed !== pSeed
      ? eSeed
      : !prev.audioBlob && (e.audioBlob || e.addedAt > prev.addedAt)
    if (keepNew) { toDelete.push(prev.id); seen.set(key, e) }
    else { toDelete.push(e.id) }
  }
  await Promise.all(toDelete.map(id => libraryDelete(id)))
  localStorage.setItem(sk(DEDUP_KEY), '1')
}

// ── V7 migration: delete all old built-in stubs ────────────────────────────────
// Old items used parentFolder='100lights Audio' for everything. New items use
// instrument-family parent groups (Keyboards, Bass, Strings, etc.).

async function migrateToV7(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(MIGRATION_V7_KEY))) return

  const all = await libraryGetAll()
  // Old built-in stubs always have renderSpec and parentFolder set
  // Users' own recordings have no renderSpec (they have audioBlob directly)
  const toDelete = all.filter(e => e.renderSpec != null && e.parentFolder != null)
  await Promise.all(toDelete.map(e => libraryDelete(e.id)))

  // Clear all individual seed keys so everything re-seeds fresh
  const seedKeys = [
    SEEDED_KEY, NOTES_SEEDED_KEY, DARKWAVE_SEEDED_KEY, STRINGS_SEEDED_KEY,
    PERCUSSION_SEEDED_KEY, FX_SEEDED_KEY, ARP_SEEDED_KEY,
    BASS_SEEDED_KEY, BRASS_SEEDED_KEY, WIND_SEEDED_KEY, DEDUP_KEY,
    // old key versions
    '100lights-audio-seeded-v5', '100lights-audio-seeded-v6',
    '100lights-notes-seeded-v5', '100lights-notes-seeded-v6',
    '100lights-darkwave-seeded-v2', '100lights-darkwave-seeded-v3',
    '100lights-strings-seeded-v3', '100lights-strings-seeded-v4',
    '100lights-percussion-seeded-v1', '100lights-percussion-seeded-v2',
    '100lights-fx-seeded-v1', '100lights-fx-seeded-v2',
    '100lights-arp-seeded-v1', '100lights-arp-seeded-v2',
    '100lights-dedup-v2',
  ]
  const uid = getLibraryUserId()
  for (const k of seedKeys) {
    localStorage.removeItem(k)
    if (uid) localStorage.removeItem(`${k}-u-${uid}`)
  }

  localStorage.setItem(sk(MIGRATION_V7_KEY), '1')
}

// ── Public seed entry point ───────────────────────────────────────────────────

export async function seedDefaultSamples(): Promise<void> {
  if (typeof window === 'undefined') return
  await migrateToV7()
  dedupLibrary().catch(() => {})

  if (localStorage.getItem(sk(SEEDED_KEY))) {
    seedKeyboardNotes().catch(() => {})
    seedDarkwave().catch(() => {})
    seedStrings().catch(() => {})
    seedPercussion().catch(() => {})
    seedFx().catch(() => {})
    seedArp().catch(() => {})
    seedBass().catch(() => {})
    seedBrass().catch(() => {})
    seedWind().catch(() => {})
    return
  }

  const now = new Date().toISOString()

  // Drums
  for (const d of DRUMS) {
    await libraryAdd(makeStub(d.name, d.type as LibraryCategory, {
      kind: 'drum', beatType: d.type, duration: d.dur, channels: 1,
    }, 'Drums', now, ['Drums'], 'Drums'))
  }

  // Single-note accessible items per family
  for (const s of SINGLES) {
    await libraryAdd(makeStub(s.name, s.type as LibraryCategory, {
      kind: 'melodic', beatType: s.type, midiNote: s.note, duration: s.dur, channels: 2,
    }, s.folder, now, [...s.typeTags, ...s.charTags], s.parentGroup))
  }

  localStorage.setItem(sk(SEEDED_KEY), '1')
  seedKeyboardNotes().catch(() => {})
  seedDarkwave().catch(() => {})
  seedStrings().catch(() => {})
  seedPercussion().catch(() => {})
  seedFx().catch(() => {})
  seedArp().catch(() => {})
  seedBass().catch(() => {})
  seedBrass().catch(() => {})
  seedWind().catch(() => {})
}

// ── Individual seed functions ─────────────────────────────────────────────────

export async function seedPercussion(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(PERCUSSION_SEEDED_KEY))) return
  const now = new Date().toISOString()
  for (const d of PERCUSSION) {
    await libraryAdd(makeStub(d.name, d.type as LibraryCategory, {
      kind: 'drum', beatType: d.type, duration: d.dur, channels: 1,
    }, 'Percussion', now, ['Percussion'], 'Drums'))
  }
  localStorage.setItem(sk(PERCUSSION_SEEDED_KEY), '1')
}

export async function seedFx(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(FX_SEEDED_KEY))) return
  const now = new Date().toISOString()
  for (const fx of FX_CATALOG) {
    await libraryAdd(makeStub(fx.name, fx.type as LibraryCategory, {
      kind: 'melodic', beatType: fx.type, midiNote: fx.note, duration: fx.dur, channels: 2,
    }, 'FX', now, fx.tags, 'FX'))
  }
  localStorage.setItem(sk(FX_SEEDED_KEY), '1')
}

export async function seedArp(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(ARP_SEEDED_KEY))) return
  const now = new Date().toISOString()
  for (const a of ARP_CATALOG) {
    await libraryAdd(makeStub(a.name, a.type as LibraryCategory, {
      kind: 'melodic', beatType: a.type, midiNote: a.note, duration: a.dur, channels: 1,
    }, 'Arp', now, a.tags, 'Arp'))
  }
  localStorage.setItem(sk(ARP_SEEDED_KEY), '1')
}

export async function seedDarkwave(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(DARKWAVE_SEEDED_KEY))) return
  const now = new Date().toISOString()
  const charMap: Record<string, string[]> = {
    'synth-dark':  ['Dark', 'Hard'],
    'synth-drone': ['Dark', 'Ambient'],
    'synth-pluck': ['Hard', 'Crunchy'],
  }
  for (const k of DARKWAVE_SINGLES) {
    const typeTags = k.type === 'synth-pluck' ? ['Lead'] : ['Lead']
    const charTags = charMap[k.type] ?? []
    await libraryAdd(makeStub(k.name, k.type as LibraryCategory, {
      kind: 'melodic', beatType: k.type, midiNote: k.note, duration: k.dur, channels: 2,
    }, 'Darkwave', now, [...typeTags, ...charTags], 'Synth'))
  }
  localStorage.setItem(sk(DARKWAVE_SEEDED_KEY), '1')
}

export async function seedStrings(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(STRINGS_SEEDED_KEY))) return

  const now = new Date().toISOString()

  // Single accessible entries — one playable sample per bowed string instrument
  const BOWED_SINGLES = [
    { name: 'Violin',  category: 'violin' as LibraryCategory, midi: 69, url: null,          charTags: ['Bright', 'Warm'] },
    { name: 'Viola',   category: 'viola'  as LibraryCategory, midi: 57, url: null,          charTags: ['Warm'] },
    { name: 'Cello',   category: 'viola'  as LibraryCategory, midi: 48, url: CELLO_SF_URL,  charTags: ['Warm'] },
  ]
  for (const s of BOWED_SINGLES) {
    const [letter, full] = noteTags(s.midi)
    const spec = s.url
      ? { kind: 'soundfont' as const, beatType: s.category, midiNote: s.midi, duration: 5.0, channels: 2, soundfontUrl: s.url }
      : { kind: 'melodic' as const, beatType: s.category, midiNote: s.midi, duration: 5.0, channels: 2 }
    await libraryAdd(makeStub(s.name, s.category, spec, 'Strings', now, ['Strings', letter, full, ...s.charTags], 'Strings'))
  }

  // Per-note folders for violin, viola (from KEYBOARD_PRESETS).
  // Both use the synthesized bowed string: steady, vibrato-free — users add
  // their own vibrato with full control.
  const stringPresets = KEYBOARD_PRESETS.filter(p => p.type === 'violin' || p.type === 'viola')
  for (const preset of stringPresets) {
    for (let midi = preset.minMidi; midi <= preset.maxMidi; midi++) {
      const [letter, full] = noteTags(midi)
      const spec = { kind: 'melodic' as const, beatType: preset.type, midiNote: midi, duration: preset.duration, channels: preset.channels }
      await libraryAdd(makeStub(midiNoteName(midi), preset.type as LibraryCategory, spec,
        preset.folder, now, [...preset.typeTags, ...preset.charTags, letter, full], preset.parentGroup))
    }
  }

  // Cello per-note folder (soundfont pack, handled here alongside violin/viola)
  const cello = SOUNDFONT_PACKS.find(p => p.name === 'Cello')!
  await seedSoundfontPack(cello, now)

  localStorage.setItem(sk(STRINGS_SEEDED_KEY), '1')
}

export async function seedKeyboardNotes(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(NOTES_SEEDED_KEY))) return

  const now = new Date().toISOString()

  // Exclude violin/viola/cello (handled by seedStrings) and soundfont bass packs (handled by seedBass)
  const nonStringPresets = KEYBOARD_PRESETS.filter(p =>
    p.type !== 'violin' && p.type !== 'viola'
  )
  for (const preset of nonStringPresets) {
    for (let midi = preset.minMidi; midi <= preset.maxMidi; midi++) {
      const [letter, full] = noteTags(midi)
      await libraryAdd(makeStub(midiNoteName(midi), preset.type as LibraryCategory, {
        kind: 'melodic', beatType: preset.type, midiNote: midi,
        duration: preset.duration, channels: preset.channels,
      }, preset.folder, now, [...preset.typeTags, ...preset.charTags, letter, full], preset.parentGroup))
    }
  }

  localStorage.setItem(sk(NOTES_SEEDED_KEY), '1')
}

/** Seeds a soundfont-based instrument pack (bass, brass, wind) */
async function seedSoundfontPack(pack: SoundfontPack, now: string): Promise<void> {
  for (let midi = pack.minMidi; midi <= pack.maxMidi; midi++) {
    const [letter, full] = noteTags(midi)
    await libraryAdd(makeStub(midiNoteName(midi), pack.category, {
      kind: 'soundfont', beatType: pack.category, midiNote: midi,
      duration: 5.0, channels: 2, soundfontUrl: pack.url,
    }, pack.folder, now, [...pack.typeTags, ...pack.charTags, letter, full], pack.parentGroup))
  }
}

export async function seedBass(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(BASS_SEEDED_KEY))) return
  const now = new Date().toISOString()
  const bassPacks = SOUNDFONT_PACKS.filter(p => p.parentGroup === 'Bass')
  for (const pack of bassPacks) await seedSoundfontPack(pack, now)
  localStorage.setItem(sk(BASS_SEEDED_KEY), '1')
}

export async function seedBrass(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(BRASS_SEEDED_KEY))) return
  const now = new Date().toISOString()
  const brassPacks = SOUNDFONT_PACKS.filter(p => p.parentGroup === 'Brass')
  for (const pack of brassPacks) await seedSoundfontPack(pack, now)
  localStorage.setItem(sk(BRASS_SEEDED_KEY), '1')
}

export async function seedWind(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(sk(WIND_SEEDED_KEY))) return
  const now = new Date().toISOString()
  const windPacks = SOUNDFONT_PACKS.filter(p => p.parentGroup === 'Wind')
  for (const pack of windPacks) await seedSoundfontPack(pack, now)
  localStorage.setItem(sk(WIND_SEEDED_KEY), '1')
}
