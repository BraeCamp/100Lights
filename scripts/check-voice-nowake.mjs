#!/usr/bin/env node
/**
 * A held-open session with no magic word.
 *
 *   node --experimental-strip-types scripts/check-voice-nowake.mjs
 *
 * Brae: "The 'say light first' thing needs to go. It isn't working for me. Also
 * I said execute at one point and it said 'not acted on'."
 *
 * Those were one bug wearing two hats. The gate demanded the name before acting,
 * and it decided whether a sentence even deserved a reply by asking whether the
 * built-in commands could read it — so "execute", which is about the QUEUE and
 * resolves to no command at all, failed that test and was discarded as room
 * noise. The one word whose job is to approve a list could not get past the
 * guard on the list.
 *
 * The first version of this check drove a real browser, and it was worse than
 * useless: toggle mode records rather than using the browser's recogniser, so
 * the fake recogniser never fired, nothing happened at all, and half the
 * assertions passed anyway because they read a flag that starts false and
 * checked it was false. Assertions that cannot fail are worse than no
 * assertions — they report green while the feature is dead.
 *
 * So the rule is a pure function now, and this exercises it directly.
 */

import { importTs } from './lib/ts-import.mjs'

const { shouldActOn, addressed, WAKE_WORDS } = await importTs('lib/voice/attention.ts')
const { readQueueControl } = await importTs('lib/voice/queue.ts')
// The REAL interpreter, not the cheap pre-check. The first version of this used
// resolveLocally — which is deliberately narrow and reads "mute the drums" but
// not "take the bass up" — and it caught the component making the same mistake:
// a gate built on that would have silently ignored commands that work.
const { interpret } = await importTs('lib/voice/interpret.ts')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

// Volume and pan included, not just names. A relative command — "turn the bass
// up" — needs a level to nudge FROM, and without one the rule correctly refuses
// rather than guessing. A names-only fixture makes the single most ordinary
// thing anybody says to a mixer look broken, which is exactly how it read until
// I checked the rule instead of trusting the fixture.
const TRACKS = [
  { id: 't1', name: 'Bass 2', volume: 0.8, pan: 0 },
  { id: 't2', name: 'Pad', volume: 0.8, pan: 0 },
  { id: 't3', name: 'Drums', volume: 0.8, pan: 0 },
]

/** The decision the studio makes about one overheard sentence. */
const wouldAct = (text, opts = {}) => shouldActOn({
  held: opts.held ?? true,
  collecting: opts.collecting ?? false,
  answering: opts.answering ?? false,
  readable: interpret(text, { tracks: TRACKS, tempo: 120 }).calls.length > 0,
  queueWord: !!readQueueControl(text),
  assistantActs: opts.assistantActs ?? false,
})

console.log('NO NAME REQUIRED')
for (const said of ['mute the drums', 'play', 'stop', 'loop bars 9 to 17', 'take the bass up']) {
  check(`"${said}" acts without being addressed first`, wouldAct(said))
}

console.log('\nTHE NAME STILL WORKS, IT IS JUST NOT DEMANDED')
check('a sentence with the name in it is still understood',
  wouldAct('light, mute the drums'), '')
check('and the name is still recognised as an address',
  addressed(`${WAKE_WORDS[0]}, mute the drums`).addressed)

console.log('\n"EXECUTE" GETS THROUGH')
// The exact failure Brae reported. These resolve to no command — they are about
// the list, not the song — so the old is-this-a-command test threw them away.
// "clear" is deliberately absent: it is a button, not a spoken control, and the
// panel has never claimed otherwise.
for (const said of ['execute', 'go ahead', 'read them back']) {
  check(`"${said}" is not mistaken for room noise`, wouldAct(said),
    `readable=${interpret(said, { tracks: TRACKS, tempo: 120 }).calls.length > 0}`)
}

console.log('\nTHE ROOM STILL RUNS NOTHING')
const overheard = [
  'so anyway I told him the whole thing was ridiculous',
  'no I think it was the other one',
  'I will call you back in a minute',
]
for (const said of overheard) {
  check(`"${said.slice(0, 34)}…" is left alone`, !wouldAct(said))
}
check('and an overheard sentence is not sent to the assistant either',
  !wouldAct(overheard[0], { assistantActs: false }))
check('unless somebody has asked for exactly that',
  wouldAct(overheard[0], { assistantActs: true }))

// The honest boundary, stated rather than hidden. Without a name to gate on,
// the only test left is whether the studio can read the sentence — and a few
// ordinary English phrases genuinely do read as commands. "what time" is a
// question about the tempo as far as the rules are concerned.
//
// This is left alone rather than patched around because of what it costs: the
// commands it lands on are the read-only ones, so the worst outcome is the
// studio saying the tempo out loud at a moment nobody asked. Narrowing the
// rules to exclude it would cost the question somebody DOES mean to ask.
check('a room question that happens to read as a command is a known cost',
  wouldAct('did you see what time they got in last night'),
  'answers with the tempo — read-only, and free')

console.log('\nTHE RULE ONLY APPLIES WHERE THE AMBIGUITY IS')
check('holding the button down is not ambiguous about who you meant',
  wouldAct(overheard[0], { held: false }))
check('and while collecting, nothing executes, so nothing needs guarding',
  wouldAct(overheard[0], { collecting: true }))
check('an answer to a question the studio asked is addressed by construction',
  wouldAct('the second one', { answering: true }))

console.log(failures ? `\n${failures} failing` : '\nno magic word, and the room is still quiet')
process.exit(failures ? 1 : 0)
