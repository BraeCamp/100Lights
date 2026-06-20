/**
 * Sample pack — per-type audio samples stored in IndexedDB.
 *
 * Each BeatType slot can hold one "active" sample. The admin panel seeds
 * defaults by rendering the current synth sounds to WAV blobs. Admins can
 * then replace any slot with a real recording or upload.
 *
 * BeatLab loads all active samples on mount. When a hit plays, we look up
 * the AudioBuffer for its type and play it at the hit's velocity, falling
 * back to the synth if no sample is stored.
 */

import type { BeatType } from './beat-analyzer'
import { DRUM_BEAT_TYPES } from './beat-analyzer'
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
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────

const DB_NAME    = 'contentforge-sample-pack'
const DB_VERSION = 1
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

export async function sampleGetAll(): Promise<SampleEntry[]> {
  const db = await openDB()
  return tx<SampleEntry[]>(db, 'readonly', s => s.getAll())
}

export async function sampleGetByType(beatType: BeatType): Promise<SampleEntry | undefined> {
  const db  = await openDB()
  const all = await tx<SampleEntry[]>(db, 'readonly', s => s.index('beatType').getAll(beatType))
  // Most recently added non-default wins; else default
  return all.sort((a, b) => b.addedAt.localeCompare(a.addedAt))[0]
}

export async function samplePut(entry: SampleEntry): Promise<void> {
  const db = await openDB()
  // Remove any existing entry for this beatType first (one active sample per type)
  const existing = await tx<SampleEntry[]>(db, 'readonly', s => s.index('beatType').getAll(entry.beatType))
  if (existing.length > 0) {
    for (const e of existing) {
      await tx<undefined>(db, 'readwrite', s => s.delete(e.id))
    }
  }
  await tx(db, 'readwrite', s => s.put(entry))
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

function audioBufferToWav(buffer: AudioBuffer): Blob {
  const data       = buffer.getChannelData(0)
  const numSamples = data.length
  const ab         = new ArrayBuffer(44 + numSamples * 2)
  const view       = new DataView(ab)

  function writeStr(offset: number, s: string) {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i))
  }

  writeStr(0,  'RIFF')
  view.setUint32(4,  36 + numSamples * 2, true)
  writeStr(8,  'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)                     // PCM
  view.setUint16(22, 1, true)                     // mono
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, numSamples * 2, true)

  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, data[i]))
    view.setInt16(44 + i * 2, s * 0x7fff, true)
  }
  return new Blob([ab], { type: 'audio/wav' })
}

// ── Synth renderer — pre-render a type to a WAV blob ──────────────────────────

export async function renderSynthSample(type: BeatType, note = 60, durationSec = 2): Promise<Blob> {
  const sr  = 44100
  const len = Math.ceil(sr * durationSec)
  // OfflineAudioContext is only available in browser; this is only called from client
  const ctx = new (window.OfflineAudioContext || (window as unknown as Record<string, unknown>)['webkitOfflineAudioContext'] as typeof OfflineAudioContext)(1, len, sr) as OfflineAudioContext

  if (MELODIC_TYPES.has(type)) {
    playMelodicNote(ctx as unknown as AudioContext, type, note, 0, 0.8)
  } else {
    playDrumHit(ctx as unknown as AudioContext, 'synth', type, 0, 0.8, note, durationSec * 0.8)
  }

  const buffer = await ctx.startRendering()
  return audioBufferToWav(buffer)
}

// ── All drum + melodic types for the sample panel ─────────────────────────────

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
