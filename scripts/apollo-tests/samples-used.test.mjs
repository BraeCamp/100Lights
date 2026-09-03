#!/usr/bin/env node
// Which samples a render actually needs.
//
//   node --experimental-strip-types scripts/apollo-tests/samples-used.test.mjs
//
// Every offline render used to copy EVERY sample loaded in the engine into
// EVERY worklet node. One multisampled piano is 42 buffers, so a two-clip
// render copied 84 of them — and the cost scaled with the user's library rather
// than with the song they were loading. It is the kind of bug that looks like
// "the loader is slow" from every angle except this one.
//
// Getting this wrong in the other direction is worse than slow: miss a sample a
// patch DOES use and the render comes back silent, which the cache treats as a
// failed clip. So the misses matter more than the hits here.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { samplesUsedBy } = await importTs('lib/apollo/samples-used.ts')
const { initPatch } = await importTs('lib/apollo/patch.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}
const ids = p => [...samplesUsedBy(p)].sort()

// A plain synth patch plays no samples at all — and that is the common case, so
// it must send none rather than "all of them, just in case".
const plain = initPatch()
check('a plain synth patch needs no samples', ids(plain).length === 0, ids(plain).join())

// Each engine that can reference one.
const sampler = initPatch(); sampler.oscs[0].smp.sampleId = 'kick'
check('the sampler engine', ids(sampler).join() === 'kick', ids(sampler).join())

const gran = initPatch(); gran.oscs[1].gran.sampleId = 'pad'
check('the granular engine', ids(gran).join() === 'pad', ids(gran).join())

const spec = initPatch(); spec.oscs[2].spec.sampleId = 'choir'
check('the spectral engine', ids(spec).join() === 'choir', ids(spec).join())

const noise = initPatch(); noise.noise.sampleId = 'vinyl'
check('the noise source', ids(noise).join() === 'vinyl', ids(noise).join())

// A multisample is the case that made this matter: every zone names a sample,
// and missing one leaves a hole in the keyboard rather than an error.
const ms = initPatch()
ms.oscs[0].ms.zones = [
  { sampleId: 'piano-c1' }, { sampleId: 'piano-c2' }, { sampleId: 'piano-c3' },
]
check('every zone of a multisample', ids(ms).join() === 'piano-c1,piano-c2,piano-c3', ids(ms).join())

// All of them at once, deduplicated.
const all = initPatch()
all.oscs[0].smp.sampleId = 'shared'
all.oscs[1].gran.sampleId = 'shared'
all.oscs[2].ms.zones = [{ sampleId: 'shared' }, { sampleId: 'other' }]
all.noise.sampleId = 'vinyl'
check('one id used twice is sent once', ids(all).join() === 'other,shared,vinyl', ids(all).join())

// Robustness: these patches come out of saved projects, so half-populated ones
// are real. A throw here would take the whole render down.
check('a patch with no oscs at all', samplesUsedBy({}).size === 0)
check('null sample ids are skipped', samplesUsedBy({ oscs: [{ smp: { sampleId: null } }] }).size === 0)
check('missing sub-objects are skipped', samplesUsedBy({ oscs: [{}], noise: {} }).size === 0)
check('zones with no sampleId are skipped',
  samplesUsedBy({ oscs: [{ ms: { zones: [{}, { sampleId: 'x' }] } }] }).size === 1)

console.log(failures ? `\n${failures} failing` : '\na render asks for the samples it plays, and no others')
assert.equal(failures, 0)
