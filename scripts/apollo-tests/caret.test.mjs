// Keyboard-only editing (lib/caret.ts): the insert marker moves by the grid
// and clamps, boundaries are every note start and end, ⌥ arrows jump between
// them, a time selection grows from the marker and collapses back, Enter's
// two conversions, and ⇧ arrows resize by the grid. The roll is driven in
// .claude/caret-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { moveCaret, boundaries, nextBoundary, extendTimeSel, notesInTimeSel, timeOfNotes, resizeByGrid } = await importTs('lib/caret.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const note = (id, startBeat, durationBeats = 1) => ({ id, pitch: 60, startBeat, durationBeats, velocity: 100 })
const notes = [note('a', 0.5, 1), note('b', 2, 0.5), note('c', 2.5, 1)]

check('the insert marker moves by the grid and clamps to the clip', () => {
  assert.equal(moveCaret(0, 1, 0.25, 8), 0.25)
  assert.equal(moveCaret(0, -1, 0.25, 8), 0)
  assert.equal(moveCaret(7.9, 1, 0.25, 8), 8)
})
check('boundaries are the clip ends and every note start and end, once each', () => {
  assert.deepEqual(boundaries(notes, 8), [0, 0.5, 1.5, 2, 2.5, 3.5, 8])
})
check('⌥→ / ⌥← jump to the next / previous boundary and stay put at the ends', () => {
  assert.equal(nextBoundary(notes, 0, 1, 8), 0.5)
  assert.equal(nextBoundary(notes, 0.5, 1, 8), 1.5)
  assert.equal(nextBoundary(notes, 2.5, -1, 8), 2)
  assert.equal(nextBoundary(notes, 8, 1, 8), 8)
  assert.equal(nextBoundary(notes, 0, -1, 8), 0)
})
check('a time selection grows from the marker by the step, and collapses when it comes back', () => {
  const grid = (from, dir) => from + dir * 0.5
  let sel = extendTimeSel(null, 1, 1, grid, 8)
  assert.deepEqual(sel, { start: 1, end: 1.5 })
  sel = extendTimeSel(sel, 1, 1, grid, 8)
  assert.deepEqual(sel, { start: 1, end: 2 })
  sel = extendTimeSel(sel, 1, -1, grid, 8)
  assert.deepEqual(sel, { start: 1, end: 1.5 })
  sel = extendTimeSel(sel, 1, -1, grid, 8)
  assert.equal(sel, null, 'back at the marker there is no selection')
  assert.deepEqual(extendTimeSel(null, 1, -1, grid, 8), { start: 0.5, end: 1 }, 'it grows leftward too')
  assert.deepEqual(extendTimeSel(null, 7.8, 1, grid, 8), { start: 7.8, end: 8 }, 'and clamps to the clip')
})
check('a time selection can grow to note boundaries', () => {
  const step = (from, dir) => nextBoundary(notes, from, dir, 8)
  assert.deepEqual(extendTimeSel(null, 0, 1, step, 8), { start: 0, end: 0.5 })
  assert.deepEqual(extendTimeSel({ start: 0, end: 0.5 }, 0, 1, step, 8), { start: 0, end: 1.5 })
})
check('Enter: the notes starting inside a time selection; the time a note selection spans', () => {
  assert.deepEqual(notesInTimeSel(notes, { start: 0, end: 2.25 }).map(n => n.id), ['a', 'b'])
  assert.deepEqual(timeOfNotes([notes[1], notes[2]]), { start: 2, end: 3.5 })
  assert.equal(timeOfNotes([]), null)
})
check('⇧→ / ⇧← resize the selected notes by the grid, never below a step', () => {
  assert.deepEqual(resizeByGrid([note('a', 0, 1)], 1, 0.25), [{ id: 'a', patch: { durationBeats: 1.25 } }])
  assert.deepEqual(resizeByGrid([note('a', 0, 0.25)], -1, 0.25), [{ id: 'a', patch: { durationBeats: 0.25 } }])
})

console.log(failures ? `\n${failures} failing` : '\nno mouse needed')
process.exit(failures ? 1 : 0)
