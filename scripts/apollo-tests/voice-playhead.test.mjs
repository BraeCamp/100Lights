#!/usr/bin/env node
// A bar mentioned inside an edit is not a place to go.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-playhead.test.mjs
//
// Brae: "I told the AI to make reverb on pad 100% then 20% at a different spot
// and it just moved my playhead again. We need to fix this whole playhead
// thing, it keeps doing that instead of anything useful." And then the
// diagnosis, which was right: "I think that when I bring up bars it thinks I'm
// moving the playhead."
//
// ⚠️ TWO FAULTS MET HERE, and only fixing both helps.
//
// automate_parameter could write a filter, a volume and a pan and NOTHING
// ELSE — so "reverb 100% here, 20% there" had no way to be said at all. Given a
// request it could not express, the model reached for the one part of the
// sentence it COULD act on: a bar number. Refusing the move alone would have
// left a studio that does nothing instead of the wrong thing.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { planVoiceCall, notAMove } = await importTs('lib/voice/execute-music.ts')

const PROJECT = {
  id: 'p', name: 'T', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8,
  tracks: [{
    id: 't1', name: 'Pad', volume: 0.8, instrument: { type: 'synth', params: {} },
    effects: [{ id: 'e1', type: 'reverb', params: { enabled: true, wet: 0.25, decay: 2, preDelay: 0.02 } }],
  }],
  arrangementClips: [
    { id: 'c1', trackId: 't1', kind: 'midi', name: 'Pad 1', startBeat: 0, durationBeats: 32, notes: [] },
  ],
  automationLanes: [], returnTracks: [], clipEffects: [],
}

// ── the sentence decides ───────────────────────────────────────────────────
{
  check('a plain move is still a move', notAMove('go to bar 9') === null)
  check('and so is "play from bar 9"', notAMove('play from bar 9') === null)
  check('and a sentence with nothing else in it', notAMove('bar 9') === null)

  // ⚠️ Brae's sentence.
  check('an edit that names a bar is refused',
    /rather than a request to move/i.test(notAMove('make the reverb on pad 100% then 20% at bar 9') ?? ''),
    String(notAMove('make the reverb on pad 100% then 20% at bar 9')))
  check('and the refusal points at what to do instead',
    /automate_parameter/.test(notAMove('make the reverb 20% at bar 9') ?? ''))

  // With nothing to judge, the call is trusted — a typed command or a replayed
  // one has no sentence attached, and refusing those would break them.
  check('an unknown sentence is trusted, not refused', notAMove('') === null && notAMove(undefined) === null)
}

// ── and the planner honours it ─────────────────────────────────────────────
{
  const moved = planVoiceCall(
    { name: 'transport', input: { action: 'locate', at: { bar: 9 } } },
    PROJECT, { said: 'go to bar 9' })
  check('"go to bar 9" still moves the playhead',
    moved.actions.some(a => a.type === 'TRANSPORT'), moved.problem ?? '')

  const notMoved = planVoiceCall(
    { name: 'transport', input: { action: 'locate', at: { bar: 9 } } },
    PROJECT, { said: 'make the reverb on pad 100% then 20% at bar 9' })
  check('the same call from an edit does not',
    !notMoved.actions.length && !!notMoved.problem, JSON.stringify(notMoved.actions))
}

// ── ⚠️ and the thing he actually asked for now exists ──────────────────────
{
  const plan = planVoiceCall({
    name: 'automate_parameter',
    input: { target: 'Pad 1', parameter: 'reverb', from: 100, to: 20, start: { bar: 1 }, length: { bars: 8 } },
  }, PROJECT)

  const lane = plan.actions.find(a => a.type === 'ADD_AUTOMATION_LANE')
  check('reverb can be automated at all now',
    !!lane, plan.problem ?? lane?.lane.label ?? '')
  // Onto the reverb ALREADY on the track — adding a second one would leave the
  // first sitting underneath, audible and unexplained.
  check('onto the reverb the track already has',
    lane?.lane.parameter === 'fx:e1:wet', lane?.lane.parameter)
  check('and no second reverb is added',
    !plan.actions.some(a => a.type === 'ADD_EFFECT'))

  const points = plan.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT')
  check('with a point at each end', points.length === 2, String(points.length))
  check('running from 100% down to 20%',
    points[0]?.point.value === 1 && Math.abs(points[1]?.point.value - 0.2) < 1e-9,
    points.map(p => p.point.value).join(' → '))
  // ⚠️ wet is 0–1, so a percentage maps straight on. A lane declared in the
  // wrong units is the bug that once silenced a pad.
  check('in the unit the parameter actually uses',
    lane?.lane.min === 0 && lane.lane.max === 1 && !lane.lane.curve)

  // A track with no reverb gets one, rather than failing.
  const bare = { ...PROJECT, tracks: [{ ...PROJECT.tracks[0], effects: [] }] }
  const added = planVoiceCall({
    name: 'automate_parameter',
    input: { target: 'Pad 1', parameter: 'reverb', from: 0, to: 100 },
  }, bare)
  check('a track with no reverb gets one to automate',
    added.actions.some(a => a.type === 'ADD_EFFECT'), added.problem ?? '')
}

console.log(failures ? `\n${failures} failing` : '\na bar is where, not go there')
assert.equal(failures, 0)
