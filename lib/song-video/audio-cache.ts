// Persistent cache of real-mix bounces (IndexedDB), keyed by project version +
// section. The bounce is expensive (real-time render of the whole engine), but
// deterministic for a given project + window — so once rendered, re-opening the
// same section is instant. Editing the project changes the key (it embeds the
// save timestamp), so a stale mix is never served.

const DB_NAME = 'song-video-audio'
const STORE = 'bounces'
const MAX_ENTRIES = 10 // ~cap on disk; oldest evicted past this

function openDb(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req: IDBOpenDBRequest
    try { req = indexedDB.open(DB_NAME, 1) } catch { return resolve(null) }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'key' })
        os.createIndex('at', 'at')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
}

export async function getCachedAudio(key: string): Promise<Blob | null> {
  const db = await openDb(); if (!db) return null
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => resolve(req.result?.blob ?? null)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

export async function putCachedAudio(key: string, blob: Blob, now: number): Promise<void> {
  const db = await openDb(); if (!db) return
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ key, blob, at: now })
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch { resolve() }
  })
  // Evict oldest beyond the cap so the cache stays bounded.
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite')
      const os = tx.objectStore(STORE)
      const countReq = os.count()
      countReq.onsuccess = () => {
        const over = countReq.result - MAX_ENTRIES
        if (over <= 0) return resolve()
        let removed = 0
        os.index('at').openCursor().onsuccess = e => {
          const cur = (e.target as IDBRequest<IDBCursorWithValue>).result
          if (cur && removed < over) { cur.delete(); removed++; cur.continue() } else resolve()
        }
      }
      countReq.onerror = () => resolve()
    } catch { resolve() }
  })
}
