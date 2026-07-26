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
  /** true once this entry lives in the account's server library (see
   *  library-sync below). Set on entries pulled down from another device, and
   *  on local entries after a successful push — gates re-pushing. */
  synced?:      boolean
  /** Materialised from the official global catalog (admin-curated). Read-only:
   *  the user can't delete it (a delete would just re-sync), and it's shared
   *  across every account. Local id is `catalog_<catalogId>`. */
  catalog?:     boolean
}

/** Built-in/official entries a user must not delete — deterministic synth seeds
 *  (`100l_`) and materialised catalog sounds (`catalog_`). */
export function isProtectedSound(id: string): boolean {
  return id.startsWith('100l_') || id.startsWith('catalog_')
}

// ── User scoping ──────────────────────────────────────────────────────────────

let _userId: string | null = null
let _catalogPulled = false

/** Call once when the authenticated user is known. Scopes the IndexedDB to that
 *  user and pulls any sounds they added on other devices into this one. */
export function initLibrary(userId: string | null) {
  const changed = userId !== _userId
  _userId = userId
  if (userId && changed) {
    void syncLibrary()  // audio samples — background; safe to ignore
    // Presets / kits / patterns sync too (dynamic import avoids a static cycle).
    import('./user-library-sync').then(m => m.setLibraryUser(userId)).catch(() => {})
  }
  // The official catalog ships to everyone, signed in or not — pull it once.
  if (!_catalogPulled) { _catalogPulled = true; void syncCatalog() }
}
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
  // Mirror the user's own recorded/uploaded sounds up to their account so they
  // appear on their other devices. Fire-and-forget — never block the local add.
  void pushSound(entry)
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
  void deleteRemote(id)  // keep the account library in step; best-effort
}

// ── Account sync (cross-device) ─────────────────────────────────────────────────
//
// The IndexedDB above is per-device. This layer mirrors the user's OWN
// recorded/uploaded sounds to their account (server: /api/library + R2) so they
// follow them to other devices. Deliberately NOT synced: renderSpec built-ins
// (deterministic — regenerated identically everywhere) and communityRef imports
// (already server-side, streamed from the community item). Everything here is
// best-effort and never blocks the local library — offline just means no sync.

const AUDIO_EXT: Record<string, string> = {
  'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/wave': '.wav',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
  'audio/mp4': '.m4a', 'audio/aac': '.aac', 'audio/flac': '.flac',
}

/** A sound is the user's own (syncable) when it has a local blob and isn't a
 *  built-in synth (renderSpec) or a community import (communityRef). */
function isSyncable(e: LibraryEntry): boolean {
  return !!e.audioBlob && !e.renderSpec && !e.communityRef
}

/** Upload one entry's audio to the account library. No-op unless it's the
 *  user's own sound, they're signed in, and it isn't already synced. */
export async function pushSound(entry: LibraryEntry): Promise<void> {
  if (typeof window === 'undefined' || !_userId) return
  if (entry.synced || !isSyncable(entry) || !entry.audioBlob) return
  try {
    const blob = entry.audioBlob
    const type = blob.type || 'audio/wav'
    const ext  = AUDIO_EXT[type] ?? '.wav'
    // 1) presign an R2 slot under the user's namespace
    const pres = await fetch('/api/media/presign-upload', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: `${entry.id}${ext}`, contentType: type, mediaId: entry.id, size: blob.size }),
    })
    if (!pres.ok) return
    const { uploadUrl, key } = await pres.json() as { uploadUrl: string; key: string }
    // 2) PUT the blob straight to R2
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': type }, body: blob })
    if (!put.ok) return
    // 3) register metadata
    const reg = await fetch('/api/library', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: entry.id, name: entry.name, category: entry.category, r2Key: key,
        duration: entry.duration, contentType: type,
        folder: entry.folder, parentFolder: entry.parentFolder,
        tags: entry.tags, key: entry.key, bpm: entry.bpm,
      }),
    })
    if (!reg.ok) return
    // Mark synced so we don't re-upload on the next add/scan.
    await libraryUpdate(entry.id, { synced: true })
  } catch { /* offline or transient — try again next time the entry is touched */ }
}

/** Remove a sound from the account library (best-effort). */
export async function deleteRemote(id: string): Promise<void> {
  if (typeof window === 'undefined' || !_userId) return
  try { await fetch(`/api/library?id=${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  catch { /* best-effort */ }
}

interface SyncedRow {
  id: string; name: string; category: LibraryCategory; r2Key: string
  duration: number; contentType?: string
  folder?: string; parentFolder?: string; tags?: string[]; key?: string; bpm?: number
}

/** Pull sounds this account has that this device doesn't, downloading each blob
 *  once so it becomes an ordinary local entry (the play path never changes).
 *  Also pushes any local-only user sounds that predate sync. Idempotent. */
export async function syncLibrary(): Promise<void> {
  if (typeof window === 'undefined' || !_userId) return
  try {
    const res = await fetch('/api/library')
    if (!res.ok) return
    const rows = await res.json() as SyncedRow[]
    const local = await libraryGetAll()
    const localIds = new Set(local.map(e => e.id))

    // Down: fetch anything the account has that this device is missing.
    for (const row of rows) {
      if (localIds.has(row.id)) continue
      try {
        const su = await fetch(`/api/media/signed-url?key=${encodeURIComponent(row.r2Key)}`)
        if (!su.ok) continue
        const { url } = await su.json() as { url: string }
        const audio = await fetch(url)
        if (!audio.ok) continue
        const audioBlob = await audio.blob()
        await libraryAdd({
          id: row.id, name: row.name, category: row.category, audioBlob,
          duration: row.duration ?? 0, addedAt: new Date().toISOString(),
          folder: row.folder, parentFolder: row.parentFolder,
          tags: row.tags, key: row.key, bpm: row.bpm, synced: true,
        })
      } catch { /* skip this one, keep going */ }
    }

    // Up: any local user sound not yet on the server (e.g. recorded before sync
    // existed, or a failed earlier push).
    const remoteIds = new Set(rows.map(r => r.id))
    for (const e of local) {
      if (!e.synced && isSyncable(e) && !remoteIds.has(e.id)) await pushSound(e)
    }
  } catch { /* offline — no problem, local library is untouched */ }
}

interface CatalogItem {
  id: string; name: string; category: string; url: string; duration?: number
  folder?: string; parentFolder?: string; tags?: string[]; key?: string; bpm?: number
}

/** Pull the official global catalog into this device's library: download each
 *  new entry's audio once (id `catalog_<id>`), and drop any the admin removed.
 *  Runs for every user, signed in or not. Idempotent. */
export async function syncCatalog(): Promise<void> {
  if (typeof window === 'undefined') return
  try {
    // no-store so this background sync always sees the current catalog —
    // otherwise a browser-cached list would delay additions/removals ~a minute.
    const res = await fetch('/api/catalog', { cache: 'no-store' })
    if (!res.ok) return
    const { items } = await res.json() as { items: CatalogItem[] }
    const local = await libraryGetAll()
    const localIds = new Set(local.map(e => e.id))
    const wantIds = new Set(items.map(it => `catalog_${it.id}`))

    for (const it of items) {
      const lid = `catalog_${it.id}`
      if (localIds.has(lid)) continue
      try {
        const audio = await fetch(it.url)
        if (!audio.ok) continue
        const audioBlob = await audio.blob()
        await libraryAdd({
          id: lid, name: it.name, category: (it.category as LibraryCategory) || 'custom', audioBlob,
          duration: it.duration ?? 0, addedAt: new Date().toISOString(),
          folder: it.folder, parentFolder: it.parentFolder ?? '100Lights Catalog',
          tags: it.tags, key: it.key, bpm: it.bpm, catalog: true,
        })
      } catch { /* skip this one, keep going */ }
    }

    // Reconcile removals: drop local catalog entries the admin took down.
    for (const e of local) {
      if (e.catalog && e.id.startsWith('catalog_') && !wantIds.has(e.id)) {
        try { await libraryDelete(e.id) } catch { /* keep going */ }
      }
    }
  } catch { /* offline — keep local library untouched */ }
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
