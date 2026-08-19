// Apollo polyphony/robustness audit — regression tests for the 2026-08-19
// "goes silent with many notes" fixes: master limiter ceiling, scale-lock
// note-off matching (voice-leak), steal recovery, and process() crash armor.
// Part of `npm run test:apollo`.
global.sampleRate = 48000
global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: () => {}, onmessage: null } } }
global.registerProcessor = (name, cls) => { global.__cls = cls }
const { readFileSync } = await import('node:fs')
const engineUrl = new URL('../../public/apollo/engine.js', import.meta.url)
await import(engineUrl.href)
const smoke = readFileSync(new URL('./engine-smoke.js', import.meta.url), 'utf8')
// reuse the smoke test's full default patch object
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
  for (let i = 0; i < 2048; i++) data[i] = Math.sin(2 * Math.PI * i / 2048)
  p.onMessage({ type: 'ranges', ranges: {} })
  p.onMessage({ type: 'table', id: 'basic', frames: 1, data })
  if (mut) mut(patch)
  p.onMessage({ type: 'patch', patch })
  return p
}
function run(p, blocks) {
  let peak = 0, nan = false
  for (let b = 0; b < blocks; b++) {
    const L = new Float32Array(128), R = new Float32Array(128)
    p.process([], [[L, R]])
    for (let i = 0; i < 128; i++) {
      if (!isFinite(L[i])) nan = true
      peak = Math.max(peak, Math.abs(L[i]))
    }
  }
  return { peak, nan }
}
const gated = p => { let n = 0; for (const v of p.voices) if (v.active && v.gate) n++; return n }

// 1. Master limiter: a 12-note chord must not exceed the ceiling
{
  const p = fresh()
  for (const n of [40, 43, 47, 50, 53, 57, 60, 64, 67, 71, 74, 77]) p.noteOn(n, 0.9, false)
  const { peak, nan } = run(p, 60)
  check('limiter caps 12-note chord ≤ 0.985', peak <= 0.985 && !nan, `peak=${peak.toFixed(3)}`)
  check('chord still audible under limiter', peak > 0.5, '')
}

// 2. Scale lock: noteOff must release the snapped voice (was a permanent leak)
{
  const p = fresh(pp => { pp.global.scaleLock = true; pp.global.scaleName = 'Minor'; pp.global.scaleRoot = 0 })
  for (let i = 0; i < 24; i++) { p.noteOn(48 + i, 0.9, false); run(p, 4); p.noteOff(48 + i, false); run(p, 2) }
  run(p, 120)
  check('scale-lock chromatic run leaves no stuck voices', gated(p) === 0, `stuck=${gated(p)}`)
}

// 3. Voice stealing: a new note over a full gated pool must sound
{
  const p = fresh(pp => { pp.envs[0].sustain = 0; pp.envs[0].decay = 0.05 })
  for (let i = 0; i < 16; i++) p.noteOn(30 + i, 0.3, false)
  run(p, 120)
  p.noteOn(84, 1.0, false)
  const { peak } = run(p, 20)
  check('stolen voice restarts audibly', peak > 0.05, `peak=${peak.toFixed(3)}`)
}

// 4. Crash armor: a poisoned voice must not kill the processor
{
  const p = fresh()
  p.noteOn(60, 0.9, false)
  run(p, 5)
  // sabotage: corrupt an internal on an active voice so renderVoice throws
  for (const v of p.voices) if (v.active) { v.envs = null; break }
  const a = run(p, 5)              // would previously throw out of process()
  p.onMessage({ type: 'panic' })
  run(p, 5)
  p.noteOn(64, 0.9, false)
  const b = run(p, 30)
  check('process() survives a poisoned voice', !a.nan, '')
  check('audio recovers after internal error', b.peak > 0.05, `peak=${b.peak.toFixed(3)}`)
}

console.log(failures === 0 ? 'ALL POLY/ROBUSTNESS CHECKS PASS' : `${failures} FAILURES`)
process.exit(failures ? 1 : 0)
