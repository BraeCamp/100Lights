// How a session slot answers a press (lib/launch.ts): the four launch modes,
// what a release means, the repeat interval, Velocity Amount and Legato.
// The engine and the session view are driven in .claude/launch-check.mjs.
//
//   node scripts/apollo-tests/launch.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const {
  LAUNCH_MODES, DEFAULT_LAUNCH_MODE, LAUNCH_MODE_LABEL, modeOf, onPress, onRelease, repeats, repeatBeats,
  velocityGain, legatoOffset, describeLaunch,
  LAUNCH_QUANTIZATIONS, DEFAULT_LAUNCH_QUANTIZATION, launchQuantLabel, launchQuantShort,
} = await importTs('lib/launch.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`)

console.log('\nwhat a press means')

ok('Toggle is the default, and it is what Beacon has always done: press to start, press again to stop', () => {
  assert.equal(DEFAULT_LAUNCH_MODE, 'toggle')
  assert.equal(modeOf(undefined), 'toggle')
  assert.equal(modeOf('nonsense'), 'toggle')
  assert.equal(onPress(undefined, false), 'start')
  assert.equal(onPress(undefined, true), 'stop')
})

ok('Trigger starts it again from the top, even while it plays', () => {
  assert.equal(onPress('trigger', false), 'start')
  assert.equal(onPress('trigger', true), 'start')
})

ok('Gate and Repeat start on the press whatever is playing', () => {
  for (const m of ['gate', 'repeat']) {
    assert.equal(onPress(m, false), 'start', m)
    assert.equal(onPress(m, true), 'start', m)
  }
})

console.log('\nwhat letting go means')

ok('only Gate and Repeat answer the release', () => {
  assert.equal(onRelease('gate'), 'stop')
  assert.equal(onRelease('repeat'), 'stop')
  assert.equal(onRelease('trigger'), 'none')
  assert.equal(onRelease('toggle'), 'none')
  assert.equal(onRelease(undefined), 'none')
})

ok('Repeat is the one mode that keeps firing while held', () => {
  assert.equal(repeats('repeat'), true)
  for (const m of ['trigger', 'gate', 'toggle', undefined]) assert.equal(repeats(m), false, String(m))
})

ok('the repeat interval is the clip\'s launch quantization, and a beat when it has none', () => {
  assert.equal(repeatBeats('beat', 4), 1)
  assert.equal(repeatBeats('bar', 4), 4)
  assert.equal(repeatBeats('2bar', 4), 8)
  assert.equal(repeatBeats('4bar', 4), 16)
  assert.equal(repeatBeats('bar', 3), 3, 'in 3/4 a bar is three beats')
  assert.equal(repeatBeats('none', 4), 1, 'launching on the press means no interval at all — a beat is the floor')
  assert.equal(repeatBeats(undefined, 4), 1)
  assert.equal(repeatBeats('bar', 0), 4, 'a nonsense bar length falls back to four')
})

console.log('\nvelocity and legato')

ok('Velocity Amount 0 ignores the press entirely — which is what a mouse click means', () => {
  assert.equal(velocityGain(undefined, 1), 1)
  assert.equal(velocityGain(0, 1), 1)
})

ok('at full amount the level follows the velocity, and in between it is mixed', () => {
  assert.equal(velocityGain(1, 127), 1)
  near(velocityGain(1, 0), 0)
  near(velocityGain(1, 64), 64 / 127)
  near(velocityGain(0.5, 0), 0.5)
  assert.equal(velocityGain(1), 1, 'no velocity said means full')
})

ok('the amount and the velocity are both clamped', () => {
  assert.equal(velocityGain(5, 200), 1)
  assert.equal(velocityGain(-1, 64), 1, 'a negative amount is no amount')
  near(velocityGain(1, -5), 0)
})

ok('legato starts the new clip where the old one had got to, wrapped into its length', () => {
  assert.equal(legatoOffset(1.5, 4), 1.5)
  assert.equal(legatoOffset(5, 4), 1, 'a short clip against a long one wraps')
  assert.equal(legatoOffset(4, 4), 0)
  assert.equal(legatoOffset(0, 4), 0)
  assert.equal(legatoOffset(1.5, 0), 0, 'nothing to start into')
})

ok('the settings read back in a line', () => {
  assert.equal(describeLaunch({}), 'Toggle')
  assert.equal(describeLaunch({ launchMode: 'gate', legatoLaunch: true }), 'Gate, legato')
  assert.equal(describeLaunch({ launchMode: 'repeat', velocityAmount: 0.5 }), 'Repeat, velocity 50%')
  assert.deepEqual(LAUNCH_MODES, ['trigger', 'gate', 'toggle', 'repeat'])
  assert.equal(LAUNCH_MODE_LABEL.gate, 'Gate')
})

console.log('\nglobal quantization')

ok('every option has a distinct id, a label and a key', () => {
  const ids = LAUNCH_QUANTIZATIONS.map(q => q.id)
  assert.deepEqual(ids, ['none', 'beat', 'bar', '2bar', '4bar'])
  assert.equal(new Set(LAUNCH_QUANTIZATIONS.map(q => q.key)).size, 5)
  assert.ok(LAUNCH_QUANTIZATIONS.every(q => q.label.length > 0))
})

ok('the default is the bar — what the engine always hard-coded', () => {
  // ⚠️ The slot menu offered "Use Global" from the start and there was no
  // global; every such slot got this value from the engine and nothing could
  // change it.
  assert.equal(DEFAULT_LAUNCH_QUANTIZATION, 'bar')
  assert.equal(launchQuantLabel(undefined), '1 Bar')
})

ok('the short form drops the parenthesis, for a control bar with no room', () => {
  assert.equal(launchQuantLabel('none'), 'None (instant)')
  assert.equal(launchQuantShort('none'), 'None')
  assert.equal(launchQuantShort('4bar'), '4 Bars')
})

ok('and a value nobody recognises still reads as something', () => {
  assert.equal(launchQuantLabel('nonsense'), '1 Bar')
})

console.log(`\n${passed} passed`)
