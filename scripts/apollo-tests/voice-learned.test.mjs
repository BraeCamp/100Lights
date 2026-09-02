#!/usr/bin/env node
// What the assistant worked out once, the program keeps — and what it refuses.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-learned.test.mjs
//
// Brae: "how else can we combine the program with the AI to make idle and
// simple commands cheaper for voice control".
//
// A cache that REPLAYS COMMANDS is only worth having if its refusals are right,
// so most of this file is about what must never be learned. The hits are the
// easy part; a wrong entry acts on somebody's song for free, forever, which is
// worse than paying for the round trip it saved.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { normalise, recallCommand, rememberCommand, learnedStats, forgetLearned } =
  await importTs('lib/voice/learned.ts')

// ── the same sentence twice is rarely the same string ──────────────────────
{
  check('fillers and punctuation do not make it a different command',
    normalise('Okay, mute the pad.') === normalise('mute the pad'),
    `${normalise('Okay, mute the pad.')} / ${normalise('mute the pad')}`)
  check('and politeness does not either',
    normalise('could you mute the pad please') === normalise('mute the pad'))
}

// ── the round trip ─────────────────────────────────────────────────────────
{
  forgetLearned()
  const calls = [{ name: 'set_track', input: { target: 'pad', mute: true } }]
  check('a clean answer is learned', rememberCommand('mute the pad', calls) === 'stored')

  const got = recallCommand('Okay, mute the pad!')
  check('and comes back for the same sentence said differently',
    got?.length === 1 && got[0].name === 'set_track' && got[0].input.target === 'pad',
    JSON.stringify(got))

  // The caller hands these to a planner that may keep them.
  got[0].input.target = 'bass'
  check('what comes back is a copy, not the stored entry',
    recallCommand('mute the pad')?.[0].input.target === 'pad')
}

// ── what must never be learned ─────────────────────────────────────────────
{
  forgetLearned()

  // Resolved against the selection or the playhead when it was said.
  check('a command pointing at "that" is not learned',
    rememberCommand('do that to the bass as well',
      [{ name: 'set_track', input: { target: 'bass' } }]) === 'depends-on-context')
  check('nor one pointing at "here"',
    rememberCommand('put a marker here', [{ name: 'add_marker', input: { name: 'x' } }]) === 'depends-on-context')

  // The confirmation that guards these is keyed to a flag the model never sends.
  check('a destructive command is not learned',
    rememberCommand('bin the backing vocal',
      [{ name: 'delete_track', input: { target: 'backing vocal' } }]) === 'destructive')

  // ⚠️ The stale one. "at the end" was an absolute beat computed from the song
  // as it stood; tomorrow that number is somewhere in the middle.
  check('a number nobody said is not learned',
    rememberCommand('add four bars at the end',
      [{ name: 'add_clip', input: { atBeat: 128, bars: 4 } }]) === 'depends-on-song')
  check('a number they DID say is fine',
    rememberCommand('set the tempo to 120',
      [{ name: 'set_tempo', input: { bpm: 120 } }]) === 'stored')
  check('including one they said as a word',
    rememberCommand('give me four bars of drums',
      [{ name: 'add_clip', input: { bars: 4 } }]) === 'stored')

  check('and none of the refused ones are recallable',
    !recallCommand('do that to the bass as well')
    && !recallCommand('bin the backing vocal')
    && !recallCommand('add four bars at the end'))
}

// ── forgetting, which is how a wrong entry gets fixed ──────────────────────
{
  forgetLearned()
  rememberCommand('mute the pad', [{ name: 'set_track', input: { target: 'pad', mute: true } }])
  forgetLearned('mute the pad')
  check('a single sentence can be forgotten', !recallCommand('mute the pad'))

  rememberCommand('solo the bass', [{ name: 'set_track', input: { target: 'bass', solo: true } }])
  forgetLearned()
  check('and so can all of them', learnedStats().entries === 0)
}

console.log(failures ? `\n${failures} failing` : '\ntaught once, free thereafter')
assert.equal(failures, 0)
