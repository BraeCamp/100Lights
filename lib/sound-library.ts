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

import type { LibraryCategory } from './sound-tags'
export type { LibraryCategory }

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
  /** This user's own tags. Never leave this device's account, never overwritten
   *  by a catalog refresh — see Taggable.userTags in lib/sound-tags. */
  userTags?:    string[]
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
  /** Where a catalog entry's audio lives. Present INSTEAD of audioBlob until
   *  the sound is first used — see the note on syncCatalog. */
  catalogUrl?:  string
}

/** Built-in/official entries a user must not delete — deterministic synth seeds
 *  (`100l_`) and materialised catalog sounds (`catalog_`). */
export function isProtectedSound(id: string): boolean {
  return id.startsWith('100l_') || id.startsWith('catalog_')
}

// ── User scoping ──────────────────────────────────────────────────────────────

let _userId: string | null = null
let _catalogPulled = false
let _persistAsked = false

/** Call once when the authenticated user is known. Scopes the IndexedDB to that
 *  user and pulls any sounds they added on other devices into this one. */
export function initLibrary(userId: string | null) {
  const changed = userId !== _userId
  _userId = userId
  // Different user means a different database — the snapshot is for the old one.
  if (changed) cacheReset()
  // Ask the browser to protect our IndexedDB from storage-pressure eviction —
  // the library IS the user's sound collection; losing it silently is the
  // worst failure mode. One call is enough (idempotent, ignored if denied).
  if (!_persistAsked && typeof navigator !== 'undefined' && navigator.storage?.persist) {
    _persistAsked = true
    void navigator.storage.persist().catch(() => {})
  }
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

const DB_VERSION = 2
const STORE      = 'entries'

function getDbName() {
  return _userId ? `contentforge-sound-library-${_userId}` : 'contentforge-sound-library'
}

// ── One connection, not one per operation ───────────────────────────────────
//
// Every function below used to call this, and this opened a NEW connection each
// time. `indexedDB.open()` is not free: it is a round trip to the storage
// thread that re-reads the database's metadata and runs the version check
// before it hands anything back, and the cost grows with what the database
// holds. With 12,949 catalog entries it is the single most expensive thing on
// the main thread.
//
// A V8 CPU profile of a 6-track song (3x throttled) put `open` at the TOP of
// self time in all three phases — 250ms during load and 99ms while the studio
// was sitting completely still. It is invisible in every other measurement
// because it is not a render, not a note, and not a paint; it just makes
// everything that touches storage slow, and Apollo touches storage once per
// sample id and once per clip. A 40-zone instrument is 40 opens.
//
// So the connection is opened once and reused. Dropped on close or a version
// change from another tab, so the next caller reopens rather than using a
// handle the browser has already invalidated.
let dbPromise: Promise<IDBDatabase> | null = null
let dbPromiseName = ''

function openDB(): Promise<IDBDatabase> {
  const name = getDbName()
  // Signing in or out switches databases; the cached handle is for the old one.
  if (dbPromise && dbPromiseName === name) return dbPromise
  dbPromiseName = name
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      let store: IDBObjectStore
      if (db.objectStoreNames.contains(STORE)) {
        // Existing database being upgraded — reuse the version-change transaction.
        store = req.transaction!.objectStore(STORE)
      } else {
        store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('category', 'category', { unique: false })
        store.createIndex('addedAt',  'addedAt',  { unique: false })
      }
      // v2: look a folder up by name instead of reading all ~13k records.
      // An entry with no `folder`/`parentFolder` simply is not in the index,
      // which is exactly right — nothing queries for undefined.
      if (!store.indexNames.contains('folder'))       store.createIndex('folder', 'folder', { unique: false })
      if (!store.indexNames.contains('parentFolder')) store.createIndex('parentFolder', 'parentFolder', { unique: false })
    }
    req.onsuccess = () => {
      const db = req.result
      const forget = () => { if (dbPromiseName === name) { dbPromise = null; dbPromiseName = '' } cacheReset() }
      db.onclose = forget
      // Another tab upgrading the schema: close so it is not blocked, and let
      // the next call reopen at the new version.
      db.onversionchange = () => { try { db.close() } catch { /* already gone */ } forget() }
      resolve(db)
    }
    req.onerror = () => { dbPromise = null; dbPromiseName = ''; reject(req.error) }
  })
  return dbPromise
}

function txOn<T>(
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

/**
 * Run a transaction, reopening once if the cached connection has gone stale.
 *
 * Caching the connection (see openDB) removed the per-operation `open` that
 * dominated the main thread, and introduced this: a connection that is CLOSING
 * is still handed out, because `onclose` only fires once it has finished
 * closing. Calling transaction() on it throws
 * `InvalidStateError: The database connection is closing`.
 *
 * It showed up under fast repeated project loads. The fix is not to stop
 * caching — the open really is that expensive — but to treat a dead handle as
 * what it is: drop it and reopen. Once only, so a genuinely broken database
 * fails rather than looping.
 */
async function tx<T>(
  db:    IDBDatabase,
  mode:  IDBTransactionMode,
  fn:    (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  try {
    return await txOn(db, mode, fn)
  } catch (e) {
    const name = (e as { name?: string })?.name
    if (name !== 'InvalidStateError' && name !== 'TransactionInactiveError') throw e
    dbPromise = null
    dbPromiseName = ''
    return txOn(await openDB(), mode, fn)
  }
}

// ── The warm snapshot ───────────────────────────────────────────────────────
//
// `getAll()` is a full deserialize of every record in the store — with ~13k
// catalog entries that is tens of milliseconds of main thread, and the engine
// used to call it ONCE PER (preset, pitch) while the transport was running
// (see _loadPresetBuffer). A section entering the prefetch window fired dozens
// of these concurrently, against the same 25ms tick that schedules audio, which
// is what made playback degrade the longer you played.
//
// So the store is read once and kept. Writes patch the snapshot in place rather
// than dropping it: libraryFulfill() persists a streamed blob through
// libraryAdd() on first use of a catalog sound, so a blunt "invalidate on any
// write" would re-scan the whole library repeatedly during playback — the exact
// cost this removes. Surgical patching keeps the snapshot warm across those.
//
// Cross-tab writes are not seen here, same as the connection cache above; the
// snapshot is dropped with the connection on `close`/`versionchange`, and on a
// user switch, which covers the cases where it could go meaningfully stale.
let allCache: LibraryEntry[] | null = null
let allInFlight: Promise<LibraryEntry[]> | null = null

/** Forget the snapshot entirely (user switch, connection dropped). */
function cacheReset(): void { allCache = null; allInFlight = null }

/** Keep the snapshot in step with a write instead of throwing it away. */
function cachePut(entry: LibraryEntry): void {
  if (!allCache) return
  const i = allCache.findIndex(e => e.id === entry.id)
  if (i >= 0) allCache[i] = entry
  else allCache.push(entry)
}

function cacheDrop(id: string): void {
  if (!allCache) return
  const i = allCache.findIndex(e => e.id === id)
  if (i >= 0) allCache.splice(i, 1)
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function libraryGetAll(): Promise<LibraryEntry[]> {
  // Callers filter, sort and splice the result, so hand out a copy of the
  // snapshot rather than the snapshot itself. Copying 13k pointers is ~1000x
  // cheaper than re-reading 13k records out of storage.
  if (allCache) return allCache.slice()
  if (allInFlight) return (await allInFlight).slice()
  const job = (async () => {
    const db = await openDB()
    const rows = await tx<LibraryEntry[]>(db, 'readonly', s => s.getAll())
    allCache = rows
    return rows
  })()
  allInFlight = job
  try {
    return (await job).slice()
  } finally {
    if (allInFlight === job) allInFlight = null
  }
}

/**
 * Every entry filed under `folder`, either directly or as its parent.
 *
 * This is what the engine actually wants when it resolves a sampled preset: one
 * instrument's notes, not the whole library. Backed by the v2 indexes, so it
 * reads only the matching records. Falls back to the full scan if the indexes
 * are not there yet (a database that has not run the v2 upgrade).
 */
export async function libraryGetByFolder(folder: string): Promise<LibraryEntry[]> {
  if (allCache) return allCache.filter(e => e.folder === folder || e.parentFolder === folder)
  try {
    const db = await openDB()
    const [own, children] = await Promise.all([
      tx<LibraryEntry[]>(db, 'readonly', s => s.index('folder').getAll(folder)),
      tx<LibraryEntry[]>(db, 'readonly', s => s.index('parentFolder').getAll(folder)),
    ])
    const seen = new Set(own.map(e => e.id))
    return own.concat(children.filter(e => !seen.has(e.id)))
  } catch {
    return (await libraryGetAll()).filter(e => e.folder === folder || e.parentFolder === folder)
  }
}

export async function libraryAdd(entry: LibraryEntry): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.put(entry))
  cachePut(entry)
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
  const merged = { ...existing, ...patch }
  await tx(db, 'readwrite', s => s.put(merged))
  cachePut(merged)
}

export async function libraryDelete(id: string): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.delete(id))
  cacheDrop(id)
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
  // `catalog` too: those already live on the server, and re-uploading a
  // catalog sound into someone's personal library would bill their storage for
  // a sound everybody already has.
  return !!e.audioBlob && !e.renderSpec && !e.communityRef && !e.catalog
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

    // ── And the half with no audio ────────────────────────────────────────
    // Personal tags, and sounds kept by reference rather than copied. Last,
    // because a kept sound's tags want the entry to exist first.
    await syncSoundPrefs()

    // Anything tagged or kept on THIS device before signing in belongs to the
    // account now — otherwise the first sync would look like it took them away.
    for (const e of local) {
      if (e.userTags?.length) {
        void pushSoundPref(e.id, {
          userTags: e.userTags,
          saved: e.communityRef
            ? {
              name: e.name, category: String(e.category), duration: e.duration,
              folder: e.folder, parentFolder: e.parentFolder,
              authorName: e.authorName, communityRef: e.communityRef,
            }
            : null,
        })
      } else if (e.communityRef) {
        void pushSoundPref(e.id, {
          userTags: [],
          saved: {
            name: e.name, category: String(e.category), duration: e.duration,
            folder: e.folder, parentFolder: e.parentFolder,
            authorName: e.authorName, communityRef: e.communityRef,
          },
        })
      }
    }
  } catch { /* offline — no problem, local library is untouched */ }
}

// ── The personal half of a library ──────────────────────────────────────────
//
// Brae: "Let's make own samples, saves, and tags live on the account."
//
// Own samples already did — pushSound uploads them and syncLibrary brings them
// back. The two that did not are the ones with no audio of their own:
//
//   a personal tag on a CATALOG sound, whose audio belongs to everybody;
//   a KEPT community sound, which is a reference that streams from the item's
//   own URL and so was never uploaded anywhere.
//
// Both are what a PERSON did rather than what they own, so both travel as
// preferences keyed to the sound, and the audio goes on living where it lives.

interface SoundPref {
  id: string
  userTags: string[]
  saved: {
    name: string; category: string; duration?: number
    folder?: string; parentFolder?: string
    communityRef?: { itemId: string; sampleIndex?: number }
    authorName?: string
  } | null
}

/**
 * Remember what this person did to a sound.
 *
 * ⚠️ FIRE AND FORGET, ALWAYS. Tagging a sound has to feel instant and has to
 * work signed out; the account copy is an improvement on top of a library that
 * already works, so a failure here must never surface as a failed edit. The
 * local write has already happened by the time this is called.
 */
export async function pushSoundPref(
  id: string, patch: { userTags?: string[]; saved?: SoundPref['saved'] },
): Promise<void> {
  if (typeof window === 'undefined' || !_userId) return
  try {
    await fetch('/api/library/prefs', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, userTags: patch.userTags ?? [], saved: patch.saved ?? null }),
    })
  } catch { /* it will be pushed again the next time the sound is touched */ }
}

export async function forgetSoundPref(id: string): Promise<void> {
  if (typeof window === 'undefined' || !_userId) return
  try { await fetch(`/api/library/prefs?id=${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  catch { /* it will be tidied on the next delete */ }
}

/**
 * Bring this account's tags and kept sounds to this device.
 *
 * ⚠️ TAGS ARE APPLIED, KEPT SOUNDS ARE REBUILT. A tag lands on an entry that is
 * already here; a kept sound may be missing entirely, and its stub has to be
 * recreated from the reference — with no audio, exactly as it was kept, so it
 * streams on first use like it did on the machine it came from.
 *
 * ⚠️ AND A LOCAL TAG IS NEVER CLOBBERED BY AN EMPTY REMOTE ONE. Somebody who
 * tagged a sound offline and then signed in on the same device would otherwise
 * watch their words vanish on the first sync.
 */
export async function syncSoundPrefs(): Promise<void> {
  if (typeof window === 'undefined' || !_userId) return
  try {
    const res = await fetch('/api/library/prefs')
    if (!res.ok) return
    const { prefs } = await res.json() as { prefs: SoundPref[] }
    if (!prefs?.length) return
    const local = await libraryGetAll()
    const byId = new Map(local.map(e => [e.id, e]))

    for (const p of prefs) {
      const here = byId.get(p.id)
      if (here) {
        const same = JSON.stringify(here.userTags ?? []) === JSON.stringify(p.userTags ?? [])
        if (!same && p.userTags.length) {
          try { await libraryUpdate(p.id, { userTags: p.userTags }) } catch { /* next sync */ }
        }
        continue
      }
      // Missing here, and kept elsewhere: rebuild the reference.
      if (!p.saved?.communityRef) continue
      try {
        await libraryAdd({
          id: p.id,
          name: p.saved.name,
          category: p.saved.category as LibraryCategory,
          duration: p.saved.duration ?? 0,
          addedAt: new Date().toISOString(),
          folder: p.saved.folder,
          parentFolder: p.saved.parentFolder,
          authorName: p.saved.authorName,
          communityRef: p.saved.communityRef,
          userTags: p.userTags,
        })
      } catch { /* skip this one, keep going */ }
    }
  } catch { /* offline — the local library is untouched */ }
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
    const local = await libraryGetAll()

    // Ask whether anything changed before asking for the whole thing.
    //
    // The catalog is thousands of entries and a quarter-megabyte gzipped, and
    // it changes when an admin adds a pack — not when someone opens the studio.
    // Sending the version we already hold turns the ordinary page load into a
    // sixty-byte "unchanged".
    //
    // The version encodes the row COUNT, and that is the point: a stored
    // version is only trustworthy if the local library still holds that many
    // catalog entries. Trusting it blindly means a browser that cleared its
    // IndexedDB — private window, "clear site data", eviction under storage
    // pressure — would be told nothing changed and would sit there with an
    // empty library forever. On a mismatch we simply ask for everything.
    const haveVersion = readCatalogVersion()
    const localCatalogCount = local.filter(e => e.catalog).length
    const trusted = haveVersion && Number(haveVersion.split('-')[0]) === localCatalogCount
      ? haveVersion : ''

    // no-store so this background sync always sees the current catalog —
    // otherwise a browser-cached list would delay additions/removals ~a minute.
    const res = await fetch(`/api/catalog${trusted ? `?v=${encodeURIComponent(trusted)}` : ''}`,
      { cache: 'no-store' })
    if (!res.ok) return
    const body = await res.json() as { items?: CatalogItem[]; version?: string; unchanged?: boolean }
    if (body.unchanged) return
    const items = body.items ?? []
    const localIds = new Set(local.map(e => e.id))
    const wantIds = new Set(items.map(it => `catalog_${it.id}`))

    for (const it of items) {
      const lid = `catalog_${it.id}`
      if (localIds.has(lid)) {
        // ⚠️ AN ENTRY ALREADY HERE STILL NEEDS ITS UNIVERSAL TAGS REFRESHED.
        //
        // This used to `continue`, which meant an admin editing a catalog
        // sound's tags changed them for nobody who already had it — that is to
        // say, for nobody. The tags were editable and the edit went nowhere.
        //
        // Only the fields the catalog OWNS are touched. A person's own tags
        // live in userTags precisely so this line cannot reach them.
        const had = local.find(e => e.id === lid)
        const same = JSON.stringify(had?.tags ?? []) === JSON.stringify(it.tags ?? [])
        if (had && !same) {
          try { await libraryUpdate(lid, { tags: it.tags ?? [] }) } catch { /* next sync */ }
        }
        continue
      }
      try {
        // Metadata only — the audio streams on first use (libraryFulfill).
        //
        // This used to download every new entry's audio during the sync. With
        // a handful of curated sounds that was invisible; with a real library
        // it is not. A 731-sound drum pack is about 500MB, and every visitor —
        // signed in or not, on any connection — would have pulled all of it
        // into IndexedDB before touching a single one. The catalog has to be
        // able to grow without the cost landing on people who never open it.
        await libraryAdd({
          id: lid, name: it.name, category: (it.category as LibraryCategory) || 'custom',
          catalogUrl: it.url,
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

    // Written LAST, and only after the adds and removals above have run. Store
    // it earlier and a sync that failed halfway leaves a version claiming a
    // library we never finished building.
    if (body.version) writeCatalogVersion(body.version)
  } catch { /* offline — keep local library untouched */ }
}

const CATALOG_VERSION_KEY = 'contentforge-catalog-version'

/** localStorage is a cache hint here, never a source of truth: losing it costs
 *  one extra full fetch, which is exactly what used to happen every time. */
function readCatalogVersion(): string {
  try { return localStorage.getItem(CATALOG_VERSION_KEY) || '' } catch { return '' }
}

function writeCatalogVersion(v: string): void {
  try { localStorage.setItem(CATALOG_VERSION_KEY, v) } catch { /* private mode — refetch next time */ }
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
//
// ⚠️ MOVED to lib/sound-tags.ts, and re-exported here so every existing import
// keeps working. Presets needed the same words — a preset carries a category
// from this very list — and a vocabulary that lives inside the sample library
// cannot be shared with them without dragging IndexedDB along with it.
//
// One vocabulary matters more than where it lives: "Dark" meaning one thing in
// the filter bar and something else to the voice control would be worse than
// having no tags at all.
export {
  TYPE_TAGS, CHARACTER_TAGS, CATEGORY_TO_TYPE_TAG, CATEGORY_CHAR_TAGS,
  ALL_TAGS, tagsOf, hasTags,
} from './sound-tags'
export type { TypeTag, CharacterTag, Taggable } from './sound-tags' 
