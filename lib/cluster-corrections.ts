import type { HitSpectral } from './beat-features'

export interface ClusterCorrection {
  id:      string
  spectral: HitSpectral
  label:   string
  savedAt: string
}

const DB_NAME    = 'contentforge-cluster-corrections'
const DB_VERSION = 1
const STORE      = 'entries'

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

export async function clusterCorrectionGetAll(): Promise<ClusterCorrection[]> {
  const db = await openDB()
  return tx<ClusterCorrection[]>(db, 'readonly', s => s.getAll())
}

export async function clusterCorrectionAdd(entry: ClusterCorrection): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.put(entry))
}

export async function clusterCorrectionClear(): Promise<void> {
  const db = await openDB()
  await tx(db, 'readwrite', s => s.clear())
}
