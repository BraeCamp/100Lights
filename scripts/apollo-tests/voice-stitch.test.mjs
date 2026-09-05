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
    /if \(!readable\) \{\s*\n\s*const held = heldFragment\.current\s*\n\s*const joined = stitch\(/.test(voice))
  check('and only keeps the joined version if it reads as something',
    /if \(joined && interpret\(joined, ctx\)\.calls\.length > 0\)/.test(voice))
  check('an understood sentence clears the hold',
    /if \(readable\) heldFragment\.current = null/.test(voice))
  check('and the sentence dropped at the attention gate is kept',
    /if \(worthHolding\(text, false\)\) heldFragment\.current/.test(voice))
}

// ── ⚠️ the shorter tail, and the half-sentence it makes more common ────────
//
// Brae: "Let's do the biggest lever. You'll need to accommodate for speech
// pauses, so if a transcript is made after saying 'On Pad Intro...' then
// there's a 3 second wait, 'descend the volume from 100% to 60%'. That is a
// broken up sentence but the same idea."
{
  const { looksIncomplete, stitch: join } = await importTs('lib/voice/stitch.ts')
  const vad = readFileSync('lib/voice/vad.ts', 'utf8')
  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('the silence tail is 1.2 s, down from 2.2', /SILENCE_MS = 1200/.test(vad))
  check('and 1.5 s over playing music', /SILENCE_MS_PLAYING = 1500/.test(vad))

  // The half that trails off has no verb in it — a place or a thing, with
  // nothing to do to it yet.
  check('"On Pad Intro" is recognised as half a sentence', looksIncomplete('On Pad Intro'))
  check('so is a bare track name', looksIncomplete('the drums'))
  check('and a phrase that ends mid-air', looksIncomplete('and then at bar 9 to'))
  // Whole thoughts must NOT wait — "stop" is finished when it stops.
  check('"stop" is not', !looksIncomplete('stop'))
  check('"mute the drums" is not', !looksIncomplete('mute the drums'))
  check('a complaint with a verb is not', !looksIncomplete('the reverb is too much'))
  check('a question is not', !looksIncomplete('what is on the pad?'))
  check('a paragraph is not a fragment', !looksIncomplete('a b c d e f g h i j k l m n o'))

  // Brae's exact case: a 3-second pause, then the rest.
  const t0 = 1_000_000
  const joined = join({ text: 'On Pad Intro', at: t0 }, 'descend the volume from 100% to 60%', t0 + 3_000)
  check('the two halves join across a three-second pause',
    joined === 'On Pad Intro descend the volume from 100% to 60%', String(joined))

  // And the studio takes that join even though no RULE can read an automation
  // — the assistant can. Before this, the join only stood when the rules read
  // the result, so the halves went their separate ways.
  check('the studio keeps a join whose held half was unfinished, for the assistant',
    /else if \(joined && held && looksIncomplete\(held\.text\)\)/.test(voice))
  check('a fresh half-sentence is held quietly rather than sent anywhere',
    /if \(!readable && !questionWaiting && !heldFragment\.current && looksIncomplete\(text\)\)/.test(voice))
  // ⚠️ EXCEPT AN ANSWER. "More muffled", "the second one", "the bass clip" are
  // all fragments, so every answer to one of the studio's own questions was
  // held here for three seconds and then asked about — while the question it
  // answered sat on screen. The studio asked, stopped listening, and then
  // asked what the reply meant.
  check('but not while a question is waiting for one',
    /const questionWaiting = /.test(voice) && /pendingAsk2/.test(voice))
  check('and asked about only if nothing follows',
    /what would you like to do with it\?/.test(voice))
}

// ── "…and the hats": the rest of a command that already ran ────────────────
//
// Brae: "Is there a way that we can make that sentence work in the program?
// Those pauses are part of natural speech and if we can respect them then we
// will get further."
//
// "mute the drums… [pause] …and the hats". The first half is whole and ran when
// the tail ended. The second is not a new command — it is the same one
// continuing. It is read as the whole sentence, and only the part that has not
// happened yet is carried out.
{
  const { continuesPrevious, notAlreadyRun } = await importTs('lib/voice/stitch.ts')
  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')

  check('a take opening with "and" continues the last command', continuesPrevious('and the hats'))
  check('so does "then"', continuesPrevious('then the bass'))
  check('and a bare thing with no verb', continuesPrevious('the hats'))
  // A fresh command is a fresh command, however soon it follows.
  check('"mute the hats" is not a continuation', !continuesPrevious('mute the hats'))
  check('nor is "stop"', !continuesPrevious('stop'))

  // ⚠️ THE HALF THAT RAN MUST NOT RUN AGAIN. Re-reading "move the drums two bars
  // and the hats" plans to two moves; the drums moved a moment ago. Running
  // both would move the drums four.
  const ran = [{ name: 'set_track', input: { target: 'Drums', muted: true } }]
  const planned = [
    { name: 'set_track', input: { target: 'Drums', muted: true } },
    { name: 'set_track', input: { target: 'Hats', muted: true } },
  ]
  const left = notAlreadyRun(planned, ran)
  check('what already ran is subtracted from the re-read sentence',
    left.length === 1 && left[0].input.target === 'Hats', JSON.stringify(left))
  check('and nothing is subtracted when nothing ran', notAlreadyRun(planned, []).length === 2)
  // Same name, different arguments, is a different call.
  check('a call with different arguments is not mistaken for the one that ran',
    notAlreadyRun([{ name: 'set_track', input: { target: 'Drums', muted: false } }], ran).length === 1)

  check('the studio joins a continuation to the words that just ran',
    /text = `\$\{lastRun\.text\} \$\{text\}`/.test(voice))
  check('and subtracts what ran on every path — rules, cache, assistant',
    (voice.match(/notAlreadyRun\(/g) ?? []).length >= 3)
  check('remembering what ran wherever a command runs',
    (voice.match(/lastRunRef\.current = \{ text, calls:/g) ?? []).length >= 3)
}

console.log(failures ? `\n${failures} failing` : '\nslow speech survives')
assert.equal(failures, 0)
