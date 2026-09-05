// The Pitch & Time utilities, without the roll.
//
// Live 12 renamed the clip's Notes box "Pitch & Time" and filled it in:
// Transpose (in scale degrees when a scale is on), Invert, Add Interval with
// an Interval Size, Stretch with ×2 and ÷2, a Duration chooser with Set
// Length, Humanize with an Amount, Reverse, Legato. Beacon had transpose,
// ×2/÷2 on lengths only, a humanise with no amount, legato — and the rest
// were missing. Everything here is a pure function over notes that returns
// the patches (or the new notes) to dispatch, so the roll's buttons, the ⌘K
// palette and the voice path all do exactly the same arithmetic, and a unit
// test can prove the note sets are exact.
//
// ⚠️ Velocity is 0–127 on a MidiNote (lib/daw-types.ts). The roll's old
// Humanise and Play harder/softer clamped it to 1.0 — a silent note wearing a
// louder label. Nothing in here touches velocity; the deviation lane
// (lib/note-chance.ts) is where velocity gets its randomness, per pass.
//
// ⚠️ Humanize is seeded (lib/seeded-random.ts). A humanised clip is stored as
// plain note positions, so a render is deterministic either way; the seed is
// so that undo → redo gives back the same performance rather than a new one.

import type { MidiNote } from './daw-types'
import { rngFor } from './seeded-random'

export type NotePatch = { id: string; patch: Partial<MidiNote> }

/** A scale the way the roll knows it: a root pitch class and its intervals. */
export interface Scale { root: number; intervals: number[] }

const clampPitch = (p: number) => Math.max(0, Math.min(127, Math.round(p)))
export const MIN_NOTE_BEATS = 1 / 64

/** Every MIDI pitch in the scale, low to high — the ladder a degree move climbs. */
export function scaleLadder(scale: Scale): number[] {
  const classes = new Set(scale.intervals.map(i => (((i + scale.root) % 12) + 12) % 12))
  const out: number[] = []
  for (let p = 0; p <= 127; p++) if (classes.has(p % 12)) out.push(p)
  return out
}

/**
 * The rung a pitch sits on. In-scale pitches are exact; a pitch outside the
 * scale takes the nearest rung, the lower one on a tie, so a move by degrees
 * pulls it into key rather than leaving it stranded between rungs.
 */
export function ladderIndex(ladder: number[], pitch: number): number {
  if (!ladder.length) return 0
  let best = 0, bestD = Infinity
  for (let i = 0; i < ladder.length; i++) {
    const d = Math.abs(ladder[i] - pitch)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

const scaleOf = (scale: Scale | null | undefined): Scale | null =>
  scale && scale.intervals.length && scale.intervals.length < 12 ? scale : null

/** Every note moved by semitones. */
export function transposeNotes(notes: MidiNote[], semitones: number): NotePatch[] {
  if (!semitones) return []
  return notes.map(n => ({ id: n.id, patch: { pitch: clampPitch(n.pitch + semitones) } }))
}

/** Every note moved by scale degrees — up a degree from E in C major is F, not F♯. */
export function transposeDegrees(notes: MidiNote[], degrees: number, scale: Scale): NotePatch[] {
  if (!degrees) return []
  const s = scaleOf(scale)
  if (!s) return transposeNotes(notes, degrees)
  const ladder = scaleLadder(s)
  return notes.map(n => {
    const i = Math.max(0, Math.min(ladder.length - 1, ladderIndex(ladder, n.pitch) + degrees))
    return { id: n.id, patch: { pitch: ladder[i] } }
  })
}

/**
 * Invert: the notes flipped upside down, the highest becoming the lowest.
 * Chromatic when there is no scale (pitch′ = low + high − pitch); by degrees
 * when there is one, so an inverted line stays in key.
 */
export function invertNotes(notes: MidiNote[], scale?: Scale | null): NotePatch[] {
  if (notes.length < 2) return []
  const s = scaleOf(scale)
  if (!s) {
    const lo = Math.min(...notes.map(n => n.pitch)), hi = Math.max(...notes.map(n => n.pitch))
    return notes.map(n => ({ id: n.id, patch: { pitch: clampPitch(lo + hi - n.pitch) } }))
  }
  const ladder = scaleLadder(s)
  const idx = notes.map(n => ladderIndex(ladder, n.pitch))
  const lo = Math.min(...idx), hi = Math.max(...idx)
  return notes.map((n, k) => ({ id: n.id, patch: { pitch: ladder[Math.max(0, Math.min(ladder.length - 1, lo + hi - idx[k]))] } }))
}

/**
 * Add Interval: a copy of every note `size` semitones away — or `size`
 * degrees when a scale is on, which is how two degrees above a bass line
 * gives you thirds that stay in key. The copies are new notes; the originals
 * stay, which is the difference between this and Transpose. Copies that would
 * land on a note already there (same pitch and start) are skipped.
 */
export function addInterval(notes: MidiNote[], size: number, scale: Scale | null | undefined, newId: () => string): MidiNote[] {
  if (!size) return []
  const s = scaleOf(scale)
  const ladder = s ? scaleLadder(s) : null
  const taken = new Set(notes.map(n => `${n.pitch}@${n.startBeat.toFixed(6)}`))
  const out: MidiNote[] = []
  for (const n of notes) {
    let pitch: number
    if (ladder) {
      const i = ladderIndex(ladder, n.pitch) + size
      if (i < 0 || i >= ladder.length) continue
      pitch = ladder[i]
    } else {
      pitch = n.pitch + size
      if (pitch < 0 || pitch > 127) continue
    }
    const key = `${pitch}@${n.startBeat.toFixed(6)}`
    if (taken.has(key)) continue
    taken.add(key)
    out.push({ ...n, id: newId(), pitch })
  }
  return out
}

/**
 * Stretch: positions and lengths multiplied, anchored on the earliest note
 * so the phrase keeps its place and grows (or shrinks) to the right. ×2 is
 * half speed, ÷2 double speed. The clip's own length is the caller's to
 * grow — Live leaves the loop alone, and so does this.
 */
export function stretchNotes(notes: MidiNote[], factor: number): NotePatch[] {
  if (!notes.length || !(factor > 0) || factor === 1) return []
  const lo = Math.min(...notes.map(n => n.startBeat))
  return notes.map(n => ({
    id: n.id,
    patch: {
      startBeat: round(lo + (n.startBeat - lo) * factor),
      durationBeats: Math.max(MIN_NOTE_BEATS, round(n.durationBeats * factor)),
    },
  }))
}

/** Set Length: every note the same duration, from the chooser. */
export function setLength(notes: MidiNote[], beats: number): NotePatch[] {
  const d = Math.max(MIN_NOTE_BEATS, beats)
  return notes.filter(n => Math.abs(n.durationBeats - d) > 1e-9).map(n => ({ id: n.id, patch: { durationBeats: d } }))
}

/**
 * Humanize: each note's start shifted by a random amount, earlier or later,
 * up to `amountPct` of half a grid step — 50 % moves a note by up to a
 * quarter of the grid, the manual's number. Seeded per note from `seed`, so
 * the same seed gives the same feel.
 */
export function humanizeNotes(notes: MidiNote[], amountPct: number, gridBeats: number, seed: string): NotePatch[] {
  const max = Math.max(0, Math.min(100, amountPct)) / 100 * Math.max(MIN_NOTE_BEATS, gridBeats) * 0.5
  if (max <= 0) return []
  return notes.map(n => {
    const r = rngFor(`humanize:${seed}:${n.id}`)()
    return { id: n.id, patch: { startBeat: Math.max(0, round(n.startBeat + (r * 2 - 1) * max)) } }
  })
}

/**
 * Reverse: the pattern retrograded within a time range — the notes' own
 * extent by default, the whole clip when the caller passes it. Mirrors each
 * note's END, so a long note reversed finishes where it used to start.
 */
export function reverseNotes(notes: MidiNote[], range?: { start: number; end: number }): NotePatch[] {
  if (!notes.length) return []
  const start = range?.start ?? Math.min(...notes.map(n => n.startBeat))
  const end = range?.end ?? Math.max(...notes.map(n => n.startBeat + n.durationBeats))
  return notes.map(n => ({ id: n.id, patch: { startBeat: Math.max(0, round(start + (end - (n.startBeat + n.durationBeats)))) } }))
}

/** The Duration chooser's rungs, in beats (4/4: a bar is four). */
export const DURATIONS: { label: string; beats: number; said: string[] }[] = [
  { label: '1/32', beats: 0.125, said: ['thirty second', 'thirty-second', '1/32', '32nd', '32nds'] },
  { label: '1/16', beats: 0.25, said: ['sixteenth', '1/16', '16th', '16ths'] },
  { label: '1/8', beats: 0.5, said: ['eighth', '1/8', '8th', '8ths'] },
  { label: '1/4', beats: 1, said: ['quarter', '1/4', 'a beat', 'one beat'] },
  { label: '1/2', beats: 2, said: ['half', '1/2', 'two beats'] },
  { label: '1 bar', beats: 4, said: ['whole', 'bar', 'a bar', 'one bar', 'four beats'] },
]

export const durationLabel = (beats: number): string =>
  DURATIONS.find(d => Math.abs(d.beats - beats) < 1e-9)?.label ?? `${+beats.toFixed(3)} beat${beats === 1 ? '' : 's'}`

/** A note length the way a person says it: "eighth notes", "1/16", "a quarter note", "two beats". */
export function parseDuration(said: string): number | null {
  const t = said.trim().toLowerCase().replace(/\s*notes?\s*(long)?$/, '').replace(/^(an?|one)\s+/, '')
  if (!t) return null
  const frac = /^1\s*\/\s*(\d+)$/.exec(t)
  if (frac) { const den = Number(frac[1]); return den > 0 ? 4 / den : null }
  for (const d of DURATIONS) if (d.said.some(s => s === t || s.replace(/^(an?|one)\s+/, '') === t)) return d.beats
  const beats = /^(\d+(?:\.\d+)?)\s*beats?$/.exec(t)
  if (beats) return Number(beats[1])
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 }
  const wb = /^(one|two|three|four)\s+beats?$/.exec(t)
  if (wb) return words[wb[1]]
  return null
}

/** "+7 st" or "+2 degrees" — the interval the way the button says it. */
export function describeInterval(size: number, scaleOn: boolean): string {
  const sign = size > 0 ? '+' : ''
  return scaleOn ? `${sign}${size} degree${Math.abs(size) === 1 ? '' : 's'}` : `${sign}${size} st`
}

const round = (b: number) => Math.round(b * 1e6) / 1e6
