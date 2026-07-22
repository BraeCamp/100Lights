// Pure sound-shaping logic for the piano roll — no Web Audio here, so it can be
// unit-tested and shared by the engine and every editor UI.
//
// A RollFx bag is resolved per note by cascading three scopes:
//   preset.sound.fx  →  clip.rollFx  →  note.fx   (each overrides the last)
// then any of the preset's pitch graphs modulate a target by the note's pitch.
// The engine builds the actual audio chain from the resolved bag.

import type { RollFx, PresetSound, PitchGraph, PitchGraphPoint, PitchGraphTarget } from './daw-types'

// ── Field metadata ──────────────────────────────────────────────────────────
// One definition per parameter drives the sliders in the clip Sound panel, the
// preset editor, and the per-note editor — and, via `fromNorm`, the value a
// pitch graph produces (a graph's Y axis IS the normalized slider position).
export interface FxField {
  key: keyof RollFx
  label: string
  group: 'level' | 'filter' | 'drive' | 'space' | 'mod' | 'eq' | 'time'
  /** Neutral value — a field at neutral is treated as "not set" and omitted. */
  neutral: number
  /** Can a pitch graph drive this? (time-base params can't.) */
  graph: boolean
  toNorm: (v: number) => number
  fromNorm: (n: number) => number
  fmt: (v: number) => string
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
const lin = (min: number, max: number) => ({
  toNorm: (v: number) => clamp01((v - min) / (max - min)),
  fromNorm: (n: number) => min + clamp01(n) * (max - min),
})
// Logarithmic Hz map; `off` is the value returned at the "off" end of the slider.
const logHz = (min: number, mult: number) => ({
  toNorm: (v: number) => clamp01(Math.log(v / min) / Math.log(mult)),
  fromNorm: (n: number) => Math.round(min * Math.pow(mult, clamp01(n))),
})
const pct = (v: number) => (v > 0.005 ? `${Math.round(v * 100)}%` : 'Off')
const db = (v: number) => (Math.abs(v) < 0.05 ? '0 dB' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`)

const LP = logHz(200, 90)     // 200 Hz → 18 kHz (top = off)
const HP = logHz(20, 100)     // 20 Hz (off) → 2 kHz

export const FX_FIELDS: FxField[] = [
  { key: 'gain',        label: 'Gain',       group: 'level',  neutral: 1,     graph: true,  ...lin(0, 2),     fmt: v => `${Math.round(v * 100)}%` },
  { key: 'pan',         label: 'Pan',        group: 'level',  neutral: 0,     graph: true,  ...lin(-1, 1),    fmt: v => Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}` },
  { key: 'highpassHz',  label: 'High-pass',  group: 'filter', neutral: 20,    graph: true,  ...HP,            fmt: v => v <= 22 ? 'Off' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz` },
  { key: 'filterHz',    label: 'Low-pass',   group: 'filter', neutral: 18000, graph: true,  ...LP,            fmt: v => v >= 17500 ? 'Off' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz` },
  { key: 'filterQ',     label: 'Resonance',  group: 'filter', neutral: 0.8,   graph: true,  ...lin(0.1, 12),  fmt: v => v.toFixed(1) },
  { key: 'drive',       label: 'Drive',      group: 'drive',  neutral: 0,     graph: true,  ...lin(0, 1),     fmt: pct },
  { key: 'distortion',  label: 'Distortion', group: 'drive',  neutral: 0,     graph: true,  ...lin(0, 1),     fmt: pct },
  { key: 'reverbWet',   label: 'Reverb',     group: 'space',  neutral: 0,     graph: true,  ...lin(0, 1),     fmt: pct },
  { key: 'delayWet',    label: 'Delay',      group: 'space',  neutral: 0,     graph: true,  ...lin(0, 1),     fmt: pct },
  { key: 'delayTime',   label: 'Delay time', group: 'time',   neutral: 0.25,  graph: false, ...lin(0.02, 1),  fmt: v => `${Math.round(v * 1000)}ms` },
  { key: 'delayFeedback', label: 'Feedback', group: 'time',   neutral: 0.3,   graph: false, ...lin(0, 0.9),   fmt: v => `${Math.round(v * 100)}%` },
  { key: 'chorusDepth', label: 'Chorus',     group: 'space',  neutral: 0,     graph: true,  ...lin(0, 1),     fmt: pct },
  { key: 'tremoloDepth', label: 'Tremolo',   group: 'mod',    neutral: 0,     graph: true,  ...lin(0, 1),     fmt: pct },
  { key: 'tremoloRate', label: 'Trem rate',  group: 'mod',    neutral: 5,     graph: false, ...lin(0.1, 12),  fmt: v => `${v.toFixed(1)}Hz` },
  { key: 'sub',         label: 'Sub',        group: 'eq',     neutral: 0,     graph: true,  ...lin(-12, 12),  fmt: db },
  { key: 'bass',        label: 'Bass',       group: 'eq',     neutral: 0,     graph: true,  ...lin(-12, 12),  fmt: db },
  { key: 'mid',         label: 'Mid',        group: 'eq',     neutral: 0,     graph: true,  ...lin(-12, 12),  fmt: db },
  { key: 'treble',      label: 'Treble',     group: 'eq',     neutral: 0,     graph: true,  ...lin(-12, 12),  fmt: db },
]

export const FX_FIELD_BY_KEY: Record<string, FxField> = Object.fromEntries(FX_FIELDS.map(f => [f.key, f]))
export const GRAPH_TARGETS: PitchGraphTarget[] = FX_FIELDS.filter(f => f.graph).map(f => f.key as PitchGraphTarget)

/** Is a value meaningfully different from the field's neutral? */
export function fieldIsSet(key: keyof RollFx, v: number | undefined): boolean {
  if (v === undefined) return false
  const f = FX_FIELD_BY_KEY[key]
  if (!f) return v !== 0
  if (key === 'filterHz') return v < 17500
  if (key === 'highpassHz') return v > 22
  return Math.abs(v - f.neutral) > (f.group === 'eq' ? 0.05 : 1e-4)
}

/** Any non-neutral, audible field set? (sustain handled separately by caller.) */
export function fxHasAudibleField(fx: RollFx | undefined): boolean {
  if (!fx) return false
  return FX_FIELDS.some(f => f.group !== 'time' && fieldIsSet(f.key, fx[f.key]))
}

// ── Pitch graph evaluation ────────────────────────────────────────────────
/** Linear-interpolate the amount (0–1) at `pitch` over sorted control points. */
export function evalPitchGraph(points: PitchGraphPoint[], pitch: number): number {
  if (!points.length) return 0
  const pts = points.length > 1 && points[0].pitch <= points[points.length - 1].pitch
    ? points
    : [...points].sort((a, b) => a.pitch - b.pitch)
  if (pitch <= pts[0].pitch) return clamp01(pts[0].amount)
  const last = pts[pts.length - 1]
  if (pitch >= last.pitch) return clamp01(last.amount)
  for (let i = 1; i < pts.length; i++) {
    if (pitch <= pts[i].pitch) {
      const a = pts[i - 1], b = pts[i]
      const t = (pitch - a.pitch) / (b.pitch - a.pitch || 1)
      return clamp01(a.amount + (b.amount - a.amount) * t)
    }
  }
  return clamp01(last.amount)
}

/** The concrete parameter value a pitch graph amount (0–1) produces. */
export function pitchGraphValue(target: PitchGraphTarget, amount: number): number {
  return FX_FIELD_BY_KEY[target].fromNorm(amount)
}

// ── Cascade resolution ─────────────────────────────────────────────────────
/** Per-key override: `over` wins wherever it defines a value. */
export function mergeFx(base: RollFx | undefined, over: RollFx | undefined): RollFx {
  if (!base) return { ...(over ?? {}) }
  if (!over) return { ...base }
  const out: RollFx = { ...base }
  for (const k of Object.keys(over) as (keyof RollFx)[]) {
    const v = over[k]
    if (v !== undefined) out[k] = v
  }
  return out
}

/**
 * The effective sound for one note: preset base → clip override → note override,
 * then every enabled pitch graph on the preset sets its target from the note's
 * pitch. Returns a fresh bag the engine turns into an audio chain.
 */
export function resolveNoteFx(
  presetSound: PresetSound | undefined,
  clipFx: RollFx | undefined,
  note: { pitch: number; fx?: RollFx },
): RollFx {
  let fx = mergeFx(presetSound?.fx, clipFx)
  fx = mergeFx(fx, note.fx)
  const graphs = presetSound?.pitchGraphs
  if (graphs?.length) {
    for (const g of graphs) {
      if (!g.enabled || g.points.length < 1) continue
      fx[g.target] = pitchGraphValue(g.target, evalPitchGraph(g.points, note.pitch))
    }
  }
  return fx
}

/** A straight-line default graph (flat at 0.5) for a newly added target. */
export function defaultPitchGraph(target: PitchGraphTarget, id: string): PitchGraph {
  return { id, target, enabled: true, points: [{ pitch: 36, amount: 0.5 }, { pitch: 96, amount: 0.5 }] }
}
