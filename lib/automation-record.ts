/**
 * Automation recording: moving a control while the transport rolls writes the
 * move into its lane.
 *
 * Drawing automation is precise and slow. Recording it is imprecise and fast,
 * and for anything that is a PERFORMANCE — a filter opening across a build, a
 * fader riding a vocal — the imprecise fast one is the right tool, because what
 * you are trying to capture is a gesture and a gesture does not survive being
 * typed in.
 *
 * ⚠️ Touch and latch are not two flavours of the same thing; they answer
 * different questions, and picking the wrong one silently destroys work.
 *
 *   TOUCH writes only while you are holding the control. Let go and the lane
 *   goes back to whatever it already said. That is what you want when you are
 *   fixing one moment in a shape you already like.
 *
 *   LATCH writes while you hold, and then KEEPS the last value all the way to
 *   the end. That is what you want when you are replacing a shape, and it is
 *   also how you wipe eight bars of somebody's careful work by touching a knob
 *   at bar one. So it is never the default.
 *
 * Off is the default and the third real answer: touching a control while
 * automation exists overrides the lane (the existing behaviour) rather than
 * rewriting it. Nothing is destroyed and nothing is recorded.
 *
 * Pure and in beats. The studio decides WHEN to call this; the module decides
 * what the lane should hold afterwards.
 */

import { useSyncExternalStore } from 'react'
import { readWorkspace, writeWorkspace } from './editor-workspace'
import type { AutomationPoint } from './daw-types'

export type ArmMode = 'off' | 'touch' | 'latch'

export const ARM_MODES: ReadonlyArray<{ id: ArmMode; label: string; hint: string }> = [
  { id: 'off',   label: 'Off',   hint: 'Moving a control overrides its automation rather than rewriting it. Nothing is recorded.' },
  { id: 'touch', label: 'Touch', hint: 'Writes while you hold the control, then the lane goes back to what it already said.' },
  { id: 'latch', label: 'Latch', hint: 'Writes while you hold, then keeps the last value to the end of the song. It replaces what was there.' },
]

export const armLabel = (m: ArmMode) => ARM_MODES.find(x => x.id === m)?.label ?? 'Off'
export const armHint = (m: ArmMode) => ARM_MODES.find(x => x.id === m)?.hint ?? ''

/**
 * How close two recorded points have to be before the later one replaces the
 * earlier rather than joining it.
 *
 * A knob drag fires dozens of changes a second, and writing every one would
 * make a lane of a hundred points where a person sees a line — unreadable,
 * unspeakably slow to draw, and impossible to edit afterwards. A sixteenth at
 * 120 BPM is 125 ms, which is finer than any gesture anybody performs.
 */
export const RECORD_GRAIN_BEATS = 0.25

const round = (n: number) => Math.round(n * 1e6) / 1e6

/**
 * The lane's points after a move to `value` at `beat`.
 *
 * Points inside the grain around `beat` are replaced rather than added to, so a
 * drag leaves a line and not a comb. Everything outside is left exactly as it
 * was: recording a move must not disturb a shape somebody drew elsewhere.
 */
export function writeMove(
  points: ReadonlyArray<AutomationPoint>,
  beat: number,
  value: number,
  makeId: () => string,
  grain = RECORD_GRAIN_BEATS,
): AutomationPoint[] {
  const at = round(Math.max(0, beat))
  const v = Math.max(0, Math.min(1, value))
  const kept = points.filter(p => Math.abs(p.beat - at) > grain / 2)
  return [...kept, { id: makeId(), beat: at, value: v }].sort((a, b) => a.beat - b.beat)
}

/**
 * Latch's tail: from `beat` onward the lane holds `value`, and everything that
 * was there is gone.
 *
 * ⚠️ This is the destructive half of the feature, which is why latch is never
 * the default and why the studio says what it did afterwards.
 */
export function latchTail(
  points: ReadonlyArray<AutomationPoint>,
  beat: number,
  value: number,
  makeId: () => string,
): AutomationPoint[] {
  const at = round(Math.max(0, beat))
  const v = Math.max(0, Math.min(1, value))
  const before = points.filter(p => p.beat < at - 1e-6)
  return [...before, { id: makeId(), beat: at, value: v }]
}

/** How many points a latch would destroy — said out loud before it happens. */
export function latchWouldClear(points: ReadonlyArray<AutomationPoint>, beat: number): number {
  return points.filter(p => p.beat >= beat - 1e-6).length
}

/**
 * The lane a parameter-setting action belongs to, or null.
 *
 * ⚠️ Deliberately in one place. There are several ways to move a track's volume
 * (the fader, the mixer strip, voice, a learned command) and several to change
 * an effect parameter, and a recorder that only knew about the fader would look
 * like it worked until somebody used the mixer.
 */
export function recordTargetOf(action: { type: string } & Record<string, unknown>): { trackId: string; parameter: string; value: number } | null {
  if (action.type === 'UPDATE_TRACK') {
    const patch = (action.patch ?? {}) as Record<string, unknown>
    const trackId = String(action.trackId ?? '')
    if (!trackId) return null
    // ⚠️ RAW, in the parameter's own units. A point's value is a 0–1 POSITION
    // and the lane's min/max carry the units, so the conversion belongs to the
    // lane (normalizeForLane) and not to each caller. Getting that wrong is how
    // a filter lane declared 200–18000 Hz ends up set to a fraction of a Hertz.
    if (typeof patch.volume === 'number') return { trackId, parameter: 'volume', value: patch.volume }
    if (typeof patch.pan === 'number') return { trackId, parameter: 'pan', value: patch.pan }
    return null
  }
  if (action.type === 'UPDATE_EFFECT') {
    const params = ((action.patch ?? {}) as { params?: Record<string, unknown> }).params
    const trackId = String(action.trackId ?? '')
    const effectId = String(action.effectId ?? '')
    if (!params || !trackId || !effectId) return null
    // One parameter at a time: a patch that moved two is a preset change, not
    // a gesture, and recording it as one would put two points on one lane.
    const keys = Object.keys(params).filter(k => typeof params[k] === 'number')
    if (keys.length !== 1) return null
    return { trackId, parameter: `fx:${effectId}:${keys[0]}`, value: Number(params[keys[0]]) }
  }
  return null
}

/**
 * A raw parameter value as a 0–1 position in its lane — the exact inverse of
 * what the engine does on the way out (lib/daw-engine.ts), log lanes included.
 * An octave is a ratio, so a log lane's middle is its geometric mean and not
 * its average.
 */
export function normalizeForLane(lane: { min: number; max: number; curve?: 'log' }, raw: number): number {
  if (lane.curve === 'log' && lane.min > 0 && lane.max > lane.min) {
    const v = Math.min(lane.max, Math.max(lane.min, raw))
    return Math.log(v / lane.min) / Math.log(lane.max / lane.min)
  }
  const range = lane.max - lane.min
  if (range === 0) return 0
  return Math.max(0, Math.min(1, (raw - lane.min) / range))
}

/** What was recorded, in words. */
export function describeRecorded(mode: ArmMode, label: string, beat: number, beatsPerBar: number, cleared: number): string {
  const bar = Math.floor(beat / (beatsPerBar > 0 ? beatsPerBar : 4)) + 1
  if (mode === 'latch' && cleared > 0) {
    return `Recorded ${label} at bar ${bar}, and it holds there to the end — ${cleared} later point${cleared === 1 ? '' : 's'} gone.`
  }
  return `Recorded ${label} at bar ${bar}.`
}

// ── Store ────────────────────────────────────────────────────────────────────
//
// A mode, not content: what the arm is set to is about how you are working
// right now, so it lives in the workspace beside the click and the import
// settings rather than in the song.

let state: ArmMode = 'off'
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  const saved = (readWorkspace('automationArm', { mode: 'off' }) as { mode?: string }).mode
  state = ARM_MODES.some(m => m.id === saved) ? saved as ArmMode : 'off'
}

export function getArmMode(): ArmMode { load(); return state }

export function setArmMode(mode: ArmMode): void {
  load()
  state = mode
  writeWorkspace('automationArm', { mode })
  for (const l of listeners) l()
}

export function useArmMode(): ArmMode {
  return useSyncExternalStore(
    l => { listeners.add(l); return () => { listeners.delete(l) } },
    getArmMode,
    () => 'off' as ArmMode,
  )
}
