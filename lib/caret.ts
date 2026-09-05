// Keyboard-only editing in the note editor: the insert marker and the time
// selection, without the roll.
//
// Live's Accessibility chapter describes editing MIDI with no mouse at all:
// an insert marker that ← / → move by the grid, ⌥← / ⌥→ to the previous or
// next note boundary, Home / End to the clip's ends; ⇧← / ⇧→ growing a time
// selection from the marker; Enter turning a time selection into the notes
// inside it, and a note selection back into the time they span. Every step
// here is a pure function so the roll's key handler stays a dispatcher and a
// unit test can pin each move.

import type { MidiNote } from './daw-types'

export interface TimeSel { start: number; end: number }

const round = (b: number) => Math.round(b * 1e6) / 1e6
const EPS = 1e-6

/** The insert marker moved one grid step, clamped to the clip. */
export function moveCaret(caret: number, dir: 1 | -1, grid: number, clipBeats: number): number {
  return round(Math.max(0, Math.min(clipBeats, caret + dir * grid)))
}

/** Every note start and end, sorted and unique — the boundaries ⌥← / ⌥→ jump between. */
export function boundaries(notes: MidiNote[], clipBeats: number): number[] {
  const set = new Set<number>([0, round(clipBeats)])
  for (const n of notes) { set.add(round(n.startBeat)); set.add(round(n.startBeat + n.durationBeats)) }
  return [...set].filter(b => b >= 0 && b <= clipBeats + EPS).sort((a, b) => a - b)
}

/** The next boundary after `from` (dir 1) or the previous one before it (dir −1); `from` itself when there is none. */
export function nextBoundary(notes: MidiNote[], from: number, dir: 1 | -1, clipBeats: number): number {
  const bs = boundaries(notes, clipBeats)
  if (dir > 0) return bs.find(b => b > from + EPS) ?? from
  return [...bs].reverse().find(b => b < from - EPS) ?? from
}

/**
 * ⇧← / ⇧→: the time selection grows from the insert marker by one step —
 * a grid step, or to the next note boundary. With no selection yet it opens
 * one between the marker and the step; an existing one moves the edge that
 * is away from the marker, and collapses to nothing when it reaches it.
 */
export function extendTimeSel(sel: TimeSel | null, caret: number, dir: 1 | -1, step: (from: number, dir: 1 | -1) => number, clipBeats: number): TimeSel | null {
  const anchor = caret
  // The moving edge: the one not at the anchor.
  const edge = sel ? (Math.abs(sel.start - anchor) < EPS ? sel.end : sel.start) : anchor
  const next = Math.max(0, Math.min(clipBeats, step(edge, dir)))
  if (Math.abs(next - anchor) < EPS) return null
  return next > anchor ? { start: round(anchor), end: round(next) } : { start: round(next), end: round(anchor) }
}

/** The notes that start inside a time selection (Enter on a time selection). */
export function notesInTimeSel(notes: MidiNote[], sel: TimeSel): MidiNote[] {
  return notes.filter(n => n.startBeat >= sel.start - EPS && n.startBeat < sel.end - EPS)
}

/** The time a set of notes spans (Enter on a note selection). */
export function timeOfNotes(notes: MidiNote[]): TimeSel | null {
  if (!notes.length) return null
  return { start: round(Math.min(...notes.map(n => n.startBeat))), end: round(Math.max(...notes.map(n => n.startBeat + n.durationBeats))) }
}

/** ⇧← / ⇧→ with notes selected: their length changes by the grid, never below one step. */
export function resizeByGrid(notes: MidiNote[], dir: 1 | -1, grid: number): { id: string; patch: Partial<MidiNote> }[] {
  return notes.map(n => ({ id: n.id, patch: { durationBeats: round(Math.max(grid, n.durationBeats + dir * grid)) } }))
}
