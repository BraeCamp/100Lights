#!/usr/bin/env node
// Can it hear you over your own song?
//
//   node --experimental-strip-types scripts/apollo-tests/voice-vad.test.mjs
//
// Brae: "The voice control doesn't hear me while it's playing."
//
// It could not, and the arithmetic says why. The rule was: learn the room from
// the first half-second, then treat anything 2.5x above it as speech. With the
// transport running the room IS the mix, so the bar became two and a half times
// the mix — a level nobody reaches by talking — and the take was then thrown
// away by the "was there any speech in this" check without ever being sent
// anywhere. The message was "I didn't catch that", which sounds like a hearing
// problem and was a threshold problem.
//
// None of that is testable with a microphone, and all of it is testable with
// numbers, which is why the decision now lives in a pure function. Each case
// below is a take played back as a sequence of meter readings: half a second of
// room, then whatever happens.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const {
  newVad, vadStep, RATIO_QUIET, RATIO_OVER_MUSIC, CALIBRATION_SAMPLES,
  CONTINUOUS_STRICTNESS, MIN_SPEECH_MS_CONTINUOUS,
} = await importTs('lib/voice/vad.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

/**
 * Play a take through the detector.
 *
 * `levels` is one reading per 50ms, the rate the real meter runs at, so the
 * timings in these cases are the timings in the room.
 */
function run(levels, opts = {}) {
  let state = newVad()
  let now = 0
  let everSpoke = false
  let endedAt = null
  let speakingSamples = 0
  const thresholds = []
  for (const rms of levels) {
    const step = vadStep(state, rms, now, opts)
    state = step.state
    thresholds.push(step.threshold)
    if (step.speaking) { everSpoke = true; speakingSamples++ }
    if (step.ended && endedAt === null) endedAt = now
    now += 50
  }
  return { everSpoke, endedAt, floor: state.floor, thresholds, speakingMs: speakingSamples * 50 }
}

const rep = (n, v) => Array.from({ length: n }, () => v)

/**
 * Speech, shaped like speech.
 *
 * A flat line at a speech level is not a fixture, it is music — and using one
 * hid the fact that a chorus arriving looked exactly like a very long word.
 * Real speech is gaps: syllables, word boundaries, breaths, several dips a
 * second. That shape is what separates a person from a mix, so the tests have
 * to have it or they are testing something nobody says.
 */
const speech = (n, loud, quiet) =>
  Array.from({ length: n }, (_, i) => (i % 5 === 4 ? quiet : loud))

// Levels are RMS as the meter reports them. A quiet room sits near 0.002,
// speech at a normal distance lands around 0.08, and a mix through monitors is
// somewhere near 0.10 — loud enough that speech on top of it is a rise, not a
// multiple.
const ROOM = 0.002
const SPEECH = 0.08
const MUSIC = 0.10
const SPEECH_OVER_MUSIC = 0.15   // the mix plus a person talking over it

// ── The case that was broken ────────────────────────────────────────────────
{
  const take = [
    ...rep(CALIBRATION_SAMPLES, MUSIC),
    ...speech(20, SPEECH_OVER_MUSIC, MUSIC),
    ...rep(40, MUSIC),
  ]
  const withFix = run(take, { playing: true })
  check('speech over playing music is heard', withFix.everSpoke)
  check('and the take ends when the talking stops', withFix.endedAt !== null,
    String(withFix.endedAt))

  // The same take judged by the old quiet-room rule, to show what was wrong
  // rather than merely assert that it is now right.
  const asIfQuiet = run(take, { playing: false })
  check('the old rule would have missed it entirely', !asIfQuiet.everSpoke,
    `bar was ${(MUSIC * RATIO_QUIET).toFixed(3)}, speech reached ${SPEECH_OVER_MUSIC}`)
}

// ── And the quiet room still works ─────────────────────────────────────────
{
  const take = [...rep(CALIBRATION_SAMPLES, ROOM), ...speech(20, SPEECH, ROOM), ...rep(40, ROOM)]
  const quiet = run(take)
  check('speech in a quiet room is heard', quiet.everSpoke)
  check('and that take ends too', quiet.endedAt !== null)
}

// ── Silence stays silence ──────────────────────────────────────────────────
{
  const take = rep(60, ROOM)
  check('an empty room is never speech', !run(take).everSpoke)
  check('and never ends a take that never started', run(take).endedAt === null)
}
{
  // The important negative for the loud case: music alone, at length, with no
  // one talking. If this triggers, every playback becomes a command.
  const take = [...rep(CALIBRATION_SAMPLES, MUSIC), ...rep(80, MUSIC)]
  check('music by itself is not mistaken for speech', !run(take, { playing: true }).everSpoke)
}
{
  // Music that gets louder — a build, a drop landing — must not read as speech
  // just because the level rose.
  const take = [
    ...rep(CALIBRATION_SAMPLES, MUSIC),
    ...rep(60, MUSIC * 1.12),
    ...rep(60, MUSIC * 1.2),
  ]
  check('a mix that swells is not mistaken for speech',
    !run(take, { playing: true }).everSpoke,
    'the floor follows it')
}

// ── The floor keeps moving ─────────────────────────────────────────────────
{
  // A floor learned during a quiet intro is wrong the moment the chorus lands,
  // and the level jump is a STEP, not a ramp — so it is above the bar and stays
  // there, which is indistinguishable from a very long word by level alone.
  // Only its shape gives it away: it never dips.
  const take = [...rep(CALIBRATION_SAMPLES, MUSIC * 0.3), ...rep(200, MUSIC)]
  const followed = run(take, { playing: true })
  check('the floor follows the music up over a section change',
    followed.floor > MUSIC * 0.6, followed.floor.toFixed(3))
  // Stated honestly rather than aspirationally. For the first couple of seconds
  // a chorus arriving IS indistinguishable from a long word — there is no
  // information yet that separates them, and pretending otherwise would mean
  // asserting something the design does not provide. What IS guaranteed is that
  // it cannot go on being mistaken: the moment it fails to dip for long enough,
  // it becomes the floor.
  check('a chorus landing cannot be mistaken for speech for long',
    followed.speakingMs <= 2600, `${followed.speakingMs}ms`)
  check('and it does not hold the take open forever',
    followed.endedAt !== null, String(followed.endedAt))
}
{
  // ...but never while somebody is talking, or the bar rises under them and
  // cuts them off mid-sentence.
  const take = [
    ...rep(CALIBRATION_SAMPLES, MUSIC),
    ...speech(100, SPEECH_OVER_MUSIC, MUSIC),   // five seconds of talking
  ]
  const long = run(take, { playing: true })
  check('a long sentence is not cut off by its own loudness',
    long.endedAt === null && long.everSpoke,
    `floor stayed ${long.floor.toFixed(3)}`)
  // The distinction that makes the rule above safe: five seconds of talking
  // stays speech throughout, because it dips, while five seconds of chorus does
  // not. Same levels, same duration, opposite verdicts — from shape alone.
  check('and it is still speech five seconds in',
    long.speakingMs > 3000, `${long.speakingMs}ms`)
}

// ── The bars are where they are claimed to be ──────────────────────────────
{
  const overMusic = run([...rep(CALIBRATION_SAMPLES, MUSIC), MUSIC], { playing: true })
  const inQuiet = run([...rep(CALIBRATION_SAMPLES, MUSIC), MUSIC], { playing: false })
  check('the bar over music is lower than the bar in a quiet room',
    overMusic.thresholds.at(-1) < inQuiet.thresholds.at(-1),
    `${overMusic.thresholds.at(-1).toFixed(3)} vs ${inQuiet.thresholds.at(-1).toFixed(3)}`)
  check('and it is the ratio the module says it is',
    Math.abs(overMusic.thresholds.at(-1) - MUSIC * RATIO_OVER_MUSIC) < 1e-6)
}

// ── Nothing is judged during calibration ───────────────────────────────────
{
  // Somebody who starts talking immediately would otherwise teach the detector
  // that their own voice is the room.
  const take = speech(CALIBRATION_SAMPLES, SPEECH, ROOM)
  check('the first half-second is measured, not judged', !run(take).everSpoke)
}

// ── Held open across commands: deliberately harder to trigger ──────────────
//
// Brae: "when it's toggled it should listen at a lower, less sensitive level
// for anything that the user might command."
//
// A take that lasts one command can be eager — somebody pressed a button and is
// about to speak. A microphone open for minutes cannot: everything said in the
// room reaches the same detector, and each false start costs a transcription
// and possibly a command nobody gave.
{
  const bar = (opts) => run([...rep(CALIBRATION_SAMPLES, ROOM), ROOM], opts).thresholds.at(-1)
  check('the bar is higher when the microphone is held open',
    bar({ continuous: true }) > bar({}) || bar({}) === bar({ continuous: true }),
    `${bar({}).toFixed(3)} vs ${bar({ continuous: true }).toFixed(3)}`)

  // Over music, where the floor is high enough for the ratio to matter rather
  // than being clamped by the absolute minimum.
  const overMusic = (opts) =>
    run([...rep(CALIBRATION_SAMPLES, MUSIC), MUSIC], { playing: true, ...opts }).thresholds.at(-1)
  check('and higher over music too',
    overMusic({ continuous: true }) > overMusic({}),
    `${overMusic({}).toFixed(3)} vs ${overMusic({ continuous: true }).toFixed(3)}`)
  check('by exactly the strictness the module claims',
    Math.abs(overMusic({ continuous: true }) - overMusic({}) * CONTINUOUS_STRICTNESS) < 1e-6)
}
{
  // The filter that actually earns its keep: a cough, a chair, a door and a
  // keyboard are all loud and all brief. Speech is not.
  const loudEnough = MUSIC * RATIO_OVER_MUSIC * CONTINUOUS_STRICTNESS * 1.2
  const blip = [...rep(CALIBRATION_SAMPLES, MUSIC), ...rep(2, loudEnough), ...rep(40, MUSIC)]
  check('a brief bang is not a command',
    !run(blip, { playing: true, continuous: true }).everSpoke,
    `${MIN_SPEECH_MS_CONTINUOUS}ms required, 100ms given`)

  const word = [...rep(CALIBRATION_SAMPLES, MUSIC), ...speech(30, loudEnough, MUSIC), ...rep(40, MUSIC)]
  check('but a spoken word still is',
    run(word, { playing: true, continuous: true }).everSpoke)
}
{
  // Several commands in one held-open take, which is the whole point: each has
  // to be detected and each has to end on its own.
  const loud = SPEECH * 2
  const gap = rep(40, ROOM)                     // two seconds of nothing
  const take = [
    ...rep(CALIBRATION_SAMPLES, ROOM),
    ...speech(20, loud, ROOM), ...gap,
    ...speech(20, loud, ROOM), ...gap,
    ...speech(20, loud, ROOM), ...gap,
  ]
  let state = newVad()
  let now = 0
  let ends = 0
  for (const rms of take) {
    const step = vadStep(state, rms, now, { continuous: true })
    state = step.state
    if (step.ended) { ends++; state = newVad() }   // the recorder cuts and re-arms
    now += 50
  }
  check('three commands in one take are three utterances', ends === 3, String(ends))
}

console.log(failures
  ? `\n${failures} failing`
  : '\nit hears a voice over a mix, and does not hear the mix')
assert.equal(failures, 0)
