// Loop/Warp Short Samples and Auto-Warp Long Samples (Live's Record/Warp/
// Launch preferences): what a sample becomes when it LANDS — dropped from the
// library, imported as a file, placed by voice. A short sample is a one-shot
// (unwarped, played once at its own speed) or a loop (warped, looping, a whole
// number of bars at a Seg BPM that makes it so); Auto looks at the length and
// decides. A long sample is warped straight at the song tempo when Auto-Warp
// is on — it plays at its own speed and follows later tempo changes; off, it
// plays as is.
//
// One module-level store (the lib/display-settings.ts pattern), persisted in
// the workspace, read by the landing sites (lib/daw-audio-import.ts, the
// library drops in TrackRow, VoiceControl's "use the sample"), the Appearance
// panel's "Warp & Import" section, the ⌘K palette and voice (import_settings).
// A sample with remembered settings (Save Default Clip, lib/clip-defaults.ts)
// keeps those instead: a saved default is a decision about THAT sample.

import { useSyncExternalStore } from 'react'
import { readWorkspace, writeWorkspace } from './editor-workspace'
import type { AudioClip } from './daw-types'
import { warpAsLoop } from './warp'
import { beatsAtSegBpm } from './sample-editor'
import { clipDefaultsFor, clipDefaultsKey } from './clip-defaults'

export type ShortSampleMode = 'oneshot' | 'auto' | 'loop'
export type ImportSettings = { shortSamples: ShortSampleMode; autoWarpLong: boolean }

export const IMPORT_DEFAULT: ImportSettings = { shortSamples: 'auto', autoWarpLong: true }
export const SHORT_SAMPLE_MODES: ShortSampleMode[] = ['oneshot', 'auto', 'loop']
export const SHORT_SAMPLE_LABEL: Record<ShortSampleMode, string> = { oneshot: 'Unwarped one-shot', auto: 'Auto', loop: 'Warped loop' }

/** At least this long is a "long sample" — a song or a stem, not a hit or a loop. */
export const LONG_SAMPLE_SEC = 30
/** Auto calls a short sample a loop when it is within this fraction of a bar of a whole number of bars. */
export const LOOP_TOLERANCE = 0.08
export const MAX_LOOP_BARS = 16
/** …and only when the Seg BPM that makes it whole bars is a plausible loop tempo. */
export const LOOP_BPM_MIN = 60
export const LOOP_BPM_MAX = 200

// ── Store ────────────────────────────────────────────────────────────────────

let state: ImportSettings = IMPORT_DEFAULT
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  const saved = readWorkspace('importSettings', IMPORT_DEFAULT) as Partial<ImportSettings>
  state = {
    shortSamples: SHORT_SAMPLE_MODES.includes(saved.shortSamples as ShortSampleMode) ? (saved.shortSamples as ShortSampleMode) : 'auto',
    autoWarpLong: saved.autoWarpLong !== false,
  }
}

function emit() { for (const l of listeners) l() }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }

export function getImportSettings(): ImportSettings { load(); return state }

export function setImportSettings(patch: Partial<ImportSettings>): void {
  load()
  state = { ...state, ...patch }
  writeWorkspace('importSettings', state)
  emit()
}

export function useImportSettings(): ImportSettings {
  return useSyncExternalStore(subscribe, getImportSettings, () => IMPORT_DEFAULT)
}

// ── The decision ─────────────────────────────────────────────────────────────

export interface LoopGuess { bars: number; segBpm: number; error: number }

/**
 * Does a length look like a loop at this tempo? The nearest whole bar count,
 * the sample tempo that makes it exactly that, and how far off a whole bar
 * the length is (a fraction of a bar).
 */
export function loopGuess(seconds: number, tempo: number, barBeats: number): LoopGuess | null {
  if (!(seconds > 0) || !(tempo > 0) || !(barBeats > 0)) return null
  const barSec = (barBeats * 60) / tempo
  const bars = Math.max(1, Math.round(seconds / barSec))
  const error = Math.abs(seconds / barSec - bars)
  const segBpm = Math.round(((bars * barBeats) / seconds) * 60 * 100) / 100
  return { bars, segBpm, error }
}

export type Landing = 'oneshot' | 'loop' | 'straight'

/** How a sample of this length lands under the settings. */
export function landingFor(seconds: number, tempo: number, barBeats: number, s: ImportSettings): Landing {
  if (seconds >= LONG_SAMPLE_SEC) return s.autoWarpLong ? 'straight' : 'oneshot'
  if (s.shortSamples === 'oneshot') return 'oneshot'
  if (s.shortSamples === 'loop') return 'loop'
  const g = loopGuess(seconds, tempo, barBeats)
  if (!g || g.bars > MAX_LOOP_BARS || g.error > LOOP_TOLERANCE) return 'oneshot'
  if (g.segBpm < LOOP_BPM_MIN || g.segBpm > LOOP_BPM_MAX) return 'oneshot'
  return 'loop'
}

export interface LandingPlan { landing: Landing; patch: Partial<AudioClip> }

/**
 * The clip fields a freshly landed sample gets, for its decoded length.
 * One-shot: the sample's own seconds at the song tempo, warp and loop off.
 * Loop: whole bars, warped as that loop (two markers, lib/warp.ts), looping,
 * the Seg BPM that makes it so. Straight: the sample's seconds, warped with no
 * markers — the engine's straight map — so it follows tempo changes.
 */
export function landingPlan(seconds: number, tempo: number, barBeats: number, s: ImportSettings = getImportSettings()): LandingPlan {
  const bpm = tempo > 0 ? tempo : 120
  const bar = barBeats > 0 ? barBeats : 4
  const landing = landingFor(seconds, bpm, bar, s)
  const nativeBeats = Math.max(0.125, (seconds * bpm) / 60)
  if (landing === 'loop') {
    const g = loopGuess(seconds, bpm, bar)!
    return { landing, patch: { durationBeats: g.bars * bar, warpEnabled: true, loopEnabled: true, segBpm: g.segBpm, warpMarkers: warpAsLoop(0, seconds, g.bars, bar) } }
  }
  if (landing === 'straight') return { landing, patch: { durationBeats: nativeBeats, warpEnabled: true, loopEnabled: false, segBpm: bpm } }
  return { landing, patch: { durationBeats: nativeBeats, warpEnabled: false, loopEnabled: false } }
}

/**
 * The patch for THIS clip's landing: its remembered defaults win when it has
 * them (only the length is filled in, at the remembered Seg BPM if any);
 * otherwise the settings decide.
 */
export function landClip(clip: Pick<AudioClip, 'libraryId' | 'r2Key' | 'audioUrl'>, seconds: number, tempo: number, barBeats: number, s: ImportSettings = getImportSettings()): LandingPlan {
  const remembered = clipDefaultsFor(clipDefaultsKey(clip))
  if (remembered) {
    const beats = remembered.segBpm ? beatsAtSegBpm(seconds, remembered.segBpm) : (seconds * (tempo > 0 ? tempo : 120)) / 60
    return { landing: remembered.loopEnabled ? 'loop' : remembered.warpEnabled ? 'straight' : 'oneshot', patch: { durationBeats: Math.max(0.125, beats) } }
  }
  return landingPlan(seconds, tempo, barBeats, s)
}

export function describeLanding(plan: LandingPlan, barBeats: number): string {
  const p = plan.patch
  if (plan.landing === 'loop') {
    const bars = (p.durationBeats ?? 0) / (barBeats > 0 ? barBeats : 4)
    return `${+bars.toFixed(2)}-bar loop at ${p.segBpm} BPM`
  }
  if (plan.landing === 'straight') return 'warped straight at the song tempo'
  return 'one-shot, at its own speed'
}

export function describeImportSettings(s: ImportSettings): string {
  return `short samples: ${SHORT_SAMPLE_LABEL[s.shortSamples].toLowerCase()}; long samples ${s.autoWarpLong ? 'auto-warped' : 'left as they are'}`
}
