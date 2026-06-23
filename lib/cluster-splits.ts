/**
 * Cluster split pairs — pairwise "never together" rules learned from user corrections.
 *
 * When a user marks a hit as "distinct", we record:
 *   distinctSpectral      — the sound that should be in its own cluster
 *   confusedWithSpectral  — centroid of the sounds it was incorrectly grouped WITH
 *
 * The algorithm uses these pairs in a post-clustering pass: if any cluster
 * contains both a "distinct" type AND a "confused with" type from the same split,
 * it forces a separation — relating only those two sounds to each other and
 * nothing else.
 */

import type { HitSpectral } from './beat-features'

export interface ClusterSplit {
  id:                   string
  distinctSpectral:     HitSpectral  // the sound that was incorrectly merged
  confusedWithSpectral: HitSpectral  // centroid of what it was merged WITH
  savedAt:              string
}

const DB_NAME    = 'contentforge-cluster-splits'
const DB_VERSION = 1
const STORE      = 'splits'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t   = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

export async function clusterSplitGetAll(): Promise<ClusterSplit[]> {
  const db = await openDB()
  return tx<ClusterSplit[]>(db, 'readonly', s => s.getAll())
}

export async function clusterSplitAdd(entry: ClusterSplit): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.put(entry))
}

export async function clusterSplitClear(): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.clear())
}
