// Insert Shape and Simplify Envelope (lib/envelope-shapes.ts).
//
//   node scripts/apollo-tests/envelope-shapes.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { insertShape, simplify, describeSimplify, ENVELOPE_SHAPES, POINTS_PER_CYCLE } =
  await importTs('lib/envelope-shapes.ts')
const { lfoValue } = await importTs('lib/daw-modulation.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
let n = 0
const id = () => `s${++n}`
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-4, `${m ?? ''} — got ${a}, wanted ${b}`)

console.log('\ninserting a shape')

ok('a ramp is two points and nothing else', () => {
  const out = insertShape([], 0, 8, 'rampUp', id)
  assert.equal(out.length, 2)
  assert.deepEqual(out.map(p => [p.beat, p.value]), [[0, 0], [8, 1]])
  const down = insertShape([], 0, 8, 'rampDown', id)
  assert.deepEqual(down.map(p => [p.beat, p.value]), [[0, 1], [8, 0]])
})

ok('it lands exactly on the span it was given', () => {
  const out = insertShape([], 4, 12, 'sine', id)
  near(out[0].beat, 4)
  near(out[out.length - 1].beat, 12)
})

ok('and everything OUTSIDE the span survives', () => {
  // ⚠️ Insert Shape is an edit to a stretch of the song. Clearing the lane
  // would make it useless for the commonest case, which is shaping one section.
  const before = [{ id: 'a', beat: 0, value: 0.2 }, { id: 'b', beat: 20, value: 0.9 }]
  const out = insertShape(before, 4, 12, 'sine', id)
  assert.ok(out.some(p => p.id === 'a' && p.value === 0.2))
  assert.ok(out.some(p => p.id === 'b' && p.value === 0.9))
})

ok('but points INSIDE it are replaced', () => {
  const before = [{ id: 'x', beat: 6, value: 0.5 }]
  const out = insertShape(before, 4, 12, 'rampUp', id)
  assert.ok(!out.some(p => p.id === 'x'))
})

ok('a sine is the SAME sine an LFO makes', () => {
  // ⚠️ Two answers to what a sine is shows up as a sound nobody can account for.
  const out = insertShape([], 0, 4, 'sine', id, { cycles: 1 })
  const quarter = out.find(p => Math.abs(p.beat - 1) < 1e-6)
  near(quarter.value, (lfoValue('sine', 0.25) + 1) / 2, 'the top of the sine')
})

ok('the inverse saw really is the saw upside down', () => {
  const up = insertShape([], 0, 4, 'saw', id)
  const down = insertShape([], 0, 4, 'sawInverse', id)
  for (let i = 0; i < up.length; i++) near(up[i].value + down[i].value, 1)
})

ok('a square has two points at every edge, so the edge is vertical', () => {
  // ⚠️ One point makes a ramp, and a square that ramps is a triangle.
  const out = insertShape([], 0, 4, 'square', id, { cycles: 1 })
  const mid = out.filter(p => p.beat > 1.5 && p.beat < 2.5)
  assert.equal(mid.length, 2, JSON.stringify(mid))
  assert.ok(Math.abs(mid[0].value - mid[1].value) > 0.9, 'the two sides of the edge')
  assert.ok(mid[1].beat - mid[0].beat < 0.02, 'and they are a hair apart')
})

ok('cycles repeat across the span', () => {
  const one = insertShape([], 0, 8, 'sine', id, { cycles: 1 })
  const four = insertShape([], 0, 8, 'sine', id, { cycles: 4 })
  assert.equal(one.length, POINTS_PER_CYCLE + 1)
  assert.equal(four.length, POINTS_PER_CYCLE * 4 + 1)
})

ok('low and high set how far it moves', () => {
  const out = insertShape([], 0, 4, 'triangle', id, { low: 0.4, high: 0.6 })
  const vals = out.map(p => p.value)
  assert.ok(Math.min(...vals) >= 0.4 - 1e-6 && Math.max(...vals) <= 0.6 + 1e-6, JSON.stringify([Math.min(...vals), Math.max(...vals)]))
})

ok('ADSR is one envelope across the span, not a cycle', () => {
  const out = insertShape([], 0, 16, 'adsr', id, { cycles: 4 })
  assert.equal(out.length, 5)
  near(out[0].value, 0)
  near(out[out.length - 1].value, 0)
  assert.ok(out[1].value > out[2].value, 'the peak comes before the sustain')
})

ok('an empty or backwards span changes nothing', () => {
  const before = [{ id: 'a', beat: 2, value: 0.5 }]
  assert.deepEqual(insertShape(before, 4, 4, 'sine', id), before)
  assert.deepEqual(insertShape(before, 8, 4, 'sine', id), before)
})

ok('the list comes back in time order', () => {
  const out = insertShape([{ id: 'z', beat: 30, value: 1 }, { id: 'a', beat: 0, value: 0 }], 4, 12, 'sine', id)
  assert.deepEqual(out.map(p => p.beat), [...out.map(p => p.beat)].sort((a, b) => a - b))
})

console.log('\nsimplifying')

ok('a straight line collapses to its two ends', () => {
  const line = Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, beat: i, value: i / 19 }))
  assert.equal(simplify(line, 0.02).length, 2)
})

ok('a corner is kept, because it IS the shape', () => {
  const v = [
    { id: 'a', beat: 0, value: 0 }, { id: 'b', beat: 2, value: 0.5 },
    { id: 'c', beat: 4, value: 1 }, { id: 'd', beat: 6, value: 0.5 },
    { id: 'e', beat: 8, value: 0 },
  ]
  const out = simplify(v, 0.02)
  assert.equal(out.length, 3, JSON.stringify(out.map(p => p.id)))
  assert.ok(out.some(p => p.id === 'c'), 'the peak survived')
})

ok('the ends are never moved', () => {
  // ⚠️ Moving where a shape starts or stops changes the sound rather than
  // tidying the picture.
  const noisy = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, beat: i, value: 0.5 + Math.sin(i) * 0.001 }))
  const out = simplify(noisy, 0.05)
  assert.equal(out[0].id, 'p0')
  assert.equal(out[out.length - 1].id, 'p29')
})

ok('a bigger tolerance keeps fewer points', () => {
  const wave = Array.from({ length: 64 }, (_, i) => ({ id: `p${i}`, beat: i / 8, value: (Math.sin(i / 4) + 1) / 2 }))
  const fine = simplify(wave, 0.005).length
  const coarse = simplify(wave, 0.08).length
  assert.ok(coarse < fine && fine < wave.length, `${wave.length} → ${fine} → ${coarse}`)
})

ok('two points or fewer are already simple', () => {
  const two = [{ id: 'a', beat: 0, value: 0 }, { id: 'b', beat: 4, value: 1 }]
  assert.deepEqual(simplify(two, 0.02), two)
  assert.deepEqual(simplify([], 0.02), [])
})

ok('a recorded gesture comes down to something editable', () => {
  // Sixty points that read as a line — the shape a touch recording leaves.
  const gesture = Array.from({ length: 60 }, (_, i) => ({ id: `g${i}`, beat: i / 8, value: 0.2 + (i / 59) * 0.6 }))
  const out = simplify(gesture, 0.02)
  assert.ok(out.length <= 4, `${out.length} points left`)
  assert.match(describeSimplify(60, out.length), /same shape/)
})

ok('and it says so when there is nothing to take out', () => {
  assert.match(describeSimplify(3, 3), /Nothing to simplify/)
})

console.log('\nthe menu')

ok('every shape has a label and a reason to pick it', () => {
  assert.equal(new Set(ENVELOPE_SHAPES.map(s => s.id)).size, ENVELOPE_SHAPES.length)
  assert.ok(ENVELOPE_SHAPES.every(s => s.label && s.hint.length > 15))
})

console.log(`\n${passed} passed`)
