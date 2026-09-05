// Quantize with settings (lib/quantize.ts): starts snap and keep their
// length, ends snap and never collapse a note, both snaps both, Amount moves
// part of the way, a triplet grid is two thirds of the value, the editor's
// grid stands in when none is set, and grids parse the way people say them.
// The dialog is driven in .claude/quantize-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { quantizeNotes, effectiveGrid, describeQuantize, parseGridSaid, gridLabel, DEFAULT_QUANTIZE } = await importTs('lib/quantize.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const note = (id, startBeat, durationBeats) => ({ id, pitch: 60, startBeat, durationBeats, velocity: 100 })
const apply = (notes, patches) => notes.map(n => ({ ...n, ...(patches.find(p => p.id === n.id)?.patch ?? {}) }))
const S = (over) => ({ ...DEFAULT_QUANTIZE, ...over })
const line = () => [note('a', 0.1, 0.9), note('b', 1.06, 0.4), note('c', 2.2, 1), note('d', 3.05, 0.6)]

check('a triplet grid is two thirds of the value', () => {
  assert.ok(Math.abs(effectiveGrid(0.5, true) - 1 / 3) < 1e-9)
  assert.equal(effectiveGrid(0.25, false), 0.25)
})
check('starts snap to the grid and keep their length; the editor grid stands in', () => {
  const out = apply(line(), quantizeNotes(line(), S({}), 0.25))
  assert.deepEqual(out.map(n => n.startBeat), [0, 1, 2.25, 3])
  assert.deepEqual(out.map(n => n.durationBeats), [0.9, 0.4, 1, 0.6])
})
check('an explicit grid wins over the editor grid', () => {
  const out = apply(line(), quantizeNotes(line(), S({ grid: 1 }), 0.25))
  assert.deepEqual(out.map(n => n.startBeat), [0, 1, 2, 3])
})
check('Amount moves the notes part of the way', () => {
  const out = apply(line(), quantizeNotes(line(), S({ grid: 1, amount: 50 }), 0.25))
  assert.ok(Math.abs(out[2].startBeat - 2.1) < 1e-9, String(out[2].startBeat))
  assert.equal(quantizeNotes(line(), S({ amount: 0 }), 0.25).length, 0)
})
check('ends snap, the start stays, and a note never collapses', () => {
  const out = apply(line(), quantizeNotes(line(), S({ grid: 1, target: 'end' }), 0.25))
  // a: 0.1..1.0 → end 1 (unchanged); b: 1.06..1.46 → end 1 would collapse → 2; c: 2.2..3.2 → 3; d: 3.05..3.65 → 4
  assert.deepEqual(out.map(n => n.startBeat), [0.1, 1.06, 2.2, 3.05])
  assert.deepEqual(out.map(n => +(n.startBeat + n.durationBeats).toFixed(6)), [1, 2, 3, 4])
})
check('both snaps the start, then the end from there', () => {
  const out = apply(line(), quantizeNotes(line(), S({ grid: 0.5, target: 'both' }), 0.25))
  assert.deepEqual(out.map(n => [n.startBeat, +(n.startBeat + n.durationBeats).toFixed(6)]), [[0, 1], [1, 1.5], [2, 3], [3, 3.5]])
})
check('eighth-note triplets put a run onto thirds of a beat', () => {
  const out = apply(line(), quantizeNotes(line(), S({ grid: 0.5, triplet: true }), 0.25))
  assert.deepEqual(out.map(n => +n.startBeat.toFixed(4)), [0, 1, 2.3333, 3])
})
check('the settings read back in words, and grids parse from speech', () => {
  assert.equal(describeQuantize(S({}), 0.25), "1/16 (the editor's grid) · starts · 100 %")
  assert.equal(describeQuantize(S({ grid: 0.5, triplet: true, target: 'end', amount: 50 }), 0.25), '1/8 triplets · ends · 50 %')
  assert.equal(gridLabel(0.5, true), '1/8T')
  assert.deepEqual(parseGridSaid('eighth note triplets'), { grid: 0.5, triplet: true })
  assert.deepEqual(parseGridSaid('to sixteenths'), { grid: 0.25, triplet: false })
  assert.deepEqual(parseGridSaid('1/32'), { grid: 0.125, triplet: false })
  assert.deepEqual(parseGridSaid('triplets'), { grid: 0.5, triplet: true }, 'bare triplets are eighth triplets')
  assert.equal(parseGridSaid('the drums'), null)
})

console.log(failures ? `\n${failures} failing` : '\nthe grid holds')
process.exit(failures ? 1 : 0)
