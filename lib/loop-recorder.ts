// ── Loop recorder: auto-group takes into CompGroups ──────────────────────────
//
// Called after each loop-recorded take completes. Groups clips by lane + loop
// region, assigns take indices/colors, and auto-selects the new take.

import type { CompGroup, Take } from './comping'
import { TAKE_COLORS, normalizeRegions } from './comping'

interface ClipMin {
  id: string
  laneType: string
}

/**
 * Add `newClip` as a new take to the appropriate CompGroup.
 *
 * - Creates a new CompGroup when none exists for this lane + loop region.
 * - Auto-assigns take index and color.
 * - Auto-selects the entire new take (so the latest take is always heard).
 * - Deselects all regions in previous takes (new take wins everywhere).
 *
 * @returns Updated groups array (immutable update).
 */
export function addTakeToGroup(
  groups: CompGroup[],
  newClip: ClipMin,
  loopStart: number,
  loopEnd: number,
): CompGroup[] {
  const loopDuration = loopEnd - loopStart

  // Match existing group by lane type + loop region (within 10 ms tolerance)
  const existing = groups.find(
    g =>
      g.laneType === newClip.laneType &&
      Math.abs(g.loopStart - loopStart) < 0.01 &&
      Math.abs(g.loopEnd - loopEnd) < 0.01,
  )

  const newIndex = existing ? existing.takes.length + 1 : 1
  const color = TAKE_COLORS[(newIndex - 1) % TAKE_COLORS.length]

  const newTake: Take = {
    id: crypto.randomUUID(),
    index: newIndex,
    clipId: newClip.id,
    recordedAt: Date.now(),
    color,
    active: true,
    regions: [
      { id: crypto.randomUUID(), startTime: 0, endTime: loopDuration, selected: true },
    ],
  }

  if (!existing) {
    const group: CompGroup = {
      id: crypto.randomUUID(),
      laneType: newClip.laneType,
      loopStart,
      loopEnd,
      takes: [newTake],
    }
    return [...groups, group]
  }

  // Deselect all regions in existing takes — new take takes full priority
  const updatedTakes = existing.takes.map(t => ({
    ...t,
    regions: normalizeRegions(t.regions.map(r => ({ ...r, selected: false }))),
  }))

  return groups.map(g =>
    g.id === existing.id
      ? { ...g, takes: [...updatedTakes, newTake] }
      : g,
  )
}
