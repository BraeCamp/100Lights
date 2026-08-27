// ── Comping: take management engine ──────────────────────────────────────────
//
// "Comping" = loop-recording multiple takes and selecting the best phrases
// from each. At any point in time, at most one take's region is active.

export const TAKE_COLORS: string[] = [
  '#7c3aed', '#2563eb', '#059669', '#d97706',
  '#dc2626', '#ec4899', '#0891b2', '#f97316',
]

// ── Core types ───────────────────────────────────────────────────────────────

export interface TakeRegion {
  id: string
  startTime: number   // within the clip, seconds from clip start (0 = loop start)
  endTime: number
  selected: boolean
}

export interface Take {
  id: string
  index: number        // take number (1, 2, 3…)
  clipId: string       // reference to AudioClip in the main clips array
  recordedAt: number   // Date.now() timestamp
  color: string        // auto-assigned from TAKE_COLORS
  active: boolean      // whether this take is currently "selected" (active in the comp)
  regions: TakeRegion[] // time ranges of this take selected for the comp
}

export interface CompGroup {
  id: string
  laneType: string
  loopStart: number
  loopEnd: number
  takes: Take[]
}

// ── Region helpers ────────────────────────────────────────────────────────────

/** Sort + merge adjacent regions with the same `selected` state. */
export function normalizeRegions(regions: TakeRegion[]): TakeRegion[] {
  if (regions.length === 0) return []
  const sorted = [...regions].sort((a, b) => a.startTime - b.startTime)
  const result: TakeRegion[] = []
  for (const r of sorted) {
    if (r.endTime - r.startTime < 1e-9) continue   // skip zero-length
    const last = result[result.length - 1]
    if (last && last.selected === r.selected && last.endTime >= r.startTime - 1e-9) {
      last.endTime = Math.max(last.endTime, r.endTime)
    } else {
      result.push({ ...r })
    }
  }
  return result
}

/**
 * Paint [paintStart, paintEnd] as `selected` in the regions array.
 * Assumes regions are normalized and cover [0, loopDuration] completely.
 */
export function paintRegion(
  regions: TakeRegion[],
  paintStart: number,
  paintEnd: number,
  selected: boolean,
): TakeRegion[] {
  if (paintEnd <= paintStart) return regions
  const result: TakeRegion[] = []
  for (const r of regions) {
    if (r.endTime <= paintStart || r.startTime >= paintEnd) {
      // No overlap — keep as-is
      result.push({ ...r })
    } else {
      // Left remainder
      if (r.startTime < paintStart) {
        result.push({ ...r, endTime: paintStart })
      }
      // Overlapping portion
      result.push({
        id: crypto.randomUUID(),
        startTime: Math.max(r.startTime, paintStart),
        endTime:   Math.min(r.endTime, paintEnd),
        selected,
      })
      // Right remainder
      if (r.endTime > paintEnd) {
        result.push({ ...r, id: crypto.randomUUID(), startTime: paintEnd })
      }
    }
  }
  return normalizeRegions(result)
}

