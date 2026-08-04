// ── Region-of-interest track ─────────────────────────────────────────────────
// A time-stamped list of the active UI panel's rect in capture-pixel space, so a
// downstream tool can crop 16:9 → 9:16 without guessing where the action is.

import { MAX_ROI_GAP_S } from './config.mjs'

/** A full-frame rect — the safe default a consumer crops to when nothing else
 *  is known. Emitted as roi_fallback so gaps are never a guess. */
export function fullFrameRect(capture, panel = 'full') {
  return { x: 0, y: 0, w: capture?.width ?? 0, h: capture?.height ?? 0, panel }
}

/** Windows of time (seconds) with no ROI entry, longer than maxGap. A leading
 *  gap (before the first entry) and a trailing gap (to `durationS`) both count. */
export function roiGaps(roi, durationS, maxGap = MAX_ROI_GAP_S) {
  const pts = roi.filter(r => typeof r?.t === 'number').map(r => r.t).sort((a, b) => a - b)
  const gaps = []
  let prev = 0
  for (const t of pts) {
    if (t - prev > maxGap) gaps.push([+prev.toFixed(3), +t.toFixed(3)])
    prev = Math.max(prev, t)
  }
  if (durationS - prev > maxGap) gaps.push([+prev.toFixed(3), +durationS.toFixed(3)])
  return gaps
}

/** Coverage is satisfied when a fallback rect exists (it fills every gap), or
 *  when there are no gaps longer than maxGap. */
export function roiIsCovered(roi, durationS, fallback, maxGap = MAX_ROI_GAP_S) {
  if (fallback) return true
  return roiGaps(roi, durationS, maxGap).length === 0
}

/** Map a panel's CSS-pixel rect into capture-pixel space (best-effort, assumes a
 *  tab/viewport capture with no offset — the fallback rect covers the rest). */
export function panelRectToCapture(rect, viewport, capture) {
  const sx = capture?.width && viewport?.width ? capture.width / viewport.width : 1
  const sy = capture?.height && viewport?.height ? capture.height / viewport.height : 1
  return {
    x: Math.round((rect.x ?? rect.left ?? 0) * sx),
    y: Math.round((rect.y ?? rect.top ?? 0) * sy),
    w: Math.round((rect.width ?? 0) * sx),
    h: Math.round((rect.height ?? 0) * sy),
  }
}
