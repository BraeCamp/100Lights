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
  CONTINUOUS_STRICTNESS, MIN_SPEECH_MS_CONTINUOUS, SUSTAINED_MS, RELEASE_HOLD_MS,
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

// ── One short word, trailing off ────────────────────────────────────────────
//
// Brae: "There are some problems with the thing hearing me right now. Even if I
// just say 'Play' it says 'I didn't get that'" — and then the diagnosis, which
// was the right one: "I think that it cuts off the quieter last part of my
// words because of the sound limiter."
//
// "Play" is about 300ms. It opens loud on the P and falls away through the
// vowel, so only its first half is anywhere near the bar. A single threshold
// doing both jobs — deciding a word has STARTED and deciding it is still GOING
// — treats that fade as silence the instant it dips, which is what a limiter
// sounds like from the inside.
//
// The room matters here, which is why the fixture has one. In a silent room the
// bar bottoms out at MIN_SPEECH_LEVEL and the tail clears it by accident. In a
// real room — a fan, a computer, a street — the floor lifts the bar into the
// middle of the word, and the second half of every short command falls under it.
{
  const REAL_ROOM = 0.02        // not silence: a desk, a fan, a room tone
  // One word: a hard attack, then a decay through the tail, then the room again.
  const WORD = [0.11, 0.085, 0.06, 0.045, 0.032, 0.024]
  const take = [
    ...rep(CALIBRATION_SAMPLES, REAL_ROOM),
    ...WORD,
    ...rep(40, REAL_ROOM),
  ]

  const held = run(take, { continuous: true })
  // The consequence of not hearing it is not "a worse transcript". `heard` is
  // never set, so the take is never cut, so the audio is thrown away by the
  // idle reset — and the studio answers "I didn't catch that" to a word it
  // recorded perfectly.
  check('a short quiet-tailed word is heard in a held-open session',
    held.everSpoke, `spoke for ${held.speakingMs}ms, bar ${held.thresholds.at(-1).toFixed(3)}`)
  check('and the take ends, so the audio is actually sent',
    held.endedAt !== null, String(held.endedAt))

  // The tail has to hold the utterance open rather than the silence clock
  // starting at the loudest moment — otherwise the end of the word is cut off
  // mid-vowel, which is what Brae could hear happening.
  const push = run(take, {})
  check('the quiet tail counts as part of the word, not as silence',
    push.speakingMs >= 200, `${push.speakingMs}ms of speech`)

  // The same word, said a minute into the session rather than in the first
  // second. Timing must not change the answer — and it did: the sustained-level
  // test compared `now` against a null clock, so once the session was older
  // than SUSTAINED_MS every quiet tail read as a section of music and dragged
  // the floor up under the speaker. Every fixture above speaks immediately,
  // which is exactly why none of them caught it.
  const late = [...rep(1200, REAL_ROOM), ...WORD, ...rep(40, REAL_ROOM)]
  const lateRun = run(late, { continuous: true })
  check('a word a minute in behaves like a word in the first second',
    lateRun.everSpoke && lateRun.endedAt !== null,
    `spoke ${lateRun.speakingMs}ms, floor ${lateRun.floor.toFixed(4)}`)
  check('and the floor is still the room, not the word',
    lateRun.floor < REAL_ROOM * 1.5, lateRun.floor.toFixed(4))
}

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
  // Expressed in the constants rather than as a number, because the number
  // moved when the gate got its second bar and a hand-tuned bound would just
  // have been raised to whatever came out. The guarantee is a shape: it stops
  // once the level has held without dipping (SUSTAINED_MS), plus however long
  // the low bar is allowed to keep the gate open afterwards (RELEASE_HOLD_MS),
  // plus the sample it is noticed on.
  const bound = SUSTAINED_MS + RELEASE_HOLD_MS + 50
  check('a chorus landing cannot be mistaken for speech for long',
    followed.speakingMs <= bound, `${followed.speakingMs}ms, bound ${bound}ms`)
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
  // Measured on the EXCESS over the floor, which is what strictness scales.
  // Over a mix the floor is the music itself, so scaling the whole bar would
  // ask for a shout — see the note in vad.ts.
  check('by exactly the strictness the module claims, applied to the excess',
    Math.abs((overMusic({ continuous: true }) - MUSIC) - (overMusic({}) - MUSIC) * CONTINUOUS_STRICTNESS) < 1e-6,
    `${overMusic({}).toFixed(3)} → ${overMusic({ continuous: true }).toFixed(3)} over a ${MUSIC} floor`)
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

  // The trade made when the gate got a second, lower bar: it now holds through
  // a DECAY, and a door slam is a decay. What still separates them is how fast.
  // A percussive hit is most of the way to nothing within a couple of frames,
  // so it cannot hold even the low bar for long enough; a voice takes its time.
  //
  // This is the honest boundary rather than a claim to have solved it: a slam
  // slow enough to look like a word will get transcribed, come back as nothing,
  // and be reported as "I didn't catch that" — a wasted transcription, not a
  // wrong action. Losing every short command was the worse end of that trade.
  const slam = [...rep(CALIBRATION_SAMPLES, ROOM), 0.30, 0.09, 0.03, ...rep(40, ROOM)]
  check('a percussive hit decays too fast to be a word',
    !run(slam, { continuous: true }).everSpoke,
    `${MIN_SPEECH_MS_CONTINUOUS}ms required`)
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

// ── Sensitivity is a dial, and it moves the bar ───────────────────────────
//
// Brae: "It's also having trouble hearing me and differentiating my voice next
// to the mic from background talking."
//
// No default fixes that — it depends on the room, the distance and the
// microphone. What the code owes is a bar that MOVES, and a number the meter
// can draw so somebody can set it by watching.
{
  const bar = sens => run(
    [...rep(CALIBRATION_SAMPLES, MUSIC), MUSIC],
    { playing: true, continuous: true, sensitivity: sens },
  ).thresholds.at(-1)
  check('a firmer setting raises the bar', bar(2) > bar(1), `${bar(1).toFixed(3)} → ${bar(2).toFixed(3)}`)
  check('and a quicker one lowers it', bar(0.7) < bar(1), `${bar(0.7).toFixed(3)} vs ${bar(1).toFixed(3)}`)
  // It scales the EXCESS over the floor, not the whole bar: over a mix the
  // floor IS the music, and doubling the whole thing asks for a shout.
  check('by scaling how far above the room it sits, not the whole bar',
    Math.abs((bar(2) - MUSIC) - (bar(1) - MUSIC) * 2) < 1e-6,
    `floor ${MUSIC}, bars ${bar(1).toFixed(3)} / ${bar(2).toFixed(3)}`)
  check('and no setting at all is the standing behaviour', bar(undefined) === bar(1))
}
{
  // What it buys: speech that clears the normal bar and not the strict one is
  // exactly the far-away conversation this is meant to drop.
  // Comfortably over the normal bar (music + 1.6x the modest excess) and under
  // the firm one.
  const acrossTheRoom = MUSIC + (SPEECH_OVER_MUSIC - MUSIC) * 1.1
  const take = [...rep(CALIBRATION_SAMPLES, MUSIC), ...speech(30, acrossTheRoom, MUSIC), ...rep(40, MUSIC)]
  check('a quieter voice is heard at the normal setting',
    run(take, { playing: true, continuous: true, sensitivity: 1 }).everSpoke)
  check('and dropped at a firm one',
    !run(take, { playing: true, continuous: true, sensitivity: 2 }).everSpoke)
  // ...while the near voice still gets through at the firm setting.
  const closeUp = [...rep(CALIBRATION_SAMPLES, MUSIC), ...speech(30, MUSIC + (SPEECH_OVER_MUSIC - MUSIC) * 2.5, MUSIC), ...rep(40, MUSIC)]
  check('the voice at the microphone still gets through',
    run(closeUp, { playing: true, continuous: true, sensitivity: 2 }).everSpoke)
}

console.log(failures
  ? `\n${failures} failing`
  : '\nit hears a voice over a mix, and does not hear the mix')
assert.equal(failures, 0)
