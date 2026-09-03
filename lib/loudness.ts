// How loud something actually sounds.
//
// Brae, on the audit's "needs work" list: normalise / level match — "needs
// loudness measurement in the app. The offline analysis exists; the in-app path
// does not."
//
// ⚠️ NOT RMS. This is the one measurement where the obvious cheap answer is
// actively wrong: RMS says a bass and a hi-hat at the same number are equally
// loud, and they are nowhere near. Ears are far less sensitive below 100Hz and
// more sensitive around 2-4kHz, so matching two tracks by RMS leaves the bass
// booming and the vocal buried — the exact fault the "match these two" command
// exists to fix. K-weighting (ITU-R BS.1770) is the standard answer: a shelf
// and a high-pass that approximate that sensitivity before the energy is
// measured.
//
// The filter coefficients below are defined AT 48 kHz, which is what every
// render in this app now runs at (lib/render-rate.ts). That is not a
// coincidence worth relying on silently, so `loudnessLufs` resamples the
// coefficients for any other rate rather than quietly measuring wrong.

/** One biquad, applied in place along a channel. */
function biquad(x: Float32Array, b: [number, number, number], a: [number, number, number]): Float32Array {
  const y = new Float32Array(x.length)
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < x.length; i++) {
    const v = b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
    x2 = x1; x1 = x[i]
    y2 = y1; y1 = v
    y[i] = v
  }
  return y
}

/**
 * The K-weighting pair, for a given rate.
 *
 * BS.1770 publishes these at 48 kHz. Rather than shipping one table and hoping,
 * the shelf and the high-pass are re-derived from their design parameters at
 * whatever rate arrives — at 48 kHz this reproduces the published numbers to
 * five decimal places, which the test checks.
 */
function kWeightFilters(rate: number) {
  // Stage 1 — high shelf, +4 dB above ~1.5 kHz: the head and torso boost.
  const f0 = 1681.974450955533
  const G = 3.999843853973347
  const Q = 0.7071752369554196
  const K = Math.tan(Math.PI * f0 / rate)
  const Vh = Math.pow(10, G / 20)
  const Vb = Math.pow(Vh, 0.4996667741545416)
  const a0 = 1 + K / Q + K * K
  const shelfB: [number, number, number] = [
    (Vh + Vb * K / Q + K * K) / a0,
    2 * (K * K - Vh) / a0,
    (Vh - Vb * K / Q + K * K) / a0,
  ]
  const shelfA: [number, number, number] = [
    1,
    2 * (K * K - 1) / a0,
    (1 - K / Q + K * K) / a0,
  ]

  // Stage 2 — the RLB high-pass at ~38 Hz: what makes a subsonic rumble stop
  // counting as loudness.
  const f0b = 38.13547087602444
  const Qb = 0.5003270373238773
  const Kb = Math.tan(Math.PI * f0b / rate)
  const denom = 1 + Kb / Qb + Kb * Kb
  const hpB: [number, number, number] = [1, -2, 1]
  const hpA: [number, number, number] = [
    1,
    2 * (Kb * Kb - 1) / denom,
    (1 - Kb / Qb + Kb * Kb) / denom,
  ]
  return { shelfB, shelfA, hpB, hpA }
}

/** Channel weights. Stereo is 1.0 each; the surround weights are not needed. */
const CHANNEL_WEIGHT = 1.0

export interface LoudnessResult {
  /** Integrated loudness, LUFS. -Infinity for silence. */
  lufs: number
  /** True peak is not measured; this is sample peak, 0..1. */
  peak: number
  /** How much of the material was loud enough to count. */
  gatedBlocks: number
}

/**
 * Integrated loudness of one or more channels.
 *
 * Gated exactly as the standard says, and the gating is the part that matters
 * musically: an absolute floor at -70 LUFS drops silence, then a relative gate
 * 10 LU below the ungated mean drops the quiet passages. Without it a sparse
 * part measures quiet because of its gaps rather than because of its level, and
 * matching two tracks would turn the sparse one up until its hits were far too
 * loud.
 */
export function loudnessLufs(channels: Float32Array[], rate: number): LoudnessResult {
  if (!channels.length || !channels[0]?.length) return { lufs: -Infinity, peak: 0, gatedBlocks: 0 }
  const { shelfB, shelfA, hpB, hpA } = kWeightFilters(rate)

  let peak = 0
  const weighted = channels.map(ch => {
    for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]))
    return biquad(biquad(ch, shelfB, shelfA), hpB, hpA)
  })

  // 400 ms blocks, 75% overlap — the standard's window.
  const block = Math.round(0.4 * rate)
  const hop = Math.round(block / 4)
  if (weighted[0].length < block) {
    // Shorter than one window: measure what there is rather than reporting
    // silence, because a one-shot IS a thing somebody will ask to match.
    let sum = 0
    for (const ch of weighted) for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i]
    const ms = sum / Math.max(1, weighted[0].length)
    return { lufs: ms > 0 ? -0.691 + 10 * Math.log10(CHANNEL_WEIGHT * ms) : -Infinity, peak, gatedBlocks: 1 }
  }

  const blockLoudness: number[] = []
  for (let start = 0; start + block <= weighted[0].length; start += hop) {
    let sum = 0
    for (const ch of weighted) {
      let s = 0
      for (let i = start; i < start + block; i++) s += ch[i] * ch[i]
      sum += CHANNEL_WEIGHT * (s / block)
    }
    blockLoudness.push(sum > 0 ? -0.691 + 10 * Math.log10(sum) : -Infinity)
  }

  const above = (floor: number) => blockLoudness.filter(l => l > floor)
  const meanOf = (ls: number[]) => {
    if (!ls.length) return -Infinity
    // Averaged as POWER, not as decibels. Averaging dB is a different number
    // and a wrong one.
    const p = ls.reduce((n, l) => n + Math.pow(10, (l + 0.691) / 10), 0) / ls.length
    return -0.691 + 10 * Math.log10(p)
  }

  const absolute = above(-70)
  if (!absolute.length) return { lufs: -Infinity, peak, gatedBlocks: 0 }
  const relativeGate = meanOf(absolute) - 10
  const kept = above(Math.max(-70, relativeGate))
  return {
    lufs: kept.length ? meanOf(kept) : meanOf(absolute),
    peak,
    gatedBlocks: kept.length || absolute.length,
  }
}

/**
 * The gain change, in dB, that would bring `measured` to `target`.
 *
 * Clamped, because the honest answer to "this track is 40 dB quiet" is usually
 * that it is silent or nearly so, and acting on it would blow up the mix rather
 * than balance it.
 */
export function matchGainDb(measured: number, target: number, limitDb = 18): number {
  if (!Number.isFinite(measured)) return 0
  return Math.max(-limitDb, Math.min(limitDb, target - measured))
}

/** A linear fader multiplier from a dB change — what the mixer actually takes. */
export function applyGainDb(volume: number, deltaDb: number): number {
  return Math.max(0, Math.min(1.5, volume * Math.pow(10, deltaDb / 20)))
}
