// Find & Select Notes — Live 12.1's magnifier, as a filter over a clip's notes.
//
// A filter is a handful of optional ranges that all have to hold (they
// combine with AND): pitch class across every octave, a pitch span, a time
// window (optionally repeating every N beats — "the first beat of every
// bar"), velocity, chance, duration, a condition (deactivated, chance under
// 100 %, has deviation), every nth note by onset, and in or out of the
// scale. `invert` flips the answer. The roll's toolbar, the ⌘K palette and a
// voice "select every C in the pad" all run the same function, and the
// result is a set of note ids for the roll's selection.

import type { MidiNote } from './daw-types'
import { type Scale, scaleLadder } from './pitch-time'
import { chanceOf } from './note-chance'

export type NoteCondition = 'inactive' | 'active' | 'chance' | 'deviation'

export interface NoteFilter {
  /** 0 = C … 11 = B, in every octave. */
  pitchClass?: number
  pitchMin?: number
  pitchMax?: number
  /** Notes starting in [timeFrom, timeTo), beats relative to the clip. */
  timeFrom?: number
  timeTo?: number
  /** With a time window: the window repeats every this many beats. */
  repeatEvery?: number
  velocityMin?: number
  velocityMax?: number
  /** Percent. */
  chanceMin?: number
  chanceMax?: number
  /** Beats. */
  durationMin?: number
  durationMax?: number
  condition?: NoteCondition
  /** Every nth note by onset order, starting `offset` notes in (0-based). */
  everyNth?: number
  offset?: number
  scale?: 'in' | 'out'
  invert?: boolean
}

export const EMPTY_FILTER: NoteFilter = {}

export function filterIsEmpty(f: NoteFilter): boolean {
  return Object.entries(f).every(([k, v]) => v == null || v === false || (k === 'invert' && !v))
}

const has = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v)

/** The notes the filter picks, in onset order. */
export function findNotes(notes: MidiNote[], f: NoteFilter, ctx: { scale?: Scale | null } = {}): MidiNote[] {
  const sorted = [...notes].sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  const inScale = f.scale && ctx.scale ? new Set(scaleLadder(ctx.scale)) : null
  const matched = sorted.filter((n, i) => {
    if (has(f.pitchClass) && n.pitch % 12 !== ((f.pitchClass % 12) + 12) % 12) return false
    if (has(f.pitchMin) && n.pitch < f.pitchMin) return false
    if (has(f.pitchMax) && n.pitch > f.pitchMax) return false
    if (has(f.timeFrom) || has(f.timeTo)) {
      const from = f.timeFrom ?? -Infinity, to = f.timeTo ?? Infinity
      let s = n.startBeat
      if (has(f.repeatEvery) && f.repeatEvery > 0 && has(f.timeFrom)) {
        // Fold the start into the first window: "beats 0–1 of every bar".
        s = f.timeFrom + ((((s - f.timeFrom) % f.repeatEvery) + f.repeatEvery) % f.repeatEvery)
      }
      if (s < from - 1e-6 || s >= to - 1e-6) return false
    }
    if (has(f.velocityMin) && n.velocity < f.velocityMin) return false
    if (has(f.velocityMax) && n.velocity > f.velocityMax) return false
    const pct = chanceOf(n) * 100
    if (has(f.chanceMin) && pct < f.chanceMin - 1e-9) return false
    if (has(f.chanceMax) && pct > f.chanceMax + 1e-9) return false
    if (has(f.durationMin) && n.durationBeats < f.durationMin - 1e-9) return false
    if (has(f.durationMax) && n.durationBeats > f.durationMax + 1e-9) return false
    if (f.condition === 'inactive' && n.active !== false) return false
    if (f.condition === 'active' && n.active === false) return false
    if (f.condition === 'chance' && chanceOf(n) >= 1) return false
    if (f.condition === 'deviation' && !(n.deviation && n.deviation > 0)) return false
    if (has(f.everyNth) && f.everyNth > 1 && ((i - (f.offset ?? 0)) % f.everyNth !== 0 || i < (f.offset ?? 0))) return false
    if (inScale && f.scale === 'in' && !inScale.has(n.pitch)) return false
    if (inScale && f.scale === 'out' && inScale.has(n.pitch)) return false
    return true
  })
  if (!f.invert) return matched
  const hit = new Set(matched.map(n => n.id))
  return sorted.filter(n => !hit.has(n.id))
}

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

/** The filter in words, for the toolbar's readout and the voice's answer. */
export function describeFilter(f: NoteFilter): string {
  const parts: string[] = []
  if (has(f.pitchClass)) parts.push(`every ${NOTE_NAMES[((f.pitchClass % 12) + 12) % 12]}`)
  if (has(f.pitchMin) && has(f.pitchMax)) parts.push(`pitch ${f.pitchMin}–${f.pitchMax}`)
  else if (has(f.pitchMin)) parts.push(`above ${f.pitchMin - 1}`)
  else if (has(f.pitchMax)) parts.push(`below ${f.pitchMax + 1}`)
  if (has(f.timeFrom) || has(f.timeTo)) parts.push(`starting ${has(f.timeFrom) ? `from beat ${+f.timeFrom.toFixed(2)}` : ''}${has(f.timeTo) ? ` before beat ${+f.timeTo.toFixed(2)}` : ''}${has(f.repeatEvery) ? `, every ${f.repeatEvery} beats` : ''}`.trim())
  if (has(f.velocityMin) || has(f.velocityMax)) parts.push(`velocity ${f.velocityMin ?? 1}–${f.velocityMax ?? 127}`)
  if (has(f.chanceMin) || has(f.chanceMax)) parts.push(`chance ${f.chanceMin ?? 0}–${f.chanceMax ?? 100} %`)
  if (has(f.durationMin) || has(f.durationMax)) parts.push(`${has(f.durationMin) ? `at least ${f.durationMin} beat${f.durationMin === 1 ? '' : 's'}` : ''}${has(f.durationMin) && has(f.durationMax) ? ' and ' : ''}${has(f.durationMax) ? `at most ${f.durationMax} beat${f.durationMax === 1 ? '' : 's'}` : ''} long`)
  if (f.condition === 'inactive') parts.push('deactivated')
  if (f.condition === 'active') parts.push('active')
  if (f.condition === 'chance') parts.push('with chance under 100 %')
  if (f.condition === 'deviation') parts.push('with velocity deviation')
  if (has(f.everyNth) && f.everyNth > 1) parts.push(`every ${f.everyNth === 2 ? 'other' : `${f.everyNth}th`} note${f.offset ? ` from the ${f.offset + 1}${ordinal(f.offset + 1)}` : ''}`)
  if (f.scale === 'in') parts.push('in the scale')
  if (f.scale === 'out') parts.push('outside the scale')
  const body = parts.length ? parts.join(', ') : 'every note'
  return f.invert ? `all but ${body}` : body
}

const ordinal = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th')

/**
 * A filter from the way people say it: "every C", "the quiet notes", "the
 * loud ones", "the short notes", "the long notes", "every other note", "the
 * notes off the scale", "the deactivated notes", "the notes with chance",
 * "above C5", "below G3", "louder than 100", "quieter than 60". Null when the
 * sentence names no filter.
 */
export function parseFilter(said: string, pitchOf: (s: string) => number | null): NoteFilter | null {
  const t = said.toLowerCase()
  const f: NoteFilter = {}
  let any = false
  const pc = /\b(?:every|all the|the)\s+([a-g](?:\s?(?:sharp|flat|#|♯|♭))?)(?:s|'s)?\b(?!\s*\d)/.exec(t)
  if (pc && !/\b(?:above|below|over|under)\s+[a-g]/.test(t)) {
    const p = pitchOf(pc[1].replace(/\s+/g, ''))
    if (p != null) { f.pitchClass = p % 12; any = true }
  }
  const above = /\b(?:above|over|higher than)\s+([a-g](?:\s?(?:sharp|flat|#|♯|♭))?\s?\d)/.exec(t)
  if (above) { const p = pitchOf(above[1].replace(/\s+/g, '')); if (p != null) { f.pitchMin = p + 1; any = true } }
  const below = /\b(?:below|under|lower than)\s+([a-g](?:\s?(?:sharp|flat|#|♯|♭))?\s?\d)/.exec(t)
  if (below) { const p = pitchOf(below[1].replace(/\s+/g, '')); if (p != null) { f.pitchMax = p - 1; any = true } }
  if (/\bquiet(?:er|est)?\b|\bsoft(?:er|est)?\b|\bghost\b/.test(t)) { const m = /\b(?:quieter|softer) than (\d+)/.exec(t); f.velocityMax = m ? Number(m[1]) - 1 : 60; any = true }
  if (/\bloud(?:er|est)?\b|\baccent(?:ed|s)?\b|\bhard(?:er)?\b/.test(t)) { const m = /\b(?:louder|harder) than (\d+)/.exec(t); f.velocityMin = m ? Number(m[1]) + 1 : 100; any = true }
  if (/\bshort(?:er|est)?\b/.test(t)) { f.durationMax = 0.25; any = true }
  if (/\blong(?:er|est)?\b/.test(t) && !/\blonger than a bar\b/.test(t)) { f.durationMin = 1; any = true }
  const nth = /\bevery\s+(other|second|third|fourth|2nd|3rd|4th|\d+(?:th|st|nd|rd)?)\s+note/.exec(t)
  if (nth) {
    const w = nth[1]
    f.everyNth = w === 'other' || w === 'second' || w === '2nd' ? 2 : w === 'third' || w === '3rd' ? 3 : w === 'fourth' || w === '4th' ? 4 : parseInt(w, 10)
    any = true
  }
  if (/\b(?:off|outside|out of|not in)\s+(?:the\s+)?(?:scale|key)\b|\bwrong notes?\b/.test(t)) { f.scale = 'out'; any = true }
  else if (/\bin\s+(?:the\s+)?(?:scale|key)\b/.test(t)) { f.scale = 'in'; any = true }
  if (/\bdeactivated\b|\binactive\b|\bmuted notes?\b|\bturned off\b/.test(t)) { f.condition = 'inactive'; any = true }
  else if (/\bwith (?:a )?chance\b|\bprobab/.test(t)) { f.condition = 'chance'; any = true }
  else if (/\bwith (?:velocity )?deviation\b/.test(t)) { f.condition = 'deviation'; any = true }
  if (/\b(?:everything|all|every note) (?:but|except)\b|\bnot the\b/.test(t) && any) f.invert = true
  return any ? f : null
}
