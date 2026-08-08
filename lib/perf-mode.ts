'use client'

// Performance mode — a tiny global boolean persisted in localStorage that,
// when on, tells the editors to switch off the expensive optional visualizers
// (scopes, motion blur, optical flow, frame blend, VU meter, live music-viz
// animation) so editing stays smooth on slower machines. Preview/editing only;
// it never changes export output.
//
// Framework-light on purpose: a module-level store + useSyncExternalStore, with
// a `storage` listener so toggling it in one tab/editor updates every open one.

import { useSyncExternalStore } from 'react'

const KEY = '100lights-perf-mode'

const listeners = new Set<() => void>()
// Cache the value so getSnapshot returns a stable reference (no re-read/tearing).
let cached: boolean | null = null

function read(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

function getSnapshot(): boolean {
  if (cached === null) cached = read()
  return cached
}

function getServerSnapshot(): boolean {
  return false
}

function emit() {
  for (const l of listeners) l()
}

export function setPerfMode(on: boolean) {
  cached = on
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    /* ignore quota/availability errors */
  }
  emit()
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  // Cross-tab / cross-editor sync: another tab wrote the flag.
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) {
      cached = read()
      emit()
    }
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(cb)
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}

/** Read-only current value (client). Safe on the server (returns false). */
export function getPerfMode(): boolean {
  return getSnapshot()
}

/** Subscribe to perf-mode changes; returns `[value, setValue]`. */
export function usePerfMode(): [boolean, (on: boolean) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  return [value, setPerfMode]
}
