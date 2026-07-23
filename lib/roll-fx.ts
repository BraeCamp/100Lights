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
export type FxCat = 'env' | 'filter' | 'drive' | 'pitch' | 'space' | 'level' | 'eq'

export interface FxField {
  key: keyof RollFx
  label: string
  cat: FxCat
  /** Neutral value — a field at neutral is treated as "not set" and omitted. */
  neutral: number
  /** Can a pitch graph drive this? (rates/times & the release can't.) */
  graph: boolean
  /** Handled by the post-source FX chain (vs the note's source/amplitude). */
  chain: boolean
  /** One of the 5 essentials pinned above the category menus. */
  top?: boolean
  /** A secondary knob (rate/time/size) — shown but de-emphasised. */
  secondary?: boolean
  toNorm: (v: number) => number
  fromNorm: (n: number) => number
  fmt: (v: number) => string
}

export const FX_CATEGORIES: { key: FxCat; label: string }[] = [
  { key: 'env', label: 'Envelope' },
  { key: 'filter', label: 'Filter' },
  { key: 'drive', label: 'Drive & crush' },
  { key: 'pitch', label: 'Pitch' },
  { key: 'space', label: 'Space & delay' },
  { key: 'level', label: 'Level & stereo' },
  { key: 'eq', label: 'Tone EQ' },
]

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
const spct = (v: number) => (Math.abs(v) < 0.005 ? 'Off' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`)
const sec = (v: number) => (v > 0.005 ? `${v.toFixed(2)}s` : 'Off')
const ms = (v: number) => `${Math.round(v * 1000)}ms`
const hz = (v: number) => `${v.toFixed(1)}Hz`
const db = (v: number) => (Math.abs(v) < 0.05 ? '0 dB' : `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`)

const LP = logHz(200, 90)     // 200 Hz → 18 kHz (top = off)
const HP = logHz(20, 100)     // 20 Hz (off) → 2 kHz

export const FX_FIELDS: FxField[] = [
  // Envelope
  { key: 'attack',       label: 'Attack',     cat: 'env',    neutral: 0,     graph: false, chain: true,  top: true, ...lin(0, 2),    fmt: sec },
  { key: 'decay',        label: 'Decay',      cat: 'env',    neutral: 0,     graph: false, chain: true,  ...lin(0, 2),    fmt: sec },
  { key: 'sustainLevel', label: 'Sustain lvl',cat: 'env',    neutral: 1,     graph: false, chain: true,  ...lin(0, 1),    fmt: v => `${Math.round(v * 100)}%` },
  { key: 'sustain',      label: 'Release',    cat: 'env',    neutral: 0,     graph: false, chain: false, top: true, ...lin(0, 4),    fmt: sec },
  // Filter
  { key: 'highpassHz',   label: 'High-pass',  cat: 'filter', neutral: 20,    graph: true,  chain: true,  ...HP,           fmt: v => v <= 22 ? 'Off' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz` },
  { key: 'filterHz',     label: 'Low-pass',   cat: 'filter', neutral: 18000, graph: true,  chain: true,  top: true, ...LP, fmt: v => v >= 17500 ? 'Off' : v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}Hz` },
  { key: 'filterQ',      label: 'Resonance',  cat: 'filter', neutral: 0.8,   graph: true,  chain: true,  ...lin(0.1, 12), fmt: v => v.toFixed(1) },
  { key: 'filterEnv',    label: 'Filter env', cat: 'filter', neutral: 0,     graph: true,  chain: true,  ...lin(-1, 1),   fmt: spct },
  { key: 'filterLfoDepth', label: 'Auto-wah', cat: 'filter', neutral: 0,     graph: false, chain: true,  ...lin(0, 1),    fmt: pct },
  { key: 'filterLfoRate', label: 'Wah rate',  cat: 'filter', neutral: 5,     graph: false, chain: true, secondary: true, ...lin(0.1, 12), fmt: hz },
  // Drive & crush
  { key: 'drive',        label: 'Drive',      cat: 'drive',  neutral: 0,     graph: true,  chain: true,  top: true, ...lin(0, 1), fmt: pct },
  { key: 'distortion',   label: 'Distortion', cat: 'drive',  neutral: 0,     graph: true,  chain: true,  ...lin(0, 1),    fmt: pct },
  { key: 'bitcrush',     label: 'Bitcrush',   cat: 'drive',  neutral: 0,     graph: true,  chain: true,  ...lin(0, 1),    fmt: pct },
  // Pitch (source-side)
  { key: 'detune',       label: 'Fine tune',  cat: 'pitch',  neutral: 0,     graph: true,  chain: false, ...lin(-100, 100), fmt: v => Math.abs(v) < 1 ? '0¢' : `${v > 0 ? '+' : ''}${Math.round(v)}¢` },
  { key: 'vibratoDepth', label: 'Vibrato',    cat: 'pitch',  neutral: 0,     graph: true,  chain: false, ...lin(0, 1),    fmt: pct },
  { key: 'vibratoRate',  label: 'Vib rate',   cat: 'pitch',  neutral: 5,     graph: false, chain: false, secondary: true, ...lin(0.1, 12), fmt: hz },
  { key: 'pitchEnv',     label: 'Pitch env',  cat: 'pitch',  neutral: 0,     graph: false, chain: false, ...lin(-24, 24), fmt: v => Math.abs(v) < 0.1 ? 'Off' : `${v > 0 ? '+' : ''}${v.toFixed(0)}st` },
  { key: 'pitchEnvTime', label: 'Glide',      cat: 'pitch',  neutral: 0.08,  graph: false, chain: false, secondary: true, ...lin(0.01, 1), fmt: ms },
  // Space & delay
  { key: 'reverbWet',    label: 'Reverb',     cat: 'space',  neutral: 0,     graph: true,  chain: true,  top: true, ...lin(0, 1), fmt: pct },
  { key: 'reverbSize',   label: 'Rev size',   cat: 'space',  neutral: 0.4,   graph: false, chain: true, secondary: true, ...lin(0, 1), fmt: pct },
  { key: 'reverbPredelay', label: 'Pre-delay',cat: 'space',  neutral: 0,     graph: false, chain: true, secondary: true, ...lin(0, 0.2), fmt: ms },
  { key: 'delayWet',     label: 'Delay',      cat: 'space',  neutral: 0,     graph: true,  chain: true,  ...lin(0, 1),    fmt: pct },
  { key: 'delayTime',    label: 'Delay time', cat: 'space',  neutral: 0.25,  graph: false, chain: true, secondary: true, ...lin(0.02, 1), fmt: ms },
  { key: 'delayFeedback',label: 'Feedback',   cat: 'space',  neutral: 0.3,   graph: false, chain: true, secondary: true, ...lin(0, 0.9), fmt: v => `${Math.round(v * 100)}%` },
  { key: 'delayPingpong',label: 'Ping-pong',  cat: 'space',  neutral: 0,     graph: true,  chain: true,  ...lin(0, 1),    fmt: pct },
  { key: 'chorusDepth',  label: 'Chorus',     cat: 'space',  neutral: 0,     graph: true,  chain: true,  ...lin(0, 1),    fmt: pct },
  { key: 'flanger',      label: 'Flanger',    cat: 'space',  neutral: 0,     graph: true,  chain: true,  ...lin(0, 1),    fmt: pct },
  { key: 'phaser',       label: 'Phaser',     cat: 'space',  neutral: 0,     graph: true,  chain: true,  ...lin(0, 1),    fmt: pct },
  // Level & stereo
  { key: 'gain',         label: 'Volume',     cat: 'level',  neutral: 1,     graph: true,  chain: true,  ...lin(0, 2),    fmt: v => `${Math.round(v * 100)}%` },
  { key: 'pan',          label: 'Pan',        cat: 'level',  neutral: 0,     graph: true,  chain: true,  ...lin(-1, 1),   fmt: v => Math.abs(v) < 0.02 ? 'C' : `${v < 0 ? 'L' : 'R'}${Math.round(Math.abs(v) * 100)}` },
  { key: 'width',        label: 'Width',      cat: 'level',  neutral: 1,     graph: true,  chain: true,  ...lin(0, 2),    fmt: v => `${Math.round(v * 100)}%` },
  { key: 'tremoloDepth', label: 'Tremolo',    cat: 'level',  neutral: 0,     graph: true,  chain: true,  ...lin(0, 1),    fmt: pct },
  { key: 'tremoloRate',  label: 'Trem rate',  cat: 'level',  neutral: 5,     graph: false, chain: true, secondary: true, ...lin(0.1, 12), fmt: hz },
  { key: 'autopanDepth', label: 'Auto-pan',   cat: 'level',  neutral: 0,     graph: true,  chain: true,  ...lin(0, 1),    fmt: pct },
  { key: 'autopanRate',  label: 'Pan rate',   cat: 'level',  neutral: 2,     graph: false, chain: true, secondary: true, ...lin(0.1, 8), fmt: hz },
  // Tone EQ
  { key: 'sub',          label: 'Sub',        cat: 'eq',     neutral: 0,     graph: true,  chain: true,  ...lin(-12, 12), fmt: db },
  { key: 'bass',         label: 'Bass',       cat: 'eq',     neutral: 0,     graph: true,  chain: true,  ...lin(-12, 12), fmt: db },
  { key: 'mid',          label: 'Mid',        cat: 'eq',     neutral: 0,     graph: true,  chain: true,  ...lin(-12, 12), fmt: db },
  { key: 'treble',       label: 'Treble',     cat: 'eq',     neutral: 0,     graph: true,  chain: true,  ...lin(-12, 12), fmt: db },
]

export const FX_FIELD_BY_KEY: Record<string, FxField> = Object.fromEntries(FX_FIELDS.map(f => [f.key, f]))
export const TOP_FIELDS: FxField[] = FX_FIELDS.filter(f => f.top)
export const GRAPH_TARGETS: PitchGraphTarget[] = FX_FIELDS.filter(f => f.graph).map(f => f.key as PitchGraphTarget)

// "Basic" mode — the most basic controls, shown flat (no categories):
// sustain, filter (low-pass), gain, plus reverb and drive.
// Volume (gain) leads the basic set, then sustain, filter, reverb, drive.
const BASIC_KEYS: (keyof RollFx)[] = ['gain', 'sustain', 'filterHz', 'reverbWet', 'drive']
export const BASIC_FIELDS: FxField[] = BASIC_KEYS.map(k => FX_FIELD_BY_KEY[k as string]).filter(Boolean)

/** Is a value meaningfully different from the field's neutral? */
export function fieldIsSet(key: keyof RollFx, v: number | undefined): boolean {
  if (v === undefined) return false
  const f = FX_FIELD_BY_KEY[key]
  if (!f) return v !== 0
  if (key === 'filterHz') return v < 17500
  if (key === 'highpassHz') return v > 22
  return Math.abs(v - f.neutral) > (f.cat === 'eq' ? 0.05 : 1e-4)
}

/** Any non-neutral field the post-source FX chain would act on? (Primary knobs
 *  only — a lone secondary rate/time doesn't warrant building a chain.) */
export function fxHasAudibleField(fx: RollFx | undefined): boolean {
  if (!fx) return false
  return FX_FIELDS.some(f => f.chain && !f.secondary && fieldIsSet(f.key, fx[f.key]))
}

/** Any source-side pitch modulation set? (detune / vibrato / pitch env.) */
export function fxHasPitchMod(fx: RollFx | undefined): boolean {
  if (!fx) return false
  return fieldIsSet('detune', fx.detune) || fieldIsSet('vibratoDepth', fx.vibratoDepth) || fieldIsSet('pitchEnv', fx.pitchEnv)
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
