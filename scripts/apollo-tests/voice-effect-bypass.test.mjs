#!/usr/bin/env node
// A switched-off effect must never be reported as a set one.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-effect-bypass.test.mjs
//
// Brae: "I said 'Change reverb to 100% on pad' and it told me that it was 100%
// even though it wasn't."
//
// ⚠️ BOTH ENGINES GATE ON THE SWITCH, NOT THE NUMBER. buildReverb sets the wet
// gain to `params.enabled ? params.wet : 0`, and the Helios translation passes
// `enabled !== false` through as the unit's on flag. So a bypassed reverb keeps
// storing wet: 1 while the track is bone dry — and the no-op guard, which reads
// the stored number, answered "already at 100%, so nothing changed".
//
// That guard was added to stop exactly this shape of lie one level up. Reading
// a number that reaches no audio is the same failure: both of Brae's statements
// were true, of different things.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')

const projectWith = params => ({
  id: 'p', name: 'T', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8,
  tracks: [{
    id: 't1', name: 'Pad', instrument: { type: 'synth', params: {} }, volume: 0.8,
    effects: [{ id: 'e1', type: 'reverb', params }],
  }],
  arrangementClips: [],
})

const setReverb = project =>
  planVoiceCall({ name: 'set_effect', input: { target: 'pad', effect: 'reverb', amount: '100' } }, project)

const patchOf = plan => plan.actions?.find(a => a.type === 'UPDATE_EFFECT')?.patch?.params

// ── Brae's case: stored 100%, switched off, and inaudible ──────────────────
{
  const plan = setReverb(projectWith({ enabled: false, wet: 1, decay: 2, preDelay: 0.02 }))
  const p = patchOf(plan)
  check('a bypassed reverb is not reported as "already at 100%"',
    !/already at/i.test(plan.say ?? ''), JSON.stringify(plan.say))
  check('it is switched back on', p?.enabled === true, JSON.stringify(p))
  check('and the say-line tells you that is what happened',
    /switched off/i.test(plan.say ?? ''), JSON.stringify(plan.say))
}

// ── the guard it must not break: genuinely already there ───────────────────
//
// This is the failure the no-op guard was written for. A fix that answered
// "turned it on" here would trade one wrong report for another.
{
  const plan = setReverb(projectWith({ enabled: true, wet: 1, decay: 2, preDelay: 0.02 }))
  // A refusal speaks through `problem`, not `say`.
  check('a running reverb already at 100% still says nothing changed',
    /already at 100%/i.test(plan.problem ?? '') && !patchOf(plan), JSON.stringify(plan.problem))
}

// ── and the ordinary edit still works ──────────────────────────────────────
{
  const plan = setReverb(projectWith({ enabled: true, wet: 0.25, decay: 2, preDelay: 0.02 }))
  const p = patchOf(plan)
  check('a running reverb at 25% is set to 100%', p?.wet === 1 && p?.enabled !== false, JSON.stringify(p))
  check('and it is not described as having been switched off',
    !/switched off/i.test(plan.say ?? ''), JSON.stringify(plan.say))
}

console.log(failures ? `\n${failures} failing` : '\nwhat it says is what you can hear')
assert.equal(failures, 0)
