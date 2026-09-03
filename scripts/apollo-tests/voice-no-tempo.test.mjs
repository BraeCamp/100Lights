#!/usr/bin/env node
// A sentence about a track must never become a change to the whole song.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-no-tempo.test.mjs
//
// Brae: "I told it 'I said that the pad should be lower' and to 'add sub to pad
// in Apollo' and it just changed the tempo."
//
// ⚠️ Both sentences named a track. Neither is a tempo change by any reading.
// This is the worst class of failure the voice control has: a global command is
// loud, immediate, and affects everything in the project — so reaching for one
// by mistake is far more damaging than refusing would have been, and it looks
// nothing like what was asked for.
//
// The two causes were different, and the second is the interesting one:
//
//   "lower" is ONE EDIT from "slower", so set_tempo.relative genuinely matches
//   it. Locally it loses to the volume reading on score, which is why the local
//   path was already right — but the ambiguity is real and the assistant had
//   nothing telling it which way to go.
//
//   "add sub to the pad" had NO TOOL AT ALL. That is the actual fault: a model
//   with nothing right to reach for reaches for something wrong far more
//   readily than it refuses.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { interpret } = await importTs('lib/voice/interpret.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { initPatch } = await importTs('lib/apollo/patch.ts')
const { MUSIC_SYSTEM_HINT } = await importTs('lib/voice/music-tools.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const PROJECT = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8, swing: 0,
  tracks: [
    { id: 'tp', name: 'Pad', instrument: { type: 'apollo', params: initPatch() }, effects: [], volume: 0.8 },
    { id: 'tb', name: 'Bass', instrument: { type: 'poly', params: {} }, effects: [], volume: 0.8 },
    { id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} }, effects: [], volume: 0.8 },
  ],
  arrangementClips: [
    { id: 'cp', trackId: 'tp', kind: 'midi', name: 'Pad clip', startBeat: 0, durationBeats: 8,
      notes: [{ id: 'n', pitch: 60, startBeat: 0, durationBeats: 2, velocity: 100 }] },
  ],
}
const ctx = {
  tracks: PROJECT.tracks, tempo: 120,
  clips: PROJECT.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId })),
}
const read = t => interpret(t, ctx)
const GLOBAL = ['set_tempo', 'set_time_signature', 'set_key_scale', 'set_master_volume', 'set_swing']

// ── The two sentences that started this ────────────────────────────────────
{
  const a = read('I said that the pad should be lower')
  check('"the pad should be lower" is the pad, not the song',
    a.calls[0]?.name === 'set_track', String(a.calls[0]?.name))
  check('and it turns the pad down',
    a.calls[0]?.input?.target === 'Pad' && a.calls[0]?.input?.volume < 80,
    JSON.stringify(a.calls[0]?.input))

  const b = read('add sub to pad in Apollo')
  check('"add sub to pad in Apollo" reaches Apollo\'s own layers',
    b.calls[0]?.name === 'set_apollo_layer', String(b.calls[0]?.name))
  const plan = b.calls[0] ? planVoiceCall(b.calls[0], PROJECT) : null
  check('and actually switches the sub on', /sub on Pad/.test(plan?.say ?? ''), plan?.say ?? plan?.problem)
}

// ── The class, not just the two examples ───────────────────────────────────
//
// Every one of these names a track. None of them may come back as a song-wide
// change, whatever else they do — including reading as nothing at all, which is
// a fine answer and the one the assistant is told to give.
{
  const NAMED = [
    'the pad should be lower',
    'make the pad lower',
    'lower the pad',
    'the pad is too loud',
    'add sub to the pad',
    'more sub on the pad',
    'the bass should be slower',      // even with "slower" in it
    'take the sub off the pad',
    'the drums should be quieter',
  ]
  const wrong = []
  for (const line of NAMED) {
    const got = read(line).calls[0]
    if (got && GLOBAL.includes(got.name)) wrong.push(`"${line}" → ${got.name}`)
  }
  check('no sentence naming a track becomes a song-wide change', wrong.length === 0, wrong.join(' | '))
}

// ⚠️ And the reverse, or the fix would have broken the tempo command itself:
// a sentence with NO track in it still reaches the global commands.
{
  const stays = [
    ['set the tempo to 92', 'set_tempo'],
    ['slow down', 'set_tempo'],
    ['put it in 3/4', 'set_time_signature'],
    ['add some swing', 'set_swing'],
  ]
  const broke = []
  for (const [line, want] of stays) {
    const got = read(line).calls[0]
    if (got?.name !== want) broke.push(`"${line}" → ${got?.name ?? 'none'} (wanted ${want})`)
  }
  check('and a sentence about the song still changes the song', broke.length === 0, broke.join(' | '))
}

// ── Apollo layers ──────────────────────────────────────────────────────────
{
  const on = planVoiceCall({ name: 'set_apollo_layer', input: { target: 'pad', layer: 'sub' } }, PROJECT)
  const patch = on.actions[0]?.instrument?.params
  // ⚠️ Asking for it at all means switching it on. Reading "add sub" as "set
  // its level but leave it off" would be a command that does nothing audible
  // and reports success.
  check('asking for the sub switches it on', patch?.sub?.enabled === true, JSON.stringify(patch?.sub?.enabled))
  check('and gives it a level worth hearing', patch?.sub?.level > 0, String(patch?.sub?.level))

  const off = planVoiceCall({ name: 'set_apollo_layer', input: { target: 'pad', layer: 'sub', on: false } }, PROJECT)
  check('and it can be taken off again',
    off.actions[0]?.instrument?.params?.sub?.enabled === false, off.say)

  const noise = planVoiceCall({ name: 'set_apollo_layer', input: { target: 'pad', layer: 'noise', level: 30 } }, PROJECT)
  check('noise is its own layer',
    Math.abs(noise.actions[0]?.instrument?.params?.noise?.level - 0.3) < 1e-9,
    String(noise.actions[0]?.instrument?.params?.noise?.level))

  const osc = planVoiceCall({ name: 'set_apollo_layer', input: { target: 'pad', layer: 'osc 2' } }, PROJECT)
  check('and so is each oscillator',
    osc.actions[0]?.instrument?.params?.oscs?.[1]?.enabled === true, osc.say)

  // ⚠️ Says WHY, and what would fix it. "I can't" with no reason is the answer
  // that sends somebody looking for a bug in their own project.
  const wrong = planVoiceCall({ name: 'set_apollo_layer', input: { target: 'drums', layer: 'sub' } }, PROJECT)
  check('a non-Apollo track explains itself',
    /drum kit/.test(wrong.problem ?? '') && /Apollo/.test(wrong.problem ?? ''), wrong.problem ?? '')
  check('an unknown layer lists the real ones',
    /oscillators/.test(planVoiceCall({ name: 'set_apollo_layer', input: { target: 'pad', layer: 'flange' } }, PROJECT).problem ?? ''))
}

// ── What the assistant is told ─────────────────────────────────────────────
// The local rules can only be right about sentences they can read. The rule
// that stops the assistant doing this has to live in the prompt.
check('the assistant is told a named track is never a song-wide change',
  /IF THE SENTENCE NAMES A TRACK/.test(MUSIC_SYSTEM_HINT))
check('and told to say so rather than reach for a neighbour',
  /SAY SO/.test(MUSIC_SYSTEM_HINT))

console.log(failures ? `\n${failures} failing` : '\na sentence about a track stays about that track')
assert.equal(failures, 0)
