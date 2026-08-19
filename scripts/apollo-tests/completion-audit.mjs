// Apollo engine test harness — runs the worklet in plain Node (no browser).
// Part of the repo test suite: `npm run test:apollo`.
// Apollo audio-effectiveness audit: A/B renders through the real engine.js
// with a sample loaded, verifying every filter/control audibly changes the
// output in the expected direction.
global.sampleRate = 48000
global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: () => {}, onmessage: null } } }
global.registerProcessor = (name, cls) => { global.__cls = cls }
await import(new URL('../../public/apollo/engine.js', import.meta.url).href)
const { PARAMS, FX_DEFS } = await import('/Users/brae/.claude/jobs/0055fedb/tmp/patch.ts')
const { generateFactoryTable } = await import(new URL('../../lib/apollo/tables.ts', import.meta.url).href)

const SR = 48000
// ---------- broadband loopable test sample: saw 110 + saw 223 + noise ----------
const SLEN = SR * 2
const sampL = new Float32Array(SLEN), sampR = new Float32Array(SLEN)
let seed = 123456789
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1 }
for (let i = 0; i < SLEN; i++) {
  const t = i / SR
  const v = ((t * 110 % 1) * 2 - 1) * 0.5 + ((t * 223 % 1) * 2 - 1) * 0.25 + rnd() * 0.12
  sampL[i] = v; sampR[i] = v
}

// tonal sample (sine 220 + weak 2nd harmonic) for pitch-sensitive tests
const toneL = new Float32Array(SLEN)
for (let i = 0; i < SLEN; i++) { const t = i / SR; toneL[i] = Math.sin(2 * Math.PI * 220 * t) * 0.6 + Math.sin(2 * Math.PI * 440 * t) * 0.15 }

// ---------- base patch ----------
function basePatch() {
  const warp = () => ({ mode: 'off', amount: 0 })
  const osc = (en) => ({
    enabled: en, engine: 'sample', level: 0.75, pan: 0, octave: 0, semi: 0, fine: 0,
    unison: 1, detune: 0.15, blend: 0.5, width: 1, phase: 0, rand: 0, stereo: 0.5,
    keytrackPitch: true, unisonMode: 'classic', dest: 'f1', filterBal: 0, bus: 'main',
    wt: { tableId: 'basic-shapes', pos: 0, interp: 'smooth', warp1: warp(), warp2: warp(), fmSource: 1, remapCurve: null },
    smp: { sampleId: 'smp', start: 0, end: 1, loopMode: 'loop', loopStart: 0.1, loopEnd: 0.9, xfade: 0.01, rate: 1, keytrack: true, rootKey: 60, slices: [], sliceMap: 'off', warp1: warp(), warp2: warp() },
    gran: { sampleId: 'smp', density: 25, length: 80, scan: 1, pos: 0.2, spray: 0.05, direction: 'fwd', pitchRand: 0, panRand: 0, windowShape: 0.5, windowSkew: 0, windowAmount: 1, loopGrains: true, manual: false, keytrack: true, rootKey: 60 },
    spec: { sampleId: 'smp', speed: 1, freeze: false, pos: 0.2, smear: 0, shift: 0, pitchShift: 0, formant: 0, spread: 0, gate: 0, filterCurve: Array(64).fill(1), transients: 0.5, keytrack: true, rootKey: 60 },
    ms: { name: '', zones: [] },
  })
  return {
    version: 1, name: 't', author: '', tags: [],
    global: { poly: 16, mode: 'poly', glide: 0, glideLegatoOnly: true, pbRange: 2, masterGain: 0.8, bpm: 120, quality: 'good', voiceSpreadPan: 0, voiceSpreadTune: 0, voiceSpreadCutoff: 0, scaleRoot: 0, scaleName: 'Minor', scaleLock: false, masterTune: 0 },
    oscs: [osc(true), osc(false), osc(false)],
    sub: { enabled: false, shape: 'sine', octave: -1, level: 0.5, pan: 0, direct: false, dest: 'f1', filterBal: 0, bus: 'main' },
    noise: { enabled: false, sampleId: 'smp', level: 0.5, pan: 0, pitch: 0, keytrack: false, oneShot: false, phase: 0, rand: 0, dest: 'f1', filterBal: 0, bus: 'main' },
    filters: [
      { enabled: false, type: 'lp12', cutoff: 0.8, res: 0.15, drive: 0, fat: 0.5, mix: 1, pan: 0, keytrack: 0 },
      { enabled: false, type: 'lp12', cutoff: 0.8, res: 0.15, drive: 0, fat: 0.5, mix: 1, pan: 0, keytrack: 0 },
    ],
    filterRouting: 'serial',
    envs: [
      { attack: 0.002, hold: 0, decay: 0.6, sustain: 1, release: 0.05, aCurve: 0, dCurve: 0, rCurve: 0, bpmSync: false, legato: false },
      { attack: 0.01, hold: 0, decay: 0.4, sustain: 0, release: 0.15, aCurve: 0, dCurve: 0, rCurve: 0, bpmSync: false, legato: false },
      { attack: 0.01, hold: 0, decay: 0.6, sustain: 0, release: 0.15, aCurve: 0, dCurve: 0, rCurve: 0, bpmSync: false, legato: false },
      { attack: 0.01, hold: 0, decay: 0.6, sustain: 0, release: 0.15, aCurve: 0, dCurve: 0, rCurve: 0, bpmSync: false, legato: false },
    ],
    lfos: Array.from({ length: 10 }, () => ({ mode: 'normal', points: [], pathPoints: [], chaosType: 'lorenz', rate: 5, sync: false, syncRate: 7, trigMode: 'trig', rise: 0, delay: 0, smooth: 0, swing: 0, gridX: 8, gridY: 8, bipolar: false, phase: 0 })),
    macros: Array(8).fill(0), macroNames: [],
    matrix: [],
    fxMain: [], fxBus1: [], fxBus2: [], bus1Return: 1, bus2Return: 1,
    arp: { on: false, mode: 'up', octaves: 1, syncRate: 10, gate: 0.8, swing: 0, hold: false, transpose: 0, pattern: [], scaleLock: false },
    clips: [], activeClip: -1, clipMode: false, userTables: {},
  }
}

// ---------- render helper ----------
const t0 = generateFactoryTable('basic-shapes')
function render(mutate, opts = {}) {
  const { note = 60, holdBlocks = 150, tailBlocks = 0, note2 = null, luts = null } = opts
  const patch = basePatch()
  mutate(patch)
  const p = new global.__cls()
  const ranges = {}
  for (const pd of PARAMS) ranges[pd.path] = [pd.min, pd.max]
  const walk = (units) => { for (const u of units) { ranges[`fx.${u.id}.mix`] = [0, 1]; for (const pp of (FX_DEFS[u.type]?.params || [])) ranges[`fx.${u.id}.${pp.key}`] = [pp.min, pp.max]; if (u.chains) u.chains.forEach(walk) } }
  walk(patch.fxMain); walk(patch.fxBus1); walk(patch.fxBus2)
  p.onMessage({ type: 'ranges', ranges })
  p.onMessage({ type: 'table', id: 'basic-shapes', frames: t0.frames, data: t0.data })
  p.onMessage({ type: 'sample', id: 'smp', sr: SR, len: SLEN, l: sampL, r: sampR })
  p.onMessage({ type: 'sample', id: 'tone', sr: SR, len: SLEN, l: toneL, r: null })
  if (luts) for (const l of luts) p.onMessage(l)
  p.onMessage({ type: 'patch', patch })
  p.noteOn(note, 0.9, false)
  if (note2 != null) p.noteOn(note2, 0.9, false)
  const total = holdBlocks + tailBlocks
  const L = new Float32Array(total * 128), R = new Float32Array(total * 128)
  for (let b = 0; b < total; b++) {
    if (b === holdBlocks) { p.noteOff(note, false); if (note2 != null) p.noteOff(note2, false) }
    const oL = new Float32Array(128), oR = new Float32Array(128)
    p.process([], [[oL, oR]])
    L.set(oL, b * 128); R.set(oR, b * 128)
  }
  return { L, R, holdSamples: holdBlocks * 128 }
}

// ---------- metrics ----------
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr
      }
    }
  }
}
function analyze(out) {
  const { L, R, holdSamples } = out
  const N = 8192
  const off = Math.min(holdSamples - N, Math.max(0, holdSamples - N - 2048))
  const re = new Float32Array(N), im = new Float32Array(N)
  for (let i = 0; i < N; i++) re[i] = ((L[off + i] || 0) + (R[off + i] || 0)) * 0.5 * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N))
  fft(re, im)
  const bins = N / 2
  let cSum = 0, mSum = 0
  const bands = [0, 0, 0, 0] // <300, 300-1200, 1200-4000, >4000 Hz
  for (let b = 1; b < bins; b++) {
    const m = Math.hypot(re[b], im[b])
    const f = b * SR / N
    cSum += f * m; mSum += m
    if (f < 300) bands[0] += m * m
    else if (f < 1200) bands[1] += m * m
    else if (f < 4000) bands[2] += m * m
    else bands[3] += m * m
  }
  const centroid = mSum > 1e-9 ? cSum / mSum : 0
  let rmsL = 0, rmsR = 0, peak = 0
  for (let i = 0; i < holdSamples; i++) { rmsL += L[i] * L[i]; rmsR += R[i] * R[i]; peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i])) }
  rmsL = Math.sqrt(rmsL / holdSamples); rmsR = Math.sqrt(rmsR / holdSamples)
  // amplitude-envelope variance (AM detection): block RMS over hold
  const bl = []
  for (let b = 8; b < Math.floor(holdSamples / 1024); b++) {
    let e = 0
    for (let i = b * 1024; i < (b + 1) * 1024; i++) e += L[i] * L[i]
    bl.push(Math.sqrt(e / 1024))
  }
  const mean = bl.reduce((a, v) => a + v, 0) / Math.max(1, bl.length)
  const amVar = mean > 1e-6 ? Math.sqrt(bl.reduce((a, v) => a + (v - mean) * (v - mean), 0) / Math.max(1, bl.length)) / mean : 0
  // tail energy after note-off
  let tail = 0
  for (let i = holdSamples; i < L.length; i++) tail += L[i] * L[i] + R[i] * R[i]
  tail = Math.sqrt(tail / Math.max(1, L.length - holdSamples))
  let pkBin = 1, pkMag = 0
  for (let b = 1; b < bins; b++) { const m = Math.hypot(re[b], im[b]); if (m > pkMag) { pkMag = m; pkBin = b } }
  const peakFreq = pkBin * SR / N
  const bandTot = bands.reduce((a, v) => a + v, 0) || 1e-12
  return { centroid, peakFreq, rms: (rmsL + rmsR) / 2, rmsL, rmsR, peak, amVar, tail, bands: bands.map(x => x / bandTot) }
}
const specDist = (a, b) => a.bands.reduce((s, v, i) => s + Math.abs(v - b.bands[i]), 0)

// ---------- test runner ----------
const results = []
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail })
  console.log((cond ? ' PASS ' : '*FAIL*') + ' ' + name + (detail ? '  [' + detail + ']' : ''))
}
const A = (mutate, opts) => analyze(render(mutate, opts))
const base = A(() => {})


// ---- completion checks for former approximations ----
const results2 = []
const check2 = (name, cond, detail) => { results2.push(cond); console.log((cond ? ' PASS ' : '*FAIL*') + ' ' + name + '  [' + detail + ']') }

// 1) per-filter bus routing: F1 -> bus1 with return 0 silences the filtered path
const fb1 = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].bus = 'bus1'; pp.bus1Return = 0 })
check2('filter bus assignment (F1->bus1, return 0 = silent)', fb1.rms < 0.005, 'rms=' + fb1.rms.toFixed(4))
const fb2 = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].bus = 'bus1'; pp.bus1Return = 1 })
check2('filter bus assignment (return 1 = audible)', fb2.rms > 0.02, 'rms=' + fb2.rms.toFixed(3))

// 2) parallel filters on different buses
const par = A(pp => {
  pp.filterRouting = 'parallel'
  pp.oscs[0].dest = 'both'; pp.oscs[0].filterBal = 0.5
  pp.filters[0] = { ...pp.filters[0], enabled: true, type: 'lp24', cutoff: 0.3, bus: 'main' }
  pp.filters[1] = { ...pp.filters[1], enabled: true, type: 'hp24', cutoff: 0.55, bus: 'bus1' }
  pp.bus1Return = 0
})
check2('parallel per-filter buses (HP muted => dark output)', par.centroid < base.centroid * 0.55, par.centroid.toFixed(0) + 'Hz vs ' + base.centroid.toFixed(0) + 'Hz')

// 3) osc stereo parameter
const widthOf = (m) => Math.abs(m.rmsL - m.rmsR) / (m.rmsL + m.rmsR + 1e-9)
const stWide = A(pp => { pp.oscs[0].engine = 'wavetable'; pp.oscs[0].unison = 7; pp.oscs[0].detune = 0.4; pp.oscs[0].stereo = 1; pp.oscs[0].rand = 0.7 })
const stMono = A(pp => { pp.oscs[0].engine = 'wavetable'; pp.oscs[0].unison = 7; pp.oscs[0].detune = 0.4; pp.oscs[0].stereo = 0; pp.oscs[0].rand = 0.7 })
const chanDiff = (m) => { return m } // width via per-channel spectra approx: use rms diff over time? use amVar? simplest: L/R rms diff
check2('osc stereo knob narrows unison image', widthOf(stMono) <= widthOf(stWide) + 0.001 && Math.abs(stMono.rmsL - stMono.rmsR) < Math.abs(stWide.rmsL - stWide.rmsR) + 1e-4, 'w ' + widthOf(stWide).toFixed(4) + ' -> ' + widthOf(stMono).toFixed(4))

// stronger stereo check: correlation between channels
function corrOf(out) {
  const { L, R, holdSamples } = out
  let num = 0, dl = 0, dr = 0
  for (let i = 2048; i < holdSamples; i++) { num += L[i] * R[i]; dl += L[i] * L[i]; dr += R[i] * R[i] }
  return num / Math.sqrt(dl * dr + 1e-12)
}
const oWide = render(pp => { pp.oscs[0].engine = 'wavetable'; pp.oscs[0].unison = 7; pp.oscs[0].detune = 0.4; pp.oscs[0].stereo = 1; pp.oscs[0].rand = 0.7 })
const oMono = render(pp => { pp.oscs[0].engine = 'wavetable'; pp.oscs[0].unison = 7; pp.oscs[0].detune = 0.4; pp.oscs[0].stereo = 0; pp.oscs[0].rand = 0.7 })
check2('osc stereo=0 collapses to mono (corr ~1)', corrOf(oMono) > 0.99 && corrOf(oWide) < 0.95, 'corr wide=' + corrOf(oWide).toFixed(3) + ' mono=' + corrOf(oMono).toFixed(3))

// 4) voiceSpreadTune detunes stacked voices
const vtOn = A(pp => { pp.global.voiceSpreadTune = 1; pp.global.poly = 8 }, { note: 60, note2: 60 })
const vtOff = A(pp => { pp.global.voiceSpreadTune = 0; pp.global.poly = 8 }, { note: 60, note2: 60 })
check2('voiceSpreadTune audible on stacked voices', specDist(vtOn, vtOff) > 0.003 || Math.abs(vtOn.amVar - vtOff.amVar) > 0.01, 'dist=' + specDist(vtOn, vtOff).toFixed(4) + ' amVar ' + vtOff.amVar.toFixed(3) + '->' + vtOn.amVar.toFixed(3))

// 5) draft quality caps unison (CPU) but still sounds
const draft = A(pp => { pp.global.quality = 'draft'; pp.oscs[0].engine = 'wavetable'; pp.oscs[0].unison = 16; pp.oscs[0].detune = 0.4 })
check2('draft quality audible', draft.rms > 0.02, 'rms=' + draft.rms.toFixed(3))

// 6) reverse-loop crossfade produces continuous audio
const revLoop = A(pp => { pp.oscs[0].smp.rate = -1; pp.oscs[0].smp.loopMode = 'loop'; pp.oscs[0].smp.xfade = 0.1 }, { holdBlocks: 200 })
check2('reverse loop with crossfade sustains', revLoop.rms > 0.02, 'rms=' + revLoop.rms.toFixed(3))

// 7) phase filters: two filters in series do NOT share feedback state (regression)
const dualPhase = A(pp => {
  pp.filterRouting = 'serial'
  pp.oscs[0].dest = 'both'; pp.oscs[0].filterBal = 0.5
  pp.filters[0] = { ...pp.filters[0], enabled: true, type: 'phasePlus', cutoff: 0.5, res: 0.7 }
  pp.filters[1] = { ...pp.filters[1], enabled: true, type: 'phaseMinus', cutoff: 0.4, res: 0.7 }
})
check2('dual phaser filters stable + audible', dualPhase.rms > 0.02 && isFinite(dualPhase.peak), 'rms=' + dualPhase.rms.toFixed(3))

console.log((results2.every(Boolean) ? 'ALL' : 'SOME FAILED —'), results2.filter(Boolean).length + '/' + results2.length, 'completion checks pass')
