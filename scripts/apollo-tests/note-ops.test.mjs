// Note surgery (lib/note-ops.ts) and Find & Select (lib/find-notes.ts)
// produce exact results: a split's first piece keeps its id, chop makes
// equal parts and chop-on-grid cuts at grid lines, join merges a key track,
// fit scales a selection into a range, deactivate toggles, the overlap rule
// replaces or shortens, the stretch markers mirror past each other and the
// pseudo marker warps the inside; filters combine and invert and parse.
// The roll is driven in .claude/note-ops-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { splitAt, chopNotes, chopOnGrid, joinNotes, fitToRange, setActive, anyInactive, resolveOverlaps, applySplice } = await importTs('lib/note-ops.ts')
const { findNotes, describeFilter, parseFilter, filterIsEmpty } = await importTs('lib/find-notes.ts')
const { stretchNotes, warpNotes } = await importTs('lib/pitch-time.ts')
const { pitchOf } = await importTs('lib/note-address.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
let ids = 0
const newId = () => `new${++ids}`
const note = (id, pitch, startBeat, durationBeats = 1, extra = {}) => ({ id, pitch, startBeat, durationBeats, velocity: 100, ...extra })
const apply = (notes, patches) => notes.map(n => ({ ...n, ...(patches.find(p => p.id === n.id)?.patch ?? {}) }))
const CMAJ = { root: 0, intervals: [0, 2, 4, 5, 7, 9, 11] }

check('splitAt cuts every note spanning the beat; the first piece keeps the id', () => {
  const s = splitAt([note('a', 60, 0, 2), note('b', 64, 2, 1)], 1, newId)
  assert.deepEqual(s.remove, ['a'])
  assert.deepEqual(s.add.map(n => [n.id === 'a', n.startBeat, n.durationBeats]), [[true, 0, 1], [false, 1, 1]])
  assert.deepEqual(splitAt([note('a', 60, 0, 2)], 2, newId), { remove: [], add: [] }, 'a cut on the edge is no cut')
})
check('chop makes N equal parts; chop on the grid cuts at grid lines only', () => {
  const s = chopNotes([note('a', 60, 1, 1)], 4, newId)
  assert.deepEqual(s.add.map(n => [n.startBeat, n.durationBeats]), [[1, 0.25], [1.25, 0.25], [1.5, 0.25], [1.75, 0.25]])
  const g = chopOnGrid([note('a', 60, 0.5, 1.5)], 0.5, newId)
  assert.deepEqual(g.add.map(n => n.startBeat), [0.5, 1, 1.5])
  assert.deepEqual(chopOnGrid([note('a', 60, 0, 0.25)], 0.5, newId), { remove: [], add: [] }, 'a note inside one grid step is left alone')
  assert.deepEqual(chopNotes([note('a', 60, 0, 1 / 64)], 2, newId), { remove: [], add: [] }, 'nothing smaller than a 64th')
})
check('join merges the notes on each key into one, from the earliest start to the latest end', () => {
  const s = joinNotes([note('a', 60, 0, 0.5, { velocity: 90 }), note('b', 60, 1, 1), note('c', 64, 0, 1), note('d', 60, 0.5, 0.25)])
  assert.deepEqual([...s.remove].sort(), ['a', 'b', 'd'])
  assert.equal(s.add.length, 1)
  assert.deepEqual([s.add[0].id, s.add[0].startBeat, s.add[0].durationBeats, s.add[0].velocity], ['a', 0, 2, 90])
  const after = applySplice([note('a', 60, 0), note('b', 60, 1), note('c', 64, 0)], s)
  assert.equal(after.length, 2)
})
check('fit to range scales the selection so it fills exactly [start, end]', () => {
  const l = [note('a', 60, 1, 1), note('b', 64, 2, 1), note('c', 67, 3, 1)]   // 1..4
  const out = apply(l, fitToRange(l, 0, 6))
  assert.deepEqual(out.map(n => [n.startBeat, n.durationBeats]), [[0, 2], [2, 2], [4, 2]])
  const one = apply([note('a', 60, 3, 1)], fitToRange([note('a', 60, 3, 1)], 0, 4))
  assert.deepEqual([one[0].startBeat, one[0].durationBeats], [0, 4], 'a single note fills the range')
  assert.deepEqual(fitToRange(l, 4, 4), [])
})
check('deactivate marks notes off and back on, skipping the ones already there', () => {
  const l = [note('a', 60, 0), note('b', 60, 1, 1, { active: false })]
  assert.deepEqual(setActive(l, false), [{ id: 'a', patch: { active: false } }])
  assert.deepEqual(setActive(l, true), [{ id: 'b', patch: { active: undefined } }])
  assert.equal(anyInactive(l), true); assert.equal(anyInactive([l[0]]), false)
})
check('the overlap rule: landing on a start replaces; landing inside shortens; other keys are untouched', () => {
  const notes = [note('a', 60, 0, 2), note('b', 60, 3, 1), note('c', 64, 0, 4), note('x', 60, 1, 1)]
  const r = resolveOverlaps(notes, new Set(['x']))
  assert.deepEqual(r.remove, [], 'x lands inside a, not on its start')
  assert.deepEqual(r.patches, [{ id: 'a', patch: { durationBeats: 1 } }])
  const r2 = resolveOverlaps([note('a', 60, 1, 1), note('y', 60, 0.5, 1)], new Set(['y']))
  assert.deepEqual(r2.remove, ['a'], 'y covers the start of a')
  const r3 = resolveOverlaps([note('p', 60, 0, 1), note('q', 60, 0.5, 1)], new Set(['p', 'q']))
  assert.deepEqual(r3, { remove: [], patches: [] }, 'two notes that both just landed are left alone')
})
check('stretch markers: an anchor at the end, and a drag past the other end mirrors the order', () => {
  const l = [note('a', 60, 0, 1), note('b', 64, 1, 1), note('c', 67, 2, 1)]   // 0..3
  const fromEnd = apply(l, stretchNotes(l, 2, 3))
  assert.deepEqual(fromEnd.map(n => n.startBeat), [-3, -1, 1].map(s => Math.max(0, s)), 'anchored at the end, the start goes left (clamped at 0)')
  const mirrored = apply(l, stretchNotes(l, -1, 0))
  // t → -t: a (0..1) → (-1..0) → start clamps to 0; use an anchor at 3 instead to keep it on the canvas.
  const m2 = apply(l, stretchNotes(l, -1, 3))
  assert.deepEqual(m2.map(n => [n.startBeat, n.durationBeats]), [[5, 1], [4, 1], [3, 1]], 'mirrored around the end: c first, then b, then a')
  assert.ok(mirrored.every(n => n.durationBeats === 1))
})
check('the pseudo marker warps the inside and keeps the ends', () => {
  const l = [note('a', 60, 0, 1), note('b', 64, 1, 1), note('c', 67, 2, 1), note('d', 71, 3, 1)]   // 0..4, mid 2
  const w = apply(l, warpNotes(l, 0, 2, 4, 3))
  assert.deepEqual(w.map(n => [n.startBeat, n.durationBeats]), [[0, 1.5], [1.5, 1.5], [3, 0.5], [3.5, 0.5]])
  assert.deepEqual(warpNotes(l, 0, 2, 4, 4), [], 'the middle cannot pass an end')
})
check('filters pick by pitch class, velocity, duration, condition, nth, scale — and combine', () => {
  const l = [
    note('a', 60, 0, 1, { velocity: 40 }), note('b', 61, 1, 0.25), note('c', 72, 2, 1, { chance: 0.5 }),
    note('d', 64, 3, 0.25, { active: false }), note('e', 60, 4, 2, { deviation: 10 }),
  ]
  const ids = (f, ctx) => findNotes(l, f, ctx).map(n => n.id)
  assert.deepEqual(ids({ pitchClass: 0 }), ['a', 'c', 'e'])
  assert.deepEqual(ids({ velocityMax: 60 }), ['a'])
  assert.deepEqual(ids({ durationMax: 0.25 }), ['b', 'd'])
  assert.deepEqual(ids({ condition: 'inactive' }), ['d'])
  assert.deepEqual(ids({ condition: 'chance' }), ['c'])
  assert.deepEqual(ids({ condition: 'deviation' }), ['e'])
  assert.deepEqual(ids({ everyNth: 2 }), ['a', 'c', 'e'])
  assert.deepEqual(ids({ everyNth: 2, offset: 1 }), ['b', 'd'])
  assert.deepEqual(ids({ scale: 'out' }, { scale: CMAJ }), ['b'])
  assert.deepEqual(ids({ pitchClass: 0, durationMin: 1.5 }), ['e'], 'filters AND together')
  assert.deepEqual(ids({ pitchClass: 0, invert: true }), ['b', 'd'])
  assert.deepEqual(ids({ timeFrom: 0, timeTo: 1, repeatEvery: 4 }), ['a', 'e'], 'the first beat of every bar')
  assert.equal(filterIsEmpty({}), true); assert.equal(filterIsEmpty({ invert: false }), true); assert.equal(filterIsEmpty({ pitchClass: 0 }), false)
})
check('a filter reads back in words', () => {
  assert.equal(describeFilter({ pitchClass: 0 }), 'every C')
  assert.equal(describeFilter({ velocityMax: 60, invert: true }), 'all but velocity 1–60')
  assert.equal(describeFilter({ everyNth: 2 }), 'every other note')
  assert.equal(describeFilter({}), 'every note')
})
check('a filter parses from the way people say it', () => {
  const p = s => parseFilter(s, x => pitchOf(x)?.pitch ?? null)
  assert.deepEqual(p('every c in the pad'), { pitchClass: 0 })
  assert.deepEqual(p('the quiet notes'), { velocityMax: 60 })
  assert.deepEqual(p('the notes louder than 100'), { velocityMin: 101 })
  assert.deepEqual(p('the short notes'), { durationMax: 0.25 })
  assert.deepEqual(p('every other note'), { everyNth: 2 })
  assert.deepEqual(p('the notes off the scale'), { scale: 'out' })
  assert.deepEqual(p('the deactivated notes'), { condition: 'inactive' })
  assert.deepEqual(p('the notes above c5'), { pitchMin: 73 })
  assert.equal(p('the pad'), null)
})

console.log(failures ? `\n${failures} failing` : '\nthe cuts are exact')
process.exit(failures ? 1 : 0)
