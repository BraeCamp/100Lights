/**
 * Full-fidelity timeline export: renders exactly what the preview shows —
 * colour grade, vignette, crop/flip/opacity/fades/Ken Burns, blend, motion
 * blur, titles, and captions — plus a real multitrack audio mix (per-track
 * volume, fades, per-clip EQ). Composites to a canvas and records in real time.
 *
 * The legacy ffmpeg trim+concat path (lib/exporter.ts) is kept for audio-only
 * exports and as a fast "no effects" fallback.
 */

import type { TimelineItem, Track, VideoAdjustments } from '@/lib/editor-types'
import type { Caption } from '@/lib/types'
import { renderTimelineAudio, toMixClip } from './audio-mix'
import { captureTimeline } from './capture'
import type { CompositorState } from './compositor'

export type FidelityQuality    = 'high' | 'medium' | 'web'
export type FidelityResolution = 'original' | '1080p' | '720p' | '480p'

const RES_DIMS: Record<FidelityResolution, { w: number; h: number }> = {
  original: { w: 1920, h: 1080 },   // v1 assumes 16:9; vertical/social presets are a follow-up
  '1080p':  { w: 1920, h: 1080 },
  '720p':   { w: 1280, h: 720 },
  '480p':   { w: 854,  h: 480 },
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
  quality:       FidelityQuality
  resolution:    FidelityResolution
  range?:        { start: number; end: number } | null
  onProgress:    (frac: number, msg: string) => void
  signal?:       AbortSignal
}

export async function exportTimelineFidelity(input: FidelityExportInput): Promise<Blob> {
  const { timelineItems, tracks, adjustments, captions, quality, resolution, range, onProgress, signal } = input

  const items = timelineItems.filter(i => i.enabled !== false)
  const timelineEnd = items.reduce((m, i) => Math.max(m, i.startTime + (i.outPoint - i.inPoint)), 0)
  const start = range ? Math.max(0, range.start) : 0
  const end   = range ? Math.min(timelineEnd, range.end) : timelineEnd
  const windowDur = Math.max(0, end - start)
  if (windowDur <= 0) throw new Error('Nothing to export in the selected range.')

  const { w, h } = RES_DIMS[resolution]
  const state: CompositorState = { items, tracks, adjustments, captions, width: w, height: h }

  // 1. Offline audio mix (faster than real time) — 2%…30%.
  onProgress(0.02, 'Mixing audio…')
  const audio = await renderTimelineAudio(
    items.map(toMixClip), tracks, timelineEnd,
    f => onProgress(0.02 + f * 0.28, 'Mixing audio…'),
  )
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')

  // 2. Real-time composite + capture — 30%…100% (dominates wall-clock).
  const blob = await captureTimeline({
    state,
    totalDur: windowDur,
    startOffset: start,
    fps: 30,
    videoBitsPerSecond: bitrateFor(quality, w, h),
    audioBuffer: audio,
    onProgress: (f, msg) => onProgress(0.3 + f * 0.7, msg),
    signal,
  })
  onProgress(1, 'Export complete!')
  return blob
}

export { RES_DIMS }
