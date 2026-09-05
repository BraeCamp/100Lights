// Save Default Clip — Live's .asd idea, per sample.
//
// A sample that needed Warp on, Complex mode, Seg BPM 87 and −3 dB last
// time needs them every time. Save Default Clip remembers the clip's
// sample settings (lib/sample-editor.ts DEFAULT_CLIP_FIELDS) keyed by the
// sample's identity — its library id, its R2 key, or its URL — and every
// clip made from that sample afterwards starts with them. Placement is not
// remembered: where a clip sits and how long it is are the song's.
//
// A module store (the lib/perf-mode pattern) persisted in the workspace.

import { useSyncExternalStore } from 'react'
import { readWorkspace, writeWorkspace } from './editor-workspace'
import type { AudioClip } from './daw-types'
import { pickClipDefaults, type ClipDefaults } from './sample-editor'

type Store = Record<string, ClipDefaults>

let store: Store = {}
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  store = readWorkspace<Store>('clipDefaults', {})
}
function emit() { for (const l of listeners) l() }

/** The identity a default is keyed by — null for a clip with no sample of its own. */
export function clipDefaultsKey(clip: Pick<AudioClip, 'libraryId' | 'r2Key' | 'audioUrl'>): string | null {
  return clip.libraryId ?? clip.r2Key ?? (clip.audioUrl && !clip.audioUrl.startsWith('blob:') ? clip.audioUrl : null)
}

export function clipDefaultsFor(key: string | null): ClipDefaults | null {
  load()
  return key ? store[key] ?? null : null
}

export function saveClipDefaults(clip: AudioClip): ClipDefaults | null {
  const key = clipDefaultsKey(clip)
  if (!key) return null
  load()
  const d = pickClipDefaults(clip)
  store = { ...store, [key]: d }
  writeWorkspace('clipDefaults', store)
  emit()
  return d
}

export function clearClipDefaults(key: string): void {
  load()
  if (!(key in store)) return
  const next = { ...store }
  delete next[key]
  store = next
  writeWorkspace('clipDefaults', store)
  emit()
}

/** A new clip's fields with the sample's saved defaults under them (the clip's own explicit fields win). */
export function withClipDefaults<T extends Pick<AudioClip, 'libraryId' | 'r2Key' | 'audioUrl'>>(clip: T): T {
  const d = clipDefaultsFor(clipDefaultsKey(clip))
  return d ? { ...d, ...clip } : clip
}

function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
const get = () => { load(); return store }
/** Reactive: the whole store, so a pane can say "saved" for its sample. */
export function useClipDefaults(): Store { return useSyncExternalStore(subscribe, get, () => ({})) }
