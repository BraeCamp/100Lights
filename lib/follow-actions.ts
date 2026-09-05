// ── What a clip does when its turn is over ──────────────────────────────────
//
// Live's Follow Actions: when a session clip has played for its Follow Action
// Time, it decides what happens next — stop, play again, move on, jump
// somewhere, or hand over to any other clip in the group. Two actions with a
// chance each, so a set of clips can shuffle itself.
//
// What was here before did a third of that and did it only by accident: the
// action fired when a clip went from playing to idle, which for a LOOPING clip
// never happens. So follow actions worked on one-shots and silently did nothing
// on everything else — and looping is the normal state of a session clip.
//
// ⚠️ THE DECISION IS PURE AND THE FIRING IS NOT. Everything here is a function
// of the settings, the grid and a random number, so the shuffle can be tested
// over hundreds of launches without a browser (see follow-actions.test.mjs).
// The engine owns WHEN (lib/daw-engine.ts, _sessionTick) because a follow
// action has to keep working when nobody is looking at the session view.

import type { DawClip } from './daw-types'

export type FollowAction =
  | 'none'      // stay on this clip
  | 'stop'
  | 'again'     // play it from the top
  | 'previous'
  | 'next'
  | 'first'
  | 'last'
  | 'any'       // any clip in the group, this one included
  | 'other'     // any clip in the group EXCEPT this one
  | 'jump'      // a scene named outright

export const FOLLOW_ACTIONS: FollowAction[] = ['none', 'stop', 'again', 'previous', 'next', 'first', 'last', 'any', 'other', 'jump']

export const FOLLOW_LABEL: Record<FollowAction, string> = {
  none: 'Do nothing', stop: 'Stop', again: 'Play again', previous: 'Previous', next: 'Next',
  first: 'First', last: 'Last', any: 'Any', other: 'Any other', jump: 'Jump to…',
}

/**
 * The pair of actions on a clip, and how the choice between them is made.
 *
 * `time` is in beats and defaults to the clip's own length — Live's "Linked".
 * Chances are weights, not percentages: 1 and 3 means the second happens three
 * times as often, which is how somebody actually thinks about it.
 */
export interface FollowSettings {
  a: FollowAction
  b?: FollowAction
  chanceA?: number
  chanceB?: number
  /** Beats before it fires. Absent (or `linked`) means the clip's own length. */
  time?: number
  linked?: boolean
  /** Scene index for 'jump', counting from 0. */
  jumpTo?: number
}

export const DEFAULT_FOLLOW: FollowSettings = { a: 'none', chanceA: 1, chanceB: 0, linked: true }

/** Nothing to do — the commonest case, and worth answering without any work. */
export function isIdle(s: FollowSettings | undefined): boolean {
  if (!s) return true
  const a = s.a ?? 'none', b = s.b ?? 'none'
  const wa = Math.max(0, s.chanceA ?? 1), wb = Math.max(0, s.chanceB ?? 0)
  if (a === 'none' && (b === 'none' || wb === 0)) return true
  return wa === 0 && wb === 0
}

/** How long the clip plays before it decides, in beats. */
export function followBeats(s: FollowSettings | undefined, clipBeats: number): number {
  const fallback = clipBeats > 0 ? clipBeats : 4
  if (!s || s.linked !== false) return fallback
  return s.time != null && s.time > 0 ? s.time : fallback
}

/**
 * Which of the two actions this time. `roll` is 0..1 — passed in rather than
 * taken, so a test can pin it and a render can be deterministic.
 */
export function pickAction(s: FollowSettings, roll: number): FollowAction {
  const a = s.a ?? 'none', b = s.b ?? 'none'
  const wa = Math.max(0, s.chanceA ?? 1), wb = Math.max(0, s.chanceB ?? 0)
  if (wa + wb <= 0) return 'none'
  return roll * (wa + wb) < wa ? a : b
}

/**
 * Where an action lands, given the clips on this track.
 *
 * `filled` is the scene indexes that hold a clip; a follow action never lands
 * on an empty slot, because there would be nothing to play and the track would
 * fall silent while claiming to have moved on.
 *
 * Returns the scene to launch, `'stop'`, or null for "stay as you are".
 */
export function followTarget(
  action: FollowAction,
  from: number,
  filled: readonly number[],
  roll: number,
  jumpTo?: number,
): number | 'stop' | null {
  if (action === 'stop') return 'stop'
  if (action === 'none') return null
  if (action === 'again') return from
  if (!filled.length) return null

  const pickFrom = (pool: readonly number[]) => (pool.length ? pool[Math.min(pool.length - 1, Math.floor(roll * pool.length))] : null)

  switch (action) {
    case 'first': return filled[0]
    case 'last': return filled[filled.length - 1]
    case 'any': return pickFrom(filled)
    case 'other': return pickFrom(filled.filter(i => i !== from)) ?? (filled.length === 1 ? from : null)
    case 'jump': return jumpTo != null && filled.includes(jumpTo) ? jumpTo : null
    case 'next':
    case 'previous': {
      // ⚠️ Around the ends, not off them. A chain of four clips set to Next
      // should keep going round; stopping at the last one turns a loop into a
      // one-shot the fourth time through, which is not what anybody drew.
      const at = filled.indexOf(from)
      if (at < 0) return filled[0]
      const step = action === 'next' ? 1 : -1
      return filled[(at + step + filled.length) % filled.length]
    }
    default: return null
  }
}

/**
 * A clip's follow settings, reading the old single-action fields when the new
 * ones are absent — a project saved before this existed keeps working, and
 * nobody has to migrate anything.
 */
export function followOf(clip: { follow?: FollowSettings; followAction?: string; followActionTime?: number }): FollowSettings | undefined {
  if (clip.follow) return clip.follow
  const legacy = clip.followAction
  if (!legacy || legacy === 'none') return undefined
  const a = (legacy === 'prev' ? 'previous' : legacy === 'random' ? 'any' : legacy) as FollowAction
  return { a, chanceA: 1, chanceB: 0, linked: clip.followActionTime == null, time: clip.followActionTime }
}

/** The scenes on a track that actually hold something. */
export function filledScenes(row: readonly (DawClip | null)[] | undefined): number[] {
  const out: number[] = []
  ;(row ?? []).forEach((c, i) => { if (c && c.active !== false) out.push(i) })
  return out
}

/** What the settings do, in a line — for the slot menu and for voice. */
export function describeFollow(s: FollowSettings | undefined, clipBeats: number): string {
  if (isIdle(s)) return 'no follow action'
  const f = s!
  const when = `after ${+followBeats(f, clipBeats).toFixed(2)} beats`
  const a = FOLLOW_LABEL[f.a ?? 'none'].toLowerCase()
  const wa = Math.max(0, f.chanceA ?? 1), wb = Math.max(0, f.chanceB ?? 0)
  if (!f.b || f.b === 'none' || wb === 0) return `${a} ${when}`
  const pct = Math.round((wa / (wa + wb)) * 100)
  return `${a} ${pct}% of the time, otherwise ${FOLLOW_LABEL[f.b].toLowerCase()}, ${when}`
}
