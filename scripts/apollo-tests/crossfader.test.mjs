// The crossfader's arithmetic (lib/crossfader.ts): equal-power between A and
// B, a track on neither side ignores it, and the position reads back the way
// a person says it. The engine's gain is checked by ear in .claude/arr-mixer-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { crossfadeGain, describeCrossfader } = await importTs('lib/crossfader.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)

check('A is full at 0 and silent at 1; B the other way round', () => {
  near(crossfadeGain('A', 0), 1); near(crossfadeGain('A', 1), 0)
  near(crossfadeGain('B', 0), 0); near(crossfadeGain('B', 1), 1)
})
check('equal power at the centre: both sides at −3 dB, summing to one', () => {
  const a = crossfadeGain('A', 0.5), b = crossfadeGain('B', 0.5)
  near(a, Math.SQRT1_2, 1e-9); near(b, Math.SQRT1_2, 1e-9)
  near(a * a + b * b, 1, 1e-9)
})
check('a track on neither side ignores the fader', () => {
  near(crossfadeGain('none', 0), 1); near(crossfadeGain(undefined, 1), 1)
})
check('a bad position reads as the centre; out of range clamps', () => {
  near(crossfadeGain('A', NaN), Math.SQRT1_2, 1e-9)
  near(crossfadeGain('B', 7), 1)
})
check('the position, said back', () => {
  assert.equal(describeCrossfader(0.5), 'centre')
  assert.equal(describeCrossfader(0), 'A')
  assert.equal(describeCrossfader(1), 'B')
  assert.equal(describeCrossfader(0.75), '50% B')
  assert.equal(describeCrossfader(0.3), '40% A')
})

console.log(failures ? `\n${failures} failing` : '\nboth sides add up')
process.exit(failures ? 1 : 0)
