// Auto-reframe: turn a scene track (subject boxes over time, from lib/video-scenes) into a
// reframe plan that keeps the subject in frame when a clip is shown in a taller/narrower aspect
// (16:9 → 9:16). The plan is applied by making the clip FOLLOW ITSELF: cover fit fills the frame,
// a modest zoom gives pan headroom, and a smoothed focus path (subject centers) drives followPan()
// — the same pan math preview and export already share. Pure + framework-free (no DOM).
import type { SceneTrack } from './editor-types'
import type { FocusKeyframe } from './focus-utils'

export interface ReframePlan {
  fitMode: 'cover'
  cropZoom: number              // 100 = none; >100 gives followPan its pan headroom
  focusKeyframes: FocusKeyframe[] // time = seconds since clip startTime; x/y = 0..1 subject center
  focusX: number                // static fallback (average subject center)
  focusY: number
  samples: number               // how many boxed samples informed the plan
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const clamp01 = (v: number) => clamp(v, 0, 1)

// Moving-average smoothing over a window of ±r samples (kills box jitter → smooth pan).
function smooth(pts: { t: number; x: number; y: number }[], r: number) {
  return pts.map((_, i) => {
    let sx = 0, sy = 0, n = 0
    for (let k = -r; k <= r; k++) { const j = i + k; if (j < 0 || j >= pts.length) continue; sx += pts[j].x; sy += pts[j].y; n++ }
    return { t: pts[i].t, x: sx / n, y: sy / n }
  })
}

// Keep at most `max` keyframes, evenly spaced (Catmull-Rom interpolates between them anyway).
function decimate<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr
  const out: T[] = [], step = (arr.length - 1) / (max - 1)
  for (let i = 0; i < max; i++) out.push(arr[Math.round(i * step)])
  return out
}

/**
 * Build a reframe plan from a scene track.
 * @param scene   result of analyzeVideoScenes over the clip's [inPoint, outPoint]
 * @param from    the clip's inPoint (source seconds) — keyframe times are made clip-local against it
 * @param speed   clip playback speed (keyframe local time = (sourceT - from) / speed)
 */
export function planReframe(scene: SceneTrack, from = 0, speed = 1, opts?: { minZoom?: number; maxZoom?: number; smoothR?: number; maxKeyframes?: number }): ReframePlan {
  const minZoom = opts?.minZoom ?? 108
  const maxZoom = opts?.maxZoom ?? 140
  const spd = speed > 0 ? speed : 1
  const boxed = scene.samples.filter(s => s.box)
  if (!boxed.length) return { fitMode: 'cover', cropZoom: minZoom, focusKeyframes: [], focusX: 0.5, focusY: 0.5, samples: 0 }

  const pts = boxed.map(s => ({ t: s.t, x: clamp01(s.box!.x + s.box!.w / 2), y: clamp01(s.box!.y + s.box!.h / 2) }))
  const sm = smooth(pts, opts?.smoothR ?? 3)

  // The more the subject roams horizontally, the more zoom (pan headroom) it needs to stay framed.
  const xs = sm.map(p => p.x)
  const spread = Math.max(...xs) - Math.min(...xs)
  const cropZoom = Math.round(clamp(minZoom + spread * 64, minZoom, maxZoom))

  const kf: FocusKeyframe[] = decimate(sm, opts?.maxKeyframes ?? 40)
    .map(p => ({ time: +Math.max(0, (p.t - from) / spd).toFixed(3), x: +p.x.toFixed(4), y: +p.y.toFixed(4) }))

  const avgX = xs.reduce((a, b) => a + b, 0) / xs.length
  const avgY = sm.reduce((a, b) => a + b.y, 0) / sm.length
  return { fitMode: 'cover', cropZoom, focusKeyframes: kf, focusX: +avgX.toFixed(4), focusY: +avgY.toFixed(4), samples: boxed.length }
}
