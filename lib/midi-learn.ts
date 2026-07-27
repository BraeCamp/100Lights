'use client'

// MIDI-learn: bind a hardware knob/fader (a MIDI CC) to any control, so moving
// the controller moves the control. Bindings persist in localStorage (they're a
// property of your setup, not the song). Each control registers its apply
// callback through a *ref* that's refreshed every render, so an incoming CC
// always drives the control's current value — no stale closures.

import { useEffect, useReducer, useRef } from 'react'
import { onMidiCC, startWebMidi } from './web-midi'

type Apply = (v01: number) => void          // v01 is 0..1 (CC value / 127)

const applyRefs = new Map<string, { current: Apply }>()
let bindings: Record<string, number> = {}   // bindingId → cc number
let armed: string | null = null
const listeners = new Set<() => void>()

const KEY = 'daw-midi-learn'
function load() { try { bindings = JSON.parse(localStorage.getItem(KEY) || '{}') } catch { bindings = {} } }
function persist() { try { localStorage.setItem(KEY, JSON.stringify(bindings)) } catch { /* private mode */ } }
function notify() { for (const l of listeners) l() }

let started = false
function ensure() {
  if (started || typeof window === 'undefined') return
  started = true
  load()
  void startWebMidi()
  onMidiCC(e => {
    if (armed) {
      // Bind this CC to the armed control; a CC only drives one control, so
      // steal it from any other control first.
      for (const id of Object.keys(bindings)) if (bindings[id] === e.cc) delete bindings[id]
      bindings[armed] = e.cc
      armed = null
      persist(); notify()
      return
    }
    for (const [id, cc] of Object.entries(bindings)) {
      if (cc === e.cc) applyRefs.get(id)?.current(e.value / 127)
    }
  })
}

export function armMidiLearn(bindingId: string) { ensure(); armed = armed === bindingId ? null : bindingId; notify() }
export function clearMidiBinding(bindingId: string) { delete bindings[bindingId]; persist(); notify() }

// Register a control and reflect its binding state; re-renders on any change so
// the "learning…" / "CC n" affordance stays live.
export function useMidiLearn(bindingId: string, apply: Apply) {
  if (bindingId) ensure()
  const ref = useRef(apply)
  ref.current = apply
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!bindingId) return
    applyRefs.set(bindingId, ref)
    listeners.add(force)
    return () => { applyRefs.delete(bindingId); listeners.delete(force) }
  }, [bindingId])
  return {
    cc: bindingId ? (bindings[bindingId] ?? null) : null,
    armed: !!bindingId && armed === bindingId,
    arm: () => { if (bindingId) armMidiLearn(bindingId) },
    clear: () => { if (bindingId) clearMidiBinding(bindingId) },
  }
}
