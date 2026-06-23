// Named project snapshots stored in IndexedDB.
// Each snapshot captures all non-audio state (hits, lanes, effects, BPM etc.).
// Audio clip buffers are already persisted in the clip IDB store — snapshots
// reference them by ID via audioClipsMeta.

const DB_NAME = 'beatlab-snapshots'
const DB_VER  = 1
const STORE   = 'snapshots'

export interface SnapshotEntry {
  id:          string
  name:        string
  createdAt:   string   // ISO
  state:       ProjectSnapshot
}

export interface ProjectSnapshot {
  version:       string
  hits:          unknown
  laneEffects:   unknown
  lanePans:      unknown
  laneReverb:    unknown
  laneDelay:     unknown
  automLanes:    unknown
  typeOverrides: unknown
  locators:      unknown
  bpm:           number
  masterVolume:  number
  quantizeSwing: unknown
  sessionClips:  unknown
  extraLaneIds:  string[]
  groupDefs:     unknown
  audioClipsMeta: unknown[]
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE))
        db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

export async function snapshotSave(entry: SnapshotEntry): Promise<void> {
  const db = await openDB()
  await new Promise<void>((res, rej) => {
    const t   = db.transaction(STORE, 'readwrite')
    const req = t.objectStore(STORE).put(entry)
    req.onsuccess = () => res(); req.onerror = () => rej(req.error)
  })
}

export async function snapshotGetAll(): Promise<SnapshotEntry[]> {
  const db = await openDB()
  return new Promise((res, rej) => {
    const t   = db.transaction(STORE, 'readonly')
    const req = t.objectStore(STORE).getAll()
    req.onsuccess = () => res((req.result as SnapshotEntry[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
    req.onerror   = () => rej(req.error)
  })
}

export async function snapshotDelete(id: string): Promise<void> {
  const db = await openDB()
  await new Promise<void>((res, rej) => {
    const t   = db.transaction(STORE, 'readwrite')
    const req = t.objectStore(STORE).delete(id)
    req.onsuccess = () => res(); req.onerror = () => rej(req.error)
  })
}
