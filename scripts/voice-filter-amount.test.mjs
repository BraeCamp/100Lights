// A spoken filter must never silence the track.
//
//   npm run test:voice-filter
//
// Brae, twice: "the lowpass cutoff made the pad stop playing audio", and later
// "Lowpass cutoff is making the pad stop playing sound". The first report was
// the SWEEP, and it was fixed there. This is the other path — add_effect /
// set_effect — which mapped a percentage straight onto a cutoff with a floor of
// 20 Hz, so any amount up to about 30% put a pad below anything a person can
// hear. Nothing failed; it just went quiet, which is why it came back.
//
// The rule these guard: a filter set by voice is DARK at its extreme, never
// silent, and more amount always means more effect.

import Module, { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, '.test-build')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/lib/')) request = join(BUILD, request.slice('@/lib/'.length) + '.js')
  return origResolve.call(this, request, ...rest)
}

const { planVoiceCall } = require('../.test-build/voice/execute-music.js')
const { LOWPASS_HZ, HIGHPASS_HZ } = require('../.test-build/daw-effect-params.js')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}

const project = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [{ id: 't1', name: 'Pad', volume: 0.8, pan: 0, mute: false, solo: false, effects: [] }],
  arrangementClips: [], automationLanes: [], returnTracks: [],
}
const withFilter = hz => ({
  ...project,
  tracks: [{ ...project.tracks[0], effects: [{ id: 'f1', type: 'filter', params: { enabled: true, type: 'lowpass', frequency: hz, q: 1 } }] }],
})

/** The cutoff an add_effect / set_effect plan would actually write. */
function cutoffFor(amount, proj = project, name = 'add_effect') {
  const plan = planVoiceCall({ name, input: { target: 'Pad', effect: 'filter', amount } }, proj)
  if (plan.problem) return { problem: plan.problem }
  const a = plan.actions[0]
  const params = a.effect ? a.effect.params : a.patch.params
  return { hz: params.frequency }
}

// ── The bug: no amount may put the cutoff below hearing ────────────────────
const swept = []
for (let amount = 0; amount <= 100; amount += 5) {
  const { hz } = cutoffFor(amount)
  swept.push([amount, hz])
}
const tooLow = swept.filter(([, hz]) => hz < LOWPASS_HZ.min)
check(
  'no amount 0–100 drops a low-pass below the audible floor',
  tooLow.length === 0,
  tooLow.length ? `silenced at ${tooLow.map(([a, hz]) => `${a}%→${hz}Hz`).join(', ')}` : `min ${Math.min(...swept.map(s => s[1]))}Hz`,
)

// ── More means more, the way it does for every other effect ────────────────
const at0 = cutoffFor(0).hz
const at50 = cutoffFor(50).hz
const at100 = cutoffFor(100).hz
check('more amount = more filtering (a low-pass comes DOWN)', at0 > at50 && at50 > at100, `0%→${at0}Hz 50%→${at50}Hz 100%→${at100}Hz`)
check('0% leaves the filter open', at0 >= LOWPASS_HZ.max, `${at0}Hz`)
check('100% is dark but still audible', at100 === LOWPASS_HZ.min, `${at100}Hz`)

// ── A high-pass filters more as it goes UP ─────────────────────────────────
const hp = amount => {
  const proj = { ...project, tracks: [{ ...project.tracks[0], effects: [{ id: 'f1', type: 'filter', params: { enabled: true, type: 'highpass', frequency: 100, q: 1 } }] }] }
  return cutoffFor(amount, proj, 'set_effect').hz
}
check('more amount = more filtering (a high-pass goes UP)', hp(0) < hp(100), `0%→${hp(0)}Hz 100%→${hp(100)}Hz`)
check('a high-pass stays inside its own range', hp(100) === HIGHPASS_HZ.max && hp(0) === HIGHPASS_HZ.min, `${hp(0)}–${hp(100)}Hz`)

// ── Turning an existing filter down must not silence it either ─────────────
const existing = cutoffFor(20, withFilter(8000), 'set_effect')
check('setting an existing filter to 20% stays audible', existing.hz >= LOWPASS_HZ.min, `${existing.hz}Hz`)

// ── And the default, with no amount said at all ────────────────────────────
//
// ⚠️ This used to assert the cutoff was ABOVE 2 kHz, which encoded the very
// thing Brae reported: a filter that arrives at 8 kHz is inaudible, so "added
// a filter" did nothing you could hear. The default is deliberately 1200 Hz
// now. What matters is not that it is open but that it is HEARD and not
// near-closed — a filter you cannot hear and a filter that swallows the track
// are both wrong, in opposite directions.
const noAmount = planVoiceCall({ name: 'add_effect', input: { target: 'Pad', effect: 'filter' } }, project)
const noAmountHz = noAmount.actions?.[0]?.effect?.params?.frequency
check('a filter added with no amount lands somewhere audible',
  noAmountHz > LOWPASS_HZ.min * 1.5 && noAmountHz < 4000, `${noAmountHz}Hz`)

console.log(failures ? `\n${failures} FAILED` : '\nall good')
process.exit(failures ? 1 : 0)
