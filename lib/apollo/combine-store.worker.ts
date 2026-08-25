// Persisting a combined render, off the main thread.
//
// saveCombined converted both channels of every clip to Int16 and then handed
// the result to IndexedDB — all on the main thread, right after a render, while
// the user might be listening. Profiled on Iced that was ~340ms per combine
// (172ms in toPcm16, the rest in the IDB write), and it bought nothing for THIS
// page load: the stored copy only matters the NEXT time the project opens.
//
// So it happens here instead. The caller transfers the float samples (a real
// transfer, not a copy — the arrays are detached on the way in), this thread
// does the conversion and the write, and the main thread goes back to drawing.
//
// Nothing here can break playback: on any failure the clip simply isn't on disk,
// and the next page load re-renders it, which is exactly the pre-cache
// behaviour.

const DB_NAME = 'apollo-combines'
const STORE = 'clips'
const DB_VERSION = 1

interface SaveMessage {
  stamp: string
  sampleRate: number
  length: number
  channels: Float32Array[]
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'stamp' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

const toPcm16 = (f: Float32Array): ArrayBuffer => {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out.buffer
}

// ONE connection for the session, not one per clip.
//
// Opening and closing the database per write is the slow part of this job, and a
// whole song arrives as forty messages in a row. With a connection per clip the
// queue drained so slowly that closing the tab lost most of it — measured, a
// second load of Undertow found only 5 of its 39 clips on disk and re-rendered
// the rest, which defeats the entire point of persisting them.
let dbPromise: Promise<IDBDatabase> | null = null
const db = () => (dbPromise ??= openDb())

self.onmessage = async (e: MessageEvent<SaveMessage>) => {
  const { stamp, sampleRate, length, channels } = e.data
  try {
    const pcm = channels.map(toPcm16)
    const conn = await db()
    await new Promise<void>((resolve, reject) => {
      const tx = conn.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ stamp, sampleRate, length, channels: pcm, savedAt: Date.now() })
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } catch {
    dbPromise = null   // a broken connection must not poison every later write
  }
}
