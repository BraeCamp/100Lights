// Delay compensation's arithmetic (lib/latency.ts): the slowest track sets
// the time, everyone else is delayed by the difference, off means zero, and
// the read-back is in milliseconds. The engine's DelayNodes are driven for
// real in .claude/latency-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { compensationDelays, describeLatency } = await importTs('lib/latency.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}

check('the slowest track gets no delay; the others make up the difference', () => {
  const d = compensationDelays(new Map([['a', 2400], ['b', 0], ['c', 600]]), true)
  assert.equal(d.get('a'), 0)
  assert.equal(d.get('b'), 2400)
  assert.equal(d.get('c'), 1800)
})
check('no latency anywhere means no delay anywhere', () => {
  const d = compensationDelays(new Map([['a', 0], ['b', 0]]), true)
  assert.deepEqual([...d.values()], [0, 0])
})
check('off is zero for every track, whatever they report', () => {
  const d = compensationDelays(new Map([['a', 2400], ['b', 0]]), false)
  assert.deepEqual([...d.values()], [0, 0])
})
check('a bad report counts as none', () => {
  const d = compensationDelays(new Map([['a', NaN], ['b', -5], ['c', 100]]), true)
  assert.equal(d.get('a'), 100); assert.equal(d.get('b'), 100); assert.equal(d.get('c'), 0)
})
check('latency reads in milliseconds', () => {
  assert.equal(describeLatency(0, 48000), '0 ms')
  assert.equal(describeLatency(2400, 48000), '50 ms')
  assert.equal(describeLatency(200, 48000), '4.2 ms')
  assert.equal(describeLatency(4096, 44100), '93 ms')
})

console.log(failures ? `\n${failures} failing` : '\nevery track arrives together')
process.exit(failures ? 1 : 0)
