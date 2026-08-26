// The instrument palette, built entirely inside Apollo.
//
// Nothing here loads a sample or a preset: every voice is oscillators, filters,
// envelopes, modulation and FX. Drums included — a kick is a sine with a fast
// pitch envelope, a hat is a noise wavetable through a highpass with a 40ms
// decay. That is the whole point of the exercise.
//
// Run `node scripts/apollo-voices.mjs --audit` to render every voice through the
// real engine and print peak / rms / centroid / duration, which is how these get
// tuned: a hat whose centroid reads 900Hz is not a hat, and a kick that measures
// 0.28s of sound is doing what it should.

import { loadApollo, mod, fxUnit, noiseTable, render, describe, voiceCost } from './apollo-kit.mjs'

const A = await loadApollo()
const { initPatch, FX_DEFS, tableToBase64 } = A

const NOISE = noiseTable(tableToBase64, 20260824)

// Per-voice loudness trims, measured by scripts/voice-calibrate.mjs.
//
// These patches were each designed alone, and their intrinsic output levels
// ended up more than 10 dB apart — which meant a track fader did not mean the
// same thing on two instruments, and every song hand-compensated for it blind.
// In "Coriander" that put the kick 9 dB underneath the electric piano and the
// snare out of the mix entirely, with the faders already pushed the wrong way.
//
// With every voice normalised to the same perceived loudness, a fader is a
// musical decision again. Missing entries simply mean "not calibrated yet".
import LEVELS from './voice-levels.json' with { type: 'json' }

/** Start from Init and apply an edit function — every voice is a full patch. */
function patch(name, fn) {
  const p = initPatch()
  p.name = name
  p.global.masterGain = 0.8
  fn(p)
  const trim = LEVELS[TRIM_KEY[name] ?? '']
  if (trim) p.global.masterGain = Math.min(1, p.global.masterGain * trim)
  return p
}

/** patch() knows a voice by its display name; the trims are keyed by the name
 *  used in VOICES. One table rather than renaming either. */
const TRIM_KEY = {
  Kick: 'kick', Snare: 'snare', Hat: 'hat', 'Open Hat': 'openhat', Hats: 'hatShut',
  Tick: 'tick', Sub: 'sub', Bass: 'bass', Pad: 'pad', Keys: 'keys', Choir: 'choir',
  Organ: 'organ', Harpsichord: 'harpsi', Strings: 'strings', Cowbell: 'cowbell',
  'Funk Bass': 'funkbas', 'Warm Keys': 'warmep', Pluck: 'pluck', Glass: 'glass',
  'Tine Keys': 'tine', Picked: 'picked', 'Air Pad': 'airpad',
}
const osc = (p, i, cfg) => Object.assign(p.oscs[i], cfg)
const env = (p, i, cfg) => Object.assign(p.envs[i], cfg)
const filt = (p, i, cfg) => Object.assign(p.filters[i], cfg)
/** Attach the noise wavetable to a patch and point an osc at it. */
function useNoise(p, i, cfg = {}) {
  p.userTables.noise = NOISE
  osc(p, i, { enabled: true, engine: 'wavetable', keytrackPitch: false, ...cfg })
  p.oscs[i].wt.tableId = 'noise'
  Object.assign(p.oscs[i].wt, cfg.wt || {})
}

// ── Drums ───────────────────────────────────────────────────────────────────

/** Sine + a fast downward pitch envelope. Play low (C1). */
export const kick = () => patch('Kick', p => {
  osc(p, 0, { level: 1, enabled: true })
  p.oscs[0].wt.tableId = 'basic-shapes'
  p.oscs[0].wt.pos = 0                                   // frame 0 is the sine
  env(p, 0, { attack: 0.001, decay: 0.34, sustain: 0, release: 0.07, dCurve: -0.55 })
  env(p, 1, { attack: 0.0004, decay: 0.055, sustain: 0, release: 0.02, dCurve: -0.75 })
  // span of osc0.semi is 72st, so 0.22 ≈ +16 semitones at the transient
  p.matrix.push(mod('env2', 'osc0.semi', 0.22))
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.44, res: 0.06, drive: 0.38 })
  p.fxMain.push(fxUnit(FX_DEFS, 'compressor', {}, { mix: 1 }))
})

/** Tuned body + a noise burst, bandpassed. */
export const snare = () => patch('Snare', p => {
  osc(p, 0, { level: 0.5, enabled: true, semi: 0 })
  p.oscs[0].wt.tableId = 'basic-shapes'
  p.oscs[0].wt.pos = 0.28
  osc(p, 1, { enabled: true, engine: 'wavetable', keytrackPitch: false,
    level: 1, semi: 0, unison: 3, detune: 0.75, width: 1, stereo: 0.6 })
  p.oscs[1].wt.tableId = 'metallic'
  env(p, 0, { attack: 0.001, decay: 0.19, sustain: 0, release: 0.06, dCurve: -0.5 })
  env(p, 1, { attack: 0.0005, decay: 0.035, sustain: 0, release: 0.02 })
  p.matrix.push(mod('env2', 'osc0.semi', 0.10))          // a little snap on the body
  filt(p, 0, { enabled: true, type: 'hp12', cutoff: 0.50, res: 0.22, drive: 0.3 })
  p.fxMain.push(fxUnit(FX_DEFS, 'distortion', {}, { mix: 0.28 }))
  p.fxMain.push(fxUnit(FX_DEFS, 'compressor'))
})

/** Noise through a highpass with a very short decay. */
export const hat = ({ open = false } = {}) => patch(open ? 'Open Hat' : 'Hat', p => {
  // 'metallic' rather than the noise table, and played at semi 0 rather than up
  // high: a wavetable is band-limited per octave, so pitching noisy content UP
  // throws away the very harmonics that make it a hat. Measured 0.19 -> 0.54
  // peak with the centroid holding around 5.7kHz.
  osc(p, 0, { enabled: true, engine: 'wavetable', keytrackPitch: false,
    level: 1, semi: 0, unison: 4, detune: 0.85, width: 1, stereo: 0.7 })
  p.oscs[0].wt.tableId = 'metallic'
  env(p, 0, {
    attack: 0.0004, decay: open ? 0.26 : 0.045, sustain: 0,
    release: open ? 0.12 : 0.02, dCurve: -0.4,
  })
  filt(p, 0, { enabled: true, type: 'hp24', cutoff: 0.72, res: 0.08, drive: 0.45 })
  p.fxMain.push(fxUnit(FX_DEFS, 'distortion', {}, { mix: 0.3 }))
})

/**
 * One hat patch that plays both closed and open, decided by NOTE LENGTH: a
 * little sustain means a short note chokes and a long one rings. Saves giving a
 * song two hat tracks (each Apollo track is its own engine instance), and it is
 * how a real hi-hat behaves anyway — the pedal decides, not a different drum.
 */
export const hatDual = () => patch('Hats', p => {
  osc(p, 0, { enabled: true, engine: 'wavetable', keytrackPitch: false,
    level: 1, semi: 0, unison: 4, detune: 0.85, width: 1, stereo: 0.7 })
  p.oscs[0].wt.tableId = 'metallic'
  env(p, 0, { attack: 0.0004, decay: 0.06, sustain: 0.32, release: 0.10, dCurve: -0.5 })
  filt(p, 0, { enabled: true, type: 'hp24', cutoff: 0.72, res: 0.08, drive: 0.45 })
  p.fxMain.push(fxUnit(FX_DEFS, 'distortion', {}, { mix: 0.3 }))
})

/** A dry, short click of noise — used as a rim/tick, not a backbeat. */
export const tick = () => patch('Tick', p => {
  osc(p, 0, { enabled: true, engine: 'wavetable', keytrackPitch: false,
    level: 1, semi: 0, unison: 2, detune: 0.4, width: 0.8 })
  p.oscs[0].wt.tableId = 'metallic'
  env(p, 0, { attack: 0.0003, decay: 0.035, sustain: 0, release: 0.02 })
  filt(p, 0, { enabled: true, type: 'bp12', cutoff: 0.66, res: 0.4, drive: 0.4 })
  p.fxMain.push(fxUnit(FX_DEFS, 'distortion', {}, { mix: 0.25 }))
})

// ── Low end ─────────────────────────────────────────────────────────────────

/** One held note per chord: sine plus Apollo's own sub oscillator. */
export const subBass = () => patch('Sub', p => {
  osc(p, 0, { level: 0.85, enabled: true })
  p.oscs[0].wt.tableId = 'basic-shapes'
  p.oscs[0].wt.pos = 0
  p.sub = { ...p.sub, enabled: true, shape: 'sine', octave: -1, level: 0.42, ref: 'lowest', direct: false }
  env(p, 0, { attack: 0.008, decay: 0.5, sustain: 0.88, release: 0.35, dCurve: -0.3 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.30, res: 0.04, drive: 0.18 })
  p.fxMain.push(fxUnit(FX_DEFS, 'compressor'))
})

/** The moving bass: detuned saws with weight underneath and a filter pluck. */
export const bass = () => patch('Bass', p => {
  osc(p, 0, { level: 0.85, enabled: true, unison: 3, detune: 0.20, width: 0.6 })
  p.oscs[0].wt.tableId = 'analog-saws'
  p.oscs[0].wt.pos = 0.3
  osc(p, 1, { level: 0.26, enabled: true, octave: -1 })
  p.oscs[1].wt.tableId = 'basic-shapes'
  p.oscs[1].wt.pos = 0
  env(p, 0, { attack: 0.004, decay: 0.28, sustain: 0.55, release: 0.13 })
  env(p, 1, { attack: 0.002, decay: 0.16, sustain: 0, release: 0.08 })
  p.matrix.push(mod('env2', 'f1.cutoff', 0.20))
  filt(p, 0, { enabled: true, type: 'lp24', cutoff: 0.47, res: 0.30, drive: 0.28, keytrack: 0.3 })
  p.fxMain.push(fxUnit(FX_DEFS, 'compressor'))
})

// ── Harmony ─────────────────────────────────────────────────────────────────

/** Wide, slow pad: two detuned tables, a slow filter LFO, chorus + reverb. */
export const pad = () => patch('Pad', p => {
  // THREE voices per note, not seven.
  //
  // At unison 4 + 3 this pad cost 7 voices per note, and a pad plays chords: a
  // four-note chord was 28 voices against Apollo's limit of 16, reaching 56 once
  // consecutive bars overlapped through the 2.6s release. Past 16 the allocator
  // steals ACTIVE voices — notes cut off mid-sustain — which is audible as
  // stuttering and is what "it's freezing at the beginning" was, in a section
  // where the pad plays with almost nothing else and nothing is combined yet.
  //
  // A released voice being stolen is fine; the allocator takes those first and
  // they are already fading. Staying under 16 ACTIVE is the whole trick. Three
  // voices per note puts a four-note chord at 12. The width lost to fewer unison
  // voices is bought back with wider detune and full stereo spread.
  osc(p, 0, { level: 0.48, enabled: true, unison: 2, detune: 0.05, width: 1, stereo: 0.95, pan: -0.15 })
  p.oscs[0].wt.tableId = 'pwm'
  p.oscs[0].wt.pos = 0.35
  osc(p, 1, { level: 0.32, enabled: true, unison: 1, detune: 0.28, width: 1, stereo: 0.9, pan: 0.18, fine: 9 })
  p.oscs[1].wt.tableId = 'analog-saws'
  p.oscs[1].wt.pos = 0.55
  env(p, 0, { attack: 1.2, decay: 1.1, sustain: 0.7, release: 2.6, aCurve: -0.2 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.46, res: 0.10, keytrack: 0.15 })
  p.lfos[0] = { ...p.lfos[0], rate: 0.09, sync: false }
  p.matrix.push(mod('lfo1', 'f1.cutoff', 0.10, { bipolar: true }))
  p.fxMain.push(fxUnit(FX_DEFS, 'chorus', {}, { mix: 0.45 }))
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.34 }))
})

/** Short bell-ish keys for stabs and arps. */
export const keys = () => patch('Keys', p => {
  osc(p, 0, { level: 0.55, enabled: true, unison: 3, detune: 0.12, width: 0.5 })
  p.oscs[0].wt.tableId = 'bells'
  p.oscs[0].wt.pos = 0.38
  osc(p, 1, { level: 0.18, enabled: true, octave: -1 })
  p.oscs[1].wt.tableId = 'basic-shapes'
  p.oscs[1].wt.pos = 0.15
  env(p, 0, { attack: 0.002, decay: 0.75, sustain: 0.12, release: 0.45, dCurve: -0.5 })
  env(p, 1, { attack: 0.001, decay: 0.30, sustain: 0, release: 0.15 })
  p.matrix.push(mod('env2', 'f1.cutoff', 0.24))
  filt(p, 0, { enabled: true, type: 'lp24', cutoff: 0.74, res: 0.18, keytrack: 0.25 })
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.24 }))
})

/** Hollow, vocal-ish sustained voice — a different colour from the pad. */
export const choirish = () => patch('Choir', p => {
  osc(p, 0, { level: 1, enabled: true, unison: 4, detune: 0.2, width: 1, stereo: 0.7 })
  p.oscs[0].wt.tableId = 'vocal'
  p.oscs[0].wt.pos = 0.4
  env(p, 0, { attack: 0.6, decay: 0.8, sustain: 0.65, release: 1.8 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.66, res: 0.12 })
  p.lfos[0] = { ...p.lfos[0], rate: 4.6, sync: false }
  p.matrix.push(mod('lfo1', 'osc0.fine', 0.02, { bipolar: true }))   // gentle vibrato
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.4 }))
})

/** A plucked, organ-ish tone for rhythmic chord work. */
export const organ = () => patch('Organ', p => {
  osc(p, 0, { level: 0.7, enabled: true })
  p.oscs[0].wt.tableId = 'organ'
  p.oscs[0].wt.pos = 0.3
  env(p, 0, { attack: 0.006, decay: 0.4, sustain: 0.55, release: 0.2 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.55, res: 0.08 })
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.2 }))
})


// ── Added for the baroque-phonk and disco-pop pieces ───────────────────────

/** Plucked and bright, harpsichord-leaning: fast decay, no sustain to speak of. */
export const harpsi = () => patch('Harpsichord', p => {
  osc(p, 0, { level: 0.7, enabled: true, unison: 3, detune: 0.10, width: 0.5 })
  p.oscs[0].wt.tableId = 'bells'
  p.oscs[0].wt.pos = 0.5
  osc(p, 1, { level: 0.25, enabled: true })
  p.oscs[1].wt.tableId = 'analog-saws'
  p.oscs[1].wt.pos = 0.2
  env(p, 0, { attack: 0.001, decay: 0.45, sustain: 0.05, release: 0.25, dCurve: -0.6 })
  env(p, 1, { attack: 0.001, decay: 0.12, sustain: 0, release: 0.06 })
  p.matrix.push(mod('env2', 'f1.cutoff', 0.22))
  filt(p, 0, { enabled: true, type: 'lp24', cutoff: 0.70, res: 0.15, keytrack: 0.3 })
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.2 }))
})

/** Bowed ensemble — slow on, wide, for the baroque chord writing. */
export const strings = () => patch('Strings', p => {
  // Two voices, not three: strings play CHORDS, and at 5 voices per note a
  // four-note chord was 20 against a limit of 16. Wider detune keeps the size.
  osc(p, 0, { level: 0.6, enabled: true, unison: 3, detune: 0.20, width: 1, stereo: 0.9, pan: -0.1 })
  p.oscs[0].wt.tableId = 'analog-saws'
  p.oscs[0].wt.pos = 0.4
  osc(p, 1, { level: 0.34, enabled: true, unison: 1, detune: 0.2, width: 1, stereo: 0.7, pan: 0.12, fine: 7 })
  p.oscs[1].wt.tableId = 'pwm'
  p.oscs[1].wt.pos = 0.3
  env(p, 0, { attack: 0.25, decay: 0.8, sustain: 0.72, release: 1.2 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.55, res: 0.08, keytrack: 0.2 })
  p.fxMain.push(fxUnit(FX_DEFS, 'chorus', {}, { mix: 0.35 }))
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.34 }))
})

/** The phonk cowbell: pitched metal, bandpassed, gone in a moment. */
export const cowbell = () => patch('Cowbell', p => {
  osc(p, 0, { level: 0.9, enabled: true, unison: 2, detune: 0.3, width: 0.6 })
  p.oscs[0].wt.tableId = 'metallic'
  env(p, 0, { attack: 0.0005, decay: 0.16, sustain: 0, release: 0.06, dCurve: -0.5 })
  filt(p, 0, { enabled: true, type: 'bp12', cutoff: 0.68, res: 0.5, drive: 0.3 })
  p.fxMain.push(fxUnit(FX_DEFS, 'distortion', {}, { mix: 0.25 }))
})

/** Funk bass: short, resonant, with a filter pluck on every note. */
export const funkBass = () => patch('Funk Bass', p => {
  osc(p, 0, { level: 0.85, enabled: true, unison: 3, detune: 0.12, width: 0.5 })
  p.oscs[0].wt.tableId = 'analog-saws'
  p.oscs[0].wt.pos = 0.25
  osc(p, 1, { level: 0.3, enabled: true, octave: -1 })
  p.oscs[1].wt.tableId = 'basic-shapes'
  p.oscs[1].wt.pos = 0
  env(p, 0, { attack: 0.004, decay: 0.18, sustain: 0.35, release: 0.1 })
  env(p, 1, { attack: 0.002, decay: 0.10, sustain: 0, release: 0.05 })
  p.matrix.push(mod('env2', 'f1.cutoff', 0.30))
  filt(p, 0, { enabled: true, type: 'lp24', cutoff: 0.40, res: 0.45, drive: 0.3, keytrack: 0.35 })
  p.fxMain.push(fxUnit(FX_DEFS, 'compressor'))
})

/** Round electric-piano-ish keys for the disco chords. */
export const warmEp = () => patch('Warm Keys', p => {
  osc(p, 0, { level: 0.6, enabled: true, unison: 2, detune: 0.05, width: 0.4 })
  p.oscs[0].wt.tableId = 'basic-shapes'
  p.oscs[0].wt.pos = 0.12
  osc(p, 1, { level: 0.3, enabled: true })
  p.oscs[1].wt.tableId = 'organ'
  p.oscs[1].wt.pos = 0.25
  env(p, 0, { attack: 0.004, decay: 0.9, sustain: 0.25, release: 0.5, dCurve: -0.45 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.6, res: 0.1, keytrack: 0.25 })
  p.fxMain.push(fxUnit(FX_DEFS, 'chorus', {}, { mix: 0.3 }))
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.22 }))
})

// ── Brightness ──────────────────────────────────────────────────────────────
// Added after `scripts/voice-audit.mjs` put the problem in a table: eight of
// these eighteen voices put most of their energy in 120–400 Hz, and NOT ONE
// pitched voice reached presence (2.5–5 kHz) or above. Everything from 900 Hz
// up was hi-hats.
//
// That is the measured gap against real music: our songs carry 1.5% of their
// energy between 900 Hz and 5 kHz where the ElevenLabs reference set carries
// 5.4%. It is also, from the other side, the register clash the note analysis
// keeps finding — when every harmony instrument occupies the same octave and a
// half, they mask each other and no fader fixes it.
//
// The instinct is to open every filter, and that is wrong: it makes a thin,
// harsh palette instead of a dark one, and the dark voices are dark on purpose.
// What real instruments have in that region is mostly the ATTACK — the pick,
// the hammer, the stick — a few tens of milliseconds of bright noise over a
// body that stays warm. So these voices are built that way, and the dark ones
// are left alone.

/**
 * A short bright attack layer on osc C — the pick, hammer or stick.
 *
 * Level starts at zero and is driven by env 3, so the transient exists only for
 * its decay and never colours the sustain. `keytrack:false` makes it the same
 * click at every pitch, which is what a stick or a fret noise is; a struck bar
 * or a bell tine should track.
 */
function transient(p, { level = 0.45, decay = 0.035, table = 'metallic', pos = 0.5, keytrack = true, octave = 1 } = {}) {
  osc(p, 2, { enabled: true, engine: 'wavetable', level: 0, keytrackPitch: keytrack, octave })
  p.oscs[2].wt.tableId = table
  p.oscs[2].wt.pos = pos
  env(p, 2, { attack: 0.0004, decay, sustain: 0, release: 0.02, dCurve: -0.6 })
  p.matrix.push(mod('env3', 'osc2.level', level))
}

/** Plucked and forward — the voice that carries definition in a busy bar. */
export const pluck = () => patch('Pluck', p => {
  osc(p, 0, { level: 0.62, enabled: true, unison: 3, detune: 0.12, width: 0.8, stereo: 0.5 })
  p.oscs[0].wt.tableId = 'analog-saws'
  p.oscs[0].wt.pos = 0.62
  osc(p, 1, { level: 0.22, enabled: true, octave: 1, fine: 4 })
  p.oscs[1].wt.tableId = 'bells'
  p.oscs[1].wt.pos = 0.55
  env(p, 0, { attack: 0.001, decay: 0.55, sustain: 0.06, release: 0.32, dCurve: -0.55 })
  env(p, 1, { attack: 0.001, decay: 0.22, sustain: 0, release: 0.1 })
  p.matrix.push(mod('env2', 'f1.cutoff', 0.30))
  transient(p, { level: 0.32, decay: 0.028, table: 'metallic', pos: 0.6, keytrack: false })
  filt(p, 0, { enabled: true, type: 'lp24', cutoff: 0.88, res: 0.16, keytrack: 0.5 })
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.18 }))
})

/** Struck glass — high accents, and the only voice that reaches brilliance. */
export const glass = () => patch('Glass', p => {
  osc(p, 0, { level: 0.55, enabled: true, octave: 1, unison: 3, detune: 0.08, width: 0.7, stereo: 0.6 })
  p.oscs[0].wt.tableId = 'bells'
  p.oscs[0].wt.pos = 0.85
  osc(p, 1, { level: 0.3, enabled: true, octave: 2, fine: 7 })
  p.oscs[1].wt.tableId = 'metallic'
  p.oscs[1].wt.pos = 0.4
  env(p, 0, { attack: 0.0008, decay: 1.6, sustain: 0.02, release: 0.9, dCurve: -0.7 })
  filt(p, 0, { enabled: true, type: 'hp12', cutoff: 0.22, res: 0.05 })
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.34 }))
})

/** Electric piano with a real tine: warm body, bright bark on the attack. */
export const tine = () => patch('Tine Keys', p => {
  // Unison 1. This voice plays four-note chords with overlapping hits, and at
  // 4 voices per note that peaked at 32 against Apollo's limit of 16 — past
  // which the allocator steals notes that are still sounding. Width comes from
  // the chorus and the octave-up tine instead, neither of which costs a voice.
  osc(p, 0, { level: 0.6, enabled: true, unison: 1, detune: 0.05, width: 0.4 })
  p.oscs[0].wt.tableId = 'basic-shapes'
  p.oscs[0].wt.pos = 0.1
  osc(p, 1, { level: 0.19, enabled: true, octave: 2, fine: 6 })
  p.oscs[1].wt.tableId = 'bells'
  p.oscs[1].wt.pos = 0.55
  env(p, 0, { attack: 0.003, decay: 1.0, sustain: 0.22, release: 0.55, dCurve: -0.45 })
  env(p, 1, { attack: 0.001, decay: 0.34, sustain: 0, release: 0.12 })
  p.matrix.push(mod('env2', 'osc1.level', 0.22))
  transient(p, { level: 0.26, decay: 0.02, table: 'metallic', pos: 0.35, keytrack: true, octave: 2 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.82, res: 0.08, keytrack: 0.3 })
  p.fxMain.push(fxUnit(FX_DEFS, 'chorus', {}, { mix: 0.28 }))
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.2 }))
})

/** Picked string — fret noise on the front, mid-forward body. */
export const picked = () => patch('Picked', p => {
  osc(p, 0, { level: 0.7, enabled: true, unison: 3, detune: 0.1, width: 0.7, stereo: 0.45 })
  p.oscs[0].wt.tableId = 'harmonic-sweep'
  p.oscs[0].wt.pos = 0.45
  osc(p, 1, { level: 0.2, enabled: true, fine: -5 })
  p.oscs[1].wt.tableId = 'analog-saws'
  p.oscs[1].wt.pos = 0.7
  env(p, 0, { attack: 0.002, decay: 0.7, sustain: 0.1, release: 0.35, dCurve: -0.5 })
  env(p, 1, { attack: 0.001, decay: 0.18, sustain: 0, release: 0.08 })
  p.matrix.push(mod('env2', 'f1.cutoff', 0.26))
  transient(p, { level: 0.38, decay: 0.022, table: 'digital-glitch', pos: 0.3, keytrack: false })
  filt(p, 0, { enabled: true, type: 'lp24', cutoff: 0.8, res: 0.2, keytrack: 0.45 })
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.2 }))
})

/** A pad that has a top: the warm bed, plus a quiet octave of air above it. */
export const airPad = () => patch('Air Pad', p => {
  osc(p, 0, { level: 0.46, enabled: true, unison: 2, detune: 0.05, width: 1, stereo: 0.95, pan: -0.15 })
  p.oscs[0].wt.tableId = 'pwm'
  p.oscs[0].wt.pos = 0.35
  osc(p, 1, { level: 0.2, enabled: true, octave: 1, fine: 9, width: 1, stereo: 0.9, pan: 0.2 })
  p.oscs[1].wt.tableId = 'harmonic-sweep'
  p.oscs[1].wt.pos = 0.6
  env(p, 0, { attack: 1.0, decay: 1.2, sustain: 0.68, release: 2.4, aCurve: -0.2 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.72, res: 0.08, keytrack: 0.2 })
  p.lfos[0] = { ...p.lfos[0], rate: 0.08, sync: false }
  p.matrix.push(mod('lfo1', 'f1.cutoff', 0.09, { bipolar: true }))
  p.fxMain.push(fxUnit(FX_DEFS, 'chorus', {}, { mix: 0.4 }))
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.32 }))
})

export const VOICES = {
  kick:   { build: kick,                 notes: '24:0:0.4',        seconds: 1.2 },
  snare:  { build: snare,                notes: '48:0:0.25',       seconds: 1.0 },
  hat:    { build: () => hat(),          notes: '60:0:0.1',        seconds: 0.6 },
  openhat:{ build: () => hat({ open: true }), notes: '60:0:0.3',   seconds: 1.0 },
  tick:   { build: tick,                 notes: '60:0:0.08',       seconds: 0.5 },
  hatShut:{ build: hatDual,              notes: '60:0:0.05',       seconds: 0.6 },
  hatOpen:{ build: hatDual,              notes: '60:0:0.34',       seconds: 1.0 },
  sub:    { build: subBass,              notes: '31:0:1.6',        seconds: 2.4 },
  bass:   { build: bass,                 notes: '43:0:0.5,50:0.75:0.5', seconds: 2.0 },
  pad:    { build: pad,                  notes: '58:0:3,62:0:3,65:0:3', seconds: 5.0 },
  keys:   { build: keys,                 notes: '60:0:0.6,64:0:0.6,67:0:0.6', seconds: 2.5 },
  choir:  { build: choirish,             notes: '60:0:2.5,67:0:2.5', seconds: 4.0 },
  organ:  { build: organ,                notes: '55:0:1,59:0:1,62:0:1', seconds: 2.5 },
  harpsi: { build: harpsi,               notes: '62:0:0.5,65:0.25:0.5,69:0.5:0.6', seconds: 2.0 },
  strings:{ build: strings,              notes: '50:0:2.5,57:0:2.5,62:0:2.5', seconds: 4.0 },
  cowbell:{ build: cowbell,              notes: '72:0:0.1',        seconds: 0.8 },
  funkbas:{ build: funkBass,             notes: '45:0:0.3,52:0.5:0.3', seconds: 1.6 },
  warmep: { build: warmEp,               notes: '57:0:1,61:0:1,64:0:1', seconds: 2.5 },
  pluck:  { build: pluck,                notes: '60:0:0.5,67:0.25:0.5', seconds: 2.0 },
  glass:  { build: glass,                notes: '72:0:1.5,79:0:1.5',    seconds: 3.0 },
  tine:   { build: tine,                 notes: '57:0:1,61:0:1,64:0:1', seconds: 2.5 },
  picked: { build: picked,               notes: '52:0:0.6,59:0.25:0.6', seconds: 2.0 },
  airpad: { build: airPad,               notes: '58:0:3,62:0:3,65:0:3', seconds: 5.0 },
}

if (process.argv.includes('--audit')) {
  const only = process.argv.find(a => a.startsWith('--only='))?.split('=')[1]
  console.log('voice           peak      rms       centroid    length          voices/note')
  console.log('─'.repeat(80))
  for (const [name, v] of Object.entries(VOICES)) {
    if (only && !name.includes(only)) continue
    try {
      const p = v.build()
      const cost = voiceCost(p)
      // Unison multiplies per held note, so a four-note chord costs 4x this.
      // Anything past ~8 is worth a second look before it lands in eight tracks.
      const flag = cost >= 8 ? '  <-- heavy' : ''
      console.log(describe(name, render(p, { notes: v.notes, seconds: v.seconds })) +
        `  ${String(cost).padStart(2)}${flag}`)
    } catch (e) {
      console.log(`${name.padEnd(14)} ERROR ${String(e.message).split('\n')[0].slice(0, 90)}`)
    }
  }
}
