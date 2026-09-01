#!/usr/bin/env node
// One sentence, several steps — and a sound chosen by how it should feel.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-multistep.test.mjs
//
// Brae: "I told the voice control to 'Put in a baseline preset that uses low
// notes of 1 of the darker slash more meloncolic and sad piano presets' and it
// didn't know what to do... It needs to take commands that require multiple
// steps, so it needs to look for more than one command type sometimes."
//
// Two things were missing, and they are different problems.
//
//   NOTHING COULD MATCH A MOOD. A preset carries a name, a group, a sampled
//   range and its shaping — and no notion of character, so "darker" and "sad"
//   had nothing to match against. Character is now DERIVED from the shaping,
//   which works on presets nobody tagged and cannot drift from what they sound
//   like. See lib/voice/preset-character.ts.
//
//   AND HALF A SENTENCE WAS BEING DROPPED IN SILENCE. "Turn the bass up and pan
//   it left" panned and never touched the volume. Not a missing feature — the
//   splitting machinery existed and was defeated by readings that CLAIMED to
//   explain the whole sentence while ignoring a command word in it.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { PRESET_VARIANTS } = await importTs('lib/preset-variants.ts')
const { characterOf, matchPresetByCharacter, characterWordsIn } = await importTs('lib/voice/preset-character.ts')
const { interpretSequence } = await importTs('lib/voice/sequence.ts')
const { planVoiceCalls } = await importTs('lib/voice/execute-music.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const library = PRESET_VARIANTS.map((v, i) => ({
  id: `builtin-${i}`, name: v.name, group: v.group,
  loNote: v.loNote, hiNote: v.hiNote, fx: v.sound?.fx ?? null,
}))
const PROJECT = {
  id: 'p', name: 'T', tempo: 90, timeSignatureNum: 4, timeSignatureDen: 4,
  key: 9, scale: 'minor', masterVolume: 0.8,        // A minor
  tracks: [
    { id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} }, effects: [], volume: 0.8, pan: 0 },
    { id: 'tb', name: 'Bass', instrument: { type: 'poly', params: {} }, effects: [], volume: 0.8, pan: 0 },
  ],
  arrangementClips: [],
}
const ctx = { tracks: PROJECT.tracks, tempo: 90, clips: [] }
const run = line => {
  const calls = interpretSequence(line, ctx).flatMap(s => s.reading.calls ?? [])
  return { calls, plan: calls.length ? planVoiceCalls(calls, PROJECT, { library }) : null }
}

// ── character comes from the sound, not from the name ──────────────────────
{
  const byName = library.find(p => p.name === 'Dark Upright')
  const bright = library.find(p => p.name === 'Bright Concert')
  check('a dark preset measures dark', characterOf(byName).dark > 0.5, characterOf(byName).dark.toFixed(2))
  check('and a bright one measures bright', characterOf(bright).bright > 0.5, characterOf(bright).bright.toFixed(2))
  // ⚠️ The point of deriving it: a preset with no telling name still scores.
  const unnamed = { id: 'x', name: 'Preset 12', group: 'Piano', fx: { filterHz: 2200, treble: -6 } }
  check('a preset whose name says nothing still measures dark',
    characterOf(unnamed).dark > 0.5, characterOf(unnamed).dark.toFixed(2))
}

// ── Brae's sentence, as he typed it ────────────────────────────────────────
{
  const line = 'Put in a baseline preset that uses low notes of 1 of the darker meloncolic and sad piano presets'
  // ⚠️ "meloncolic" is how it was actually typed, and a recogniser will do
  // worse. A word list that only accepts the dictionary spelling of a hard word
  // fails on the sentence it was written for.
  check('the misspelling is still read as a mood',
    characterWordsIn(line).includes('meloncolic'), characterWordsIn(line).join(','))

  const { calls, plan } = run(line)
  check('the sentence reaches write_part', calls[0]?.name === 'write_part', calls.map(c => c.name).join('+') || 'nothing')
  check('and it is understood as being about a piano',
    calls[0]?.input?.instrument === 'piano', JSON.stringify(calls[0]?.input))

  const add = plan?.actions?.find(a => a.type === 'ADD_TRACK')
  const clip = plan?.actions?.find(a => a.type === 'ADD_CLIP')?.clip
  // ⚠️ THREE actions from one sentence, and they cannot be three commands: a
  // track with no clips cannot be given a sampled preset, so sent separately
  // the middle step fails.
  check('one sentence makes a track AND a clip', !!add && !!clip,
    (plan?.actions ?? []).map(a => a.type).join(',') || plan?.problem)
  check('the clip carries the preset, because a sampled sound lives on the clip',
    !!clip?.presetId, String(clip?.presetId))
  check('it picked the darkest piano', /Dark Upright/.test(plan?.say ?? ''), plan?.say)
  check('and says WHY it picked it', /darkest piano/.test(plan?.say ?? ''), plan?.say)
}

// ── the notes are playable, in key, and low ────────────────────────────────
{
  const { plan } = run('put in a bassline using one of the darker sad piano presets')
  const clip = plan?.actions?.find(a => a.type === 'ADD_CLIP')?.clip
  const preset = library.find(p => p.id === clip?.presetId)
  const pitches = (clip?.notes ?? []).map(n => n.pitch)
  check('there are notes', pitches.length > 0, String(pitches.length))
  // ⚠️ Outside the sampled range a preset is REPITCHED, which is the "plays a
  // bit off" problem. "Low notes" has to mean low FOR THIS PRESET.
  check('every note is inside the preset\'s sampled range',
    pitches.every(p => p >= (preset?.loNote ?? 0) && p <= (preset?.hiNote ?? 127)),
    `${Math.min(...pitches)}..${Math.max(...pitches)} vs ${preset?.loNote}..${preset?.hiNote}`)
  check('and low in it', Math.min(...pitches) <= (preset?.loNote ?? 0) + 24)
  // A minor: the roots should be scale tones of A minor.
  const A_MINOR = new Set([9, 11, 0, 2, 4, 5, 7])
  check('the notes are in the song\'s key', pitches.every(p => A_MINOR.has(p % 12)),
    pitches.map(p => p % 12).join(','))
  // ⚠️ Held a full bar, each note would still be sounding when the next begins,
  // stacking voices for something nobody can hear.
  check('and each note stops short of the bar line',
    (clip?.notes ?? []).every(n => n.durationBeats < 4), String(clip?.notes?.[0]?.durationBeats))
  // Deterministic: the same sentence twice must give the same part.
  const again = run('put in a bassline using one of the darker sad piano presets')
  const p2 = (again.plan?.actions?.find(a => a.type === 'ADD_CLIP')?.clip?.notes ?? []).map(n => n.pitch)
  check('saying it twice writes the same part', JSON.stringify(pitches) === JSON.stringify(p2))
}

// ── an honest refusal beats a confident wrong sound ────────────────────────
{
  const none = matchPresetByCharacter(library, { words: ['gritty'], group: 'Woodwinds' })
  check('a character the library has not got in that group says so', none === null, JSON.stringify(none?.why))
}

// ── one sentence, more than one command ────────────────────────────────────
//
// ⚠️ Each of these did only ONE half before, and said nothing about the half it
// dropped. Silently doing less than was asked is the worst shape a voice
// command can take: nothing looks wrong.
{
  const cases = [
    ['mute the drums and set the tempo to 90', ['set_track', 'set_tempo']],
    ['mute the drums set the tempo to 90', ['set_track', 'set_tempo']],
    // "it" is the track the FIRST clause named — said a breath ago, in this
    // same sentence, which is the least ambiguous a pronoun ever gets.
    ['turn the bass up and pan it left', ['set_track', 'set_track']],
    // And here "it" is a track that did not exist when the sentence began.
    ['add a track called Keys and turn it down', ['add_track', 'set_track']],
  ]
  const wrong = []
  for (const [line, want] of cases) {
    const { calls } = run(line)
    const got = calls.map(c => c.name)
    if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`"${line}" → ${got.join('+') || 'nothing'}`)
  }
  check('a sentence with two commands in it does both', wrong.length === 0, wrong.join(' | '))

  // The name must survive, rather than swallowing the rest of the sentence.
  const { plan } = run('add a track called Keys and turn it down')
  check('and the new track is called what it was called',
    /called "Keys"/.test(plan?.say ?? ''), plan?.say)

  // ⚠️ A single command must NOT be split. The whole reason the bar is high.
  const single = run('turn the bass up')
  check('a plain single command is still one command',
    single.calls.length === 1 && single.calls[0].name === 'set_track',
    single.calls.map(c => c.name).join('+'))
}

console.log(failures ? `\n${failures} failing` : '\none sentence, as many steps as it takes')
assert.equal(failures, 0)
