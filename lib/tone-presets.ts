// Per-instrument TONE presets — curated sound-setting starting points ("Metal",
// "Rock", "Punk", …) that layer on top of a sampled instrument. A tone is just a
// RollFx bag applied to a clip's sound settings, so it stays fully editable with
// the same sliders afterward. Tones are offered by the instrument's family
// (MidiPreset.group), with a sensible default bank for families without a
// dedicated one, so every instrument shows a few flavour options.

import type { RollFx } from './daw-types'

export interface TonePreset {
  name: string
  fx: RollFx
}

// Level/length keys the player sets independently of the tonal character — kept
// when switching tones so picking "Metal" doesn't reset a note's volume or release.
const PRESERVE_KEYS: (keyof RollFx)[] = ['gain', 'pan', 'sustain']

// Drive values assume the gentle soft-clip curve (drive is subtle at low
// settings), so grittier tones sit higher up the slider than you'd expect.

const GUITAR: TonePreset[] = [
  { name: 'Clean',  fx: { reverbWet: 0.16 } },
  { name: 'Funk',   fx: { drive: 0.25, filterHz: 6000, treble: 2, mid: 1 } },
  { name: 'Blues',  fx: { drive: 0.4,  bass: 2, mid: 1, reverbWet: 0.12 } },
  { name: 'Rock',   fx: { drive: 0.62, mid: 2, reverbWet: 0.08 } },
  { name: 'Punk',   fx: { drive: 0.75, treble: 3, bass: -1 } },
  { name: 'Metal',  fx: { drive: 0.9, distortion: 0.3, mid: -3, bass: 3, treble: 2, filterHz: 9000 } },
]

const BASS: TonePreset[] = [
  { name: 'Fingered', fx: { bass: 3, reverbWet: 0.04 } },
  { name: 'Pick',     fx: { drive: 0.3, treble: 2, mid: 1 } },
  { name: 'Driven',   fx: { drive: 0.6, bass: 2 } },
  { name: 'Sub',      fx: { bass: 5, filterHz: 2500, treble: -3 } },
  { name: 'Synth',    fx: { drive: 0.35, filterHz: 4500, sub: 3 } },
]

const SYNTH: TonePreset[] = [
  { name: 'Warm',   fx: { filterHz: 6000, reverbWet: 0.15, bass: 1 } },
  { name: 'Bright', fx: { treble: 3, reverbWet: 0.1 } },
  { name: 'Hard',   fx: { drive: 0.6, treble: 2 } },
  { name: 'Dreamy', fx: { reverbWet: 0.5, reverbSize: 0.75, chorusDepth: 0.35 } },
  { name: 'Pluck',  fx: { decay: 0.35, sustainLevel: 0.15, filterHz: 7000 } },
]

const KEYS: TonePreset[] = [
  { name: 'Concert', fx: { reverbWet: 0.22, reverbSize: 0.6 } },
  { name: 'Warm',    fx: { treble: -2, bass: 1, reverbWet: 0.12 } },
  { name: 'Bright',  fx: { treble: 3, reverbWet: 0.08 } },
  { name: 'Lo-fi',   fx: { filterHz: 3800, bitcrush: 0.18, reverbWet: 0.1 } },
]

const ORGAN: TonePreset[] = [
  { name: 'Gospel',  fx: { reverbWet: 0.3, reverbSize: 0.7 } },
  { name: 'Rock',    fx: { drive: 0.6, mid: 2 } },
  { name: 'Vibrato', fx: { vibratoDepth: 0.35, vibratoRate: 6, reverbWet: 0.1 } },
]

const STRINGS: TonePreset[] = [
  { name: 'Tight',     fx: { attack: 0.04, reverbWet: 0.12 } },
  { name: 'Lush',      fx: { reverbWet: 0.42, reverbSize: 0.7, attack: 0.25 } },
  { name: 'Cinematic', fx: { reverbWet: 0.55, reverbSize: 0.9, attack: 0.5, bass: 2 } },
]

const BRASS: TonePreset[] = [
  { name: 'Mellow', fx: { treble: -2, reverbWet: 0.2, attack: 0.06 } },
  { name: 'Bold',   fx: { drive: 0.3, mid: 2, reverbWet: 0.12 } },
  { name: 'Punchy', fx: { drive: 0.45, attack: 0.02, treble: 2 } },
]

const DEFAULT_TONES: TonePreset[] = [
  { name: 'Clean',  fx: { reverbWet: 0.12 } },
  { name: 'Warm',   fx: { treble: -2, bass: 1, reverbWet: 0.12 } },
  { name: 'Bright', fx: { treble: 3 } },
  { name: 'Spacey', fx: { reverbWet: 0.45, reverbSize: 0.7 } },
  { name: 'Lo-fi',  fx: { filterHz: 3500, bitcrush: 0.15 } },
]

// Keyed by MidiPreset.group (see PRESET_GROUPS in midi-presets.ts).
const BY_GROUP: Record<string, TonePreset[]> = {
  Guitar: GUITAR,
  Bass: BASS,
  Synth: SYNTH,
  Piano: KEYS,
  Mallets: KEYS,
  Organ: ORGAN,
  Strings: STRINGS,
  Brass: BRASS,
}

/** The tone bank for an instrument family, falling back to a generic set. */
export function tonesForGroup(group: string | undefined): TonePreset[] {
  return (group && BY_GROUP[group]) || DEFAULT_TONES
}

/** Apply a tone to a clip's current sound settings — replaces the tonal
 *  character, keeps the player-set volume / pan / release. Returns undefined
 *  when the result is empty (so the clip drops back to its bare preset). */
export function applyTone(current: RollFx | undefined, tone: TonePreset): RollFx | undefined {
  const keep: RollFx = {}
  for (const k of PRESERVE_KEYS) {
    const v = current?.[k]
    if (v !== undefined) keep[k] = v
  }
  const next: RollFx = { ...tone.fx, ...keep }
  return Object.keys(next).length ? next : undefined
}

/** Is this tone the one currently dialled in? (ignores the preserved level keys,
 *  so a volume tweak doesn't drop the highlight.) */
export function toneMatches(current: RollFx | undefined, tone: TonePreset): boolean {
  const cur: RollFx = { ...(current ?? {}) }
  for (const k of PRESERVE_KEYS) delete cur[k]
  const keys = new Set<string>([...Object.keys(cur), ...Object.keys(tone.fx)])
  for (const k of keys) {
    const av = cur[k as keyof RollFx]
    const bv = tone.fx[k as keyof RollFx]
    if (typeof av === 'number' && typeof bv === 'number') {
      if (Math.abs(av - bv) > 1e-6) return false
    } else if (av !== bv) {
      return false
    }
  }
  return true
}
