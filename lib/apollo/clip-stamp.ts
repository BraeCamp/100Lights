// A clip's identity: the hash that decides whether a render can be reused.
//
// ⚠️ Extracted from daw-freeze.ts so it can be computed WITHOUT the engine.
// daw-freeze pulls in engine-client, which drags the worklet client and its
// whole dependency chain along with it — so computing a stamp used to require
// booting most of Apollo. That is wrong twice over: the server route only needs
// the hash (and was bundling the engine to get it), and a plain-Node check
// could not compute one at all, which is exactly what made the server render
// path untestable from outside the browser.
//
// Nothing here touches audio. It is a pure function of notes, patch and tempo.

import { RENDER_SAMPLE_RATE } from '@/lib/render-rate'
import type { ApolloPatch } from './patch'
import type { MidiClip } from '@/lib/daw-types'

function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(36)
}

// Hashing a stamp is not cheap, and the scheduler asks for one CONSTANTLY.
//
// combinedStamp runs on every scheduler pass for every Apollo clip — it is how
// playback finds the buffer to play. Each call was walking every note in the
// clip to build a string, hashing it, then running JSON.stringify over the
// ENTIRE Apollo patch (a fat patch is ~9.4KB) and hashing that too. Profiled on
// Iced, that came to 35% of all main-thread work during playback of an
// ALREADY-COMBINED song: 348ms in hash and 280ms in freezeStamp out of 1,966ms.
// The song was finished; the work was pure overhead, repeated forever.
//
// Both halves are memoised on object identity. The reducer never mutates a notes
// array or a patch in place — it maps to new ones — so a change always produces
// a new object and therefore a new hash. WeakMaps mean nothing is retained after
// an edit drops the old object.
const notesHashCache = new WeakMap<object, string>()
const patchHashCache = new WeakMap<object, string>()

// Both memos fall back to hashing directly when handed something a WeakMap
// cannot key on. A stamp is on the scheduling path, and a thrown TypeError there
// stops playback finding ANY buffer — a missing patch should degrade to a slower
// stamp, not to silence.
function notesHash(notes: MidiClip['notes']): string {
  if (!notes || typeof notes !== 'object') return hash(String(notes))
  const cached = notesHashCache.get(notes as unknown as object)
  if (cached !== undefined) return cached
  const h = hash(notes.map(x => `${x.pitch}:${x.startBeat}:${x.durationBeats}:${x.velocity}`).join(','))
  notesHashCache.set(notes as unknown as object, h)
  return h
}

function patchHash(patch: ApolloPatch): string {
  if (!patch || typeof patch !== 'object') return hash(String(patch))
  const cached = patchHashCache.get(patch as unknown as object)
  if (cached !== undefined) return cached
  const h = hash(JSON.stringify(patch))
  patchHashCache.set(patch as unknown as object, h)
  return h
}

/** The identity of a render: change the notes, the patch or the tempo and this
 *  changes, which is what tells a cached freeze it is stale. */
export function freezeStamp(notes: MidiClip['notes'], patch: ApolloPatch, bpm: number): string {
  // ⚠️ The RATE is part of what a render is. It was not in here, so a render
  // made at 44.1 kHz and one made at 48 kHz were indistinguishable — which was
  // survivable while renders never left the machine that made them, and is not
  // survivable now that they are cached, shared and served from the backend.
  //
  // Everything renders at RENDER_SAMPLE_RATE today, so in practice this is a
  // constant; it is in the stamp so that if it ever changes, or a render
  // arrives from somewhere that used a different one, the two can never be
  // mistaken for each other. Existing cached renders simply re-render once.
  return `${notesHash(notes)}-${patchHash(patch)}-${bpm}-${RENDER_SAMPLE_RATE}`
}

