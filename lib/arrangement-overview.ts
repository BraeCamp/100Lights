// The overview strip's arithmetic (Live's Arrangement Overview): a minimap of
// the whole song with a box over the part on screen. Drag the box to scroll,
// drag its edges to zoom, click outside it to jump, double-click to fit.
// Pure, so the mapping between minimap pixels and song beats is tested
// without a browser; the component (components/editor/daw/ArrangementOverview.tsx)
// draws and listens.

export interface OverviewFrame {
  /** Beats the strip spans — the song, with a little room at the end. */
  songBeats: number
  /** Minimap pixels per beat. */
  pxPerBeat: number
}

/** How many beats the strip shows: the song end, at least 32, plus a bar of air. */
export function overviewSpan(lastClipEnd: number, beatsPerBar = 4, minBeats = 32): number {
  return Math.max(minBeats, Math.ceil(lastClipEnd / beatsPerBar) * beatsPerBar + beatsPerBar)
}

export function overviewFrame(lastClipEnd: number, width: number, beatsPerBar = 4): OverviewFrame {
  const songBeats = overviewSpan(lastClipEnd, beatsPerBar)
  return { songBeats, pxPerBeat: width > 0 ? width / songBeats : 0 }
}

/** The zoom box, in minimap pixels, for the arrangement's current view. */
export function zoomBox(frame: OverviewFrame, scrollLeft: number, viewWidth: number, beatW: number): { x: number; w: number } {
  const firstBeat = Math.max(0, scrollLeft / beatW)
  const visibleBeats = viewWidth / beatW
  const x = firstBeat * frame.pxPerBeat
  const w = Math.max(6, visibleBeats * frame.pxPerBeat)
  return { x, w }
}

/** Arrangement scrollLeft that puts the view's first beat under minimap x. */
export function scrollForBoxX(frame: OverviewFrame, x: number, beatW: number, minScroll: number): number {
  const beat = Math.max(0, x / (frame.pxPerBeat || 1))
  return Math.max(minScroll, beat * beatW)
}

/** Arrangement scrollLeft that centres the view on minimap x. */
export function scrollToCentreOn(frame: OverviewFrame, x: number, viewWidth: number, beatW: number, minScroll: number): number {
  const beat = Math.max(0, x / (frame.pxPerBeat || 1))
  return Math.max(minScroll, beat * beatW - viewWidth / 2)
}

/** beatW that makes a box `boxW` minimap pixels wide cover the whole view. */
export function beatWForBox(frame: OverviewFrame, boxW: number, viewWidth: number, minBeatW: number, maxBeatW: number): number {
  const beats = Math.max(1e-6, boxW / (frame.pxPerBeat || 1))
  return Math.min(maxBeatW, Math.max(minBeatW, viewWidth / beats))
}

/** Where a pointer at minimap x sits relative to the box: an edge to drag, the inside, or outside. */
export function hitZone(x: number, box: { x: number; w: number }, grip = 5): 'left' | 'right' | 'inside' | 'outside' {
  if (Math.abs(x - box.x) <= grip) return 'left'
  if (Math.abs(x - (box.x + box.w)) <= grip) return 'right'
  if (x > box.x && x < box.x + box.w) return 'inside'
  return 'outside'
}

// ── Follow ────────────────────────────────────────────────────────────────

export type FollowMode = 'off' | 'page' | 'scroll'
export const FOLLOW_MODES: FollowMode[] = ['off', 'page', 'scroll']

/**
 * The scrollLeft that keeps the playhead on screen. 'scroll' keeps it at a
 * third of the way in, gliding; 'page' leaves the view alone until the
 * playhead runs off the right edge, then jumps a page so the playhead lands
 * near the left — the way tape-style DAWs do, and the cheaper one to watch.
 * null means "leave the scroll where it is".
 */
export function followScroll(mode: FollowMode, beat: number, scrollLeft: number, viewWidth: number, beatW: number, minScroll: number): number | null {
  if (mode === 'off' || viewWidth <= 0) return null
  const px = beat * beatW
  if (mode === 'scroll') return Math.max(minScroll, px - viewWidth * 0.33)
  const first = scrollLeft, last = scrollLeft + viewWidth
  if (px >= first + 2 && px <= last - 2) return null
  return Math.max(minScroll, px - viewWidth * 0.1)
}

/** Track heights that fill a viewport of `height` px with `count` tracks, never below `min`. */
export function fitHeights(height: number, count: number, min = 32, max = 400): number {
  if (count <= 0) return min
  return Math.max(min, Math.min(max, Math.floor(height / count)))
}

/** A peak (0..1 amplitude) on a dB scale over `range` dB, 0..1. */
export function peakToDb(amp: number, range = 60): number {
  if (!(amp > 0)) return 0
  return Math.max(0, Math.min(1, 1 + (20 * Math.log10(amp)) / range))
}
