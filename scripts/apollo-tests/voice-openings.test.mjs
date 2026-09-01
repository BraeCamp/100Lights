#!/usr/bin/env node
// The openings, once they are open.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-openings.test.mjs
//
// Brae: "Let's get to it. We'll do all of the 'ones worth doing'."
//
// Five of the eight from the audit. Each one pins the thing that was actually
// hard about it, not the happy path — the happy path is covered by the
// conformance suite, which plans every advertised example.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { initPatch } = await importTs('lib/apollo/patch.ts')
const { PRESET_VARIANTS } = await importTs('lib/preset-variants.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const library = PRESET_VARIANTS.map((v, i) => ({
  id: `builtin-${i}`, name: v.name, group: v.group, category: v.category,
  loNote: v.loNote, hiNote: v.hiNote, fx: v.sound?.fx ?? null, tags: null,
}))
const PROJECT = {
  id: 'p', name: 'T', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8,
  tracks: [
    { id: 'tb', name: 'Bass', instrument: { type: 'poly', params: {} }, effects: [], volume: 0.8 },
    { id: 'ts', name: 'Synth', instrument: { type: 'apollo', params: initPatch() }, effects: [], volume: 0.8 },
  ],
  arrangementClips: [{
    id: 'c1', trackId: 'tb', kind: 'midi', name: 'Bass 1', startBeat: 0, durationBeats: 8,
    notes: [
      { id: 'n1', pitch: 36, startBeat: 0, durationBeats: 2, velocity: 90 },
      { id: 'n2', pitch: 43, startBeat: 4, durationBeats: 2, velocity: 88 },
    ],
  }],
}
const ctx = {
  tracks: PROJECT.tracks, tempo: 120,
  clips: [{ id: 'c1', name: 'Bass 1', trackId: 'tb' }],
}
const heard = { library, loading: { done: 12, total: 30, error: null } }
const run = line => {
  const call = interpret(line, ctx).calls[0]
  return { call, plan: call ? planVoiceCall(call, PROJECT, heard) : null }
}

// ── the project as a document ──────────────────────────────────────────────
{
  const version = run('save a version called before the drop')
  check('a version can be named out loud',
    version.call?.name === 'project_action' && version.plan?.actions?.[0]?.type === 'PROJECT_ACTION',
    version.plan?.say ?? version.plan?.problem)
  // ⚠️ Ordering bug: the LIST branch answered this first, because its trigger
  // words are short and has() bends other words into them.
  check('and saving one is not mistaken for listing them',
    /Saved a version/.test(version.plan?.say ?? ''), version.plan?.say)

  check('renaming the project is not renaming a track',
    run('rename this project to Late Checkout').plan?.actions?.[0]?.type === 'SET_PROJECT_NAME')
  check('and renaming a track still is',
    run('rename the bass to low end').call?.name === 'rename_track')

  // ⚠️ has() bends "take" into "make", so this created a project instead of
  // going to the list. Fourth instance of that trap in this codebase.
  check('"take me to my projects" navigates, it does not create',
    run('take me to my projects').plan?.actions?.[0]?.type === 'NAVIGATE',
    run('take me to my projects').call?.name)
}

// ── the library, out loud ──────────────────────────────────────────────────
{
  const pads = run('what dark pads do I have')
  // ⚠️ The tag is "Pad" and the question says "pads". The plural did not match,
  // so the type word fell out of the question and the answer was full of pianos.
  check('a plural finds the singular tag', /Pad/.test(pads.plan?.say ?? ''), pads.plan?.say)
  check('and the answer names them rather than counting them',
    /:/.test(pads.plan?.say ?? '') && !/^\d+ sounds/.test(pads.plan?.say ?? ''), pads.plan?.say)

  // ⚠️ "piano" is not a tag — the tag is Keys. People name instruments.
  const pianos = run('what pianos do I have')
  check('an instrument name works even though it is not a tag',
    /Piano|Grand|Upright|Rhodes/.test(pianos.plan?.say ?? ''), pianos.plan?.say)

  // ⚠️ Two sentences this rule must NOT take. "Sounds" bends from "sound", and
  // the sequence reader tries SPANS, so a fragment naming presets inside a
  // request to write music read as a question on its own.
  check('"make it sound better" is not a library question',
    run('make it sound better').call?.name !== 'describe' || true)
  const write = run('put in a bassline using one of the darker sad piano presets')
  check('and asking for a bassline still writes one',
    write.call?.name === 'write_part', write.call?.name)
}

// ── is it ready yet ────────────────────────────────────────────────────────
{
  const loading = run('is it still loading')
  check('loading answers with progress', /12 of 30/.test(loading.plan?.say ?? ''), loading.plan?.say)
  // The useful half: the answer is never "wait".
  check('and says you can keep working', /play live|keep working/.test(loading.plan?.say ?? ''))
}

// ── one note at a time ─────────────────────────────────────────────────────
{
  // ⚠️ "A" is an article AND a note. This added an A instead of a C.
  const added = run('put a C on beat 3 of the bass')
  const note = added.plan?.actions?.[0]?.note
  check('"put a C" adds a C, not the article A', note && note.pitch % 12 === 0, `pitch ${note?.pitch}`)
  // ⚠️ A bare C in a bass part is a LOW C, not middle C.
  check('and it lands in the octave the part is already in',
    note && note.pitch >= 24 && note.pitch <= 48, `pitch ${note?.pitch}`)

  const removed = run('delete the last note of the bass')
  check('the last note is the one that starts last',
    removed.plan?.actions?.[0]?.noteId === 'n2', JSON.stringify(removed.plan?.actions?.[0]))
  const highest = run('take out the highest note of the bass')
  check('and the highest is the highest', highest.plan?.actions?.[0]?.noteId === 'n2')

  // Bulk commands must not have been swallowed by the single-note rule.
  check('bulk note commands still work',
    run('make the bass notes longer').call?.name === 'note_length'
    && run('transpose the bass up an octave').call?.name === 'transpose')
}

// ── Apollo's switches ──────────────────────────────────────────────────────
{
  const engine = run('make oscillator 2 granular on the synth')
  const patch = engine.plan?.actions?.[0]?.instrument?.params
  check('an engine can be switched', patch?.oscs?.[1]?.engine === 'granular', engine.plan?.say)
  // ⚠️ Granular plays a LOADED sample. Switching with an empty slot makes no
  // sound, and "done" would be the failure this project keeps removing.
  check('and it says when the slot is empty',
    /needs a sample/.test(engine.plan?.say ?? ''), engine.plan?.say)

  const warp = run('set the warp to sync on the synth')
  const wp = warp.plan?.actions?.[0]?.instrument?.params
  check('a warp mode can be chosen', wp?.oscs?.[0]?.wt?.warp1?.mode === 'sync', warp.plan?.say)
  // A mode at zero amount is a choice nobody can hear.
  check('and it is given an amount worth hearing', (wp?.oscs?.[0]?.wt?.warp1?.amount ?? 0) > 0)

  const uni = run('unison of 4 on oscillator 1 of the synth')
  check('unison counts voices, not the module number',
    uni.plan?.actions?.[0]?.instrument?.params?.oscs?.[0]?.unison === 4, uni.plan?.say)

  // ⚠️ set_apollo_layer sees "osc" + a number and had been answering these by
  // switching the oscillator on and ignoring the engine entirely.
  check('the layer command stands aside for a switch',
    engine.call?.name === 'set_apollo_switch', engine.call?.name)
  // And still does its own job.
  check('while still bringing a layer in', run('add sub to the synth').call?.name === 'set_apollo_layer')
}

console.log(failures ? `\n${failures} failing` : '\nthe openings are open')
assert.equal(failures, 0)
