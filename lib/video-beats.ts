// Deriving timeline snap points from per-audio-clip tempo maps.
//
// Each audio clip can carry a `beatMap` (TempoSeg[]): BPM sections anchored to
// the audio SOURCE time. This module turns those into absolute timeline-second
// beat/bar lines — clipped to each clip's visible window and offset by where the
// clip sits on the timeline — which the ruler renders and the drag/trim/quantize
// logic snaps to. Nothing here consults a linked DAW project: the clip's own map
// is the single source of truth.

import type { TimelineItem, TempoSeg } from './editor-types'

const EPS = 1e-6

/** A single clip's beat & bar lines in TIMELINE seconds (clipped to what's visible). */
export function clipBeatLines(clip: TimelineItem): { beats: number[]; bars: number[] } {
  const map = clip.beatMap
  if (!map || map.length === 0) return { beats: [], bars: [] }

  // Source → timeline: a source time `s` shows at clip.startTime + (s - inPoint)/speed,
  // for s within the clip's visible source window [inPoint, outPoint]. A clip
  // played at 2× compresses its source into half the timeline footprint, so the
  // beat spacing must divide by speed (otherwise ticks run past the clip's end).
  const inPoint = clip.inPoint
  const outPoint = clip.outPoint
  const speed = clip.speed && clip.speed > 0 ? clip.speed : 1
  const toTimeline = (s: number) => clip.startTime + (s - inPoint) / speed

  const segs = [...map].filter(s => s.bpm > 0).sort((a, b) => a.src - b.src)
  const beats: number[] = []
  const bars: number[] = []

  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const nextSrc = i + 1 < segs.length ? segs[i + 1].src : Infinity
    const bpb = Math.max(1, Math.round(seg.beatsPerBar ?? 4))
    const spb = 60 / Math.max(1, seg.bpm)          // seconds per beat
    const rangeStart = Math.max(seg.src, inPoint)  // visible source range for this segment
    const rangeEnd = Math.min(nextSrc, outPoint)
    if (rangeEnd <= rangeStart + EPS) continue

    // First beat index (counted from the segment's own src) that lands in-range.
    let k = Math.ceil((rangeStart - seg.src) / spb - EPS)
    if (k < 0) k = 0
    for (; ; k++) {
      const s = seg.src + k * spb
      if (s >= rangeEnd - EPS) break
      if (s < rangeStart - EPS) continue
      const t = toTimeline(s)
      beats.push(t)
      if (((k % bpb) + bpb) % bpb === 0) bars.push(t)
      if (beats.length > 8000) return { beats, bars }  // safety valve
    }
  }
  return { beats, bars }
}

const dedupeSorted = (arr: number[]): number[] => {
  const seen = new Set<number>()
  const out: number[] = []
  for (const v of arr) {
    const key = Math.round(v * 1000)
    if (!seen.has(key)) { seen.add(key); out.push(v) }
  }
  return out.sort((a, b) => a - b)
}

/** Union of every clip's beat/bar lines across the timeline (deduped + sorted). */
export function projectBeatLines(items: TimelineItem[]): { beats: number[]; bars: number[] } {
  const beats: number[] = []
  const bars: number[] = []
  for (const it of items) {
    if (!it.beatMap || it.beatMap.length === 0) continue
    const { beats: b, bars: ba } = clipBeatLines(it)
    beats.push(...b)
    bars.push(...ba)
  }
  return { beats: dedupeSorted(beats), bars: dedupeSorted(bars) }
}

/** Nearest value in a sorted array (binary search). null if empty. */
export function nearestSorted(sorted: number[], t: number): number | null {
  const n = sorted.length
  if (n === 0) return null
  let lo = 0, hi = n - 1
  if (t <= sorted[0]) return sorted[0]
  if (t >= sorted[hi]) return sorted[hi]
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (sorted[mid] === t) return sorted[mid]
    if (sorted[mid] < t) lo = mid + 1
    else hi = mid - 1
  }
  // lo = first index with value > t; hi = lo - 1
  const a = sorted[hi], b = sorted[lo]
  return (t - a) <= (b - t) ? a : b
}

/**
 * Convert a bar number (1-based, counting from the previous segment's downbeat)
 * into a source time, using the immediately-preceding segment's tempo. Used by
 * the beat-map editor when the user anchors a new tempo section "at bar N".
 */
export function barToSrc(prev: TempoSeg, bar: number): number {
  const bpb = Math.max(1, Math.round(prev.beatsPerBar ?? 4))
  const spb = 60 / Math.max(1, prev.bpm)
  return prev.src + Math.max(0, bar - 1) * bpb * spb
}
