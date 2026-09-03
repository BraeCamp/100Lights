#!/usr/bin/env node
// Hearing the names that are actually in the song.
//
//   node --experimental-strip-types scripts/apollo-tests/hear-better.test.mjs
//
// Brae: "Do we have good voice recognition right now?"
//
// The browser's recogniser is general-purpose and knows nothing about the open
// project, so it fails hardest on the words that decide where a command lands:
// the track names. "Bass 2" comes back as "base two". But a studio always knows
// what its tracks are called, which turns the hard problem (transcribe English)
// into an easy one (match against twelve known names).
//
// The risk is over-correction. A wrong repair is WORSE than a wrong transcript:
// the model can often recover from an odd sentence, but not from confidently
// renaming the wrong track. So most of what is asserted here is restraint.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { pickAlternative, repairNames, hearBetter, scoreAgainstNames } =
  await importTs('lib/voice/hear-better.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const TRACKS = [
  { id: 't1', name: 'Bass 2' },
  { id: 't2', name: 'Stab' },
  { id: 't3', name: 'Drums' },
  { id: 't4', name: 'Pad' },
]

// ── Choosing between what the recogniser offered ────────────────────────────
check('the alternative that names a real track wins',
  pickAlternative(['loop base two three more times', 'loop bass 2 three more times'],
    TRACKS.map(t => t.name)) === 'loop bass 2 three more times')

check('with nothing to go on, the recogniser\'s own first guess stands',
  pickAlternative(['make it louder', 'make it powder'], TRACKS.map(t => t.name)) === 'make it louder')

check('a longer name outscores a shorter one it contains',
  scoreAgainstNames('bass 2', ['Bass', 'Bass 2']) > scoreAgainstNames('bass', ['Bass', 'Bass 2']))

// ── Repairing the winning sentence ──────────────────────────────────────────
check('number words become the digits a track name uses',
  repairNames('loop base two three more times', TRACKS) === 'loop Bass 2 three more times',
  repairNames('loop base two three more times', TRACKS))

check('a name already correct is left exactly alone',
  repairNames('loop Bass 2 twice', TRACKS) === 'loop Bass 2 twice',
  repairNames('loop Bass 2 twice', TRACKS))

// foldName drops "the" ("the bass" IS "bass"), so a run containing it folds to
// the bare name and the article is consumed along with it. "mute Stab" is a
// correct, unambiguous sentence — this asserts the name landed, not that every
// filler word survived.
check('a single-word name is repaired too',
  repairNames('mute the stab', TRACKS) === 'mute Stab',
  repairNames('mute the stab', TRACKS))

// ── Restraint, which matters more than the repairs ──────────────────────────
check('a bare number is NOT treated as a track name',
  repairNames('move everything over by 2 bars', TRACKS) === 'move everything over by 2 bars',
  repairNames('move everything over by 2 bars', TRACKS))

check('an ambiguous word is left for the assistant to ask about',
  repairNames('turn up the bass', [{ id: 'a', name: 'Bass 1' }, { id: 'b', name: 'Bass 2' }])
    === 'turn up the bass',
  repairNames('turn up the bass', [{ id: 'a', name: 'Bass 1' }, { id: 'b', name: 'Bass 2' }]))

check('words that match nothing are untouched',
  repairNames('add an ascending low pass filter', TRACKS) === 'add an ascending low pass filter',
  repairNames('add an ascending low pass filter', TRACKS))

check('a project with no named tracks changes nothing',
  repairNames('loop base two', [{ id: 'x' }]) === 'loop base two')

// ── Both halves together ────────────────────────────────────────────────────
check('the two steps compose',
  hearBetter(['loop base two three more times', 'loop bass to three more times'], TRACKS)
    === 'loop Bass 2 three more times',
  hearBetter(['loop base two three more times', 'loop bass to three more times'], TRACKS))

check('an empty result is not a crash', hearBetter([], TRACKS) === '')

console.log(failures
  ? `\n${failures} failing`
  : '\nthe recogniser is corrected toward the song, and never past it')
assert.equal(failures, 0)
