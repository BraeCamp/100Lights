// On-device vision for Lightning Bug "edits" — finds WHERE things are on the video so effects can
// target a region, not the whole frame. Two tiers:
//   • MotionDetector — frame-differencing (no model): the bounding box of what's moving. Free, instant.
//   • loadObjectDetector — COCO-SSD (TensorFlow.js, WASM/on-device): labelled boxes (person/car/dog…).
//     Weights download once; inference is local, so it keeps the "no cloud AI" promise.
// Both need to read the video's pixels, which requires a NON-tainted canvas: set crossOrigin="anonymous"
// on the <video> (Pexels' CDN sends access-control-allow-origin:*, so library clips work).

export interface Box { x: number; y: number; w: number; h: number; score: number; label?: string }

// ── Motion (frame diff) ──────────────────────────────────────────────────────
export class MotionDetector {
  private prev: Uint8ClampedArray | null = null
  private c: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  constructor(private sw = 128, private sh = 72) {
    this.c = document.createElement('canvas')
    this.c.width = sw; this.c.height = sh
    this.ctx = this.c.getContext('2d', { willReadFrequently: true })!
  }
  reset() { this.prev = null }
  /** Bounding box (0..1 normalized) of the largest moving area, or null if too little/unreadable. */
  detect(video: HTMLVideoElement): Box | null {
    if (!video.videoWidth) return null
    let cur: ImageData
    try { this.ctx.drawImage(video, 0, 0, this.sw, this.sh); cur = this.ctx.getImageData(0, 0, this.sw, this.sh) }
    catch { return null }   // tainted (cross-origin without CORS) or not ready
    const d = cur.data, prev = this.prev
    if (!prev) { this.prev = new Uint8ClampedArray(d); return null }
    let minx = this.sw, miny = this.sh, maxx = 0, maxy = 0, count = 0, sum = 0
    // weighted centroid too, so a tight box tracks the densest motion, not stray corners
    let cx = 0, cy = 0
    for (let y = 0; y < this.sh; y++) for (let x = 0; x < this.sw; x++) {
      const i = (y * this.sw + x) * 4
      const dl = Math.abs((d[i] + d[i + 1] + d[i + 2]) - (prev[i] + prev[i + 1] + prev[i + 2]))
      sum += dl
      if (dl > 55) {
        if (x < minx) minx = x; if (x > maxx) maxx = x
        if (y < miny) miny = y; if (y > maxy) maxy = y
        cx += x; cy += y; count++
      }
    }
    prev.set(d)
    const total = this.sw * this.sh
    if (count < total * 0.004) return null   // basically still
    cx /= count; cy /= count
    // tighten the box around the centroid to shed scattered background motion
    const bw = (maxx - minx), bh = (maxy - miny)
    const x0 = Math.max(minx, cx - bw * 0.6), x1 = Math.min(maxx, cx + bw * 0.6)
    const y0 = Math.max(miny, cy - bh * 0.6), y1 = Math.min(maxy, cy + bh * 0.6)
    return { x: x0 / this.sw, y: y0 / this.sh, w: (x1 - x0) / this.sw, h: (y1 - y0) / this.sh, score: sum / (total * 765) }
  }
}

// Smooth a box toward a target (exponential) so highlights glide instead of jitter.
export function lerpBox(a: Box | null, b: Box | null, k = 0.25): Box | null {
  if (!b) return a
  if (!a) return b
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, w: a.w + (b.w - a.w) * k, h: a.h + (b.h - a.h) * k, score: b.score, label: b.label }
}

// ── Object detection (COCO-SSD, lazy) ────────────────────────────────────────
// Classes we surface as "things worth an edit" (COCO has 80; these are the music-video-useful ones).
export const SUBJECT_CLASSES = new Set(['person', 'car', 'truck', 'bus', 'motorcycle', 'bicycle', 'dog', 'cat', 'bird', 'horse', 'boat', 'airplane'])

interface CocoModel { detect(input: HTMLVideoElement | HTMLCanvasElement, maxNumBoxes?: number, minScore?: number): Promise<{ bbox: [number, number, number, number]; class: string; score: number }[]> }
let modelP: Promise<CocoModel> | null = null

export function loadObjectDetector(): Promise<CocoModel> {
  if (!modelP) modelP = (async () => {
    const tf = await import('@tensorflow/tfjs')
    const cocoSsd = await import('@tensorflow-models/coco-ssd')
    await tf.ready()
    return cocoSsd.load({ base: 'lite_mobilenet_v2' }) as unknown as CocoModel   // small + fast; good enough for framing
  })()
  return modelP
}

// Detect on a video, return normalized boxes for the subject classes (biggest/most-confident first).
export async function detectObjects(model: CocoModel, video: HTMLVideoElement): Promise<Box[]> {
  if (!video.videoWidth) return []
  const raw = await model.detect(video, 8, 0.45)
  const vw = video.videoWidth, vh = video.videoHeight
  return raw
    .filter(r => SUBJECT_CLASSES.has(r.class))
    .map(r => ({ x: r.bbox[0] / vw, y: r.bbox[1] / vh, w: r.bbox[2] / vw, h: r.bbox[3] / vh, score: r.score, label: r.class }))
    .sort((a, b) => (b.w * b.h) - (a.w * a.h))
}
