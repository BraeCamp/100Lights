'use client'
// The open studio, reachable from outside the studio.
//
// Brae: "I get 'There is no project open so there's nothing to change yet'
// even while I'm in a project."
//
// ⚠️ MY MISTAKE, AND A BASIC ONE. Light was moved to the app layout so it would
// survive navigation, which put it BESIDE the page rather than inside it. The
// DAW's context provider lives deep within the editor, and React context only
// flows DOWN — so a sibling can never read it. useOptionalDaw() returned null
// every single time and Light refused every command in the studio it was
// sitting in.
//
// Context was the wrong tool the moment Light stopped being a descendant. This
// is the same shape as light-slot.ts and for the same reason: the editor
// PUBLISHES itself while it is on screen, and anything can subscribe from
// anywhere in the tree — or from outside it.

import { useSyncExternalStore } from 'react'
import type { DawContextValue } from '@/lib/daw-state'

let studio: DawContextValue | null = null
const listeners = new Set<() => void>()

/**
 * Called by the editor while it is mounted, and with null when it goes.
 *
 * ⚠️ Identity-compared: the context value is rebuilt on most renders, and
 * notifying subscribers every time would re-render Light — including its
 * microphone effects — several times a second while a knob is moving.
 */
export function setActiveStudio(value: DawContextValue | null): void {
  if (studio === value) return
  studio = value
  for (const l of listeners) l()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** The studio on screen, or null if none is. */
export function useActiveStudio(): DawContextValue | null {
  return useSyncExternalStore(subscribe, () => studio, () => null)
}
