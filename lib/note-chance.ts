// Chance, velocity deviation and probability groups — the arithmetic.
//
// Live's note expression: a note has a CHANCE of playing on any given pass
// (0..1; the default is 1, always), a velocity DEVIATION (± up to this many
// steps, picked afresh each pass), and may belong to a PROBABILITY GROUP —
// Play All (every member rolls its own dice) or Play One (exactly one member
// plays per pass, chosen with the members' chances as weights).
//
// Everything is seeded by a key the engine builds from the clip, the pass
// and the note, never Math.random: the same song renders the same every
// time (project-100lights-render-determinism), and two machines agree.

import type { MidiNote, MidiClip } from './daw-types'
import { rngFor } from './seeded-random'

export type GroupMode = 'all' | 'one'

/** The chance a note plays on a pass, 0..1 — absent means always. */
export const chanceOf = (n: Pick<MidiNote, 'chance'>) => (n.chance == null ? 1 : Math.max(0, Math.min(1, n.chance)))

/**
 * Does any note in the clip need a roll — a chance under 1, a deviation, a
 * probability group? A clip that does cannot be played as one pre-rendered
 * buffer: the dice fall differently on every pass, so its notes have to be
 * scheduled one by one.
 */
export function clipHasExpression(clip: Pick<MidiClip, 'notes' | 'chanceGroups'>): boolean {
  if (clip.chanceGroups && Object.keys(clip.chanceGroups).length) return true
  return clip.notes.some(n => (n.chance != null && n.chance < 1) || (n.deviation ?? 0) > 0 || !!n.chanceGroup)
}

export interface Rolled { fires: boolean; note: MidiNote }

/**
 * Roll a note for one pass. `groupWinner` is the id Play One chose for the
 * note's group this pass (or undefined when the note is in no such group).
 * A fired note comes back with its deviated velocity applied.
 */
export function rollNote(note: MidiNote, seed: string, groupWinner?: string | null): Rolled {
  if (groupWinner !== undefined) {
    if (groupWinner !== note.id) return { fires: false, note }
    // The winner already carried its weight into the pick: it plays.
  } else {
    const c = chanceOf(note)
    if (c < 1 && rngFor(`chance:${seed}`)() >= c) return { fires: false, note }
  }
  const dev = note.deviation ?? 0
  if (dev > 0) {
    const r = rngFor(`dev:${seed}`)() * 2 - 1
    const v = Math.max(1, Math.min(127, Math.round(note.velocity + r * dev)))
    return { fires: true, note: v === note.velocity ? note : { ...note, velocity: v } }
  }
  return { fires: true, note }
}

/**
 * Which member of a Play One group plays this pass. Members are weighted by
 * their chance; a group whose members all have chance 0 plays nobody (null).
 */
export function pickForGroup(members: Pick<MidiNote, 'id' | 'chance'>[], seed: string): string | null {
  if (!members.length) return null
  const sorted = [...members].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const weights = sorted.map(chanceOf)
  const total = weights.reduce((a, b) => a + b, 0)
  if (total <= 0) return null
  let x = rngFor(`group:${seed}`)() * total
  for (let i = 0; i < sorted.length; i++) { x -= weights[i]; if (x < 0) return sorted[i].id }
  return sorted[sorted.length - 1].id
}

/**
 * The Play One winners for every group in a clip, for one pass — computed
 * once per pass rather than per note. Groups in Play All mode are absent.
 */
export function groupWinners(clip: Pick<MidiClip, 'notes' | 'chanceGroups'>, passSeed: string): Map<string, string | null> {
  const out = new Map<string, string | null>()
  const modes = clip.chanceGroups ?? {}
  for (const [group, mode] of Object.entries(modes)) {
    if (mode !== 'one') continue
    const members = clip.notes.filter(n => n.chanceGroup === group)
    out.set(group, pickForGroup(members, `${passSeed}:${group}`))
  }
  return out
}

/** The winner argument for rollNote: undefined when the note is in no Play One group. */
export function winnerFor(note: MidiNote, winners: Map<string, string | null>): string | null | undefined {
  if (!note.chanceGroup || !winners.has(note.chanceGroup)) return undefined
  return winners.get(note.chanceGroup) ?? null
}

// ── The lane's Randomize / Ramp ────────────────────────────────────────────

export type LaneField = 'velocity' | 'deviation' | 'chance'
export const LANE_MAX: Record<LaneField, number> = { velocity: 127, deviation: 127, chance: 100 }

/** A note's lane value in the lane's units (velocity 1..127, deviation 0..127, chance 0..100 %). */
export function laneValue(n: MidiNote, field: LaneField): number {
  if (field === 'velocity') return n.velocity
  if (field === 'deviation') return n.deviation ?? 0
  return Math.round(chanceOf(n) * 100)
}

/** The patch that sets a note's lane value. */
export function lanePatch(field: LaneField, value: number): Partial<MidiNote> {
  const v = Math.max(field === 'velocity' ? 1 : 0, Math.min(LANE_MAX[field], Math.round(value)))
  if (field === 'velocity') return { velocity: v }
  if (field === 'deviation') return { deviation: v || undefined }
  return { chance: v >= 100 ? undefined : v / 100 }
}

/** Randomize: each note moves by up to ±amount % of the lane, seeded so it is repeatable. */
export function randomizeLane(notes: MidiNote[], field: LaneField, amountPct: number, seed: string): Array<{ id: string; patch: Partial<MidiNote> }> {
  const span = LANE_MAX[field] * Math.max(0, Math.min(100, amountPct)) / 100
  return notes.map(n => {
    const r = rngFor(`rand:${seed}:${n.id}`)() * 2 - 1
    return { id: n.id, patch: lanePatch(field, laneValue(n, field) + r * span) }
  })
}

/** Ramp: a straight line from `from` to `to` across the notes in time order. */
export function rampLane(notes: MidiNote[], field: LaneField, from: number, to: number): Array<{ id: string; patch: Partial<MidiNote> }> {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  return sorted.map((n, i) => ({ id: n.id, patch: lanePatch(field, sorted.length > 1 ? from + (to - from) * (i / (sorted.length - 1)) : to) }))
}
