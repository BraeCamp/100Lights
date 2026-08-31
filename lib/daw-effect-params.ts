import type { EffectType, TrackEffect } from './daw-types'

// ── What on a device can be drawn over time ─────────────────────────────────
//
// Brae: "I want them to be editable under tracks so that users can adjust the
// graph of all active device chain effects in line with the track. This would
// also help voice control to change the changes in effects under tracks."
//
// Until now an automation lane could target exactly one thing on a device: its
// wet. The lane type has always said `fx:{effectId}:{paramKey}` and the engine
// has always handled any key —
//
//     const [, effectId, paramKey] = parameter.split(':')
//     handle?.setParam(paramKey, value)
//
// — but the only menu that could make one offered `:wet` and nothing else. So a
// filter cutoff could not be automated by hand at all; the voice command was
// the only thing in the studio that ever wrote one, which is a strange place
// for a capability to live.
//
// This is the missing half: which parameters are worth a curve, what they are
// called, and — the part that matters — the RANGE each one lives in.
//
// ⚠️ THE RANGE IS THE WHOLE POINT. An automation value is passed to the effect
// unchanged, so a lane's min and max are not decoration for the drawing code:
// they are the units. A filter lane declared 0–1 sets the cutoff to a fraction
// of a Hertz and silences the track, which is exactly the bug Brae found in the
// voice sweep. Every range here is in the parameter's own unit.
//
// Deliberately not every parameter. A menu of sixty entries is not more capable
// than a menu of four, it is just harder to use — these are the ones somebody
// would actually draw a shape for.

export interface AutomatableParam {
  /** The `paramKey` half of `fx:{effectId}:{paramKey}`. */
  key: string
  label: string
  /** In the parameter's OWN unit. Passed to the effect unchanged. */
  min: number
  max: number
  /** Shown after the number, for read-backs and the lane header. */
  unit?: string
}

/**
 * Where a filter cutoff lives.
 *
 * Shared with the voice command's sweep so that a spoken "descending low-pass"
 * and one drawn by hand mean the same thing. They were two independent copies
 * for a while, which is how a curve drifts.
 *
 * The bottom is 200 Hz rather than 20: below that a low-pass has removed
 * everything anybody can hear, so the lower octaves are travel the drawing has
 * to cross and nobody wants.
 */
export const LOWPASS_HZ = { min: 200, max: 18_000 }
export const HIGHPASS_HZ = { min: 20, max: 2_000 }

const WET: AutomatableParam = { key: 'wet', label: 'Wet', min: 0, max: 1 }

const BY_TYPE: Partial<Record<EffectType, AutomatableParam[]>> = {
  eq3: [
    { key: 'lowGain', label: 'Low', min: -12, max: 12, unit: 'dB' },
    { key: 'midGain', label: 'Mid', min: -12, max: 12, unit: 'dB' },
    { key: 'highGain', label: 'High', min: -12, max: 12, unit: 'dB' },
  ],
  compressor: [
    { key: 'threshold', label: 'Threshold', min: -60, max: 0, unit: 'dB' },
    { key: 'amount', label: 'Amount', min: 0, max: 1 },
  ],
  reverb: [WET, { key: 'decay', label: 'Decay', min: 0.1, max: 10, unit: 's' }],
  delay: [WET, { key: 'feedback', label: 'Feedback', min: 0, max: 0.95 }],
  filter: [
    // Range chosen per filter TYPE at lookup time — a high-pass sweeping to
    // 18 kHz is silence just as surely as a low-pass at 0.2 Hz.
    { key: 'frequency', label: 'Cutoff', min: LOWPASS_HZ.min, max: LOWPASS_HZ.max, unit: 'Hz' },
    { key: 'q', label: 'Resonance', min: 0.1, max: 20 },
  ],
  saturator: [{ key: 'drive', label: 'Drive', min: 0, max: 1 }, { key: 'color', label: 'Colour', min: 0, max: 1 }],
  redux: [{ key: 'bitDepth', label: 'Bit depth', min: 1, max: 16, unit: 'bit' }],
  autopan: [{ key: 'depth', label: 'Depth', min: 0, max: 1 }, { key: 'rate', label: 'Rate', min: 0.05, max: 20, unit: 'Hz' }],
  utility: [
    { key: 'gain', label: 'Gain', min: -24, max: 24, unit: 'dB' },
    { key: 'width', label: 'Width', min: 0, max: 2 },
  ],
  lfo: [{ key: 'rate', label: 'Rate', min: 0.05, max: 20, unit: 'Hz' }, { key: 'depth', label: 'Depth', min: 0, max: 1 }],
  noisegate: [{ key: 'threshold', label: 'Threshold', min: -80, max: 0, unit: 'dB' }],
  deesser: [{ key: 'threshold', label: 'Threshold', min: -60, max: 0, unit: 'dB' }],
  chorus: [{ key: 'mix', label: 'Mix', min: 0, max: 1 }, { key: 'depth', label: 'Depth', min: 0, max: 1 }],
  transientshaper: [
    { key: 'attack', label: 'Attack', min: -1, max: 1 },
    { key: 'sustain', label: 'Sustain', min: -1, max: 1 },
  ],
  limiter: [{ key: 'threshold', label: 'Ceiling', min: -24, max: 0, unit: 'dB' }],
  dyneq: [
    { key: 'freq', label: 'Frequency', min: 20, max: 18_000, unit: 'Hz' },
    { key: 'rangeDb', label: 'Range', min: -18, max: 18, unit: 'dB' },
  ],
  multibandcomp: [
    { key: 'lowGain', label: 'Low gain', min: -12, max: 12, unit: 'dB' },
    { key: 'midGain', label: 'Mid gain', min: -12, max: 12, unit: 'dB' },
    { key: 'highGain', label: 'High gain', min: -12, max: 12, unit: 'dB' },
  ],
  unmask: [{ key: 'amount', label: 'Amount', min: 0, max: 1 }],
}

/**
 * What can be drawn on this particular device.
 *
 * Takes the effect rather than the type so the filter can answer honestly: a
 * high-pass and a low-pass are the same device with opposite useful ranges, and
 * one table row cannot describe both.
 */
export function automatableParams(effect: TrackEffect): AutomatableParam[] {
  const list = BY_TYPE[effect.type] ?? []
  if (effect.type !== 'filter') return list
  const kind = (effect.params as { type?: string } | undefined)?.type
  const hz = kind === 'highpass' ? HIGHPASS_HZ : LOWPASS_HZ
  return list.map(p => (p.key === 'frequency' ? { ...p, ...hz } : p))
}

/** The one people reach for first — used for the click-to-automate chip. */
export function primaryParam(effect: TrackEffect): AutomatableParam | null {
  return automatableParams(effect)[0] ?? null
}

/** What a device is called on a track, short enough to sit in a row of them. */
export const EFFECT_SHORT: Partial<Record<EffectType, string>> = {
  eq3: 'EQ', compressor: 'COMP', reverb: 'VERB', delay: 'DLY', filter: 'FLT',
  saturator: 'SAT', redux: 'CRUSH', autopan: 'PAN', utility: 'UTIL', lfo: 'LFO',
  noisegate: 'GATE', deesser: 'DEESS', chorus: 'CHOR', transientshaper: 'TRANS',
  multibandcomp: 'MBC', limiter: 'LIM', dyneq: 'DEQ', unmask: 'UNMSK',
  helios: 'APOLLO',
}

export const shortName = (t: EffectType): string => EFFECT_SHORT[t] ?? String(t).slice(0, 5).toUpperCase()
