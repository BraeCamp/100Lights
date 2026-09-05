// The Pitch & Time utilities (lib/pitch-time.ts) produce exact note sets:
// Invert flips highest for lowest (by degree when a scale is on), Add
// Interval copies notes an interval away and stays in key by degrees,
// Stretch scales positions and lengths from the first note, Set Length
// makes every note one length, Humanize moves starts within the amount and
// is seeded, Reverse retrogrades within a range, and transposing by degrees
// climbs the scale. The roll's buttons are driven in .claude/pitch-time-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const {
  scaleLadder, ladderIndex, transposeNotes, transposeDegrees, invertNotes, addInterval,
  stretchNotes, setLength, humanizeNotes, reverseNotes, parseDuration, durationLabel, describeInterval,
} = await importTs('lib/pitch-time.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const CMAJ = { root: 0, intervals: [0, 2, 4, 5, 7, 9, 11] }
const note = (id, pitch, startBeat, durationBeats = 1) => ({ id, pitch, startBeat, durationBeats, velocity: 100 })
// C4 E4 G4 then a D♭4 outside the key, one per beat.
const line = () => [note('a', 60, 0), note('b', 64, 1), note('c', 67, 2), note('d', 61, 3)]
const apply = (notes, patches) => notes.map(n => ({ ...n, ...(patches.find(p => p.id === n.id)?.patch ?? {}) }))
const pitches = (notes, patches) => apply(notes, patches).map(n => n.pitch)
const starts = (notes, patches) => apply(notes, patches).map(n => n.startBeat)
let ids = 0
const newId = () => `new${++ids}`

check('the scale ladder is every in-scale pitch, low to high, and a lookup snaps to the nearest rung', () => {
  const l = scaleLadder(CMAJ)
  assert.equal(l[0], 0); assert.equal(l[l.length - 1], 127)
  assert.ok(l.includes(60) && l.includes(64) && !l.includes(61))
  assert.equal(l[ladderIndex(l, 64)], 64)
  assert.equal(l[ladderIndex(l, 61)], 60, 'D♭ snaps down to C on a tie')
  assert.equal(l[ladderIndex(l, 66)], 65, 'F♯ snaps down to F')
})
check('transpose by semitones is chromatic and clamped', () => {
  assert.deepEqual(pitches(line(), transposeNotes(line(), 7)), [67, 71, 74, 68])
  assert.deepEqual(transposeNotes([note('z', 125, 0)], 7)[0].patch.pitch, 127)
  assert.deepEqual(transposeNotes(line(), 0), [])
})
check('transpose by degrees climbs the scale — E up one is F, and an out-of-key note is pulled in', () => {
  assert.deepEqual(pitches(line(), transposeDegrees(line(), 1, CMAJ)), [62, 65, 69, 62])
  assert.deepEqual(pitches(line(), transposeDegrees(line(), -2, CMAJ)), [57, 60, 64, 57])
  assert.deepEqual(pitches(line(), transposeDegrees(line(), 7, CMAJ)), [72, 76, 79, 72], 'seven degrees is an octave')
})
check('Invert flips the highest for the lowest, chromatically without a scale', () => {
  // low 60, high 67: 60→67, 64→63, 67→60, 61→66
  assert.deepEqual(pitches(line(), invertNotes(line(), null)), [67, 63, 60, 66])
  assert.deepEqual(invertNotes([note('a', 60, 0)], null), [], 'one note has nothing to flip around')
})
check('Invert by degrees when a scale is on keeps the line in key', () => {
  // rungs: C4 E4 G4 and D♭→C4; low C4, high G4 → C↔G, E→E, D♭(C)→G
  assert.deepEqual(pitches(line(), invertNotes(line(), CMAJ)), [67, 64, 60, 67])
})
check('Add Interval copies each note the interval away and leaves the originals', () => {
  const added = addInterval(line(), 7, null, newId)
  assert.deepEqual(added.map(n => n.pitch), [67, 71, 74, 68])
  assert.deepEqual(added.map(n => n.startBeat), [0, 1, 2, 3])
  assert.ok(added.every(n => n.id.startsWith('new')))
  assert.equal(addInterval([note('a', 124, 0)], 7, null, newId).length, 0, 'off the top of the keyboard is skipped')
})
check('Add Interval by degrees builds thirds that stay in key', () => {
  const added = addInterval([note('a', 60, 0), note('b', 62, 1), note('c', 64, 2)], 2, CMAJ, newId)
  assert.deepEqual(added.map(n => n.pitch), [64, 65, 67], 'C→E, D→F, E→G')
})
check('Add Interval skips a copy that would sit on a note already there', () => {
  const added = addInterval([note('a', 60, 0), note('b', 67, 0)], 7, null, newId)
  assert.deepEqual(added.map(n => n.pitch), [74], 'C→G is already there; G→D is new')
})
check('Stretch ×2 doubles positions and lengths from the first note; ÷2 halves them', () => {
  const l = line().map(n => ({ ...n, startBeat: n.startBeat + 1 }))   // phrase starts at beat 1
  const x2 = stretchNotes(l, 2)
  assert.deepEqual(starts(l, x2), [1, 3, 5, 7])
  assert.ok(apply(l, x2).every(n => n.durationBeats === 2))
  assert.deepEqual(starts(l, stretchNotes(l, 0.5)), [1, 1.5, 2, 2.5])
  assert.deepEqual(stretchNotes(l, 1), [])
})
check('Set Length makes every note the chosen length and skips the ones already there', () => {
  const p = setLength(line(), 0.5)
  assert.equal(p.length, 4)
  assert.ok(apply(line(), p).every(n => n.durationBeats === 0.5))
  assert.equal(setLength(line(), 1).length, 0)
})
check('Humanize moves starts within the amount, both ways, and is seeded', () => {
  const l = Array.from({ length: 32 }, (_, i) => note(`h${i}`, 60, i * 0.25 + 1, 0.25))
  const p = humanizeNotes(l, 50, 0.25, 'seed')
  const d = apply(l, p).map((n, i) => n.startBeat - l[i].startBeat)
  assert.ok(d.every(x => Math.abs(x) <= 0.0625 + 1e-9), `within a quarter of the grid: ${Math.max(...d.map(Math.abs))}`)
  assert.ok(d.some(x => x > 0.01) && d.some(x => x < -0.01), 'some early, some late')
  assert.deepEqual(humanizeNotes(l, 50, 0.25, 'seed'), p, 'the same seed gives the same feel')
  assert.notDeepEqual(humanizeNotes(l, 50, 0.25, 'other'), p, 'another seed gives another')
  assert.equal(humanizeNotes(l, 0, 0.25, 'seed').length, 0)
  assert.ok(apply([note('z', 60, 0, 0.25)], humanizeNotes([note('z', 60, 0, 0.25)], 100, 1, 'x'))[0].startBeat >= 0, 'never before the clip start')
})
check('Reverse retrogrades within the notes\' extent, or within the clip when asked', () => {
  const l = [note('a', 60, 1, 1), note('b', 64, 2, 0.5), note('c', 67, 3, 1)]   // extent 1..4
  assert.deepEqual(starts(l, reverseNotes(l)), [3, 2.5, 1])
  assert.deepEqual(starts(l, reverseNotes(l, { start: 0, end: 8 })), [6, 5.5, 4])
})
check('durations parse the way people say them', () => {
  assert.equal(parseDuration('eighth notes'), 0.5)
  assert.equal(parseDuration('an eighth note'), 0.5)
  assert.equal(parseDuration('1/16'), 0.25)
  assert.equal(parseDuration('sixteenth'), 0.25)
  assert.equal(parseDuration('a quarter note'), 1)
  assert.equal(parseDuration('two beats'), 2)
  assert.equal(parseDuration('1.5 beats'), 1.5)
  assert.equal(parseDuration('a bar'), 4)
  assert.equal(parseDuration('purple'), null)
  assert.equal(durationLabel(0.5), '1/8'); assert.equal(durationLabel(1.5), '1.5 beats')
  assert.equal(describeInterval(7, false), '+7 st'); assert.equal(describeInterval(-2, true), '-2 degrees'); assert.equal(describeInterval(1, true), '+1 degree')
})

console.log(failures ? `\n${failures} failing` : '\npitch and time are exact')
process.exit(failures ? 1 : 0)
