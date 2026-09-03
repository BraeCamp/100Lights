#!/usr/bin/env node
// Working out what is actually wrong.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-calibrate.test.mjs
//
// Brae: "'Light, add a descending low pass filter to pad A' turned into 'I'd
// like to have some muscle pain'. Do we need a calibration system?"
//
// Yes, but not the kind that asks you to read three sentences so a model can
// learn your voice — the recogniser is a cloud service and cannot be trained
// from here. What can be calibrated is everything between the person and it,
// and a sentence coming back as nonsense has four quite different causes that
// are fixed in four different places.
//
// So this is a diagnosis, and what is tested is that it diagnoses the RIGHT
// one. Advice that is confidently wrong is worse than none: telling somebody to
// speak up while their headset is resampling them to 16 kHz sends them to fix a
// thing that is not broken.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { phraseAccuracy, verdictFor, CALIBRATION_PHRASE } =
  await importTs('lib/voice/calibrate.ts')

const { SENSITIVITY_MIN, SENSITIVITY_MAX } = await importTs('lib/voice/calibrate.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── How much of it came back ────────────────────────────────────────────────
check('a perfect transcript is perfect',
  phraseAccuracy(CALIBRATION_PHRASE, CALIBRATION_PHRASE) === 1)
check('and punctuation is not a mistake',
  phraseAccuracy('Light, add a filter', 'light add a filter') === 1)
{
  // His actual failure. Word overlap rather than exact match, because a
  // transcript that gets nine words of eleven is working and one that gets two
  // is not — and the difference is the whole point of measuring.
  const bad = phraseAccuracy(CALIBRATION_PHRASE, "I'd like to have some muscle pain")
  check('the sentence he got back scores very low', bad < 0.2, bad.toFixed(2))
  const half = phraseAccuracy(CALIBRATION_PHRASE, 'light add a descending filter to the pad')
  check('and a mostly-right one scores high', half > 0.7, half.toFixed(2))
}
check('nothing heard is nothing', phraseAccuracy(CALIBRATION_PHRASE, '') === 0)

// ── Which of the four is it? ───────────────────────────────────────────────
const say = (m) => verdictFor({
  floor: 0.01, peak: 0.09, accuracy: 0.9, confidence: 0.9,
  sampleRate: 48000, micLabel: 'Studio Mic', ...m,
})

{
  // A call profile swamps everything else, so it is said first and alone.
  // Telling somebody to move closer while their headset is at 16 kHz is advice
  // that cannot work.
  const v = say({ sampleRate: 16000, micLabel: 'AirPods', peak: 0.005, accuracy: 0.1 })
  check('a call profile is diagnosed before anything else',
    /call profile/i.test(v.verdict) && /AirPods/.test(v.verdict), v.verdict)
  check('and it does not also tell them to speak up',
    !/move closer/i.test(v.verdict), v.verdict)
}
{
  const v = say({ peak: 0.004 })
  check('almost nothing arriving is the microphone, not the room',
    /barely anything/i.test(v.verdict), v.verdict)
}
{
  // The case that matters most in a studio: the voice is there, but so is
  // everything else.
  const v = say({ floor: 0.06, peak: 0.09 })
  check('a voice barely above the room says so',
    /only 1\.5x the room/i.test(v.verdict), v.verdict)
  check('and suggests a quicker trigger, not a stricter one',
    v.suggested < 1, String(v.suggested))
}
{
  // Level fine, words wrong — which is exactly his report, and a completely
  // different problem from a quiet microphone.
  const v = say({ floor: 0.01, peak: 0.09, accuracy: 0.2 })
  check('good level with bad words blames the recogniser, not the mic',
    /recogniser struggling/i.test(v.verdict), v.verdict)
  check('and says the level is fine so they do not chase it',
    /level is fine/i.test(v.verdict), v.verdict)
}
{
  // The suggestion is MEASURED from the room, not chosen from a short list of
  // presets - calibrate.ts says so where it computes it. This assertion used to
  // read `v.suggested === 2.2`, which was the old fixed dial, so it has been
  // failing ever since and nothing surfaced it: this file was never in the test
  // suite. What actually matters is comparative - a clear loud voice can afford
  // a stricter bar than a marginal one - and that survives the arithmetic being
  // retuned, which an exact number cannot.
  const v = say({ floor: 0.005, peak: 0.09, accuracy: 0.95 })
  const marginal = say({ floor: 0.03, peak: 0.09, accuracy: 0.95 })
  check('a clear loud voice can afford a stricter setting than a marginal one',
    v.suggested > marginal.suggested, `${v.suggested} vs ${marginal.suggested}`)
  check('and is told so', /strictest/i.test(v.verdict), v.verdict)
}
{
  const v = say({ floor: 0.02, peak: 0.12, accuracy: 0.9 })
  check('an ordinary good result is just good', /^Good/.test(v.verdict), v.verdict)
  // Sensible for an ORDINARY room means somewhere in the middle of the travel:
  // not pinned at either stop, which is what a measurement that has run out of
  // road looks like. The old 1-1.5 band was two notches of the retired dial.
  check('and suggests something sensible',
    v.suggested > SENSITIVITY_MIN && v.suggested < SENSITIVITY_MAX,
    `${v.suggested} (dial ${SENSITIVITY_MIN}-${SENSITIVITY_MAX})`)
}

// ── The suggestion is always usable ───────────────────────────────────────
//
// It is applied automatically, so a value outside the range the dial offers
// would silently set the studio to something no button can show.
for (const m of [
  { peak: 0.001, floor: 0.001 },
  { peak: 0.5, floor: 0.0001 },
  { floor: 0, peak: 0 },
  { sampleRate: null },
  { accuracy: 0 },
  { accuracy: 1, floor: 0.001, peak: 0.4 },
]) {
  const v = say(m)
  // On the DIAL means within its travel, not one of four notches. The point of
  // this loop is that no measurement - including a silent room, a null sample
  // rate and a perfect score - can push the suggestion somewhere the control
  // cannot go.
  check(`the suggestion stays on the dial: ${JSON.stringify(m)}`,
    Number.isFinite(v.suggested) && v.suggested >= SENSITIVITY_MIN && v.suggested <= SENSITIVITY_MAX,
    String(v.suggested))
  check('  and it always says something', v.verdict.length > 20)
}

console.log(failures
  ? `\n${failures} failing`
  : '\nit measures the room, the voice and the words, and says which one is wrong')
assert.equal(failures, 0)
