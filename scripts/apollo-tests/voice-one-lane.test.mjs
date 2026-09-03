#!/usr/bin/env node
// One reverb, one lane, however many times it is asked about.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-one-lane.test.mjs
//
// Brae: "Instead of changing the reverb it created two new reverbs within the
// same automation lane. Can we fix it/rewire so that it changes the existing
// one instead of creating new ones?"
//
// ⚠️ TWO FAULTS MET, AGAIN. "100% here and 20% there" arrives as TWO calls in
// one batch. Each built its own lane — and withCreated, which lets a later call
// see what an earlier one made, carried forward tracks and clips and NOTHING
// ELSE. So the second call looked for a reverb, could not see the one the
// first had just added, and added its own. Two reverbs, two lanes, one row.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { planVoiceCalls, planVoiceCall } = await importTs('lib/voice/execute-music.ts')

const song = (effects) => ({
  id: 'p', name: 'T', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8,
  tracks: [{ id: 't1', name: 'Pad', volume: 0.8, instrument: { type: 'synth', params: {} }, effects }],
  arrangementClips: [{ id: 'c1', trackId: 't1', kind: 'midi', name: 'Pad 1', startBeat: 0, durationBeats: 64, notes: [] }],
  automationLanes: [], returnTracks: [], clipEffects: [],
})

const twoCalls = [
  { name: 'automate_parameter', input: { target: 'Pad 1', parameter: 'reverb', from: 100, to: 100, start: { bar: 1 }, length: { bars: 4 } } },
  { name: 'automate_parameter', input: { target: 'Pad 1', parameter: 'reverb', from: 100, to: 20, start: { bar: 5 }, length: { bars: 4 } } },
]
const count = (plan, type) => plan.actions.filter(a => a.type === type).length

// ── Brae's case: a track with NO reverb, asked twice in one breath ─────────
{
  const plan = planVoiceCalls(twoCalls, song([]))
  check('the batch runs', !plan.problem, plan.problem ?? '')
  check('exactly ONE reverb is added', count(plan, 'ADD_EFFECT') === 1, `${count(plan, 'ADD_EFFECT')} added`)
  check('and exactly ONE lane', count(plan, 'ADD_AUTOMATION_LANE') === 1, `${count(plan, 'ADD_AUTOMATION_LANE')} lanes`)
  check('with both moves as points on it', count(plan, 'ADD_AUTOMATION_POINT') === 4, `${count(plan, 'ADD_AUTOMATION_POINT')} points`)

  const laneIds = new Set(plan.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT').map(a => a.laneId))
  check('and every point lands on that same lane', laneIds.size === 1, `${laneIds.size} lane ids`)
  const effectId = plan.actions.find(a => a.type === 'ADD_EFFECT')?.effect.id
  const lane = plan.actions.find(a => a.type === 'ADD_AUTOMATION_LANE')?.lane
  check('which drives the reverb that was added', lane?.parameter === `fx:${effectId}:wet`, lane?.parameter)
}

// ── a track that already HAS a reverb ──────────────────────────────────────
{
  const plan = planVoiceCalls(twoCalls, song([{ id: 'e1', type: 'reverb', params: { enabled: true, wet: 0.3, decay: 2, preDelay: 0.02 } }]))
  check('no reverb is added beside the existing one', count(plan, 'ADD_EFFECT') === 0)
  check('one lane, on the existing reverb',
    count(plan, 'ADD_AUTOMATION_LANE') === 1
    && plan.actions.find(a => a.type === 'ADD_AUTOMATION_LANE')?.lane.parameter === 'fx:e1:wet')
}

// ── asked again later, against a song that already has the lane ────────────
//
// A shape drawn by voice has to be idempotent: people ask for the same move
// twice while refining it, and the second ask must land on the first lane.
{
  const withLane = {
    ...song([{ id: 'e1', type: 'reverb', params: { enabled: true, wet: 0.3, decay: 2, preDelay: 0.02 } }]),
    automationLanes: [{ id: 'L1', trackId: 't1', parameter: 'fx:e1:wet', label: 'Reverb', min: 0, max: 1, defaultValue: 0.3, points: [], expanded: true }],
  }
  const plan = planVoiceCall(twoCalls[1], withLane)
  check('an existing lane is reused rather than duplicated', count(plan, 'ADD_AUTOMATION_LANE') === 0)
  check('and the points go onto it',
    plan.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT').every(a => a.laneId === 'L1'))
}

console.log(failures ? `\n${failures} failing` : '\none reverb, one lane')
assert.equal(failures, 0)
