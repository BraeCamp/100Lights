#!/usr/bin/env node
// Every action the voice executor emits must be handled by SOMETHING.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-actions.test.mjs
//
// Brae: "You keep finding faults. Can you keep looking through loading and
// through the voice command system and look for faults."
//
// ⚠️ This is the class that keeps coming back, and every instance of it is a
// command that REPORTS SUCCESS AND CHANGES NOTHING:
//
//   UPDATE_EFFECT was sent `params` where the reducer reads `patch.params`.
//   SET_LOOP had the wrong shape. SET_TRACK_VOLUME never existed at all.
//   And SELECT — emitted from four places, saying "Selected 3 clips on Bass" —
//   was handled by NOBODY: not the reducer, which has no such action, and not
//   VoiceControl, which catches the other six studio-level ones.
//
// That last one is worse than it looks. The selection is what "this track" and
// "this clip" resolve against, so a select that silently did nothing left every
// pronoun afterwards pointing at whatever was selected before.
//
// Reading the rules cannot find these. Comparing what is EMITTED against what
// is HANDLED can, and it is a source-level check because that is where the two
// halves live — one in a pure planner, one in a React component.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── emitted vs handled ─────────────────────────────────────────────────────
{
  const exec = readFileSync('lib/voice/execute-music.ts', 'utf8')
  const reducer = readFileSync('lib/daw-state.ts', 'utf8')
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')

  const emitted = [...new Set([...exec.matchAll(/type:\s*'([A-Z_]+)'/g)].map(m => m[1]))]
  const byReducer = new Set([...reducer.matchAll(/case\s+'([A-Z_]+)'/g)].map(m => m[1]))
  // The studio-level ones are caught by identity checks in the voice component,
  // because they are not part of the saved document and the reducer must not
  // learn about them.
  const byControl = new Set([...control.matchAll(/act\.type === '([A-Z_]+)'/g)].map(m => m[1]))

  const orphans = emitted.filter(t => !byReducer.has(t) && !byControl.has(t))
  check(`all ${emitted.length} emitted actions are handled somewhere`,
    orphans.length === 0, orphans.length ? `orphaned: ${orphans.join(', ')}` : '')
  // Sanity that the parse actually found things, or the check above passes
  // vacuously the first time somebody renames a file.
  check('and the check is actually reading both halves',
    emitted.length > 20 && byReducer.size > 20 && byControl.size >= 6,
    `${emitted.length} emitted / ${byReducer.size} reducer / ${byControl.size} studio`)
}

const { interpret } = await importTs('lib/voice/interpret.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { initPatch } = await importTs('lib/apollo/patch.ts')

const PROJECT = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8, swing: 0,
  tracks: [
    { id: 'tv', name: 'Vocals', instrument: { type: 'poly', params: {} }, effects: [], volume: 0.8 },
    { id: 'tb', name: 'Bass', instrument: { type: 'poly', params: {} }, effects: [], volume: 0.8 },
    { id: 'tp', name: 'Pad', instrument: { type: 'apollo', params: initPatch() }, effects: [], volume: 0.8 },
  ],
  arrangementClips: [
    { id: 'cb', trackId: 'tb', kind: 'midi', name: 'Bass clip', startBeat: 0, durationBeats: 8, notes: [] },
    { id: 'cb2', trackId: 'tb', kind: 'midi', name: 'Bass clip 2', startBeat: 8, durationBeats: 8, notes: [] },
  ],
  loopStart: 0, loopEnd: 8, loopEnabled: false,
}
const ctx = {
  tracks: PROJECT.tracks, tempo: 120,
  clips: PROJECT.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId })),
}
const read = t => interpret(t, ctx)

// ── select actually carries what the studio needs ──────────────────────────
{
  const plan = planVoiceCall({ name: 'select', input: { what: 'track', target: 'bass' } }, PROJECT)
  const act = plan.actions?.[0]
  check('selecting a track names the clips AND the track',
    act?.type === 'SELECT' && act.clipIds?.length === 2 && act.trackId === 'tb',
    JSON.stringify(act))
}

// ── a frequency is not a level ─────────────────────────────────────────────
//
// ⚠️ "Boost 5k on the vocals" — which eq_band's own description calls the
// commonest sentence in any mixing session — was setting the VOCAL FADER to
// 95%. "5k" is one token, so the rule's w.has('k') never matched, and 'boost'
// is in the UP list so the volume rule took the sentence and ignored the number.
{
  const freqs = [
    ['boost 5k on the vocals', 5000],
    ['boost 5 k on the vocals', 5000],
    ['cut 300 hertz on the bass', 300],
    ['boost 5000 on the vocals', 5000],
    // The tokeniser splits "1.5k" into "1" and "5k", so this is read off the
    // raw sentence rather than the tokens.
    ['cut 1.5k on the pad', 1500],
    ['boost 10k on the vocals', 10000],
  ]
  const wrong = []
  for (const [line, hz] of freqs) {
    const call = read(line).calls[0]
    if (call?.name !== 'eq_band') wrong.push(`"${line}" → ${call?.name ?? 'nothing'}`)
    else if (call.input.frequency !== hz) wrong.push(`"${line}" → ${call.input.frequency} Hz, wanted ${hz}`)
  }
  check('every way of saying a frequency reaches the EQ', wrong.length === 0, wrong.join(' | '))

  // ⚠️ And the fader must still work, or the fix traded one wrong edit for
  // another. "Boost the vocals" names no frequency and is a level.
  const levels = [
    'turn the bass up', 'boost the vocals', 'make the vocals louder',
    'set the bass to 50 percent', 'bring the pad down a bit',
  ]
  const broke = levels.filter(l => read(l).calls[0]?.name !== 'set_track')
  check('and a level with no frequency in it is still a level', broke.length === 0, broke.join(' | '))
  check('while the tempo is untouched by either', read('set the tempo to 120').calls[0]?.name === 'set_tempo')
}

// ── a marker is not a place to go ──────────────────────────────────────────
//
// ⚠️ The name had to follow the word "as" and nothing else, so "add a marker at
// bar 9 CALLED drop" matched nothing here and fell through to transport, which
// MOVED THE PLAYHEAD and made no marker — a different action, silently.
{
  const markers = [
    ['add a marker at bar 9 called drop', 'Drop', 9],
    ['mark bar 17 as the drop', 'Drop', 17],
    ['put a marker here called drop', 'Drop', null],
    ['mark this as the chorus', 'Chorus', null],
  ]
  const wrong = []
  for (const [line, name, bar] of markers) {
    const call = read(line).calls[0]
    if (call?.name !== 'add_marker') { wrong.push(`"${line}" → ${call?.name ?? 'nothing'}`); continue }
    if (call.input.name !== name) wrong.push(`"${line}" named ${call.input.name}`)
    if ((call.input.at?.bar ?? null) !== bar) wrong.push(`"${line}" at bar ${call.input.at?.bar}`)
  }
  check('a marker is made wherever it was asked for', wrong.length === 0, wrong.join(' | '))
  check('and going to a bar still goes to a bar',
    read('go to bar 9').calls[0]?.name === 'transport')
}

console.log(failures ? `\n${failures} failing` : '\nwhat the voice says it did, it did')
assert.equal(failures, 0)
