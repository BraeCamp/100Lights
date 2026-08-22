'use client'

// MIDI-learn for Beacon controls: bind a hardware knob/fader (a MIDI CC) to any
// control, so moving the controller moves the control.
//
// The mapping itself lives in lib/midi-bindings, which Apollo shares — one
// controller setup for the whole program, and a CC can only ever drive one
// thing. This file is now just the React surface over it, plus the 'daw:'
// namespace so Beacon ids can never collide with Apollo's parameter paths.
//
// Each control registers its apply callback through a *ref* refreshed every
// render, so an incoming CC always drives the control's current value — no
// stale closures.

import { useEffect, useReducer, useRef } from 'react'
import {
  armMidiBinding, armedBinding, ccForBinding, clearMidiBinding as clearShared,
  ensureMidiBindings, registerApplier, subscribeMidiBindings,
} from './midi-bindings'

type Apply = (v01: number) => void          // v01 is 0..1 (CC value / 127)

const ns = (bindingId: string) => `daw:${bindingId}`

export function armMidiLearn(bindingId: string) { armMidiBinding(ns(bindingId)) }
export function clearMidiBinding(bindingId: string) { clearShared(ns(bindingId)) }

// Register a control and reflect its binding state; re-renders on any change so
// the "learning…" / "CC n" affordance stays live.
export function useMidiLearn(bindingId: string, apply: Apply) {
  if (bindingId) ensureMidiBindings()
  const ref = useRef(apply)
  ref.current = apply
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    if (!bindingId) return
    const offApply = registerApplier(ns(bindingId), ref)
    const offSub = subscribeMidiBindings(force)
    return () => { offApply(); offSub() }
  }, [bindingId])
  return {
    cc: bindingId ? ccForBinding(ns(bindingId)) : null,
    armed: !!bindingId && armedBinding() === ns(bindingId),
    arm: () => { if (bindingId) armMidiLearn(bindingId) },
    clear: () => { if (bindingId) clearMidiBinding(bindingId) },
  }
}
