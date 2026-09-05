/**
 * Record Quantization — notes land on the grid as they are played.
 *
 * This is not the same thing as quantising afterwards (lib/quantize.ts). That
 * one is an edit you can see, weigh and undo. This one happens at the moment of
 * capture, before there is anything to look at, and the un-snapped performance
 * is gone. Which is exactly why people want it: a part you cannot quite play in
 * time arrives in time, and you keep going instead of stopping to tidy up.
 *
 * ⚠️ Only note STARTS move. Lengths are kept exactly as played, because the
 * length is the part of a performance that still reads as playing after the
 * timing has been taken away — snapping both would turn every take into a piano
 * roll of identical blocks.
 *
 * ⚠️ And nothing is ever dropped. A grid coarser than the phrase lands several
 * notes on the same line, which is a mess — but it is a mess made of what
 * somebody actually played, and quietly deleting the second of two notes to
 * tidy the picture would lose a performance with no way back. `stacked` counts
 * them so the studio can say the grid was too coarse rather than pretending.
 */

import type { MidiNote } from './daw-types'

export type RecordGrid =
  | 'none'
  | 'quarter' | 'eighth' | 'eighthT' | 'eighthBoth'
  | 'sixteenth' | 'sixteenthT' | 'sixteenthBoth' | 'thirtysecond'
  // ⚠️ Not in Live's menu. Beacon's pad panel had its own input quantize with a
  // half and a whole note on it, and this setting replaces that one — so they
  // are kept rather than quietly taken away from anybody using them.
  | 'half' | 'whole'

export const DEFAULT_RECORD_GRID: RecordGrid = 'none'

/**
 * The menu, in Live's order. `beats` is the straight grid; `triplet` says a
 * triplet grid is offered too, and `both` that the nearer of the two wins —
 * which is how you record a phrase that swings between straight and triplet
 * feel without choosing in advance.
 */
export const RECORD_GRIDS: ReadonlyArray<{ id: RecordGrid; label: string; beats: number; triplet: boolean; both: boolean }> = [
  { id: 'none',          label: 'None',            beats: 0,     triplet: false, both: false },
  { id: 'quarter',       label: '1/4',             beats: 1,     triplet: false, both: false },
  { id: 'eighth',        label: '1/8',             beats: 0.5,   triplet: false, both: false },
  { id: 'eighthT',       label: '1/8 triplets',    beats: 0.5,   triplet: true,  both: false },
  { id: 'eighthBoth',    label: '1/8 and 1/8T',    beats: 0.5,   triplet: true,  both: true  },
  { id: 'sixteenth',     label: '1/16',            beats: 0.25,  triplet: false, both: false },
  { id: 'sixteenthT',    label: '1/16 triplets',   beats: 0.25,  triplet: true,  both: false },
  { id: 'sixteenthBoth', label: '1/16 and 1/16T',  beats: 0.25,  triplet: true,  both: true  },
  { id: 'thirtysecond',  label: '1/32',            beats: 0.125, triplet: false, both: false },
  // Beacon's own two, kept from the pad panel's input quantize. Whole and half
  // are read in 4/4 — the same assumption that control always made.
  { id: 'half',          label: '1/2',             beats: 2,     triplet: false, both: false },
  { id: 'whole',         label: '1/1',             beats: 4,     triplet: false, both: false },
]

const byId = new Map(RECORD_GRIDS.map(g => [g.id, g]))

export function recordGrid(id: RecordGrid | undefined): typeof RECORD_GRIDS[number] {
  return byId.get(id ?? DEFAULT_RECORD_GRID) ?? RECORD_GRIDS[0]
}

export const recordGridLabel = (id: RecordGrid | undefined): string => recordGrid(id).label

const round = (b: number) => Math.round(b * 1e6) / 1e6

/** Where one beat position lands under a record grid. Never negative. */
export function snapRecorded(beat: number, id: RecordGrid | undefined): number {
  const g = recordGrid(id)
  if (!(g.beats > 0)) return beat
  const straight = round(Math.round(beat / g.beats) * g.beats)
  if (!g.triplet) return Math.max(0, straight)
  const tg = (g.beats * 2) / 3
  const trip = round(Math.round(beat / tg) * tg)
  if (!g.both) return Math.max(0, trip)
  // Both grids offered: whichever line is nearer to what was played. A tie goes
  // to the straight one — it is the reading a listener defaults to.
  return Math.max(0, Math.abs(beat - straight) <= Math.abs(beat - trip) ? straight : trip)
}

export interface RecordQuantizeResult {
  notes: MidiNote[]
  /** How many notes moved at all. */
  moved: number
  /** Notes that landed on a line already taken by the same pitch — the sign of
   *  a grid coarser than the phrase. Nothing was dropped; this is a warning. */
  stacked: number
}

/** Snap the starts of a take. Lengths, pitches and velocities are untouched. */
export function quantizeRecorded(notes: MidiNote[], id: RecordGrid | undefined): RecordQuantizeResult {
  const g = recordGrid(id)
  if (!(g.beats > 0)) return { notes, moved: 0, stacked: 0 }
  const seen = new Set<string>()
  let moved = 0
  let stacked = 0
  const out = notes.map(n => {
    const startBeat = snapRecorded(n.startBeat, id)
    if (Math.abs(startBeat - n.startBeat) > 1e-6) moved++
    const key = `${n.pitch}@${startBeat}`
    if (seen.has(key)) stacked++
    seen.add(key)
    return startBeat === n.startBeat ? n : { ...n, startBeat }
  })
  return { notes: out, moved, stacked }
}

/** What just happened to a take, in words. Empty when nothing moved. */
export function describeRecordQuantize(r: RecordQuantizeResult, id: RecordGrid | undefined): string {
  if (!r.moved) return ''
  const label = recordGridLabel(id)
  const base = `${r.moved} note${r.moved === 1 ? '' : 's'} landed on ${label}`
  if (!r.stacked) return `${base}.`
  return `${base} — ${r.stacked} of them on a line already taken, so ${label} is coarser than what you played.`
}
