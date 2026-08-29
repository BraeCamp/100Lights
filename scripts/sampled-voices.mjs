// Real recorded sound, shaped inside Apollo.
//
// The synth palette next door (apollo-voices.mjs) builds everything from
// oscillators, and for drums Brae's verdict was blunt and correct: "your drums
// don't sound much like drums, just cut sawtooth oscillators." A kick is a
// recording of a physical event — a beater hitting a head, a shell resonating,
// a room — and the inharmonic clatter of that is most of what makes it read as a
// drum. Synthesis approximates the envelope and misses the rest.
//
// So these load actual samples. They are still Apollo patches, not a sample
// player: the sample is the SOURCE, and Apollo's filters, envelopes, drive and
// FX are what turn a generic library hit into this song's kick. That is the part
// worth having — a raw one-shot is someone else's sound, a shaped one is ours.
//
// Samples are named by a `builtin:` id that resolves identically here and in the
// studio (scripts/lib/samples.mjs), so a project carries a string and stays
// portable. Nothing is baked into the .cfproj.
//
//   node scripts/sampled-voices.mjs --audit    render each and print what it is

import { loadApollo, fxUnit, render, describe } from './apollo-kit.mjs'
import { drumId, aiId, aiRoots, resolveSample, DRUM_KITS, AI_INSTRUMENTS } from './lib/samples.mjs'

const A = await loadApollo()
const { initPatch, FX_DEFS } = A

const patch = (name, fn) => { const p = initPatch(); p.name = name; fn(p); return p }
const env = (p, i, cfg) => Object.assign(p.envs[i], cfg)
const filt = (p, i, cfg) => Object.assign(p.filters[i], cfg)

/** Point an oscillator at one sample. */
function sampleOsc(p, i, id, cfg = {}) {
  const o = p.oscs[i]
  o.enabled = true
  o.engine = 'sample'
  o.level = cfg.level ?? 1
  o.pan = cfg.pan ?? 0
  o.keytrackPitch = cfg.keytrack ?? false
  o.semi = cfg.semi ?? 0
  o.fine = cfg.fine ?? 0
  Object.assign(o.smp, {
    sampleId: id,
    keytrack: cfg.keytrack ?? false,   // a drum plays at native pitch on every key
    rootKey: cfg.rootKey ?? 60,
    start: cfg.start ?? 0,
    end: cfg.end ?? 1,
    loopMode: 'off',
    rate: cfg.rate ?? 1,
  })
  return o
}

/** Spread an AI instrument's sparse roots across the keyboard as zones. */
function multisampleOsc(p, i, instrument, cfg = {}) {
  const roots = aiRoots(instrument)
  const o = p.oscs[i]
  o.enabled = true
  o.engine = 'multisample'
  o.level = cfg.level ?? 1
  o.keytrackPitch = true
  o.ms.name = instrument
  // Each root owns the keys nearest to it: the split sits halfway to its
  // neighbour, so no note is ever stretched further than it has to be. A sample
  // pushed a long way from its root is the "chipmunk / murky" tell.
  o.ms.zones = roots.map((r, k) => {
    const prev = roots[k - 1], next = roots[k + 1]
    // Key SPLITS are whole notes; the ROOT is the fractional pitch the recording
    // actually sounds, so a root that is a third of a semitone flat does not
    // detune everything mapped to it.
    const slot = r.slot ?? Math.round(r.midi)
    const pslot = prev ? (prev.slot ?? Math.round(prev.midi)) : null
    const nslot = next ? (next.slot ?? Math.round(next.midi)) : null
    return {
      sampleId: r.id,
      loKey: pslot === null ? 0 : Math.floor((pslot + slot) / 2) + 1,
      hiKey: nslot === null ? 127 : Math.floor((slot + nslot) / 2),
      loVel: 0, hiVel: 127,
      rootKey: r.midi,
      tune: 0, gain: 0,
      loopMode: 'off', loopStart: 0, loopEnd: 1,
    }
  })
  return o
}

// ── Drums ───────────────────────────────────────────────────────────────────
// Each takes a kit name so the same part can be re-voiced without rewriting it.
// The shaping is what makes it ours: a fixed lowpass sets how much of the room
// survives, drive adds the density a single hit lacks, and the amp envelope
// decides the tail independently of how long the recording happens to run.
//
// The defaults are FAITHFUL — the sample's own character, lightly held. That is
// deliberate: Apollo's cutoff is far darker than its number suggests
// (cutoffHz = 8 * 2500^n, so 0.52 is 468 Hz, not "most of the way open"), and
// the first pass at these had a lowpass at 468 Hz on the kick, killing the
// beater click, and one at 3.6 kHz on the snare, dropping its centroid from
// 2163 Hz to 466. Darkening is a decision to make per song, not a default to
// inherit. Every voice is checked against its raw sample by
// `npm run check:sampled`.

export const sKick = (kit = 'techno', o = {}) => patch(`${kit} kick`, p => {
  sampleOsc(p, 0, drumId(kit, 'kick'), { level: 1 })
  env(p, 0, { attack: 0.0005, decay: o.decay ?? 0.42, sustain: 0, release: 0.10 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: o.cutoff ?? 0.86, res: 0.05, drive: o.drive ?? 0.18 })
  p.fxMain.push(fxUnit(FX_DEFS, 'compressor', { threshold: -18, ratio: 4 }, { mix: 1 }))
})

// A one-shot is a mono recording, and panning one does not widen anything — it
// changes level, not correlation. `verb` puts a reverb INSIDE the Apollo patch,
// which is the difference that matters: a trackhead effect is not applied by the
// offline renderer (`listen` calls that a render fault), so width added there is
// invisible to every measurement taken before delivery. In the patch it renders.
export const sSnare = (kit = 'studio', o = {}) => patch(`${kit} snare`, p => {
  sampleOsc(p, 0, drumId(kit, 'snare'), { level: 1 })
  env(p, 0, { attack: 0.0005, decay: o.decay ?? 0.30, sustain: 0, release: 0.09 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: o.cutoff ?? 0.94, res: 0.04, drive: o.drive ?? 0.12 })
  if (o.verb) p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: o.verb }))
})

export const sClap = (kit = 'techno', o = {}) => patch(`${kit} clap`, p => {
  sampleOsc(p, 0, drumId(kit, 'clap'), { level: 1 })
  env(p, 0, { attack: 0.0005, decay: o.decay ?? 0.34, sustain: 0, release: 0.12 })
  filt(p, 0, { enabled: true, type: 'hp12', cutoff: o.cutoff ?? 0.22, res: 0.05, drive: 0.06 })
  if (o.verb) p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: o.verb }))
})

export const sHat = (kit = 'techno', o = {}) => patch(`${kit} hat`, p => {
  sampleOsc(p, 0, drumId(kit, 'hat'), { level: 1 })
  env(p, 0, { attack: 0.0004, decay: o.decay ?? 0.11, sustain: 0, release: 0.05 })
  filt(p, 0, { enabled: true, type: 'hp12', cutoff: o.cutoff ?? 0.30, res: 0.04, drive: 0 })
  if (o.verb) p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: o.verb }))
})

export const sOpenHat = (kit = 'techno', o = {}) => patch(`${kit} open hat`, p => {
  sampleOsc(p, 0, drumId(kit, 'openHat'), { level: 1 })
  env(p, 0, { attack: 0.0004, decay: o.decay ?? 0.42, sustain: 0, release: 0.16 })
  filt(p, 0, { enabled: true, type: 'hp12', cutoff: o.cutoff ?? 0.28, res: 0.04, drive: 0 })
  if (o.verb) p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: o.verb }))
})

export const sRim = (kit = 'studio', o = {}) => patch(`${kit} rim`, p => {
  sampleOsc(p, 0, drumId(kit, 'rim'), { level: 1 })
  env(p, 0, { attack: 0.0004, decay: o.decay ?? 0.14, sustain: 0, release: 0.05 })
  filt(p, 0, { enabled: true, type: 'hp12', cutoff: o.cutoff ?? 0.45, res: 0.06, drive: 0.05 })
  if (o.verb) p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: o.verb }))
})

export const sCrash = (kit = 'studio', o = {}) => patch(`${kit} crash`, p => {
  sampleOsc(p, 0, drumId(kit, 'crash'), { level: 1 })
  env(p, 0, { attack: 0.001, decay: o.decay ?? 1.6, sustain: 0, release: 0.5 })
  filt(p, 0, { enabled: true, type: 'hp12', cutoff: o.cutoff ?? 0.20, res: 0.03, drive: 0 })
  if (o.verb) p.fxMain.push(fxUnit(FX_DEFS, 'reverb', {}, { mix: o.verb }))
})

/** A tuned one-shot: the kick sample played as a pitched sub. */
export const sSubHit = (kit = 'trap808', o = {}) => patch(`${kit} sub hit`, p => {
  sampleOsc(p, 0, drumId(kit, 'kick'), { level: 1, keytrack: true, rootKey: o.rootKey ?? 36 })
  env(p, 0, { attack: 0.002, decay: o.decay ?? 1.1, sustain: 0, release: 0.3 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: o.cutoff ?? 0.34, res: 0.05, drive: 0.10 })
})

// ── Melodic ─────────────────────────────────────────────────────────────────

export const sPiano = (o = {}) => patch('Grand Piano', p => {
  multisampleOsc(p, 0, 'grand-piano', { level: 1 })
  env(p, 0, { attack: 0.002, decay: 1.4, sustain: 0.55, release: o.release ?? 0.45 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: o.cutoff ?? 0.91, res: 0.03, drive: o.drive ?? 0.05 })
})

export const sGuitar = (o = {}) => patch('Electric Guitar', p => {
  multisampleOsc(p, 0, 'electric-guitar', { level: 1 })
  env(p, 0, { attack: 0.003, decay: 1.2, sustain: 0.5, release: o.release ?? 0.4 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: o.cutoff ?? 0.86, res: 0.04, drive: o.drive ?? 0.10 })
})

export const sBass = (which = 'electric-bass', o = {}) => patch(`${which}`, p => {
  multisampleOsc(p, 0, which, { level: 1 })
  env(p, 0, { attack: 0.002, decay: 0.9, sustain: 0.7, release: o.release ?? 0.25 })
  filt(p, 0, { enabled: true, type: 'lp12', cutoff: o.cutoff ?? 0.64, res: 0.05, drive: o.drive ?? 0.12 })
})

export const SAMPLED = {
  sKick, sSnare, sClap, sHat, sOpenHat, sRim, sCrash, sSubHit, sPiano, sGuitar, sBass,
}

// ── Audit ───────────────────────────────────────────────────────────────────
if (process.argv.includes('--audit')) {
  const kit = process.argv.find(a => a.startsWith('--kit='))?.split('=')[1] ?? 'techno'
  console.log(`sampled voices — drums from the "${kit}" kit\n`)
  console.log('  ' + '─'.repeat(78))
  const rows = [
    ['kick', sKick(kit), 36], ['snare', sSnare(kit), 38], ['clap', sClap(kit), 39],
    ['hat', sHat(kit), 42], ['openHat', sOpenHat(kit), 46], ['rim', sRim(kit), 51],
    ['crash', sCrash(kit), 49], ['subHit', sSubHit('trap808'), 36],
    ['piano', sPiano(), 60], ['guitar', sGuitar(), 55], ['bass', sBass(), 40],
  ]
  for (const [name, p, note] of rows) {
    try {
      const samples = {}
      for (const o of p.oscs) {
        if (o.smp?.sampleId) samples[o.smp.sampleId] = resolveSample(o.smp.sampleId)
        for (const z of o.ms?.zones ?? []) samples[z.sampleId] = resolveSample(z.sampleId)
      }
      const stats = render(p, { notes: `${note}:0.02:0.6:0.92`, seconds: 2.6, samples })
      console.log('  ' + describe(name, stats))
    } catch (e) {
      console.log('  ' + name.padEnd(14) + 'FAILED — ' + e.message.slice(0, 60))
    }
  }
  console.log(`\n  kits: ${DRUM_KITS.join(' ')}`)
  console.log(`  instruments: ${AI_INSTRUMENTS.join(' ')}`)
}
