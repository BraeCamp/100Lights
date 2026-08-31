import type { AutomationLane } from './daw-types'

/**
 * Repair automation points that hold the parameter's VALUE instead of its
 * 0–1 position.
 *
 * ⚠️ This exists because of a bug I shipped. A point is a position — the lane
 * editor stores what the mouse drew and the engine maps it through min/max —
 * and for a while the spoken filter sweep wrote real Hertz into them instead.
 * The engine then computed `min + 12000 × (max − min)`, tens of millions of
 * Hertz, which clamps wide open at both ends: the sweep became a constant and
 * the filter appeared to do nothing.
 *
 * Fixing the code does nothing for a song already saved that way, and a cutoff
 * lane that reads as a flat line never gets better on its own.
 *
 * ⚠️ CONSERVATIVE ON PURPOSE. A point outside 0–1 cannot be a position, so
 * those are unambiguous and are converted back through the lane's own range.
 * Anything already inside 0–1 is left completely alone — a lane drawn by hand
 * is untouched, and a value that is merely unusual is not "corrected" into
 * something the user never asked for. Rewriting somebody's automation is only
 * defensible where the old reading was impossible.
 */
export function repairAutomationPoints(lanes: AutomationLane[]): AutomationLane[] {
  return lanes.map(lane => {
    const span = lane.max - lane.min
    if (!(span > 0) || !lane.points?.length) return lane
    // Only lanes where EVERY point is out of range: a mix of the two means
    // something else is going on and guessing would make it worse.
    const outside = lane.points.filter(pt => pt.value < 0 || pt.value > 1)
    if (!outside.length || outside.length !== lane.points.length) return lane
    const toPosition = (v: number) => {
      const clamped = Math.min(lane.max, Math.max(lane.min, v))
      return lane.curve === 'log' && lane.min > 0
        ? Math.log(clamped / lane.min) / Math.log(lane.max / lane.min)
        : (clamped - lane.min) / span
    }
    return { ...lane, points: lane.points.map(pt => ({ ...pt, value: toPosition(pt.value) })) }
  })
}
