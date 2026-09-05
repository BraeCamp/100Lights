// The crossfader, as arithmetic.
//
// Every track can be assigned to side A, side B, or neither. One control,
// 0..1, fades between the sides: at 0 only A is heard, at 1 only B, and a
// track on neither side ignores it. The curve is equal-power (cosine /
// sine), so two sources at the centre sum to the same loudness as one at an
// end rather than dipping — the crossfade a DJ mixer does.
//
// The type has lived on the project (`crossfaderValue`) and on tracks
// (`crossfader`) for a while with nothing reading them; the engine now folds
// this gain into each track's fader (lib/daw-engine.ts, _gainMult).

import type { CrossfaderSide } from './daw-types'

/**
 * The shape of the fade.
 *
 * ⚠️ NAMED FOR WHAT THEY DO, not after another program's list. Live has seven
 * with its own names; guessing at those would mean labelling a curve with a
 * word we cannot stand behind. These five are musically distinct and each one
 * says what it is.
 */
export type CrossfaderCurve = 'equal-power' | 'linear' | 'slow-fade' | 'fast-cut' | 'hard-cut'
export const CROSSFADER_CURVES: CrossfaderCurve[] = ['equal-power', 'linear', 'slow-fade', 'fast-cut', 'hard-cut']
export const CURVE_LABEL: Record<CrossfaderCurve, string> = {
  'equal-power': 'Equal power', linear: 'Linear', 'slow-fade': 'Slow fade', 'fast-cut': 'Fast cut', 'hard-cut': 'Hard cut',
}
export const CURVE_HELP: Record<CrossfaderCurve, string> = {
  'equal-power': 'Two sources at the centre are as loud as one at an end. The everyday one.',
  linear: 'The levels add up rather than the power, so the middle sounds louder — right when both sides are the same recording.',
  'slow-fade': 'A long overlap: both sides stay up across most of the travel.',
  'fast-cut': 'The outgoing side drops away quickly — most of the travel is nearly one side alone.',
  'hard-cut': 'A switch, not a fade: one side or the other, swapping at the middle.',
}

/**
 * The gain a track on `side` gets at crossfader position `value` (0 = A, 1 = B).
 *
 * `x` below is how far along the travel THIS side is from full: 0 at its own
 * end, 1 at the far end. Each curve is a function of that, so the two sides are
 * always mirror images and neither can be louder than unity.
 */
export function crossfadeGain(side: CrossfaderSide | undefined, value: number, curve: CrossfaderCurve = 'equal-power'): number {
  if (!side || side === 'none') return 1
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5))
  const x = side === 'A' ? v : 1 - v
  switch (curve) {
    case 'linear': return 1 - x
    case 'slow-fade': return Math.cos(x * Math.PI / 2) ** 0.5
    case 'fast-cut': return Math.cos(x * Math.PI / 2) ** 2
    case 'hard-cut': return x < 0.5 ? 1 : 0
    case 'equal-power':
    default: return Math.cos(x * Math.PI / 2)
  }
}

/** "A", "B", "centre", "70% B" — the position the way the studio says it. */
export function describeCrossfader(value: number): string {
  const v = Math.min(1, Math.max(0, value))
  if (Math.abs(v - 0.5) < 0.01) return 'centre'
  if (v <= 0.01) return 'A'
  if (v >= 0.99) return 'B'
  return v < 0.5 ? `${Math.round((0.5 - v) * 200)}% A` : `${Math.round((v - 0.5) * 200)}% B`
}
