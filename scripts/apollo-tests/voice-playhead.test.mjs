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
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { planVoiceCall, notAMove, automatableName } = await importTs('lib/voice/execute-music.ts')

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

// ── ⚠️ and the wrong parameter, drawn perfectly ────────────────────────────
//
// Brae, after the first fix: "It didn't change the reverb, named 'VERB Wet' but
// instead created a lowpass cutoff that did the shape that I wanted. This was
// close but not quite it."
//
// The shape was right, which is what made it convincing. The parameter read
// `str(i.parameter || 'lowpass')`, and the branch that handled filters caught
// everything it did not recognise — so any name the enum did not list came out
// as a low-pass, confidently, on the wrong thing.
{
  check('the lane\'s own label is understood', automatableName('VERB Wet') === 'reverb')
  check('and the words people say for it',
    ['reverb', 'reverb wet', 'verb', 'wet'].every(x => automatableName(x) === 'reverb'),
    ['reverb', 'reverb wet', 'verb', 'wet'].map(x => `${x}=${automatableName(x)}`).join(' '))
  check('delay is not reverb', automatableName('delay wet') === 'delay')
  check('drive answers to saturation and distortion',
    ['drive', 'saturation', 'distortion'].every(x => automatableName(x) === 'drive'))
  check('a filter is still a filter',
    automatableName('lowpass') === 'lowpass' && automatableName('cutoff') === 'lowpass'
    && automatableName('high pass') === 'highpass')
  check('volume answers to level and gain',
    ['volume', 'level', 'gain'].every(x => automatableName(x) === 'volume'))

  // ⚠️ THE WHOLE POINT: an unknown name is a question, never a filter.
  check('a name nobody knows is null, not a low-pass',
    automatableName('wobbliness') === null && automatableName('') === null)

  const lost = planVoiceCall({
    name: 'automate_parameter',
    input: { target: 'Pad 1', parameter: 'wobbliness', from: 100, to: 20 },
  }, PROJECT)
  check('and the planner asks instead of drawing one',
    !lost.actions.length && /don't know how to automate/i.test(lost.problem ?? ''), lost.problem)
  check('listing what it can do', /reverb/.test(lost.problem ?? ''))

  const unsaid = planVoiceCall({
    name: 'automate_parameter', input: { target: 'Pad 1', from: 100, to: 20 },
  }, PROJECT)
  check('a missing parameter is asked about, not defaulted to a filter',
    !unsaid.actions.length && /which one/i.test(unsaid.problem ?? ''), unsaid.problem)

  // And the label the lane actually shows reaches the reverb.
  const byLabel = planVoiceCall({
    name: 'automate_parameter',
    input: { target: 'Pad 1', parameter: 'VERB Wet', from: 100, to: 20 },
  }, PROJECT)
  check('"VERB Wet" automates the reverb that is already there',
    byLabel.actions.find(a => a.type === 'ADD_AUTOMATION_LANE')?.lane.parameter === 'fx:e1:wet',
    byLabel.problem ?? '')
}

// ── ⚠️ the command that arrived in two halves ──────────────────────────────
//
// Brae: "When I was speaking to it, it moved me to bar 100, but when I typed the
// same thing that it heard it created the right thing... It asked which track
// and I told it before it did this."
//
// That is why speaking failed where typing worked. A command spread over two
// turns puts the INTENT in the first sentence and the ANSWER in the second — so
// the sentence being judged when the move was emitted was just "the pad", with
// no edit words in it and nothing to refuse. Typed in one go, the same request
// was caught. The exchange is the unit, not the utterance.
{
  check('the answer to a question, alone, looks innocent',
    notAMove('the pad') === null)
  // ...and joined to what it was answering, it does not.
  check('but the exchange it belongs to is still an edit',
    /rather than a request to move/i.test(
      notAMove('change the reverb to 100 percent then 20 percent the pad') ?? ''))

  const ui = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('so an answer continues the sentence rather than replacing it',
    /askingRef\.current \? \[\.\.\.saidRef\.current, text\]/.test(ui))
  check('and the planner is given the whole exchange',
    /said: saidRef\.current\.join\(' '\)/.test(ui))
}

// ── ⚠️ an Apollo reverb is still the reverb on this track ──────────────────
//
// Brae: "it created the right thing but as a different reverb instead of
// changing the existing one."
{
  // Every Apollo device is stored as type 'helios' and says what it really is
  // in params.unit.type. Matching on e.type alone made a track whose reverb
  // came from Apollo look like a track with none.
  const apollo = {
    ...PROJECT,
    tracks: [{
      ...PROJECT.tracks[0],
      effects: [{ id: 'h1', type: 'helios', params: { unit: { type: 'reverb' }, mix: 0.3 } }],
    }],
  }
  const plan = planVoiceCall({
    name: 'automate_parameter',
    input: { target: 'Pad 1', parameter: 'reverb', from: 100, to: 20 },
  }, apollo)

  check('no second reverb is added beside the Apollo one',
    !plan.actions.some(a => a.type === 'ADD_EFFECT'),
    JSON.stringify(plan.actions.filter(a => a.type === 'ADD_EFFECT')))
  // ⚠️ An Apollo unit's amount is its MIX. Writing fx:<id>:wet would draw a
  // lane onto a parameter it does not have — it would look right and do
  // nothing, which is the quietest failure available here.
  check('and it is automated by its mix, the parameter it actually has',
    plan.actions.find(a => a.type === 'ADD_AUTOMATION_LANE')?.lane.parameter === 'fx:h1:mix',
    plan.actions.find(a => a.type === 'ADD_AUTOMATION_LANE')?.lane.parameter)

  // A plain reverb still uses its own name.
  check('a plain reverb is still automated by its wet',
    planVoiceCall({
      name: 'automate_parameter',
      input: { target: 'Pad 1', parameter: 'reverb', from: 100, to: 20 },
    }, PROJECT).actions.find(a => a.type === 'ADD_AUTOMATION_LANE')?.lane.parameter === 'fx:e1:wet')
}

console.log(failures ? `\n${failures} failing` : '\na bar is where, not go there')
assert.equal(failures, 0)
