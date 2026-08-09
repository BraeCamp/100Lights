// Firefly sketch persistence — a small local library of saved sketches so work survives a reload.
// IndexedDB (guest-friendly, no account needed), mirroring lib/offline-store.ts. A sketch is the
// captured melody + beat + tempo + mix settings; reopening restores them into the app. Account
// sync can layer on later (like the workshop theme does).
import type { MidiNote } from '@/lib/daw-types'
import type { RecNote } from '@/components/apps/VoiceMidi'

export interface SketchSettings {
  voiceVol: number; voiceMute: boolean; voiceInst: string
  beatVol: number; beatMute: boolean
}
export interface FireflySketch {
  id: string
  name: string
  savedAt: number
  bpm: number
  melody: RecNote[]
  beat: MidiNote[]
  settings: SketchSettings
}
/** Lightweight row for the list UI (no note payload). */
export type SketchMeta = Pick<FireflySketch, 'id' | 'name' | 'savedAt'> & { notes: number; hits: number }

const DB_NAME = 'firefly-sketches'
const DB_VERSION = 1
const STORE = 'sketches'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function saveSketch(sketch: FireflySketch): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite')
    t.objectStore(STORE).put(sketch)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}

export async function listSketches(): Promise<SketchMeta[]> {
  try {
    const db = await open()
    const all = await new Promise<FireflySketch[]>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
      req.onsuccess = () => resolve(req.result as FireflySketch[])
      req.onerror = () => reject(req.error)
    })
    return all
      .map(s => ({ id: s.id, name: s.name, savedAt: s.savedAt, notes: s.melody?.length ?? 0, hits: s.beat?.length ?? 0 }))
      .sort((a, b) => b.savedAt - a.savedAt)
  } catch { return [] }
}

export async function getSketch(id: string): Promise<FireflySketch | null> {
  try {
    const db = await open()
    return await new Promise<FireflySketch | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
      req.onsuccess = () => resolve((req.result as FireflySketch) ?? null)
      req.onerror = () => reject(req.error)
    })
  } catch { return null }
}

export async function deleteSketch(id: string): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite')
    t.objectStore(STORE).delete(id)
    t.oncomplete = () => resolve()
    t.onerror = () => reject(t.error)
  })
}
