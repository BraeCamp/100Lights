#!/usr/bin/env node
// Do slice edges click?
//
//   npm run test:slice-declick
//
// A slice boundary lands where the transient was, which is almost never a zero
// crossing — so playback starts on a step, and a step is a click. This renders
// a slice that deliberately begins at the loudest possible point of a sine and
// checks the output does not jump.
//
// Rendered through the real engine in Node, so this is the same code the
// browser runs rather than a model of it.

import assert from 'node:assert'
import { createRenderHost, apolloModules, SAMPLE_RATE } from '../lib/apollo/render-host.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// A continuous sine. Slicing it anywhere lands mid-waveform, which is the
// worst case and therefore the one worth testing.
const SR = SAMPLE_RATE
const LEN = SR * 2
const wave = new Float32Array(LEN)
for (let i = 0; i < LEN; i++) wave[i] = Math.sin((2 * Math.PI * 200 * i) / SR) * 0.8

// Put a slice exactly on a peak: sin = 1 there, so without a fade the very
// first sample of the slice is a full-scale step from silence.
const peakIndex = Math.round(SR / 200 / 4)          // quarter period → the crest
const sliceAt = (Math.floor(SR * 0.5) + peakIndex) / LEN
console.log(`  slice placed on a waveform peak at ${(sliceAt * 100).toFixed(1)}% of the sample`)

const { initPatch } = await apolloModules()
const patch = initPatch()
const osc = patch.oscs[0]
osc.enabled = true
osc.engine = 'sample'
osc.smp.sampleId = 'declick-test'
osc.smp.slices = [{ pos: 0 }, { pos: sliceAt }]
osc.smp.sliceMap = 'keys'
osc.smp.loopMode = 'off'
osc.smp.keytrack = false
// A hard attack, so the envelope cannot hide a click for us.
//
// The field is `attack`, not `a` — an earlier version of this test set `a`,
// which did nothing, left the default 2ms attack in place, and therefore
// measured the ENVELOPE smoothing the edge rather than anything about slices.
// It passed with the declick disabled, which is how the mistake surfaced.
patch.envs[0].attack = 0
patch.envs[0].hold = 1
patch.envs[0].decay = 1
patch.envs[0].sustain = 1

const host = await createRenderHost({ patch, bpm: 120 })
host.post({ type: 'sample', id: 'declick-test', sr: SR, len: LEN, l: wave, r: wave })
host.finish()

// Note 37 = the SECOND slice (the engine maps slices from note 36), which is
// the one starting on the peak.
const out = host.render([{ note: 37, t: 0, dur: 0.4, vel: 1 }], 0.6)
if (host.errors().length) console.log('  engine errors:', host.errors().slice(0, 1))

// The click, if there is one, is a single-sample jump at the very beginning.
let firstNonZero = -1
for (let i = 0; i < out.left.length; i++) {
  if (Math.abs(out.left[i]) > 1e-6) { firstNonZero = i; break }
}
check('the slice actually plays', firstNonZero >= 0 && firstNonZero < SR * 0.05,
  firstNonZero < 0 ? 'silent' : `first sound at sample ${firstNonZero}`)

if (firstNonZero >= 0) {
  // Biggest sample-to-sample step in the first 10ms, against the biggest step
  // during steady playback. A click is a step far larger than the waveform's
  // own slope.
  const stepIn = (from, to) => {
    let m = 0
    for (let i = from + 1; i < to; i++) m = Math.max(m, Math.abs(out.left[i] - out.left[i - 1]))
    return m
  }
  const onset = stepIn(firstNonZero, firstNonZero + Math.floor(SR * 0.01))
  const steady = stepIn(Math.floor(SR * 0.1), Math.floor(SR * 0.2))
  console.log(`  largest step: ${onset.toExponential(2)} at the slice edge vs ${steady.toExponential(2)} mid-playback`)
  check('the slice edge is no steeper than ordinary playback',
    onset <= steady * 1.5, `${onset.toExponential(2)} vs ${steady.toExponential(2)}`)

  // And the fade has to be short enough to be inaudible as a fade — full level
  // within ~10ms, not a noticeable swell.
  let peakEarly = 0
  for (let i = firstNonZero; i < firstNonZero + Math.floor(SR * 0.01); i++) peakEarly = Math.max(peakEarly, Math.abs(out.left[i]))
  let peakLater = 0
  for (let i = Math.floor(SR * 0.1); i < Math.floor(SR * 0.2); i++) peakLater = Math.max(peakLater, Math.abs(out.left[i]))
  check('and it reaches full level within 10ms', peakEarly > peakLater * 0.8,
    `${peakEarly.toFixed(3)} vs ${peakLater.toFixed(3)}`)
}

console.log(failures ? `\n${failures} failing` : '\nslice edges do not click')
assert.equal(failures, 0)
