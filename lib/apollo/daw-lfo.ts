// Apollo LFOs as Beacon modulation.
//
// Apollo has ten LFOs whose shapes are hand-drawn point curves, and they have
// only ever modulated Apollo's own parameters. Beacon modulates through
// automation lanes. Rather than inventing a live link — which would not
// survive an offline render and could not be edited afterwards — an LFO is
// BAKED into a lane: the drawn shape, at its own rate, across a span.
//
// That means the result is deterministic, renders offline, shows up as a graph
// under the track, and can be reshaped by hand afterwards like any other
// automation. The LFO editor becomes a curve generator for the whole DAW.

import { lfoLutFromPoints } from '@/lib/apollo/engine-client'
import { SYNC_RATES, type LfoConfig } from '@/lib/apollo/patch'

export interface BakedPoint { beat: number; value: number }

/** How many beats one cycle of this LFO lasts. Free-running LFOs are in Hz, so
 *  they only become a beat length once a tempo is known. */
export function lfoCycleBeats(lfo: LfoConfig, bpm: number): number {
  if (lfo.sync) {
    const r = SYNC_RATES[Math.max(0, Math.min(SYNC_RATES.length - 1, Math.round(lfo.syncRate)))]
    return r?.beats ?? 1
  }
  const hz = Math.max(0.001, lfo.rate)
  const secondsPerBeat = 60 / Math.max(1, bpm)
  return 1 / (hz * secondsPerBeat)
}

/**
 * Render an LFO into automation points.
 *
 * `depth` scales around the lane's midpoint for a bipolar LFO, or upward from
 * `min` for a unipolar one — matching how the same LFO reads inside Apollo.
 * Resolution is per cycle rather than per beat: a slow LFO does not need
 * hundreds of points, and a fast one would be a staircase without them.
 */
export function bakeLfoToPoints(
  lfo: LfoConfig,
  opts: {
    startBeat: number
    lengthBeats: number
    bpm: number
    min: number
    max: number
    depth?: number
    /** Points per cycle. */
    resolution?: number
    phase?: number
  },
): BakedPoint[] {
  const { startBeat, lengthBeats, bpm, min, max } = opts
  const depth = opts.depth ?? 1
  const res = Math.max(4, Math.min(256, opts.resolution ?? 32))
  const cycle = Math.max(1e-4, lfoCycleBeats(lfo, bpm))
  const lut = lfoLutFromPoints(lfo.points)
  const phase0 = opts.phase ?? lfo.phase ?? 0

  // One point per resolution step across the whole span, plus a final point
  // exactly on the end so the curve does not stop short of the region.
  const stepBeats = cycle / res
  const n = Math.max(2, Math.ceil(lengthBeats / stepBeats))
  const out: BakedPoint[] = []
  for (let i = 0; i <= n; i++) {
    const beat = Math.min(lengthBeats, i * stepBeats)
    const ph = (phase0 + beat / cycle) % 1
    const raw = lut[Math.round(ph * (lut.length - 1))] ?? 0   // 0..1 from the drawn shape
    // Bipolar LFOs swing either side of centre; unipolar ones rise from the
    // floor. Scaling a bipolar shape from the floor would halve its travel and
    // sit it in the wrong place.
    const mid = (min + max) / 2
    const value = lfo.bipolar
      ? mid + (raw * 2 - 1) * depth * (max - min) / 2
      : min + raw * depth * (max - min)
    out.push({ beat: startBeat + beat, value: Math.max(min, Math.min(max, value)) })
    if (beat >= lengthBeats) break
  }
  return thinCollinear(out, (max - min) * 0.004)
}

/**
 * Drop points that sit on the straight line between their neighbours.
 *
 * Sampling per cycle is what keeps a fast LFO smooth, but on flat or linear
 * stretches it emits hundreds of points that all say the same thing — and the
 * lane is meant to be reshaped by hand afterwards, which a wall of handles
 * makes impossible. Endpoints are always kept.
 */
export function thinCollinear(points: BakedPoint[], epsilon: number): BakedPoint[] {
  if (points.length < 3) return points
  const out: BakedPoint[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]
    const cur = points[i]
    const next = points[i + 1]
    const span = next.beat - prev.beat
    const lerp = span > 1e-9
      ? prev.value + (next.value - prev.value) * ((cur.beat - prev.beat) / span)
      : cur.value
    if (Math.abs(cur.value - lerp) > epsilon) out.push(cur)
  }
  out.push(points[points.length - 1])
  return out
}

/** A short human description of the rate, for the lane label. */
export function lfoRateLabel(lfo: LfoConfig): string {
  if (lfo.sync) {
    const r = SYNC_RATES[Math.max(0, Math.min(SYNC_RATES.length - 1, Math.round(lfo.syncRate)))]
    return r?.label ?? '1/4'
  }
  return `${lfo.rate < 10 ? lfo.rate.toFixed(2) : Math.round(lfo.rate)}Hz`
}
