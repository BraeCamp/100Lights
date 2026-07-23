/**
 * Offline persistence for DAW projects.
 *
 * Snapshots of the full DawProject are written to IndexedDB as you edit, so a
 * crash, offline quit, or accidental refresh never loses work. Audio that only
 * exists in memory (blob: URLs from recordings / jam captures) is persisted
 * alongside the snapshot and re-hydrated into fresh object URLs on restore.
 * R2-backed clips keep their https URLs and re-download when online.
 */

import type { DawProject } from './daw-types'

const DB_NAME = '100lights-offline'
const DB_VERSION = 1
const SNAPSHOTS = 'snapshots'
const AUDIO = 'audio'

export interface SnapshotRecord {
  key: string
  project: DawProject
  savedAt: number
  /** true when the server copy matches this snapshot (set after a successful save) */
  synced: boolean
  /** clip ids whose audio blobs are stored in the AUDIO store */
  audioClipIds: string[]
  /** The last SYNCED version — the point this local copy branched from. Used as
   *  the "base" for a 3-way merge when offline edits reconcile with the server.
   *  Set on synced saves; preserved across unsynced (offline) edits. */
  base?: DawProject
}

// The base is a server-equivalent reference, so drop browser-local blob URLs —
// it's only compared structurally, never played.
function stripBlobUrls(project: DawProject): DawProject {
  return {
    ...project,
    arrangementClips: project.arrangementClips.map(c =>
      c.kind === 'audio' && typeof (c as { audioUrl?: string }).audioUrl === 'string' && (c as { audioUrl: string }).audioUrl.startsWith('blob:')
        ? { ...c, audioUrl: undefined } : c),
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: 'key' })
      if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(t: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

function reqResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function blobClipIds(project: DawProject): { id: string; url: string }[] {
  return project.arrangementClips
    .filter(c => c.kind === 'audio' && typeof c.audioUrl === 'string' && c.audioUrl.startsWith('blob:'))
    .map(c => ({ id: c.id, url: (c as { audioUrl: string }).audioUrl }))
}

/**
 * Persist a snapshot. Blob-URL audio is fetched and stored once per clip id;
 * blobs belonging to clips that left the project are pruned.
 */
export async function saveSnapshot(key: string, project: DawProject, opts?: { synced?: boolean }): Promise<void> {
  const db = await openDB()
  const prev = await reqResult(
    db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).get(key)
  ) as SnapshotRecord | undefined

  const localClips = blobClipIds(project)
  const prevIds = new Set(prev?.audioClipIds ?? [])
  const nextIds = new Set(localClips.map(c => c.id))

  // Fetch blobs for clips we haven't stored yet (object URLs are only
  // fetchable while the page that created them is alive — i.e. right now)
  const toStore: { id: string; blob: Blob }[] = []
  for (const clip of localClips) {
    if (prevIds.has(clip.id)) continue
    try {
      const blob = await (await fetch(clip.url)).blob()
      toStore.push({ id: clip.id, blob })
    } catch {
      // URL already revoked or unreachable — snapshot still saves the structure
      nextIds.delete(clip.id)
    }
  }

  const t = db.transaction([SNAPSHOTS, AUDIO], 'readwrite')
  const audio = t.objectStore(AUDIO)
  for (const { id, blob } of toStore) audio.put(blob, id)
  for (const id of prevIds) if (!nextIds.has(id)) audio.delete(id)
  const record: SnapshotRecord = {
    key,
    project,
    savedAt: Date.now(),
    synced: opts?.synced ?? false,
    audioClipIds: [...nextIds],
    // A synced save advances the branch point; offline edits keep the old one.
    base: opts?.synced ? stripBlobUrls(project) : prev?.base,
  }
  t.objectStore(SNAPSHOTS).put(record)
  await txDone(t)
}

/** The offline branch for 3-way merge: the base (last synced) + the current
 *  working copy. Null when there's no branch point (never synced) yet. */
export async function getBranch(key: string): Promise<{ base: DawProject; working: DawProject } | null> {
  const rec = await loadSnapshot(key)   // rehydrates working's blob audio
  if (!rec || !rec.base) return null
  return { base: rec.base, working: rec.project }
}

/**
 * Load a snapshot and re-hydrate stored audio blobs into fresh object URLs.
 * Clips whose blobs are missing keep their (dead) URLs — same behavior as
 * any other missing media.
 */
export async function loadSnapshot(key: string): Promise<SnapshotRecord | null> {
  const db = await openDB()
  const rec = await reqResult(
    db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).get(key)
  ) as SnapshotRecord | undefined
  if (!rec) return null

  if (rec.audioClipIds.length > 0) {
    const t = db.transaction(AUDIO, 'readonly')
    const audio = t.objectStore(AUDIO)
    const urls = new Map<string, string>()
    await Promise.all(rec.audioClipIds.map(async id => {
      const blob = await reqResult(audio.get(id)) as Blob | undefined
      if (blob) urls.set(id, URL.createObjectURL(blob))
    }))
    rec.project = {
      ...rec.project,
      arrangementClips: rec.project.arrangementClips.map(c =>
        c.kind === 'audio' && urls.has(c.id) ? { ...c, audioUrl: urls.get(c.id)! } : c
      ),
    }
  }
  return rec
}

export async function deleteSnapshot(key: string): Promise<void> {
  const db = await openDB()
  const rec = await reqResult(
    db.transaction(SNAPSHOTS, 'readonly').objectStore(SNAPSHOTS).get(key)
  ) as SnapshotRecord | undefined
  const t = db.transaction([SNAPSHOTS, AUDIO], 'readwrite')
  for (const id of rec?.audioClipIds ?? []) t.objectStore(AUDIO).delete(id)
  t.objectStore(SNAPSHOTS).delete(key)
  await txDone(t)
}
