import type { AutoPoint, ClipEffectType } from './daw-types'

export const CLIP_EFFECT_PARAM_META: Record<ClipEffectType, {
  key: string
  min: number
  max: number
  label: string
  log?: boolean
}> = {
  volume:     { key: 'gain',        min: 0,   max: 2,     label: 'Volume'    },
  reverb:     { key: 'reverbWet',   min: 0,   max: 1,     label: 'Wet'       },
  delay:      { key: 'delayWet',    min: 0,   max: 1,     label: 'Wet'       },
  filter:     { key: 'frequency',   min: 40,  max: 18000, label: 'Frequency', log: true },
  tremolo:    { key: 'tremoloRate', min: 0.1, max: 15,    label: 'Rate'      },
  distortion: { key: 'distortion',  min: 0,   max: 1,     label: 'Amount'    },
  pitch:      { key: 'semitones',   min: -24, max: 24,    label: 'Semitones' },
}

export function normToParam(v: number, meta: { min: number; max: number; log?: boolean }): number {
  if (meta.log) return meta.min * Math.pow(meta.max / meta.min, Math.max(0, Math.min(1, v)))
  return meta.min + Math.max(0, Math.min(1, v)) * (meta.max - meta.min)
}

export function paramToNorm(val: number, meta: { min: number; max: number; log?: boolean }): number {
  if (meta.log) return Math.log(Math.max(meta.min, val) / meta.min) / Math.log(meta.max / meta.min)
  return (val - meta.min) / (meta.max - meta.min)
}

function evalBezier(
  p0: [number, number], c1: [number, number], c2: [number, number], p1: [number, number], s: number,
): [number, number] {
  const u = 1 - s
  return [
    u*u*u*p0[0] + 3*u*u*s*c1[0] + 3*u*s*s*c2[0] + s*s*s*p1[0],
    u*u*u*p0[1] + 3*u*u*s*c1[1] + 3*u*s*s*c2[1] + s*s*s*p1[1],
  ]
}

function evalAtT(sorted: AutoPoint[], t: number): number {
  if (!sorted.length) return 0.5
  if (t <= sorted[0].t) return sorted[0].v
  if (t >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v
  let i = 0
  while (i < sorted.length - 1 && sorted[i + 1].t <= t) i++
  const p = sorted[i], q = sorted[i + 1]
  if (!p.smooth && !q.smooth) {
    const s = (t - p.t) / (q.t - p.t)
    return p.v + s * (q.v - p.v)
  }
  const c1: [number, number] = [p.t + (p.smooth ? p.h2[0] : 0), p.v + (p.smooth ? p.h2[1] : 0)]
  const c2: [number, number] = [q.t + (q.smooth ? q.h1[0] : 0), q.v + (q.smooth ? q.h1[1] : 0)]
  let lo = 0, hi = 1
  for (let n = 0; n < 24; n++) {
    const mid = (lo + hi) / 2
    if (evalBezier([p.t, p.v], c1, c2, [q.t, q.v], mid)[0] < t) lo = mid; else hi = mid
  }
  return Math.max(0, Math.min(1, evalBezier([p.t, p.v], c1, c2, [q.t, q.v], (lo + hi) / 2)[1]))
}

export function sampleAutomation(points: AutoPoint[], durationBeats: number, N: number): number[] {
  const sorted = [...points].sort((a, b) => a.t - b.t)
  return Array.from({ length: N }, (_, i) => {
    const t = (i / Math.max(1, N - 1)) * durationBeats
    return evalAtT(sorted, t)
  })
}
