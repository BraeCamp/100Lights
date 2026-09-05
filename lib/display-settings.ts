// Display settings: how the studio is laid out and sized, as distinct from
// what colour it is (lib/workshop-theme) and which controls show
// (lib/ui-tiers). One module-level store (the lib/perf-mode pattern),
// persisted in the workspace, read by the components, the ⌘K palette and
// the Appearance panel's "Display & Input" section.
//
// `clipEditor`: where a MIDI clip's notes are edited. 'pane' is Live's way —
// the clip pane at the bottom of the screen, following the selection;
// 'inline' is the way Beacon grew up — the roll unfolds under the track.
// Both stay for a release so nobody's hands are broken overnight; the plan
// retires inline after that.

import { useSyncExternalStore } from 'react'
import { readWorkspace, writeWorkspace } from './editor-workspace'

export type ClipEditorPlace = 'pane' | 'inline'

/** What the mixer under the arrangement shows (Live's mixer section drop-down). */
export type MixerSection = 'mixer' | 'sends' | 'returns' | 'inout' | 'options' | 'crossfader' | 'performance'
export const MIXER_SECTIONS: MixerSection[] = ['mixer', 'sends', 'returns', 'inout', 'options', 'crossfader', 'performance']

export type DisplaySettings = {
  clipEditor: ClipEditorPlace
  /** UI scale, 50–200 (percent). Applied through the root font size, never CSS zoom. */
  uiScale: number
  /** The mixer row under the arrangement: shown or not, and which section. */
  arrangementMixer: { open: boolean; section: MixerSection }
}

export const DISPLAY_DEFAULT: DisplaySettings = { clipEditor: 'pane', uiScale: 100, arrangementMixer: { open: false, section: 'mixer' } }

export const UI_SCALE_MIN = 50
export const UI_SCALE_MAX = 200
export const UI_SCALE_STEP = 10

/** A scale clamped to the range and snapped to the step. */
export function clampUiScale(pct: number): number {
  if (!Number.isFinite(pct)) return 100
  const snapped = Math.round(pct / UI_SCALE_STEP) * UI_SCALE_STEP
  return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, snapped))
}

let state: DisplaySettings = DISPLAY_DEFAULT
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  const saved = readWorkspace('display', DISPLAY_DEFAULT)
  const am = (saved as Partial<DisplaySettings>).arrangementMixer
  state = {
    clipEditor: saved.clipEditor === 'inline' ? 'inline' : 'pane',
    uiScale: clampUiScale(Number(saved.uiScale)),
    arrangementMixer: { open: am?.open === true, section: MIXER_SECTIONS.includes(am?.section as MixerSection) ? (am!.section as MixerSection) : 'mixer' },
  }
}

function emit() { for (const l of listeners) l() }

export function displaySettings(): DisplaySettings {
  load()
  return state
}

export function setDisplay(patch: Partial<DisplaySettings>): DisplaySettings {
  load()
  state = { ...state, ...patch, ...(patch.uiScale != null ? { uiScale: clampUiScale(patch.uiScale) } : {}) }
  writeWorkspace('display', state)
  emit()
  return state
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** Reactive display settings. SSR-safe (defaults on the server). */
export function useDisplaySettings(): DisplaySettings {
  return useSyncExternalStore(subscribe, displaySettings, () => DISPLAY_DEFAULT)
}
