#!/usr/bin/env node
// "Except" is a request, not a decoration.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-except.test.mjs
//
// The record, 20:36: "Move everything forward by 8 bars. So move it all right
// by 8 bars except for pad intro." → move_clips(by: 8 bars) → "Moved all 35
// clips." The one clip he asked to leave went with the rest. move_clips had no
// way to say "except", so the model dropped it and did the nearest thing,
// confidently — the same shape as the reverb that became a low-pass.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')

const PROJECT = {
  id: 'p', name: 'T', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8,
  tracks: [
    { id: 't1', name: 'Pad', volume: 0.8, effects: [], instrument: { type: 'synth', params: {} } },
    { id: 't2', name: 'Drums', volume: 0.8, effects: [], instrument: { type: 'drum', params: {} } },
  ],
  arrangementClips: [
    { id: 'c1', trackId: 't1', kind: 'midi', name: 'Pad intro', startBeat: 0, durationBeats: 16, notes: [] },
    { id: 'c2', trackId: 't1', kind: 'midi', name: 'Pad verse', startBeat: 16, durationBeats: 16, notes: [] },
    { id: 'c3', trackId: 't2', kind: 'midi', name: 'Drums 1', startBeat: 0, durationBeats: 16, notes: [] },
  ],
  automationLanes: [], returnTracks: [], clipEffects: [],
}
const moves = plan => plan.actions.filter(a => a.type === 'MOVE_CLIP').map(a => a.clipId).sort()

// ── Brae's sentence ────────────────────────────────────────────────────────
{
  const plan = planVoiceCall({ name: 'move_clips', input: { by: { bars: 8 }, except: ['Pad intro'] } }, PROJECT)
  check('everything moves except the clip named', moves(plan).join(',') === 'c2,c3', moves(plan).join(','))
  check('and the read-back proves it was heard',
    /leaving Pad intro where it was/i.test(plan.say), plan.say)
}

// ── a track can be spared too ──────────────────────────────────────────────
{
  const plan = planVoiceCall({ name: 'move_clips', input: { by: { bars: 8 }, except: ['Drums'] } }, PROJECT)
  check('naming a track spares every clip on it', moves(plan).join(',') === 'c1,c2', moves(plan).join(','))
}

// ── ⚠️ an exception that names nothing is a refusal ────────────────────────
//
// If "pad intro" resolved to nothing and everything moved anyway, that is
// precisely the outcome the sentence forbade — and it would read back as
// success.
{
  const plan = planVoiceCall({ name: 'move_clips', input: { by: { bars: 8 }, except: ['the flugelhorn'] } }, PROJECT)
  check('an exception that matches nothing stops the move',
    !!plan.problem && !plan.actions.length, plan.problem ?? 'moved anyway')
}

// ── and without an exception, nothing changed ──────────────────────────────
{
  const plan = planVoiceCall({ name: 'move_clips', input: { by: { bars: 8 } } }, PROJECT)
  check('a plain move still moves everything', moves(plan).join(',') === 'c1,c2,c3')
  check('and still says "all"', /all 3 clips/.test(plan.say), plan.say)
}

console.log(failures ? `\n${failures} failing` : '\nexcept means except')
assert.equal(failures, 0)
