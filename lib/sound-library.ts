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
  kind:          'drum' | 'melodic' | 'soundfont'
  beatType:      string    // BeatType string — avoids circular import
  midiNote?:     number
  duration:      number
  channels:      number
  soundfontUrl?: string    // for kind === 'soundfont': URL of the midi-js-soundfont JS file
}

export interface LibraryEntry {
  id:           string
  name:         string
  category:     LibraryCategory
  audioBlob?:   Blob           // undefined = stub not yet rendered
  renderSpec?:  RenderSpec     // present on auto-generated 100lights entries
  /** Community-linked entries: no local copy — audio streams from the item's
   *  public URL on first use, then caches. Keeps imports nearly free. */
  communityRef?: { itemId: string; sampleIndex?: number }
  /** Who shared it (community imports) — shown in the library */
  authorName?:  string
  spectral?:    HitSpectral   // perceptual fingerprint — set for drum/instrument entries
  duration:     number        // seconds
  addedAt:      string        // ISO timestamp
  folder?:      string        // sub-folder name
  parentFolder?: string       // parent group (e.g. "100lights Audio") — read-only, set at creation
  tags?:        string[]      // free-form tags for filtering (e.g. ['Dark', 'Hard'])
  key?:         string        // musical key (e.g. 'C', 'F#', 'Bb')
  bpm?:         number        // tempo of the sample
}

// ── User scoping ──────────────────────────────────────────────────────────────

let _userId: string | null = null

/** Call once when the authenticated user is known. Scopes the IndexedDB to that user. */
export function initLibrary(userId: string | null) { _userId = userId }
export function getLibraryUserId(): string | null { return _userId }

// ── IndexedDB setup ───────────────────────────────────────────────────────────

const DB_VERSION = 1
const STORE      = 'entries'

function getDbName() {
  return _userId ? `contentforge-sound-library-${_userId}` : 'contentforge-sound-library'
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(getDbName(), DB_VERSION)
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
  '808':             '808',
  ride:              'Ride',
  shaker:            'Shaker',
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
  violin:            'Violin',
  viola:             'Viola',
  other:             'Other',
  voice:             'Voice',
  custom:            'Custom',
}

export const CATEGORY_GROUPS: Array<{ label: string; categories: LibraryCategory[] }> = [
  { label: 'Drums',    categories: ['kick', '808', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'crash', 'ride', 'rim', 'shaker'] },
  { label: 'Guitar',   categories: ['guitar-acoustic', 'guitar-electric', 'guitar-nylon'] },
  { label: 'Piano',    categories: ['piano-grand', 'piano-electric', 'piano-rhodes'] },
  { label: 'Strings',  categories: ['violin', 'viola'] },
  { label: 'Synth',    categories: ['synth-lead', 'synth-pad', 'synth-bass', 'synth-arp', 'synth-strings', 'synth-organ', 'synth-choir'] },
  { label: 'Darkwave', categories: ['synth-dark', 'synth-drone', 'synth-pluck'] },
  { label: 'Other',    categories: ['voice', 'other', 'custom'] },
]

export const LIBRARY_CATEGORIES: LibraryCategory[] = CATEGORY_GROUPS.flatMap(g => g.categories)

// ── Filter tag system ─────────────────────────────────────────────────────────

/** Ordered list of type tags shown in the filter bar */
export const TYPE_TAGS = ['Drums', 'Percussion', 'Bass', 'Lead', 'Keys', 'Pad', 'Guitar', 'Strings', 'Arp', 'Brass', 'Wind', 'Voice', 'FX'] as const
export type TypeTag = typeof TYPE_TAGS[number]

/** Ordered list of character tags shown in the filter bar */
export const CHARACTER_TAGS = ['Dark', 'Bright', 'Warm', 'Hard', 'Soft', 'Ambient', 'Crunchy', 'Glitchy'] as const
export type CharacterTag = typeof CHARACTER_TAGS[number]

/** Maps each LibraryCategory to a type tag for filter chip matching */
export const CATEGORY_TO_TYPE_TAG: Record<LibraryCategory, TypeTag | null> = {
  kick:              'Drums',
  snare:             'Drums',
  hihat:             'Drums',
  'open-hihat':      'Drums',
  clap:              'Drums',
  tom:               'Drums',
  crash:             'Drums',
  rim:               'Drums',
  '808':             'Drums',
  ride:              'Drums',
  shaker:            'Percussion',
  'guitar-acoustic': 'Guitar',
  'guitar-electric': 'Guitar',
  'guitar-nylon':    'Guitar',
  'piano-grand':     'Keys',
  'piano-electric':  'Keys',
  'piano-rhodes':    'Keys',
  'synth-lead':      'Lead',
  'synth-pad':       'Pad',
  'synth-bass':      'Bass',
  'synth-arp':       'Arp',
  'synth-strings':   'Strings',
  'synth-organ':     'Keys',
  'synth-choir':     'Voice',
  'synth-dark':      'Lead',
  'synth-drone':     'FX',
  'synth-pluck':     'Lead',
  violin:            'Strings',
  viola:             'Strings',
  other:             null,
  voice:             'Voice',
  custom:            null,
}

/** Maps each LibraryCategory to implicit character tags */
export const CATEGORY_CHAR_TAGS: Partial<Record<LibraryCategory, string[]>> = {
  kick:         ['Hard'],
  '808':        ['Dark', 'Hard'],
  ride:         ['Bright'],
  shaker:       ['Bright'],
  snare:        ['Hard'],
  hihat:        ['Bright'],
  'open-hihat': ['Bright'],
  crash:        ['Bright', 'Hard'],
  'synth-bass': ['Dark', 'Warm'],
  'synth-dark': ['Dark'],
  'synth-drone':['Dark', 'Ambient'],
  'synth-pluck':['Hard'],
  'synth-pad':  ['Warm', 'Ambient', 'Soft'],
  'synth-strings': ['Warm', 'Soft'],
  'piano-grand': ['Bright', 'Warm'],
  'piano-rhodes': ['Warm', 'Soft'],
  'synth-lead': ['Bright'],
  violin:       ['Bright', 'Warm'],
  viola:        ['Warm', 'Soft'],
}
