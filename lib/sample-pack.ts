/**
 * Sample pack — per-type audio samples stored in IndexedDB.
 *
 * Multiple variations can be stored per BeatType. Exactly one has isActive=true
 * and is used for playback. Root note enables pitch-shifted playback so a single
 * sample can play at any MIDI note via AudioBufferSourceNode.playbackRate.
 */

import type { BeatType } from './beat-analyzer'
import { DRUM_BEAT_TYPES, DEFAULT_NOTES } from './beat-analyzer'
import { playDrumHit } from './drum-samples'
import { playMelodicNote, MELODIC_TYPES } from './instrument-synth'

export interface SampleEntry {
  id:        string
  beatType:  BeatType
  name:      string
  audioBlob: Blob
  duration:  number
  addedAt:   string
  isDefault: boolean
  isActive:  boolean  // one active per type; others are variations
  rootNote:  number   // MIDI note the sample was recorded/rendered at
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────

const DB_NAME    = 'contentforge-sample-pack'
const DB_VERSION = 2  // bumped to add isActive + rootNote fields
const STORE      = 'samples'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const s = db.createObjectStore(STORE, { keyPath: 'id' })
        s.createIndex('beatType', 'beatType', { unique: false })
      }
      // Version 2: no structural change needed; fields are stored as object properties
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function normalize(e: SampleEntry): SampleEntry {
  return {
    ...e,
    isActive:  e.isActive  ?? true,   // old entries without field default to active
    rootNote:  e.rootNote  ?? (DEFAULT_NOTES[e.beatType] ?? 60),
    isDefault: e.isDefault ?? true,
  }
}

export async function sampleGetAll(): Promise<SampleEntry[]> {
  const db  = await openDB()
  const raw = await tx<SampleEntry[]>(db, 'readonly', s => s.getAll())
  return raw.map(normalize)
}

export async function sampleGetAllByType(beatType: BeatType): Promise<SampleEntry[]> {
  const db  = await openDB()
  const raw = await tx<SampleEntry[]>(db, 'readonly', s => s.index('beatType').getAll(beatType))
  return raw.map(normalize).sort((a, b) => b.addedAt.localeCompare(a.addedAt))
}

export async function sampleGetActive(beatType: BeatType): Promise<SampleEntry | undefined> {
  const all = await sampleGetAllByType(beatType)
  return all.find(e => e.isActive) ?? all[0]
}

// Add a new variation. If isActive=true, deactivates all others for this type.
export async function samplePut(entry: SampleEntry): Promise<void> {
  const db = await openDB()
  if (entry.isActive) {
    const existing = await tx<SampleEntry[]>(db, 'readonly', s => s.index('beatType').getAll(entry.beatType))
    for (const e of existing) {
      if (e.id !== entry.id && e.isActive) {
        await tx(db, 'readwrite', s => s.put({ ...e, isActive: false }))
      }
    }
  }
  await tx(db, 'readwrite', s => s.put(normalize(entry)))
}

// Set one variation as active, deactivate all others for its type.
export async function sampleSetActive(id: string, beatType: BeatType): Promise<void> {
  const db      = await openDB()
  const existing = await tx<SampleEntry[]>(db, 'readonly', s => s.index('beatType').getAll(beatType))
  for (const e of existing) {
    await tx(db, 'readwrite', s => s.put({ ...normalize(e), isActive: e.id === id }))
  }
}

export async function sampleDelete(id: string): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.delete(id))
}

export async function sampleClear(): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.clear())
}

// ── WAV encoder ───────────────────────────────────────────────────────────────

export function audioBufferToWav(buffer: AudioBuffer): Blob {
  const data       = buffer.getChannelData(0)
  const numSamples = data.length
  const ab         = new ArrayBuffer(44 + numSamples * 2)
  const view       = new DataView(ab)

  function writeStr(offset: number, s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF'); view.setUint32(4, 36 + numSamples * 2, true)
  writeStr(8, 'WAVE'); writeStr(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * 2, true); view.setUint16(32, 2, true)
  view.setUint16(34, 16, true); writeStr(36, 'data')
  view.setUint32(40, numSamples * 2, true)

  for (let i = 0; i < numSamples; i++) {
    view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true)
  }
  return new Blob([ab], { type: 'audio/wav' })
}

// ── Synth renderer ────────────────────────────────────────────────────────────

export async function renderSynthSample(type: BeatType, note = 60, durationSec = 2): Promise<{ blob: Blob; rootNote: number }> {
  const sr  = 44100
  const len = Math.ceil(sr * durationSec)
  const ctx = new OfflineAudioContext(1, len, sr)

  if (MELODIC_TYPES.has(type)) {
    playMelodicNote(ctx as unknown as AudioContext, type, note, 0, 0.8)
  } else {
    playDrumHit(ctx as unknown as AudioContext, 'synth', type, 0, 0.8, note, durationSec * 0.8)
  }

  const buffer = await ctx.startRendering()
  return { blob: audioBufferToWav(buffer), rootNote: note }
}

// ── All types available in the sample panel ───────────────────────────────────

export const SAMPLE_PACK_TYPES: BeatType[] = [
  ...DRUM_BEAT_TYPES,
  'guitar-acoustic', 'guitar-electric', 'piano-grand', 'piano-electric',
  'piano-rhodes', 'synth-lead', 'synth-pad', 'synth-bass', 'synth-arp', 'other',
]

export const SAMPLE_TYPE_LABELS: Partial<Record<BeatType, string>> = {
  kick: 'Kick', snare: 'Snare', hihat: 'Hi-Hat', 'open-hihat': 'Open Hi-Hat',
  clap: 'Clap', tom: 'Tom', crash: 'Crash', rim: 'Rim',
  'guitar-acoustic': 'Acoustic Guitar', 'guitar-electric': 'Electric Guitar',
  'guitar-nylon': 'Nylon Guitar', 'piano-grand': 'Grand Piano',
  'piano-electric': 'Electric Piano', 'piano-rhodes': 'Rhodes',
  'synth-lead': 'Synth Lead', 'synth-pad': 'Synth Pad',
  'synth-bass': 'Synth Bass', 'synth-arp': 'Synth Arp', other: 'Other',
}
