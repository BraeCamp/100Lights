// A note selection asked for from outside the roll.
//
// The roll owns its selection as component state — the right place for it —
// but the voice ("select every C in the pad") and a Find & Select run from
// the palette need to hand it a set of notes, and the roll for that clip may
// not even be mounted yet when they do (the same sentence just selected the
// clip, and React has not caught up). So the request is parked here: the
// roll subscribes, and on mount or on a clip change it takes any request
// addressed to its clip and consumes it. Nothing is persisted.

import { useSyncExternalStore } from 'react'

export interface NoteSelectionRequest { clipId: string; noteIds: string[]; seq: number }

let pending: NoteSelectionRequest | null = null
let seq = 0
const listeners = new Set<() => void>()

/** Ask the roll showing `clipId` to select these notes (an empty list clears). */
export function requestNoteSelection(clipId: string, noteIds: string[]): void {
  pending = { clipId, noteIds, seq: ++seq }
  for (const l of listeners) l()
}

/** The roll took it. */
export function consumeNoteSelection(req: NoteSelectionRequest): void {
  if (pending && pending.seq === req.seq) { pending = null; for (const l of listeners) l() }
}

export function pendingNoteSelection(): NoteSelectionRequest | null { return pending }

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const get = () => pending

export function useNoteSelectionRequest(): NoteSelectionRequest | null {
  return useSyncExternalStore(subscribe, get, () => null)
}
