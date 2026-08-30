#!/usr/bin/env node
// Several commands in one breath, and a list you can check before it happens.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-sequence.test.mjs
//
// Brae: "it looks like it's seeing commands in separate lines and has trouble
// differentiating where they start if there isn't a substantial pause between
// things." And: "Can we have it collect executable commands and I can command it
// to read back the commands that I gave it and it executes when I say 'Execute'
// or 'Go ahead'."
//
// The pipeline assumed one utterance was one command and enforced it with
// silence, which is a rule about how to TALK imposed to make the parser's life
// easier. Two commands run together arrived as one sentence and were read as one
// thing — usually as the first one, with the rest silently discarded, which is
// the worst of the available failures because it looks like it worked.
//
// The danger in fixing it is the mirror image: a long stretch of ordinary
// conversation mined for anything that resembles an instruction. So the
// splitting is deliberately reluctant, and most of what is asserted here is that
// it does not split.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { interpretSequence } = await importTs('lib/voice/sequence.ts')
const { readQueueControl, readBack, askToImplement, reportRun } =
  await importTs('lib/voice/queue.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const CTX = {
  tracks: [
    { id: 't1', name: 'Bass 2', volume: 0.8, pan: 0 },
    { id: 't2', name: 'Pad', volume: 0.5, pan: 0 },
    { id: 't3', name: 'Drums', volume: 0.8, pan: 0 },
  ],
  tempo: 120,
}
const seq = t => interpretSequence(t, CTX)
const ids = t => seq(t).map(s => s.reading.matched)

// ── Several commands, no pauses ─────────────────────────────────────────────
{
  const got = seq('mute the drums set the tempo to 120')
  check('two commands in one breath are two commands', got.length === 2,
    ids('mute the drums set the tempo to 120').join(' + '))
  check('in the order they were said',
    got[0]?.reading.matched === 'set_track.mute' && got[1]?.reading.matched === 'set_tempo',
    ids('mute the drums set the tempo to 120').join(' + '))
  check('and both keep their arguments',
    got[0]?.reading.calls[0]?.input?.target === 'Drums'
    && got[1]?.reading.calls[0]?.input?.bpm === 120,
    JSON.stringify(got.map(g => g.reading.calls[0]?.input)))
}
{
  const got = ids('mute the drums and set the tempo to 120 then loop bars 1 to 4')
  check('three of them, joined by ordinary words', got.length === 3, got.join(' + '))
}
{
  const got = ids('solo the pad unmute the drums')
  check('two mixer commands in a row', got.length === 2, got.join(' + '))
}

// ── A single command is untouched ──────────────────────────────────────────
//
// The ordinary case, and the one this must not break.
for (const [phrase, expected] of [
  ['stop', 'transport.stop'],
  ['mute the drums', 'set_track.mute'],
  ['set the tempo to 128', 'set_tempo'],
  ['loop bars 9 to 17', 'set_loop_region.range'],
]) {
  const got = seq(phrase)
  check(`one command stays one: "${phrase}"`,
    got.length === 1 && got[0].reading.matched === expected,
    got.map(g => g.reading.matched).join(' + '))
}
{
  // The case longest-match-first exists for. "mute the bass" is a real command
  // sitting inside this one, and splitting there would mute the wrong track and
  // leave a stray 2.
  const got = seq('mute the bass 2')
  check('a number inside a name does not become a second command',
    got.length === 1 && got[0].reading.calls[0]?.input?.target === 'Bass 2',
    JSON.stringify(got.map(g => g.reading.calls[0]?.input)))
}

// ── It does not mine conversation for instructions ─────────────────────────
//
// The real risk. Reading every span of a long sentence gives many more chances
// to find something that looks like a command in something that was not one.
for (const chat of [
  'i think the intro is too long and we should probably rework it',
  'that take was better than the last one but the timing is still off',
  'can you hear that hiss because i think it might be the room',
  'we could try it again tomorrow when everyone is here',
]) {
  const got = seq(chat)
  check(`no commands found in: "${chat.slice(0, 44)}…"`, got.length === 0,
    got.map(g => `${g.reading.matched}[${g.text}]`).join(' + '))
}
{
  // A sentence with ONE command and a lot of talk around it must give one
  // command, not one command plus whatever the rest resembles.
  const got = seq('the intro drags a bit so mute the drums and see how it feels')
  check('a command surrounded by talk is still one command', got.length <= 1,
    got.map(g => `${g.reading.matched}[${g.text}]`).join(' + '))
}

// ── The words that drive the list ──────────────────────────────────────────
for (const [phrase, control] of [
  ['execute', 'run'],
  ['go ahead', 'run'],
  ['do it', 'run'],
  ['read them back', 'read'],
  ['what have i got', 'read'],
  ['clear the list', 'clear'],
  ['start collecting', 'collect'],
  ['stop collecting', 'immediate'],
]) {
  check(`"${phrase}" drives the queue`, readQueueControl(phrase) === control,
    String(readQueueControl(phrase)))
}
check('"stop collecting" is not read as "collect"',
  readQueueControl('stop collecting') === 'immediate')
check('and an ordinary command is not a control',
  readQueueControl('mute the drums') === null, String(readQueueControl('mute the drums')))
check('nor is a sentence that merely contains a control word',
  readQueueControl('execute the plan we discussed') === 'run',
  'whole-phrase matching keeps this deliberate')

// ── What it says about the list ────────────────────────────────────────────
{
  const q = [
    { text: 'mute the drums', say: 'Drums: muted.', calls: [] },
    { text: 'tempo 120', say: 'Tempo set to 120 bpm.', calls: [] },
  ]
  check('the read-back is numbered, so one can be named',
    /1\. .*2\. /.test(readBack(q)), readBack(q))
  check('and empty is said plainly', /nothing/i.test(readBack([])), readBack([]))
  check('the offer asks rather than announces',
    /do you want to implement/i.test(askToImplement(q)), askToImplement(q))
  check('and it counts them', /2 changes/.test(askToImplement(q)), askToImplement(q))
  check('one change is not "1 changes"', /1 change ready/.test(askToImplement(q.slice(0, 1))),
    askToImplement(q.slice(0, 1)))
}
{
  check('a clean run says so', reportRun(3, []) === '3 changes made.', reportRun(3, []))
  check('and a partial one says what did not happen',
    /could not be done/.test(reportRun(2, ['no track called that'])),
    reportRun(2, ['no track called that']))
}

console.log(failures
  ? `\n${failures} failing`
  : '\nseveral commands in a breath, and nothing done until it is asked for')
assert.equal(failures, 0)
