// How a session slot answers a press (Live's Launch box, Batch 4.1).
//
// Four modes, and the difference is entirely about WHEN a clip starts and
// stops relative to the hand:
//   • Trigger — press starts it from the top, release does nothing. Fire and
//     forget; pressing a playing clip starts it over.
//   • Gate    — it plays while the button is held and stops when let go.
//   • Toggle  — press alternates: start, then stop. This is what Beacon's
//     slots have always done, so it stays the default; Live's is Trigger.
//   • Repeat  — while held it retriggers every launch-quantization step, so a
//     held pad stutters in time.
//
// Everything here is pure so the engine, the session view, the palette and
// voice agree, and a test can pin the table.

import type { LaunchQuantization, LaunchMode } from './daw-types'

export type { LaunchMode }
export const LAUNCH_MODES: LaunchMode[] = ['trigger', 'gate', 'toggle', 'repeat']
export const DEFAULT_LAUNCH_MODE: LaunchMode = 'toggle'

export const LAUNCH_MODE_LABEL: Record<LaunchMode, string> = {
  trigger: 'Trigger', gate: 'Gate', toggle: 'Toggle', repeat: 'Repeat',
}
export const LAUNCH_MODE_HELP: Record<LaunchMode, string> = {
  trigger: 'Press starts it from the top; letting go does nothing. Pressing again starts it over.',
  gate: 'It plays while you hold, and stops when you let go.',
  toggle: 'Press to start, press again to stop.',
  repeat: 'While you hold it, it starts again every launch-quantization step.',
}

export type LaunchOutcome = 'start' | 'stop' | 'none'

export function modeOf(mode: LaunchMode | undefined): LaunchMode {
  return mode && LAUNCH_MODES.includes(mode) ? mode : DEFAULT_LAUNCH_MODE
}

/** What a press does to a slot that is (or is not) already playing. */
export function onPress(mode: LaunchMode | undefined, playing: boolean): LaunchOutcome {
  return modeOf(mode) === 'toggle' && playing ? 'stop' : 'start'
}

/** What letting go does. Only Gate and Repeat care. */
export function onRelease(mode: LaunchMode | undefined): LaunchOutcome {
  const m = modeOf(mode)
  return m === 'gate' || m === 'repeat' ? 'stop' : 'none'
}

/** Repeat is the one mode that keeps firing while held. */
export function repeats(mode: LaunchMode | undefined): boolean {
  return modeOf(mode) === 'repeat'
}

/** The beats between retriggers in Repeat — the clip's launch quantization, a beat when it has none. */
export function repeatBeats(quant: LaunchQuantization | undefined, barBeats: number): number {
  const bar = barBeats > 0 ? barBeats : 4
  switch (quant) {
    case 'bar': return bar
    case '2bar': return bar * 2
    case '4bar': return bar * 4
    case 'beat': return 1
    // 'none' means launch the instant it is pressed, which is no interval at
    // all — a repeat on that setting would be a machine gun. A beat is the
    // sane floor, and it is what Live's Repeat does with quantization off.
    default: return 1
  }
}

// ── Velocity Amount ──────────────────────────────────────────────────────────

/**
 * How much the velocity of the press reaches the clip's level, 0..1.
 * 0 (the default) ignores velocity entirely — every launch is full level, which
 * is what a mouse click means. At 1 a soft press is proportionally quiet.
 */
export function velocityGain(amount: number | undefined, velocity = 127): number {
  const a = Math.max(0, Math.min(1, amount ?? 0))
  if (a === 0) return 1
  const v = Math.max(0, Math.min(127, velocity)) / 127
  return 1 - a + a * v
}

// ── Legato ───────────────────────────────────────────────────────────────────

/**
 * Legato: the new clip picks up where the playing one had got to instead of
 * starting from its own beginning — how a fill or a variation is swapped in
 * without the groove restarting.
 *
 * `playedSeconds` is how far the outgoing clip had run; the answer is where to
 * start reading the incoming one, wrapped into its length so a short clip
 * lands somewhere sensible against a long one.
 */
export function legatoOffset(playedSeconds: number, newClipSeconds: number): number {
  if (!(newClipSeconds > 0) || !(playedSeconds > 0)) return 0
  return playedSeconds % newClipSeconds
}

/** What the launch settings say, in a line — for the Info View and voice. */
export function describeLaunch(s: { launchMode?: LaunchMode; legatoLaunch?: boolean; velocityAmount?: number }): string {
  const parts = [LAUNCH_MODE_LABEL[modeOf(s.launchMode)]]
  if (s.legatoLaunch) parts.push('legato')
  if (s.velocityAmount) parts.push(`velocity ${Math.round(Math.max(0, Math.min(1, s.velocityAmount)) * 100)}%`)
  return parts.join(', ')
}
