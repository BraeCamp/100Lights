/**
 * Turning a sample into slices.
 *
 * Pulled out of SampleView so it can be tested against known audio instead of
 * by ear through the UI — and because there are now two ways to slice, which is
 * one more than belongs inside a click handler.
 *
 * Every other sampler offers both, and Apollo only had the first:
 *
 *   transient  follow the sound — chop where hits actually are
 *   grid       ignore the sound — chop into equal parts
 *
 * Grid matters more than it sounds. A loop whose hits are quiet, blurred or
 * swung defeats transient detection completely, and "just give me sixteen
 * equal pieces" is the move that always works.
 */

export interface Slice { pos: number }

/** Slices are stored in the patch, and the engine maps them chromatically from
 *  note 36 — so past this many there are no keys left to play them on. */
export const MAX_SLICES = 64

export interface DetectOptions {
  /**
   * 0..1, higher finds more.
   *
   * This is the control the whole feature was missing. The detector used a
   * hard-coded "energy more than doubled, and above 0.02" — reasonable for a
   * loud drum loop and useless for anything quiet or dense, with no knob to
   * turn. Sensitivity moves both halves of that rule together: the ratio a
   * transient must beat, and the floor it must clear.
   */
  sensitivity?: number
  /** Shortest gap between slices, in seconds. Stops one hit becoming three. */
  minGapSec?: number
  max?: number
}

export interface SliceResult {
  slices: Slice[]
  /** How many were found before the cap — so the UI can say so rather than
   *  silently dropping them, which is what it did before. */
  found: number
  truncated: boolean
}

/**
 * Chop where the sound actually changes.
 *
 * Energy per 10ms window; a slice where a window is both markedly louder than
 * the two before it and above a noise floor.
 */
export function detectTransients(
  channel: Float32Array,
  sampleRate: number,
  opts: DetectOptions = {},
): SliceResult {
  const sensitivity = Math.min(1, Math.max(0, opts.sensitivity ?? 0.5))
  const minGapSec = opts.minGapSec ?? 0.04
  const max = opts.max ?? MAX_SLICES

  // Both thresholds move with one control, in opposite directions.
  //   ratio 3.0 → 1.15   how much louder a window must be than its neighbours
  //   floor 0.06 → 0.002 how loud it must be at all
  // At 0 only unmistakable hits survive; at 1 the quietest ghost note counts.
  const ratio = 3.0 - 1.85 * sensitivity
  const floor = 0.06 - 0.058 * sensitivity

  const win = Math.max(64, Math.floor(sampleRate * 0.01))
  const hops = Math.floor(channel.length / win)
  if (hops < 3) return { slices: [{ pos: 0 }], found: 1, truncated: false }

  const energy = new Float32Array(hops)
  for (let h = 0; h < hops; h++) {
    let e = 0
    for (let s = h * win; s < (h + 1) * win; s++) e += channel[s] * channel[s]
    energy[h] = Math.sqrt(e / win)
  }

  const minGapHops = Math.max(1, Math.round((minGapSec * sampleRate) / win))
  const all: Slice[] = []
  let last = -minGapHops - 1
  for (let h = 2; h < hops; h++) {
    const prev = (energy[h - 1] + energy[h - 2]) / 2
    if (energy[h] > prev * ratio && energy[h] > floor && h - last >= minGapHops) {
      all.push({ pos: (h * win) / channel.length })
      last = h
    }
  }
  // A slice at the very start, or the first chunk of the sample is unreachable.
  if (!all.length || all[0].pos > 0.01) all.unshift({ pos: 0 })

  return { slices: all.slice(0, max), found: all.length, truncated: all.length > max }
}

/**
 * Chop into equal parts, ignoring the audio entirely.
 *
 * What "1/16 of the loop" means, and the reliable answer when transient
 * detection has nothing to grip: a pad, a swung break, a sample that fades in.
 */
export function gridSlices(count: number, max = MAX_SLICES): SliceResult {
  const n = Math.max(1, Math.min(max, Math.floor(count)))
  const slices: Slice[] = []
  for (let i = 0; i < n; i++) slices.push({ pos: i / n })
  return { slices, found: n, truncated: count > max }
}
