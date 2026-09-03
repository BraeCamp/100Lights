#!/usr/bin/env node
// WHERE and HOW LONG, through the real tempo and meter maps.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-position.test.mjs
//
// The first voice layer multiplied by one tempo and one beats-per-bar. That is
// correct for a song that never changes either, and silently wrong for every
// other — which is most real songs, and exactly what Brae asked to be kept in
// mind. So the cases that matter here are the ones with a change in them: a bar
// that is three beats instead of four, a second that is shorter because the
// tempo went up, a bar number that has moved because the meter changed earlier
// in the song.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const {
  musicMaps, barStartBeat, positionToBeat, durationToBeats, describeBeat, describeDuration,
} = await importTs('lib/voice/position.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps
const eq = (label, got, want) => check(label, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`)
const approx = (label, got, want) => check(label, near(got, want), `got ${got} want ${want}`)

// ── A plain song: 120bpm, 4/4 ───────────────────────────────────────────────
const plain = musicMaps({ tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4 })

eq('bar 1 is beat 0 — bars count from one', barStartBeat(1, plain), 0)
eq('bar 2 is beat 4', barStartBeat(2, plain), 4)
eq('bar 9 is beat 32', barStartBeat(9, plain), 32)

eq('"bar 5" as a position', positionToBeat({ bar: 5 }, plain), 16)
eq('"bar 5 beat 3" — beats in a bar count from one too', positionToBeat({ bar: 5, beat: 3 }, plain), 18)
eq('"beat 3" with no bar is inside bar 1', positionToBeat({ beat: 3 }, plain), 2)
approx('"32 seconds in" at 120bpm is beat 64', positionToBeat({ seconds: 32 }, plain), 64)
eq('an exact beat passes through', positionToBeat({ beats: 17 }, plain), 17)
eq('nothing said is null, not zero', positionToBeat({}, plain), null)
eq('null position', positionToBeat(null, plain), null)

approx('"one bar" is 4 beats in 4/4', durationToBeats({ bars: 1 }, 0, plain), 4)
approx('"8 seconds" at 120bpm is 16 beats', durationToBeats({ seconds: 8 }, 0, plain), 16)
eq('a duration of zero is not "unsaid"', durationToBeats({ bars: 0 }, 0, plain), 0)
eq('nothing said is null', durationToBeats({}, 0, plain), null)

// ── 3/4: a bar is three beats, everywhere ───────────────────────────────────
const waltz = musicMaps({ tempo: 120, timeSignatureNum: 3, timeSignatureDen: 4 })
eq('bar 2 in 3/4 is beat 3', barStartBeat(2, waltz), 3)
approx('"one bar" in 3/4 is 3 beats', durationToBeats({ bars: 1 }, 0, waltz), 3)
approx('"four bars" in 3/4 is 12 beats', durationToBeats({ bars: 4 }, 0, waltz), 12)

// ── A meter change mid-song ─────────────────────────────────────────────────
// 4/4 for two bars (beats 0-7), then 3/4 from beat 8.
const mixed = musicMaps({
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  meterMarkers: [{ id: 'm1', beat: 8, num: 3, den: 4 }],
})
eq('bars before the change are 4 beats', barStartBeat(3, mixed), 8)
eq('the bar after the change is 3 beats later', barStartBeat(4, mixed), 11)
eq('and the one after that', barStartBeat(5, mixed), 14)
// Spanning the change is the case a multiplication gets wrong.
approx('two bars from the change is 6 beats, not 8', durationToBeats({ bars: 2 }, 8, mixed), 6)
approx('two bars spanning the change is 4 + 3', durationToBeats({ bars: 2 }, 4, mixed), 7)

// ── A tempo change mid-song ─────────────────────────────────────────────────
// 120bpm to beat 16, then 60bpm — seconds are worth half as many beats after.
const rit = musicMaps({
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tempoMarkers: [{ id: 't1', beat: 16, tempo: 60 }],
})
approx('8 seconds before the change is 16 beats', durationToBeats({ seconds: 8 }, 0, rit), 16)
approx('8 seconds after it is 8 beats', durationToBeats({ seconds: 8 }, 16, rit), 8)
check('the same spoken duration differs by where it starts',
  !near(durationToBeats({ seconds: 8 }, 0, rit), durationToBeats({ seconds: 8 }, 16, rit)),
  'which a single-tempo multiply cannot express')

// ── Saying it back ──────────────────────────────────────────────────────────
eq('a downbeat reads as a bar', describeBeat(16, plain), 'bar 5')
eq('off the downbeat names the beat', describeBeat(18, plain), 'bar 5 beat 3')
eq('the very start', describeBeat(0, plain), 'bar 1')
eq('read-back honours the meter change', describeBeat(11, mixed), 'bar 4')
eq('a duration reads in the unit it was said in', describeDuration({ bars: 2 }, 8), '2 bars')
eq('one bar is singular', describeDuration({ bars: 1 }, 4), '1 bar')
eq('seconds stay seconds', describeDuration({ seconds: 8 }, 16), '8s')
eq('and beats when that is all there is', describeDuration({}, 3), '3 beats')

console.log(failures ? `\n${failures} failing` : '\npositions and durations follow the song, not a single tempo')
assert.equal(failures, 0)
