#!/usr/bin/env node
// Moving the music moves everything written along the timeline with it.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-move.test.mjs
//
// Brae: "When I asked the voice control to move everything over, it forgot to
// move the graphs for effects over."
//
// Clips are not the only thing with a position. An automation point and a
// clip-effect bar each carry their own absolute beat, and moving the clips
// without them is worse than not moving at all: the arrangement still plays,
// and simply sounds wrong somewhere else. A filter sweep that was shaping the
// intro is now sitting over whatever happens to be at bar 1.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

/** Two tracks, each with a clip, an automation lane and a clip-effect bar. */
const project = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [{ id: 'tp', name: 'Pad' }, { id: 'tb', name: 'Bass' }],
  arrangementClips: [
    { id: 'cp', trackId: 'tp', kind: 'midi', name: 'Pad', startBeat: 8, durationBeats: 16, notes: [] },
    { id: 'cb', trackId: 'tb', kind: 'midi', name: 'Bass', startBeat: 8, durationBeats: 16, notes: [] },
  ],
  automationLanes: [
    {
      id: 'lp', trackId: 'tp', parameter: 'fx:e1:frequency', label: 'Low-pass cutoff',
      min: 200, max: 18000, defaultValue: 18000,
      points: [{ id: 'a1', beat: 8, value: 18000 }, { id: 'a2', beat: 24, value: 500 }],
    },
    {
      id: 'lb', trackId: 'tb', parameter: 'volume', label: 'Volume',
      min: 0, max: 1, defaultValue: 0.8,
      points: [{ id: 'b1', beat: 8, value: 0.8 }],
    },
  ],
  clipEffects: [{ id: 'fx1', trackId: 'tp', startBeat: 8, durationBeats: 8, fx: {}, graph: [] }],
  returnTracks: [], takeLanes: [],
}

const move = (by, target) => planVoiceCall(
  { name: 'move_clips', input: target ? { target, by } : { by } },
  project,
)

const of = (plan, type) => plan.actions.filter(a => a.type === type)

// ── Everything over by one bar ─────────────────────────────────────────────
{
  const plan = move({ bars: 1 })
  check('the move plans', !plan.problem, plan.problem ?? '')
  check('both clips move', of(plan, 'MOVE_CLIP').length === 2)
  check('every clip lands 4 beats later',
    of(plan, 'MOVE_CLIP').every(a => a.startBeat === 12),
    of(plan, 'MOVE_CLIP').map(a => a.startBeat).join(', '))

  // The bug.
  const pts = of(plan, 'UPDATE_AUTOMATION_POINT')
  check('the automation points move too', pts.length === 3, `${pts.length} of 3`)
  check('and by the same amount',
    pts.map(a => a.patch.beat).sort((x, y) => x - y).join(',') === '12,12,28',
    pts.map(a => a.patch.beat).join(', '))

  const bars = of(plan, 'UPDATE_CLIP_EFFECT')
  check('the effect bars move as well', bars.length === 1 && bars[0].patch.startBeat === 12,
    bars.map(a => a.patch.startBeat).join(', '))

  check('and it says so, because its silence was the bug',
    /automation/i.test(plan.say), plan.say)
}

// ── One track only ─────────────────────────────────────────────────────────
//
// The other half of the same rule: "move the bass over" must not drag the pad's
// automation with it. A fix that moved every lane in the project would pass the
// test above and quietly corrupt every targeted move.
{
  const plan = move({ bars: 1 }, 'Bass')
  check('only the named track\'s clip moves', of(plan, 'MOVE_CLIP').length === 1)
  const pts = of(plan, 'UPDATE_AUTOMATION_POINT')
  check('only its automation moves', pts.length === 1 && pts[0].laneId === 'lb',
    pts.map(a => a.laneId).join(', '))
  check('and the pad\'s effect bar is left alone',
    of(plan, 'UPDATE_CLIP_EFFECT').length === 0)
}

// ── Backwards, and past the start ──────────────────────────────────────────
{
  const plan = move({ bars: -1 })
  check('moving earlier moves the automation earlier',
    of(plan, 'UPDATE_AUTOMATION_POINT').every(a => a.patch.beat >= 0)
    && of(plan, 'UPDATE_AUTOMATION_POINT').some(a => a.patch.beat === 4),
    of(plan, 'UPDATE_AUTOMATION_POINT').map(a => a.patch.beat).join(', '))

  // Clips are clamped at zero; automation has to be clamped the same way or a
  // big move backwards puts points at negative beats, where nothing can reach
  // them again.
  const far = move({ bars: -99 })
  check('nothing is pushed before the start of the song',
    of(far, 'UPDATE_AUTOMATION_POINT').every(a => a.patch.beat >= 0)
    && of(far, 'MOVE_CLIP').every(a => a.startBeat >= 0))
}

console.log(failures ? `\n${failures} failing` : '\nthe music and everything written along it move together')
assert.equal(failures, 0)
