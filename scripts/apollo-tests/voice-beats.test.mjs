#!/usr/bin/env node
// "Show me drum beats" plays them; it does not read them out.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-beats.test.mjs
//
// Brae: "When I ask the voice control to show me drum beats it tells me a bunch
// of beats. It should not do this. It shouldn't tell me what commands to say
// either, but it should instead activate the sounds of drum beats one after
// another. When showing I will be able to select one."
//
// ⚠️ THE WORD "BEATS" WAS NO KIND. The browse rule knew recipes and sounds, so
// the sentence fell through to the assistant, which had no way to play a beat
// and read the list of names out instead — and then, having nothing to place,
// explained what to say. Beats are the drum patterns; they play on the song's
// kit one after another, and "this one" puts the one playing on the drum track.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { interpret } = await importTs('lib/voice/interpret.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { beatItems, readBrowseCommand, BEAT_PASSES } = await importTs('lib/voice/audition.ts')
const { DRUM_PATTERNS, DEFAULT_KIT } = await importTs('lib/drum-presets.ts')

const ctx = { tracks: [{ id: 't1', name: 'Drums', volume: 0.8 }], tempo: 120, clips: [] }
const first = text => interpret(text, ctx).calls[0]

// ── the sentence is read by the rules, for free ────────────────────────────
{
  const c = first('show me drum beats')
  check('"show me drum beats" is a browse', c?.name === 'browse_sounds', JSON.stringify(c))
  check('of the beats', c?.input.kind === 'beats', JSON.stringify(c?.input))
  check('with "drum" as the kind, not a search', !c?.input.query, JSON.stringify(c?.input))

  const t = first('play me some trap beats')
  check('"play me some trap beats" browses the beats', t?.name === 'browse_sounds' && t?.input.kind === 'beats', JSON.stringify(t))
  check('looking for trap', t?.input.query === 'trap', JSON.stringify(t?.input))

  check('"what beats do you have" too', first('what beats do you have')?.input.kind === 'beats', JSON.stringify(first('what beats do you have')))

  // ⚠️ The sentences Brae ACTUALLY said, from the gaps table. Every one went
  // to the assistant, which browsed the drum SAMPLES by category instead.
  for (const said of ["Let's check out some different drum beats.", 'Show me some new drum beats.']) {
    const c2 = first(said)
    check(`"${said}" is every beat, for free`, c2?.name === 'browse_sounds' && c2.input.kind === 'beats' && !c2.input.query, JSON.stringify(c2))
  }
  const slow = first('Show me some drum beats, slower ones.')
  check('"slower ones" is the beats, narrowed to "slower"', slow?.input.kind === 'beats' && slow.input.query === 'slower', JSON.stringify(slow))
  check('"let me hear some grooves" too', first('let me hear some grooves')?.input.kind === 'beats', JSON.stringify(first('let me hear some grooves')))
  // The shelves it already knew are untouched.
  check('"show me the recipes" is still the recipes', first('show me the recipes')?.input.kind === 'recipes')
  check('"let me hear the drum samples" is still the sounds', first('let me hear the drum samples')?.input.kind === 'sounds', JSON.stringify(first('let me hear the drum samples')))
  check('and a beat with nothing asked is not a browse', first('the beats')?.name !== 'browse_sounds')
}

// ── the planner starts a browse with no filter ─────────────────────────────
{
  const project = { id: 'p', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, tracks: ctx.tracks, arrangementClips: [] }
  const plan = planVoiceCall({ name: 'browse_sounds', input: { kind: 'beats' } }, project)
  check('asking for the beats with no filter is a complete request', plan.actions?.length === 1, JSON.stringify(plan))
  check('that starts a browse of the beats', plan.actions?.[0]?.type === 'BROWSE' && plan.actions[0].kind === 'beats')
  check('and says so, briefly', /Finding beats/.test(plan.say ?? ''), plan.say)
}

// ── every pattern becomes something to hear ────────────────────────────────
{
  const items = beatItems(DRUM_PATTERNS, DEFAULT_KIT.instrument, 120)
  check('every drum pattern is a beat to play', items.length === DRUM_PATTERNS.length, `${items.length} of ${DRUM_PATTERNS.length}`)
  check('each is a beat', items.every(i => i.kind === 'beat'))
  check('with notes on the kit', items.every(i => i.notes.length > 0 && i.instrument.type === 'drum'))
  check("at the song's tempo", items.every(i => i.bpm === 120))
  const oneBar = items.filter(i => (DRUM_PATTERNS.find(p => p.id === i.patternId)?.bars ?? 1) === 1)
  check('one bar long for a one-bar pattern', oneBar.length > 0 && oneBar.every(i => i.durationBeats === 4))
  check('and goes round more than once when heard', BEAT_PASSES >= 2)
  const trap = beatItems(DRUM_PATTERNS, DEFAULT_KIT.instrument, 120, { query: 'trap' })
  check('"trap" narrows it to the trap ones',
    trap.length > 0 && trap.length < items.length && trap.every(i => /trap/i.test(`${i.name} ${i.detail} ${i.tags.join(' ')}`)), `${trap.length}`)
}

// ── choosing one ───────────────────────────────────────────────────────────
{
  for (const said of ['this one', 'use this one', 'add it', 'select that', 'i like that', 'keep it']) {
    check(`"${said}" picks`, readBrowseCommand(said) === 'pick')
  }
  check('"next" is still next', readBrowseCommand('next') === 'next')

  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  const pick = voice.slice(voice.indexOf("if (b === 'pick')"), voice.indexOf("if (b === 'pause')"))
  check('a pick puts a beat on the drum track',
    /it\.kind === 'beat'/.test(pick) && /isDrumClip: true/.test(pick) && /type: 'ADD_CLIP'/.test(pick))
  check('and opens it in the sequencer', /setExpandedStepSeqClipId\?\.\(clip\.id\)/.test(pick))
  check('a recipe lands on a new track with what it was heard on',
    /it\.kind === 'recipe'/.test(pick) && /setExpandedPianoRollClipId\?\.\(clip\.id\)/.test(pick))
  check('a sound lands as an audio clip', /makeAudioClip\(/.test(pick))
  check('and says where', /at bar \$\{barNo\}/.test(pick))

  const browse = voice.slice(voice.indexOf("if (act.type === 'BROWSE')"), voice.indexOf("if (act.type === 'VIEW_ACTION')"))
  check("the studio plays the beats on the song's kit",
    /beatItems\(getPatterns\(\)/.test(browse) && /DEFAULT_KIT\.instrument/.test(browse))
  check('and no longer recites the steering words', !/Say next, back/.test(browse))
  check('the steering words moved to the panel', /next · back · again · this one · done/.test(voice))

  const tools = readFileSync('lib/voice/music-tools.ts', 'utf8')
  check('the assistant is offered beats as a kind', /enum: \['sounds', 'recipes', 'beats', 'both'\]/.test(tools))
  check('and told never to read a list out instead', /NEVER answer a request to see or hear beats/.test(tools))
}

console.log(failures ? `\n${failures} failing` : '\nbeats are heard, not listed')
assert.equal(failures, 0)
