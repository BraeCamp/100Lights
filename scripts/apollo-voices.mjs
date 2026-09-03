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

/** Start from Init and apply an edit function — every voice is a full patch. */
function patch(name, fn) {
  const p = initPatch()
  p.name = name
  p.global.masterGain = 0.8
  fn(p)
  return p
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
    level: 1, semi: 0, unison: 2, detune: 0.07, width: 1, stereo: 0.8 })
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
  osc(p, 0, { level: 0.85, enabled: true, unison: 2, detune: 0.05, width: 1, stereo: 0.5 })
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
  // At unison 4 + 3 this pad cost 7 oscillator voices per note, and a pad plays
  // chords. Reducing that was right; the reason first written here was not.
  //
  // ⚠️ CORRECTED 2026-08-31, verified against the allocator: global.poly counts
  // NOTES, not unison voices. The engine holds a fixed pool of 32 Voice objects
  // and takes exactly one per note-on, with unison rendered INSIDE a voice — a
  // single note at unison 8 plays fine with poly set to 2, which is the test
  // that settles it. So a four-note chord was never "28 against a limit of 16".
  //
  // What unison does cost is SUMMED LEVEL and CPU, and the first of those is
  // the one you hear. Every voice sums at full level — there is no polyphony
  // compensation — so the peak of a track scales linearly with what is held
  // down, and the master limiter (instant attack, 0.98 ceiling, 120 ms release)
  // then pulls the whole track down to fit. That is what dense chords ducking
  // and crawling back actually is. scripts/song-headroom.mjs measures it.
  //
  // Voice stealing is real and separate: past poly the allocator calls kill()
  // rather than release(), so a note stops dead mid-sustain. It takes more than
  // sixteen notes sounding at once, which long releases make easier than it
  // sounds. A released voice being stolen is fine — those go first.
  //
  // The width lost to fewer unison voices is bought back with STEREO SPREAD, not
  // with wider detune. That was the original compensation and it was the wrong
  // one: at unison 2 there is no middle voice, both copies sit at the extremes,
  // and the lower one dominates — so detune 0.46 did not widen this pad, it
  // tuned it 46 cents flat. Measured on Undertow: 0.0433 of power at -48 cents
  // and 0.0002 at the written note, under an organ sitting at exactly 0. That is
  // what "some sounds are slightly off" was. Keep detune <= 0.08 on anything
  // pitched; npm run check:tuning will say if it drifts back.
  osc(p, 0, { level: 0.48, enabled: true, unison: 2, detune: 0.07, width: 1, stereo: 1, pan: -0.15 })
  p.oscs[0].wt.tableId = 'pwm'
  p.oscs[0].wt.pos = 0.35
  osc(p, 1, { level: 0.32, enabled: true, unison: 1, detune: 0.28, width: 1, stereo: 0.9, pan: 0.18, fine: 6 })
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
  // 0.03, not 0.05, because BEAT RATE SCALES WITH PITCH. Two voices n cents
  // apart beat at roughly f x n / 1731 Hz, so a spread that is lush down low is
  // rough up high: at 0.05 this patch beat at 2.3Hz playing G4 and 5.8Hz playing
  // B5 — the same setting, on the right side of the roughness threshold in one
  // register and the wrong side in the other. This voice is used for bell-ish
  // parts an octave or two up, so it is tuned for where it actually plays.
  osc(p, 0, { level: 0.55, enabled: true, unison: 2, detune: 0.03, width: 1, stereo: 0.6 })
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
  // Four voices, so unlike the unison-2 patches this one DOES have inner voices
  // near the centre and the pitch stays put. What it had instead was roughness:
  // detune 0.2 puts the outer pair 40 cents apart, which at G4 beats about ten
  // times a second — fast enough that the ear stops hearing one thick voice and
  // starts hearing two that disagree. 0.08 keeps the choir wide and moves the
  // beating down to ~3.6Hz, which is heard as breath rather than as a wobble.
  osc(p, 0, { level: 1, enabled: true, unison: 4, detune: 0.08, width: 1, stereo: 0.85 })
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
  osc(p, 0, { level: 0.7, enabled: true, unison: 2, detune: 0.05, width: 1, stereo: 0.6 })
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
  // four-note chord was 20 against a limit of 16. Stereo spread keeps the size —
  // NOT wider detune, which at unison 2 just tunes the whole section flat.
  osc(p, 0, { level: 0.6, enabled: true, unison: 2, detune: 0.07, width: 1, stereo: 1, pan: -0.1 })
  p.oscs[0].wt.tableId = 'analog-saws'
  p.oscs[0].wt.pos = 0.4
  osc(p, 1, { level: 0.34, enabled: true, unison: 2, detune: 0.06, width: 1, stereo: 0.8, pan: 0.12, fine: 5 })
  p.oscs[1].wt.tableId = 'pwm'
  p.oscs[1].wt.pos = 0.3
  env(p, 0, { attack: 0.25, decay: 0.8, sustain: 0.72, release: 1.2 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: 0.55, res: 0.08, keytrack: 0.2 })
  p.fxMain.push(fxUnit(FX_DEFS, 'chorus', {}, { mix: 0.35 }))
  p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: 0.34 }))
})

/** The phonk cowbell: pitched metal, bandpassed, gone in a moment. */
export const cowbell = () => patch('Cowbell', p => {
  osc(p, 0, { level: 0.9, enabled: true, unison: 2, detune: 0.06, width: 1, stereo: 0.6 })
  p.oscs[0].wt.tableId = 'metallic'
  env(p, 0, { attack: 0.0005, decay: 0.16, sustain: 0, release: 0.06, dCurve: -0.5 })
  filt(p, 0, { enabled: true, type: 'bp12', cutoff: 0.68, res: 0.5, drive: 0.3 })
  p.fxMain.push(fxUnit(FX_DEFS, 'distortion', {}, { mix: 0.25 }))
})

/** Funk bass: short, resonant, with a filter pluck on every note. */
export const funkBass = () => patch('Funk Bass', p => {
  osc(p, 0, { level: 0.85, enabled: true, unison: 2, detune: 0.05, width: 1, stereo: 0.6 })
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
  osc(p, 0, { level: 0.6, enabled: true, unison: 2, detune: 0.08, width: 0.4 })
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
