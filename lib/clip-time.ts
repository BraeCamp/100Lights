// The clip's loop brace and its time commands, without the roll.
//
// Beacon's MIDI clip loops from its start: `loopEnabled` and
// `loopLengthBeats` say the pattern repeats every L beats for the clip's
// length. Live's brace has a position as well; ours starts at 0, and that
// is the one difference to keep in mind reading this. The operations —
// Duplicate Loop (⌘D on the brace), Crop (⇧⌘J), Insert / Delete /
// Duplicate Time, Select Material in Loop (⇧⌘L) — are pure functions over a
// clip's notes and lengths so the roll, the palette and the voice path all
// cut the same way and a unit test can pin the results.

import type { MidiNote } from './daw-types'
import { MIN_NOTE_BEATS } from './pitch-time'

export interface ClipTime {
  durationBeats: number
  loopEnabled?: boolean
  loopLengthBeats?: number
  notes: MidiNote[]
}

const round = (b: number) => Math.round(b * 1e6) / 1e6
const EPS = 1e-6

/** The loop brace, [0, L), when the clip loops — else null. */
export function loopRange(clip: ClipTime): { start: number; end: number } | null {
  return clip.loopEnabled && clip.loopLengthBeats && clip.loopLengthBeats > 0 ? { start: 0, end: clip.loopLengthBeats } : null
}

/** The range a time command works on: the loop brace when there is one, the whole clip otherwise. */
export function workingRange(clip: ClipTime): { start: number; end: number } {
  return loopRange(clip) ?? { start: 0, end: clip.durationBeats }
}

/** The notes that start inside the brace (Select Material in Loop). */
export function notesInRange(notes: MidiNote[], start: number, end: number): MidiNote[] {
  return notes.filter(n => n.startBeat >= start - EPS && n.startBeat < end - EPS)
}

/**
 * Duplicate Loop: the loop doubles and its contents are copied into the new
 * half; material to the right of the loop keeps its position relative to the
 * loop's end (it moves along). The clip grows to hold the new loop when it has
 * to, in whole bars.
 */
export function duplicateLoop(clip: ClipTime, newId: () => string, barBeats = 4): { notes: MidiNote[]; loopLengthBeats: number; durationBeats: number } | null {
  const range = loopRange(clip)
  if (!range) return null
  const L = range.end
  const inside = clip.notes.filter(n => n.startBeat < L - EPS)
  const after = clip.notes.filter(n => n.startBeat >= L - EPS)
  const notes: MidiNote[] = [
    ...inside,
    ...inside.map(n => ({ ...n, id: newId(), startBeat: round(n.startBeat + L) })),
    ...after.map(n => ({ ...n, startBeat: round(n.startBeat + L) })),
  ]
  const need = Math.max(clip.durationBeats, 2 * L, ...notes.map(n => n.startBeat + n.durationBeats))
  const durationBeats = Math.max(clip.durationBeats, Math.ceil((need - EPS) / barBeats) * barBeats)
  return { notes, loopLengthBeats: round(2 * L), durationBeats }
}

/**
 * Crop: everything outside [start, end) goes; what overlaps the edges is
 * trimmed; the rest moves so the range starts at 0 and becomes the clip's
 * length. A loop longer than the crop shrinks to it.
 */
export function cropToRange(clip: ClipTime, start: number, end: number): { notes: MidiNote[]; durationBeats: number; loopLengthBeats?: number } | null {
  if (!(end > start + EPS)) return null
  const notes: MidiNote[] = []
  for (const n of clip.notes) {
    const s = Math.max(n.startBeat, start), e = Math.min(n.startBeat + n.durationBeats, end)
    if (e - s < MIN_NOTE_BEATS) continue
    notes.push({ ...n, startBeat: round(s - start), durationBeats: round(e - s) })
  }
  const durationBeats = round(end - start)
  const loopLengthBeats = clip.loopEnabled && clip.loopLengthBeats ? Math.min(clip.loopLengthBeats, durationBeats) : clip.loopLengthBeats
  return { notes, durationBeats, ...(loopLengthBeats != null ? { loopLengthBeats } : {}) }
}

/**
 * Insert Time: `beats` of silence at `at`. Notes starting at or after the
 * point move later; a note spanning the point grows to keep its end where
 * the material after it went.
 */
export function insertTime(notes: MidiNote[], at: number, beats: number): MidiNote[] {
  if (!(beats > 0)) return notes
  return notes.map(n => {
    if (n.startBeat >= at - EPS) return { ...n, startBeat: round(n.startBeat + beats) }
    if (n.startBeat + n.durationBeats > at + EPS) return { ...n, durationBeats: round(n.durationBeats + beats) }
    return n
  })
}

/**
 * Delete Time: [start, end) is removed and what follows closes the gap.
 * Notes inside go; notes overlapping an edge are trimmed; a note spanning
 * the whole range shortens by it.
 */
export function deleteTime(notes: MidiNote[], start: number, end: number): MidiNote[] {
  const span = end - start
  if (!(span > EPS)) return notes
  const out: MidiNote[] = []
  for (const n of notes) {
    const s = n.startBeat, e = n.startBeat + n.durationBeats
    if (s >= end - EPS) { out.push({ ...n, startBeat: round(s - span) }); continue }       // after: closes up
    if (e <= start + EPS) { out.push(n); continue }                                         // before: untouched
    if (s >= start - EPS && e <= end + EPS) continue                                        // inside: gone
    // Overlapping an edge or spanning the range: what is inside is cut out.
    const kept = round(e - s - (Math.min(e, end) - Math.max(s, start)))
    if (kept < MIN_NOTE_BEATS) continue
    out.push({ ...n, startBeat: round(Math.min(s, start)), durationBeats: kept })
  }
  return out
}

/**
 * Duplicate Time: a copy of [start, end) is inserted at `end`; everything
 * from `end` on moves later by the range's length. Notes spanning `end` are
 * cut there so the copy is exact.
 */
export function duplicateTime(notes: MidiNote[], start: number, end: number, newId: () => string): MidiNote[] {
  const span = end - start
  if (!(span > EPS)) return notes
  const out: MidiNote[] = []
  const copies: MidiNote[] = []
  for (const n of notes) {
    const s = n.startBeat, e = n.startBeat + n.durationBeats
    if (s >= end - EPS) { out.push({ ...n, startBeat: round(s + span) }); continue }
    if (e <= start + EPS) { out.push(n); continue }
    // Inside or overlapping: the part inside the range is copied.
    const cs = Math.max(s, start), ce = Math.min(e, end)
    if (s < start - EPS) out.push({ ...n, durationBeats: round(start - s) })   // the head before the range stays
    else out.push(e > end + EPS ? { ...n, durationBeats: round(end - s) } : n)
    if (ce - cs >= MIN_NOTE_BEATS) copies.push({ ...n, id: newId(), startBeat: round(cs + span), durationBeats: round(ce - cs) })
    if (e > end + EPS) out.push({ ...n, id: newId(), startBeat: round(end + span), durationBeats: round(e - end) })   // the tail after the range moves along
  }
  return [...out, ...copies]
}

/** A loop length said out loud: "2 bars", "a bar", "8 beats", "four bars". */
export function parseLoopLength(said: string, barBeats = 4): number | null {
  const t = said.toLowerCase().trim()
  const WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, six: 6, eight: 8, sixteen: 16 }
  const m = /(\d+(?:\.\d+)?|a|an|one|two|three|four|six|eight|sixteen)\s*(bars?|beats?)/.exec(t)
  if (!m) return null
  const n = WORDS[m[1]] ?? Number(m[1])
  if (!(n > 0)) return null
  return /bar/.test(m[2]) ? n * barBeats : n
}
