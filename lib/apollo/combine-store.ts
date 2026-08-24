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

/** Persist one render. Best-effort: a full disk must not break playback. */
export async function saveCombined(stamp: string, buf: AudioBuffer): Promise<void> {
  try {
    const channels: ArrayBuffer[] = []
    for (let ch = 0; ch < Math.min(2, buf.numberOfChannels); ch++) channels.push(toPcm16(buf.getChannelData(ch)))
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
