// Apollo engine test harness — runs the worklet in plain Node (no browser).
// Part of the repo test suite: `npm run test:apollo`.
// Apollo audio-effectiveness audit: A/B renders through the real engine.js
// with a sample loaded, verifying every filter/control audibly changes the
// output in the expected direction.
global.sampleRate = 48000
global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: () => {}, onmessage: null } } }
global.registerProcessor = (name, cls) => { global.__cls = cls }
await import(new URL('../../public/apollo/engine.js', import.meta.url).href)
// Through importTs: patch.ts imports '@/lib/...', an alias Node cannot resolve,
// so importing it directly fails outright.
const { importTs } = await import(new URL('../lib/ts-import.mjs', import.meta.url).href)
const { PARAMS, FX_DEFS } = await importTs('lib/apollo/patch.ts')
const { generateFactoryTable } = await importTs('lib/apollo/tables.ts')

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

// ================= FILTERS: all 31 types =================
const FT = ['lp6','lp12','lp18','lp24','hp6','hp12','hp24','bp12','bp24','notch12','peak12','multiLBH','multiLNH','morphSVF','ladder12','ladder24','germanLP','frenchLP','formant','combPlus','combMinus','flangePlus','flangeMinus','phasePlus','phaseMinus','ringMod','sampHold','downsample','reverbFilter','dj','diffuser']
for (const ft of FT) {
  const m = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = ft; pp.filters[0].cutoff = 0.42; pp.filters[0].res = 0.35 })
  check(`filter ${ft} changes spectrum`, specDist(m, base) > 0.04 || Math.abs(m.rms - base.rms) / base.rms > 0.12, `dist=${specDist(m, base).toFixed(3)}`)
}
// directional: lp24 cutoff up = brighter; hp12 cutoff up = darker lows
{
  const lo = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].cutoff = 0.25 })
  const hi = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].cutoff = 0.85 })
  check('lp24 cutoff raises centroid', hi.centroid > lo.centroid * 1.5, `${lo.centroid.toFixed(0)}Hz -> ${hi.centroid.toFixed(0)}Hz`)
  const hlo = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'hp12'; pp.filters[0].cutoff = 0.2 })
  const hhi = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'hp12'; pp.filters[0].cutoff = 0.6 })
  check('hp12 cutoff strips lows', hhi.bands[0] < hlo.bands[0] * 0.6, `low band ${hlo.bands[0].toFixed(3)} -> ${hhi.bands[0].toFixed(3)}`)
}
// filter params
{
  const f = (mut) => A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].cutoff = 0.45; mut(pp.filters[0], pp) })
  const noRes = f(fl => { fl.res = 0 }), hiRes = f(fl => { fl.res = 0.85 })
  check('filter res audible', specDist(noRes, hiRes) > 0.03 || Math.abs(hiRes.peak - noRes.peak) / noRes.peak > 0.15, `dist=${specDist(noRes, hiRes).toFixed(3)}`)
  const noDrv = f(fl => { fl.drive = 0 }), hiDrv = f(fl => { fl.drive = 0.9 })
  check('filter drive audible', Math.abs(hiDrv.rms - noDrv.rms) / noDrv.rms > 0.1 || specDist(noDrv, hiDrv) > 0.03, `rms ${noDrv.rms.toFixed(3)} -> ${hiDrv.rms.toFixed(3)}`)
  const mix0 = f(fl => { fl.mix = 0 })
  check('filter mix=0 = dry', specDist(mix0, base) < 0.02, `dist=${specDist(mix0, base).toFixed(3)}`)
  const panL = f(fl => { fl.pan = -1 }), panR = f(fl => { fl.pan = 1 })
  check('filter pan offsets channels', Math.abs(panL.rmsL - panL.rmsR) > 1e-4 || specDist(panL, panR) > 0.005, `dist=${specDist(panL, panR).toFixed(3)}`)
  const ktLow = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].cutoff = 0.35; pp.filters[0].keytrack = 1 }, { note: 48 })
  const ktHi = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].cutoff = 0.35; pp.filters[0].keytrack = 1 }, { note: 84 })
  check('filter keytrack follows note', ktHi.centroid > ktLow.centroid * 1.1, `${ktLow.centroid.toFixed(0)} -> ${ktHi.centroid.toFixed(0)}Hz`)
  const morphA = f(fl => { fl.type = 'multiLBH'; fl.fat = 0 }), morphB = f(fl => { fl.type = 'multiLBH'; fl.fat = 1 })
  check('multi filter morph (fat) sweeps LP->HP', morphB.centroid > morphA.centroid * 1.3, `${morphA.centroid.toFixed(0)} -> ${morphB.centroid.toFixed(0)}Hz`)
  const vowA = f(fl => { fl.type = 'formant'; fl.fat = 0 }), vowU = f(fl => { fl.type = 'formant'; fl.fat = 1 })
  check('formant vowel morph audible', specDist(vowA, vowU) > 0.03, `dist=${specDist(vowA, vowU).toFixed(3)}`)
}
// serial vs parallel + F2 + routing buttons
{
  const both = (routing) => A(pp => {
    pp.filterRouting = routing
    pp.filters[0] = { ...pp.filters[0], enabled: true, type: 'lp24', cutoff: 0.35 }
    pp.filters[1] = { ...pp.filters[1], enabled: true, type: 'hp12', cutoff: 0.45 }
    pp.oscs[0].dest = 'both'; pp.oscs[0].filterBal = 0.5
  })
  const ser = both('serial'), par = both('parallel')
  check('serial vs parallel routing differs', specDist(ser, par) > 0.05, `dist=${specDist(ser, par).toFixed(3)}`)
  const f2only = A(pp => { pp.filters[1] = { ...pp.filters[1], enabled: true, type: 'lp24', cutoff: 0.3 }; pp.oscs[0].dest = 'f2' })
  check('filter 2 works (dest=F2)', specDist(f2only, base) > 0.05, `dist=${specDist(f2only, base).toFixed(3)}`)
  const bypass = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].cutoff = 0.2; pp.oscs[0].dest = 'bypass' })
  check('dest=bypass skips filter (S/A/B/C/N buttons)', specDist(bypass, base) < 0.02, `dist=${specDist(bypass, base).toFixed(3)}`)
}

// ================= OSC common controls =================
{
  const lvl = A(pp => { pp.oscs[0].level = 0.2 })
  check('osc level', lvl.rms < base.rms * 0.5, `${base.rms.toFixed(3)} -> ${lvl.rms.toFixed(3)}`)
  const panned = A(pp => { pp.oscs[0].pan = -1 })
  check('osc pan hard left', panned.rmsL > panned.rmsR * 3, `L=${panned.rmsL.toFixed(3)} R=${panned.rmsR.toFixed(3)}`)
  const toneBase = A(pp => { pp.oscs[0].smp.sampleId = 'tone' })
  const up = A(pp => { pp.oscs[0].smp.sampleId = 'tone'; pp.oscs[0].semi = 12 })
  check('osc semi +12 shifts pitch up', Math.abs(up.peakFreq - toneBase.peakFreq * 2) < toneBase.peakFreq * 0.2, `${toneBase.peakFreq.toFixed(0)} -> ${up.peakFreq.toFixed(0)}Hz`)
  const oct = A(pp => { pp.oscs[0].smp.sampleId = 'tone'; pp.oscs[0].octave = -1 })
  check('osc octave -1 shifts down', Math.abs(oct.peakFreq - toneBase.peakFreq / 2) < toneBase.peakFreq * 0.2, `${toneBase.peakFreq.toFixed(0)} -> ${oct.peakFreq.toFixed(0)}Hz`)
  const fine = A(pp => { pp.oscs[0].fine = 50 })
  check('osc fine detunes', specDist(fine, base) > 0.005, `dist=${specDist(fine, base).toFixed(3)}`)
  const ktToneBase = A(pp => { pp.oscs[0].smp.sampleId = 'tone' })
  const ct = A(pp => { pp.oscs[0].smp.sampleId = 'tone'; pp.oscs[0].keytrackPitch = false }, { note: 84 })
  const kt = A(pp => { pp.oscs[0].smp.sampleId = 'tone' }, { note: 84 })
  check('const-pitch button ignores note', Math.abs(ct.peakFreq - ktToneBase.peakFreq) < 20 && kt.peakFreq > ktToneBase.peakFreq * 1.5, `const=${ct.peakFreq.toFixed(0)} tracked=${kt.peakFreq.toFixed(0)}Hz`)
}

// ================= SAMPLE engine controls =================
{
  const slow = A(pp => { pp.oscs[0].smp.rate = 0.5 })
  check('sample rate 0.5 darkens/slows', slow.centroid < base.centroid * 0.85, `${base.centroid.toFixed(0)} -> ${slow.centroid.toFixed(0)}Hz`)
  const rev = A(pp => { pp.oscs[0].smp.rate = -1 })
  check('sample reverse produces audio', rev.rms > 0.01, `rms=${rev.rms.toFixed(3)}`)
  const oneShot = A(pp => { pp.oscs[0].smp.loopMode = 'off'; pp.oscs[0].smp.end = 0.05 }, { holdBlocks: 150 })
  check('one-shot ends (loop off + short end)', oneShot.amVar > 0.5 || oneShot.rms < base.rms * 0.62, `rms=${oneShot.rms.toFixed(3)}`)
  const startLate = A(pp => { pp.oscs[0].smp.start = 0.5; pp.oscs[0].smp.loopMode = 'off' }, { holdBlocks: 40 })
  check('sample start offset plays', startLate.rms > 0.01, `rms=${startLate.rms.toFixed(3)}`)
  const warpSat = A(pp => { pp.oscs[0].smp.warp1 = { mode: 'saturate', amount: 0.9 } })
  check('sample warp: saturate', specDist(warpSat, base) > 0.02 || Math.abs(warpSat.rms - base.rms) / base.rms > 0.1, `dist=${specDist(warpSat, base).toFixed(3)}`)
  const warpPd = A(pp => { pp.oscs[0].smp.warp1 = { mode: 'pd', amount: 0.8 } })
  check('sample warp: PD fold', specDist(warpPd, base) > 0.02, `dist=${specDist(warpPd, base).toFixed(3)}`)
  const warpFm = A(pp => { pp.oscs[1].enabled = true; pp.oscs[1].engine = 'wavetable'; pp.oscs[1].level = 0; pp.oscs[0].smp.warp1 = { mode: 'fm', amount: 0.8 } })
  check('sample warp: FM from osc B', specDist(warpFm, base) > 0.02, `dist=${specDist(warpFm, base).toFixed(3)}`)
  const warpRm = A(pp => { pp.oscs[1].enabled = true; pp.oscs[1].engine = 'wavetable'; pp.oscs[1].level = 0; pp.oscs[0].smp.warp1 = { mode: 'rm', amount: 0.9 } })
  check('sample warp: RM', specDist(warpRm, base) > 0.02 || Math.abs(warpRm.rms - base.rms) / base.rms > 0.15, `dist=${specDist(warpRm, base).toFixed(3)} rms=${warpRm.rms.toFixed(3)}`)
}

// ================= GRANULAR controls =================
{
  const gbase = A(pp => { pp.oscs[0].engine = 'granular' })
  check('granular produces audio', gbase.rms > 0.01, `rms=${gbase.rms.toFixed(3)}`)
  const g = (mut) => A(pp => { pp.oscs[0].engine = 'granular'; mut(pp.oscs[0].gran) })
  const sparse = g(gc => { gc.density = 3; gc.length = 30 })
  check('grain density/length audible', sparse.amVar > gbase.amVar * 1.5, `amVar ${gbase.amVar.toFixed(3)} -> ${sparse.amVar.toFixed(3)}`)
  const sprayed = g(gc => { gc.spray = 0.9 })
  check('grain spray audible', specDist(sprayed, gbase) > 0.02 || Math.abs(sprayed.amVar - gbase.amVar) > 0.02, `dist=${specDist(sprayed, gbase).toFixed(3)}`)
  const pRand = g(gc => { gc.pitchRand = 12 })
  check('grain pitch random audible', specDist(pRand, gbase) > 0.02, `dist=${specDist(pRand, gbase).toFixed(3)}`)
  const panR = g(gc => { gc.panRand = 1 })
  const widthOf = (m) => Math.abs(m.rmsL - m.rmsR) / (m.rmsL + m.rmsR)
  check('grain pan random widens', panR.amVar !== gbase.amVar || widthOf(panR) !== widthOf(gbase), `w=${widthOf(panR).toFixed(3)}`)
  const win = g(gc => { gc.windowShape = 0; gc.windowAmount = 1; gc.density = 6; gc.length = 40 })
  const win2 = g(gc => { gc.windowShape = 1; gc.windowAmount = 1; gc.density = 6; gc.length = 40 })
  check('grain window shape audible', specDist(win, win2) > 0.005 || Math.abs(win.amVar - win2.amVar) > 0.01, `amVar ${win.amVar.toFixed(3)} vs ${win2.amVar.toFixed(3)}`)
  const manual = g(gc => { gc.manual = true; gc.pos = 0.5 })
  check('granular manual mode audible', manual.rms > 0.01, `rms=${manual.rms.toFixed(3)}`)
}

// ================= SPECTRAL controls =================
{
  // engine needs spectral analysis: send simple synthetic analysis of the sample? Use engine's own path:
  // we approximate by pre-analyzing via the spectral.ts analyzer
  const { analyzeSpectral } = await import(new URL('../../lib/apollo/spectral.ts', import.meta.url).href)
  const an = await analyzeSpectral(sampL, SR)
  const anTone = await analyzeSpectral(toneL, SR)
  const specToneMsg = { type: 'spectral', id: 'tone', frames: anTone.frames, bins: anTone.bins, hop: anTone.hop, sr: anTone.sr, mags: anTone.mags, phases: anTone.phases, onsets: anTone.onsets }
  const specMsg = { type: 'spectral', id: 'smp', frames: an.frames, bins: an.bins, hop: an.hop, sr: an.sr, mags: an.mags, phases: an.phases, onsets: an.onsets }
  const S = (mut, opts) => analyze(render(pp => { pp.oscs[0].engine = 'spectral'; mut(pp.oscs[0].spec) }, { ...opts, luts: [specMsg] }))
  const sbase = S(() => {})
  check('spectral produces audio', sbase.rms > 0.005, `rms=${sbase.rms.toFixed(4)}`)
  const ST = (mut) => analyze(render(pp => { pp.oscs[0].engine = 'spectral'; pp.oscs[0].spec.sampleId = 'tone'; mut(pp.oscs[0].spec) }, { luts: [specToneMsg] }))
  const stBase = ST(() => {})
  const pUp = ST(sc => { sc.pitchShift = 12 })
  check('spectral pitch shift +12', Math.abs(pUp.peakFreq - stBase.peakFreq * 2) < stBase.peakFreq * 0.3, `${stBase.peakFreq.toFixed(0)} -> ${pUp.peakFreq.toFixed(0)}Hz`)
  const shifted = S(sc => { sc.shift = 0.5 })
  check('spectral bin shift audible', specDist(shifted, sbase) > 0.03, `dist=${specDist(shifted, sbase).toFixed(3)}`)
  const form = S(sc => { sc.formant = -12 })
  check('spectral formant audible', specDist(form, sbase) > 0.015, `dist=${specDist(form, sbase).toFixed(3)}`)
  const spread = S(sc => { sc.spread = 0.8 })
  check('spectral spread audible', specDist(spread, sbase) > 0.01, `dist=${specDist(spread, sbase).toFixed(3)}`)
  const gated = S(sc => { sc.gate = 0.6 })
  check('spectral gate audible', specDist(gated, sbase) > 0.015 || gated.rms < sbase.rms * 0.8, `dist=${specDist(gated, sbase).toFixed(3)}`)
  const smeared = S(sc => { sc.smear = 0.9 })
  check('spectral smear audible', specDist(smeared, sbase) > 0.01 || Math.abs(smeared.amVar - sbase.amVar) > 0.02, `dist=${specDist(smeared, sbase).toFixed(3)}`)
  const curve = Array(64).fill(1).map((v, i) => (i > 20 ? 0 : 1)) // drawn low-pass
  const curved = S(sc => { sc.filterCurve = curve })
  check('spectral drawn filter curve', curved.centroid < sbase.centroid * 0.8, `${sbase.centroid.toFixed(0)} -> ${curved.centroid.toFixed(0)}Hz`)
  const frozen = S(sc => { sc.freeze = true; sc.pos = 0.3 })
  check('spectral freeze produces audio', frozen.rms > 0.003, `rms=${frozen.rms.toFixed(4)}`)
}

// ================= SUB + NOISE =================
{
  const solo = (mut) => A(pp => { pp.oscs[0].enabled = false; mut(pp) })
  const sub = solo(pp => { pp.sub.enabled = true })
  check('sub audible', sub.rms > 0.02, `rms=${sub.rms.toFixed(3)}`)
  const subSaw = solo(pp => { pp.sub.enabled = true; pp.sub.shape = 'saw' })
  check('sub shape changes spectrum', specDist(sub, subSaw) > 0.05, `dist=${specDist(sub, subSaw).toFixed(3)}`)
  const subOct = solo(pp => { pp.sub.enabled = true; pp.sub.octave = -2 })
  check('sub octave', subOct.centroid < sub.centroid, `${sub.centroid.toFixed(0)} -> ${subOct.centroid.toFixed(0)}Hz`)
  const noise = solo(pp => { pp.noise.enabled = true })
  check('noise audible', noise.rms > 0.02, `rms=${noise.rms.toFixed(3)}`)
  const noiseDn = solo(pp => { pp.noise.enabled = true; pp.noise.pitch = -12 })
  check('noise pitch knob', noiseDn.centroid < noise.centroid * 0.9, `${noise.centroid.toFixed(0)} -> ${noiseDn.centroid.toFixed(0)}Hz`)
  const subDirect = solo(pp => { pp.sub.enabled = true; pp.sub.direct = true; pp.filters[0].enabled = true; pp.filters[0].type = 'hp24'; pp.filters[0].cutoff = 0.9 })
  check('sub direct bypasses filter', subDirect.rms > sub.rms * 0.5, `rms=${subDirect.rms.toFixed(3)}`)
}

// ================= ENVELOPES =================
{
  const slowAtk = A(pp => { pp.envs[0].attack = 1.2 }, { holdBlocks: 150 })
  check('env attack slows onset', slowAtk.rms < base.rms * 0.85, `rms ${base.rms.toFixed(3)} -> ${slowAtk.rms.toFixed(3)}`)
  const rel = A(pp => { pp.envs[0].release = 1.5 }, { holdBlocks: 60, tailBlocks: 120 })
  const relShort = A(pp => { pp.envs[0].release = 0.01 }, { holdBlocks: 60, tailBlocks: 120 })
  check('env release length', rel.tail > relShort.tail * 3, `tail ${relShort.tail.toFixed(4)} -> ${rel.tail.toFixed(4)}`)
  const sus = A(pp => { pp.envs[0].sustain = 0.2; pp.envs[0].decay = 0.15 }, { holdBlocks: 150 })
  check('env decay/sustain', sus.rms < base.rms * 0.7, `rms=${sus.rms.toFixed(3)}`)
  const bpmA = A(pp => { pp.envs[0].attack = 0.8; pp.envs[0].bpmSync = true; pp.global.bpm = 60 }, { holdBlocks: 100 })
  const bpmB = A(pp => { pp.envs[0].attack = 0.8; pp.envs[0].bpmSync = true; pp.global.bpm = 240 }, { holdBlocks: 100 })
  check('env BPM sync scales times', bpmB.rms > bpmA.rms * 1.1, `rms ${bpmA.rms.toFixed(3)} -> ${bpmB.rms.toFixed(3)}`)
}

// ================= LFO + MATRIX =================
{
  const triLut = new Float32Array(257)
  for (let i = 0; i <= 256; i++) triLut[i] = i < 128 ? i / 128 : 2 - i / 128
  const lfoLut = { type: 'lfoLut', index: 0, main: triLut, y: null }
  const M = (rows, mutate = () => {}, opts = {}) => analyze(render(pp => { pp.matrix = rows; mutate(pp) }, { ...opts, luts: [lfoLut, ...(opts.luts || [])] }))
  const row = (over) => ({ id: 'r1', source: 'lfo1', dest: 'osc0.level', amount: 0.9, bipolar: true, aux: 'none', auxAmount: 0, curve: null, bypass: false, ...over })
  const tremolo = M([row({})], pp => { pp.lfos[0].rate = 6 })
  check('LFO->level = tremolo', tremolo.amVar > base.amVar * 3 + 0.02, `amVar ${base.amVar.toFixed(3)} -> ${tremolo.amVar.toFixed(3)}`)
  const zeroAmt = M([row({ amount: 0 })])
  check('matrix amount 0 = no effect', Math.abs(zeroAmt.amVar - base.amVar) < 0.02, `amVar=${zeroAmt.amVar.toFixed(3)}`)
  const bypassRow = M([row({ bypass: true })], pp => { pp.lfos[0].rate = 6 })
  check('matrix bypass works', Math.abs(bypassRow.amVar - base.amVar) < 0.02, `amVar=${bypassRow.amVar.toFixed(3)}`)
  const auxRow = M([row({ aux: 'macro1', auxAmount: 1 })], pp => { pp.lfos[0].rate = 6 })
  check('aux (macro=0) suppresses mod', auxRow.amVar < tremolo.amVar * 0.5, `amVar ${tremolo.amVar.toFixed(3)} -> ${auxRow.amVar.toFixed(3)}`)
  const slowLfo = M([row({})], pp => { pp.lfos[0].rate = 0.5 })
  check('LFO rate knob', Math.abs(slowLfo.amVar - tremolo.amVar) > 0.01, `amVar ${tremolo.amVar.toFixed(3)} vs ${slowLfo.amVar.toFixed(3)}`)
  const cutMod = M([row({ dest: 'f1.cutoff', amount: 0.6 })], pp => { pp.lfos[0].rate = 4; pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].cutoff = 0.4 })
  const cutStill = A(pp => { pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].cutoff = 0.4 })
  check('LFO->cutoff wobbles filter', cutMod.amVar > cutStill.amVar + 0.02 || specDist(cutMod, cutStill) > 0.03, `amVar ${cutStill.amVar.toFixed(3)} -> ${cutMod.amVar.toFixed(3)}`)
  const vel = analyze(render(pp => { pp.matrix = [row({ source: 'vel', dest: 'f1.cutoff', amount: -0.6, bipolar: false })]; pp.filters[0].enabled = true; pp.filters[0].type = 'lp24'; pp.filters[0].cutoff = 0.8 }))
  check('velocity as mod source', specDist(vel, cutStill) > 0.01 || vel.centroid < base.centroid, `centroid=${vel.centroid.toFixed(0)}Hz`)
}

// ================= MIXER / BUSES =================
{
  const toBus1Muted = A(pp => { pp.oscs[0].dest = 'bypass'; pp.oscs[0].bus = 'bus1'; pp.bus1Return = 0 })
  check('bus1 return 0 silences bus1 source', toBus1Muted.rms < 0.005, `rms=${toBus1Muted.rms.toFixed(4)}`)
  const toBus2 = A(pp => { pp.oscs[0].dest = 'bypass'; pp.oscs[0].bus = 'bus2'; pp.bus2Return = 0.5 })
  check('bus2 return scales level', toBus2.rms < base.rms * 0.75 && toBus2.rms > 0.01, `rms=${toBus2.rms.toFixed(3)}`)
  const master = A(pp => { pp.global.masterGain = 0.2 })
  check('master gain', master.rms < base.rms * 0.5, `rms=${master.rms.toFixed(3)}`)
  const busFx = A(pp => {
    pp.oscs[0].dest = 'bypass' // source-level bus applies to unfiltered sources
    pp.oscs[0].bus = 'bus1'
    pp.fxBus1 = [{ id: 'bd', type: 'distortion', enabled: true, mix: 1, params: { mode: 2, drive: 0.9, bias: 0, filterPos: 0, filterType: 0, cutoff: 0.7, res: 0.2 } }]
  })
  check('bus1 FX chain processes bus sources', specDist(busFx, base) > 0.02, `dist=${specDist(busFx, base).toFixed(3)}`)
}

// ================= FX: all 16 + splitters =================
const fxUnit = (type, params, mix = 1) => ({ id: 'u_' + type, type, enabled: true, mix, params })
const FXCASES = [
  ['hyper', { rate: 0.6, detune: 0.8, unison: 6, retrig: 0, dimSize: 0.6, dimMix: 0.6 }, m => specDist(m, base) > 0.01 || Math.abs(m.rmsL - m.rmsR) > 0.001],
  ['distortion', { mode: 2, drive: 0.85, bias: 0, filterPos: 0, filterType: 0, cutoff: 0.7, res: 0.2 }, m => specDist(m, base) > 0.03],
  ['echobode', { shift: 300, time: 7, sync: 0, feedback: 0.6, diffusion: 0.4, lfoRate: 0.3, lfoAmt: 0 }, m => specDist(m, base) > 0.02],
  ['chorus', { rate: 1.5, depth: 0.8, delay: 12, feedback: 0.3, lpf: 0.8, voices: 3 }, m => specDist(m, base) > 0.01 || m.amVar > base.amVar + 0.01],
  ['flanger', { rate: 0.8, depth: 0.9, feedback: 0.8, phase: 90, center: 0.3 }, m => specDist(m, base) > 0.02],
  ['phaser', { rate: 1, depth: 0.9, freq: 0.5, feedback: 0.8, stages: 8, phase: 45 }, m => specDist(m, base) > 0.02],
  ['delay', { timeL: 10, timeR: 10, sync: 1, freeMs: 350, feedback: 0.75, pingpong: 0, lpf: 0.9, hpf: 0.05, tape: 0 }, (m, tails) => tails.tail > tails.dryTail * 1.6],
  ['compressor', { threshold: -30, ratio: 12, attack: 2, release: 80, makeup: 0, multiband: 0, loFreq: 0.25, hiFreq: 0.7 }, m => m.peak / m.rms < base.peak / base.rms * 0.95 || m.rms < base.rms * 0.9],
  ['convolve', { ir: 1, size: 0.6, predelay: 0, damp: 0.3, width: 1 }, (m, tails) => tails.tail > tails.dryTail * 1.5],
  ['reverb', { mode: 0, size: 0.7, decay: 0.8, damp: 0.3, predelay: 10, width: 1, lowcut: 0.1 }, (m, tails) => tails.tail > tails.dryTail * 1.5],
  ['eq', { f1: 0.2, g1: -14, q1: 0.8, t1: 1, f2: 0.75, g2: 10, q2: 0.8, t2: 1 }, m => specDist(m, base) > 0.05],
  ['filter', { type: 3, cutoff: 0.3, res: 0.3, drive: 0, fat: 0.5, pan: 0 }, m => m.centroid < base.centroid * 0.8],
  ['utility', { gain: -12, pan: 0, width: 1 }, m => m.rms < base.rms * 0.5],
  ['octaver', { sub: 1, up: 0, dry: 0.3 }, m => { const hiBase = A(() => {}, { note: 84 }); return m.bands[0] > hiBase.bands[0] * 1.3 || specDist(m, hiBase) > 0.05 }],
  ['bitcrush', { bits: 4, downsample: 8 }, m => specDist(m, base) > 0.03],
]
for (const [type, params, judge] of FXCASES) {
  const withTail = ['delay', 'convolve', 'reverb'].includes(type)
  const note = type === 'octaver' ? 84 : 60
  const out = render(pp => { pp.fxMain = [fxUnit(type, params, ['delay', 'convolve', 'reverb', 'echobode'].includes(type) ? 0.5 : 1)] }, { note, holdBlocks: 100, tailBlocks: withTail ? 200 : 0 })
  const m = analyze(out)
  const dry = withTail ? render(() => {}, { holdBlocks: 100, tailBlocks: 200 }) : null
  const tails = withTail ? { tail: m.tail, dryTail: analyze(dry).tail } : null
  check(`fx ${type}`, judge(m, tails), tails ? `tail ${tails.dryTail.toFixed(4)} -> ${tails.tail.toFixed(4)}` : `dist=${specDist(m, base).toFixed(3)} rms=${m.rms.toFixed(3)}`)
}
// splitter: compressing only lows shouldn't kill highs
{
  const split = A(pp => {
    pp.fxMain = [{ id: 'sp', type: 'splitLH', enabled: true, mix: 1, params: { xover: 0.55 }, chains: [
      [fxUnit('utility', { gain: -30, pan: 0, width: 1 })], [],
    ] }]
  })
  check('splitter low-band-only processing', split.bands[0] < base.bands[0] * 0.5 && split.bands[3] > base.bands[3] * 0.5, `low ${base.bands[0].toFixed(3)}->${split.bands[0].toFixed(3)} high ${base.bands[3].toFixed(3)}->${split.bands[3].toFixed(3)}`)
  const ms = A(pp => {
    pp.oscs[0].unison = 4; pp.oscs[0].detune = 0.4
    pp.fxMain = [{ id: 'ms', type: 'splitMS', enabled: true, mix: 1, params: {}, chains: [
      [], [fxUnit('utility', { gain: -40, pan: 0, width: 1 })],
    ] }]
  })
  const wide = A(pp => { pp.oscs[0].unison = 4; pp.oscs[0].detune = 0.4 })
  const widthOf = (m) => { return m.rmsL + m.rmsR > 0 ? Math.abs(m.rmsL - m.rmsR) : 0 }
  check('mid/side splitter kills sides', ms.rms > 0.01, `rms=${ms.rms.toFixed(3)}`)
}
// fx enable=false + mix=0
{
  const disabled = A(pp => { pp.fxMain = [{ ...fxUnit('distortion', { mode: 2, drive: 0.9, bias: 0, filterPos: 0, filterType: 0, cutoff: 0.7, res: 0.2 }), enabled: false }] })
  check('fx enable toggle', specDist(disabled, base) < 0.01, `dist=${specDist(disabled, base).toFixed(3)}`)
  const mix0 = A(pp => { pp.fxMain = [fxUnit('distortion', { mode: 2, drive: 0.9, bias: 0, filterPos: 0, filterType: 0, cutoff: 0.7, res: 0.2 }, 0)] })
  check('fx mix knob 0 = dry', specDist(mix0, base) < 0.01, `dist=${specDist(mix0, base).toFixed(3)}`)
}

// ================= GLOBAL =================
{
  const spread = A(pp => { pp.global.voiceSpreadPan = 1; pp.global.poly = 8 }, { note: 60, note2: 64 })
  const noSpread = A(pp => { pp.global.poly = 8 }, { note: 60, note2: 64 })
  const widthOf = (m) => Math.abs(m.rmsL - m.rmsR) / (m.rmsL + m.rmsR)
  check('voice spread pan widens', widthOf(spread) > widthOf(noSpread) + 0.01, `w ${widthOf(noSpread).toFixed(3)} -> ${widthOf(spread).toFixed(3)}`)
  const tuned = A(pp => { pp.global.masterTune = 100 })
  check('master tune', specDist(tuned, base) > 0.004, `dist=${specDist(tuned, base).toFixed(3)}`)
}

// ---------- summary ----------
const fails = results.filter(r => !r.pass)
console.log('\\n==========', results.length, 'checks,', fails.length, 'failures ==========')
for (const f of fails) console.log('FAIL:', f.name, f.detail || '')
