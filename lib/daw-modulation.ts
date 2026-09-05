// The modulation bus, without the audio graph.
//
// A modulator is an LFO that lives on a track and drives parameters the
// same way automation does — through the one parameter namespace the engine
// already understands ('volume', 'pan', 'fx:{effectId}:{key}', 'apollo:…',
// 'plugin:…', 'macro:N'). Where an automation lane is a shape drawn along the
// song, a modulator is a shape that repeats: every scheduler tick the engine
// asks this module where each LFO is and what each routed parameter should
// be, and pushes that value the same way it pushes a lane's.
//
// Everything here is pure so it can be tested in Node and reused by the UI
// (a knob's ring wants to draw the modulated value, and it should not have to
// re-derive it from the graph).
//
// ⚠️ Rate limit: the scheduler ticks every 25 ms, so a modulator is heard as
// a stepped control ~40 times a second — smooth for a filter sweep or a
// tremolo up to a few hertz, audibly stepped above ~8 Hz. Audio-rate LFOs
// wait for AudioParam exposure on the effect handles (Batch 7).

import type { Modulator, ModRoute, ModShape } from './daw-types'

/**
 * How many cycles the LFO has run at a beat and a song-second — the integer
 * part is the cycle index (what 'random' keys on), the fraction is the phase.
 */
export function modCycles(mod: Modulator, beat: number, seconds: number): number {
  const p0 = mod.phase ?? 0
  if (mod.rate.kind === 'sync') {
    const cycleBeats = syncBeats(mod.rate.division)
    if (cycleBeats <= 0) return p0
    return beat / cycleBeats + p0
  }
  const hz = mod.rate.hz > 0 ? mod.rate.hz : 1
  return seconds * hz + p0
}

/** Where the LFO is, 0..1 of one cycle. */
export function modPhase(mod: Modulator, beat: number, seconds: number): number {
  const c = modCycles(mod, beat, seconds)
  return ((c % 1) + 1) % 1
}

/** Beats per cycle for a synced rate: '1/4' is one beat, '1' a bar of four. */
export function syncBeats(division: string): number {
  const m = /^(\d+)(?:\/(\d+))?$/.exec(division.trim())
  if (!m) return 1
  const num = Number(m[1]), den = m[2] ? Number(m[2]) : 1
  if (!den) return 1
  // In 4/4 a whole note is four beats; '1/8' is half a beat.
  return (num / den) * 4
}

/** The LFO's value, −1..1, at a phase 0..1. */
export function lfoValue(shape: ModShape, phase: number, seed = 0): number {
  const p = ((phase % 1) + 1) % 1
  switch (shape) {
    case 'sine': return Math.sin(p * Math.PI * 2)
    case 'triangle': return p < 0.25 ? p * 4 : p < 0.75 ? 2 - p * 4 : p * 4 - 4
    case 'saw': return p * 2 - 1
    case 'square': return p < 0.5 ? 1 : -1
    case 'random': {
      // Sample-and-hold: one value per cycle, the same value every time the
      // song passes this cycle (seeded by the cycle index) so a render is
      // deterministic — see project-100lights-render-determinism.
      const cycle = Math.floor(phase)
      let x = (cycle * 1103515245 + 12345 + seed * 7919) & 0x7fffffff
      x = (x * 1103515245 + 12345) & 0x7fffffff
      return (x / 0x7fffffff) * 2 - 1
    }
    default: return 0
  }
}

export interface ParamRange { min: number; max: number; curve?: 'log' }

/**
 * The parameter's value with the LFO applied. `amount` is how much of the
 * parameter's range the swing COVERS (−1..1): +0.5 on a 0..1 wet swings
 * ±0.25 around the base; unipolar (`route.unipolar`) swings 0..0.5 to one
 * side of it instead, which is how a tremolo (amount −1: fader down to
 * silence, never above) wants to go. Log ranges swing by ratio.
 */
export function applyRoute(base: number, lfo: number, route: ModRoute, range: ParamRange): number {
  const l = route.unipolar ? (lfo + 1) / 2 : lfo
  const depth = route.unipolar ? route.amount : route.amount / 2
  if (range.curve === 'log' && range.min > 0 && range.max > range.min && base > 0) {
    const span = Math.log(range.max / range.min)
    const pos = Math.log(Math.max(range.min, Math.min(range.max, base)) / range.min) / span
    const out = Math.min(1, Math.max(0, pos + l * depth))
    return range.min * Math.exp(out * span)
  }
  const span = range.max - range.min
  return Math.min(range.max, Math.max(range.min, base + l * depth * span))
}

export interface ModReadout {
  trackId: string
  parameter: string
  base: number
  value: number
  /** The LFO's own position, −1..1 — for a ring to draw. */
  lfo: number
}

/**
 * Every routed parameter's value right now. `baseOf` answers what the
 * parameter would be without modulation (the project's value, or the
 * automation lane's if one is driving it this tick); `rangeOf` gives its
 * range. A parameter nobody can range is skipped.
 */
export function evaluateModulators(
  mods: Modulator[],
  at: { beat: number; seconds: number },
  baseOf: (trackId: string, parameter: string) => number | null,
  rangeOf: (trackId: string, parameter: string) => ParamRange | null,
): ModReadout[] {
  const out: ModReadout[] = []
  for (const mod of mods) {
    if (mod.enabled === false) continue
    const lfo = lfoValue(mod.shape, modCycles(mod, at.beat, at.seconds), mod.seed ?? 0) * (mod.depth ?? 1)
    for (const route of mod.routes) {
      if (route.enabled === false) continue
      const base = baseOf(mod.trackId, route.parameter)
      const range = rangeOf(mod.trackId, route.parameter)
      if (base == null || !range) continue
      out.push({ trackId: mod.trackId, parameter: route.parameter, base, value: applyRoute(base, lfo, route, range), lfo })
    }
  }
  return out
}

/** A rate the way a person says it: "1/8", "an eighth", "2 Hz", "slow", "fast". */
export function parseModRate(said: string): Modulator['rate'] | null {
  const t = said.trim().toLowerCase()
  if (!t) return null
  const hz = /^(\d+(?:\.\d+)?)\s*(?:hz|hertz)$/.exec(t)
  if (hz) return { kind: 'hz', hz: Number(hz[1]) }
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t)
  if (frac) return { kind: 'sync', division: `${frac[1]}/${frac[2]}` }
  const words: Record<string, string> = {
    'whole': '1', 'bar': '1', 'a bar': '1', 'one bar': '1', 'two bars': '2', '2 bars': '2', 'four bars': '4', '4 bars': '4',
    'half': '1/2', 'a half': '1/2', 'half note': '1/2',
    'quarter': '1/4', 'a quarter': '1/4', 'quarter note': '1/4', 'beat': '1/4', 'a beat': '1/4', 'every beat': '1/4',
    'eighth': '1/8', 'an eighth': '1/8', 'eighths': '1/8', 'eighth note': '1/8', 'eighth notes': '1/8',
    'sixteenth': '1/16', 'a sixteenth': '1/16', 'sixteenths': '1/16', 'sixteenth notes': '1/16',
    'triplet': '1/12', 'eighth triplet': '1/12', 'eighth triplets': '1/12',
    'slow': '2', 'slowly': '2', 'medium': '1/2', 'fast': '1/8', 'quick': '1/8', 'quickly': '1/8', 'very fast': '1/16',
  }
  if (words[t]) return { kind: 'sync', division: words[t] }
  const num = /^(\d+(?:\.\d+)?)$/.exec(t)
  if (num) return { kind: 'hz', hz: Number(num[1]) }
  return null
}

/** A rate the way the studio says it back. */
export function describeModRate(rate: Modulator['rate']): string {
  if (rate.kind === 'hz') return `${rate.hz} Hz`
  const d = rate.division
  return d.includes('/') ? `${d} notes` : d === '1' ? 'once a bar' : `every ${d} bars`
}
