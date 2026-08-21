// Apollo feature audit — regression tests for the 2026-08-20 competitive-gap
// batch: spectral (harmonic-domain) wavetable warps, the envelope-follower mod
// source, OTT-style upward compression, and per-compressor GR metering.
// Part of `npm run test:apollo`.
global.sampleRate = 48000
const posted = []
global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: m => posted.push(m), onmessage: null } } }
global.registerProcessor = (name, cls) => { global.__cls = cls }
const { readFileSync } = await import('node:fs')
await import(new URL('../../public/apollo/engine.js', import.meta.url).href)
const smoke = readFileSync(new URL('./engine-smoke.js', import.meta.url), 'utf8')
const makePatch = new Function(smoke.slice(smoke.indexOf('function makePatch'), smoke.indexOf('const p = new')) + '; return makePatch')()

let failures = 0
const check = (name, pass, extra = '') => {
  console.log(`${pass ? ' PASS ' : ' FAIL '} ${name}  ${extra}`)
  if (!pass) failures++
}

function fresh(mut) {
  const p = new global.__cls()
  const patch = makePatch()
  const data = new Float32Array(2048)
  for (let i = 0; i < 2048; i++) data[i] = 1 - 2 * i / 2048 // saw — rich harmonics
  p.onMessage({ type: 'ranges', ranges: { 'osc0.wt.specWarp.amount': [0, 1] } })
  p.onMessage({ type: 'table', id: 'basic', frames: 1, data })
  patch.filters[0].enabled = false // the default LP would mask the brightness probes
  if (mut) mut(patch)
  p.onMessage({ type: 'patch', patch })
  return p
}
function render(p, blocks) {
  const out = new Float32Array(blocks * 128)
  for (let b = 0; b < blocks; b++) {
    const L = new Float32Array(128), R = new Float32Array(128)
    p.process([], [[L, R]])
    out.set(L, b * 128)
  }
  return out
}
function bandEnergy(buf, freq) {
  const w = 2 * Math.PI * freq / 48000
  const coeff = 2 * Math.cos(w)
  let s0 = 0, s1 = 0, s2 = 0
  for (let i = 0; i < buf.length; i++) { s0 = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s0 }
  return Math.sqrt(Math.abs(s1 * s1 + s2 * s2 - coeff * s1 * s2))
}
function brightness(raw) {
  // probe REAL harmonics of A2 (110 Hz): high partials (40/46/52) vs the 2nd —
  // measured on the sustain only (the attack click splatters broadband energy)
  const buf = raw.subarray(Math.min(20 * 128, raw.length >> 1))
  const hi = bandEnergy(buf, 110 * 40) + bandEnergy(buf, 110 * 46) + bandEnergy(buf, 110 * 52)
  return hi / (bandEnergy(buf, 110) + bandEnergy(buf, 220) + 1e-9)
}
function rms(buf) { let s = 0; for (const v of buf) s += v * v; return Math.sqrt(s / buf.length) }

// 1. Spectral warp: 'lowpass' mode removes highs; 'shift' changes the spectrum
{
  const base = fresh()
  base.noteOn(45, 0.9, false)
  const dry = render(base, 60)

  const lp = fresh(pp => { pp.oscs[0].wt.specWarp = { mode: 'lowpass', amount: 1 } })
  lp.noteOn(45, 0.9, false)
  const dark = render(lp, 60)
  check('spectral LP removes highs', brightness(dark) < brightness(dry) * 0.3,
    `bright ${brightness(dry).toFixed(2)} → ${brightness(dark).toFixed(2)}`)
  check('spectral LP still audible', rms(dark) > 0.02, `rms ${rms(dark).toFixed(3)}`)

  const sh = fresh(pp => { pp.oscs[0].wt.specWarp = { mode: 'shift', amount: 0.6 } })
  sh.noteOn(45, 0.9, false)
  const shifted = render(sh, 60)
  const distinct = Math.abs(brightness(shifted) - brightness(dry)) > brightness(dry) * 0.25
  check('spectral shift changes the spectrum', distinct && rms(shifted) > 0.01,
    `bright ${brightness(dry).toFixed(2)} → ${brightness(shifted).toFixed(2)}`)
}

// 2. Spectral warp amount is a mod destination (per-voice)
{
  const p = fresh(pp => {
    pp.oscs[0].wt.specWarp = { mode: 'lowpass', amount: 0 }
    pp.matrix = [{ id: 'r1', source: 'macro1', dest: 'osc0.wt.specWarp.amount', amount: 1, bipolar: false, aux: 'none', auxAmount: 0, curve: null, bypass: false }]
    pp.macros = [1, 0, 0, 0, 0, 0, 0, 0]
  })
  p.noteOn(45, 0.9, false)
  const modded = render(p, 60)
  const ref = fresh(pp => { pp.oscs[0].wt.specWarp = { mode: 'lowpass', amount: 0 } })
  ref.noteOn(45, 0.9, false)
  const refBuf = render(ref, 60)
  check('specWarp.amount responds to modulation', brightness(modded) < brightness(refBuf) * 0.4,
    `bright ${brightness(refBuf).toFixed(2)} → ${brightness(modded).toFixed(2)}`)
}

// 3. Envelope follower: tracks level, decays on silence, exposed as a source
{
  const p = fresh()
  p.noteOn(60, 0.9, false)
  render(p, 40)
  const during = p.followEnv
  check('follower rises with audio', during > 0.05, `env ${during.toFixed(3)}`)
  check('follower is a mod source', Math.abs(p.globalSourceVal('follower') - during) < 0.2, '')
  p.noteOff(60, false)
  render(p, 400) // ~1.1 s of release + silence
  check('follower decays in silence', p.followEnv < during * 0.5, `env ${p.followEnv.toFixed(3)}`)
}

// 4. OTT upward compression lifts quiet material; GR is reported
{
  const mkComp = (upward) => fresh(pp => {
    pp.oscs[0].level = 0.1 // quiet source, well under threshold
    pp.fxMain = [{ id: 'c1', type: 'compressor', enabled: true, mix: 1, params: { threshold: -12, ratio: 6, attack: 5, release: 120, makeup: 0, upward, multiband: 0, loFreq: 0.25, hiFreq: 0.7 } }]
  })
  const dry = mkComp(0); dry.noteOn(57, 0.6, false)
  const dryBuf = render(dry, 80)
  const ott = mkComp(1); ott.noteOn(57, 0.6, false)
  const ottBuf = render(ott, 80)
  check('upward compression lifts quiet audio', rms(ottBuf) > rms(dryBuf) * 1.5,
    `rms ${rms(dryBuf).toFixed(4)} → ${rms(ottBuf).toFixed(4)}`)
  posted.length = 0
  render(ott, 20)
  const meters = posted.filter(m => m.type === 'meters').pop()
  check('meters carry follower level', meters && typeof meters.follower === 'number', '')
  check('meters carry compressor GR', !!(meters && meters.fxGr && meters.fxGr.c1 && meters.fxGr.c1.length === 1), '')
  const mb = fresh(pp => {
    pp.fxMain = [{ id: 'c2', type: 'compressor', enabled: true, mix: 1, params: { threshold: -18, ratio: 4, attack: 5, release: 120, makeup: 0, upward: 0.5, multiband: 1, loFreq: 0.25, hiFreq: 0.7 } }]
  })
  mb.noteOn(45, 0.9, false)
  posted.length = 0
  render(mb, 20)
  const m2 = posted.filter(m => m.type === 'meters').pop()
  check('multiband GR has three bands', !!(m2 && m2.fxGr && m2.fxGr.c2 && m2.fxGr.c2.length === 3), '')
}

// 5. NaN resilience: degenerate FX params must never mute the synth for good
{
  const p = fresh(pp => {
    pp.fxMain = [{ id: 'bad', type: 'eq', enabled: true, mix: 1, params: { f1: 0, g1: 18, q1: 8, t1: 1, f2: 1, g2: 18, q2: 8, t2: 2 } }]
  })
  p.noteOn(60, 0.9, false)
  const storm = render(p, 60)
  let finite = true
  for (const v of storm) if (!isFinite(v)) { finite = false; break }
  check('degenerate EQ output stays finite', finite, '')
  p.noteOff(60, false)
  render(p, 100)
  // remove the bad unit, play again — must be audible (no poisoned limiter)
  p.onMessage({ type: 'patch', patch: (() => { const pp = makePatch(); pp.filters[0].enabled = false; return pp })() })
  p.noteOn(64, 0.9, false)
  const after = render(p, 40)
  check('synth recovers after degenerate FX removed', rms(after) > 0.05, `rms ${rms(after).toFixed(3)}`)
}

// 8. Serum-2 filter models (2026-08-20 video batch): every new type is
// audible, finite, and actually filters (differs from bypass)
{
  const mkF = (type) => fresh(pp => {
    pp.filters[0].enabled = true
    pp.filters[0].type = type
    pp.filters[0].cutoff = 0.45
    pp.filters[0].res = 0.6
  })
  const ref = fresh(); ref.noteOn(45, 0.9, false)
  const refBuf = render(ref, 60)
  for (const type of ['acidLadder', 'emsLadder', 'mgDirty', 'comb2', 'expBPF']) {
    const f = mkF(type); f.noteOn(45, 0.9, false)
    const buf = render(f, 60)
    let finite = true
    for (const v of buf) if (!Number.isFinite(v)) { finite = false; break }
    const level = rms(buf.subarray(20 * 128))
    let diff = 0
    for (let i = 20 * 128; i < buf.length; i++) diff += Math.abs(buf[i] - refBuf[i])
    diff /= buf.length - 20 * 128
    check(`filter ${type} audible+finite+filtering`, finite && level > 0.01 && diff > 0.01,
      `rms ${level.toFixed(3)} diff ${diff.toFixed(3)}`)
  }
  // resonance character: acid at high res must ring harder than plain ladder24
  const hot = (type) => {
    const f = fresh(pp => { pp.filters[0].enabled = true; pp.filters[0].type = type; pp.filters[0].cutoff = 0.4; pp.filters[0].res = 0.95 })
    f.noteOn(45, 0.9, false)
    const buf = render(f, 60).subarray(20 * 128)
    return bandEnergy(buf, 2000) / (rms(buf) + 1e-9)
  }
  check('acid ladder resonance bites harder than Ladder 24', hot('acidLadder') > hot('ladder24'),
    `${hot('acidLadder').toFixed(1)} vs ${hot('ladder24').toFixed(1)}`)
}

// 9. New convolve IR models (Cabinet / Chimes / Tank) render + differ
{
  const mkIr = (ir) => fresh(pp => {
    pp.fxMain = [{ id: 'cv1', type: 'convolve', enabled: true, mix: 1, params: { ir, size: 0.6, predelay: 0, damp: 0.2, width: 1 } }]
  })
  const outs = {}
  for (const ir of [8, 9, 10]) {
    const p2 = mkIr(ir); p2.noteOn(57, 0.9, false)
    const buf = render(p2, 80)
    let finite = true
    for (const v of buf) if (!Number.isFinite(v)) { finite = false; break }
    outs[ir] = buf
    check(`convolve IR ${ir} (${['Cabinet','Chimes','Tank'][ir - 8]}) audible+finite`, finite && rms(buf) > 0.005, `rms ${rms(buf).toFixed(3)}`)
  }
  let d89 = 0
  for (let i = 0; i < outs[8].length; i++) d89 += Math.abs(outs[8][i] - outs[9][i])
  check('IR models are distinct', d89 / outs[8].length > 0.005, `mean diff ${(d89 / outs[8].length).toFixed(4)}`)
}

// 10. Beacon-parity FX pack (gate / de-esser / transients / dyn-eq / auto-pan)
{
  const mkP = (units, level = 1) => fresh(pp => { pp.oscs[0].level = 0.75 * level; pp.fxMain = units })
  // gate: loud passes, quiet (below -40) is cut
  const loud = mkP([{ id: 'g', type: 'noisegate', enabled: true, mix: 1, params: { threshold: -40, attack: 5, hold: 20, release: 80, reduction: 60 } }])
  loud.noteOn(57, 0.9, false)
  const loudBuf = render(loud, 60)
  const quiet = mkP([{ id: 'g', type: 'noisegate', enabled: true, mix: 1, params: { threshold: -6, attack: 5, hold: 20, release: 80, reduction: 60 } }])
  quiet.noteOn(57, 0.9, false)
  const quietBuf = render(quiet, 60)
  check('gate passes loud, cuts under-threshold', rms(loudBuf.subarray(2560)) > 0.05 && rms(quietBuf.subarray(2560)) < rms(loudBuf.subarray(2560)) * 0.3,
    `${rms(loudBuf.subarray(2560)).toFixed(3)} vs ${rms(quietBuf.subarray(2560)).toFixed(3)}`)

  // de-esser: cuts the 6k band on bright material
  const dry = fresh(); dry.noteOn(57, 0.9, false)
  const dryB = render(dry, 60)
  const de = mkP([{ id: 'd', type: 'deesser', enabled: true, mix: 1, params: { freq: 0.82, bandwidth: 1, threshold: -50, reduction: 20 } }])
  de.noteOn(57, 0.9, false)
  const deB = render(de, 60)
  // the unit's band centers at cutoffHz(0.82) ≈ 4.9 kHz — probe there
  const sib = b => bandEnergy(b.subarray(2560), 4950) / (bandEnergy(b.subarray(2560), 220) + 1e-9)
  check('de-esser reduces the sibilant band', sib(deB) < sib(dryB) * 0.8, `${sib(dryB).toFixed(3)} → ${sib(deB).toFixed(3)}`)

  // transient shaper: +attack raises early rms vs late
  const ts = mkP([{ id: 't', type: 'transientshaper', enabled: true, mix: 1, params: { attack: 10, sustain: -8, gain: 0 } }])
  ts.noteOn(57, 0.9, false)
  const tsB = render(ts, 80)
  const ref2 = fresh(); ref2.noteOn(57, 0.9, false)
  const refB = render(ref2, 80)
  const shape = b => rms(b.subarray(0, 3000)) / (rms(b.subarray(6000)) + 1e-9)
  check('transient shaper emphasizes the hit over the body', shape(tsB) > shape(refB) * 1.2, `${shape(refB).toFixed(2)} → ${shape(tsB).toFixed(2)}`)

  // dyn EQ: negative range cuts a hot band
  const dq = mkP([{ id: 'q', type: 'dyneq', enabled: true, mix: 1, params: { freq: 0.55, q: 2, threshold: -50, range: -18, attack: 5, release: 100 } }])
  dq.noteOn(57, 0.9, false)
  const dqB = render(dq, 60)
  const at = (b, f) => bandEnergy(b.subarray(2560), f)
  check('dyn EQ cuts its band when hot', at(dqB, 880) < at(refB, 880) * 0.85, `${at(refB, 880).toFixed(4)} → ${at(dqB, 880).toFixed(4)}`)

  // auto-pan (phase 0 = tremolo): amplitude modulates over time
  const ap = mkP([{ id: 'a', type: 'autopan', enabled: true, mix: 1, params: { rate: 6, depth: 1, wave: 0, phase: 0 } }])
  ap.noteOn(57, 0.9, false)
  const apB = render(ap, 80)
  let mn = 1, mx = 0
  for (let w = 20; w < 70; w++) { const r = rms(apB.subarray(w * 128, (w + 4) * 128)); mn = Math.min(mn, r); mx = Math.max(mx, r) }
  check('auto-pan/tremolo modulates level', mx > mn * 2, `min ${mn.toFixed(3)} max ${mx.toFixed(3)}`)
}

// 11. sidechain key input ducks the chain signal
{
  const p = fresh(pp => {
    pp.fxMain = [{ id: 'sc', type: 'compressor', enabled: true, mix: 1, params: { threshold: -30, ratio: 10, attack: 1, release: 60, makeup: 0, upward: 0, multiband: 0, loFreq: 0.25, hiFreq: 0.7, sidechain: 1 } }]
  })
  p.onMessage({ type: 'fxMode', on: true })
  const out = new Float32Array(120 * 128)
  let phase = 0
  for (let b = 0; b < 120; b++) {
    const IL = new Float32Array(128), IR = new Float32Array(128)
    const KL = new Float32Array(128), KR = new Float32Array(128)
    for (let i = 0; i < 128; i++) {
      phase += 220 / 48000; if (phase >= 1) phase -= 1
      IL[i] = Math.sin(phase * 2 * Math.PI) * 0.4; IR[i] = IL[i]
      const keyOn = b >= 40 && b < 80   // key blasts in the middle third
      KL[i] = keyOn ? 0.8 : 0; KR[i] = KL[i]
    }
    const L = new Float32Array(128), R = new Float32Array(128)
    p.process([[IL, IR], [KL, KR]], [[L, R]])
    out.set(L, b * 128)
  }
  const pre = rms(out.subarray(10 * 128, 35 * 128))
  const duck = rms(out.subarray(50 * 128, 75 * 128))
  const post = rms(out.subarray(95 * 128, 118 * 128))
  check('sidechain key ducks the signal', duck < pre * 0.6 && post > duck * 1.4,
    `pre ${pre.toFixed(3)} duck ${duck.toFixed(3)} post ${post.toFixed(3)}`)
}

console.log(failures === 0 ? 'ALL FEATURE CHECKS PASS' : `${failures} FAILURES`)
process.exit(failures ? 1 : 0)
