'use client'

// One MIDI-CC registry for the whole program.
//
// Beacon and Apollo each grew their own MIDI learn: Beacon kept
// bindingId → cc in 'daw-midi-learn' and applied through registered
// callbacks, Apollo kept cc → paramPath in 'apollo_midi_map_v1' and applied
// through its patch. Two maps meant one controller had to be taught twice, and
// worse, the same CC could be bound in both at once — turn the knob and two
// unrelated parameters move.
//
// This owns the mapping for both. It sits beside lib/web-midi, which both apps
// already share, so neither has to import the other. Bindings are a property of
// your hardware setup rather than the song, so they stay in localStorage.

import { onMidiCC, startWebMidi } from './web-midi'

/** Namespaced so the two apps can never collide: 'daw:...' or 'apollo:...'. */
export type BindingId = string

type Apply = (v01: number) => void

const KEY = 'midi-bindings-v1'
const LEGACY_DAW = 'daw-midi-learn'
const LEGACY_APOLLO = 'apollo_midi_map_v1'

let bindings: Record<BindingId, number> = {}
const appliers = new Map<BindingId, { current: Apply }>()
const listeners = new Set<() => void>()
let armed: BindingId | null = null
let started = false

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(bindings)) } catch { /* private mode */ }
}
function notify() { for (const l of listeners) l() }

/** Fold the two old maps in on first run so nobody loses a controller setup.
 *  Apollo's map was the other way round (cc → path), hence the inversion. */
function migrate() {
  try {
    const daw = JSON.parse(localStorage.getItem(LEGACY_DAW) || '{}') as Record<string, number>
    for (const [id, cc] of Object.entries(daw)) {
      if (typeof cc === 'number' && bindings[`daw:${id}`] == null) bindings[`daw:${id}`] = cc
    }
  } catch { /* nothing to migrate */ }
  try {
    const apollo = JSON.parse(localStorage.getItem(LEGACY_APOLLO) || '{}') as Record<string, string>
    for (const [cc, path] of Object.entries(apollo)) {
      const n = Number(cc)
      if (Number.isFinite(n) && path && bindings[`apollo:${path}`] == null) bindings[`apollo:${path}`] = n
    }
  } catch { /* nothing to migrate */ }
}

export function ensureMidiBindings(): void {
  if (started || typeof window === 'undefined') return
  started = true
  try { bindings = JSON.parse(localStorage.getItem(KEY) || '{}') } catch { bindings = {} }
  migrate()
  persist()
  void startWebMidi()
  onMidiCC(e => handleCC(e.cc, e.value))
  // Dev hook, in the same family as __dawDispatch: MIDI is otherwise
  // untestable without hardware attached, so expose the same entry point the
  // Web MIDI listener uses.
  if (process.env.NODE_ENV !== 'production') {
    (window as unknown as { __midiCC?: typeof handleCC }).__midiCC = handleCC
  }
}

/**
 * Route one CC. Exported so any MIDI source can drive the registry, not only
 * the Web MIDI listener — which also makes the whole thing testable without
 * hardware attached.
 *
 * `value` is the raw 0..127 CC value.
 */
export function handleCC(cc: number, value: number): void {
  // Reserved: mod wheel and sustain are performance controls, and letting them
  // be learned would silently break every patch that expects them.
  if (cc === 1 || cc === 64) return
  if (armed) {
    // A CC drives exactly one thing — steal it from whatever held it before,
    // which is the whole point of having a single registry.
    for (const id of Object.keys(bindings)) if (bindings[id] === cc) delete bindings[id]
    bindings[armed] = cc
    armed = null
    persist(); notify()
    return
  }
  for (const [id, bound] of Object.entries(bindings)) {
    if (bound === cc) appliers.get(id)?.current(value / 127)
  }
}

export function armMidiBinding(id: BindingId): void {
  ensureMidiBindings()
  armed = armed === id ? null : id
  notify()
}
export function armedBinding(): BindingId | null { return armed }
export function clearMidiBinding(id: BindingId): void {
  delete bindings[id]; persist(); notify()
}
export function ccForBinding(id: BindingId): number | null {
  return bindings[id] ?? null
}
export function bindingForCc(cc: number): BindingId | null {
  for (const [id, bound] of Object.entries(bindings)) if (bound === cc) return id
  return null
}
export function allMidiBindings(): { id: BindingId; cc: number }[] {
  return Object.entries(bindings).map(([id, cc]) => ({ id, cc })).sort((a, b) => a.cc - b.cc)
}
export function clearAllMidiBindings(): void { bindings = {}; persist(); notify() }

/** Register the callback a bound CC should drive. Returns an unsubscribe. */
export function registerApplier(id: BindingId, ref: { current: Apply }): () => void {
  ensureMidiBindings()
  appliers.set(id, ref)
  return () => { appliers.delete(id) }
}

export function subscribeMidiBindings(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
