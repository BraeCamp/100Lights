#!/usr/bin/env node
// A filter sweep has to land somewhere you can hear.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-sweep.test.mjs
//
// Brae: "the lowpass cutoff made the pad stop playing audio. Do we know the
// issue here?"
//
// We did once it was looked at, and it was a unit mismatch of the most ordinary
// kind. The automation lane was declared min 0 / max 1 and its points were the
// spoken fractions — 1.0 down to 0.2 — while the engine passes an automation
// value to the effect UNCHANGED:
//
//     if (key === 'frequency') filter.frequency.value = value as number
//
// So "sweep down to 20%" set the cutoff to 0.2 Hz. A low-pass at a fifth of a
// Hertz removes the entire audible spectrum, and since the final point holds
// for the rest of the song, the track never came back.
//
// Nothing caught it because no other code path creates a frequency lane: the
// track's automation menu offers volume, pan, effect wet and Apollo macros, all
// of which genuinely are 0–1. This command invented the one parameter whose
// units are different, and inherited the range that suited all the others.
//
// The assertions are therefore about UNITS, which is the class of bug, not
// about the specific numbers.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'
import { makeTrack, makeClip } from '../lib/daw-fixture.mjs'

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { FX_FIELDS } = await importTs('lib/roll-fx.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const track = makeTrack({ name: 'Pad' })
const PROJECT = {
  id: 'p', name: 'S', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [track],
  arrangementClips: [makeClip({ trackId: track.id, name: 'Pad', startBeat: 0, durationBeats: 16 })],
  scenes: [], sessionGrid: {}, loopStart: 0, loopEnd: 16, loopEnabled: false, masterVolume: 1,
  automationLanes: [], clipEffects: [], returnTracks: [], takeLanes: [],
  crossfaderValue: 0.5, waveformZoom: 1, swing: 0, cueMarkers: [],
}

const sweep = (from, to, parameter = 'lowpass') => planVoiceCall(
  { name: 'automate_parameter', input: { target: 'Pad', parameter, from, to } },
  PROJECT,
)

// ── The case he hit ─────────────────────────────────────────────────────────
{
  const plan = sweep('100%', '20%')
  check('the sweep plans without complaint', !plan.problem, plan.problem ?? '')

  const lane = plan.actions.find(a => a.type === 'ADD_AUTOMATION_LANE')?.lane
  const points = plan.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT').map(a => a.point)
  check('it makes one lane and two points', !!lane && points.length === 2)

  // The bug, stated as the thing that is audible: a cutoff below the bottom of
  // human hearing silences the track.
  const lowest = points.length ? Math.min(...points.map(p => p.value)) : NaN
  check('the quietest end of the sweep is still audible', points.length === 2 && lowest >= 20,
    `${lowest} Hz — under 20 Hz is silence, and 0.2 Hz is what it used to be`)
  check('and the loud end is genuinely open',
    points.length === 2 && Math.max(...points.map(p => p.value)) >= 10_000,
    points.length ? `${Math.max(...points.map(p => p.value))} Hz` : 'no points at all')

  // A lane whose range says 0–1 is what made the fractions look plausible.
  check('the lane advertises the range its values are actually in',
    lane.min >= 20 && lane.max > 1000, `min ${lane.min} max ${lane.max}`)
  check('every point sits inside that range',
    points.every(p => p.value >= lane.min && p.value <= lane.max),
    points.map(p => p.value).join(', '))

  // And the read-back has to be in the same unit, or it cannot contradict a
  // wrong value out loud.
  check('the read-back says Hertz, not percent',
    /Hz|kHz/.test(plan.say) && !/%/.test(plan.say), plan.say)
}

// ── Direction is preserved ──────────────────────────────────────────────────
{
  const down = sweep('100%', '20%')
  const dp = down.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT').map(a => a.point)
  check('a descending sweep descends', dp[0].value > dp[1].value, `${dp[0].value} → ${dp[1].value}`)

  const up = sweep('20%', '100%')
  const up2 = up.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT').map(a => a.point)
  check('and an ascending one ascends', up2[0].value < up2[1].value, `${up2[0].value} → ${up2[1].value}`)
}

// ── The curve is the app's, not a second opinion ───────────────────────────
//
// If these drift apart, "half open" means one thing to the voice control and
// another to the piano roll, and the difference is audible the first time
// somebody compares them.
{
  const lp = FX_FIELDS.find(f => f.key === 'filterHz')
  const mid = sweep('50%', '50%').actions.find(a => a.type === 'ADD_AUTOMATION_POINT').point.value
  check('half-open matches the piano roll to within a hair',
    Math.abs(mid - lp.fromNorm(0.5)) <= 2, `voice ${mid} Hz vs roll-fx ${lp.fromNorm(0.5)} Hz`)
  check('fully open matches too',
    Math.abs(sweep('100%', '100%').actions.find(a => a.type === 'ADD_AUTOMATION_POINT').point.value
      - lp.fromNorm(1)) <= 2)
}

// ── Volume and pan are still fractions ─────────────────────────────────────
//
// The fix must not "helpfully" convert the parameters that were right all
// along: a volume sweep to 20% means 0.2, and turning that into 570 would be
// the same bug pointing the other way.
{
  const v = sweep('100%', '20%', 'volume')
  const vp = v.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT').map(a => a.point)
  check('a volume sweep stays 0–1', vp.every(p => p.value <= 1), vp.map(p => p.value).join(' → '))
  const lane = v.actions.find(a => a.type === 'ADD_AUTOMATION_LANE')?.lane
  check('and its lane still says 0–1', lane.min === 0 && lane.max === 1)
  check('no filter effect is added for a volume sweep',
    !v.actions.some(a => a.type === 'ADD_EFFECT'))
}

console.log(failures ? `\n${failures} failing` : '\na sweep lands in Hertz, and you can hear both ends of it')
assert.equal(failures, 0)
