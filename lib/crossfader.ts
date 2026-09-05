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

/** The gain a track on `side` gets at crossfader position `value` (0 = A, 1 = B). */
export function crossfadeGain(side: CrossfaderSide | undefined, value: number): number {
  if (!side || side === 'none') return 1
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5))
  return side === 'A' ? Math.cos(v * Math.PI / 2) : Math.sin(v * Math.PI / 2)
}

/** "A", "B", "centre", "70% B" — the position the way the studio says it. */
export function describeCrossfader(value: number): string {
  const v = Math.min(1, Math.max(0, value))
  if (Math.abs(v - 0.5) < 0.01) return 'centre'
  if (v <= 0.01) return 'A'
  if (v >= 0.99) return 'B'
  return v < 0.5 ? `${Math.round((0.5 - v) * 200)}% A` : `${Math.round((v - 0.5) * 200)}% B`
}
