// Time commands across the whole song (lib/arrangement-time.ts): a span opens
// up, closes up, or happens twice — and EVERYTHING moves with it.
//
//   node scripts/apollo-tests/arrangement-time.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { insertTime, deleteTime, duplicateTime, describeTimeSpan } = await importTs('lib/arrangement-time.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
let n = 0
const id = () => `n${++n}`

// Bars of four. A clip at bar 1, one at bar 3, automation across, a marker at
// bar 3, and a tempo change at bar 3.
const project = () => ({
  arrangementClips: [
    { kind: 'midi', id: 'a', trackId: 't1', name: 'A', startBeat: 0, durationBeats: 8, notes: [] },
    { kind: 'midi', id: 'b', trackId: 't1', name: 'B', startBeat: 8, durationBeats: 8, notes: [] },
  ],
  automationLanes: [{ id: 'l1', trackId: 't1', parameter: 'volume', label: 'Volume', min: 0, max: 1, defaultValue: 0.8, expanded: false,
    points: [{ beat: 0, value: 0.5 }, { beat: 8, value: 1 }, { beat: 12, value: 0.2 }] }],
  cueMarkers: [{ id: 'm1', beat: 0, name: 'Intro' }, { id: 'm2', beat: 8, name: 'Chorus' }],
  tempoMarkers: [{ id: 'tm0', beat: 0, tempo: 120 }, { id: 'tm1', beat: 8, tempo: 140 }],
  meterMarkers: [{ id: 'mm0', beat: 0, num: 4, den: 4 }],
})

console.log('\ninserting silence')

ok('everything at or after the point moves later together', () => {
  const p = insertTime(project(), 8, 4)
  assert.deepEqual(p.arrangementClips.map(c => c.startBeat), [0, 12])
  assert.deepEqual(p.automationLanes[0].points.map(x => x.beat), [0, 12, 16])
  assert.deepEqual(p.cueMarkers.map(m => m.beat), [0, 12])
  assert.deepEqual(p.tempoMarkers.map(m => m.beat), [0, 12])
})

ok('a clip the silence lands INSIDE is stretched, not moved', () => {
  // ⚠️ Moving it would leave a hole where its first half was.
  const p = insertTime(project(), 4, 4)
  const a = p.arrangementClips.find(c => c.id === 'a')
  assert.equal(a.startBeat, 0)
  assert.equal(a.durationBeats, 12)
})

ok('the opening tempo and meter never move', () => {
  const p = insertTime(project(), 0, 4)
  assert.equal(p.tempoMarkers[0].beat, 0, 'the first bars would have no tempo at all')
  assert.equal(p.meterMarkers[0].beat, 0)
})

ok('nothing to insert changes nothing', () => {
  const p = project()
  assert.equal(insertTime(p, 4, 0), p)
})

console.log('\ndeleting time')

ok('the span goes and everything after it closes up', () => {
  const p = deleteTime(project(), 8, 12)
  assert.deepEqual(p.arrangementClips.map(c => [c.id, c.startBeat, c.durationBeats]), [['a', 0, 8], ['b', 8, 4]])
  // ⚠️ The marker and the tempo change at beat 8 were INSIDE the deleted span,
  // so they go with it — deleting a section takes its name and its tempo with
  // it, rather than leaving them pointing at whatever follows.
  assert.deepEqual(p.cueMarkers.map(m => m.beat), [0])
  assert.deepEqual(p.tempoMarkers.map(m => m.beat), [0])
})

ok('a clip wholly inside goes; one that only overlaps is trimmed', () => {
  // ⚠️ Deleting a clip somebody only meant to shorten costs an undo and a bit
  // of trust, so an overlap trims.
  const p = deleteTime(project(), 0, 8)
  assert.deepEqual(p.arrangementClips.map(c => c.id), ['b'], 'A was inside the span')
  assert.equal(p.arrangementClips[0].startBeat, 0)
  const q = deleteTime(project(), 4, 8)
  assert.equal(q.arrangementClips.find(c => c.id === 'a').durationBeats, 4, 'A kept its first half')
})

ok('a clip straddling the whole span just gets shorter', () => {
  const p = deleteTime({ ...project(), arrangementClips: [{ kind: 'midi', id: 'wide', trackId: 't1', name: 'W', startBeat: 0, durationBeats: 16, notes: [] }] }, 4, 8)
  assert.deepEqual(p.arrangementClips.map(c => [c.startBeat, c.durationBeats]), [[0, 12]])
})

ok('points inside the span land on the seam, and two on one beat are one', () => {
  const p = deleteTime(project(), 6, 10)
  assert.deepEqual(p.automationLanes[0].points.map(x => x.beat), [0, 6, 8])
  const markers = deleteTime(project(), 6, 10).cueMarkers.map(m => m.name)
  assert.deepEqual(markers, ['Intro'], 'a marker inside the deleted span goes with it')
})

console.log('\nduplicating time')

ok('the span happens twice and the rest moves along', () => {
  const p = duplicateTime(project(), 0, 8, id)
  const byStart = p.arrangementClips.map(c => c.startBeat).sort((x, y) => x - y)
  assert.deepEqual(byStart, [0, 8, 16], 'A, its copy, then B pushed later')
  assert.equal(p.arrangementClips.filter(c => c.name === 'A').length, 2)
})

ok('the copies are their own clips, not the same one twice', () => {
  const p = duplicateTime(project(), 0, 8, id)
  const ids = p.arrangementClips.map(c => c.id)
  assert.equal(new Set(ids).size, ids.length, 'editing one repeat must not edit the other')
})

ok('the automation and the markers in the span come with it', () => {
  const p = duplicateTime(project(), 0, 8, id)
  assert.ok(p.automationLanes[0].points.some(x => Math.abs(x.beat - 8) < 1e-6))
  assert.equal(p.cueMarkers.filter(m => m.name === 'Intro').length, 2)
})

ok('an empty span does nothing at all', () => {
  const p = project()
  assert.equal(duplicateTime(p, 4, 4, id), p)
  assert.equal(deleteTime(p, 4, 4), p)
})

ok('said in bars', () => {
  assert.equal(describeTimeSpan(8, 4, 4), '1 bar at bar 3')
  assert.equal(describeTimeSpan(0, 8, 4), '2 bars at bar 1')
  assert.equal(describeTimeSpan(0, 3, 4), '3 beats at bar 1')
})

console.log(`\n${passed} passed`)
