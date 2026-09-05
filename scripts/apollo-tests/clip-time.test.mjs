// The loop brace and time commands (lib/clip-time.ts) produce exact note
// sets: Duplicate Loop doubles the loop and copies it, moving what came after;
// Crop trims to a range and moves it to 0; Insert Time opens a gap and grows
// a spanning note; Delete Time closes one and trims; Duplicate Time copies a
// range after itself; and loop lengths parse from speech. The roll is driven
// in .claude/loop-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { loopRange, workingRange, notesInRange, duplicateLoop, cropToRange, insertTime, deleteTime, duplicateTime, parseLoopLength } = await importTs('lib/clip-time.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
let ids = 0
const newId = () => `new${++ids}`
const note = (id, startBeat, durationBeats = 1, pitch = 60) => ({ id, pitch, startBeat, durationBeats, velocity: 100 })
const sd = notes => [...notes].sort((a, b) => a.startBeat - b.startBeat || a.durationBeats - b.durationBeats).map(n => [n.startBeat, n.durationBeats])

check('the loop range is [0, L) when looping, and the working range falls back to the clip', () => {
  assert.deepEqual(loopRange({ durationBeats: 8, loopEnabled: true, loopLengthBeats: 4, notes: [] }), { start: 0, end: 4 })
  assert.equal(loopRange({ durationBeats: 8, notes: [] }), null)
  assert.deepEqual(workingRange({ durationBeats: 8, notes: [] }), { start: 0, end: 8 })
  assert.deepEqual(notesInRange([note('a', 0), note('b', 3.9), note('c', 4)], 0, 4).map(n => n.id), ['a', 'b'])
})
check('Duplicate Loop doubles the loop, copies its notes, and moves what came after by the loop length', () => {
  const clip = { durationBeats: 8, loopEnabled: true, loopLengthBeats: 2, notes: [note('a', 0), note('b', 1), note('c', 5)] }
  const r = duplicateLoop(clip, newId)
  assert.equal(r.loopLengthBeats, 4)
  assert.deepEqual(sd(r.notes), [[0, 1], [1, 1], [2, 1], [3, 1], [7, 1]])
  assert.equal(r.durationBeats, 8, 'fits in the clip already')
  const grown = duplicateLoop({ durationBeats: 4, loopEnabled: true, loopLengthBeats: 4, notes: [note('a', 0)] }, newId)
  assert.equal(grown.durationBeats, 8, 'the clip grows to hold the doubled loop')
  assert.equal(duplicateLoop({ durationBeats: 8, notes: [] }, newId), null)
})
check('Crop keeps what is inside the range, trimmed, and moves it to 0', () => {
  const clip = { durationBeats: 8, loopEnabled: true, loopLengthBeats: 8, notes: [note('a', 0, 3), note('b', 2.5, 1), note('c', 3, 1), note('d', 4, 1), note('e', 7, 2)] }
  const r = cropToRange(clip, 2, 5)
  assert.deepEqual(sd(r.notes), [[0, 1], [0.5, 1], [1, 1], [2, 1]])
  assert.equal(r.durationBeats, 3)
  assert.equal(r.loopLengthBeats, 3, 'a longer loop shrinks to the crop')
  assert.equal(cropToRange(clip, 3, 3), null)
})
check('Insert Time opens a gap: later notes move, a spanning note grows', () => {
  const out = insertTime([note('a', 0, 2), note('b', 1, 0.5), note('c', 3, 1)], 1, 2)
  assert.deepEqual(sd(out), [[0, 4], [3, 0.5], [5, 1]])
})
check('Delete Time closes a gap: inside notes go, edges trim, later notes move up', () => {
  const out = deleteTime([note('a', 0, 2), note('b', 1.5, 0.25), note('c', 2, 2), note('d', 4, 1), note('e', 0, 6)], 1, 3)
  // a: 0..2 → trimmed to 0..1; b inside → gone; c: 2..4 → 3..4 becomes 1..2 (start min(2,1)=1, kept 1); d: 4→2; e: 0..6 spanning → 0..4
  assert.deepEqual(sd(out), [[0, 1], [0, 4], [1, 1], [2, 1]])
})
check('Duplicate Time copies the range after itself and moves what follows', () => {
  const out = duplicateTime([note('a', 0, 1), note('b', 1, 1), note('c', 2, 1), note('x', 1.5, 1)], 1, 2, newId)
  // a stays; b copied to 2; x (1.5..2.5) spans the end: head 1.5..2 stays, copy 2.5..3, tail moves to 3..3.5; c moves to 3
  assert.deepEqual(sd(out), [[0, 1], [1, 1], [1.5, 0.5], [2, 1], [2.5, 0.5], [3, 0.5], [3, 1]])
})
check('loop lengths parse from speech', () => {
  assert.equal(parseLoopLength('2 bars'), 8)
  assert.equal(parseLoopLength('a bar'), 4)
  assert.equal(parseLoopLength('eight beats'), 8)
  assert.equal(parseLoopLength('four bars', 3), 12)
  assert.equal(parseLoopLength('longer'), null)
})

console.log(failures ? `\n${failures} failing` : '\nthe brace holds')
process.exit(failures ? 1 : 0)
