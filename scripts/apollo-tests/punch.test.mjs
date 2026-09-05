// Punch in and punch out (lib/punch.ts): recording that starts and stops at the
// loop brace by itself, so a fix in the middle of a take cannot eat what is
// either side of it.
//
//   node scripts/apollo-tests/punch.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { planPunch, describePunch, punchArmed } = await importTs('lib/punch.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }

// A brace over bars 5 to 9 in four-four.
const brace = { loopStart: 16, loopEnd: 32 }

console.log('\nnothing armed')

ok('no punch means record now, stop when told', () => {
  const p = planPunch({ ...brace }, 0)
  assert.equal(p.startAt, null)
  assert.equal(p.stopAt, null)
  assert.equal(p.refused, undefined)
  assert.equal(punchArmed({ ...brace }), false)
})

console.log('\npunch in')

ok('a playhead before the brace waits for it', () => {
  const p = planPunch({ ...brace, punchIn: true }, 8)
  assert.equal(p.startAt, 16)
  assert.equal(p.stopAt, null)
})

ok('a playhead already INSIDE the brace records now', () => {
  // ⚠️ Waiting for the next pass would throw away the take somebody is playing.
  const p = planPunch({ ...brace, punchIn: true }, 20)
  assert.equal(p.startAt, null, 'it would have sat there while they played')
  assert.equal(p.refused, undefined)
})

ok('a playhead past the brace is refused, not recorded', () => {
  const p = planPunch({ ...brace, punchIn: true }, 40)
  assert.ok(p.refused, 'a recorder capturing silence looks exactly like one that works')
  assert.match(p.refused, /bar 9/)
  assert.equal(p.startAt, null)
})

console.log('\npunch out')

ok('it stops at the end of the brace', () => {
  const p = planPunch({ ...brace, punchOut: true }, 8)
  assert.equal(p.startAt, null, 'punch out on its own starts the take now')
  assert.equal(p.stopAt, 32)
})

ok('past the brace it is refused too', () => {
  const p = planPunch({ ...brace, punchOut: true }, 32)
  assert.ok(p.refused)
  assert.match(p.refused, /punch-out/)
})

console.log('\nboth')

ok('the take is exactly the brace, hands free', () => {
  const p = planPunch({ ...brace, punchIn: true, punchOut: true }, 0)
  assert.equal(p.startAt, 16)
  assert.equal(p.stopAt, 32)
})

ok('an empty brace is refused rather than silently doing nothing', () => {
  const p = planPunch({ loopStart: 16, loopEnd: 16, punchIn: true }, 0)
  assert.ok(p.refused)
  assert.match(p.refused, /empty/)
})

ok('a backwards brace is the same case', () => {
  const p = planPunch({ loopStart: 32, loopEnd: 16, punchOut: true }, 0)
  assert.ok(p.refused)
})

console.log('\nsaid out loud')

ok('each combination reads as what it does', () => {
  assert.equal(describePunch({ ...brace }), 'Recording starts and stops when you say so')
  assert.equal(describePunch({ ...brace, punchIn: true }), 'Recording starts at bar 5')
  assert.equal(describePunch({ ...brace, punchOut: true }), 'Recording stops at bar 9')
  assert.equal(describePunch({ ...brace, punchIn: true, punchOut: true }), 'Recording runs from bar 5 to bar 9')
})

ok('the bar numbers follow the meter', () => {
  // Three-four: bar 5 starts at beat 12, not beat 16.
  assert.equal(describePunch({ loopStart: 12, loopEnd: 24, punchIn: true, punchOut: true }, 3), 'Recording runs from bar 5 to bar 9')
})

console.log(`\n${passed} passed`)
