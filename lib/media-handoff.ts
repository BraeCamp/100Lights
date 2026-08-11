// Hand media files off to the video editor across a navigation. The All Projects
// / dashboard "Open / Import Files" flow lets a user pick raw video/audio (not
// just .cfproj projects); those Files can't ride a URL, so we stash the blobs in
// IndexedDB, navigate to the editor, and it drains them on mount.

const DB_NAME = 'cf-media-handoff'
const STORE = 'pending'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { autoIncrement: true })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

/** Replace any pending media with `files` (blobs survive the page navigation). */
export async function stashPendingMedia(files: File[]): Promise<void> {
  if (!files.length) return
  const db = await openDb()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.clear()
      for (const f of files) store.add(f)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally { db.close() }
}

/** Return and CLEAR the pending media (so a reload doesn't re-import). */
export async function takePendingMedia(): Promise<File[]> {
  let db: IDBDatabase
  try { db = await openDb() } catch { return [] }
  try {
    return await new Promise<File[]>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      const getAll = store.getAll()
      getAll.onsuccess = () => { store.clear(); resolve((getAll.result as File[]) ?? []) }
      getAll.onerror = () => resolve([])
    })
  } finally { db.close() }
}

/** Stash the media and open it in a fresh video project. */
export async function openMediaInStudio(files: File[]): Promise<void> {
  await stashPendingMedia(files)
  window.location.assign('/new?modules=video&importMedia=1')
}
