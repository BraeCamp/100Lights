/**
 * The metronome: what it sounds like, how often it clicks, and when.
 *
 * A click you cannot hear over what you are playing is worse than no click at
 * all — you drift, and you do not know you are drifting. Which sound cuts
 * through depends entirely on the music: a sine ping disappears under a hi-hat
 * pattern, a wood block disappears under an acoustic kit, and a beep survives
 * both but is unpleasant to sit with for an hour. So the sound is a choice, and
 * the sounds are deliberately different in FREQUENCY BAND rather than in
 * character, because cutting through is a question of which band is free.
 *
 * Every one is synthesised — no samples to load, no request before the first
 * take, and it works offline.
 *
 * One module-level store (the lib/import-settings.ts pattern), persisted in the
 * workspace. These are preferences about how you work, not part of the song:
 * the click is never in the render, so a project that carried its metronome
 * settings would be carrying something nobody could hear.
 */

import { useSyncExternalStore } from 'react'
import { readWorkspace, writeWorkspace } from './editor-workspace'

export type ClickSound = 'click' | 'beep' | 'stick' | 'wood' | 'cowbell' | 'rimshot'
export type ClickRhythm = 'auto' | '1/4' | '1/8' | '1/8T' | '1/16' | '1/16T'

export type MetronomeSettings = {
  sound: ClickSound
  rhythm: ClickRhythm
  /** The click sounds only during a take — silent for ordinary playback. */
  onlyWhileRecording: boolean
  /** Bars of clicks before a take starts. 0 = none. */
  countInBars: number
}

export const METRONOME_DEFAULT: MetronomeSettings = { sound: 'click', rhythm: 'auto', onlyWhileRecording: false, countInBars: 0 }

export const CLICK_SOUNDS: ReadonlyArray<{ id: ClickSound; label: string; hint: string }> = [
  { id: 'click',   label: 'Click',   hint: 'A short high ping. Cuts through most things and stays out of the way.' },
  { id: 'beep',    label: 'Beep',    hint: 'A longer pure tone. The most audible, and the least pleasant to sit with.' },
  { id: 'stick',   label: 'Stick',   hint: 'Two sticks. Broadband, so it survives a busy mix.' },
  { id: 'wood',    label: 'Wood',    hint: 'A wood block — mid, dry, easy on the ear over long sessions.' },
  { id: 'cowbell', label: 'Cowbell', hint: 'Metallic and ringing. Sits above a kit without fighting the hats.' },
  { id: 'rimshot', label: 'Rimshot', hint: 'A rim click: a crack with a little body under it.' },
]

export const CLICK_RHYTHMS: ReadonlyArray<{ id: ClickRhythm; label: string }> = [
  { id: 'auto',  label: 'Auto' },
  { id: '1/4',   label: '1/4' },
  { id: '1/8',   label: '1/8' },
  { id: '1/8T',  label: '1/8T' },
  { id: '1/16',  label: '1/16' },
  { id: '1/16T', label: '1/16T' },
]

export const clickSoundLabel  = (s: ClickSound)  => CLICK_SOUNDS.find(x => x.id === s)?.label ?? 'Click'
export const clickRhythmLabel = (r: ClickRhythm) => CLICK_RHYTHMS.find(x => x.id === r)?.label ?? 'Auto'

/** Under this the beat is too far apart to keep time by; over it, too crowded. */
const AUTO_SUBDIVIDE_BELOW = 90
const AUTO_THIN_ABOVE = 200

/**
 * How far apart the clicks are, in beats.
 *
 * Auto is the reason this is a function rather than a table. At 60 BPM a click
 * a second is nothing to play to — the gap is longer than the phrase you are
 * trying to place inside it — so it subdivides. Above 200 it goes the other way
 * and clicks once a bar, because sixteen clicks a second is a buzz, not a beat.
 */
export function clickBeats(rhythm: ClickRhythm, tempo: number, beatsPerBar = 4): number {
  switch (rhythm) {
    case '1/4':   return 1
    case '1/8':   return 0.5
    case '1/8T':  return 1 / 3
    case '1/16':  return 0.25
    case '1/16T': return 1 / 6
    default:
      if (tempo >= AUTO_THIN_ABOVE) return Math.max(1, beatsPerBar)
      if (tempo <= AUTO_SUBDIVIDE_BELOW) return 0.5
      return 1
  }
}

/**
 * One click, as samples. `accent` is the downbeat — brighter and louder, so a
 * bar has a shape and you can hear where you are without counting.
 *
 * Pure: given a sample rate it always makes the same numbers, so the render
 * suite's determinism guard has nothing to catch here.
 */
export function renderClick(sound: ClickSound, sampleRate: number, accent: boolean): Float32Array {
  const sr = sampleRate
  const secs = sound === 'beep' ? 0.06 : sound === 'cowbell' ? 0.09 : 0.04
  const len = Math.max(1, Math.floor(sr * secs))
  const out = new Float32Array(len)
  // A deterministic noise source: a plain LCG, so "noise" is the same noise on
  // every machine and every run (a bare Math.random here would fail the
  // determinism check the moment a click reached a render).
  let seed = 0x2545f491
  const noise = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return (seed / 0xffffffff) * 2 - 1 }

  for (let i = 0; i < len; i++) {
    const t = i / sr
    let v = 0
    switch (sound) {
      case 'click':
        v = Math.sin(2 * Math.PI * (accent ? 1800 : 900) * t) * Math.exp(-i / (sr * 0.015)) * (accent ? 1 : 0.5)
        break
      case 'beep':
        v = Math.sin(2 * Math.PI * (accent ? 1000 : 800) * t) * Math.exp(-i / (sr * 0.05)) * (accent ? 0.7 : 0.4)
        break
      case 'stick':
        // Broadband crack: noise through a fast decay, with a little pitch on it.
        v = (noise() * 0.8 + Math.sin(2 * Math.PI * (accent ? 2600 : 1900) * t) * 0.2) * Math.exp(-i / (sr * 0.004)) * (accent ? 0.9 : 0.5)
        break
      case 'wood':
        // Two close partials and a short body — a block, not a tone.
        v = (Math.sin(2 * Math.PI * (accent ? 1200 : 800) * t) + Math.sin(2 * Math.PI * (accent ? 1810 : 1210) * t) * 0.5)
          * Math.exp(-i / (sr * 0.012)) * (accent ? 0.55 : 0.32)
        break
      case 'cowbell':
        // The classic pair of detuned squares, rung and damped.
        v = (Math.sign(Math.sin(2 * Math.PI * (accent ? 835 : 587) * t)) + Math.sign(Math.sin(2 * Math.PI * (accent ? 1235 : 845) * t)))
          * 0.5 * Math.exp(-i / (sr * 0.03)) * (accent ? 0.45 : 0.26)
        break
      case 'rimshot':
        // A crack with a little body under it.
        v = (noise() * 0.6 * Math.exp(-i / (sr * 0.002)) + Math.sin(2 * Math.PI * (accent ? 480 : 400) * t) * Math.exp(-i / (sr * 0.02)) * 0.5)
          * (accent ? 1 : 0.6)
        break
    }
    out[i] = v
  }
  return out
}

/**
 * The count-in shown as NEGATIVE bars — "-2.1.1" ticking up to "-1.1.1" and
 * then the song's own first bar.
 *
 * ⚠️ Counting up from zero would be the obvious thing and it is wrong: during a
 * two-bar count-in the display would read 1.1.1 while the song has not started,
 * and the number a player is watching to come in on would be the same number
 * they see once they are already late. Negative bars say the one thing that
 * matters — how many bars until you play.
 *
 * `elapsed` is beats since the count-in began; `total` its whole length.
 * Returns null once the count is over and the song's own position takes back
 * the display.
 */
export function countInPosition(elapsed: number, total: number, beatsPerBar: number): string | null {
  if (!(total > 0) || elapsed >= total) return null
  const bar = beatsPerBar > 0 ? beatsPerBar : 4
  const barsLeft = Math.ceil((total - elapsed) / bar)
  const beatInBar = Math.floor(elapsed % bar) + 1
  return `-${barsLeft}.${beatInBar}.1`
}

/** The settings in words, for hover text and for Light. */
export function describeMetronome(s: MetronomeSettings): string {
  const parts = [`${clickSoundLabel(s.sound)} on ${clickRhythmLabel(s.rhythm).toLowerCase() === 'auto' ? 'auto' : clickRhythmLabel(s.rhythm)}`]
  if (s.onlyWhileRecording) parts.push('only while recording')
  if (s.countInBars > 0) parts.push(`${s.countInBars} bar${s.countInBars > 1 ? 's' : ''} of count-in`)
  return parts.join(', ')
}

// ── Store ────────────────────────────────────────────────────────────────────

let state: MetronomeSettings = METRONOME_DEFAULT
let loaded = false
const listeners = new Set<() => void>()

function load() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  const saved = readWorkspace('metronome', METRONOME_DEFAULT) as Partial<MetronomeSettings>
  state = {
    sound: CLICK_SOUNDS.some(s => s.id === saved.sound) ? saved.sound as ClickSound : 'click',
    rhythm: CLICK_RHYTHMS.some(r => r.id === saved.rhythm) ? saved.rhythm as ClickRhythm : 'auto',
    onlyWhileRecording: saved.onlyWhileRecording === true,
    countInBars: Math.max(0, Math.min(4, Number(saved.countInBars) || 0)),
  }
}

function emit() { for (const l of listeners) l() }
function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } }

export function getMetronomeSettings(): MetronomeSettings { load(); return state }

export function setMetronomeSettings(patch: Partial<MetronomeSettings>): void {
  load()
  state = { ...state, ...patch }
  writeWorkspace('metronome', state)
  emit()
}

export function useMetronomeSettings(): MetronomeSettings {
  return useSyncExternalStore(subscribe, getMetronomeSettings, () => METRONOME_DEFAULT)
}
