// The detail area's own state: which of its two panes are showing, and
// whether it is stretched to full size. One module-level store (the
// lib/perf-mode pattern) so the component, the ⌘K palette, the key map and
// the voice control all read and write the same thing — a pane hidden by
// ⌘⌥3 is hidden for the palette too, and the label there says "Show".
//
// Live's model: the detail area at the bottom of the screen holds the Clip
// View above the Device View; each can be shown or hidden on its own,
// Shift+Tab flips focus between them, ⌘⌥3 / ⌘⌥4 show and hide them, ⌘⌥E
// stretches the area to full height for close work.

import { useSyncExternalStore } from 'react'
import { readWorkspace, writeWorkspace } from './editor-workspace'

export type DetailState = {
  clip: boolean
  device: boolean
  full: boolean
}

export type DetailAction = 'clip' | 'device' | 'full'

export const DETAIL_DEFAULT: DetailState = { clip: true, device: true, full: false }

/** The state after a toggle — pure, so it can be tested without a browser. */
export function nextDetail(state: DetailState, action: DetailAction, on?: boolean): DetailState {
  const next = { ...state, [action]: on ?? !state[action] }
  // Full size with nothing showing is a blank wall: stretching opens the
  // device pane if both were hidden.
  if (next.full && !next.clip && !next.device) next.device = true
  return next
}

/** A label for the palette: "Show the clip pane" / "Hide the clip pane". */
export function detailLabel(state: DetailState, action: DetailAction): string {
  if (action === 'full') return state.full ? 'Detail area back to normal size' : 'Detail area full size'
  return `${state[action] ? 'Hide' : 'Show'} the ${action} pane`
}

let state: DetailState = DETAIL_DEFAULT
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  state = { ...DETAIL_DEFAULT, ...readWorkspace('detail', DETAIL_DEFAULT) }
}

function emit() { for (const l of listeners) l() }

export function detailState(): DetailState {
  load()
  return state
}

export function setDetail(patch: Partial<DetailState>): void {
  load()
  state = { ...state, ...patch }
  writeWorkspace('detail', state)
  emit()
}

export function toggleDetail(action: DetailAction, on?: boolean): DetailState {
  load()
  state = nextDetail(state, action, on)
  writeWorkspace('detail', state)
  emit()
  return state
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Reactive detail-area state. SSR-safe (defaults on the server). */
export function useDetail(): DetailState {
  return useSyncExternalStore(subscribe, detailState, () => DETAIL_DEFAULT)
}
