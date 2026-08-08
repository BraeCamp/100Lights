'use client'

// Remember workspace — persists the small bits of editor UI layout that aren't
// already saved elsewhere (panel SIZES are handled by useResizable). We keep one
// tiny JSON blob in localStorage, namespaced by "concern" (e.g. 'video',
// 'audio'), so each editor reopens as you left it.
//
// Robust by construction: a corrupt or absent blob falls back to defaults and
// never throws. SSR-safe: no window access unless we're on the client.

const KEY = '100lights-workspace'

type Blob = Record<string, unknown>

function readAll(): Blob {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Blob) : {}
  } catch {
    return {}
  }
}

/** Read a concern's persisted state, merged over `fallback`. Never throws. */
export function readWorkspace<T extends Record<string, unknown>>(concern: string, fallback: T): T {
  const all = readAll()
  const slice = all[concern]
  if (!slice || typeof slice !== 'object') return fallback
  return { ...fallback, ...(slice as Partial<T>) }
}

/** Merge a patch into a concern's persisted state. Client-only; never throws. */
export function writeWorkspace(concern: string, patch: Record<string, unknown>): void {
  if (typeof window === 'undefined') return
  try {
    const all = readAll()
    const prev = (all[concern] && typeof all[concern] === 'object') ? (all[concern] as Blob) : {}
    all[concern] = { ...prev, ...patch }
    window.localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* ignore quota/availability/serialization errors */
  }
}
