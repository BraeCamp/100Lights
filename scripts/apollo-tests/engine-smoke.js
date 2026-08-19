// Apollo engine test harness — runs the worklet in plain Node (no browser).
// Part of the repo test suite: `npm run test:apollo`.
global.sampleRate = 48000
let sentMsgs = []
global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => sentMsgs.push(m), onmessage: null } } }
global.registerProcessor = (name, cls) => { global.__cls = cls }
require(require('node:path').join(__dirname, '../../public/apollo/engine.js'))

function makePatch() {
  const warp = () => ({ mode: 'off', amount: 0 })
  const osc = (en) => ({
    enabled: en, engine: 'wavetable', level: 0.75, pan: 0, octave: 0, semi: 0, fine: 0,
    unison: 1, detune: 0.15, blend: 0.5, width: 1, phase: 0, rand: 1, stereo: 0.5,
    keytrackPitch: true, unisonMode: 'classic', dest: 'f1', filterBal: 0, bus: 'main',
    wt: { tableId: 'basic', pos: 0, interp: 'smooth', warp1: warp(), warp2: warp(), fmSource: 1 },
    smp: { sampleId: null, start: 0, end: 1, loopMode: 'off', loopStart: 0.25, loopEnd: 0.75, xfade: 0.01, rate: 1, keytrack: true, rootKey: 60, slices: [], sliceMap: 'off', warp1: warp(), warp2: warp() },
    gran: { sampleId: null, density: 20, length: 80, scan: 1, pos: 0, spray: 0.05, direction: 'fwd', pitchRand: 0, panRand: 0.3, windowShape: 0.5, windowSkew: 0, windowAmount: 1, loopGrains: false, manual: false, keytrack: true, rootKey: 60 },
    spec: { sampleId: null, speed: 1, freeze: false, pos: 0, smear: 0, shift: 0, pitchShift: 0, formant: 0, spread: 0, gate: 0, filterCurve: Array(64).fill(1), transients: 0.5, keytrack: true, rootKey: 60 },
    ms: { name: '', zones: [] },
  })
  return {
    version: 1, name: 'Init', author: '', tags: [],
    global: { poly: 16, mode: 'poly', glide: 0, glideLegatoOnly: true, pbRange: 2, masterGain: 0.8, bpm: 120, quality: 'good', voiceSpreadPan: 0, voiceSpreadTune: 0, voiceSpreadCutoff: 0, scaleRoot: 0, scaleName: 'Minor', scaleLock: false, masterTune: 0 },
    oscs: [osc(true), osc(false), osc(false)],
    sub: { enabled: false, shape: 'sine', octave: -1, level: 0.5, pan: 0, direct: false, dest: 'f1', filterBal: 0, bus: 'main' },
    noise: { enabled: false, sampleId: null, level: 0.5, pan: 0, pitch: 0, keytrack: false, oneShot: false, phase: 0, rand: 1, dest: 'f1', filterBal: 0, bus: 'main' },
    filters: [
      { enabled: true, type: 'lp24', cutoff: 0.7, res: 0.3, drive: 0.2, fat: 0.5, mix: 1, pan: 0, keytrack: 0, bus: 'main' },
      { enabled: false, type: 'lp12', cutoff: 0.8, res: 0.15, drive: 0, fat: 0.5, mix: 1, pan: 0, keytrack: 0, bus: 'main' },
    ],
    filterRouting: 'serial',
    envs: [
      { attack: 0.002, hold: 0, decay: 0.6, sustain: 0.8, release: 0.15, aCurve: -0.4, dCurve: -0.5, rCurve: -0.5, bpmSync: false, legato: false },
      { attack: 0.01, hold: 0, decay: 0.6, sustain: 0, release: 0.15, aCurve: -0.4, dCurve: -0.5, rCurve: -0.5, bpmSync: false, legato: false },
      { attack: 0.01, hold: 0, decay: 0.6, sustain: 0, release: 0.15, aCurve: -0.4, dCurve: -0.5, rCurve: -0.5, bpmSync: false, legato: false },
      { attack: 0.01, hold: 0, decay: 0.6, sustain: 0, release: 0.15, aCurve: -0.4, dCurve: -0.5, rCurve: -0.5, bpmSync: false, legato: false },
    ],
    lfos: Array.from({ length: 10 }, () => ({ mode: 'normal', points: [], pathPoints: [], chaosType: 'lorenz', rate: 2, sync: true, syncRate: 7, trigMode: 'trig', rise: 0, delay: 0, smooth: 0, swing: 0, gridX: 8, gridY: 8, bipolar: false })),
    macros: Array(8).fill(0), macroNames: [],
    matrix: [
      { id: 'r1', source: 'lfo1', dest: 'f1.cutoff', amount: 0.3, bipolar: false, aux: 'none', auxAmount: 0, curve: null, bypass: false },
      { id: 'r2', source: 'env2', dest: 'osc0.wt.pos', amount: 0.5, bipolar: false, aux: 'none', auxAmount: 0, curve: null, bypass: false },
    ],
    fxMain: [], fxBus1: [], fxBus2: [], bus1Return: 1, bus2Return: 1,
    arp: { on: false, mode: 'up', octaves: 1, syncRate: 10, gate: 0.8, swing: 0, hold: false, transpose: 0, pattern: [], scaleLock: false },
    clips: [], activeClip: -1, clipMode: false, userTables: {},
  }
}

const p = new global.__cls()
const patch = makePatch()

// saw table 4 frames morphing to sine
const frames = 4, data = new Float32Array(frames * 2048)
for (let f = 0; f < frames; f++) for (let i = 0; i < 2048; i++) {
  const saw = 1 - 2 * i / 2048, sine = Math.sin(2 * Math.PI * i / 2048)
  data[f * 2048 + i] = saw * (1 - f / 3) + sine * (f / 3)
}
p.onMessage({ type: 'ranges', ranges: { 'f1.cutoff': [0, 1], 'osc0.wt.pos': [0, 1] } })
p.onMessage({ type: 'table', id: 'basic', frames, data })
p.onMessage({ type: 'patch', patch })

// sample for sample/granular osc
const slen = 48000
const sl = new Float32Array(slen)
for (let i = 0; i < slen; i++) sl[i] = Math.sin(2 * Math.PI * 220 * i / 48000) * Math.exp(-i / 20000)
p.onMessage({ type: 'sample', id: 'smp1', sr: 48000, len: slen, l: sl, r: null })

// spectral frames (fake analysis: single harmonic)
const bins = 1025, sframes = 20
const mags = new Float32Array(sframes * bins)
for (let f = 0; f < sframes; f++) { mags[f * bins + 10] = 1; mags[f * bins + 20] = 0.5 }
p.onMessage({ type: 'spectral', id: 'smp1', frames: sframes, bins, hop: 512, sr: 48000, mags })

function run(blocks, label) {
  let peak = 0, bad = false
  for (let b = 0; b < blocks; b++) {
    const L = new Float32Array(128), R = new Float32Array(128)
    p.process([], [[L, R]])
    for (let i = 0; i < 128; i++) {
      if (!isFinite(L[i]) || !isFinite(R[i])) bad = true
      const a = Math.abs(L[i])
      if (a > peak) peak = a
    }
  }
  console.log(label, 'peak=', peak.toFixed(4), bad ? 'HAS NaN/Inf !!!' : 'clean')
  return peak
}

// wavetable
p.noteOn(60, 0.9, false)
const wtPeak = run(50, 'wavetable+lp24+mod')
p.noteOff(60, false)
run(60, 'release tail')
if (wtPeak < 0.01) { console.error('FAIL: no wavetable output'); process.exit(1) }

// unison + warp
patch.oscs[0].unison = 7
patch.oscs[0].wt.warp1 = { mode: 'sync', amount: 0.4 }
patch.oscs[0].wt.warp2 = { mode: 'saturate', amount: 0.5 }
p.onMessage({ type: 'patch', patch })
p.noteOn(48, 0.9, false)
const uniPeak = run(30, 'unison7+warps')
p.noteOff(48, false); run(60, '')
if (uniPeak < 0.01) { console.error('FAIL: no unison output'); process.exit(1) }

// sample engine
patch.oscs[0].engine = 'sample'
patch.oscs[0].smp.sampleId = 'smp1'
patch.oscs[0].smp.loopMode = 'loop'
p.onMessage({ type: 'patch', patch })
p.noteOn(60, 0.9, false)
const smpPeak = run(40, 'sample loop')
p.noteOff(60, false); run(60, '')
if (smpPeak < 0.001) { console.error('FAIL: no sample output'); process.exit(1) }

// granular
patch.oscs[0].engine = 'granular'
patch.oscs[0].gran.sampleId = 'smp1'
p.onMessage({ type: 'patch', patch })
p.noteOn(60, 0.9, false)
const grPeak = run(80, 'granular')
p.noteOff(60, false); run(60, '')
if (grPeak < 0.001) { console.error('FAIL: no granular output'); process.exit(1) }

// spectral
patch.oscs[0].engine = 'spectral'
patch.oscs[0].spec.sampleId = 'smp1'
p.onMessage({ type: 'patch', patch })
p.noteOn(60, 0.9, false)
const spPeak = run(80, 'spectral')
p.noteOff(60, false); run(60, '')
if (spPeak < 0.0001) { console.error('FAIL: no spectral output'); process.exit(1) }

// FX chain: distortion -> chorus -> delay -> reverb + splitter with eq / compressor busses
patch.oscs[0].engine = 'wavetable'
patch.fxMain = [
  { id: 'fx1', type: 'distortion', enabled: true, mix: 1, params: { mode: 0, drive: 0.4, filterPos: 0, filterType: 0, cutoff: 0.7, res: 0.2 } },
  { id: 'fx2', type: 'chorus', enabled: true, mix: 0.5, params: { rate: 0.4, depth: 0.4, delay: 8, feedback: 0.2, lpf: 0.8, voices: 2 } },
  { id: 'fx3', type: 'delay', enabled: true, mix: 0.3, params: { timeL: 9, timeR: 10, sync: 1, freeMs: 350, feedback: 0.4, pingpong: 1, lpf: 0.75, hpf: 0.1, tape: 0.3 } },
  { id: 'fx4', type: 'reverb', enabled: true, mix: 0.3, params: { mode: 0, size: 0.5, decay: 0.5, damp: 0.4, predelay: 10, width: 1, lowcut: 0.1 } },
  { id: 'fx5', type: 'splitLMH', enabled: true, mix: 1, params: { xlo: 0.3, xhi: 0.65 }, chains: [
    [{ id: 'fx6', type: 'compressor', enabled: true, mix: 1, params: { threshold: -20, ratio: 4, attack: 10, release: 120, makeup: 2, multiband: 0, loFreq: 0.25, hiFreq: 0.7 } }],
    [{ id: 'fx7', type: 'eq', enabled: true, mix: 1, params: { f1: 0.2, g1: 3, q1: 0.8, t1: 1, f2: 0.75, g2: -2, q2: 0.8, t2: 1 } }],
    [{ id: 'fx8', type: 'phaser', enabled: true, mix: 0.6, params: { rate: 0.3, depth: 0.6, freq: 0.5, feedback: 0.5, stages: 6, phase: 45 } }],
  ] },
  { id: 'fx9', type: 'echobode', enabled: true, mix: 0.25, params: { shift: 120, time: 7, sync: 1, feedback: 0.5, diffusion: 0.3, lfoRate: 0.3, lfoAmt: 0.2 } },
  { id: 'fx10', type: 'convolve', enabled: true, mix: 0.25, params: { ir: 1, size: 0.5, predelay: 0, damp: 0.3, width: 1 } },
  { id: 'fx11', type: 'hyper', enabled: true, mix: 0.4, params: { rate: 0.6, detune: 0.35, unison: 4, retrig: 0, dimSize: 0.4, dimMix: 0.3 } },
  { id: 'fx12', type: 'octaver', enabled: true, mix: 0.3, params: { sub: 0.5, up: 0.2, dry: 1 } },
  { id: 'fx13', type: 'bitcrush', enabled: true, mix: 0.2, params: { bits: 10, downsample: 2 } },
  { id: 'fx14', type: 'flanger', enabled: true, mix: 0.3, params: { rate: 0.25, depth: 0.6, feedback: 0.6, phase: 90, center: 0.3 } },
  { id: 'fx15', type: 'utility', enabled: true, mix: 1, params: { gain: -1, pan: 0, width: 1.2 } },
  { id: 'fx16', type: 'filter', enabled: true, mix: 1, params: { type: 1, cutoff: 0.8, res: 0.2, drive: 0, fat: 0.5, pan: 0 } },
]
p.onMessage({ type: 'patch', patch })
p.noteOn(55, 0.9, false)
const t0 = Date.now()
const fxPeak = run(200, 'full FX gauntlet')
const ms = Date.now() - t0
console.log('200 blocks (0.53s audio) rendered in', ms, 'ms -> RT ratio', (ms / 533).toFixed(2))
p.noteOff(55, false); run(60, '')
if (fxPeak < 0.001) { console.error('FAIL: no FX output'); process.exit(1) }

// arp + all filter types sweep
patch.fxMain = []
patch.arp.on = true
p.onMessage({ type: 'patch', patch })
p.noteOn(60, 0.9, false); p.noteOn(64, 0.9, false); p.noteOn(67, 0.9, false)
p.onMessage({ type: 'transport', playing: true, bpm: 128 })
const arpPeak = run(200, 'arp')
if (arpPeak < 0.01) { console.error('FAIL: arp silent'); process.exit(1) }
p.onMessage({ type: 'allOff' })
patch.arp.on = false

const FT = ['lp6','lp12','lp18','lp24','hp6','hp12','hp24','bp12','bp24','notch12','peak12','multiLBH','multiLNH','morphSVF','ladder12','ladder24','germanLP','frenchLP','formant','combPlus','combMinus','flangePlus','flangeMinus','phasePlus','phaseMinus','ringMod','sampHold','downsample','reverbFilter','dj','diffuser']
for (const ft of FT) {
  patch.filters[0].type = ft
  p.onMessage({ type: 'patch', patch })
  p.noteOn(60, 0.9, false)
  const pk = run(20, 'filter ' + ft)
  p.onMessage({ type: 'panic' })
  if (!isFinite(pk)) { console.error('FAIL filter', ft); process.exit(1) }
}
console.log('ALL SMOKE TESTS PASSED')
