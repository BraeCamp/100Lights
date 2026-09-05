// Automation recording (lib/automation-record.ts): what a lane holds after a
// move is recorded into it, in touch and in latch.
//
//   node scripts/apollo-tests/automation-record.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const {
  writeMove, latchTail, latchWouldClear, recordTargetOf, normalizeForLane,
  describeRecorded, ARM_MODES, RECORD_GRAIN_BEATS,
} = await importTs('lib/automation-record.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
let n = 0
const id = () => `p${++n}`
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m ?? ''} — got ${a}, wanted ${b}`)

const points = () => [
  { id: 'a', beat: 0, value: 0.2 },
  { id: 'b', beat: 4, value: 0.8 },
  { id: 'c', beat: 8, value: 0.5 },
]

console.log('\ntouch: writes where you are, leaves the rest')

ok('a move lands as a point at that beat', () => {
  const out = writeMove(points(), 2, 0.9, id)
  assert.deepEqual(out.map(p => p.beat), [0, 2, 4, 8])
  near(out.find(p => p.beat === 2).value, 0.9)
})

ok('and everything elsewhere is untouched', () => {
  // ⚠️ Recording a move must not disturb a shape somebody drew elsewhere.
  const out = writeMove(points(), 2, 0.9, id)
  near(out.find(p => p.beat === 0).value, 0.2)
  near(out.find(p => p.beat === 8).value, 0.5)
})

ok('a drag leaves a line, not a comb', () => {
  // Dozens of changes a second inside one grain collapse to the last one.
  let out = points()
  for (let i = 0; i < 20; i++) out = writeMove(out, 2 + i * 0.005, 0.3 + i * 0.01, id)
  const around = out.filter(p => Math.abs(p.beat - 2) < RECORD_GRAIN_BEATS)
  assert.equal(around.length, 1, `${around.length} points where a person sees one move`)
})

ok('but two moves a grain apart are two points', () => {
  const out = writeMove(writeMove(points(), 2, 0.3, id), 2 + RECORD_GRAIN_BEATS, 0.7, id)
  assert.equal(out.filter(p => p.beat >= 2 && p.beat <= 2.3).length, 2)
})

ok('the list stays in time order', () => {
  const out = writeMove(writeMove(points(), 6, 0.1, id), 1, 0.4, id)
  assert.deepEqual(out.map(p => p.beat), [...out.map(p => p.beat)].sort((a, b) => a - b))
})

ok('a value outside 0–1 is clamped, never stored wild', () => {
  near(writeMove([], 0, 5, id)[0].value, 1)
  near(writeMove([], 0, -3, id)[0].value, 0)
})

console.log('\nlatch: holds to the end, and destroys')

ok('everything after the move is gone', () => {
  const out = latchTail(points(), 2, 0.9, id)
  assert.deepEqual(out.map(p => p.beat), [0, 2])
  near(out[1].value, 0.9)
})

ok('and it says how many it took', () => {
  assert.equal(latchWouldClear(points(), 2), 2)
  assert.equal(latchWouldClear(points(), 9), 0)
  assert.equal(latchWouldClear(points(), 0), 3, 'latching at the top wipes the lot')
})

ok('what is BEFORE it survives', () => {
  const out = latchTail(points(), 6, 0.1, id)
  near(out.find(p => p.beat === 0).value, 0.2)
  near(out.find(p => p.beat === 4).value, 0.8)
})

console.log('\nunits')

ok('a linear lane is a straight proportion', () => {
  near(normalizeForLane({ min: 0, max: 1 }, 0.4), 0.4)
  near(normalizeForLane({ min: -1, max: 1 }, 0), 0.5, 'centre pan is the middle')
  near(normalizeForLane({ min: -1, max: 1 }, -1), 0)
})

ok('a log lane spaces by RATIO, so its middle is the geometric mean', () => {
  // ⚠️ An octave is a ratio. A cutoff lane read linearly spends most of its
  // height where a low-pass does almost nothing.
  near(normalizeForLane({ min: 20, max: 20000, curve: 'log' }, 20), 0)
  near(normalizeForLane({ min: 20, max: 20000, curve: 'log' }, 20000), 1)
  near(normalizeForLane({ min: 20, max: 20000, curve: 'log' }, 632.4555320336759), 0.5)
})

ok('a value past the ends is clamped rather than extrapolated', () => {
  near(normalizeForLane({ min: 0, max: 1 }, 9), 1)
  near(normalizeForLane({ min: 20, max: 20000, curve: 'log' }, 1), 0)
})

ok('a zero-width lane does not divide by zero', () => {
  near(normalizeForLane({ min: 5, max: 5 }, 5), 0)
})

console.log('\nwhat counts as a move')

ok('a track volume and a pan are both recordable', () => {
  assert.deepEqual(recordTargetOf({ type: 'UPDATE_TRACK', trackId: 't1', patch: { volume: 0.4 } }),
    { trackId: 't1', parameter: 'volume', value: 0.4 })
  assert.deepEqual(recordTargetOf({ type: 'UPDATE_TRACK', trackId: 't1', patch: { pan: -0.5 } }),
    { trackId: 't1', parameter: 'pan', value: -0.5 })
})

ok('renaming a track is not a move', () => {
  assert.equal(recordTargetOf({ type: 'UPDATE_TRACK', trackId: 't1', patch: { name: 'Pad' } }), null)
})

ok('one effect parameter is a move', () => {
  assert.deepEqual(recordTargetOf({ type: 'UPDATE_EFFECT', trackId: 't1', effectId: 'e1', patch: { params: { frequency: 800 } } }),
    { trackId: 't1', parameter: 'fx:e1:frequency', value: 800 })
})

ok('but two at once is a preset change, not a gesture', () => {
  // ⚠️ Recording it as one would put two points on one lane.
  assert.equal(recordTargetOf({ type: 'UPDATE_EFFECT', trackId: 't1', effectId: 'e1', patch: { params: { frequency: 800, q: 3 } } }), null)
})

ok('and anything else is nothing to record', () => {
  assert.equal(recordTargetOf({ type: 'ADD_CLIP', clip: {} }), null)
  assert.equal(recordTargetOf({ type: 'UPDATE_EFFECT', trackId: 't1', effectId: 'e1', patch: {} }), null)
})

console.log('\nsaid out loud')

ok('touch says where; latch says what it cost', () => {
  assert.equal(describeRecorded('touch', 'Volume', 4, 4, 0), 'Recorded Volume at bar 2.')
  assert.match(describeRecorded('latch', 'Volume', 4, 4, 3), /3 later points gone/)
  assert.match(describeRecorded('latch', 'Volume', 4, 4, 1), /1 later point gone/)
})

ok('the three modes are the three answers', () => {
  assert.deepEqual(ARM_MODES.map(m => m.id), ['off', 'touch', 'latch'])
  assert.ok(ARM_MODES.every(m => m.hint.length > 20))
})

console.log(`\n${passed} passed`)
