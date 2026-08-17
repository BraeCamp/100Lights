// Subject lift — iPhone-sticker style: segment the subject at a tapped point (or the frame center) out
// of a photo/video frame and return it as a FULL-FRAME transparent PNG (subject opaque, everything else
// clear). Overlaying that on a track above the source "lifts" the subject, so text/other layers placed
// between them appear BEHIND it. On-device via MediaPipe's interactive segmenter (the same tasks-vision
// package + CDN load pattern lib/speaker-detect already uses). Client-only.
const MP_VERSION = '1.0.1'
// "magic touch" interactive-segmentation model — segments the object under a given point.
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let segmenterP: Promise<any> | null = null
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadSegmenter(): Promise<any> {
  if (!segmenterP) segmenterP = (async () => {
    const { InteractiveSegmenterLegacy, FilesetResolver } = await import('@mediapipe/tasks-vision')
    const vision = await FilesetResolver.forVisionTasks(`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`)
    return InteractiveSegmenterLegacy.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL },
      outputConfidenceMasks: true,   // soft 0..1 mask → anti-aliased sticker edges
      outputCategoryMask: false,
    })
  })()
  return segmenterP
}

export interface LiftResult { dataUrl: string; box: { x: number; y: number; w: number; h: number }; w: number; h: number }

/**
 * Segment the subject under `point` (normalized 0..1; default = center) and return a full-frame PNG
 * with only the subject opaque (soft alpha edges). `box` is the subject's normalized bounding rect.
 * Returns null if nothing was segmented. Runs entirely on-device.
 */
export async function liftSubject(
  source: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  point: { x: number; y: number } = { x: 0.5, y: 0.5 },
): Promise<LiftResult | null> {
  const w = (source as HTMLVideoElement).videoWidth || (source as HTMLImageElement).naturalWidth || source.width
  const h = (source as HTMLVideoElement).videoHeight || (source as HTMLImageElement).naturalHeight || source.height
  if (!w || !h) return null

  // Draw the source to a canvas at native resolution.
  const src = document.createElement('canvas'); src.width = w; src.height = h
  const sctx = src.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(source, 0, 0, w, h)

  const segmenter = await loadSegmenter()
  const result = segmenter.segment(src, { keypoint: { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) } })
  const mask = result.confidenceMasks?.[0]
  if (!mask) { result.close?.(); return null }
  const conf: Float32Array = mask.getAsFloat32Array()   // per-pixel foreground confidence 0..1
  const mw = mask.width, mh = mask.height

  // Build the cutout: alpha = confidence, so edges feather instead of jaggedly clipping.
  const img = sctx.getImageData(0, 0, w, h)
  let minX = w, minY = h, maxX = 0, maxY = 0, any = false
  for (let y = 0; y < h; y++) {
    const my = mh === h ? y : Math.min(mh - 1, (y * mh / h) | 0)
    for (let x = 0; x < w; x++) {
      const mx = mw === w ? x : Math.min(mw - 1, (x * mw / w) | 0)
      const c = conf[my * mw + mx]
      const i = (y * w + x) * 4
      img.data[i + 3] = c > 0.5 ? Math.round(Math.min(1, c) * 255) : 0
      if (c > 0.5) { any = true; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
    }
  }
  result.close?.()
  if (!any) return null

  const out = document.createElement('canvas'); out.width = w; out.height = h
  out.getContext('2d')!.putImageData(img, 0, 0)
  return {
    dataUrl: out.toDataURL('image/png'),
    box: { x: minX / w, y: minY / h, w: (maxX - minX + 1) / w, h: (maxY - minY + 1) / h },
    w, h,
  }
}
