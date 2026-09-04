#!/usr/bin/env node
// One library sample, played across the keys — the Samples tab in the piano
// roll's preset picker, and the same sounds offered to the AI.
//
//   node --experimental-strip-types scripts/apollo-tests/sample-preset.test.mjs
//
// Brae: "let's make it so that there's a samples tab when the user clicks on
// presets in the piano roll. This should help the AI also come up with better
// songs."

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { guessRootNote, isPickableSample, samplePresetFor, samplePresetName, isSampleRef, sampleRefId, SAMPLE_ID_PREFIX, SAMPLE_SPAN } = await importTs('lib/sample-preset.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')

// ── The root ─────────────────────────────────────────────────────────────────
{
  check('a per-note instrument entry says its root', guessRootNote({ name: 'C4', renderSpec: { midiNote: 60 } }) === 60)
  check('a note in a tag', guessRootNote({ name: 'Pluck', tags: ['F#3'] }) === 54)
  check('a note in the name', guessRootNote({ name: 'Bell A4' }) === 69)
  check('a key with no octave lands in the third octave', guessRootNote({ name: 'Chop', key: 'F#' }) === 54)
  check('a flat key', guessRootNote({ name: 'Chop', key: 'Bb' }) === 58)
  check('nothing known is middle C', guessRootNote({ name: 'Kick 808' }) === 60)
  check('the name wins over the key when both say something', guessRootNote({ name: 'Bass D2', key: 'F' }) === 38)
}

// ── What is a sample, and what is one note of an instrument ─────────────────
{
  check('a recorded sound is pickable', isPickableSample({ id: 'r1', name: 'My vocal', audioBlob: {} }))
  check('a catalog sound not yet fetched is pickable', isPickableSample({ id: 'catalog_1', name: 'Kick 808', catalogUrl: '/x' }))
  check('a seeded synth sound (renderSpec) is pickable', isPickableSample({ id: '100l_1', name: 'Dark Pad', renderSpec: { kind: 'melodic', midiNote: 60 } }))
  check('one note of an instrument folder is not', !isPickableSample({ id: 'v1', name: 'C4', folder: 'Violin – All Notes', audioBlob: {} }))
  check('a soundfont note is not', !isPickableSample({ id: 's1', name: 'D2', renderSpec: { kind: 'soundfont', midiNote: 38 }, audioBlob: {} }))
  check('an image spectrum is not', !isPickableSample({ id: 'i1', name: 'Sunset', audioBlob: {}, tags: ['apollo-image-spectral'] }))
  check('a stub with no audio anywhere is not', !isPickableSample({ id: 'x', name: 'Empty' }))
}

// ── The preset ───────────────────────────────────────────────────────────────
{
  const p = samplePresetFor({ id: 'catalog_kick', name: 'Kick 808', folder: 'Boombap', category: 'kick', tags: ['Hard', 'C2'] })
  check('the preset names the sample and its root', p.sampleId === 'catalog_kick' && p.rootNote === 36, JSON.stringify(p))
  check('and spans two octaves either side', p.loNote === 36 - SAMPLE_SPAN && p.hiNote === 36 + SAMPLE_SPAN)
  check('in the Samples group, keeping the folder as a label', p.group === 'Samples' && p.folder === 'Boombap')
  check('the note tag is dropped, the character tag kept', p.tags.join() === 'Hard')
  const hi = samplePresetFor({ id: 'x', name: 'Glass C7' }, { rootNote: 96 })
  check('a root near the top is clamped, never past 127', hi.hiNote <= 127 && hi.loNote === 72)
  check('a bare-note name falls back to the folder for a name', samplePresetName({ name: '', folder: 'Chops' }) === 'Chops')
  check('the voice id form round-trips', isSampleRef(`${SAMPLE_ID_PREFIX}abc`) && sampleRefId(`${SAMPLE_ID_PREFIX}abc`) === 'abc' && !isSampleRef('builtin-3'))
}

// ── The AI: a sample is a sound it can name ─────────────────────────────────
{
  const project = {
    id: 'p', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, key: 0, scale: 'minor',
    tracks: [{ id: 't1', name: 'Bass', volume: 0.8, effects: [] }],
    arrangementClips: [{ id: 'c1', kind: 'midi', trackId: 't1', name: 'Bass 1', startBeat: 0, durationBeats: 16, isDrumClip: false, notes: [{ id: 'n1', pitch: 40, startBeat: 0, durationBeats: 4, velocity: 100 }] }],
    automationLanes: [],
  }
  const set = planVoiceCall({ name: 'set_instrument', input: { target: 'bass', presetId: 'sample:catalog_kick', presetName: 'Kick 808' } }, project)
  const use = (set.actions ?? []).find(a => a.type === 'USE_SAMPLE')
  check('set_instrument with a sample id asks the studio to make the preset', use && use.sampleId === 'catalog_kick' && use.clipIds.join() === 'c1', JSON.stringify(set))
  check('and says so', /pitched across the keys/.test(set.say ?? ''), set.say)
  const lib = [{ id: 'sample:catalog_808', name: '808 Sub', group: 'Samples', category: 'synth-bass', tags: ['Dark'], loNote: 36, hiNote: 84, fx: null }]
  const part = planVoiceCall({ name: 'write_part', input: { part: 'bass', character: 'dark', instrument: 'bass' } }, project, { library: lib })
  const types = (part.actions ?? []).map(a => a.type)
  check('write_part can choose a sample by character', types.includes('ADD_TRACK') && types.includes('ADD_CLIP') && types.includes('USE_SAMPLE'), JSON.stringify(types) + ' ' + (part.problem ?? ''))
  const clipAct = (part.actions ?? []).find(a => a.type === 'ADD_CLIP')
  const useAct = (part.actions ?? []).find(a => a.type === 'USE_SAMPLE')
  check('the clip is made without a preset and the sample is put on it', clipAct && clipAct.clip.presetId === undefined && useAct?.clipIds[0] === clipAct.clip.id)
  const ctx = { tracks: [{ id: 't1', name: 'Bass', volume: 0.8 }], tempo: 120, clips: [{ id: 'c1', name: 'Bass 1', trackId: 't1', kind: 'midi' }], library: [{ id: 'sample:catalog_kick', name: 'Kick 808', group: 'Samples' }] }
  const said = interpret('make the bass the kick 808', ctx).calls[0]
  check('the rules read a sample name like any instrument', said?.name === 'set_instrument' && said.input.presetId === 'sample:catalog_kick', JSON.stringify(said))
}

// ── Wired in ─────────────────────────────────────────────────────────────────
{
  const engine = readFileSync('lib/daw-engine.ts', 'utf8')
  check('the engine pitches a sample preset from its root', /if \(preset\.sampleId\) \{[\s\S]*?resampleBySemitones\(src, semis, \{ sampleRate: this\.ctx\.sampleRate \}\)/.test(engine))
  check('decoding the recording once per preset', /_sampleRootBufs = new Map/.test(engine) && /_sampleRootBufs\.clear\(\)/.test(engine))
  const roll = readFileSync('components/editor/daw/PianoRoll.tsx', 'utf8')
  check('the picker has a Samples tab', /data-pr-picker-tab=\{id\}/.test(roll) && /tabBtn\('samples', 'SAMPLES'\)/.test(roll))
  check('with a root note per sample and a Use button', /data-pr-sample-use=\{e\.id\}/.test(roll) && /ROOT_CHOICES\.map/.test(roll))
  check('using one embeds the preset in the project and puts it on the clip', /dispatch\(\{ type: 'ADD_PRESET', preset: p \}\)[\s\S]*?patch: \{ presetId: p\.id \}/.test(roll))
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('the voice sees the library samples', /librarySamples\(\)\.map/.test(control) && /USE_SAMPLE/.test(control))
  check('and the assistant is told what they are', /librarySamplesLine\(\) \+ musicStateSummary/.test(control))
  const presets = readFileSync('lib/midi-presets.ts', 'utf8')
  check('a preset can name one sample and a root', /sampleId\?: string\n\s+rootNote\?: number/.test(presets))
}

console.log(failures ? `\n${failures} failing` : '\none sample, every key')
assert.equal(failures, 0)
