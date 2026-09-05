// The modulation bus's arithmetic (lib/daw-modulation.ts): synced and Hz
// rates, the wave shapes, routes swinging a parameter around its base (by
// ratio on a log range), evaluation with a lane's value as the base, and the
// spoken rates. The engine's tick is driven for real in .claude/mod-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { modCycles, modPhase, syncBeats, lfoValue, applyRoute, evaluateModulators, parseModRate, describeModRate } =
  await importTs('lib/daw-modulation.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)

check('a synced rate counts in beats: 1/4 is one beat, 1 is a bar, 1/8 half a beat', () => {
  assert.equal(syncBeats('1/4'), 1)
  assert.equal(syncBeats('1'), 4)
  assert.equal(syncBeats('1/8'), 0.5)
  assert.equal(syncBeats('2'), 8)
  assert.equal(syncBeats('junk'), 1)
})
check('phase follows the beat for a synced LFO and the clock for a Hz one', () => {
  const synced = { id: 'm', trackId: 't', name: 'LFO', shape: 'sine', rate: { kind: 'sync', division: '1/4' }, routes: [] }
  near(modPhase(synced, 0.25, 99), 0.25)
  near(modPhase(synced, 1.5, 99), 0.5)
  const hz = { ...synced, rate: { kind: 'hz', hz: 2 } }
  near(modPhase(hz, 99, 0.25), 0.5)
  near(modCycles(hz, 99, 1.75), 3.5)
  near(modPhase({ ...synced, phase: 0.5 }, 0.25, 0), 0.75)
})
check('the shapes are −1..1 and start where they should', () => {
  near(lfoValue('sine', 0), 0); near(lfoValue('sine', 0.25), 1); near(lfoValue('sine', 0.75), -1)
  near(lfoValue('triangle', 0), 0); near(lfoValue('triangle', 0.25), 1); near(lfoValue('triangle', 0.5), 0); near(lfoValue('triangle', 0.75), -1)
  near(lfoValue('saw', 0), -1); near(lfoValue('saw', 0.5), 0)
  assert.equal(lfoValue('square', 0.1), 1); assert.equal(lfoValue('square', 0.6), -1)
  const r1 = lfoValue('random', 3.2), r2 = lfoValue('random', 3.9), r3 = lfoValue('random', 4.1)
  assert.equal(r1, r2, 'sample-and-hold holds for the cycle')
  assert.notEqual(r1, r3, 'and changes on the next')
  assert.ok(r1 >= -1 && r1 <= 1)
  assert.equal(lfoValue('random', 3.2), r1, 'and is deterministic')
})
check('a route swings a linear parameter around its base, clamped to the range', () => {
  const wet = { min: 0, max: 1 }
  near(applyRoute(0.5, 1, { id: 'r', parameter: 'x', amount: 0.5 }, wet), 0.75)
  near(applyRoute(0.5, -1, { id: 'r', parameter: 'x', amount: 0.5 }, wet), 0.25)
  near(applyRoute(0.9, 1, { id: 'r', parameter: 'x', amount: 0.5 }, wet), 1)
  // Unipolar: 0..amount above the base — a tremolo with amount −1 dips to silence and never above the fader.
  near(applyRoute(0.8, 1, { id: 'r', parameter: 'volume', amount: -1, unipolar: true }, wet), 0)
  near(applyRoute(0.8, -1, { id: 'r', parameter: 'volume', amount: -1, unipolar: true }, wet), 0.8)
})
check('a log range swings by ratio, so a cutoff wobble is even on both sides', () => {
  const hz = { min: 200, max: 18000, curve: 'log' }
  const base = Math.sqrt(200 * 18000)
  const up = applyRoute(base, 1, { id: 'r', parameter: 'f', amount: 0.25 }, hz)
  const down = applyRoute(base, -1, { id: 'r', parameter: 'f', amount: 0.25 }, hz)
  near(up / base, base / down, 1e-6)
  near(applyRoute(base, 1, { id: 'r', parameter: 'f', amount: 1 }, hz), 18000, 1e-6)
})
check('evaluation reads the base from the lane when one is driving the parameter', () => {
  const mod = { id: 'm', trackId: 't', name: 'LFO', shape: 'square', rate: { kind: 'sync', division: '1/4' }, routes: [{ id: 'r', parameter: 'volume', amount: 0.2 }] }
  const out = evaluateModulators([mod], { beat: 0.1, seconds: 0.05 }, (_, p) => (p === 'volume' ? 0.5 : null), () => ({ min: 0, max: 1 }))
  assert.equal(out.length, 1)
  // amount 0.2 covers a fifth of the range: ±0.1 around the base.
  near(out[0].base, 0.5); near(out[0].value, 0.6); near(out[0].lfo, 1)
  const off = evaluateModulators([{ ...mod, enabled: false }], { beat: 0.1, seconds: 0 }, () => 0.5, () => ({ min: 0, max: 1 }))
  assert.equal(off.length, 0)
  const unranged = evaluateModulators([mod], { beat: 0.1, seconds: 0 }, () => 0.5, () => null)
  assert.equal(unranged.length, 0, 'a parameter nobody can range is skipped')
  const depth = evaluateModulators([{ ...mod, depth: 0.5 }], { beat: 0.1, seconds: 0 }, () => 0.5, () => ({ min: 0, max: 1 }))
  near(depth[0].value, 0.55)
})
check('rates the way people say them', () => {
  assert.deepEqual(parseModRate('1/8'), { kind: 'sync', division: '1/8' })
  assert.deepEqual(parseModRate('an eighth'), { kind: 'sync', division: '1/8' })
  assert.deepEqual(parseModRate('eighths'), { kind: 'sync', division: '1/8' })
  assert.deepEqual(parseModRate('every beat'), { kind: 'sync', division: '1/4' })
  assert.deepEqual(parseModRate('once a bar'), null)
  assert.deepEqual(parseModRate('bar'), { kind: 'sync', division: '1' })
  assert.deepEqual(parseModRate('2 Hz'), { kind: 'hz', hz: 2 })
  assert.deepEqual(parseModRate('0.5hz'), { kind: 'hz', hz: 0.5 })
  assert.deepEqual(parseModRate('slow'), { kind: 'sync', division: '2' })
  assert.equal(parseModRate('sideways'), null)
  assert.equal(describeModRate({ kind: 'sync', division: '1/8' }), '1/8 notes')
  assert.equal(describeModRate({ kind: 'sync', division: '1' }), 'once a bar')
  assert.equal(describeModRate({ kind: 'hz', hz: 4 }), '4 Hz')
})

console.log(failures ? `\n${failures} failing` : '\nthe bus adds up')
process.exit(failures ? 1 : 0)
