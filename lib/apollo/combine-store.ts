'use client'
// Combined Apollo renders, kept ACROSS page loads.
//
// The in-memory cache is a Map in a module, so a reload threw away every render
// and started the whole job again — about a minute of rendering, every single
// time the page was opened, while playback ran on the expensive live path in
// the meantime. Rendering a clip is deterministic work over data that has not
// changed; doing it once per session was the bug.
//
// Stored as 16-bit PCM rather than the float the engine renders: half the
// bytes, and converting back is a multiply per sample, which is nothing next to
// re-running a synth. Keyed by the same stamp the memory cache uses — notes,
// patch and tempo — so any edit misses and re-renders exactly what changed.

const DB_NAME = 'apollo-combines'
const STORE = 'clips'
const DB_VERSION = 1

interface StoredClip {
  stamp: string
  sampleRate: number
  length: number
  channels: ArrayBuffer[]   // Int16 PCM per channel
  savedAt: number
}

// One connection, reused — see the note in lib/sound-library.ts. This store is
// read once per clip and written once per clip, so a 42-clip song opened the
// database 84 times to do 84 operations.
let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'stamp' })
    }
    req.onsuccess = () => {
      const db = req.result
      db.onclose = () => { dbPromise = null }
      db.onversionchange = () => { try { db.close() } catch { /* already gone */ } dbPromise = null }
      resolve(db)
    }
    req.onerror = () => { dbPromise = null; reject(req.error) }
  })
  return dbPromise
}

const toPcm16 = (f: Float32Array): ArrayBuffer => {
  const out = new Int16Array(f.length)
  for (let i = 0; i < f.length; i++) {
    const v = Math.max(-1, Math.min(1, f[i]))
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out.buffer
}
const fromPcm16 = (b: ArrayBuffer, into: Float32Array): void => {
  const src = new Int16Array(b)
  for (let i = 0; i < src.length && i < into.length; i++) into[i] = src[i] / 0x8000
}

/** Read one stored render back as an AudioBuffer. Null when absent. */
export async function loadCombined(stamp: string, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  try {
    const db = await openDb()
    const rec = await new Promise<StoredClip | undefined>((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(stamp)
      r.onsuccess = () => resolve(r.result as StoredClip | undefined)
      r.onerror = () => reject(r.error)
    })
    db.close()
    if (!rec || !rec.length) return null
    const buf = ctx.createBuffer(rec.channels.length || 2, rec.length, rec.sampleRate)
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const data = rec.channels[ch] ?? rec.channels[0]
      if (data) fromPcm16(data, buf.getChannelData(ch))
    }
    return buf
  } catch { return null }
}

// One worker for the whole session. Created lazily, because most pages never
// combine anything and a worker that is never used should never be spawned.
let writer: Worker | null = null
let writerFailed = false
function getWriter(): Worker | null {
  if (writer || writerFailed) return writer
  try {
    writer = new Worker(new URL('./combine-store.worker.ts', import.meta.url))
    writer.onerror = () => { writerFailed = true; writer = null }
  } catch { writerFailed = true }
  return writer
}

/**
 * Persist one render. Best-effort: a full disk must not break playback.
 *
 * The conversion and the write happen in a worker. They used to happen here, on
 * the main thread, immediately after a render and possibly while the user was
 * listening — about 340ms per combine on Iced, spent entirely on behalf of the
 * NEXT page load. The samples are TRANSFERRED rather than copied, so handing
 * them over costs nothing; they are copied out of the AudioBuffer first because
 * an AudioBuffer's own arrays cannot be detached.
 *
 * If the worker can't be created (older bundlers, strict CSP), this falls back
 * to doing the work inline — slower, but a stored clip is better than none.
 */
export async function saveCombined(stamp: string, buf: AudioBuffer): Promise<void> {
  const chCount = Math.min(2, buf.numberOfChannels)
  const w = getWriter()
  if (w) {
    try {
      const channels: Float32Array[] = []
      for (let ch = 0; ch < chCount; ch++) channels.push(new Float32Array(buf.getChannelData(ch)))
      w.postMessage(
        { stamp, sampleRate: buf.sampleRate, length: buf.length, channels },
        channels.map(c => c.buffer),
      )
      return
    } catch { /* fall through to the inline path */ }
  }
  try {
    const channels: ArrayBuffer[] = []
    for (let ch = 0; ch < chCount; ch++) channels.push(toPcm16(buf.getChannelData(ch)))
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ stamp, sampleRate: buf.sampleRate, length: buf.length, channels, savedAt: Date.now() } as StoredClip)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch { /* quota or private mode — the memory cache still works this session */ }
}

/** Drop renders not seen in a while, so an edited project does not grow forever. */
export async function pruneCombined(keepStamps: Set<string>, maxAgeMs = 1000 * 60 * 60 * 24 * 14): Promise<void> {
  try {
    const db = await openDb()
    const all = await new Promise<StoredClip[]>((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      r.onsuccess = () => resolve(r.result as StoredClip[])
      r.onerror = () => reject(r.error)
    })
    const cutoff = Date.now() - maxAgeMs
    const dead = all.filter(c => !keepStamps.has(c.stamp) && c.savedAt < cutoff).map(c => c.stamp)
    if (dead.length) {
      const tx = db.transaction(STORE, 'readwrite')
      for (const s of dead) tx.objectStore(STORE).delete(s)
    }
    db.close()
  } catch { /* best effort */ }
}

/**
 * Throw away every stored render.
 *
 * For measuring a COLD first play, which is the one that hurts and the only one
 * worth measuring — a warm cache turns any such measurement into a measurement
 * of the cache. Clearing the browser's site data would also do it, but that
 * signs you out and takes your projects with it; this touches only the render
 * cache, which costs a re-render and nothing else.
 */
export async function clearStoredCombines(): Promise<void> {
  const db = await openDb().catch(() => null)
  if (!db) return
  await new Promise<void>(resolve => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()   // nothing stored is the same as cleared
  })
}
