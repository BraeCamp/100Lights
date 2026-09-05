// The arithmetic behind a knob: position ↔ value through a taper, keyboard
// nudges, the read-back, and what a typed entry means. lib/knob-math.ts is
// pure so this needs no browser; the real-path check (.claude/knob-check.mjs)
// drives the mounted knob with a keyboard.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { knobToNorm, knobFromNorm, nudgeKnob, formatKnobValue, parseKnobEntry, isLogSpec } = await importTs('lib/knob-math.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)

const CUTOFF = { label: 'Cutoff', min: 200, max: 18000, unit: 'Hz', curve: 'log' }
const GAIN = { label: 'Low', min: -12, max: 12, unit: 'dB' }
const PAN = { label: 'Pan', min: -1, max: 1 }
const MIX = { label: 'Wet', min: 0, max: 1, unit: '%' }
const MS = { label: 'Delay', min: 0, max: 500, unit: 'ms' }

check('a linear range maps its ends and its middle', () => {
  near(knobToNorm(-12, GAIN), 0); near(knobToNorm(12, GAIN), 1); near(knobToNorm(0, GAIN), 0.5)
  near(knobFromNorm(0.5, GAIN), 0)
})
check('a log range puts the geometric middle in the middle of the arc', () => {
  assert.ok(isLogSpec(CUTOFF))
  near(knobToNorm(Math.sqrt(200 * 18000), CUTOFF), 0.5, 1e-9)
  near(knobFromNorm(0.5, CUTOFF), Math.sqrt(200 * 18000), 1e-6)
})
check('a log knob steps by ratio, not by difference', () => {
  const up = nudgeKnob(1000, CUTOFF, 1, 'coarse')
  const up2 = nudgeKnob(up, CUTOFF, 1, 'coarse')
  near(up2 / up, up / 1000, 1e-9)
})
check('fine is five times smaller than a step, coarse ten times bigger', () => {
  const step = nudgeKnob(0, GAIN, 1, 'step')
  near(nudgeKnob(0, GAIN, 1, 'fine') * 5, step, 1e-9)
  near(nudgeKnob(0, GAIN, 1, 'coarse'), step * 10, 1e-9)
})
check('a nudge never leaves the range', () => {
  near(nudgeKnob(12, GAIN, 1), 12); near(nudgeKnob(-12, GAIN, -1), -12)
  near(nudgeKnob(18000, CUTOFF, 1), 18000)
})
check('a log range that is not positive falls back to linear', () => {
  const bad = { min: -10, max: 10, curve: 'log' }
  assert.equal(isLogSpec(bad), false)
  near(knobToNorm(0, bad), 0.5)
})

check('the read-back carries the unit', () => {
  assert.equal(formatKnobValue(-6, GAIN), '-6.0 dB')
  assert.equal(formatKnobValue(800, CUTOFF), '800 Hz')
  assert.equal(formatKnobValue(12000, CUTOFF), '12.0 kHz')
  assert.equal(formatKnobValue(1200, CUTOFF), '1.20 kHz')
  assert.equal(formatKnobValue(0.5, MIX), '50%')
  assert.equal(formatKnobValue(0.25, PAN), '0.25')
})

check('typed numbers land in the parameter\'s unit', () => {
  assert.equal(parseKnobEntry('800', CUTOFF), 800)
  assert.equal(parseKnobEntry('800 Hz', CUTOFF), 800)
  assert.equal(parseKnobEntry('1.2k', CUTOFF), 1200)
  assert.equal(parseKnobEntry('1.2 kHz', CUTOFF), 1200)
  assert.equal(parseKnobEntry('-6dB', GAIN), -6)
  assert.equal(parseKnobEntry('+3', GAIN), 3)
  assert.equal(parseKnobEntry('20ms', MS), 20)
  assert.equal(parseKnobEntry('0.5s', MS), 500)
})
check('a percent knob takes "80", "80%" and "0.8" as the same thing', () => {
  near(parseKnobEntry('80', MIX), 0.8); near(parseKnobEntry('80%', MIX), 0.8); near(parseKnobEntry('0.8', MIX), 0.8)
  near(parseKnobEntry('100', MIX), 1)
})
check('a pan knob takes Live\'s L30 / R30 / C', () => {
  near(parseKnobEntry('L30', PAN), -0.3); near(parseKnobEntry('r 50', PAN), 0.5); near(parseKnobEntry('C', PAN), 0)
})
check('out-of-range clamps rather than fails; nonsense is null', () => {
  assert.equal(parseKnobEntry('30000', CUTOFF), 18000)
  assert.equal(parseKnobEntry('-40', GAIN), -12)
  assert.equal(parseKnobEntry('-inf', GAIN), -12)
  assert.equal(parseKnobEntry('max', MIX), 1)
  assert.equal(parseKnobEntry('loud', GAIN), null)
  assert.equal(parseKnobEntry('', GAIN), null)
  assert.equal(parseKnobEntry('1..2', GAIN), null)
})

console.log(failures ? `\n${failures} failing` : '\nevery knob sum adds up')
process.exit(failures ? 1 : 0)
