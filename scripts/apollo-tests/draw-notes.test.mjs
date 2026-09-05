// The pencil's arithmetic (lib/draw-notes.ts): a click is one grid-length
// note, a drag across is one per step, Pitch Lock holds the row, dragging
// back erases, a vertical drag sets velocity, and a loop's pattern length is
// the edge of the paper. The roll is driven in .claude/draw-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { beginStroke, strokeTo, velocityFromDrag, noteUnder, stepOf } = await importTs('lib/draw-notes.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
let n = 0
const ids = () => `n${++n}`

check('a click places one grid-length note on the grid', () => {
  const s = beginStroke(1.3, 60, 0.25, 100, true)
  const r = strokeTo(s, 1.3, 60, ids)
  assert.equal(r.add.length, 1)
  assert.deepEqual([r.add[0].startBeat, r.add[0].durationBeats, r.add[0].pitch, r.add[0].velocity], [1.25, 0.25, 60, 100])
  assert.equal(r.remove.length, 0)
})
check('dragging across places one note per step, no duplicates', () => {
  const s = beginStroke(0, 60, 0.25, 90, true)
  strokeTo(s, 0, 60, ids)
  const r = strokeTo(s, 1.9, 60, ids)           // through step 7
  assert.equal(r.add.length, 7)
  assert.deepEqual(r.add.map(x => x.startBeat), [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75])
  const again = strokeTo(s, 1.95, 60, ids)      // still step 7: nothing new
  assert.equal(again.add.length, 0)
  assert.equal(s.placed.size, 8)
})
check('Pitch Lock keeps the row; unlocked follows the pointer', () => {
  const locked = beginStroke(0, 60, 0.5, 100, true)
  strokeTo(locked, 0, 60, ids)
  const r = strokeTo(locked, 1, 67, ids)
  assert.ok(r.add.every(x => x.pitch === 60))
  const free = beginStroke(0, 60, 0.5, 100, false)
  strokeTo(free, 0, 60, ids)
  const r2 = strokeTo(free, 1, 67, ids)
  assert.ok(r2.add.every(x => x.pitch === 67))
})
check('dragging back erases the steps behind the pointer', () => {
  const s = beginStroke(0, 60, 0.25, 100, true)
  strokeTo(s, 0, 60, ids); strokeTo(s, 2, 60, ids)      // 9 notes, steps 0..8
  assert.equal(s.placed.size, 9)
  const back = strokeTo(s, 1.1, 60, ids)                // back to step 4
  assert.equal(back.remove.length, 4)
  assert.equal(s.placed.size, 5)
  const fwd = strokeTo(s, 1.6, 60, ids)                 // forward again: fresh ids
  assert.equal(fwd.add.length, 2)
})
check('the stroke never goes before its start', () => {
  const s = beginStroke(2, 60, 0.5, 100, true)
  strokeTo(s, 2, 60, ids)
  const r = strokeTo(s, 0.2, 60, ids)
  assert.equal(r.add.length, 0); assert.equal(r.remove.length, 0); assert.equal(s.placed.size, 1)
})
check('a looped clip\'s pattern length is the edge of the paper', () => {
  const s = beginStroke(0, 60, 0.5, 100, true, 2)
  const r = strokeTo(s, 5, 60, ids)
  assert.deepEqual(r.add.map(x => x.startBeat), [0, 0.5, 1, 1.5])
})
check('a vertical drag sets the velocity, up is louder, clamped', () => {
  assert.equal(velocityFromDrag(100, 0), 100)
  assert.equal(velocityFromDrag(100, -50), 127)
  assert.equal(velocityFromDrag(100, 50), 37)
  assert.equal(velocityFromDrag(100, 500), 1)
})
check('a click on a note finds it; the grid step floors', () => {
  const notes = [{ id: 'a', pitch: 60, startBeat: 1, durationBeats: 0.5, velocity: 100 }]
  assert.equal(noteUnder(notes, 1.2, 60)?.id, 'a')
  assert.equal(noteUnder(notes, 1.5, 60), undefined)
  assert.equal(noteUnder(notes, 1.2, 61), undefined)
  assert.equal(stepOf(0.99, 0.25), 3)
  assert.equal(stepOf(1.0, 0.25), 4)
})

console.log(failures ? `\n${failures} failing` : '\nthe pencil draws what it should')
process.exit(failures ? 1 : 0)
