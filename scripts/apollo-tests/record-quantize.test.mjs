// Record Quantization (lib/record-quantize.ts): notes land on the grid AS THEY
// ARE PLAYED, keeping the length they were held for.
//
//   node scripts/apollo-tests/record-quantize.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { snapRecorded, quantizeRecorded, recordGridLabel, describeRecordQuantize, RECORD_GRIDS } =
  await importTs('lib/record-quantize.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} — got ${a}, wanted ${b}`)

console.log('\nthe grids')

ok('none leaves the take exactly as played', () => {
  near(snapRecorded(1.37, 'none'), 1.37)
  near(snapRecorded(1.37, undefined), 1.37)
})

ok('straight grids snap to the nearest line', () => {
  near(snapRecorded(1.4, 'quarter'), 1)
  near(snapRecorded(1.6, 'quarter'), 2)
  near(snapRecorded(1.4, 'eighth'), 1.5)
  near(snapRecorded(1.4, 'sixteenth'), 1.5)
  near(snapRecorded(1.3, 'sixteenth'), 1.25)
  near(snapRecorded(1.3, 'thirtysecond'), 1.25)
})

ok('a triplet grid is two thirds of the straight one', () => {
  // Eighth triplets in four-four: 0, 1/3, 2/3, 1, …
  near(snapRecorded(0.3, 'eighthT'), 1 / 3)
  near(snapRecorded(0.7, 'eighthT'), 2 / 3)
})

ok('the combined grid takes whichever line is nearer', () => {
  // 0.34 is nearly the triplet at 1/3; 0.48 is nearly the straight eighth.
  near(snapRecorded(0.34, 'eighthBoth'), 1 / 3)
  near(snapRecorded(0.48, 'eighthBoth'), 0.5)
})

ok('a tie goes to the straight line', () => {
  // Exactly between the eighth at 0.5 and the triplet at 2/3 is 0.5833…
  const tie = (0.5 + 2 / 3) / 2
  near(snapRecorded(tie, 'eighthBoth'), 0.5)
})

ok('nothing ever lands before the start of the clip', () => {
  assert.ok(snapRecorded(-0.2, 'quarter') >= 0)
})

console.log('\na whole take')

const take = () => [
  { id: 'n1', pitch: 60, startBeat: 0.04, durationBeats: 0.4, velocity: 90 },
  { id: 'n2', pitch: 62, startBeat: 0.97, durationBeats: 1.3, velocity: 80 },
  { id: 'n3', pitch: 60, startBeat: 1.05, durationBeats: 0.2, velocity: 70 },
]

ok('starts move and lengths do not', () => {
  // ⚠️ The length is the part of a performance that still reads as playing once
  // the timing has been taken away.
  const r = quantizeRecorded(take(), 'quarter')
  assert.deepEqual(r.notes.map(n => n.startBeat), [0, 1, 1])
  assert.deepEqual(r.notes.map(n => n.durationBeats), [0.4, 1.3, 0.2])
  assert.deepEqual(r.notes.map(n => n.velocity), [90, 80, 70])
  assert.equal(r.moved, 3)
})

ok('a coarse grid stacks notes rather than dropping them', () => {
  // n1 and n3 are both pitch 60; at 1/4 they land on 0 and 1, so nothing
  // stacks. Add one that collides.
  const notes = [...take(), { id: 'n4', pitch: 60, startBeat: 1.1, durationBeats: 0.2, velocity: 60 }]
  const r = quantizeRecorded(notes, 'quarter')
  assert.equal(r.notes.length, 4, 'a note somebody played was deleted')
  assert.equal(r.stacked, 1)
  assert.match(describeRecordQuantize(r, 'quarter'), /coarser than what you played/)
})

ok('none returns the very same array', () => {
  const notes = take()
  const r = quantizeRecorded(notes, 'none')
  assert.equal(r.notes, notes)
  assert.equal(r.moved, 0)
  assert.equal(describeRecordQuantize(r, 'none'), '')
})

ok('a take already on the grid says nothing', () => {
  const r = quantizeRecorded([{ id: 'a', pitch: 60, startBeat: 2, durationBeats: 1, velocity: 90 }], 'quarter')
  assert.equal(r.moved, 0)
  assert.equal(describeRecordQuantize(r, 'quarter'), '')
})

console.log('\nthe menu')

ok('every grid has a label and a distinct id', () => {
  const ids = RECORD_GRIDS.map(g => g.id)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(RECORD_GRIDS.every(g => g.label.length > 0))
  assert.equal(recordGridLabel('sixteenthBoth'), '1/16 and 1/16T')
  assert.equal(recordGridLabel(undefined), 'None')
})

console.log(`\n${passed} passed`)
