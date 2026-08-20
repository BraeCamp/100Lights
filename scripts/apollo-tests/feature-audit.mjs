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

console.log(failures === 0 ? 'ALL FEATURE CHECKS PASS' : `${failures} FAILURES`)
process.exit(failures ? 1 : 0)
