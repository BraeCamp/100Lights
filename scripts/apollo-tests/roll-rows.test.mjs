// The roll's row model (lib/roll-rows.ts): Fold keeps only the pitches in
// use, Fold to Scale keeps the scale plus any used pitch, both together keep
// what is used, nothing ever hides every row, Focus scrolls to the notes,
// and the step marker advances on the grid and wraps. The roll is driven in
// .claude/fold-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { visibleRows, rowIndexOf, focusScrollTop, stepAdvance, stepMove, CHROMATIC_ROWS } = await importTs('lib/roll-rows.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const CMAJ = new Set([0, 2, 4, 5, 7, 9, 11])
const notes = [60, 64, 67, 61].map(p => ({ pitch: p }))   // C E G + a Db outside the key

check('unfolded is the whole chromatic range, highest first', () => {
  const rows = visibleRows({ fold: false, foldScale: false, inScale: CMAJ, notes })
  assert.equal(rows.length, 128); assert.equal(rows[0], 127); assert.equal(rows[127], 0)
  assert.equal(rows, CHROMATIC_ROWS)
})
check('Fold keeps only the pitches in use', () => {
  assert.deepEqual(visibleRows({ fold: true, foldScale: false, inScale: CMAJ, notes }), [67, 64, 61, 60])
})
check('Fold to Scale keeps the scale — and any used pitch outside it', () => {
  const rows = visibleRows({ fold: false, foldScale: true, inScale: CMAJ, notes })
  assert.ok(rows.includes(61), 'the Db with a note stays')
  assert.ok(!rows.includes(63), 'an unused Eb goes')
  assert.equal(rows.filter(p => p % 12 === 0).length, 11, 'every C stays')
})
check('both folds together keep what is used', () => {
  assert.deepEqual(visibleRows({ fold: true, foldScale: true, inScale: CMAJ, notes }), [67, 64, 61, 60])
})
check('a fold with nothing to show falls back to the full range', () => {
  assert.equal(visibleRows({ fold: true, foldScale: false, inScale: CMAJ, notes: [] }).length, 128)
})
check('row lookups agree with the rows', () => {
  const rows = [67, 64, 61, 60]
  const idx = rowIndexOf(rows)
  assert.equal(idx.get(64), 1); assert.equal(idx.get(62), undefined)
})
check('Focus centres the notes in the viewport, clamped', () => {
  const rows = CHROMATIC_ROWS
  const top = focusScrollTop(rows, [{ pitch: 60 }, { pitch: 64 }], 10, 200)
  // rows for 64..60 are indices 63..67 → 630..680 px, middle 655 → top 555
  assert.equal(top, 555)
  assert.equal(focusScrollTop(rows, [{ pitch: 127 }], 10, 200), 0)
  assert.equal(focusScrollTop(rows, [], 10, 200), null)
  assert.equal(focusScrollTop([67, 64], [{ pitch: 60 }], 10, 200), null, 'a hidden pitch cannot be focused')
})
check('the step marker advances by the grid and wraps at the clip end', () => {
  assert.equal(stepAdvance(0, 0.25, 4), 0.25)
  assert.equal(stepAdvance(3.75, 0.25, 4), 0)
  assert.equal(stepMove(1, 1, 0.5, 4), 1.5)
  assert.equal(stepMove(0, -1, 0.5, 4), 0)
  assert.equal(stepMove(3.7, 1, 0.5, 4), 3.5)
})

console.log(failures ? `\n${failures} failing` : '\nthe rows fold and unfold')
process.exit(failures ? 1 : 0)
