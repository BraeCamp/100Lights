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
  osc(p, 0, { level: 0.85, enabled: true, unison: 2, detune: 0.22, width: 0.6 })
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
  osc(p, 0, { level: 0.48, enabled: true, unison: 4, detune: 0.34, width: 1, stereo: 0.85, pan: -0.15 })
  p.oscs[0].wt.tableId = 'pwm'
  p.oscs[0].wt.pos = 0.35
  osc(p, 1, { level: 0.32, enabled: true, unison: 3, detune: 0.28, width: 1, stereo: 0.8, pan: 0.18, fine: 6 })
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
  osc(p, 0, { level: 0.55, enabled: true, unison: 2, detune: 0.12, width: 0.5 })
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
