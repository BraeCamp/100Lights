// IndexedDB persistence for AudioBuffer data in BeatLab.
// AudioBuffer cannot be JSON-serialized, so we decompose it into Float32Arrays
// and store those in a dedicated IDB database.

const DB_NAME    = 'beatlab-clips'
const STORE      = 'clips'
const DB_VERSION = 1

interface ClipRecord {
  id: string
  sampleRate: number
  numberOfChannels: number
  length: number
  channels: Float32Array<ArrayBuffer>[]
  // optional original buffer (source before conversion — preserved for re-derive)
  originalSampleRate:       number | null
  originalNumberOfChannels: number | null
  originalLength:           number | null
  originalChannels:         Float32Array<ArrayBuffer>[] | null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
}

function bufToChannels(buf: AudioBuffer): Float32Array<ArrayBuffer>[] {
  const out: Float32Array<ArrayBuffer>[] = []
  for (let i = 0; i < buf.numberOfChannels; i++) {
    const src  = buf.getChannelData(i)
    const copy = new Float32Array(src.length) as Float32Array<ArrayBuffer>
    copy.set(src)
    out.push(copy)
  }
  return out
}

function channelsToBuffer(
  channels: Float32Array<ArrayBuffer>[],
  sampleRate: number,
  length: number,
): AudioBuffer {
  const buf = new AudioBuffer({ numberOfChannels: channels.length, length, sampleRate })
  for (let i = 0; i < channels.length; i++) buf.copyToChannel(channels[i], i)
  return buf
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function saveClip(
  id: string,
  buf: AudioBuffer,
  originalBuf?: AudioBuffer | null,
): Promise<void> {
  if (typeof window === 'undefined') return
  const db = await openDb()
  const record: ClipRecord = {
    id,
    sampleRate:       buf.sampleRate,
    numberOfChannels: buf.numberOfChannels,
    length:           buf.length,
    channels:         bufToChannels(buf),
    originalSampleRate:       originalBuf?.sampleRate       ?? null,
    originalNumberOfChannels: originalBuf?.numberOfChannels ?? null,
    originalLength:           originalBuf?.length           ?? null,
    originalChannels:         originalBuf ? bufToChannels(originalBuf) : null,
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(record)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror    = () => { db.close(); reject(tx.error) }
  })
}

export async function loadClip(id: string): Promise<AudioBuffer | null> {
  if (typeof window === 'undefined') return null
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(id)
    req.onsuccess = () => {
      db.close()
      const rec = req.result as ClipRecord | undefined
      if (!rec) { resolve(null); return }
      try { resolve(channelsToBuffer(rec.channels, rec.sampleRate, rec.length)) }
      catch (e) { reject(e) }
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function deleteClip(id: string): Promise<void> {
  if (typeof window === 'undefined') return
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror    = () => { db.close(); reject(tx.error) }
  })
}

/** Load every saved clip.  Returns a map of id → { buf, originalBuf }. */
export async function loadAllClips(): Promise<Map<string, { buf: AudioBuffer; originalBuf: AudioBuffer | null }>> {
  if (typeof window === 'undefined') return new Map()
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const result = new Map<string, { buf: AudioBuffer; originalBuf: AudioBuffer | null }>()
    const tx  = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) { db.close(); resolve(result); return }
      const rec = cursor.value as ClipRecord
      try {
        const buf = channelsToBuffer(rec.channels, rec.sampleRate, rec.length)
        const originalBuf =
          rec.originalChannels && rec.originalSampleRate != null &&
          rec.originalLength != null && rec.originalNumberOfChannels != null
            ? channelsToBuffer(rec.originalChannels, rec.originalSampleRate, rec.originalLength)
            : null
        result.set(rec.id, { buf, originalBuf })
      } catch { /* skip corrupt records */ }
      cursor.continue()
    }
    req.onerror = () => { db.close(); reject(req.error) }
  })
}

export async function clearAllClips(): Promise<void> {
  if (typeof window === 'undefined') return
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror    = () => { db.close(); reject(tx.error) }
  })
}
