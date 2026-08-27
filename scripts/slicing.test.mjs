#!/usr/bin/env node
// Slicing: does sensitivity do what the label promises, and does grid slicing
// give exactly what it says?
//
//   npm run test:slicing
//
// Tested against audio built here, so the right answer is known rather than
// judged by ear. The detector previously had a hard-coded threshold and there
// was nothing to test — "it found some slices" is true of almost any rule.

import assert from 'node:assert'
import { detectTransients, gridSlices, MAX_SLICES } from '../.test-build/apollo/slicing.js'

const SR = 48000
let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

/** A loop of `hits` decaying bursts, every `gapSec`, at the given amplitude. */
function makeLoop({ hits, gapSec = 0.25, amp = 0.9, seconds = null }) {
  const len = Math.floor((seconds ?? hits * gapSec) * SR)
  const out = new Float32Array(len)
  for (let h = 0; h < hits; h++) {
    const at = Math.floor(h * gapSec * SR)
    for (let i = 0; i < Math.floor(0.05 * SR) && at + i < len; i++) {
      // A burst with a hard attack and a quick decay — a drum hit's shape.
      const env = Math.exp(-i / (0.012 * SR))
      out[at + i] = Math.sin((2 * Math.PI * 180 * i) / SR) * env * amp
    }
  }
  return out
}

// ── Transients ──────────────────────────────────────────────────────────────
const loud = makeLoop({ hits: 8 })
const mid = detectTransients(loud, SR, { sensitivity: 0.5 })
console.log(`  8 loud hits at sensitivity 0.5 → ${mid.slices.length} slices`)
check('it finds the hits in an obvious loop', mid.slices.length === 8, `${mid.slices.length}`)
check('and the first slice is at the very start', mid.slices[0].pos === 0)

// Sensitivity has to be monotonic, or the control is decoration.
const counts = [0, 0.25, 0.5, 0.75, 1].map(s => detectTransients(loud, SR, { sensitivity: s }).slices.length)
console.log(`  sensitivity 0 → 1: ${counts.join(', ')} slices`)
check('turning sensitivity up never finds fewer',
  counts.every((n, i) => i === 0 || n >= counts[i - 1]), counts.join(' ≤ '))

// The point of the control: quiet material that the old hard-coded floor of
// 0.02 threw away entirely.
const quiet = makeLoop({ hits: 8, amp: 0.03 })
const quietLow = detectTransients(quiet, SR, { sensitivity: 0.1 })
const quietHigh = detectTransients(quiet, SR, { sensitivity: 1 })
console.log(`  quiet loop (amp 0.03): ${quietLow.slices.length} slices at low, ${quietHigh.slices.length} at high`)
check('a quiet loop is unreachable at low sensitivity', quietLow.slices.length < 4, `${quietLow.slices.length}`)
check('and reachable at high sensitivity', quietHigh.slices.length >= 8, `${quietHigh.slices.length}`)

// Minimum gap: one hit must not become several.
const singleHit = makeLoop({ hits: 1, seconds: 1 })
const one = detectTransients(singleHit, SR, { sensitivity: 1 })
check('one hit stays one slice even at full sensitivity', one.slices.length === 1, `${one.slices.length}`)

// ── Grid ────────────────────────────────────────────────────────────────────
for (const n of [4, 8, 16, 32]) {
  const g = gridSlices(n)
  const even = g.slices.every((s, i) => Math.abs(s.pos - i / n) < 1e-9)
  check(`grid ${n} gives exactly ${n} evenly spaced slices`, g.slices.length === n && even)
}

// Grid is the answer when transients are not: a pad that fades in has nothing
// to detect, and should still be choppable.
const pad = new Float32Array(SR * 2)
for (let i = 0; i < pad.length; i++) pad[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * (i / pad.length) * 0.7
const padTransients = detectTransients(pad, SR, { sensitivity: 1 })
console.log(`  a pad that fades in: ${padTransients.slices.length} transient slices vs ${gridSlices(16).slices.length} on the grid`)
// Not "finds nothing" — a ratio detector sees the ramp's early relative growth
// and reports a few slices clustered at the start, which is worse than nothing
// because they look like real chops. The claim is the CONTRAST: transients give
// you a handful of artifacts where the grid gives you sixteen usable chops.
check('a fade-in leaves transient detection with almost nothing usable',
  padTransients.slices.length < gridSlices(16).slices.length / 4,
  `${padTransients.slices.length} vs 16 on the grid`)
check('and the grid still chops it', gridSlices(16).slices.length === 16)

// ── The cap ─────────────────────────────────────────────────────────────────
const dense = makeLoop({ hits: 200, gapSec: 0.05 })
const capped = detectTransients(dense, SR, { sensitivity: 1 })
console.log(`  200 hits → found ${capped.found}, kept ${capped.slices.length}`)
check('the cap holds', capped.slices.length <= MAX_SLICES, `${capped.slices.length}`)
check('and truncation is reported, not silent', capped.truncated === (capped.found > MAX_SLICES))

console.log(failures ? `\n${failures} failing` : '\nslicing does what its controls say')
assert.equal(failures, 0)
