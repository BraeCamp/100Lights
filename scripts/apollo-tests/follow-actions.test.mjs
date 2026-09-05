// What a session clip does when its turn is over (lib/follow-actions.ts): two
// actions with a chance between them, where each one lands, and when it fires.
// The engine drives it; .claude/follow-check.mjs watches a real chain move.
//
//   node scripts/apollo-tests/follow-actions.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const {
  FOLLOW_ACTIONS, FOLLOW_LABEL, DEFAULT_FOLLOW, isIdle, followBeats, pickAction, followTarget,
  filledScenes, followOf, describeFollow,
} = await importTs('lib/follow-actions.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }

console.log('\nwhether there is anything to do')

ok('a clip with no follow action is left alone', () => {
  assert.equal(isIdle(undefined), true)
  assert.equal(isIdle({ a: 'none' }), true)
  assert.equal(isIdle(DEFAULT_FOLLOW), true)
  assert.equal(isIdle({ a: 'next', chanceA: 0, chanceB: 0 }), true, 'both weights zero is nothing at all')
  assert.equal(isIdle({ a: 'next' }), false)
  assert.equal(isIdle({ a: 'none', b: 'stop', chanceB: 1 }), false, 'the second action counts too')
})

ok('it fires after the clip\'s own length unless it is unlinked', () => {
  assert.equal(followBeats({ a: 'next' }, 8), 8)
  assert.equal(followBeats({ a: 'next', linked: true, time: 3 }, 8), 8, 'linked ignores the number')
  assert.equal(followBeats({ a: 'next', linked: false, time: 3 }, 8), 3)
  assert.equal(followBeats({ a: 'next', linked: false }, 8), 8, 'unlinked with no number is still the clip')
  assert.equal(followBeats(undefined, 0), 4, 'a clip with no length falls back to a bar')
})

console.log('\nchoosing between the two')

ok('one action, no chance to weigh', () => {
  assert.equal(pickAction({ a: 'next' }, 0), 'next')
  assert.equal(pickAction({ a: 'next' }, 0.999), 'next')
})

ok('the weights are a ratio, not percentages — 1 and 3 means three times as often', () => {
  const s = { a: 'again', b: 'next', chanceA: 1, chanceB: 3 }
  assert.equal(pickAction(s, 0.2), 'again', 'the first quarter is A')
  assert.equal(pickAction(s, 0.3), 'next')
  assert.equal(pickAction(s, 0.99), 'next')
})

ok('over two hundred launches the split lands where it was asked to', () => {
  // The plan's own QA: "A/B chances converge to their ratio over 200 launches."
  const s = { a: 'again', b: 'next', chanceA: 3, chanceB: 1 }
  let seed = 12345
  const rng = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 2 ** 32 }
  let a = 0
  for (let i = 0; i < 200; i++) if (pickAction(s, rng()) === 'again') a++
  assert.ok(Math.abs(a / 200 - 0.75) < 0.08, `${a}/200 were the first action`)
})

console.log('\nwhere it lands')

const filled = [0, 1, 3, 4]   // scene 2 is empty

ok('stop and again need no neighbours', () => {
  assert.equal(followTarget('stop', 1, filled, 0), 'stop')
  assert.equal(followTarget('again', 1, filled, 0), 1)
  assert.equal(followTarget('none', 1, filled, 0), null)
})

ok('next and previous skip the empty slots, and go round the ends', () => {
  assert.equal(followTarget('next', 1, filled, 0), 3, 'scene 2 is empty, so next is 3')
  assert.equal(followTarget('previous', 3, filled, 0), 1)
  assert.equal(followTarget('next', 4, filled, 0), 0, 'the last wraps to the first — a chain of four keeps going round')
  assert.equal(followTarget('previous', 0, filled, 0), 4)
})

ok('first and last are the first and last that hold something', () => {
  assert.equal(followTarget('first', 3, filled, 0), 0)
  assert.equal(followTarget('last', 0, filled, 0), 4)
})

ok('any can pick this one; other never can', () => {
  const seen = new Set()
  for (let i = 0; i < 40; i++) seen.add(followTarget('any', 1, filled, i / 40))
  assert.deepEqual([...seen].sort((x, y) => x - y), filled, 'any reaches every filled scene')
  const others = new Set()
  for (let i = 0; i < 40; i++) others.add(followTarget('other', 1, filled, i / 40))
  assert.equal(others.has(1), false, 'other never lands on the clip that asked')
  assert.equal(followTarget('other', 0, [0], 0), 0, 'the only clip there is has nowhere else to go')
})

ok('jump goes where it is told, and nowhere if that slot is empty', () => {
  assert.equal(followTarget('jump', 0, filled, 0, 4), 4)
  assert.equal(followTarget('jump', 0, filled, 0, 2), null, 'scene 2 holds nothing')
  assert.equal(followTarget('jump', 0, filled, 0), null, 'and it has to be told')
})

ok('an empty column has nowhere to go', () => {
  assert.equal(followTarget('next', 0, [], 0), null)
  assert.equal(followTarget('stop', 0, [], 0), 'stop', 'except stopping')
})

ok('a deactivated clip is not somewhere to land', () => {
  const row = [{ id: 'a' }, null, { id: 'c', active: false }, { id: 'd' }]
  assert.deepEqual(filledScenes(row), [0, 3])
  assert.deepEqual(filledScenes(undefined), [])
})

console.log('\nolder projects, and saying it out loud')

ok('a clip saved with the old single action still behaves', () => {
  assert.deepEqual(followOf({ followAction: 'next' }), { a: 'next', chanceA: 1, chanceB: 0, linked: true, time: undefined })
  assert.equal(followOf({ followAction: 'prev' })?.a, 'previous', 'the old name for it')
  assert.equal(followOf({ followAction: 'random' })?.a, 'any')
  assert.equal(followOf({ followAction: 'none' }), undefined)
  assert.equal(followOf({}), undefined)
  assert.equal(followOf({ followAction: 'next', follow: { a: 'stop' } })?.a, 'stop', 'the new field wins')
  assert.equal(followOf({ followAction: 'next', followActionTime: 6 })?.time, 6)
})

ok('what it does, in a line', () => {
  assert.equal(describeFollow(undefined, 8), 'no follow action')
  assert.equal(describeFollow({ a: 'next' }, 8), 'next after 8 beats')
  assert.equal(describeFollow({ a: 'again', b: 'next', chanceA: 3, chanceB: 1 }, 8), 'play again 75% of the time, otherwise next, after 8 beats')
  assert.equal(FOLLOW_ACTIONS.length, 10)
  assert.equal(FOLLOW_LABEL.other, 'Any other')
})

console.log(`\n${passed} passed`)
