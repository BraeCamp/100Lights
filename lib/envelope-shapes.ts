/**
 * Insert Shape and Simplify Envelope: putting a known shape into an automation
 * lane, and taking one back out again.
 *
 * These are opposite halves of the same problem. Drawing a clean four-bar sine
 * by hand is impossible and drawing a rough one is pointless, so a shape you
 * can ask for is worth having. And a recorded gesture arrives as sixty points
 * that read as a line — worth having in the take and unbearable to edit — so a
 * way back down to the half-dozen that carry the shape is worth having too.
 *
 * ⚠️ Built on `lfoValue` (lib/daw-modulation.ts), not on its own maths. A sine
 * you insert into a lane and a sine an LFO produces have to be the same sine,
 * or the studio has two answers to what a triangle is and the difference shows
 * up as a sound nobody can account for.
 *
 * Pure, in beats, and values are 0–1 lane POSITIONS — the units live on the
 * lane (see lib/automation-record.ts normalizeForLane).
 */

import type { AutomationPoint } from './daw-types'
import { lfoValue } from './daw-modulation'

export type ShapeId = 'sine' | 'triangle' | 'saw' | 'sawInverse' | 'square' | 'rampUp' | 'rampDown' | 'adsr'

export const ENVELOPE_SHAPES: ReadonlyArray<{ id: ShapeId; label: string; hint: string }> = [
  { id: 'sine',       label: 'Sine',            hint: 'A smooth rise and fall. The one that sounds like breathing.' },
  { id: 'triangle',   label: 'Triangle',        hint: 'Straight up, straight down — even movement in both directions.' },
  { id: 'saw',        label: 'Saw',             hint: 'Rises, then drops. A build that resets.' },
  { id: 'sawInverse', label: 'Inverse saw',     hint: 'Drops, then jumps back. A duck on every cycle.' },
  { id: 'square',     label: 'Square',          hint: 'Two values and nothing between them. Gating, on and off.' },
  { id: 'rampUp',     label: 'Ramp up',         hint: 'One straight line across the whole span, low to high.' },
  { id: 'rampDown',   label: 'Ramp down',       hint: 'One straight line across the whole span, high to low.' },
  { id: 'adsr',       label: 'ADSR',            hint: 'Attack, decay, sustain, release across the span — one envelope, not a cycle.' },
]

export const shapeLabel = (s: ShapeId) => ENVELOPE_SHAPES.find(x => x.id === s)?.label ?? 'Shape'

export interface ShapeOptions {
  /** How many times the shape repeats across the span. Ignored by ramps and ADSR. */
  cycles?: number
  /** The bottom and top of the movement, as lane positions. */
  low?: number
  high?: number
}

/**
 * How many points per cycle a curved shape gets.
 *
 * Sixteen is a deliberate middle. Fewer and a sine reads as a polygon; more and
 * the lane becomes a thing you cannot grab a point in, which defeats the reason
 * to put the shape in a lane rather than on an LFO.
 */
export const POINTS_PER_CYCLE = 16

/** A hair, in beats: the gap that makes a square's edge vertical rather than a ramp. */
const STEP = 1 / 256

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
const round = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * The points for one shape across [from, to], replacing whatever was there.
 *
 * Everything outside the span survives untouched: Insert Shape is an edit to a
 * stretch of the song, and a version that cleared the lane would make it
 * unusable for the commonest case, which is shaping one section.
 */
export function insertShape(
  points: ReadonlyArray<AutomationPoint>,
  from: number,
  to: number,
  shape: ShapeId,
  makeId: () => string,
  opts: ShapeOptions = {},
): AutomationPoint[] {
  if (!(to > from)) return [...points]
  const low = clamp01(opts.low ?? 0)
  const high = clamp01(opts.high ?? 1)
  const span = to - from
  const cycles = Math.max(1, Math.round(opts.cycles ?? 1))
  const at = (t: number, v: number): AutomationPoint => ({ id: makeId(), beat: round(from + t * span), value: round(clamp01(v)) })
  const lerp = (v: number) => low + (high - low) * v

  const made: AutomationPoint[] = []
  if (shape === 'rampUp' || shape === 'rampDown') {
    made.push(at(0, shape === 'rampUp' ? low : high), at(1, shape === 'rampUp' ? high : low))
  } else if (shape === 'adsr') {
    // One envelope across the whole span, in the proportions a synth uses:
    // a fast attack, a decay to a held level, and a release at the end.
    const sustain = lerp(0.6)
    made.push(at(0, low), at(0.08, high), at(0.28, sustain), at(0.75, sustain), at(1, low))
  } else if (shape === 'square') {
    // ⚠️ TWO POINTS AT EVERY EDGE, a hair apart. One point makes a ramp, and a
    // square that ramps is a triangle with extra steps.
    const cycleBeats = span / cycles
    const gap = Math.min(STEP, cycleBeats / 8) / span
    for (let c = 0; c < cycles; c++) {
      const s = c / cycles
      const mid = s + 0.5 / cycles
      made.push(at(s, high), at(mid - gap, high), at(mid, low), at(s + 1 / cycles - gap, low))
    }
    made.push(at(1, high))
  } else {
    // Sine, triangle and the two saws come from the same table the LFOs use.
    const lfo = shape === 'sawInverse' ? 'saw' : shape
    const n = POINTS_PER_CYCLE * cycles
    for (let i = 0; i <= n; i++) {
      const t = i / n
      const raw = lfoValue(lfo as 'sine' | 'triangle' | 'saw', t * cycles)
      const unit = shape === 'sawInverse' ? 1 - (raw + 1) / 2 : (raw + 1) / 2
      made.push(at(t, lerp(unit)))
    }
  }

  const outside = points.filter(p => p.beat < from - 1e-6 || p.beat > to + 1e-6)
  return [...outside, ...made].sort((a, b) => a.beat - b.beat)
}

/**
 * Simplify: the fewest points that still draw the same line.
 *
 * Douglas–Peucker on (beat, value), with the tolerance in lane positions — so a
 * tolerance of 0.02 means "no point may move by more than two percent of the
 * lane's height". The ends are always kept: a simplify that moved where a shape
 * starts or stops would change the sound rather than tidy the picture.
 *
 * ⚠️ Beats and values are different units, and the distance below treats them
 * as if they were not. That is on purpose: what a person is judging is the
 * SHAPE as drawn, which is exactly the picture where the two axes are equal.
 * Scaling beats into "real" units would make the tolerance mean something
 * different in a four-bar lane than in a sixty-four-bar one.
 */
export function simplify(points: ReadonlyArray<AutomationPoint>, tolerance = 0.02): AutomationPoint[] {
  if (points.length <= 2 || !(tolerance > 0)) return [...points]
  const pts = [...points].sort((a, b) => a.beat - b.beat)
  // Beats are normalised into the same 0–1 range as values, so the tolerance
  // reads the same in a lane of any length.
  const t0 = pts[0].beat
  const width = pts[pts.length - 1].beat - t0 || 1
  const x = pts.map(p => (p.beat - t0) / width)
  const y = pts.map(p => p.value)

  const keep = new Array<boolean>(pts.length).fill(false)
  keep[0] = keep[pts.length - 1] = true

  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const dx = x[b] - x[a], dy = y[b] - y[a]
    const len = Math.hypot(dx, dy) || 1
    let far = -1
    let best = tolerance
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * (x[i] - x[a]) - dx * (y[i] - y[a])) / len
      if (d > best) { best = d; far = i }
    }
    if (far > 0) {
      keep[far] = true
      stack.push([a, far], [far, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** What a simplify would cost, for the label. */
export function describeSimplify(before: number, after: number): string {
  if (after >= before) return 'Nothing to simplify — every point is carrying the shape.'
  return `${before} points down to ${after}, same shape.`
}
