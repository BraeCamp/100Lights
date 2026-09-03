#!/usr/bin/env node
// Touching a control overrides its automation lane.
//
//   node --experimental-strip-types scripts/apollo-tests/automation-override.test.mjs
//
// Brae: "When I set reverb on pad to 80% it shows in the device chain menu but
// not on the graph."
//
// ⚠️ AND THE GRAPH WAS STILL DRIVING THE SOUND. The Ableton semantics are
// written on AutomationLane, honoured by the engine (`if (lane.overridden)
// continue`) and drawn in grey by the lane view — but nothing SET the flag
// except the volume fader on the track head. So an effect parameter with a lane
// ignored the number you set: the chain said 80%, the curve went on playing,
// and what you heard was the curve. Same failure as a bypassed effect reporting
// its stored amount — a value shown that reaches no audio.
//
// It belongs in the reducer because there are four ways to change an effect
// parameter — the chain, the popped-out card, the voice assistant, the learned
// cache — and only one of them was ever going to remember on its own.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// daw-state pulls in the Apollo engine, which will not load under the
// strip-types shim, so the RULE is transcribed below and the reducer is checked
// at source for having it. If the two diverge it is because somebody edited the
// reducer, which is exactly when this should fail.
const src = readFileSync('lib/daw-state.ts', 'utf8')
{
  const at = src.indexOf("case 'UPDATE_EFFECT'")
  const seg = src.slice(at, src.indexOf("case 'REORDER_EFFECTS'"))
  check('the reducer overrides lanes on an effect edit',
    /overridden: true/.test(seg) && /startsWith\(prefix\)/.test(seg))
  check('and only for a parameter whose value actually moved',
    /Object\.is\(before\[key\], params\[key\]\)/.test(seg))
  check('and only for a lane that has points',
    /!l\.points\.length/.test(seg))
}

/** The reducer's rule, transcribed. */
const dawReducer = (project, action) => {
  const was = project.tracks.find(t => t.id === action.trackId)
    ?.effects.find(e => e.id === action.effectId)
  const tracks = project.tracks.map(t => t.id !== action.trackId ? t : {
    ...t, effects: t.effects.map(e => e.id === action.effectId ? { ...e, ...action.patch } : e),
  })
  const params = action.patch.params
  const before = was?.params
  if (!params || !project.automationLanes?.length) return { ...project, tracks }
  const prefix = `fx:${action.effectId}:`
  const automationLanes = project.automationLanes.map(l => {
    if (l.overridden || !l.points.length) return l
    if (l.trackId !== action.trackId || !l.parameter.startsWith(prefix)) return l
    const key = l.parameter.slice(prefix.length)
    return before && Object.is(before[key], params[key]) ? l : { ...l, overridden: true }
  })
  return { ...project, tracks, automationLanes }
}

const lane = (id, parameter, points) => ({
  id, trackId: 't1', parameter, label: id, min: 0, max: 1, defaultValue: 0, points, expanded: true,
})

const project = () => ({
  id: 'p', name: 'T', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8,
  tracks: [{
    id: 't1', name: 'Pad', volume: 0.8, pan: 0, effects: [
      { id: 'e1', type: 'reverb', params: { enabled: true, wet: 0.25, decay: 2, preDelay: 0.02 } },
    ],
  }],
  arrangementClips: [],
  automationLanes: [
    lane('wet', 'fx:e1:wet', [{ id: 'a', beat: 0, value: 1 }, { id: 'b', beat: 8, value: 0 }]),
    lane('decay', 'fx:e1:decay', [{ id: 'c', beat: 0, value: 0.5 }]),
    lane('empty', 'fx:e1:preDelay', []),
  ],
})

const setWet = (p, wet) => dawReducer(p, {
  type: 'UPDATE_EFFECT', trackId: 't1', effectId: 'e1',
  patch: { params: { enabled: true, wet, decay: 2, preDelay: 0.02 } },
})
const laneById = (p, id) => p.automationLanes.find(l => l.id === id)

// ── Brae's case ────────────────────────────────────────────────────────────
{
  const after = setWet(project(), 0.8)
  check('setting the wet value overrides the wet lane',
    laneById(after, 'wet').overridden === true)
  check('so the number you set is what plays',
    after.tracks[0].effects[0].params.wet === 0.8)

  // ⚠️ Per PARAMETER, not per device. Reaching for the wet knob must not switch
  // off the curve shaping the decay.
  check('the decay lane keeps driving', !laneById(after, 'decay').overridden)
  check('and the curve itself is never destroyed', laneById(after, 'wet').points.length === 2)
}

// ── what must not override ─────────────────────────────────────────────────
{
  // Re-saving an effect unchanged — which happens whenever any OTHER field of
  // the same params object is edited — must not silently kill the automation.
  const same = setWet(project(), 0.25)
  check('writing the value it already had changes nothing',
    !laneById(same, 'wet').overridden)

  const empty = setWet(project(), 0.8)
  check('a lane with no points is not marked overridden',
    !laneById(empty, 'empty').overridden)

  // A lane already overridden stays as it is, and other tracks are untouched.
  const twice = setWet(setWet(project(), 0.8), 0.5)
  check('overriding twice is stable', laneById(twice, 'wet').overridden === true)
}

console.log(failures ? `\n${failures} failing` : '\nthe number you set is the number you hear')
assert.equal(failures, 0)
