// Playing the session grid from the keyboard (lib/session-keys.ts): where the
// highlight goes, what is under it, and what "capture what is playing" means.
//
//   node scripts/apollo-tests/session-keys.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { moveSpot, clipAt, captureScene, describeCapture, PAGE } = await importTs('lib/session-keys.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
const at = (track, scene) => ({ track, scene })

console.log('\nmoving the highlight')

ok('arrows move it one cell', () => {
  assert.deepEqual(moveSpot(at(1, 1), 'up', 3, 4), at(1, 0))
  assert.deepEqual(moveSpot(at(1, 1), 'down', 3, 4), at(1, 2))
  assert.deepEqual(moveSpot(at(1, 1), 'left', 3, 4), at(0, 1))
  assert.deepEqual(moveSpot(at(1, 1), 'right', 3, 4), at(2, 1))
})

ok('it stops at the edges rather than wrapping', () => {
  // ⚠️ Wrapping would mean Down at the bottom quietly pointing at the first
  // scene, and the next Enter firing a clip from the top of the set — during a
  // performance, which is the one mistake this view cannot make.
  assert.deepEqual(moveSpot(at(0, 0), 'up', 3, 4), at(0, 0))
  assert.deepEqual(moveSpot(at(0, 3), 'down', 3, 4), at(0, 3))
  assert.deepEqual(moveSpot(at(0, 0), 'left', 3, 4), at(0, 0))
  assert.deepEqual(moveSpot(at(2, 0), 'right', 3, 4), at(2, 0))
})

ok('page and home and end cover a long set', () => {
  assert.equal(PAGE, 8)
  assert.deepEqual(moveSpot(at(0, 12), 'pageUp', 2, 20), at(0, 4))
  assert.deepEqual(moveSpot(at(0, 12), 'pageDown', 2, 20), at(0, 19), 'a page past the end lands on the last scene')
  assert.deepEqual(moveSpot(at(0, 12), 'home', 2, 20), at(0, 0))
  assert.deepEqual(moveSpot(at(0, 12), 'end', 2, 20), at(0, 19))
  assert.deepEqual(moveSpot(at(0, 2), 'pageUp', 2, 20), at(0, 0), 'and a page from near the top just reaches it')
})

ok('an empty grid has nowhere to go', () => {
  assert.deepEqual(moveSpot(at(0, 0), 'down', 0, 0), at(0, 0))
  assert.deepEqual(moveSpot(at(0, 0), 'right', 0, 0), at(0, 0))
})

console.log('\nwhat is under it')

const grid = {
  t1: [{ id: 'a' }, null, { id: 'c' }],
  t2: [null, { id: 'b' }, null],
}

ok('the clip under the highlight, or nothing', () => {
  assert.equal(clipAt(grid, ['t1', 't2'], at(0, 0))?.id, 'a')
  assert.equal(clipAt(grid, ['t1', 't2'], at(1, 1))?.id, 'b')
  assert.equal(clipAt(grid, ['t1', 't2'], at(0, 1)), null)
  assert.equal(clipAt(grid, ['t1', 't2'], at(5, 0)), null, 'off the end of the tracks')
})

console.log('\ncapturing what is playing')

let n = 0
const id = () => `new${++n}`

ok('a captured scene holds copies of the clips that are sounding', () => {
  const clips = captureScene(grid, { t1: 'c', t2: 'b' }, id)
  assert.deepEqual(Object.keys(clips).sort(), ['t1', 't2'])
  assert.equal(clips.t1.id, 'new1', 'a copy with its own id — two rows must not share one clip object')
  assert.equal(clips.t2.id, 'new2')
})

ok('a track playing nothing contributes nothing, rather than a silence', () => {
  // ⚠️ Capturing what you have should not change what you hear: an empty slot
  // in the new scene would STOP that track the moment the scene is launched.
  const clips = captureScene(grid, { t1: 'a', t2: null }, id)
  assert.deepEqual(Object.keys(clips), ['t1'])
})

ok('a clip that is no longer in the grid is not captured', () => {
  assert.deepEqual(captureScene(grid, { t1: 'gone' }, id), {})
})

ok('and it says what it took', () => {
  assert.equal(describeCapture({ t1: { id: 'x' }, t2: { id: 'y' } }), '2 clips')
  assert.equal(describeCapture({ t1: { id: 'x' } }), '1 clip')
  assert.equal(describeCapture({}), 'nothing playing')
})

console.log(`\n${passed} passed`)
