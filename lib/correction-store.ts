/**
 * Labeled training pairs — persisted in IndexedDB.
 *
 * Each time the user accepts an AI correction (individually or via "Apply all"),
 * one CorrectionEntry is written here:
 *   detectedAs  — what the non-AI classifier originally said
 *   correctedTo — what the AI (confirmed by the user) says it should be
 *   spectral    — the full perceptual fingerprint for that hit
 *
 * The admin panel reads this store to show threshold drift and suggest rule
 * updates. When enough entries accumulate, a future pipeline pass can derive
 * new threshold values directly from the feature distributions.
 */

import type { BeatType, HitSpectral } from './beat-analyzer'

export interface CorrectionEntry {
  id:          string
  spectral:    HitSpectral
  detectedAs:  BeatType
  correctedTo: BeatType
  savedAt:     string  // ISO timestamp
}

// ── IndexedDB setup ───────────────────────────────────────────────────────────

const DB_NAME    = 'contentforge-corrections'
const DB_VERSION = 1
const STORE      = 'entries'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('detectedAs',  'detectedAs',  { unique: false })
        store.createIndex('correctedTo', 'correctedTo', { unique: false })
        store.createIndex('savedAt',     'savedAt',     { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function tx<T>(
  db:   IDBDatabase,
  mode: IDBTransactionMode,
  fn:   (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function correctionsGetAll(): Promise<CorrectionEntry[]> {
  const db = await openDB()
  return tx<CorrectionEntry[]>(db, 'readonly', s => s.getAll())
}

export async function correctionsAdd(entry: CorrectionEntry): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.put(entry))
}

export async function correctionsClear(): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.clear())
}
