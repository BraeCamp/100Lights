#!/usr/bin/env node
// The shared Node render host: does it actually make sound?
//
//   node scripts/render-host.test.mjs
//
// This is the foundation the desktop background worker sits on, so it is worth
// proving on its own before anything depends on it — and before the CLI is
// switched over to it, so a failure here is unambiguous rather than "something
// in the refactor".

import assert from 'node:assert'
import { createRenderHost, apolloModules, SAMPLE_RATE } from '../lib/apollo/render-host.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const peakOf = a => { let p = 0; for (let i = 0; i < a.length; i++) p = Math.max(p, Math.abs(a[i])); return p }

const { initPatch } = await apolloModules()
check('the app’s own patch module loads in plain Node', typeof initPatch === 'function')

// A plain sawtooth note through the Init patch.
const patch = initPatch()
patch.oscs[0].enabled = true
const host = await createRenderHost({ patch, bpm: 120 })
host.finish()
const out = host.render([{ note: 60, t: 0, dur: 1.5, vel: 0.9 }], 2)

const peak = peakOf(out.left)
console.log(`  rendered ${(out.left.length / SAMPLE_RATE).toFixed(2)}s, peak ${peak.toFixed(4)}`)
check('it renders the requested length', Math.abs(out.left.length / SAMPLE_RATE - 2) < 0.05)
check('it is stereo', out.right.length === out.left.length)
check('it makes a sound', peak > 0.01, peak.toFixed(4))

// Silence where there are no notes is the other half — a host that emits noise
// regardless would pass "it makes a sound" perfectly well.
const quiet = await createRenderHost({ patch, bpm: 120 })
quiet.finish()
const silent = quiet.render([], 0.5)
check('and stays quiet when given no notes', peakOf(silent.left) < 0.002, peakOf(silent.left).toFixed(5))

// Two hosts in one process must not interfere — the desktop worker will render
// many clips back to back, and a processor that leaks state into the next one
// would be very hard to diagnose from the audio.
const a = await createRenderHost({ patch, bpm: 120 }); a.finish()
const b = await createRenderHost({ patch, bpm: 120 }); b.finish()
const ra = a.render([{ note: 67, t: 0, dur: 0.5, vel: 0.9 }], 1)
const rb = b.render([{ note: 67, t: 0, dur: 0.5, vel: 0.9 }], 1)
let maxDiff = 0
for (let i = 0; i < ra.left.length; i++) maxDiff = Math.max(maxDiff, Math.abs(ra.left[i] - rb.left[i]))
console.log(`  two hosts, same note: max sample difference ${maxDiff.toFixed(6)}`)
check('two hosts in one process render the same note identically', maxDiff < 1e-9, maxDiff.toExponential(2))

// A DIFFERENT seed must actually change the render, or 'reseed' is a no-op that
// happens to look like determinism.
const s1 = await createRenderHost({ patch, bpm: 120, seed: 1 }); s1.finish()
const s2h = await createRenderHost({ patch, bpm: 120, seed: 99 }); s2h.finish()
const o1 = s1.render([{ note: 67, t: 0, dur: 0.5, vel: 0.9 }], 1)
const o2 = s2h.render([{ note: 67, t: 0, dur: 0.5, vel: 0.9 }], 1)
let seedDiff = 0
for (let i = 0; i < o1.left.length; i++) seedDiff = Math.max(seedDiff, Math.abs(o1.left[i] - o2.left[i]))
check('a different seed renders differently', seedDiff > 1e-4, seedDiff.toExponential(2))

// Different pitches must actually differ, or the note cache would be keyed on
// something the audio does not respect.
const c = await createRenderHost({ patch, bpm: 120 }); c.finish()
const low = c.render([{ note: 48, t: 0, dur: 0.5, vel: 0.9 }], 1)
let pitchDiff = 0
for (let i = 0; i < low.left.length; i++) pitchDiff = Math.max(pitchDiff, Math.abs(low.left[i] - ra.left[i]))
check('different pitches render differently', pitchDiff > 0.01, pitchDiff.toFixed(4))

console.log(failures ? `\n${failures} failing` : '\nthe render host works in plain Node')
assert.equal(failures, 0)
