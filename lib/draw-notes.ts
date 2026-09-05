// The pencil's arithmetic: what one stroke in Draw Mode does to a clip.
//
// A click places one grid-length note. A horizontal drag places one note
// per grid step it crosses — at the pitch the stroke started on when Pitch
// Lock is on, at the pitch under the pointer when it is off. Dragging back
// over steps drawn in the same stroke erases them again. A vertical drag
// before the pointer has moved a step sideways sets the velocity of the
// note under it, and the next note inherits the last velocity. Pure, so
// each of those sentences is a test; the roll only turns pointer events
// into calls.

import type { MidiNote } from './daw-types'

export interface StrokeNote { id: string; pitch: number; startBeat: number; durationBeats: number; velocity: number }

export interface Stroke {
  /** Grid size in beats — a note is one step long, and steps are the columns. */
  quant: number
  /** Where the stroke began. */
  startBeat: number
  startPitch: number
  velocity: number
  pitchLock: boolean
  /** Notes this stroke has placed so far, by step index. */
  placed: Map<number, StrokeNote>
  /** The furthest step the stroke has reached (so a drag back erases). */
  farthest: number
  /** Beats the clip's grid ends at (a loop's pattern length); notes past it are not drawn. */
  limitBeat?: number
}

/** Snap a beat down onto the grid. */
export const stepOf = (beat: number, quant: number) => Math.max(0, Math.floor(beat / quant + 1e-9))

export function beginStroke(beat: number, pitch: number, quant: number, velocity: number, pitchLock: boolean, limitBeat?: number): Stroke {
  return { quant, startBeat: stepOf(beat, quant) * quant, startPitch: pitch, velocity, pitchLock, placed: new Map(), farthest: -1, limitBeat }
}

/**
 * The stroke has reached `beat` (and `pitch`, for an unlocked stroke): the
 * notes to add and the ids to remove so that every step from the start to
 * here — and no step beyond — carries exactly one note of this stroke.
 */
export function strokeTo(s: Stroke, beat: number, pitch: number, makeId: () => string): { add: StrokeNote[]; remove: string[] } {
  const startStep = stepOf(s.startBeat, s.quant)
  const step = Math.max(startStep, stepOf(beat, s.quant))
  const add: StrokeNote[] = []
  const remove: string[] = []
  // Forward: fill any step not yet placed, up to the pointer.
  for (let k = startStep; k <= step; k++) {
    if (s.placed.has(k)) continue
    const startBeat = k * s.quant
    if (s.limitBeat != null && startBeat >= s.limitBeat - 1e-9) break
    const n: StrokeNote = { id: makeId(), pitch: s.pitchLock ? s.startPitch : pitch, startBeat, durationBeats: s.quant, velocity: s.velocity }
    s.placed.set(k, n)
    add.push(n)
  }
  // Back: anything placed beyond the pointer comes off again.
  for (const [k, n] of [...s.placed]) {
    if (k > step) { remove.push(n.id); s.placed.delete(k) }
  }
  s.farthest = Math.max(s.farthest, step)
  return { add, remove }
}

/** A vertical drag sets the velocity: pixels up = louder, 1..127. */
export function velocityFromDrag(startVelocity: number, dyPixels: number, pixelsPerFullRange = 100): number {
  return Math.max(1, Math.min(127, Math.round(startVelocity - (dyPixels / pixelsPerFullRange) * 127)))
}

/** The note (if any) a click in Draw Mode lands on — in Draw Mode that click erases it. */
export function noteUnder(notes: MidiNote[], beat: number, pitch: number): MidiNote | undefined {
  return notes.find(n => n.pitch === pitch && beat >= n.startBeat && beat < n.startBeat + n.durationBeats)
}
