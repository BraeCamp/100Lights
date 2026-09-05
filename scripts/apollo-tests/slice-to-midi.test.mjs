// Slice to New MIDI Track and Convert to MIDI (lib/slice-to-midi.ts): where
// the cuts fall, how slices become pads and notes, one melodic line from many
// voices, and which drum an attack is by where its energy sits.
//
//   node scripts/apollo-tests/slice-to-midi.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const {
  sliceCuts, sliceSpans, padPitches, sliceNotes, slicePads, melodyOnly, toMidiNotes, spectralCentroid, drumPitchFor, drumNotes,
  sliceByLabel, describeSlicing, FIRST_PAD, MAX_SLICES, KICK, SNARE, CLOSED_HAT,
} = await importTs('lib/slice-to-midi.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} expected ${b}, got ${a}`)
let n = 0
const id = () => `n${++n}`
// A straight 2 s sample as 4 beats (120 BPM): beats ↔ seconds ×2.
const straight = { start: 0, end: 2, clipBeats: 4, beatToSec: b => b / 2 }
const secToBeat = s => s * 2

console.log('\nwhere the cuts fall')

ok('a grid: one cut per step, from the start, none past the end', () => {
  assert.deepEqual(sliceCuts(1, straight), [0, 0.5, 1, 1.5])
  assert.deepEqual(sliceCuts(2, straight), [0, 1])
  assert.deepEqual(sliceCuts(0.5, straight).length, 8)
})

ok('transients: the attacks inside the span, the start always first, slivers merged', () => {
  const cuts = sliceCuts('transients', { ...straight, onsets: [0.005, 0.5, 0.51, 1.0, 1.995] })
  assert.deepEqual(cuts, [0, 0.5, 1.0], 'the 5 ms attack is the start, 0.51 is a sliver of 0.5, 1.995 is a sliver before the end')
})

ok('warp markers: the marker times', () => {
  assert.deepEqual(sliceCuts('markers', { ...straight, markerSecs: [0, 0.75, 2] }), [0, 0.75])
})

ok('too many for the maximum: thinned evenly, the whole sample still covered', () => {
  const cuts = sliceCuts(0.125, { ...straight, max: 8 })   // 32 steps → every 4th
  assert.equal(cuts.length, 8)
  assert.equal(cuts[0], 0); near(cuts[1], 0.25)
  assert.equal(sliceCuts(0.125, { ...straight, max: 500 }).length, 32, 'the cap is 64 at most, and here 32 fit')
  assert.equal(MAX_SLICES, 64)
})

ok('spans run cut to cut, the last to the end; pads are chromatic from C1', () => {
  const spans = sliceSpans([0, 0.5, 1.5], 2)
  assert.deepEqual(spans, [{ from: 0, to: 0.5 }, { from: 0.5, to: 1.5 }, { from: 1.5, to: 2 }])
  assert.deepEqual(padPitches(3), [36, 37, 38])
  assert.equal(FIRST_PAD, 36)
})

console.log('\nslices become notes and pads')

ok('one note per slice where it sits, through the map, lasting to the next', () => {
  const spans = sliceSpans([0, 0.5, 1.5], 2)
  const notes = sliceNotes(spans, secToBeat, padPitches(3), id)
  assert.deepEqual(notes.map(x => [x.pitch, x.startBeat, x.durationBeats, x.velocity]), [[36, 0, 1, 100], [37, 1, 2, 100], [38, 3, 1, 100]])
})

ok('a warped clip slices to the beats it plays at: a map twice as slow doubles every beat', () => {
  const notes = sliceNotes(sliceSpans([0, 0.5], 1), s => s * 4, padPitches(2), id)
  assert.deepEqual(notes.map(x => [x.startBeat, x.durationBeats]), [[0, 2], [2, 2]])
})

ok('pads carry their slice as a baked sample, keyed by pitch', () => {
  const pads = slicePads([36, 37], [{ id: 'a', name: 'Loop 1', data: 'data:audio/wav;base64,AAAA' }, { id: 'b', name: 'Loop 2', data: 'data:audio/wav;base64,BBBB' }])
  assert.deepEqual(Object.keys(pads).map(Number), [36, 37])
  assert.equal(pads[37].sample.id, 'b'); assert.equal(pads[37].sample.data, 'data:audio/wav;base64,BBBB')
  assert.equal(pads[36].volume, 0.8); assert.equal(pads[36].chokeGroup, 0)
})

console.log('\nconverting: one line, every voice, the drums')

ok('melodyOnly keeps the surest note of each attack and ends it where the next begins', () => {
  const heard = [
    { startSec: 0, midi: 60, durSec: 1.5, velocity: 0.8, confidence: 0.9 },
    { startSec: 0.01, midi: 64, durSec: 1.5, velocity: 0.8, confidence: 0.6 },
    { startSec: 1.0, midi: 67, durSec: 0.5, velocity: 0.8, confidence: 0.9 },
  ]
  const line = melodyOnly(heard)
  assert.deepEqual(line.map(x => [x.midi, x.startSec, +x.durSec.toFixed(2)]), [[60, 0, 1.0], [67, 1.0, 0.5]])
})

ok('toMidiNotes: seconds through the map, velocity 0..1 or 1..127 both land on 1..127', () => {
  const notes = toMidiNotes([{ startSec: 0.5, midi: 62, durSec: 0.25, velocity: 0.5, confidence: 1 }, { startSec: 1, midi: 200, durSec: 0.001, velocity: 100, confidence: 1 }], secToBeat, id)
  assert.deepEqual(notes.map(x => [x.pitch, x.startBeat, x.durationBeats, x.velocity]), [[62, 1, 0.5, 64], [127, 2, 0.0625, 100]])
})

ok('spectralCentroid: a low sine sits low, a hiss sits high', () => {
  const sr = 44100, len = 4096
  const low = new Float32Array(len), hiss = new Float32Array(len)
  let seed = 7
  for (let i = 0; i < len; i++) { low[i] = Math.sin((2 * Math.PI * 60 * i) / sr); seed = (seed * 1103515245 + 12345) >>> 0; hiss[i] = (seed / 2 ** 32) * 2 - 1 }
  const cLow = spectralCentroid(low, sr, 0), cHiss = spectralCentroid(hiss, sr, 0)
  assert.ok(cLow < 250, `low sine centroid ${cLow.toFixed(0)} Hz`)
  assert.ok(cHiss > 2000, `hiss centroid ${cHiss.toFixed(0)} Hz`)
  assert.equal(drumPitchFor(cLow), KICK); assert.equal(drumPitchFor(cHiss), CLOSED_HAT); assert.equal(drumPitchFor(800), SNARE)
})

ok('drumNotes: an attack a sixteenth long on the pad its energy says, as loud as its attack', () => {
  const sr = 44100, samples = new Float32Array(sr)
  for (let i = 0; i < 2048; i++) samples[i] = Math.sin((2 * Math.PI * 55 * i) / sr)   // a kick at 0
  let seed = 3
  for (let i = 0; i < 2048; i++) { seed = (seed * 1103515245 + 12345) >>> 0; samples[22050 + i] = (seed / 2 ** 32) * 2 - 1 }   // a hat at 0.5 s
  const notes = drumNotes([{ t: 0, strength: 1 }, { t: 0.5, strength: 0.3 }], samples, sr, secToBeat, id)
  assert.deepEqual(notes.map(x => [x.pitch, x.startBeat, x.durationBeats]), [[KICK, 0, 0.25], [CLOSED_HAT, 1, 0.25]])
  assert.equal(notes[0].velocity, 127); assert.equal(notes[1].velocity, 80)
})

ok('labels', () => {
  assert.equal(sliceByLabel('transients', 4), 'Transient'); assert.equal(sliceByLabel(4, 4), '1 Bar'); assert.equal(sliceByLabel(0.25, 4), '1/16')
  assert.equal(describeSlicing(8, 'transients', 4), '8 slices — one per transient')
  assert.equal(describeSlicing(1, 1, 4), '1 slice — one per 1/4')
})

console.log(`\n${passed} passed`)
