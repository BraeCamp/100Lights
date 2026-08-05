/**
 * Full-fidelity timeline export: renders exactly what the preview shows —
 * colour grade, vignette, crop/flip/opacity/fades/Ken Burns, blend, motion
 * blur, titles, and captions — plus a real multitrack audio mix (per-track
 * volume, fades, per-clip EQ). Composites to a canvas and records in real time.
 *
 * The legacy ffmpeg trim+concat path (lib/exporter.ts) is kept for audio-only
 * exports and as a fast "no effects" fallback.
 */

import type { CaptionStyle, ProjectAspect, TimelineItem, Track, VideoAdjustments } from '@/lib/editor-types'
import { aspectRatioOf } from '@/lib/editor-types'
import type { Caption } from '@/lib/types'
import type { LutData } from '@/lib/lut-parser'
import { renderTimelineAudio, toMixClip } from './audio-mix'
import { captureTimeline } from './capture'
import { exportTimelineFast, fastExportSupported } from './fast'
import type { CompositorState } from './compositor'

export { fastExportSupported }

export type FidelityQuality    = 'high' | 'medium' | 'web'
export type FidelityResolution = 'original' | '1080p' | '720p' | '480p'

export const EXPORT_FPS = 30

// Long-edge pixel budget per resolution tier; the actual w×h comes from the
// project aspect (9:16 at 1080p = 1080×1920, not a letterboxed 1920×1080).
const RES_LONG_EDGE: Record<FidelityResolution, number> = {
  original: 1920,
  '1080p':  1920,
  '720p':   1280,
  '480p':   854,
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Output canvas dimensions for a resolution tier at a project aspect. */
export function resDims(resolution: FidelityResolution, aspect: ProjectAspect = '16:9'): { w: number; h: number } {
  const long = RES_LONG_EDGE[resolution]
  const ar = aspectRatioOf(aspect)
  return ar >= 1
    ? { w: even(long), h: even(long / ar) }
    : { w: even(long * ar), h: even(long) }
}

const BASE_BITRATE: Record<FidelityQuality, number> = { high: 12_000_000, medium: 6_000_000, web: 3_000_000 }

function bitrateFor(q: FidelityQuality, w: number, h: number): number {
  const areaRatio = (w * h) / (1920 * 1080)
  return Math.max(1_000_000, Math.round(BASE_BITRATE[q] * areaRatio))
}

export interface FidelityExportInput {
  timelineItems: TimelineItem[]
  tracks:        Track[]
  adjustments:   VideoAdjustments
  captions:      Caption[]
  captionStyle?: CaptionStyle
  luts?:         Map<string, LutData>
  quality:       FidelityQuality
  resolution:    FidelityResolution
  aspect?:       ProjectAspect
  range?:        { start: number; end: number } | null
  /** Try the WebCodecs offline renderer (faster than real time); falls back to real-time capture on failure. */
  fast?:         boolean
  onProgress:    (frac: number, msg: string) => void
  signal?:       AbortSignal
}

export async function exportTimelineFidelity(input: FidelityExportInput): Promise<Blob> {
  const { timelineItems, tracks, adjustments, captions, captionStyle, luts, quality, resolution, aspect, range, fast, onProgress, signal } = input

  const items = timelineItems.filter(i => i.enabled !== false)
  const timelineEnd = items.reduce((m, i) => Math.max(m, i.startTime + (i.outPoint - i.inPoint)), 0)
  const start = range ? Math.max(0, range.start) : 0
  const end   = range ? Math.min(timelineEnd, range.end) : timelineEnd
  const windowDur = Math.max(0, end - start)
  if (windowDur <= 0) throw new Error('Nothing to export in the selected range.')

  const { w, h } = resDims(resolution, aspect)
  const state: CompositorState = { items, tracks, adjustments, captions, captionStyle, luts, width: w, height: h }

  // 1. Offline audio mix (faster than real time) — 2%…30%.
  onProgress(0.02, 'Mixing audio…')
  const audio = await renderTimelineAudio(
    items.map(toMixClip), tracks, timelineEnd,
    f => onProgress(0.02 + f * 0.28, 'Mixing audio…'),
  )
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  // 2. Composite + encode — 30%…100% (dominates wall-clock).
  const common = {
    state,
    totalDur: windowDur,
    startOffset: start,
    fps: EXPORT_FPS,
    videoBitsPerSecond: bitrateFor(quality, w, h),
    audioBuffer: audio,
    signal,
  }

  // Fast path: offline WebCodecs render (no wall-clock, tab can background).
  if (fast && fastExportSupported()) {
    try {
      const blob = await exportTimelineFast({
        ...common,
        onProgress: (f, msg) => onProgress(0.3 + f * 0.7, msg),
      })
      onProgress(1, 'Export complete!')
      return blob
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err
      // Codec/config failure — fall through to the proven real-time capture.
      console.warn('[export] fast render failed, falling back to real-time capture:', err)
    }
  }

  const blob = await captureTimeline({
    ...common,
    onProgress: (f, msg) => onProgress(0.3 + f * 0.7, msg),
  })
  onProgress(1, 'Export complete!')
  return blob
}
