// Apollo's effects, added from Beacon's device chain, must actually be heard.
//
//   npm run test:apollo-fx
//
// A device can look completely right and make no sound at all, and this
// feature has two specific ways for that to happen:
//
//   1. The unit the menu builds might not translate, or might translate to
//      something inert. The card would still draw its knobs.
//   2. Apollo devices only exist on Apollo's engine. If anything else in the
//      chain cannot run there, the whole chain falls back to the legacy
//      WebAudio builder — whose switch ends in `default: continue`, so it
//      SKIPS the Apollo device entirely. Silent, no error, knobs still turn.
//
// So this runs the real engine.js worklet over a saw and measures the output,
// rather than trusting the UI.

import Module, { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// The compiled output keeps the app's '@/' alias in its require() calls and
// Node has never heard of it — same hook as apollo-modules.test.mjs.
const BUILD = join(ROOT, '.test-build')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/lib/')) request = join(BUILD, request.slice('@/lib/'.length) + '.js')
  return origResolve.call(this, request, ...rest)
}

// engine.js is an AudioWorklet: give it the two globals it expects.
global.sampleRate = 44100
global.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: () => {}, onmessage: null } } }
global.registerProcessor = (_name, cls) => { global.__cls = cls }
await import(`file://${join(ROOT, 'public/apollo/engine.js')}`)

const smoke = readFileSync(join(ROOT, 'scripts/apollo-tests/engine-smoke.js'), 'utf8')
const makePatch = new Function(smoke.slice(smoke.indexOf('function makePatch'), smoke.indexOf('const p = new')) + '; return makePatch')()

const { APOLLO_ADD_OPTIONS, makeDefaultParams } = require('../.test-build/daw-effect-catalog.js')
const { translateEffect, heliosBlocker } = require('../.test-build/apollo/daw-fx.js')
const { automatableParams, currentValue, shortNameOf } = require('../.test-build/daw-effect-params.js')

/** Push a saw through a chain of Apollo units in fx-only mode. */
function render(units) {
  const p = new global.__cls()
  const patch = makePatch()
  for (const o of patch.oscs) o.enabled = false
  patch.sub.enabled = false
  patch.noise.enabled = false
  patch.fxMain = units
  patch.global.masterGain = 1
  p.onMessage({ type: 'patch', patch })
  p.onMessage({ type: 'fxMode', on: true })
  let phase = 0
  const blocks = 400
  const out = new Float32Array(blocks * 128)
  for (let b = 0; b < blocks; b++) {
    const IL = new Float32Array(128), IR = new Float32Array(128)
    for (let i = 0; i < 128; i++) {
      phase += 220 / 44100
      if (phase >= 1) phase -= 1
      // A saw, not a sine: a phaser or an octaver needs harmonics to work on.
      IL[i] = (phase * 2 - 1) * 0.35
      IR[i] = IL[i]
    }
    const L = new Float32Array(128), R = new Float32Array(128)
    p.process([[IL, IR]], [[L, R]])
    out.set(L, b * 128)
  }
  return out.subarray(120 * 128)   // past the units' settling time
}

const rms = b => Math.sqrt(b.reduce((s, v) => s + v * v, 0) / b.length)
const diff = (a, b) => {
  let s = 0
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2
  return Math.sqrt(s / a.length)
}

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}

const dry = render([])
console.log(`dry rms ${rms(dry).toFixed(4)}\n`)

for (const opt of APOLLO_ADD_OPTIONS) {
  const effect = { id: `t_${opt.fx}`, type: opt.type, params: makeDefaultParams(opt.type, opt.fx) }
  const units = translateEffect(effect, 120)
  const wet = units ? render(units) : null
  const r = wet ? rms(wet) : 0
  const d = wet ? diff(dry, wet) : 0
  // Audible means BOTH: it produces output, and that output is not just the
  // dry signal passed through. A unit that silently bypasses itself would
  // sail through an output-level check alone.
  check(
    `${opt.label} is heard`,
    !!units && r > 0.001 && d > 0.001,
    `rms ${r.toFixed(4)} Δdry ${d.toFixed(4)} units ${units?.length ?? 0}`,
  )
  // Its knobs must be automatable, and each must read a real starting value —
  // an unseeded lane snaps the parameter to its minimum the moment it opens.
  const params = automatableParams(effect)
  check(
    `${opt.label} exposes parameters`,
    params.length > 1 && params.every(pr => typeof currentValue(effect, pr.key) === 'number'),
    `${params.length} params, named ${shortNameOf(effect)}`,
  )
}

// ── The fallback, which is the silent one ──────────────────────────────────
const phaser = { id: 'p1', type: 'helios', params: makeDefaultParams('helios', 'phaser') }
const lfoOnFilter = { id: 'l1', type: 'lfo', params: { enabled: true, target: 'filter', rate: 1, depth: 0.5, waveform: 'sine' } }

check('a chain of Apollo devices runs on Apollo', heliosBlocker([phaser], 120) === null)

const blocked = heliosBlocker([phaser, lfoOnFilter], 120)
check(
  'an untranslatable neighbour is reported, not silently dropped',
  !!blocked && blocked.effect?.id === 'l1',
  blocked ? `blamed ${blocked.effect?.type}: ${blocked.reason}` : 'nothing reported',
)

// Automation on an Apollo device writes one level down, into unit.params —
// the top-level write the other devices use would be read by nothing.
const auto = { id: 'a1', type: 'helios', params: makeDefaultParams('helios', 'phaser') }
const before = translateEffect(auto, 120)[0].params.rate
auto.params.unit.params.rate = 7.5
const after = translateEffect(auto, 120)[0].params.rate
check('a parameter change reaches the translated unit', before !== after && after === 7.5, `${before} → ${after}`)

console.log(failures ? `\n${failures} FAILED` : '\nall good')
process.exit(failures ? 1 : 0)
