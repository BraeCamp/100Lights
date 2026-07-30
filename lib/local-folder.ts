declare global {
  interface Window {
    showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
  interface FileSystemDirectoryHandle {
    entries(): AsyncIterableIterator<[string, FileSystemHandle]>
    queryPermission(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
    requestPermission(desc: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  }
}

const DB_NAME  = 'cf-local'
const DB_VER   = 1
const STORE    = 'handles'
const KEY      = 'project-folder'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

export async function saveFolder(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(handle, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

export async function loadFolder(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null)
    req.onerror   = () => reject(req.error)
  })
}

export async function clearFolder(): Promise<void> {
  const db = await openDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(KEY)
    tx.oncomplete = () => resolve()
    tx.onerror    = () => reject(tx.error)
  })
}

export async function verifyPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const perm = await handle.queryPermission({ mode: 'read' })
  if (perm === 'granted') return true
  const req = await handle.requestPermission({ mode: 'read' })
  return req === 'granted'
}

// Read+write access — needed to save projects into the folder (not just list them).
export async function verifyWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const perm = await handle.queryPermission({ mode: 'readwrite' })
  if (perm === 'granted') return true
  const req = await handle.requestPermission({ mode: 'readwrite' })
  return req === 'granted'
}

// Write a file into the folder, creating or overwriting it.
export async function writeToFolder(handle: FileSystemDirectoryHandle, filename: string, contents: string): Promise<void> {
  const fh = await handle.getFileHandle(filename, { create: true })
  const writable = await fh.createWritable()
  await writable.write(contents)
  await writable.close()
}

// Prompt the user to grant a folder (read+write) and remember it.
export async function pickWritableFolder(): Promise<FileSystemDirectoryHandle | null> {
  const picker = window.showDirectoryPicker
  if (!picker) return null
  try {
    const handle = await picker({ mode: 'readwrite' })
    await saveFolder(handle)
    return handle
  } catch { return null } // user cancelled
}
