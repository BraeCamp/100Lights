// Chance, deviation and probability groups (lib/note-chance.ts): a roll is
// seeded and repeatable, chance 1 always fires and 0 never, a chance of a
// half fires about half the time over many passes, deviation stays in range,
// Play One picks exactly one member per pass weighted by chance, and the
// lane helpers convert and randomise in their own units. The engine's roll
// is heard in .claude/chance-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { rollNote, pickForGroup, groupWinners, winnerFor, laneValue, lanePatch, randomizeLane, rampLane, chanceOf } = await importTs('lib/note-chance.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const note = (id, extra = {}) => ({ id, pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100, ...extra })

check('no chance set means always; chance 0 means never', () => {
  assert.equal(rollNote(note('a'), 'k').fires, true)
  assert.equal(rollNote(note('a', { chance: 0 }), 'k').fires, false)
  assert.equal(chanceOf({}), 1); assert.equal(chanceOf({ chance: 2 }), 1)
})
check('a roll is seeded: the same pass gives the same answer, other passes differ', () => {
  const n = note('a', { chance: 0.5 })
  const first = rollNote(n, 'clip:0:a').fires
  for (let i = 0; i < 5; i++) assert.equal(rollNote(n, 'clip:0:a').fires, first)
  const answers = new Set(Array.from({ length: 40 }, (_, k) => rollNote(n, `clip:${k}:a`).fires))
  assert.equal(answers.size, 2, 'both outcomes appear over forty passes')
})
check('a chance of a half fires about half the time over many passes', () => {
  const n = note('a', { chance: 0.5 })
  let fired = 0
  for (let k = 0; k < 2000; k++) if (rollNote(n, `c:${k}:a`).fires) fired++
  assert.ok(fired > 900 && fired < 1100, `${fired} of 2000`)
})
check('deviation moves the velocity within ± its range, never past 1..127', () => {
  const n = note('a', { velocity: 100, deviation: 20 })
  const vs = Array.from({ length: 200 }, (_, k) => rollNote(n, `d:${k}`).note.velocity)
  assert.ok(vs.every(v => v >= 80 && v <= 120), `range ${Math.min(...vs)}–${Math.max(...vs)}`)
  assert.ok(new Set(vs).size > 10, 'it varies')
  const loud = note('b', { velocity: 125, deviation: 40 })
  assert.ok(Array.from({ length: 100 }, (_, k) => rollNote(loud, `e:${k}`).note.velocity).every(v => v <= 127))
})
check('Play One picks exactly one member per pass, weighted by chance', () => {
  const clip = { notes: [note('a', { chanceGroup: 'g', chance: 0.75 }), note('b', { chanceGroup: 'g', chance: 0.25 }), note('c')], chanceGroups: { g: 'one' } }
  const counts = { a: 0, b: 0 }
  for (let k = 0; k < 1000; k++) {
    const winners = groupWinners(clip, `p:${k}`)
    const w = winners.get('g')
    assert.ok(w === 'a' || w === 'b')
    counts[w]++
    const fa = rollNote(clip.notes[0], `p:${k}:a`, winnerFor(clip.notes[0], winners)).fires
    const fb = rollNote(clip.notes[1], `p:${k}:b`, winnerFor(clip.notes[1], winners)).fires
    assert.equal(Number(fa) + Number(fb), 1, 'exactly one of the group plays')
    assert.equal(winnerFor(clip.notes[2], winners), undefined, 'an ungrouped note is not in the pick')
  }
  assert.ok(counts.a > 650 && counts.a < 850, `a won ${counts.a} of 1000`)
})
check('Play All groups leave every member to its own dice', () => {
  const clip = { notes: [note('a', { chanceGroup: 'g' }), note('b', { chanceGroup: 'g' })], chanceGroups: { g: 'all' } }
  assert.equal(groupWinners(clip, 'p').size, 0)
})
check('a group whose members all have chance 0 plays nobody', () => {
  assert.equal(pickForGroup([{ id: 'a', chance: 0 }, { id: 'b', chance: 0 }], 's'), null)
  assert.equal(pickForGroup([], 's'), null)
})
check('lane values and patches speak the lane\'s units', () => {
  const n = note('a', { velocity: 90, deviation: 10, chance: 0.4 })
  assert.equal(laneValue(n, 'velocity'), 90); assert.equal(laneValue(n, 'deviation'), 10); assert.equal(laneValue(n, 'chance'), 40)
  assert.deepEqual(lanePatch('velocity', 200), { velocity: 127 })
  assert.deepEqual(lanePatch('velocity', 0), { velocity: 1 })
  assert.deepEqual(lanePatch('deviation', 0), { deviation: undefined })
  assert.deepEqual(lanePatch('chance', 100), { chance: undefined })
  assert.deepEqual(lanePatch('chance', 33), { chance: 0.33 })
})
check('Randomize moves each note by up to the amount, repeatably; Ramp draws a line', () => {
  const notes = Array.from({ length: 8 }, (_, i) => note(`n${i}`, { startBeat: i, velocity: 100 }))
  const r1 = randomizeLane(notes, 'velocity', 20, 'seed')
  const r2 = randomizeLane(notes, 'velocity', 20, 'seed')
  assert.deepEqual(r1, r2)
  assert.ok(r1.every(x => x.patch.velocity >= 75 && x.patch.velocity <= 125))
  const ramp = rampLane(notes, 'chance', 100, 20)
  assert.equal(ramp[0].patch.chance, undefined)         // 100 % = always
  assert.ok(Math.abs(ramp[7].patch.chance - 0.2) < 1e-9)
  assert.ok(ramp.map(x => x.patch.chance ?? 1).every((v, i, a) => i === 0 || v <= a[i - 1]))
})

console.log(failures ? `\n${failures} failing` : '\nthe dice are loaded the same way every time')
process.exit(failures ? 1 : 0)
