#!/usr/bin/env node
// Answering the easy commands without asking anyone.
//
//   node --experimental-strip-types scripts/apollo-tests/local-resolve.test.mjs
//
// Brae: "whenever something is said and the program has low confidence in
// hearing it or in its answer then we can put AI on it ... it would run the
// answer through the voice program's wiring so that it's already wired for
// switching the answer to the program instead of AI."
//
// So the resolver's job is not to be clever. It is to be RIGHT about the small
// set of things it claims, and honest about everything else — because the
// alternative to answering locally is a correct answer from the assistant, and
// a wrong local answer is worse than a slow correct one: it is silent, free,
// and therefore happens a lot.
//
// Most of what is asserted here is therefore declining, not resolving.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { resolveLocally, confidentEnough } = await importTs('lib/voice/local-resolve.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const CTX = { tracks: [
  { id: 't1', name: 'Bass 2' },
  { id: 't2', name: 'Pad' },
  { id: 't3', name: 'Drums' },
] }
const AMBIGUOUS = { tracks: [{ id: 'a', name: 'Bass 1' }, { id: 'b', name: 'Bass 2' }] }

const r = (s, ctx = CTX) => resolveLocally(s, ctx)
const call = (s, ctx = CTX) => r(s, ctx).calls[0]

// ── The traffic it exists to absorb ─────────────────────────────────────────
check('play', call('play')?.name === 'transport' && call('play').input.action === 'play')
check('stop', call('stop').input.action === 'stop')
check('pause is a pause, not a stop', call('pause').input.action === 'pause')
check('start over', call('start over').input.action === 'restart')
check('go to bar 9', JSON.stringify(call('go to bar 9').input) === '{"action":"locate","at":{"bar":9}}',
  JSON.stringify(call('go to bar 9')?.input))

check('set the tempo to 128', call('set the tempo to 128').input.bpm === 128)
check('spoken numbers too', call('set the tempo to ninety').input.bpm === 90,
  JSON.stringify(call('set the tempo to ninety')?.input))
check('128 bpm', call('128 bpm').input.bpm === 128)

check('loop bars 9 to 17',
  JSON.stringify(call('loop bars 9 to 17').input) === '{"start":{"bar":9},"end":{"bar":17}}',
  JSON.stringify(call('loop bars 9 to 17')?.input))
check('loop off', call('turn looping off').input.enabled === false)

check('mute the pad', call('mute the pad').input.muted === true)
check('and it targets the right track', call('mute the pad').input.target.name === 'Pad')
check('solo the drums', call('solo the drums').input.solo === true)
check('unmute', call('unmute the pad').input.muted === false)
check('set the pad to 80 percent', call('set the pad to 80 percent').input.volume === 80)

// ── Declining, which is the part that matters ───────────────────────────────
check('an ambiguous track name is left to the assistant',
  r('mute the bass', AMBIGUOUS).calls.length === 0, r('mute the bass', AMBIGUOUS).matched)

check('a track that does not exist is not invented',
  r('mute the trumpet').calls.length === 0, r('mute the trumpet').matched)

check('judgement is not attempted',
  r('make the chorus feel bigger').calls.length === 0)

check('"a bit louder" is declined — how much "a bit" is has not been decided',
  r('make the pad a bit louder').calls.length === 0)

check('a tempo that cannot be one is declined',
  r('set the tempo to 4').calls.length === 0, JSON.stringify(r('set the tempo to 4').calls))

check('a backwards loop is declined', r('loop bars 17 to 9').calls.length === 0)

check('"play the bass louder" is not the transport command',
  r('play the bass louder').calls.length === 0)

check('an empty utterance resolves to nothing', r('').calls.length === 0)

// ── How sure the transcriber must be depends on what matched ───────────────
//
// Brae, after saying "start" and being told the AI was out of credits: "it
// should be a non-AI response — it should have high confidence after running
// through the existing program that it already knows the command."
//
// A transcriber rates SHORT utterances low as a matter of course: "start" is one
// syllable with no context to check itself against. A flat threshold on that
// number therefore sends the simplest and most-used commands in the studio to a
// model — the exact opposite of the point.
const good = r('play')
check('a confident rule on well-heard speech runs locally',
  confidentEnough(good, 0.95) === true)
check('"start" runs locally even when the transcriber is unsure of one syllable',
  confidentEnough(r('start'), 0.45) === true)
check('and so does "stop"', confidentEnough(r('stop'), 0.4) === true)
check('a fixed-vocabulary match is not gated on hearing confidence alone',
  r('play').needsName === false)

// A NAME is the opposite case: only as good as the word it was given, and
// muting the wrong track is quiet and easy to miss.
check('a name-dependent rule DOES want the words to be trusted',
  r('mute the pad').needsName === true)
check('and goes to the assistant when they are not',
  confidentEnough(r('mute the pad'), 0.4) === false)
check('but runs locally when they are',
  confidentEnough(r('mute the pad'), 0.85) === true)

check('garbled speech on a fixed command is still refused below the floor',
  confidentEnough(good, 0.15) === false)
check('nothing resolved never runs locally, however well heard',
  confidentEnough(r('make it bigger'), 1) === false)

// A name-dependent rule inherits the name match's own uncertainty rather than
// asserting over it.
check('a name match carries its uncertainty into the confidence',
  r('mute the pad').confidence < 0.95 && r('mute the pad').confidence >= 0.85,
  String(r('mute the pad').confidence))

console.log(failures
  ? `\n${failures} failing`
  : '\nthe common commands are answered here, and everything else is handed on')
assert.equal(failures, 0)
