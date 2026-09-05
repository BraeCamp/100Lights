// The arithmetic behind a knob, kept out of the component so it can be tested
// without a browser and shared with anything else that turns a number into a
// position — a MIDI fader, a typed value, an arrow key.
//
// A knob has two coordinate systems. The POSITION is 0..1 along the arc; the
// VALUE is in the parameter's own unit (Hz, dB, ms, a plain fraction). Every
// gesture — drag, arrow key, page key, CC — works in positions, because a
// gesture should feel the same on a 20 Hz–20 kHz cutoff as on a 0..1 mix.
// Every read-back, typed entry and screen-reader announcement works in values,
// because nobody thinks in "0.34 of a cutoff".

export interface KnobSpec {
  /** Read out to screen readers and shown while the knob is touched. */
  label?: string
  /** In the parameter's OWN unit. */
  min: number
  max: number
  /** Shown after the number: 'Hz', 'dB', 'ms', '%', 'st'. */
  unit?: string
  /**
   * Spaced by ratio rather than by difference. Anything in Hertz wants this —
   * see lib/daw-effect-params.ts for why a linear cutoff feels dead.
   */
  curve?: 'log'
  /** Decimal places for the read-back. Derived from the range when omitted. */
  decimals?: number
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const clampTo = (v: number, spec: KnobSpec) => Math.min(spec.max, Math.max(spec.min, v))

/** A log taper needs a positive, non-empty range; anything else is linear. */
export function isLogSpec(spec: KnobSpec): boolean {
  return spec.curve === 'log' && spec.min > 0 && spec.max > spec.min
}

/** Value in its own unit → 0..1 along the arc. */
export function knobToNorm(value: number, spec: KnobSpec): number {
  if (spec.max === spec.min) return 0
  if (isLogSpec(spec)) return clamp01(Math.log(clampTo(value, spec) / spec.min) / Math.log(spec.max / spec.min))
  return clamp01((value - spec.min) / (spec.max - spec.min))
}

/** 0..1 along the arc → value in its own unit. */
export function knobFromNorm(norm: number, spec: KnobSpec): number {
  const n = clamp01(norm)
  if (isLogSpec(spec)) return spec.min * Math.pow(spec.max / spec.min, n)
  return spec.min + n * (spec.max - spec.min)
}

/**
 * How far one keystroke moves, as a fraction of the arc. The same three sizes
 * the drag uses: plain is one percent of the travel, Shift is five times
 * finer (as it is when dragging), Page keys are a tenth of the arc.
 */
export const KNOB_STEP = { fine: 0.002, step: 0.01, coarse: 0.1 } as const
export type KnobStepSize = keyof typeof KNOB_STEP

/** Nudge a value by one keystroke, through the arc so log knobs step by ratio. */
export function nudgeKnob(value: number, spec: KnobSpec, direction: 1 | -1, size: KnobStepSize = 'step'): number {
  return knobFromNorm(knobToNorm(value, spec) + direction * KNOB_STEP[size], spec)
}

/** Decimal places that suit the range: dB and Hz want whole numbers, a 0..1 mix wants two. */
export function knobDecimals(spec: KnobSpec): number {
  if (spec.decimals != null) return spec.decimals
  const span = spec.max - spec.min
  if (span > 200) return 0
  if (span > 20) return 1
  return 2
}

/** The read-back: number, then unit. Kilohertz above a thousand so "12000 Hz" reads as "12 kHz". */
export function formatKnobValue(value: number, spec: KnobSpec): string {
  const unit = spec.unit ?? ''
  if (unit === '%' && spec.max <= 1.2 && spec.min >= -1.2) return `${Math.round(value * 100)}%`
  if (/^hz$/i.test(unit) && Math.abs(value) >= 1000) {
    const k = value / 1000
    return `${k >= 10 ? k.toFixed(1) : k.toFixed(2)} kHz`
  }
  const d = knobDecimals(spec)
  const num = Math.abs(value) >= 10 && d > 1 ? value.toFixed(1) : value.toFixed(d)
  return unit ? `${num} ${unit}` : num
}

/**
 * What somebody typed → a value, or null when it is not a number.
 *
 * Forgiving about units, because a person types what they hear: "800",
 * "1.2k", "1.2 kHz", "-6dB", "50%", "20ms" all land. A pan knob (−1..1)
 * also takes Live's "L30" / "R30" / "C". Out-of-range numbers clamp rather
 * than fail — typing 30000 into a cutoff gets you the top, not an error.
 */
export function parseKnobEntry(text: string, spec: KnobSpec): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, '.')
  if (!t) return null
  const bipolarUnit = spec.min === -1 && spec.max === 1
  if (bipolarUnit) {
    if (t === 'c' || t === 'center' || t === 'centre') return 0
    const pan = /^([lr])\s*(\d+(?:\.\d+)?)$/.exec(t)
    if (pan) return clampTo((pan[1] === 'l' ? -1 : 1) * parseFloat(pan[2]) / 100, spec)
  }
  if (t === '-inf' || t === 'inf' || t === 'off') return spec.min
  if (t === 'max' || t === 'full') return spec.max
  if (t === 'min') return spec.min
  if (t === 'auto' && spec.min < 0) return spec.min
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))\s*([a-z%]*)$/.exec(t)
  if (!m) return null
  let v = parseFloat(m[1])
  if (!Number.isFinite(v)) return null
  const suffix = m[2]
  const unit = (spec.unit ?? '').toLowerCase()
  const fraction = spec.max <= 1.2 && spec.min >= -1.2
  if (suffix === 'k' || suffix === 'khz') v *= 1000
  else if (suffix === '%') v = fraction ? v / 100 : v
  else if (suffix === 's' && unit === 'ms') v *= 1000
  else if (suffix === 'ms' && unit === 's') v /= 1000
  else if (!suffix && unit === '%' && fraction) {
    // "80" on a 0..1 percent knob means 80%; "0.8" means the same thing.
    if (!(m[1].includes('.') && v <= 1)) v /= 100
  }
  return clampTo(v, spec)
}
