/**
 * Seeds the "100lights Audio" default samples into the user's sound library.
 * Runs once per browser profile (keyed by localStorage flags).
 *
 * v3+: entries are stored as stubs (no audioBlob) and rendered on demand via
 * libraryFulfill(). This makes the first load instant.
 *
 * Violin/viola use real FluidR3 GM soundfont samples fetched from CDN rather
 * than synthesis. The nearest available soundfont note is pitch-shifted to
 * the exact target MIDI note.
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
const STRINGS_SEEDED_KEY  = '100lights-strings-seeded-v2'  // v2: switched from synth → soundfont
const DEDUP_KEY           = '100lights-dedup-v2'
const PARENT              = '100lights Audio'

const VIOLIN_SF_URL = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/violin-mp3.js'
const VIOLA_SF_URL  = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/viola-mp3.js'

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

// ── Soundfont renderer (violin / viola from FluidR3 GM CDN) ───────────────────

// Note names matching midi-js-soundfonts key format (flats, not sharps)
const SF_NOTE_NAMES = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B']

function midiToSfKey(midi: number): string {
  return `${SF_NOTE_NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`
}

function sfKeyToMidi(key: string): number {
  const m = key.match(/^([A-G]b?)(-?\d+)$/)
  if (!m) return -1
  const pc = SF_NOTE_NAMES.indexOf(m[1])
  return pc >= 0 ? (parseInt(m[2]) + 1) * 12 + pc : -1
}

// In-memory cache so we only fetch each soundfont file once per page load
const sfCache = new Map<string, Record<string, string>>()

/** Parse a soundfont JS file's text content into { "C4": "data:audio/mp3;..." } map. */
export function parseSoundfontText(text: string): Record<string, string> {
  const assignIdx = text.lastIndexOf('= {')
  const start = assignIdx >= 0 ? text.indexOf('{', assignIdx) : text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('Could not parse soundfont JS')
  const raw = text.slice(start, end + 1).replace(/,\s*}$/, '}')
  return JSON.parse(raw) as Record<string, string>
}

const SF_NOTE_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

/**
 * Import a soundfont JS file (text content) into the library as a named folder.
 * Each key in the soundfont map becomes a LibraryEntry with the decoded audio blob.
 * Returns the detected MIDI note range.
 */
export async function importSoundfontToLibrary(
  text: string,
  folderName: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ count: number; loNote: number; hiNote: number }> {
  const map = parseSoundfontText(text)
  const now = new Date().toISOString()

  // Build midi → dataUrl map from the soundfont's available notes
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

  // Decode each source note once and cache
  const decodedSrc = new Map<number, AudioBuffer>()
  const decodeSource = async (srcMidi: number): Promise<AudioBuffer> => {
    if (decodedSrc.has(srcMidi)) return decodedSrc.get(srcMidi)!
    const dataUrl = sfNoteMap.get(srcMidi)!
    const base64  = dataUrl.slice(dataUrl.indexOf(',') + 1)
    const binary  = atob(base64)
    const bytes   = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    const tmpCtx  = new AudioContext()
    const buf     = await tmpCtx.decodeAudioData(bytes.buffer)
    tmpCtx.close()
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
    const srcBuf      = await decodeSource(nearestMidi)

    let finalBuf: AudioBuffer
    if (semitones === 0) {
      finalBuf = srcBuf
    } else {
      // Adjust OfflineAudioContext length for the pitch-shift rate so the full
      // decay is captured (faster rate → shorter audio; slower → longer)
      const rate        = Math.pow(2, semitones / 12)
      const shiftedDur  = srcBuf.duration / rate
      const ctx         = new OfflineAudioContext(2, Math.ceil(shiftedDur * SR), SR)
      const src         = ctx.createBufferSource()
      src.buffer        = srcBuf
      src.detune.value  = semitones * 100
      src.connect(ctx.destination)
      src.start(0)
      finalBuf = await ctx.startRendering()
    }

    const name = `${SF_NOTE_SHARP[midi % 12]}${Math.floor(midi / 12) - 1}`
    entries.push({
      id:         crypto.randomUUID(),
      name,
      category:   'custom',
      audioBlob:  toWavBlob(finalBuf),
      duration:   finalBuf.duration,
      addedAt:    now,
      folder:     folderName,
      renderSpec: { kind: 'soundfont', beatType: 'custom', midiNote: midi, duration: finalBuf.duration, channels: 2 },
    })

    onProgress?.(midi - loNote + 1, total)
  }

  // Persist sequentially to avoid IDB write contention
  for (const e of entries) await libraryAdd(e)
  return { count: entries.length, loNote, hiNote }
}

async function fetchSoundfont(url: string): Promise<Record<string, string>> {
  if (sfCache.has(url)) return sfCache.get(url)!
  const resp = await fetch(url)
  if (!resp.ok) throw new Error(`Soundfont fetch failed: ${resp.status}`)
  const text  = await resp.text()
  // Format: MIDI.Soundfont.viola = { "A0": "data:audio/mp3;base64,...", ... };
  // Find the last '= {' to skip preamble variable declarations like 'var MIDI = {}'
  const assignIdx = text.lastIndexOf('= {')
  const start = assignIdx >= 0 ? text.indexOf('{', assignIdx) : text.indexOf('{')
  const end   = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) throw new Error('Could not parse soundfont JS')
  // The file has a trailing comma before the closing brace which JSON.parse rejects
  const raw = text.slice(start, end + 1).replace(/,\s*}$/, '}')
  const map = JSON.parse(raw) as Record<string, string>
  sfCache.set(url, map)
  return map
}

export async function renderSoundfont(
  soundfontUrl: string,
  targetMidi:   number,
): Promise<AudioBuffer> {
  const map           = await fetchSoundfont(soundfontUrl)
  const available     = Object.keys(map).map(sfKeyToMidi).filter(m => m >= 0)
  if (available.length === 0) throw new Error('Soundfont has no usable notes')

  const nearestMidi   = available.reduce((best, m) =>
    Math.abs(m - targetMidi) < Math.abs(best - targetMidi) ? m : best
  )
  const semitones     = targetMidi - nearestMidi
  const dataUrl       = map[midiToSfKey(nearestMidi)]
  if (!dataUrl) throw new Error(`No sample for ${midiToSfKey(nearestMidi)} in soundfont`)

  // Decode base64 data URL → ArrayBuffer
  const base64  = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary  = atob(base64)
  const bytes   = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  // Decode MP3 to AudioBuffer via a temporary AudioContext
  const tmpCtx   = new AudioContext()
  const sourceBuf = await tmpCtx.decodeAudioData(bytes.buffer)
  tmpCtx.close()

  // Render with optional pitch-shift into an OfflineAudioContext
  const SR      = 44100
  const dur     = sourceBuf.duration   // use the sample's natural length
  const ctx     = new OfflineAudioContext(2, Math.ceil(dur * SR), SR)
  const src     = ctx.createBufferSource()
  src.buffer    = sourceBuf
  if (semitones !== 0) src.detune.value = semitones * 100
  src.connect(ctx.destination)
  src.start(0)
  return ctx.startRendering()
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
  { type: 'piano-grand',    folder: 'Piano – All Notes',          minMidi: 36, maxMidi: 84, duration: 4.5, channels: 2 },
  { type: 'piano-electric', folder: 'Elec. Piano – All Notes',    minMidi: 36, maxMidi: 84, duration: 4.0, channels: 2 },
  { type: 'piano-rhodes',   folder: 'Rhodes – All Notes',         minMidi: 36, maxMidi: 84, duration: 4.0, channels: 2 },
  { type: 'synth-lead',     folder: 'Synth Lead – All Notes',     minMidi: 48, maxMidi: 72, duration: 3.0, channels: 1 },
  { type: 'synth-strings',  folder: 'Strings – All Notes',        minMidi: 36, maxMidi: 84, duration: 4.5, channels: 2 },
  { type: 'synth-organ',    folder: 'Organ – All Notes',          minMidi: 36, maxMidi: 84, duration: 3.5, channels: 2 },
  { type: 'synth-choir',    folder: 'Choir – All Notes',          minMidi: 36, maxMidi: 84, duration: 3.8, channels: 2 },
  { type: 'synth-bass',     folder: 'Bass – All Notes',           minMidi: 24, maxMidi: 48, duration: 3.5, channels: 1 },
  { type: 'synth-dark',     folder: 'Dark Synth – All Notes',     minMidi: 36, maxMidi: 72, duration: 4.0, channels: 2 },
  { type: 'synth-pluck',    folder: 'Metallic Pluck – All Notes', minMidi: 36, maxMidi: 72, duration: 1.3, channels: 1 },
  { type: 'violin',         folder: 'Violin – All Notes',         minMidi: 55, maxMidi: 88, duration: 4.0, channels: 2 },
  { type: 'viola',          folder: 'Viola – All Notes',          minMidi: 48, maxMidi: 77, duration: 4.0, channels: 2 },
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
    } else if (spec.kind === 'soundfont' && spec.soundfontUrl) {
      buf = await renderSoundfont(spec.soundfontUrl, spec.midiNote ?? 60)
    } else {
      buf = await renderMelodic(spec.beatType as BeatType, spec.midiNote ?? 60, spec.duration, spec.channels)
    }
    const fulfilled: LibraryEntry = { ...entry, audioBlob: toWavBlob(buf), duration: buf.duration }
    libraryAdd(fulfilled).catch(() => {})  // best-effort cache; don't fail if storage quota exceeded
    return fulfilled
  } catch (err) {
    console.error('[libraryFulfill] render failed for', id, err)
    return null
  }
}

// ── Public entry points ───────────────────────────────────────────────────────

async function dedupLibrary(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(DEDUP_KEY)) return
  const all = await libraryGetAll()
  // Group by folder+name; keep the most recent, delete the rest
  const seen = new Map<string, LibraryEntry>()
  const toDelete: string[] = []
  for (const e of all) {
    const key = `${e.folder ?? ''}|${e.name}`
    const prev = seen.get(key)
    if (!prev) { seen.set(key, e); continue }
    // Keep whichever was added later (or has a blob already)
    const keepNew = !prev.audioBlob && (e.audioBlob || e.addedAt > prev.addedAt)
    if (keepNew) { toDelete.push(prev.id); seen.set(key, e) }
    else { toDelete.push(e.id) }
  }
  await Promise.all(toDelete.map(id => libraryDelete(id)))
  localStorage.setItem(DEDUP_KEY, '1')
}

export async function seedDefaultSamples(): Promise<void> {
  if (typeof window === 'undefined') return
  dedupLibrary().catch(() => {})
  if (localStorage.getItem(SEEDED_KEY)) {
    seedKeyboardNotes().catch(() => {})
    seedDarkwave().catch(() => {})
    seedStrings().catch(() => {})
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
  seedStrings().catch(() => {})
}

export async function seedStrings(): Promise<void> {
  if (typeof window === 'undefined') return
  if (localStorage.getItem(STRINGS_SEEDED_KEY)) return

  // Remove old synthesized violin/viola stubs (v1 — kind: 'melodic')
  const existing = await libraryGetAll()
  const oldStubs = existing.filter(e =>
    (e.folder === 'Violin – All Notes' || e.folder === 'Viola – All Notes' || e.folder === 'Strings') &&
    e.renderSpec?.kind === 'melodic' &&
    (e.category === 'violin' || e.category === 'viola')
  )
  await Promise.all(oldStubs.map(e => libraryDelete(e.id)))

  const now = new Date().toISOString()

  // Single accessible entries — one playable sample per instrument in the "Strings" sub-folder
  // A4 (69) for violin (open A string), A3 (57) for viola (open A string)
  const SINGLES = [
    { name: 'Violin', category: 'violin' as LibraryCategory, midi: 69, url: VIOLIN_SF_URL },
    { name: 'Viola',  category: 'viola'  as LibraryCategory, midi: 57, url: VIOLA_SF_URL  },
  ]
  for (const s of SINGLES) {
    await libraryAdd(makeStub(s.name, s.category, {
      kind: 'soundfont', beatType: s.category, midiNote: s.midi,
      duration: 4.0, channels: 2, soundfontUrl: s.url,
    }, 'Strings', now))
  }

  // Per-note folders — used by MIDI presets (one entry per MIDI note)
  const stringPresets = KEYBOARD_PRESETS.filter(p => p.type === 'violin' || p.type === 'viola')
  for (const preset of stringPresets) {
    const soundfontUrl = preset.type === 'violin' ? VIOLIN_SF_URL : VIOLA_SF_URL
    for (let midi = preset.minMidi; midi <= preset.maxMidi; midi++) {
      await libraryAdd(makeStub(midiNoteName(midi), preset.type as LibraryCategory, {
        kind: 'soundfont',
        beatType: preset.type,
        midiNote: midi,
        duration: preset.duration,
        channels: preset.channels,
        soundfontUrl,
      }, preset.folder, now))
    }
  }

  localStorage.setItem(STRINGS_SEEDED_KEY, '1')
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

  // Violin/viola are exclusively seeded by seedStrings() to avoid duplicates
  const nonStringPresets = KEYBOARD_PRESETS.filter(p => p.type !== 'violin' && p.type !== 'viola')
  for (const preset of nonStringPresets) {
    for (let midi = preset.minMidi; midi <= preset.maxMidi; midi++) {
      await libraryAdd(makeStub(midiNoteName(midi), preset.type as LibraryCategory, {
        kind: 'melodic', beatType: preset.type, midiNote: midi,
        duration: preset.duration, channels: preset.channels,
      }, preset.folder, now))
    }
  }

  localStorage.setItem(NOTES_SEEDED_KEY, '1')
}
