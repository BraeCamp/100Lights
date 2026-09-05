// Note surgery, without the roll: Split, Chop, Join, Fit to Time Range,
// Deactivate, and Live's overlap rule.
//
// Live 12 gave the note editor a set of cutting tools — hold E and draw a
// line through notes to split them, ⌘E to chop a selection on the grid, ⌘J
// to join notes on one key into one, ⌘⌥J to fit a selection to a time
// range, 0 to deactivate a note in place — and one rule about what happens
// when notes land on each other. Every operation here is a pure function
// over notes that returns what to remove and what to add (a `Splice`), or
// the patches to apply, so the roll's keys, the ⌘K palette and the voice
// path all cut the same way and a unit test can prove the pieces exact.
//
// A split's FIRST piece keeps the note's id: the selection stays on it,
// its per-note sound (fx) stays with it, and the engine's note keys for the
// part already scheduled do not churn. The other pieces are new notes.

import type { MidiNote } from './daw-types'
import type { NotePatch } from './pitch-time'
import { MIN_NOTE_BEATS } from './pitch-time'

export interface Splice { remove: string[]; add: MidiNote[] }
export const EMPTY_SPLICE: Splice = { remove: [], add: [] }

const round = (b: number) => Math.round(b * 1e6) / 1e6
const EPS = 1e-6

/** One note cut at the given beats (only cuts strictly inside it count). */
function cut(note: MidiNote, at: number[], newId: () => string): MidiNote[] {
  const end = note.startBeat + note.durationBeats
  const cuts = [...new Set(at.map(round))].filter(b => b > note.startBeat + EPS && b < end - EPS).sort((a, b) => a - b)
  if (!cuts.length) return [note]
  const edges = [note.startBeat, ...cuts, end]
  return edges.slice(0, -1).map((s, i) => ({
    ...note,
    id: i === 0 ? note.id : newId(),
    startBeat: round(s),
    durationBeats: round(edges[i + 1] - s),
  }))
}

/** Every note that spans `beat` is cut there. Notes that do not are left alone. */
export function splitAt(notes: MidiNote[], beat: number, newId: () => string): Splice {
  return splitEach(notes, () => [beat], newId)
}

/** Each note cut at the beats `cutsFor` names for it — the general form. */
export function splitEach(notes: MidiNote[], cutsFor: (n: MidiNote) => number[], newId: () => string): Splice {
  const out: Splice = { remove: [], add: [] }
  for (const n of notes) {
    const pieces = cut(n, cutsFor(n), newId)
    if (pieces.length < 2) continue
    out.remove.push(n.id)
    out.add.push(...pieces)
  }
  return out
}

/** Chop: each note into `parts` equal pieces (Live's Chop Note(s), ⌘↑↓ for the count). */
export function chopNotes(notes: MidiNote[], parts: number, newId: () => string): Splice {
  const p = Math.max(2, Math.min(64, Math.round(parts)))
  return splitEach(notes, n => {
    if (n.durationBeats / p < MIN_NOTE_BEATS) return []
    return Array.from({ length: p - 1 }, (_, i) => n.startBeat + (n.durationBeats * (i + 1)) / p)
  }, newId)
}

/** Chop on the grid: each note cut at every grid line inside it (⌘E on a selection). */
export function chopOnGrid(notes: MidiNote[], grid: number, newId: () => string): Splice {
  if (!(grid > 0)) return EMPTY_SPLICE
  return splitEach(notes, n => {
    const end = n.startBeat + n.durationBeats
    const cuts: number[] = []
    for (let b = Math.floor(n.startBeat / grid + 1) * grid; b < end - EPS; b += grid) cuts.push(b)
    return cuts
  }, newId)
}

/**
 * Join: the notes on each key track merged into one, from the earliest
 * start to the latest end, with the first note's velocity and sound (⌘J).
 * A key with one note is left alone.
 */
export function joinNotes(notes: MidiNote[]): Splice {
  const byPitch = new Map<number, MidiNote[]>()
  for (const n of notes) byPitch.set(n.pitch, [...(byPitch.get(n.pitch) ?? []), n])
  const out: Splice = { remove: [], add: [] }
  for (const group of byPitch.values()) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => a.startBeat - b.startBeat)
    const start = sorted[0].startBeat
    const end = Math.max(...sorted.map(n => n.startBeat + n.durationBeats))
    out.remove.push(...sorted.map(n => n.id))
    out.add.push({ ...sorted[0], startBeat: round(start), durationBeats: round(end - start) })
  }
  return out
}

/** Fit to Time Range: the notes scaled so the earliest start lands on `start` and the latest end on `end` (⌘⌥J). */
export function fitToRange(notes: MidiNote[], start: number, end: number): NotePatch[] {
  if (!notes.length || !(end > start)) return []
  const lo = Math.min(...notes.map(n => n.startBeat))
  const hi = Math.max(...notes.map(n => n.startBeat + n.durationBeats))
  const span = hi - lo
  // A single moment (one note, or a chord) has no span to scale; it moves to
  // the start and fills the range.
  const f = span > EPS ? (end - start) / span : 1
  return notes.map(n => ({
    id: n.id,
    patch: {
      startBeat: round(start + (n.startBeat - lo) * f),
      durationBeats: Math.max(MIN_NOTE_BEATS, round(span > EPS ? n.durationBeats * f : end - start)),
    },
  }))
}

/** Deactivate (0): the notes kept in place, drawn dimmed, silent. `active: true` brings them back. */
export function setActive(notes: MidiNote[], active: boolean): NotePatch[] {
  return notes
    .filter(n => (n.active === false) === active)
    .map(n => ({ id: n.id, patch: { active: active ? undefined : false } }))
}

/** Which way a toggle goes: on when any of them is off. */
export const anyInactive = (notes: MidiNote[]) => notes.some(n => n.active === false)

/**
 * Live's overlap rule, for the notes that just landed (`changed`) against
 * the notes already on the same key: a landing note that covers the START
 * of an existing note overwrites it; one that lands INSIDE an existing note
 * shortens the existing note to end where the new one starts. Two notes that
 * both just landed are left to each other — a chord stamp, a pasted run.
 */
export function resolveOverlaps(notes: MidiNote[], changed: Set<string>): { remove: string[]; patches: NotePatch[] } {
  const remove = new Set<string>()
  const patches: NotePatch[] = []
  const landed = notes.filter(n => changed.has(n.id))
  for (const c of landed) {
    const cEnd = c.startBeat + c.durationBeats
    for (const o of notes) {
      if (o.id === c.id || changed.has(o.id) || o.pitch !== c.pitch || remove.has(o.id)) continue
      const oEnd = o.startBeat + o.durationBeats
      if (c.startBeat <= o.startBeat + EPS && cEnd > o.startBeat + EPS) remove.add(o.id)
      else if (o.startBeat < c.startBeat - EPS && oEnd > c.startBeat + EPS) {
        const d = round(c.startBeat - o.startBeat)
        if (d >= MIN_NOTE_BEATS) patches.push({ id: o.id, patch: { durationBeats: d } })
        else remove.add(o.id)
      }
    }
  }
  return { remove: [...remove], patches }
}

/** A splice applied to a note list — for tests and for previewing. */
export function applySplice(notes: MidiNote[], s: Splice): MidiNote[] {
  const gone = new Set(s.remove)
  return [...notes.filter(n => !gone.has(n.id)), ...s.add]
}
