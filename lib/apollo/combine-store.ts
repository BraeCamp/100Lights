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
//
// ⚠️ AND NOBODY MAY CLOSE IT. Every function here used to call db.close() when
// it finished, which is correct for a connection you opened and wrong for one
// you were handed. Explicit close() fires NO event — the `close` event is for
// abnormal closure — so `dbPromise` went on handing out a CLOSED connection and
// every later transaction threw InvalidStateError into a catch that returns
// null. From the caller a dead cache and a miss look identical: the clip just
// renders again. Writes kept working because they go through the worker, which
// has its own connection and never closes it, so the store filled up with
// renders that could never be read back. That is why loading got slower every
// reload rather than merely being slow.
//
// combine-store.worker.ts already had the right shape. This now matches it.
let dbPromise: Promise<IDBDatabase> | null = null

/**
 * Run one transaction, and drop the cached connection if it turns out dead.
 *
 * A connection CAN legitimately die — the tab is evicted, the database is
 * deleted from another tab, storage is cleared. What must not happen is one
 * bad connection poisoning every later call, which is exactly what a memoised
 * promise does unless something clears it.
 */
async function withDb<T>(fn: (db: IDBDatabase) => Promise<T>): Promise<T> {
  try {
    return await fn(await openDb())
  } catch (err) {
    // ⚠️ ONLY when the CONNECTION is what died. Dropping it on any failure at
    // all looks careful and is not: a full disk raises QuotaExceededError on
    // every write, and rebuilding the connection each time meant twelve failed
    // writes reopened the database eleven times — on exactly the small, full
    // device that can least afford it. The write failed; the connection is
    // fine. InvalidStateError is the one that means it is closed or closing,
    // and if a connection is broken in some other way the next transaction
    // raises it anyway, so this self-corrects rather than guessing.
    if ((err as { name?: string })?.name === 'InvalidStateError') dbPromise = null
    throw err
  }
}

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
    const rec = await withDb(db => new Promise<StoredClip | undefined>((resolve, reject) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(stamp)
      r.onsuccess = () => resolve(r.result as StoredClip | undefined)
      r.onerror = () => reject(r.error)
    }))
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
    await withDb(db => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put({ stamp, sampleRate: buf.sampleRate, length: buf.length, channels, savedAt: Date.now() } as StoredClip)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }))
  } catch { /* quota or private mode — the memory cache still works this session */ }
}

/**
 * Drop renders no project has wanted for a fortnight, and cap the total size.
 *
 * ⚠️ Nothing called this for its entire life. Every edit mints a new stamp and a
 * combined render is 16-bit stereo PCM — roughly 11 MB per minute of audio, per
 * clip variant — so the store only ever grew, and a week of work left behind
 * every intermediate version of every clip. That is why loading got slower with
 * each reload rather than merely being slow.
 *
 * TWO RULES, because age alone is not enough. A fortnight of grace exists so
 * that undo, and reopening yesterday's version, do not cost a re-render — but
 * somebody who works hard for three days can fill a disk well inside it. So
 * anything genuinely old goes, and then the oldest go until the total fits.
 *
 * ⚠️ CURSORED, NOT getAll(). getAll deserialises every record — including the
 * audio — into one array, which on the very store this is meant to rescue could
 * be gigabytes, and pruning a bloated cache must not be the thing that kills the
 * tab. The cursor holds one record at a time and keeps only its metadata.
 *
 * Returns how many it dropped.
 */
export async function pruneCombined(
  keepStamps: Set<string>,
  maxAgeMs = 1000 * 60 * 60 * 24 * 14,
  maxBytes = Infinity,
): Promise<number> {
  try {
    const cutoff = Date.now() - maxAgeMs
    const alive: { stamp: string; savedAt: number; bytes: number }[] = []
    let dropped = 0

    await withDb(db => new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).openCursor()
      req.onsuccess = () => {
        const cur = req.result as IDBCursorWithValue | null
        if (!cur) return
        const rec = cur.value as StoredClip
        // Bytes from the shape, not from the buffers: this is 16-bit PCM, so it
        // is two per sample per channel, and asking the record is free.
        const bytes = (rec.length ?? 0) * 2 * Math.max(1, rec.channels?.length ?? 2)
        if (!keepStamps.has(rec.stamp) && (rec.savedAt ?? 0) < cutoff) {
          cur.delete()
          dropped++
        } else {
          alive.push({ stamp: rec.stamp, savedAt: rec.savedAt ?? 0, bytes })
        }
        cur.continue()
      }
      req.onerror = () => reject(req.error)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    }))

    // Then the size cap, oldest first, never touching what this project wants.
    let total = alive.reduce((n, c) => n + c.bytes, 0)
    if (total > maxBytes) {
      const evictable = alive
        .filter(c => !keepStamps.has(c.stamp))
        .sort((a, b) => a.savedAt - b.savedAt)
      const doomed: string[] = []
      for (const c of evictable) {
        if (total <= maxBytes) break
        doomed.push(c.stamp)
        total -= c.bytes
      }
      if (doomed.length) {
        await withDb(db => new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite')
          for (const stamp of doomed) tx.objectStore(STORE).delete(stamp)
          tx.oncomplete = () => resolve()
          tx.onerror = () => reject(tx.error)
        }))
        dropped += doomed.length
      }
    }
    return dropped
  } catch { return 0 }
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
