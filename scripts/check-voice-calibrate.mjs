#!/usr/bin/env node
/**
 * Calibrating the bar to a particular voice in a particular room.
 *
 *   node --experimental-strip-types scripts/check-voice-calibrate.mjs
 *
 * Brae: "I think the volume sensitivity needs to be higher, or even better we
 * have a sensitivity calibration that the user can use to calibrate to their
 * volume."
 *
 * The second, because the first cannot be right for everybody — the correct bar
 * is a property of a room, a microphone and a voice, and no default chosen in
 * this file knows any of the three. Calibration already measured all three and
 * then threw the numbers away to pick one of four presets.
 *
 * So the assertions are that the arithmetic actually lands the bar where it
 * claims to, in rooms of different kinds, using the detector's own formula
 * rather than a restatement of it.
 */

import { importTs } from './lib/ts-import.mjs'

const { sensitivityFor, AIM, SENSITIVITY_MIN, SENSITIVITY_MAX } = await importTs('lib/voice/calibrate.ts')
const { RATIO_QUIET, CONTINUOUS_STRICTNESS, MIN_SPEECH_LEVEL } = await importTs('lib/voice/vad.ts')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

/** The bar the detector will actually use, given a calibrated sensitivity. */
const barFor = (floor, sensitivity) => Math.max(
  MIN_SPEECH_LEVEL,
  floor * (1 + (RATIO_QUIET - 1) * CONTINUOUS_STRICTNESS * sensitivity),
)

const ROOMS = [
  ['a quiet room, ordinary voice', 0.02, 0.11],
  ['a very quiet room, ordinary voice', 0.005, 0.10],
  ['a room with a fan, ordinary voice', 0.035, 0.13],
  ['a loud room, raised voice', 0.06, 0.20],
  ['sitting close, speaking softly', 0.01, 0.045],
]

console.log('THE BAR LANDS BETWEEN THE ROOM AND THE VOICE')
for (const [label, floor, peak] of ROOMS) {
  const s = sensitivityFor(floor, peak)
  const bar = barFor(floor, s)
  // Above the room it measured, or the room triggers commands.
  check(`${label}: the bar clears the room`, bar > floor * 1.2,
    `room ${floor} · bar ${bar.toFixed(4)} · sensitivity ${s}`)
  // And under the voice it measured, or nothing ever triggers. This is the half
  // that was failing for Brae: the preset bar sat above his speech.
  check(`${label}: and sits under the voice`, bar < peak,
    `voice ${peak} · bar ${bar.toFixed(4)}`)
}

console.log('\nIT IS A MEASUREMENT, NOT A PRESET')
const quiet = sensitivityFor(0.005, 0.10)
const noisy = sensitivityFor(0.05, 0.10)
check('a quieter room gets a stricter number than a noisy one', quiet > noisy,
  `${quiet} vs ${noisy}`)
check('and neither is one of the four presets by accident',
  ![0.7, 1, 1.5, 2.2].includes(quiet) || ![0.7, 1, 1.5, 2.2].includes(noisy),
  `${quiet}, ${noisy}`)
check('the bar sits about a third of the way up, as claimed',
  Math.abs((barFor(0.02, sensitivityFor(0.02, 0.11)) - 0.02) / (0.11 - 0.02) - AIM) < 0.02,
  `aim ${AIM}`)

console.log('\nNONSENSE IN, SOMETHING SAFE OUT')
check('no measurement at all falls back to the standing setting',
  sensitivityFor(0, 0) === 1)
check('a voice quieter than the room does not produce a negative bar',
  sensitivityFor(0.08, 0.02) === 1, String(sensitivityFor(0.08, 0.02)))
check('an impossibly clean room is clamped',
  sensitivityFor(0.0001, 0.2) === SENSITIVITY_MAX, String(sensitivityFor(0.0001, 0.2)))
check('and an impossibly loud one too',
  sensitivityFor(0.09, 0.1) === SENSITIVITY_MIN, String(sensitivityFor(0.09, 0.1)))

console.log(failures ? `\n${failures} failing` : '\nthe bar is set from the room it is in')
process.exit(failures ? 1 : 0)
