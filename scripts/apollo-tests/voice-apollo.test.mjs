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
  // An LFO rate runs 0.01 Hz to 1000 Hz, logarithmically. Linear halfway is
  // 500 Hz — an audio-rate buzz, not the middle of anything anybody wants.
  // Logarithmic halfway is about three.
  const plan = run('set_apollo_param', { target: 'pad', parameter: 'lfo 1 rate', percent: 50 })
  const r = patchAfter(plan)?.lfos?.[0]?.rate
  check('"halfway" on a log dial is a ratio, not a midpoint', r > 1 && r < 10, `${+r.toFixed(2)} Hz`)

  const up = run('set_apollo_param', { target: 'pad', parameter: 'lfo 1 rate', direction: 'more' })
  const before = initPatch().lfos[0].rate
  const after = patchAfter(up)?.lfos?.[0]?.rate
  check('and "more" moves it by a ratio too', after / before > 1.3, `${before} → ${+after.toFixed(2)}`)
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

// ── Nothing reports success while changing nothing you can hear ────────────
//
// ⚠️ THE LARGEST TRAP IN THE SURFACE, and it was live. In a DEFAULT patch 84 of
// the 166 registered parameters sit behind an off switch — including BOTH
// FILTERS — so "cutoff to 800 hertz", the commonest sentence anybody says to a
// synth, wrote 800 Hz into a filter that was not running and said "filter 1
// cutoff: 800 Hz". A refusal would have been better: nothing tells you to look.
{
  const audible = [
    ['filter 1 cutoff', { value: 800 }, p => p.filters[0].enabled],
    ['filter 2 resonance', { percent: 60 }, p => p.filters[1].enabled],
    ['sub level', { percent: 40 }, p => p.sub.enabled],
    ['noise level', { percent: 30 }, p => p.noise.enabled],
    ['oscillator 3 level', { percent: 50 }, p => p.oscs[2].enabled],
    // A rate in Hertz is a request for a free-running LFO. While it is synced
    // to the tempo the rate field is not read at all.
    ['lfo 2 rate', { value: 5 }, p => p.lfos[1].sync === false],
    ['scan rate on osc 1', { value: 2 }, p => p.oscs[0].wt.scan.mode !== 'off'],
  ]
  const silent = []
  for (const [parameter, extra, isAudible] of audible) {
    const plan = run('set_apollo_param', { target: 'pad', parameter, ...extra })
    const patch = patchAfter(plan)
    if (!patch || !isAudible(patch)) silent.push(`${parameter}: ${plan.problem ?? 'set but inaudible'}`)
  }
  check('every dial it sets is one you can hear', silent.length === 0, silent.join(' | '))

  // ⚠️ And the other half of the judgement. Making these audible would be a
  // BIGGER decision than the one asked for — switching an oscillator's engine
  // is a different instrument, not a louder one, and picking a warp mode
  // chooses a sound nobody asked for. Those explain instead.
  const gran = run('set_apollo_param', { target: 'pad', parameter: 'grain density on osc 1', value: 40 })
  check('a granular dial on a wavetable oscillator explains itself',
    /granular engine/.test(gran.problem ?? ''), gran.problem ?? gran.say)
  const warp = run('set_apollo_param', { target: 'pad', parameter: 'warp on osc 1', percent: 50 })
  check('and an amount for a warp that is off names the modes',
    /warp 1 is off/.test(warp.problem ?? '') && /sync/.test(warp.problem ?? ''), warp.problem ?? warp.say)
}

// ── The module number is not the value ─────────────────────────────────────
//
// ⚠️ "Macro 2 to 70" set macro 2 to TWO PERCENT, and "LFO 2 rate to 5 hertz"
// set the rate to 2 Hz — which is the default, so it changed nothing and said
// it had. The first number in "module N dial to V" is the module, every time.
{
  const ctx = { tracks: PROJECT.tracks, tempo: 120, clips: [] }
  const cases = [
    ['macro 2 to 70 on the pad', p => Math.abs(p.macros[1] - 0.7) < 1e-9, 'macro 2 = 70%'],
    ['lfo 2 rate to 5 hertz on the pad', p => p.lfos[1].rate === 5, 'LFO 2 = 5 Hz'],
    ['filter 2 resonance to 40 on the pad', p => Math.abs(p.filters[1].res - 0.4) < 1e-9, 'filter 2 res = 40%'],
    ['osc 2 detune to 20 on the pad', p => Math.abs(p.oscs[1].detune - 0.2) < 1e-9, 'osc 2 detune = 20%'],
  ]
  const wrong = []
  for (const [line, ok, want] of cases) {
    const call = interpret(line, ctx).calls[0]
    const plan = call ? planVoiceCall(call, PROJECT) : null
    const patch = plan?.actions?.[0]?.instrument?.params
    if (!patch || !ok(patch)) wrong.push(`"${line}" -> ${plan?.say ?? plan?.problem ?? 'nothing'} (wanted ${want})`)
  }
  check('the module number is never read as the value', wrong.length === 0, wrong.join(' | '))
}

// ── Sentences that must not become the wrong edit ──────────────────────────
{
  const ctx = { tracks: PROJECT.tracks, tempo: 120, clips: [] }
  const cases = [
    // ⚠️ "Sub level to 40 on the pad" turned the PAD DOWN to 40 percent — a
    // loud, wrong edit to the mix in answer to a question about the synth.
    ['sub level to 40 on the pad', 'set_apollo_param'],
    // ⚠️ And this one switched oscillator 2 ON and never touched the detune,
    // then said so as though it had done what was asked.
    ['osc 2 detune to 20 on the pad', 'set_apollo_param'],
    // Bringing a layer in is still its own command.
    ['add sub to the pad', 'set_apollo_layer'],
    ['turn the pad down', 'set_track'],
    ['pan the pad left', 'set_track'],
    ['more reverb on the pad', 'set_effect'],
    // ⚠️ A SWEEP MOVES OVER TIME. "Open the filter" with no duration is a
    // setting; it was becoming an 8-beat automation lane plus a new effect,
    // and on a track with no clip, an error instead of an answer.
    ['open the filter on the pad', 'set_sound'],
    ['open the filter on the pad over 8 bars', 'automate_parameter'],
    // A filter model on a track that is not Apollo is a filter DEVICE.
    ['give the drums a ladder filter', 'add_effect'],
    // And a device dial belongs to the device, not the instrument.
    ['filter cutoff to 500 on the drums', 'set_device_param'],
  ]
  const wrong = []
  for (const [line, want] of cases) {
    const got = interpret(line, ctx).calls[0]
    if (got?.name !== want) wrong.push(`"${line}" -> ${got?.name ?? 'nothing'} (wanted ${want})`)
  }
  check('each sentence reaches the command that owns it', wrong.length === 0, wrong.join(' | '))
}

// ── Turning the sub on must not stack one per note ─────────────────────────
//
// Brae: "Audio cutting out again. It isn't slowing down or lagging. Is it the
// computer trying to play every separate note in a piano roll?"
//
// ⚠️ The engine reads an ABSENT sub.ref as 'each' — one sub oscillator per
// voice — and it has to keep doing that, because presets saved before the
// option existed were voiced against per-note subs. But a sub being switched on
// NOW was silent a moment ago, so there is no voicing to preserve, and per-note
// is the wrong default for a piano roll: a triad stacks three subs, the low end
// triples, and the master limiter clamps the whole track. That is the cutting
// out, and the engine's own comment says so.
{
  // An older patch: sub present, never given a reference note.
  const old = initPatch()
  delete old.sub.ref
  const proj = { ...PROJECT, tracks: [{ id: 'to', name: 'Old', instrument: { type: 'apollo', params: old }, effects: [], volume: 0.8 }] }

  const layer = planVoiceCall({ name: 'set_apollo_layer', input: { target: 'old', layer: 'sub' } }, proj)
  const p1 = layer.actions?.[0]?.instrument?.params
  check('adding the sub to an old patch pins it to one note',
    p1?.sub?.enabled === true && p1?.sub?.ref === 'lowest', `enabled=${p1?.sub?.enabled} ref=${p1?.sub?.ref}`)

  const lvl = planVoiceCall({ name: 'set_apollo_param', input: { target: 'old', parameter: 'sub level', percent: 40 } }, proj)
  check('and so does setting its level',
    lvl.actions?.[0]?.instrument?.params?.sub?.ref === 'lowest',
    String(lvl.actions?.[0]?.instrument?.params?.sub?.ref))

  // ⚠️ But an ALREADY-SOUNDING sub is somebody's voicing, and changing what it
  // follows would restage a sound they have already balanced.
  const voiced = initPatch()
  voiced.sub.enabled = true
  delete voiced.sub.ref
  const proj2 = { ...PROJECT, tracks: [{ id: 'tv', name: 'Voiced', instrument: { type: 'apollo', params: voiced }, effects: [], volume: 0.8 }] }
  const more = planVoiceCall({ name: 'set_apollo_param', input: { target: 'voiced', parameter: 'sub level', percent: 60 } }, proj2)
  check('an already-sounding sub keeps the voicing it had',
    more.actions?.[0]?.instrument?.params?.sub?.ref === undefined,
    String(more.actions?.[0]?.instrument?.params?.sub?.ref))
}

console.log(failures ? `\n${failures} failing` : '\nApollo answers to its own names')
assert.equal(failures, 0)
