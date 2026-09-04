// Naming one clip, or many, out loud.
//
// Brae: "give the voice control control over the multiselect function, and
// make each item have an individual item code or duplicate number so that one
// can be selected or many with the same name can be selected by name or by
// place on the track."
//
// ⚠️ THE RECORD, 23:43: "Delete all pad intro part" → one clip deleted, five
// times over, one command each. Every planner resolved a name to ONE clip, so
// "all of them" had no way to be said. This module resolves a spoken address to
// however many clips it names: a name, a name with a number ("pad intro part
// 3", "#3", "the third pad intro part"), a place ("the pad clip at bar 9"), a
// filter ("the ones shorter than a bar"), or all of them.
//
// The number is the clip's ORDINAL among same-named clips on its track, by
// start time — what the arrangement shows as a small "#3" beside the name
// whenever a name is shared. It is stable while nothing is added before it,
// which is the same guarantee a musician has counting bars.

import type { DawProject, DawClip } from './daw-types'
import { foldName } from './voice/resolve'

export interface ClipOrdinal { n: number; of: number }

/** Every clip's position among the clips that share its name on its track. */
export function clipOrdinals(project: Pick<DawProject, 'arrangementClips'>): Map<string, ClipOrdinal> {
  const groups = new Map<string, DawClip[]>()
  for (const c of project.arrangementClips ?? []) {
    const key = `${c.trackId}|${foldName(c.name ?? '')}`
    const g = groups.get(key) ?? []
    g.push(c)
    groups.set(key, g)
  }
  const out = new Map<string, ClipOrdinal>()
  for (const g of groups.values()) {
    const sorted = [...g].sort((a, b) => a.startBeat - b.startBeat)
    sorted.forEach((c, i) => out.set(c.id, { n: i + 1, of: sorted.length }))
  }
  return out
}

/** "Pad · intro · part #3" when the name is shared on its track; the name alone otherwise. */
export function clipLabel(project: Pick<DawProject, 'arrangementClips'>, clip: DawClip): string {
  const o = clipOrdinals(project).get(clip.id)
  return o && o.of > 1 ? `${clip.name} #${o.n}` : String(clip.name ?? clip.id)
}

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
  eleventh: 11, twelfth: 12,
}

export interface ClipAddress {
  /** The clip name as spoken (may still carry a number — see parseClipAddress). */
  name?: string
  /** A track name, to narrow to that track. */
  track?: string
  /** Which of the matches: an ordinal (1-based, by start time), first/last, or all of them. */
  which?: number | number[] | 'first' | 'last' | 'all'
  /** A beat the clip must be sounding at (a bar spoken as a place). */
  at?: number
  /** Only clips shorter / longer than this many beats. */
  shorterThan?: number
  longerThan?: number
  /** Only clips starting at or after / before this beat. */
  after?: number
  before?: number
  /** Only clips inside this named section — from its marker to the next. */
  section?: string
  /** Exactly these clips — the selection, or an answer to a question. */
  ids?: string[]
}

/** Where a named section runs: its marker to the next marker (or the end). */
export function sectionSpan(project: Pick<DawProject, 'cueMarkers'>, name: string): { start: number; end: number; name: string } | null {
  const markers = [...(project.cueMarkers ?? [])].sort((a, b) => a.beat - b.beat)
  const want = foldName(name.replace(/^(?:the|in|during|inside|within)\s+/i, ''))
  if (!want) return null
  const i = markers.findIndex(m => foldName(m.name ?? '') === want)
  const j = i >= 0 ? i : markers.findIndex(m => foldName(m.name ?? '').includes(want))
  if (j < 0) return null
  return { start: markers[j].beat, end: markers[j + 1]?.beat ?? Infinity, name: markers[j].name ?? name }
}

/**
 * Pull the number out of a spoken clip name.
 *
 *   "pad intro part 3"      → { name: "pad intro part", which: 3 }
 *   "pad intro part #3"     → { name: "pad intro part", which: 3 }
 *   "the third pad intro"   → { name: "pad intro", which: 3 }
 *   "all the pad intro parts" → { name: "pad intro part", which: "all" }
 *   "the last pad clip"     → { name: "pad clip", which: "last" }
 *
 * ⚠️ A trailing number is only an ordinal when the name WITHOUT it exists —
 * "Bass 2" is a track called Bass 2, not the second Bass. The caller checks
 * that; this just reads the words.
 */
export function parseClipAddress(spoken: string): { name: string; which?: number | 'first' | 'last' | 'all' } {
  let s = String(spoken ?? '').trim().toLowerCase().replace(/[.,!?]+$/, '')
  let which: number | 'first' | 'last' | 'all' | undefined
  const all = /^(?:all|every|each)\s+(?:of\s+)?(?:the\s+)?(.+?)(?:\s+(?:clips?|items?|parts?|copies|ones))?$/.exec(s)
  if (all) { which = 'all'; s = all[1] }
  const trailingHash = /^(.+?)\s*(?:#|number|no\.?)\s*(\d{1,3})$/.exec(s)
  if (trailingHash) { which = Number(trailingHash[2]); s = trailingHash[1].trim() }
  const lead = /^(?:the\s+)?(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|last|\d{1,3}(?:st|nd|rd|th))\s+(.+)$/.exec(s)
  if (lead && which === undefined) {
    const w = lead[1]
    which = w === 'last' ? 'last' : ORDINALS[w] ?? Number(w.replace(/\D/g, ''))
    s = lead[2]
  }
  // "…parts" / "…clips" / "…items" — a plural is the same name.
  s = s.replace(/\s+(?:clips?|items?)$/i, '').replace(/^(?:the\s+)/, '').trim()
  return { name: s, ...(which !== undefined ? { which } : {}) }
}

function matchesName(want: string, name: string): boolean {
  const n = foldName(name)
  if (!want) return true
  if (n === want) return true
  if (n.startsWith(want)) return true
  if (n.includes(want)) return true
  const words = want.split(' ').filter(Boolean)
  return words.length > 0 && words.every(w => n.includes(w))
}

/**
 * The clips a spoken address names. Empty when nothing matches.
 *
 * The name is matched in tiers (exact, then starts-with, then contains, then
 * every word) and the best tier that matches anything wins — so "pad intro"
 * does not also drag in "pad intro part" when an exact "pad intro" exists.
 */
export function addressClips(project: DawProject, addr: ClipAddress): DawClip[] {
  let pool = [...(project.arrangementClips ?? [])]
  if (addr.ids) { const ids = new Set(addr.ids); pool = pool.filter(c => ids.has(c.id)) }
  if (addr.section) {
    const span = sectionSpan(project, addr.section)
    if (!span) return []
    pool = pool.filter(c => c.startBeat >= span.start - 1e-6 && c.startBeat < span.end - 1e-6)
  }
  if (addr.track) {
    const tw = foldName(addr.track)
    const track = (project.tracks ?? []).find(t => foldName(t.name ?? '') === tw)
      ?? (project.tracks ?? []).find(t => foldName(t.name ?? '').startsWith(tw))
      ?? (project.tracks ?? []).find(t => foldName(t.name ?? '').includes(tw))
    if (!track) return []
    pool = pool.filter(c => c.trackId === track.id)
  }
  let matched = pool
  const want = foldName(addr.name ?? '')
  if (want) {
    const tiers: ((n: string) => boolean)[] = [
      n => foldName(n) === want,
      n => foldName(n).startsWith(want),
      n => foldName(n).includes(want),
      n => { const ws = want.split(' ').filter(Boolean); return ws.length > 0 && ws.every(w => foldName(n).includes(w)) },
    ]
    matched = []
    for (const tier of tiers) {
      matched = pool.filter(c => tier(c.name ?? ''))
      if (matched.length) break
    }
    // A track named like that, with no clip named like that: its clips.
    if (!matched.length && !addr.track) {
      const track = (project.tracks ?? []).find(t => matchesName(want, t.name ?? ''))
      if (track) matched = pool.filter(c => c.trackId === track.id)
    }
  }
  if (addr.at != null) matched = matched.filter(c => c.startBeat <= addr.at! + 1e-6 && c.startBeat + c.durationBeats > addr.at! + 1e-6)
  if (addr.after != null) matched = matched.filter(c => c.startBeat >= addr.after! - 1e-6)
  if (addr.before != null) matched = matched.filter(c => c.startBeat < addr.before! - 1e-6)
  if (addr.shorterThan != null) matched = matched.filter(c => c.durationBeats < addr.shorterThan! - 1e-6)
  if (addr.longerThan != null) matched = matched.filter(c => c.durationBeats > addr.longerThan! + 1e-6)
  matched.sort((a, b) => a.startBeat - b.startBeat || a.trackId.localeCompare(b.trackId))
  const w = addr.which
  if (w === 'first') return matched.slice(0, 1)
  if (w === 'last') return matched.slice(-1)
  if (typeof w === 'number') return matched[w - 1] ? [matched[w - 1]] : []
  if (Array.isArray(w)) return w.map(n => matched[n - 1]).filter(Boolean)
  return matched
}

// ── Colours, by name ────────────────────────────────────────────────────────
export const COLOURS: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', amber: '#f59e0b', yellow: '#eab308', lime: '#84cc16',
  green: '#22c55e', teal: '#14b8a6', cyan: '#06b6d4', blue: '#3b82f6', indigo: '#6366f1',
  purple: '#a855f7', violet: '#8b5cf6', pink: '#ec4899', magenta: '#d946ef', rose: '#f43f5e',
  brown: '#a16207', grey: '#9ca3af', gray: '#9ca3af', white: '#f5f5f5', black: '#1f2937',
}
export function colourOf(spoken: string): { name: string; hex: string } | null {
  const s = String(spoken ?? '').toLowerCase()
  for (const [name, hex] of Object.entries(COLOURS)) if (new RegExp(`\\b${name}\\b`).test(s)) return { name, hex }
  const hexM = /#[0-9a-f]{6}\b/i.exec(s)
  return hexM ? { name: hexM[0], hex: hexM[0] } : null
}
