/**
 * User sound library — persisted in IndexedDB.
 *
 * Each entry stores a recorded or uploaded audio clip alongside its full
 * perceptual fingerprint (HitSpectral). The library serves two purposes:
 *   1. User-facing: browse, play, and manage personal sound samples.
 *   2. Machine-facing: reference samples the classifier can compare against
 *      when the dual-sided ML pipeline (see beat-analyzer.ts roadmap) is active.
 */

import type { BeatType, HitSpectral } from './beat-analyzer'

export type LibraryCategory = BeatType | 'voice' | 'custom'

/** Enough info to re-render a synthesized entry on demand (lazy download). */
export interface RenderSpec {
  kind:      'drum' | 'melodic'
  beatType:  string    // BeatType string — avoids circular import
  midiNote?: number
  duration:  number
  channels:  number
}

export interface LibraryEntry {
  id:           string
  name:         string
  category:     LibraryCategory
  audioBlob?:   Blob           // undefined = stub not yet rendered
  renderSpec?:  RenderSpec     // present on auto-generated 100lights entries
  spectral?:    HitSpectral   // perceptual fingerprint — set for drum/instrument entries
  duration:     number        // seconds
  addedAt:      string        // ISO timestamp
  folder?:      string        // sub-folder name
  parentFolder?: string       // parent group (e.g. "100lights Audio") — read-only, set at creation
}

// ── IndexedDB setup ───────────────────────────────────────────────────────────

const DB_NAME    = 'contentforge-sound-library'
const DB_VERSION = 1
const STORE      = 'entries'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('category', 'category', { unique: false })
        store.createIndex('addedAt',  'addedAt',  { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function tx<T>(
  db:    IDBDatabase,
  mode:  IDBTransactionMode,
  fn:    (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function libraryGetAll(): Promise<LibraryEntry[]> {
  const db = await openDB()
  return tx<LibraryEntry[]>(db, 'readonly', s => s.getAll())
}

export async function libraryAdd(entry: LibraryEntry): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.put(entry))
}

export async function libraryGetById(id: string): Promise<LibraryEntry | null> {
  const db = await openDB()
  return tx<LibraryEntry | null>(db, 'readonly', s => s.get(id) as IDBRequest<LibraryEntry | null>)
}

export async function libraryUpdate(id: string, patch: Partial<Omit<LibraryEntry, 'id'>>): Promise<void> {
  const db = await openDB()
  const existing = await tx<LibraryEntry>(db, 'readonly', s => s.get(id))
  if (!existing) return
  await tx(db, 'readwrite', s => s.put({ ...existing, ...patch }))
}

export async function libraryDelete(id: string): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.delete(id))
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function blobToUrl(blob: Blob): string {
  return URL.createObjectURL(blob)
}

export function getAudioDurationFromBlob(blob: Blob): Promise<number> {
  return new Promise(resolve => {
    const url = URL.createObjectURL(blob)
    const el  = document.createElement('audio')
    el.src    = url
    el.addEventListener('durationchange', () => {
      URL.revokeObjectURL(url)
      resolve(isFinite(el.duration) ? el.duration : 0)
    }, { once: true })
    el.addEventListener('error', () => { URL.revokeObjectURL(url); resolve(0) }, { once: true })
    setTimeout(() => { URL.revokeObjectURL(url); resolve(0) }, 3000)
  })
}

export const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  kick:              'Kick',
  snare:             'Snare',
  hihat:             'Hi-Hat',
  'open-hihat':      'Open Hi-Hat',
  clap:              'Clap',
  tom:               'Tom',
  crash:             'Crash',
  rim:               'Rim',
  'guitar-acoustic': 'Acoustic Guitar',
  'guitar-electric': 'Electric Guitar',
  'guitar-nylon':    'Nylon Guitar',
  'piano-grand':     'Grand Piano',
  'piano-electric':  'Electric Piano',
  'piano-rhodes':    'Rhodes',
  'synth-lead':      'Synth Lead',
  'synth-pad':       'Synth Pad',
  'synth-bass':      'Synth Bass',
  'synth-arp':       'Synth Arp',
  'synth-strings':   'Strings',
  'synth-organ':     'Organ',
  'synth-choir':     'Choir',
  'synth-dark':      'Dark Synth',
  'synth-drone':     'Drone',
  'synth-pluck':     'Metallic Pluck',
  other:             'Other',
  voice:             'Voice',
  custom:            'Custom',
}

export const CATEGORY_GROUPS: Array<{ label: string; categories: LibraryCategory[] }> = [
  { label: 'Drums',    categories: ['kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'crash', 'rim'] },
  { label: 'Guitar',   categories: ['guitar-acoustic', 'guitar-electric', 'guitar-nylon'] },
  { label: 'Piano',    categories: ['piano-grand', 'piano-electric', 'piano-rhodes'] },
  { label: 'Synth',    categories: ['synth-lead', 'synth-pad', 'synth-bass', 'synth-arp', 'synth-strings', 'synth-organ', 'synth-choir'] },
  { label: 'Darkwave', categories: ['synth-dark', 'synth-drone', 'synth-pluck'] },
  { label: 'Other',    categories: ['voice', 'other', 'custom'] },
]

export const LIBRARY_CATEGORIES: LibraryCategory[] = CATEGORY_GROUPS.flatMap(g => g.categories)
