#!/usr/bin/env node
// A sentence spoken slowly, arriving in two pieces.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-stitch.test.mjs
//
// Brae: "when I talk more slowly it thinks that I'm saying different sentences.
// It should hold on to older transcription for longer so that it can process
// and correct slower speaking, or a break in speaking."
//
// ⚠️ WAITING LONGER CANNOT FIX THIS ALONE. On the recorder path our own VAD
// already waits 2.2 seconds before believing a sentence has ended. But a
// browser using SpeechRecognition is endpointed by the BROWSER — well under a
// second, with no setting for it — so half the sentences arrive already cut,
// and no timing constant of ours is consulted. The repair has to be above both
// paths, on the words.
//
// The danger runs the other way too: joining two sentences that were meant to
// be separate would run a command nobody asked for. That is much worse than
// failing to rejoin one that was split, so every rule here is a reason NOT to
// join.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { stitch, worthHolding, STITCH_MS } = await importTs('lib/voice/stitch.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')

const at = t => ({ text: 'add a descending low pass filter to', at: t })

// ── the case it exists for ─────────────────────────────────────────────────
{
  const joined = stitch(at(1000), 'the bass track', 1000 + 1200)
  check('a pause in the middle of a sentence is rejoined',
    joined === 'add a descending low pass filter to the bass track', String(joined))

  check('nothing held means nothing to join', stitch(null, 'the bass track', 5000) === null)
  check('and a fragment older than the window is let go',
    stitch(at(1000), 'the bass track', 1000 + STITCH_MS + 1) === null)
}

// ── the reasons not to join ────────────────────────────────────────────────
{
  // ⚠️ Saying it again after a failure is not continuing a sentence. Without
  // this it produced "mute the drums mute the drums", which reads as neither.
  check('a repeat is not a continuation',
    stitch({ text: 'mute the drums', at: 1000 }, 'Mute the drums', 2000) === null)

  // The recogniser only punctuates where it heard a thought finish.
  check('a fragment that ended in a full stop was whole',
    stitch({ text: 'mute the drums.', at: 1000 }, 'solo the bass', 2000) === null)

  // A real cut leaves at least one side short; two long halves are two
  // sentences.
  const long = 'please take the bass and move it back about two bars for me now'
  check('two long halves are two sentences, not one',
    stitch({ text: long, at: 1000 }, long + ' again', 2000) === null)

  check('empty text joins nothing', stitch(at(1000), '   ', 2000) === null)
  // A clock that moved backwards is not a pause.
  check('and neither does a negative gap', stitch(at(5000), 'the bass', 1000) === null)
}

// ── what is worth keeping ──────────────────────────────────────────────────
{
  // ⚠️ ONLY WHAT THE STUDIO COULD NOT READ. Joining the next sentence onto a
  // command that already ran would be inventing a request.
  check('an understood sentence is never held',
    worthHolding('mute the drums', true) === false)
  check('but an unreadable one is', worthHolding('add a descending filter to', false) === true)
  check('one word counts — false starts are exactly this shape',
    worthHolding('the', false) === true)
  check('a long unreadable sentence is a comprehension problem, not a pause',
    worthHolding('a'.repeat(3).split('').join(' ') + ' ' + 'word '.repeat(20), false) === false)
}

// ── it only ever rescues something that was failing anyway ─────────────────
//
// The wiring must join only when the new words read as NOTHING alone and the
// joined version reads as a command. Verified against the real interpreter so
// this cannot drift from what the rules actually accept.
{
  const ctx = { tracks: [{ id: 't1', name: 'Bass', volume: 0.8 }], tempo: 120, clips: [] }
  const half = 'turn the'
  const rest = 'bass up'
  check('the tail alone reads as nothing', interpret(half, ctx).calls.length === 0)
  const joined = stitch({ text: half, at: 1000 }, rest, 1500)
  check('and the two together read as a command',
    !!joined && interpret(joined, ctx).calls.length > 0, joined ?? '')

  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('the studio only joins when the new words read as nothing',
    /if \(!readable\) \{\s*\n\s*const joined = stitch\(/.test(voice))
  check('and only keeps the joined version if it reads as something',
    /if \(joined && interpret\(joined, ctx\)\.calls\.length > 0\)/.test(voice))
  check('an understood sentence clears the hold',
    /if \(readable\) heldFragment\.current = null/.test(voice))
  check('and the sentence dropped at the attention gate is kept',
    /if \(worthHolding\(text, false\)\) heldFragment\.current/.test(voice))
}

console.log(failures ? `\n${failures} failing` : '\nslow speech survives')
assert.equal(failures, 0)
