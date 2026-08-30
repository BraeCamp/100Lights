#!/usr/bin/env node
// On, but not listening to everything.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-attention.test.mjs
//
// Brae: "What can we do to help light be able to be on but quiet until it can
// tell that somebody is talking to it? I don't want background noise to mess
// with the on toggled voice command system."
//
// Holding the microphone open solved one problem and created another. Every
// filter before this one answers "is that a voice?" — the level detector, the
// hold time, the transcriber. None of them answers the question that matters
// once the mic stays open across a room:
//
//   IS THAT VOICE TALKING TO ME?
//
// Nothing acoustic settles it. Somebody across the room saying "stop" is,
// acoustically, a person clearly saying stop. Turning sensitivity down does not
// help: it makes the studio worse at hearing its owner while leaving it
// perfectly able to hear a louder mistake.
//
// So most of what is asserted here is REFUSAL, and specifically silent refusal.
// A room full of conversation next to an open microphone must produce nothing
// at all — no command, no question, no apology.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { addressed, considerUtterance, isAttentive, WAKE_WORDS, ATTENTION_MS, WAKE_CONFIDENCE } =
  await importTs('lib/voice/attention.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const NOW = 1_000_000
/** A dormant session: nothing accepted for a long time. */
const dormant = (text, confidence = 0.9) =>
  considerUtterance({ text, confidence, now: NOW, lastAcceptedAt: NOW - ATTENTION_MS - 1000, continuous: true })
/** A live one: a command went through a moment ago. */
const live = (text, confidence = 0.9) =>
  considerUtterance({ text, confidence, now: NOW, lastAcceptedAt: NOW - 2000, continuous: true })

// ── Being addressed ─────────────────────────────────────────────────────────
check('"light, mute the drums" is an address', addressed('light, mute the drums').addressed)
check('and the name is not part of the command',
  addressed('light, mute the drums').rest === 'mute the drums',
  addressed('light, mute the drums').rest)
check('a greeting in front of it is part of the address too',
  addressed('hey light, set the tempo to 120').rest === 'set the tempo to 120',
  addressed('hey light, set the tempo to 120').rest)
check('and it can come at the end', addressed('mute the drums, light').rest === 'mute the drums',
  addressed('mute the drums, light').rest)
check('a name heard slightly wrong still counts', addressed('lite, stop').addressed)

// The distinction that stops this being useless in a studio full of lights.
check('a light mentioned in passing is not an address',
  !addressed('the light on the compressor is red').addressed,
  'the name has to be at one end, not anywhere in the sentence')
check('nor is a sentence that merely contains it',
  !addressed('turn the light down a bit').addressed)

// ── Dormant: it is on, and it is quiet ─────────────────────────────────────
for (const overheard of [
  'stop',
  'can you mute that',
  'i think we should delete the drums',
  'yeah play it again',
  'what do you think of the bass',
]) {
  const v = dormant(overheard)
  check(`dormant, it ignores: "${overheard}"`, v.act === false, v.act ? 'ACTED' : v.reason)
}

// ── ...until it is spoken to ───────────────────────────────────────────────
{
  const v = dormant('light, stop')
  check('but it answers to its name', v.act === true && v.text === 'stop', JSON.stringify(v))
}
{
  // Just the name is a complete thing to say — it is how you get someone's
  // attention before saying what you want.
  const v = dormant('light')
  check('the name alone wakes it and waits', v.act === true && v.text === '', JSON.stringify(v))
}
{
  // The one failure that would cost the whole feature: waking on a mishearing
  // of its own name means never being quiet again.
  const v = dormant('light, stop', WAKE_CONFIDENCE - 0.2)
  check('a badly-heard name does not wake it', v.act === false, JSON.stringify(v))
  const sure = dormant('light, stop', WAKE_CONFIDENCE + 0.2)
  check('a clearly-heard one does', sure.act === true)
}

// ── Once talking, it keeps listening ───────────────────────────────────────
//
// The point of holding the mic open. Having to say the name before every
// command would be worse than clicking the button before every command.
{
  const v = live('mute the drums')
  check('mid-conversation, the name is not needed again', v.act === true && v.text === 'mute the drums')
}
check('and the conversation is only alive for a while',
  isAttentive(NOW, NOW - 2000) && !isAttentive(NOW, NOW - ATTENTION_MS - 1),
  `${Math.round(ATTENTION_MS / 1000)}s`)
{
  // A conversation that has gone quiet is dormant again, which is what stops a
  // session left running from staying armed while the room fills up.
  const v = dormant('play')
  check('a session that went quiet needs the name again', v.act === false)
}

// ── Push-to-talk is unaffected ─────────────────────────────────────────────
//
// Holding a button down for the duration of a sentence removes all doubt about
// who was being spoken to, so none of this applies there.
{
  const v = considerUtterance({ text: 'mute the drums', now: NOW, lastAcceptedAt: 0, continuous: false })
  check('holding the button needs no name', v.act === true && v.text === 'mute the drums')
  const named = considerUtterance({ text: 'light, mute the drums', now: NOW, lastAcceptedAt: 0, continuous: false })
  check('and saying it anyway does no harm', named.act === true && named.text === 'mute the drums')
}

// ── The name it answers to ─────────────────────────────────────────────────
check('the first name is the one it suggests', WAKE_WORDS[0] === 'light', WAKE_WORDS[0])
check('and it answers to several', WAKE_WORDS.length >= 3, WAKE_WORDS.join(','))

console.log(failures
  ? `\n${failures} failing`
  : '\nit stays quiet in a busy room, and answers to its name')
assert.equal(failures, 0)
