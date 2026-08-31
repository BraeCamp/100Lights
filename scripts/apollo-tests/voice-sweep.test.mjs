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
// The device-chain filter's own declared range - the contract the voice
// planner has to write lanes against.
const { LOWPASS_HZ } = await importTs('lib/daw-effect-params.ts')

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

  // ⚠️ This test was written against the FIRST fix, which put Hertz in the
  // points, and Brae rejected that one too: "it's consistent through the track
  // item instead of being the graph that I need it to be." A point is a
  // POSITION on the graph, 0 to 1; the lane's min/max carry the unit. Hertz in
  // the points means the drawn shape is no longer the shape you drew.
  //
  // So the assertion moves to where the invariant actually lives. The thing
  // that must never happen is a sweep that SILENCES the track, and that is a
  // fact about the cutoff the engine ends up with — position resolved through
  // the lane — not about the number stored in the point.
  const resolve = (ln, norm) => ln.curve === 'log'
    ? ln.min * Math.pow(ln.max / ln.min, norm)
    : ln.min + norm * (ln.max - ln.min)

  check('the points are positions on the graph, not Hertz',
    points.every(p => p.value >= 0 && p.value <= 1), points.map(p => p.value).join(', '))
  check('the lane carries the Hertz', lane.min >= 20 && lane.max > 1000, `min ${lane.min} max ${lane.max}`)

  const hz = points.map(p => resolve(lane, p.value))
  check('the quietest end of the sweep is still audible', Math.min(...hz) >= 20,
    `${Math.round(Math.min(...hz))} Hz — under 20 Hz is silence, and 0.2 Hz is what it used to be`)
  check('and the loud end is genuinely open', Math.max(...hz) >= 10_000,
    `${Math.round(Math.max(...hz))} Hz`)

  // And the read-back has to be in the same unit, or it cannot contradict a
  // wrong value out loud.
  check('the read-back says Hertz, not percent',
    /Hz|kHz/.test(plan.say) && !/%/.test(plan.say), plan.say)
}

// ── Direction is preserved ──────────────────────────────────────────────────
{
  const down = sweep('100%', '20%')
  const dp = down.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT').map(a => a.point)
  // Direction is a property of the positions now, and still has to survive.
  check('a descending sweep descends', dp[0].value > dp[1].value, `${dp[0].value} → ${dp[1].value}`)

  const up = sweep('20%', '100%')
  const up2 = up.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT').map(a => a.point)
  check('and an ascending one ascends', up2[0].value < up2[1].value, `${up2[0].value} → ${up2[1].value}`)
}

// ── The lane's range is the DEVICE's range ─────────────────────────────────
//
// This block used to compare the voice sweep against the piano roll's own
// low-pass curve, on the grounds that "half open" must mean the same thing in
// both places. That comparison no longer holds, and noticing why matters more
// than the check did.
//
// They are two different controls. roll-fx's `filterHz` is the per-note Sound
// Settings filter and runs logHz(200, 90); the voice sweep automates the
// DEVICE CHAIN filter effect, whose declared automatable range is LOWPASS_HZ
// (60 Hz - 18 kHz). Half open reads 1897 Hz on one and 1039 Hz on the other
// because they are not the same knob, and forcing them to agree would mean
// giving one of them a range that does not match the thing it controls.
//
// What must not drift is the voice planner from the device contract: the lane
// it writes has to declare exactly the range the effect says it accepts, or an
// automation point means one thing to the planner and another to the engine.
{
  const plan = sweep('100%', '20%')
  const lane = plan.actions.find(a => a.type === 'ADD_AUTOMATION_LANE').lane
  check('the lane declares the effect\'s own range',
    lane.min === LOWPASS_HZ.min && lane.max === LOWPASS_HZ.max,
    `lane ${lane.min}-${lane.max} vs device ${LOWPASS_HZ.min}-${LOWPASS_HZ.max}`)
  // A linear taper across 60 Hz to 18 kHz puts everything audible in the bottom
  // tenth of the dial, which is the "opaque low-pass" complaint in another form.
  check('and sweeps it logarithmically, as a filter is heard',
    lane.curve === 'log', String(lane.curve))
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
