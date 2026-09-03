'use client'
// Where Light's button should appear, if anywhere in particular.
//
// Light is mounted once, in the app layout, so that navigating does not destroy
// it. But its button belongs in the transport bar when there IS a transport bar
// — that is where it has always been and where people reach for it.
//
// So the transport puts a slot on screen and Light portals into it. When there
// is no slot (the dashboard, the library, the projects list) Light falls back
// to a corner of its own. One instance either way: two would mean two
// microphones, and the second one would be listening to the first.

import { useSyncExternalStore } from 'react'

let slot: HTMLElement | null = null
const listeners = new Set<() => void>()

/** Called by whatever wants Light's button inside it. Pass null on unmount. */
export function setLightSlot(node: HTMLElement | null): void {
  if (slot === node) return
  slot = node
  for (const l of listeners) l()
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/**
 * The current slot, re-rendering the caller when it changes.
 *
 * ⚠️ useSyncExternalStore rather than an effect: the slot appears and
 * disappears as pages mount, and an effect-based version would render Light in
 * the corner for a frame on every trip into the studio.
 */
export function useLightSlot(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => slot, () => null)
}
