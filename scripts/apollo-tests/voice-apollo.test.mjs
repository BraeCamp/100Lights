#!/usr/bin/env node
// Apollo's own dials, reached by voice.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-apollo.test.mjs
//
// Brae: "Voice commands should access Apollo features as well. Do we have a
// system for that?"
//
// The system is that there is ONE command for 166 parameters, driven off the
// registry the synth itself reads. So the things worth pinning are not "does
// this dial work" one at a time — it is whether the bridge between what people
// say and what the registry holds stays honest:
//
//   every registered parameter is reachable by SOME spoken phrase
//   a value said in Hertz lands on the frequency that was said
//   "halfway" is halfway to the EAR on a dial that is logarithmic
//   a dial that exists in five places ASKS instead of guessing
//   and the instrument command no longer turns Apollo away

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const S = await importTs('lib/apollo/spoken-params.ts')
const { PARAMS, initPatch } = await importTs('lib/apollo/patch.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const PROJECT = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8, swing: 0,
  tracks: [
    { id: 'tp', name: 'Pad', instrument: { type: 'apollo', params: initPatch() }, effects: [], volume: 0.8 },
    { id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} }, effects: [], volume: 0.8 },
  ],
  arrangementClips: [],
}
const patchAfter = plan => plan.actions?.[0]?.instrument?.params
const run = (name, input) => planVoiceCall({ name, input }, PROJECT)

// ── The bridge covers the registry ─────────────────────────────────────────
//
// ⚠️ The failure this guards against is silent. A parameter added to PARAMS with
// no spoken name is not an error anywhere — it simply cannot be said, and
// nobody finds out until someone tries.
{
  check(`all ${PARAMS.length} registered parameters have a spoken name`,
    S.unspokenParams().length === 0, S.unspokenParams().slice(0, 5).join(', '))
  check('and every spoken name belongs to a real parameter',
    S.unmatchedDials().length === 0, S.unmatchedDials().join(', '))
}

// ── A frequency means that frequency ───────────────────────────────────────
//
// ⚠️ Apollo stores cutoff as 0..1, not Hertz. Writing a spoken 800 straight into
// that field would clamp to 1 — the filter wide open, which is the loudest
// possible wrong answer to a request to close it.
{
  const plan = run('set_apollo_param', { target: 'pad', parameter: 'cutoff', value: 800 })
  const norm = patchAfter(plan)?.filters?.[0]?.cutoff
  check('"cutoff to 800 hertz" lands on 800 Hz',
    Math.abs(S.cutoffHz(norm) - 800) < 5, `${Math.round(S.cutoffHz(norm))} Hz`)
  check('and says so in Hertz, not as a fraction', /Hz/.test(plan.say), plan.say)

  // A number small enough to be a percentage is read as one, because that is
  // also a thing people say and 8 Hz is not.
  const pct = run('set_apollo_param', { target: 'pad', parameter: 'cutoff', value: 25 })
  check('but "cutoff to 25" is a quarter open, not 25 Hz',
    Math.abs(patchAfter(pct)?.filters?.[0]?.cutoff - 0.25) < 1e-9,
    String(patchAfter(pct)?.filters?.[0]?.cutoff))
}

// ── Halfway means halfway to the ear ───────────────────────────────────────
{
  const plan = run('set_apollo_param', { target: 'pad', parameter: 'grain density on osc 1', percent: 50 })
  const d = patchAfter(plan)?.oscs?.[0]?.gran?.density
  // Linear halfway on 0.5..200 is 100 grains a second — the top of the useful
  // range, not the middle of it. Logarithmic halfway is ten.
  check('"grain density halfway" is a ratio, not a midpoint', d > 5 && d < 15, String(+d.toFixed(2)))

  const up = run('set_apollo_param', { target: 'pad', parameter: 'grain density on osc 1', direction: 'more' })
  const before = initPatch().oscs[0].gran.density
  const after = patchAfter(up)?.oscs?.[0]?.gran?.density
  check('and "more" moves it by a ratio too', after / before > 1.3, `${before} → ${+after.toFixed(1)}`)
}

// ── Refusing in the right two ways ─────────────────────────────────────────
{
  // ⚠️ Five things are called "level". Picking one would be wrong four times
  // out of five, and all five sound different.
  const ask = run('set_apollo_param', { target: 'pad', parameter: 'set the level', percent: 50 })
  check('a dial that exists five times asks which one',
    /several/i.test(ask.problem ?? '') && /sub/.test(ask.problem ?? ''), ask.problem ?? ask.say)

  const unknown = run('set_apollo_param', { target: 'pad', parameter: 'the wobble', value: 5 })
  check('and an unknown dial says it does not know it',
    /don't know/i.test(unknown.problem ?? ''), unknown.problem ?? unknown.say)

  const wrongInst = run('set_apollo_param', { target: 'drums', parameter: 'cutoff', value: 500 })
  check('a non-Apollo track says why and what would fix it',
    /drum kit/.test(wrongInst.problem ?? '') && /Apollo instrument/.test(wrongInst.problem ?? ''),
    wrongInst.problem ?? '')
}

// ── Naming the module it moved ─────────────────────────────────────────────
//
// The defaults (filter 1, envelope 1, oscillator 1) are the ones people mean,
// but a default that is never spoken aloud is a default nobody can correct.
{
  const plan = run('set_apollo_param', { target: 'pad', parameter: 'resonance', percent: 60 })
  check('an assumed module is named in the read-back', /filter 1/.test(plan.say), plan.say)
  const two = run('set_apollo_param', { target: 'pad', parameter: 'filter 2 resonance', percent: 60 })
  check('and a named one is honoured',
    patchAfter(two)?.filters?.[1]?.res > 0.5 && patchAfter(two)?.filters?.[0]?.res < 0.5, two.say)

  // ⚠️ The panel prints letters and the registry counts from one. "Osc A" and
  // "oscillator 1" have to be the same oscillator or the read-back lies.
  const a = run('set_apollo_param', { target: 'pad', parameter: 'osc A detune', value: 30 })
  const one = run('set_apollo_param', { target: 'pad', parameter: 'oscillator 1 detune', value: 30 })
  check('osc A and oscillator 1 are the same oscillator',
    patchAfter(a)?.oscs?.[0]?.detune === patchAfter(one)?.oscs?.[0]?.detune
    && Math.abs(patchAfter(a)?.oscs?.[0]?.detune - 0.3) < 1e-9,
    String(patchAfter(a)?.oscs?.[0]?.detune))
}

// ── set_sound stopped turning Apollo away ──────────────────────────────────
//
// ⚠️ THE BUG THIS FOUND. The one command described as "the instrument itself"
// accepted poly, wavetable and fm — and refused Apollo, the instrument this app
// is built around. "Open the filter on the pad" failed on every Apollo track.
{
  const plan = run('set_sound', { target: 'pad', parameter: 'cutoff', direction: 'more' })
  check('"open the filter" works on an Apollo track',
    !plan.problem && patchAfter(plan)?.filters?.[0]?.cutoff > initPatch().filters[0].cutoff,
    plan.problem ?? plan.say)

  const atk = run('set_sound', { target: 'pad', parameter: 'attack', value: 0.5 })
  check('and so does a slower attack',
    Math.abs(patchAfter(atk)?.envs?.[0]?.attack - 0.5) < 1e-9, atk.problem ?? atk.say)

  // ⚠️ LFO depth is the honest exception: in Apollo it is the amount on a matrix
  // route, not a dial on the LFO. Writing it somewhere plausible would report
  // success and change nothing.
  const depth = run('set_sound', { target: 'pad', parameter: 'lfo depth', value: 50 })
  check('LFO depth explains that it lives in the matrix',
    /modulation route/.test(depth.problem ?? ''), depth.problem ?? depth.say)
}

// ── Which filter model ─────────────────────────────────────────────────────
{
  const plan = run('set_apollo_filter', { target: 'pad', type: 'give it a ladder filter' })
  check('a ladder filter is a ladder', patchAfter(plan)?.filters?.[0]?.type === 'ladder24', plan.say)
  // ⚠️ Choosing a filter and hearing one should not be two commands.
  check('and it is switched on', patchAfter(plan)?.filters?.[0]?.enabled === true)

  const slope = run('set_apollo_filter', { target: 'pad', type: '24 db low pass' })
  check('a slope that was said is honoured', patchAfter(slope)?.filters?.[0]?.type === 'lp24', slope.say)

  const comb = run('set_apollo_filter', { target: 'pad', type: 'comb filter', filter: 2 })
  check('and filter 2 is reachable', patchAfter(comb)?.filters?.[1]?.type === 'combPlus', comb.say)

  const nope = run('set_apollo_filter', { target: 'pad', type: 'a squelchy one' })
  check('an unknown model lists real ones', /ladder/.test(nope.problem ?? ''), nope.problem ?? '')
}

// ── And it can be said out loud, not only called ───────────────────────────
//
// A tool the local interpreter cannot read is dropped silently in a held-open
// session, so reachability by SENTENCE is the part that matters.
{
  const ctx = { tracks: PROJECT.tracks, tempo: 120, clips: [] }
  const said = [
    ['more grain density on the pad', 'set_apollo_param'],
    ['wavetable position halfway on the pad', 'set_apollo_param'],
    ['macro 2 to 70 on the pad', 'set_apollo_param'],
    ['give the pad a ladder filter', 'set_apollo_filter'],
    ['more cutoff on the pad', 'set_sound'],
  ]
  const wrong = []
  for (const [line, want] of said) {
    const got = interpret(line, ctx).calls[0]
    if (got?.name !== want) wrong.push(`"${line}" → ${got?.name ?? 'nothing'} (wanted ${want})`)
  }
  check('the sentences reach the right command', wrong.length === 0, wrong.join(' | '))
}

console.log(failures ? `\n${failures} failing` : '\nApollo answers to its own names')
assert.equal(failures, 0)
