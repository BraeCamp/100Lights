'use client'
// ── A shape you can name, and put anywhere ───────────────────────────────────
//
// Brae: "at one point I want bass to have descending reverb, ascending low pass,
// and descending volume to keep steady volume over the clip, and later I ask to
// do the same thing over a longer clip so the descend and ascend are longer."
//
// ⚠️ A MACRO IS (fx, graph) AND NOTHING ELSE. That is not a simplification, it
// is the shape this studio already speaks: an effect bar is
// `{ startBeat, durationBeats, fx, graph }` and clip motion is `{ fx, graph }`.
// Take the span out of both and what is left is identical — a set of "full-on"
// targets and one curve from neutral to them. So a macro is the part they have
// in common, and WHERE it goes is an argument.
//
// That answers the question the design turned on: the same macro covers a clip
// and a range of bars without being changed, because it never mentioned either.
//
// ⚠️ ONE CURVE, AND THE TARGETS SUPPLY THE DIRECTIONS. Brae's example wants
// reverb going down while the low-pass opens up — which sounds like two curves
// and is not, because every parameter travels from its own NEUTRAL to its own
// target. On a falling curve:
//
//     reverbWet   neutral 0       target 1      wet  → dry     (descending)
//     filterHz    neutral 18kHz   target 400    dark → open    (ascending)
//     gain        neutral 1.0     target 1.4    loud → nominal (descending)
//
// Three parameters, opposite directions, one graph.

import type { AutoPoint, RollFx } from '@/lib/daw-types'

export type MacroShape = 'fall' | 'rise' | 'arc' | 'dip' | 'hold'

export interface Macro {
  /** Lowercased, for looking up. */
  name: string
  /** As it was named, for saying and showing. */
  label: string
  /** What it does, in words — shown in the list and given to the assistant. */
  what: string
  fx: RollFx
  shape: MacroShape
  at: number
  used: number
  from: 'you' | 'shared'
}

/**
 * ⚠️ THE GRAPH IS STORED AS A SHAPE, NOT AS POINTS, and the reason is cost as
 * much as reliability: asking a model for bezier handles is asking it to invent
 * numbers it cannot hear, in output tokens that are five times the price of
 * input. A word it can choose correctly, expanded here into points nobody can
 * get wrong, is cheaper AND better.
 */
const P = (t: number, v: number): AutoPoint => ({
  id: `p${Math.round(t * 1000)}_${Math.round(v * 1000)}`,
  t, v,
  // Straight segments on purpose. Handles carry an offset in the same units as
  // `t`, and `t` means two different things depending on where this graph ends
  // up (see toPoints) — so a curved shape would need its handles rescaled too,
  // and a handle that was missed would bend the line somewhere nobody drew.
  smooth: false, h1: [0, 0], h2: [0, 0],
})

/** The shape, as points in NORMALISED time — t is 0..1 across the span. */
export function shapePoints(shape: MacroShape): AutoPoint[] {
  switch (shape) {
    case 'rise': return [P(0, 0), P(1, 1)]
    case 'fall': return [P(0, 1), P(1, 0)]
    case 'arc':  return [P(0, 0), P(0.5, 1), P(1, 0)]
    case 'dip':  return [P(0, 1), P(0.5, 0), P(1, 1)]
    case 'hold': return [P(0, 1), P(1, 1)]
  }
}

/**
 * The graph in the units the destination expects.
 *
 * ⚠️ THE SAME FIELD MEANS TWO DIFFERENT THINGS. AutoPoint.t is documented as
 * "beats from effect start (0..durationBeats)" — but ClipFxMotion re-reads it as
 * "NORMALIZED 0..1 (fraction of the clip) so it stretches on resize". Both are
 * true, of different homes.
 *
 * So a macro keeps its graph normalised, and this converts. Getting it wrong is
 * silent and ugly: a 0..1 graph dropped into a 16-beat bar squeezes the whole
 * shape into the first beat and leaves fifteen beats flat.
 */
export function toPoints(shape: MacroShape, durationBeats?: number): AutoPoint[] {
  const pts = shapePoints(shape)
  if (durationBeats == null) return pts                    // clip motion: stays 0..1
  return pts.map(p => ({ ...p, t: p.t * durationBeats }))  // an effect bar: beats
}

// ── the store ───────────────────────────────────────────────────────────────

const KEY = 'light.macros.v1'
let mem: Macro[] | null = null
const subs = new Set<() => void>()

export function onMacros(f: () => void): () => void {
  subs.add(f)
  return () => { subs.delete(f) }
}

function load(): Macro[] {
  if (mem) return mem
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    mem = Array.isArray(parsed) ? parsed.filter(m => m && typeof m.name === 'string' && m.fx) : []
  } catch { mem = [] }
  return mem
}

function save(): void {
  try { localStorage.setItem(KEY, JSON.stringify(mem ?? [])) } catch { /* nothing to keep it in */ }
  for (const f of subs) f()
}

export const macroKey = (s: string) => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

export function listMacros(): Macro[] {
  return load().slice().sort((a, b) => b.used - a.used || b.at - a.at)
}

/**
 * Find one by name, forgivingly.
 *
 * ⚠️ Spoken names arrive bent — "the steady swell", "steady swells". An exact
 * match on a name a person has to remember is a name they will not be able to
 * use, and the whole point of naming these is that a NAME is cheap to say where
 * "the same thing again" costs a paid turn every time.
 */
export function findMacro(spoken: string): Macro | null {
  const want = macroKey(spoken)
  if (!want) return null
  const all = load()
  return all.find(m => m.name === want)
    ?? all.find(m => want.includes(m.name) || m.name.includes(want))
    ?? null
}

/** A name nobody chose, for when one was not given. */
function autoName(fx: RollFx, shape: MacroShape): string {
  const keys = Object.keys(fx)
  const head = keys.length === 1 ? keys[0].replace(/([A-Z])/g, ' $1').toLowerCase() : 'shape'
  const n = load().length + 1
  return `${shape} ${head} ${n}`.replace(/\s+/g, ' ').trim()
}

export function defineMacro(m: {
  name?: string; what?: string; fx: RollFx; shape: MacroShape; from?: 'you' | 'shared'
}): Macro {
  const label = (m.name ?? '').trim() || autoName(m.fx, m.shape)
  const macro: Macro = {
    name: macroKey(label), label,
    what: (m.what ?? '').trim() || describeMacro(m.fx, m.shape),
    fx: m.fx, shape: m.shape,
    at: Date.now(), used: 0, from: m.from ?? 'you',
  }
  const list = load()
  const at = list.findIndex(x => x.name === macro.name)
  if (at >= 0) list.splice(at, 1, { ...macro, used: list[at].used })
  else list.push(macro)
  save()
  return macro
}

export function useMacro(name: string): void {
  const m = findMacro(name)
  if (!m) return
  m.used++
  save()
}

export function renameMacro(from: string, to: string): boolean {
  const m = findMacro(from)
  const label = to.trim()
  if (!m || !label) return false
  m.label = label
  m.name = macroKey(label)
  save()
  return true
}

export function forgetMacro(name: string): void {
  const m = findMacro(name)
  if (!m) return
  mem = load().filter(x => x !== m)
  save()
}

/** Their names, for the assistant — so it can build on one instead of from nothing. */
export function macroNames(): string[] {
  return load().map(m => m.label)
}

// ── saying what one does ────────────────────────────────────────────────────
//
// Used for the list, for the read-back, and for what the assistant is told. One
// description rather than three, because three would drift apart and the one
// people read would stop being the one the model was given.

const MOVES: Record<string, [string, string]> = {
  // key: [what it does going UP toward the target, what it does coming back]
  reverbWet:  ['more reverb', 'less reverb'],
  filterHz:   ['darker', 'brighter'],
  highpassHz: ['thinner', 'fuller'],
  gain:       ['louder', 'quieter'],
  drive:      ['more drive', 'cleaner'],
  distortion: ['more distortion', 'cleaner'],
  bitcrush:   ['more crush', 'cleaner'],
  filterQ:    ['more resonant', 'less resonant'],
  detune:     ['further out of tune', 'back in tune'],
  vibratoDepth: ['more vibrato', 'less vibrato'],
}

const SHAPE_WORDS: Record<MacroShape, string> = {
  fall: 'fading out across it',
  rise: 'building across it',
  arc:  'swelling and falling back',
  dip:  'dropping away and returning',
  hold: 'held all the way across',
}

export function describeMacro(fx: RollFx, shape: MacroShape): string {
  const parts = Object.keys(fx).map(k => {
    const pair = MOVES[k]
    if (!pair) return k
    // A falling curve ENDS at neutral, so what you hear is the second word.
    return shape === 'rise' ? pair[0] : pair[1]
  })
  const list = parts.length > 1
    ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
    : (parts[0] ?? 'nothing')
  return `${list}, ${SHAPE_WORDS[shape]}`
}
