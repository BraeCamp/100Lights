// Beacon audio → Apollo oscillator source.
//
// Apollo's deepest engines (sample, granular, spectral) all read one thing: an
// osc whose `sampleId` names a buffer the engine holds. Beacon is full of audio
// clips and has never been able to hand one over. This converts a loaded
// AudioBuffer into "osc 1 is now playing your clip", so a recording in the
// arrangement can be granulated, frozen, or played chromatically — and, with
// the track item, driven by that track's own MIDI.
//
// Pure patch surgery: loading the buffer into the engine is the caller's job
// (it owns the engine), which keeps this testable and free of audio deps.

import type { ApolloPatch, OscEngine } from '@/lib/apollo/patch'

/** The engines that play a user sample. Wavetable and multisample are excluded:
 *  multisample wants a mapped set rather than one buffer, and wavetable needs a
 *  table built from the audio rather than the audio itself. */
export const SAMPLE_ENGINES: { id: Extract<OscEngine, 'sample' | 'granular' | 'spectral'>; label: string; blurb: string }[] = [
  { id: 'sample', label: 'Sampler', blurb: 'Play it chromatically, loop it, slice it' },
  { id: 'granular', label: 'Granular', blurb: 'Scatter it into grains — clouds, textures, freezes' },
  { id: 'spectral', label: 'Spectral', blurb: 'Freeze and stretch it in the frequency domain' },
]

/**
 * Point oscillator 1 at a loaded sample and switch it to `engine`.
 *
 * The root key matters more than it looks: Apollo keytracks a sample from
 * `rootKey`, so a clip loaded without one plays back transposed by however far
 * the played note sits from middle C. Callers that know the clip's key should
 * pass it; C4 is the neutral default that makes C4 play at original speed.
 */
export function patchWithClipSource(
  patch: ApolloPatch,
  sampleId: string,
  engine: OscEngine,
  opts: { rootKey?: number; oscIndex?: number } = {},
): ApolloPatch {
  const rootKey = opts.rootKey ?? 60
  const i = opts.oscIndex ?? 0
  const next: ApolloPatch = JSON.parse(JSON.stringify(patch))
  const osc = next.oscs[i]
  if (!osc) return next

  osc.enabled = true
  osc.engine = engine
  osc.level = osc.level > 0 ? osc.level : 0.8
  if (engine === 'sample') { osc.smp.sampleId = sampleId; osc.smp.rootKey = rootKey; osc.smp.keytrack = true }
  if (engine === 'granular') { osc.gran.sampleId = sampleId; osc.gran.rootKey = rootKey; osc.gran.keytrack = true }
  if (engine === 'spectral') { osc.spec.sampleId = sampleId; osc.spec.rootKey = rootKey; osc.spec.keytrack = true }

  // A patch seeded from a track's FX chain has every oscillator switched off
  // and no amp envelope worth speaking of — the sample would load and then play
  // silently. Give it a plainly audible envelope if nothing has shaped one.
  const amp = next.envs?.[0]
  if (amp && amp.attack === 0 && amp.decay === 0 && amp.sustain === 0 && amp.release === 0) {
    amp.attack = 0.005; amp.decay = 0.2; amp.sustain = 1; amp.release = 0.25
  }
  return next
}

/** Stable per-clip id, so re-sending the same clip replaces its buffer in the
 *  engine instead of growing a new one on every click. */
export function clipSampleId(clipId: string): string {
  return `dawclip:${clipId}`
}

// ---------------------------------------------------------------------------
// Project key/scale → Apollo's scale lock
//
// Beacon has carried a project key and scale in the transport all along, and
// Apollo has had its own scale root/name for note snapping and arp lock. They
// have never spoken, so an instrument opened from a project in F minor would
// snap to Apollo's default C Minor and quietly fight the song.

/** Beacon's scale vocabulary is shorter than Apollo's and spelled differently.
 *  Anything Apollo cannot express falls back to Chromatic — no snapping, which
 *  is the honest behaviour for a scale we do not know. */
const SCALE_NAMES: Record<string, string> = {
  major: 'Major',
  minor: 'Minor',
  dorian: 'Dorian',
  phrygian: 'Phrygian',
  lydian: 'Lydian',
  mixolydian: 'Mixolydian',
  'penta-maj': 'Pentatonic Maj',
  'penta-min': 'Pentatonic Min',
  blues: 'Blues',
  chromatic: 'Chromatic',
}

export function apolloScaleName(beaconScale: string): string {
  return SCALE_NAMES[beaconScale.toLowerCase()] ?? 'Chromatic'
}

/**
 * Put the project's key and scale into a patch.
 *
 * `lock` is left alone deliberately: whether notes SNAP to the scale is a
 * sound-design choice the player owns, and forcing it on would silently
 * re-pitch a patch someone tuned by hand. This only makes Apollo agree with
 * the project about what the key IS.
 */
export function patchWithProjectKey(patch: ApolloPatch, key: number, scale: string): ApolloPatch {
  const next: ApolloPatch = JSON.parse(JSON.stringify(patch))
  next.global.scaleRoot = ((key % 12) + 12) % 12
  next.global.scaleName = apolloScaleName(scale)
  return next
}
