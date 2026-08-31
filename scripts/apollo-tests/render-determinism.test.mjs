#!/usr/bin/env node
// Nothing in the audio path may draw an unseeded random number.
//
//   node --experimental-strip-types scripts/apollo-tests/render-determinism.test.mjs
//
// Brae: "Let's see what we can do to make sure that the song never sounds
// different on another machine."
//
// The end-to-end proof is scripts/check-render-determinism.mjs, which renders
// the same song in two browsers at two device rates and compares the PCM. It
// needs a dev server and about a minute. This is the cheap guard that runs in
// the suite: it pins the RNG's output so a "harmless" change to it cannot
// silently invalidate every cached render in the product, and it greps the
// audio path for the bare Math.random() that was the actual bug.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

const { makeRng, seedFrom, rngFor } = await importTs('lib/seeded-random.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── The generator is a fixed function, not a source of surprise ─────────────
const a = makeRng(12345), b = makeRng(12345)
const seqA = Array.from({ length: 8 }, () => a())
const seqB = Array.from({ length: 8 }, () => b())
check('the same seed gives the same sequence', seqA.every((v, i) => v === seqB[i]))
check('a different seed gives a different one', makeRng(12346)() !== seqA[0])
check('and the numbers are in 0..1', seqA.every(v => v >= 0 && v < 1))

// ⚠️ These are LITERAL values, deliberately. Every cached render in the product
// was made with this exact sequence; changing the generator changes what every
// reverb in every song sounds like and quietly invalidates the whole cache. If
// this fails, that is what happened — it is a decision, not a test to update.
check('the sequence itself is pinned',
  seqA[0].toFixed(12) === '0.776938705239' && seqA[1].toFixed(12) === '0.395172696328',
  `${seqA[0].toFixed(12)}, ${seqA[1].toFixed(12)}`)

// ── Seeds come from what the sound IS ───────────────────────────────────────
check('the same key gives the same seed', seedFrom('reverb-ir:2.2:0') === seedFrom('reverb-ir:2.2:0'))
check('a different decay is a different seed', seedFrom('reverb-ir:2.2:0') !== seedFrom('reverb-ir:3.1:0'))
// Stereo width in a noise IR comes entirely from the two channels being
// UNcorrelated. Seeding them alike would collapse the reverb to mono.
check('and the two channels do not share one', seedFrom('reverb-ir:2.2:0') !== seedFrom('reverb-ir:2.2:1'))
check('rngFor is stable across calls', rngFor('x')() === rngFor('x')())

// ── The bug itself, guarded at the source ───────────────────────────────────
// Two reverb impulse responses and the velocity humanizer were filled with
// Math.random(), so the same song rendered to different audio every time.
const engine = readFileSync(new URL('../../lib/daw-engine.ts', import.meta.url), 'utf8')
const randoms = engine.split('\n')
  .map((l, i) => [i + 1, l])
  // Comments ABOUT the bug are the point of the fix, not the bug.
  .filter(([, l]) => !/^\s*(\/\/|\*)/.test(l))
  .filter(([, l]) => /Math\.random\(/.test(l))
check('no bare Math.random() left in the engine', randoms.length === 0,
  randoms.map(([n, l]) => `line ${n}: ${l.trim()}`).join(' | '))

// Apollo's worklet is the other half of the audio path and has always been
// seeded; if that ever changes, renders drift again and this says so.
const worklet = readFileSync(new URL('../../public/apollo/engine.js', import.meta.url), 'utf8')
check('nor in the Helios worklet', !/Math\.random\(/.test(worklet))

console.log(failures ? `\n${failures} failing` : '\nthe render draws the same numbers on every machine')
assert.equal(failures, 0)
