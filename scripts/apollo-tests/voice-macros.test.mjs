#!/usr/bin/env node
// A shape you can name, and put anywhere.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-macros.test.mjs
//
// Brae: "at one point I want bass to have descending reverb, ascending low
// pass, and descending volume to keep steady volume over the clip, and later I
// ask to do the same thing over a longer clip so the descend and ascend are
// longer... would it then be able to do that relationship even over a certain
// amount of bars instead of over a clip without changing or adding to the
// macro?"
//
// That question is what this file is mostly about: the SAME macro, run against
// a clip and against a stretch of bars, with nothing changed in between.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { listMacros, findMacro, forgetMacro, toPoints, describeMacro } =
  await importTs('lib/voice/macros.ts')

const PROJECT = {
  id: 'p', name: 'T', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8,
  tracks: [
    { id: 't1', name: 'Bass', volume: 0.8, effects: [], instrument: { type: 'synth', params: {} } },
    { id: 't2', name: 'Pad', volume: 0.8, effects: [], instrument: { type: 'synth', params: {} } },
  ],
  arrangementClips: [
    { id: 'c1', trackId: 't1', kind: 'midi', name: 'Bass 1', startBeat: 0, durationBeats: 16, notes: [] },
    { id: 'c2', trackId: 't2', kind: 'midi', name: 'Pad 1', startBeat: 0, durationBeats: 32, notes: [] },
    { id: 'c3', trackId: 't2', kind: 'midi', name: 'Pad 2', startBeat: 32, durationBeats: 32, notes: [] },
  ],
  automationLanes: [], returnTracks: [], clipEffects: [],
}

const plan = (name, input) => planVoiceCall({ name, input }, PROJECT)

// ── Brae's exact request, defined once ─────────────────────────────────────
{
  for (const m of listMacros()) forgetMacro(m.name)
  const p = plan('define_macro', {
    name: 'steady swell',
    what: 'reverb fades, the low-pass opens and the level settles',
    // ⚠️ ONE SHAPE, THREE DIRECTIONS. Each parameter travels from its own
    // neutral to its own target, so a single falling curve gives descending
    // reverb, an OPENING low-pass (400Hz is dark, the neutral 18k is open) and
    // descending volume — which is the whole of what was asked for.
    fx: { reverbWet: 1, filterHz: 400, gain: 1.4 },
    shape: 'fall',
  })
  check('the shape is saved under a name', /steady swell/i.test(p.say), p.say)
  check('and the studio hands the name back to say again',
    /say .*steady swell/i.test(p.say), p.say)
  const m = findMacro('steady swell')
  check('all three parameters are kept',
    m && m.fx.reverbWet === 1 && m.fx.filterHz === 400 && m.fx.gain === 1.4, JSON.stringify(m?.fx))

  // A name that does not exist would be stored, listed, and quietly do nothing.
  const bad = plan('define_macro', { name: 'nonsense', fx: { wobbliness: 1 }, shape: 'fall' })
  check('an invented parameter is refused, not stored',
    /don't know how to move/i.test(bad.problem ?? ''), bad.problem)
  check('and nothing was saved for it', !findMacro('nonsense'))
}

// ── ⚠️ the same macro, over a clip and over bars ───────────────────────────
{
  const onClip = plan('run_macro', { name: 'steady swell', target: 'Bass 1' })
  const clipAct = onClip.actions.find(a => a.type === 'UPDATE_CLIP')
  check('run on a clip, it becomes motion that belongs to the clip',
    clipAct?.clipId === 'c1' && !!clipAct.patch.fxMotion, JSON.stringify(onClip.problem ?? clipAct))
  check('carrying the same three parameters',
    clipAct?.patch.fxMotion.fx.filterHz === 400)
  // ⚠️ NORMALISED here — a clip's motion is a FRACTION of the clip, which is
  // what makes it stretch when the clip grows instead of ending early.
  check('with its graph in fractions, so it stretches with the clip',
    clipAct?.patch.fxMotion.graph.every(p => p.t >= 0 && p.t <= 1),
    JSON.stringify(clipAct?.patch.fxMotion.graph.map(p => p.t)))

  const onBars = plan('run_macro', { name: 'steady swell', target: 'Bass', from: { bar: 9 }, to: { bar: 25 } })
  const bar = onBars.actions.find(a => a.type === 'ADD_CLIP_EFFECT')
  check('run over a stretch of bars, the SAME macro becomes an effect bar',
    !!bar && bar.effect.trackId === 't1', JSON.stringify(onBars.problem ?? bar?.effect?.trackId))
  check('spanning exactly those bars',
    bar?.effect.startBeat === 32 && bar.effect.durationBeats === 64,
    `${bar?.effect.startBeat} for ${bar?.effect.durationBeats}`)
  // ⚠️ THE TRAP. AutoPoint.t is "beats from effect start" for a bar and a 0..1
  // fraction for clip motion — the same field, two meanings. A normalised graph
  // dropped into a 64-beat bar would squeeze the whole move into the first beat
  // and leave sixty-three flat, and nothing would report an error.
  check('and its graph converted to BEATS, not left as fractions',
    bar?.effect.graph.some(p => p.t > 1) && bar.effect.graph[bar.effect.graph.length - 1].t === 64,
    JSON.stringify(bar?.effect.graph.map(p => p.t)))
  check('the parameters are identical to the clip run',
    JSON.stringify(bar?.effect.fx) === JSON.stringify(clipAct?.patch.fxMotion.fx))
}

// ── what it says when it cannot place one ──────────────────────────────────
{
  const many = plan('run_macro', { name: 'steady swell', target: 'Pad' })
  check('a track with several clips asks which, and offers the other way',
    /2 clips/.test(many.problem ?? '') && /bar/.test(many.problem ?? ''), many.problem)

  // ⚠️ Found by this test passing bar positions as plain strings — which is
  // what a model does sometimes. It used to fall through and put the shape on a
  // CLIP, and say so truthfully, having done something nobody asked for.
  const unparsed = plan('run_macro', { name: 'steady swell', target: 'Bass', from: 'bar 9', to: 'bar 25' })
  check('a stretch that did not parse is a question, not a quiet clip edit',
    /could not work out that stretch/i.test(unparsed.problem ?? '') && !unparsed.actions.length,
    unparsed.problem ?? JSON.stringify(unparsed.actions))

  const missing = plan('run_macro', { name: 'a shape nobody made' })
  check('an unknown name lists the ones that exist',
    /steady swell/.test(missing.problem ?? ''), missing.problem)
}

// ── the shapes themselves ──────────────────────────────────────────────────
{
  check('a fall starts full and ends neutral',
    toPoints('fall')[0].v === 1 && toPoints('fall').at(-1).v === 0)
  check('a rise is its reverse',
    toPoints('rise')[0].v === 0 && toPoints('rise').at(-1).v === 1)
  check('an arc comes back',
    toPoints('arc').length === 3 && toPoints('arc')[1].v === 1 && toPoints('arc').at(-1).v === 0)
  check('scaling to a span multiplies the times only',
    toPoints('arc', 8)[1].t === 4 && toPoints('arc', 8)[1].v === 1)

  // The words are what the list shows AND what the assistant is told, so they
  // have to be true of the sound, not of the parameter names.
  check('a falling reverb is described as fading, not as "reverbWet"',
    /less reverb/.test(describeMacro({ reverbWet: 1 }, 'fall')),
    describeMacro({ reverbWet: 1 }, 'fall'))
  check('a falling low-pass is described as brightening',
    /brighter/.test(describeMacro({ filterHz: 400 }, 'fall')),
    describeMacro({ filterHz: 400 }, 'fall'))
}

console.log(failures ? `\n${failures} failing` : '\none shape, any span')
assert.equal(failures, 0)
