#!/usr/bin/env node
// Turning what someone SAID into things in their project.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-resolve.test.mjs
//
// This is where a voice system is confidently wrong. Every case here is a real
// way a transcriber writes something a person actually said: "bass two" for
// "Bass 2", "the bass" for "Bass", "80%" for 0.8. Getting one wrong edits the
// wrong track, and the user hears it rather than reading an error.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const {
  foldName, spokenNumber, spokenFraction, findByName,
  secondsToBeats, beatsToSeconds, barsToBeats, durationToBeats,
} = await importTs('lib/voice/resolve.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)

// ── Speech is not typing ────────────────────────────────────────────────────
eq('digits and number words fold together', foldName('Bass two'), foldName('Bass 2'))
eq('case and punctuation fold away', foldName("  The 'Bass', 2! "), 'bass 2')
eq('"the" is dropped', foldName('the kick'), 'kick')

eq('a spoken number', spokenNumber('three'), 3)
eq('a digit', spokenNumber('3'), 3)
eq('a digit inside words', spokenNumber('3 more times'), 3)
eq('"a couple"', spokenNumber('a couple'), 2)
eq('"twice"', spokenNumber('twice'), 2)
eq('a number that is already one', spokenNumber(7), 7)
eq('not a number at all', spokenNumber('bananas'), null)
eq('nothing said', spokenNumber(undefined), null)

// Percent and 0..1 have to mean the same thing — the model may send either.
eq('80% is 0.8', spokenFraction('80%'), 0.8)
eq('bare 80 is 0.8', spokenFraction('80'), 0.8)
eq('0.8 stays 0.8', spokenFraction(0.8), 0.8)
eq('80 as a number is 0.8', spokenFraction(80), 0.8)
eq('0% is 0, not null', spokenFraction('0%'), 0)

// ── Finding the thing they meant ────────────────────────────────────────────
const tracks = [
  { id: 't1', name: 'Kick' },
  { id: 't2', name: 'Bass 1' },
  { id: 't3', name: 'Bass 2' },
  { id: 't4', name: 'Lead Synth' },
]

eq('exact name', findByName('Bass 2', tracks)?.item.id, 't3')
eq('spoken as words', findByName('bass two', tracks)?.item.id, 't3')
eq('with a "the"', findByName('the bass 2', tracks)?.item.id, 't3')
eq('a prefix', findByName('lead', tracks)?.item.id, 't4')
eq('words in any order', findByName('synth lead', tracks)?.item.id, 't4')
check('an exact match is fully confident', findByName('Kick', tracks)?.score === 1)
check('and says how it matched', /exact/.test(findByName('Kick', tracks)?.how ?? ''))

// The important negative: "bass" alone matches BOTH basses, so it must not
// silently pick one. Editing the wrong track without saying so is the worst
// outcome this file can produce.
eq('an ambiguous name resolves to nothing rather than a guess',
  findByName('bass', tracks), null)
eq('a name that is not there', findByName('trombone', tracks), null)
eq('empty input', findByName('', tracks), null)
eq('nothing to search', findByName('kick', []), null)

// Two tracks really called the same thing: pick one, but flag it.
const dupes = [{ id: 'a', name: 'Bass' }, { id: 'b', name: 'Bass' }]
const dup = findByName('bass', dupes)
check('duplicate names still resolve, with low confidence', dup != null && dup.score < 0.7,
  `score ${dup?.score}`)
check('and say so', /share that name/.test(dup?.how ?? ''), dup?.how)

// Tracks with no name at all must not crash the matcher.
eq('unnamed items are skipped', findByName('kick', [{ id: 'x' }, { id: 't1', name: 'Kick' }])?.item.id, 't1')

// ── Musician's units ────────────────────────────────────────────────────────
const t = { tempo: 120, beatsPerBar: 4 }
eq('8 seconds at 120bpm is 16 beats', secondsToBeats(8, t), 16)
eq('and back again', beatsToSeconds(16, t), 8)
eq('one bar is 4 beats in 4/4', barsToBeats(1, t), 4)
eq('one bar is 3 beats in 3/4', barsToBeats(1, { tempo: 120, beatsPerBar: 3 }), 3)

eq('a duration in seconds', durationToBeats({ seconds: 8 }, t), 16)
eq('a duration in bars', durationToBeats({ bars: 2 }, t), 8)
eq('a duration already in beats', durationToBeats({ beats: 5 }, t), 5)
eq('beats win over seconds when both are given', durationToBeats({ beats: 5, seconds: 99 }, t), 5)
eq('no duration given', durationToBeats({}, t), null)
eq('null duration', durationToBeats(null, t), null)
// Zero is a real answer and must not read as "they did not say".
eq('zero is a duration', durationToBeats({ bars: 0 }, t), 0)

console.log(failures ? `\n${failures} failing` : '\nspoken names and units resolve, and refuse to guess')
assert.equal(failures, 0)
