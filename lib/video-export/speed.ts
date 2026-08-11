/**
 * Clip speed math shared by the editor preview, the export capture loop and
 * the offline audio mixer, so all three agree on how fast a clip plays at any
 * moment. A clip has a base `speed` multiplier and an optional velocity ramp
 * (`speedPoints`, t = 0–1 fraction of the clip's timeline duration).
 */

export interface SpeedClipLike {
  startTime: number
  inPoint: number
  outPoint: number
  speed?: number
  speedPoints?: Array<{ t: number; speed: number }>
}

/** Smooth-step interpolation across the velocity keyframes (t = 0–1). */
export function interpSpeedRamp(points: Array<{ t: number; speed: number }>, t: number): number {
  if (!points.length) return 1
  const sorted = [...points].sort((a, b) => a.t - b.t)
  if (t <= sorted[0].t) return sorted[0].speed
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].speed
  for (let i = 0; i < sorted.length - 1; i++) {
    if (t >= sorted[i].t && t <= sorted[i + 1].t) {
      const span = sorted[i + 1].t - sorted[i].t
      if (span <= 0) return sorted[i].speed   // duplicate-t keyframes → avoid 0/0 = NaN
      const frac = (t - sorted[i].t) / span
      const smooth = frac * frac * (3 - 2 * frac)
      return sorted[i].speed + (sorted[i + 1].speed - sorted[i].speed) * smooth
    }
  }
  return 1
}

/** Instantaneous playback speed at `local` seconds into the clip's timeline window. */
export function instantSpeed(clip: SpeedClipLike, local: number): number {
  const base = clip.speed ?? 1
  if (!clip.speedPoints?.length) return base
  const dur = clip.outPoint - clip.inPoint
  if (dur <= 0) return base
  const t = Math.max(0, Math.min(1, local / dur))
  return interpSpeedRamp(clip.speedPoints, t) * base
}

const INTEGRAL_STEPS = 256

/**
 * Seconds of SOURCE media consumed after `local` timeline-seconds of the clip
 * (the integral of speed over the clip so far). For constant-speed clips this
 * is just `local * speed`; ramped clips use a cached cumulative table.
 */
export function sourceOffsetAt(clip: SpeedClipLike, local: number, cache?: Map<string, Float64Array>, cacheKey?: string): number {
  const base = clip.speed ?? 1
  if (!clip.speedPoints?.length) return Math.max(0, local) * base
  const dur = clip.outPoint - clip.inPoint
  if (dur <= 0) return 0
  const l = Math.max(0, Math.min(dur, local))

  let table = cacheKey ? cache?.get(cacheKey) : undefined
  if (!table) {
    // Cumulative trapezoid integral of instantSpeed over [0, dur].
    table = new Float64Array(INTEGRAL_STEPS + 1)
    const dt = dur / INTEGRAL_STEPS
    let acc = 0
    let prev = instantSpeed(clip, 0)
    for (let i = 1; i <= INTEGRAL_STEPS; i++) {
      const cur = instantSpeed(clip, i * dt)
      acc += ((prev + cur) / 2) * dt
      table[i] = acc
      prev = cur
    }
    if (cacheKey) cache?.set(cacheKey, table)
  }

  const pos = (l / dur) * INTEGRAL_STEPS
  const i = Math.min(INTEGRAL_STEPS - 1, Math.floor(pos))
  const frac = pos - i
  return table[i] + (table[i + 1] - table[i]) * frac
}
