// Draw Mode — Live's pencil.
//
// One switch for the whole studio: with it on, the note editor draws instead
// of selecting. `B` toggles it and, held, is momentary (lib/keymap.ts):
// hold B, draw a run of hats, let go, you are back to editing. Pitch Lock
// keeps a horizontal drag on one pitch — the row you started on — which is
// how a hi-hat line is drawn in one stroke; `Alt` flips it for a stroke.
//
// A module store (the lib/perf-mode pattern) so the roll, the toolbar, the
// key handler and the palette read one value. Draw Mode itself is not
// persisted — nobody wants to open the studio drawing — Pitch Lock is.

import { useSyncExternalStore } from 'react'
import { readWorkspace, writeWorkspace } from './editor-workspace'

export type DrawState = { on: boolean; pitchLock: boolean }

const DEFAULT: DrawState = { on: false, pitchLock: true }
let state: DrawState = DEFAULT
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  const saved = readWorkspace('draw', { pitchLock: true })
  state = { on: false, pitchLock: saved.pitchLock !== false }
}
function emit() { for (const l of listeners) l() }

export function drawState(): DrawState { load(); return state }
export function setDrawMode(on: boolean): void { load(); if (state.on === on) return; state = { ...state, on }; emit() }
export function toggleDrawMode(): boolean { load(); setDrawMode(!state.on); return state.on }
export function setPitchLock(pitchLock: boolean): void {
  load()
  state = { ...state, pitchLock }
  writeWorkspace('draw', { pitchLock })
  emit()
}
function subscribe(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
/** Reactive Draw Mode state. SSR-safe. */
export function useDrawMode(): DrawState { return useSyncExternalStore(subscribe, drawState, () => DEFAULT) }
