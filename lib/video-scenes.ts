// Offline SCENE analysis for uploaded video clips — the "detector" from Lightning Bug, run as a
// non-real-time batch pass instead of a live rAF loop.
//
// It seeks the video across a time grid and, per sampled frame, records:
//   • where the subject is  — the largest COCO object box, else the motion box  (SceneSample.box)
//   • how much is moving     — frame-to-frame change since the previous sample  (SceneSample.motion)
//   • how bright the scene is — average luma, bucketed dark / mid / bright       (SceneSample.luma / brightness)
//   • its dominant hue        — for colour-aware looks                           (SceneSample.hue)
//   • what's in frame         — COCO subject-class counts (person / car / dog…)  (SceneSample.objs)
//
// The result (a SceneTrack) is stored on the clip and is the raw material a later slice turns into
// auto-reframe, cut-on-scene-change, or follow-focus. Nothing here consumes it yet.
//
// Reuses lib/vision.ts — the SAME on-device models Lightning Bug runs live (MotionDetector +
// COCO-SSD) — but drives them from seeked frames, so there is NO PLL / EMA / performance.now()
// timing coupling: every timestamp comes from the sample grid. Runs entirely in the browser; the
// video must be same-origin (a blob: URL from an uploaded File is) or CORS-enabled (Pexels is) for
// the canvas to be pixel-readable — otherwise the frame reads throw and we fall back to motion-only.

import { MotionDetector, loadObjectDetector, detectObjects, type Box } from './vision'
import type { SceneTrack, SceneSample, SceneBox } from './editor-types'

export type { SceneTrack, SceneSample } from './editor-types'

export interface AnalyzeScenesOpts {
  step?: number                        // seconds between samples (default 0.4 ≈ 2.5 fps of analysis)
  from?: number                        // source-time start (default 0)
  to?: number                          // source-time end (default video.duration)
  objects?: boolean                    // run COCO object detection (default true; slower, ~50–150ms/frame)
  minScore?: number                    // COCO confidence floor (default 0.45)
  sampleW?: number                     // downscaled analysis width for luma/motion (default 192)
  signal?: AbortSignal                 // cancel a long analysis
  onProgress?: (frac: number) => void  // 0..1 progress
}

const DEFAULTS = { step: 0.4, objects: true, minScore: 0.45, sampleW: 192 }

/** Analyze a video's scenes offline. Accepts a ready <video>, or a URL / File we load into a
 *  detached one. Returns a SceneTrack (one sample per grid step). */
export async function analyzeVideoScenes(
  src: HTMLVideoElement | string | File | Blob,
  opts: AnalyzeScenesOpts = {},
): Promise<SceneTrack> {
  const step = Math.max(0.05, opts.step ?? DEFAULTS.step)
  const wantObjects = opts.objects ?? DEFAULTS.objects
  const minScore = opts.minScore ?? DEFAULTS.minScore

  const { video, owned, revoke } = await resolveVideo(src)
  try {
    const dur = video.duration
    if (!isFinite(dur) || dur <= 0) throw new Error('video has no readable duration')
    const from = Math.max(0, opts.from ?? 0)
    const to = Math.min(dur, opts.to ?? dur)
    const span = Math.max(0, to - from)

    // Downscaled canvas for luma/hue + motion (COCO reads the full <video> directly).
    const sw = Math.max(64, Math.round(opts.sampleW ?? DEFAULTS.sampleW))
    const aspect = (video.videoHeight || 9) / (video.videoWidth || 16)
    const sh = Math.max(36, Math.round(sw * aspect))
    const canvas = document.createElement('canvas')
    canvas.width = sw; canvas.height = sh
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!

    const motion = new MotionDetector(sw, sh)
    const model = wantObjects ? await loadObjectDetector().catch(() => null) : null
    const objectsRan = !!model

    const samples: SceneSample[] = []
    const n = Math.max(1, Math.floor(span / step) + 1)
    let readable = true   // flips false if a frame read taints (cross-origin without CORS)

    for (let i = 0; i < n; i++) {
      if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError')
      const t = Math.min(to, from + i * step)
      await seekTo(video, t)

      // Draw the current frame downscaled for the cheap pixel reads.
      let luma = 0, hue = -1, motionScore = 0, motionBox: Box | null = null
      if (readable) {
        try {
          ctx.drawImage(video, 0, 0, sw, sh)
          const px = ctx.getImageData(0, 0, sw, sh)
          const lh = averageLumaHue(px.data)
          luma = lh.luma; hue = lh.hue
          motionBox = motion.detect(video)          // diff vs the previous SAMPLED frame
          if (motionBox) motionScore = motionBox.score
        } catch { readable = false }                // tainted — give up on pixel reads, keep timing/objects
      }

      // Object boxes (biggest first). detectObjects reads the live <video> frame we just seeked to.
      let objs: { label: string; n: number }[] = []
      let objBox: Box | null = null
      if (model) {
        try {
          const boxes = await detectObjects(model, video)  // uses minScore 0.45 internally via lib default
          if (boxes.length) {
            objBox = boxes[0]
            const counts: Record<string, number> = {}
            for (const b of boxes) if (b.label) counts[b.label] = (counts[b.label] || 0) + 1
            objs = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, c]) => ({ label, n: c }))
          }
        } catch { /* model hiccup on one frame — skip objects for it */ }
      }

      const box: SceneBox | null = objBox
        ? { x: objBox.x, y: objBox.y, w: objBox.w, h: objBox.h }
        : motionBox ? { x: motionBox.x, y: motionBox.y, w: motionBox.w, h: motionBox.h } : null

      samples.push({
        t: +t.toFixed(3),
        motion: +Math.min(1, motionScore).toFixed(3),
        box: box && { x: +box.x.toFixed(3), y: +box.y.toFixed(3), w: +box.w.toFixed(3), h: +box.h.toFixed(3) },
        luma: +luma.toFixed(3),
        hue: hue < 0 ? -1 : Math.round(hue),
        brightness: luma < 0.33 ? 'dark' : luma < 0.66 ? 'mid' : 'bright',
        objs,
      })
      opts.onProgress?.((i + 1) / n)
    }

    // First sample's motion is meaningless (no previous frame) — copy the second's so downstream
    // consumers don't see a spurious 0/spike at t=0.
    if (samples.length >= 2) samples[0].motion = samples[1].motion

    return { step, duration: +span.toFixed(3), objects: objectsRan && readable, samples }
  } finally {
    if (owned) { try { video.pause() } catch {} ; video.removeAttribute('src'); video.load?.() }
    revoke?.()
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

async function resolveVideo(src: HTMLVideoElement | string | File | Blob): Promise<{ video: HTMLVideoElement; owned: boolean; revoke?: () => void }> {
  if (src instanceof HTMLVideoElement) {
    if (src.readyState < 1) await once(src, 'loadedmetadata')
    return { video: src, owned: false }
  }
  const video = document.createElement('video')
  video.crossOrigin = 'anonymous'   // needed to read remote (CORS) frames without tainting the canvas
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  let revoke: (() => void) | undefined
  if (typeof src === 'string') {
    video.src = src
  } else {
    const url = URL.createObjectURL(src)
    video.src = url
    revoke = () => URL.revokeObjectURL(url)
  }
  await once(video, 'loadedmetadata')
  return { video, owned: true, revoke }
}

/** Seek and resolve when the frame at `t` is actually displayed (with a timeout guard). */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise<void>(resolve => {
    let done = false
    const finish = () => { if (done) return; done = true; video.removeEventListener('seeked', finish); resolve() }
    video.addEventListener('seeked', finish)
    // If we're already there (rare), 'seeked' won't fire — nudge or resolve.
    if (Math.abs(video.currentTime - t) < 1e-3) { setTimeout(finish, 0); return }
    try { video.currentTime = t } catch { finish(); return }
    setTimeout(finish, 1500)   // guard against a seek that never lands (stalled network / odd codec)
  })
}

function once(el: EventTarget, ev: string): Promise<void> {
  return new Promise(resolve => {
    const h = () => { el.removeEventListener(ev, h); resolve() }
    el.addEventListener(ev, h)
  })
}

/** Average brightness (0..1) + dominant hue (0..360, or -1 if roughly grey) of an RGBA buffer. */
function averageLumaHue(d: Uint8ClampedArray): { luma: number; hue: number } {
  let r = 0, g = 0, b = 0
  const px = d.length / 4
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2] }
  r /= px; g /= px; b /= px
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), c = max - min
  const sat = max <= 0 ? 0 : c / max
  if (sat < 0.12 || c < 8) return { luma, hue: -1 }   // near-grey → no meaningful hue
  let h: number
  if (max === r) h = ((g - b) / c) % 6
  else if (max === g) h = (b - r) / c + 2
  else h = (r - g) / c + 4
  h *= 60; if (h < 0) h += 360
  return { luma, hue: h }
}
