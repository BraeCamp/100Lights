#!/usr/bin/env node
// Opening the sequencer and the piano roll by voice, and asking to record.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-editors.test.mjs
//
// Brae: "make it so that users can have the voice control, Light, open
// sequencers and piano rolls and create new ones."
//
// voice-take.test.mjs covers what a spoken take BECOMES. This covers getting
// there: which clip an editor opens on, what a new one brings with it, and that
// asking to record hands the studio everything it needs to run the take.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')
const { clearVocab, drumForWord } = await importTs('lib/voice/vocab.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const project = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [
    { id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} } },
    { id: 'tp', name: 'Pad', instrument: { type: 'poly', params: {} } },
  ],
  arrangementClips: [
    { id: 'cd', trackId: 'td', kind: 'midi', name: 'Beat', startBeat: 0, durationBeats: 4, notes: [] },
    { id: 'cp', trackId: 'tp', kind: 'midi', name: 'Pad chords', startBeat: 0, durationBeats: 8, notes: [] },
  ],
}
const empty = { tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, tracks: [], arrangementClips: [] }
const types = plan => plan.actions.map(a => a.type)
const find = (plan, t) => plan.actions.find(a => a.type === t)

// ── Opening what is already there ──────────────────────────────────────────
{
  const seq = planVoiceCall({ name: 'open_editor', input: { editor: 'sequencer', target: 'drums' } }, project)
  check('the sequencer opens on the drum clip',
    find(seq, 'OPEN_EDITOR')?.clipId === 'cd', JSON.stringify(find(seq, 'OPEN_EDITOR')))
  check('and nothing is created', !types(seq).includes('ADD_CLIP'), types(seq).join())

  const roll = planVoiceCall({ name: 'open_editor', input: { editor: 'pianoroll', target: 'pad' } }, project)
  check('the piano roll opens on the pad clip',
    find(roll, 'OPEN_EDITOR')?.clipId === 'cp' && find(roll, 'OPEN_EDITOR')?.editor === 'pianoroll',
    JSON.stringify(find(roll, 'OPEN_EDITOR')))

  const missing = planVoiceCall({ name: 'open_editor', input: { editor: 'sequencer', target: 'trombone' } }, project)
  check('an unknown target refuses', !!missing.problem, missing.problem ?? '')
}

// ── Creating a new one ─────────────────────────────────────────────────────
{
  const made = planVoiceCall({ name: 'open_editor', input: { editor: 'sequencer', create: true } }, empty)
  check('a new sequencer builds a track and a clip',
    types(made).join() === 'ADD_TRACK,SET_INSTRUMENT,ADD_CLIP,OPEN_EDITOR', types(made).join())
  // ⚠️ The instrument is the whole difference between a step sequencer and a
  // grid of chromatic pitches that looks identical and sounds like nothing.
  check('and the new track is a drum kit',
    find(made, 'SET_INSTRUMENT')?.instrument?.type === 'drum',
    String(find(made, 'SET_INSTRUMENT')?.instrument?.type))
  check('opening the clip it just made',
    find(made, 'OPEN_EDITOR')?.clipId === find(made, 'ADD_CLIP')?.clip?.id)

  const roll = planVoiceCall({ name: 'open_editor', input: { editor: 'pianoroll', create: true } }, empty)
  check('a new piano roll does NOT get a drum kit',
    find(roll, 'SET_INSTRUMENT') === undefined, types(roll).join())
}

// ── Asking to record ───────────────────────────────────────────────────────
{
  const rec = planVoiceCall({ name: 'record_take', input: { editor: 'sequencer', target: 'drums' } }, project)
  const take = find(rec, 'RECORD_TAKE')
  check('recording opens the editor first', types(rec).join() === 'OPEN_EDITOR,RECORD_TAKE', types(rec).join())
  check('and hands over the clip', take?.clipId === 'cd', JSON.stringify(take))
  // ⚠️ Deliberately silent. The studio's next words are the question about the
  // click, and saying something here would talk over it.
  check('it says nothing yet — the question comes next', rec.say === '', JSON.stringify(rec.say))

  const kick = planVoiceCall({ name: 'record_take', input: { editor: 'sequencer', drum: 'kick' } }, project)
  check('one drum at a time is passed through', find(kick, 'RECORD_TAKE')?.lane === 'kick',
    String(find(kick, 'RECORD_TAKE')?.lane))

  const hat = planVoiceCall({ name: 'record_take', input: { editor: 'sequencer', drum: 'closed hi hat' } }, project)
  check('however the drum is named', find(hat, 'RECORD_TAKE')?.lane === 'closedHat',
    String(find(hat, 'RECORD_TAKE')?.lane))

  const nonsense = planVoiceCall({ name: 'record_take', input: { editor: 'sequencer', drum: 'kazoo' } }, project)
  check('an unknown drum refuses rather than recording the wrong lane',
    !!nonsense.problem, nonsense.problem ?? '')
}

// ── Shorthand, through the planner ─────────────────────────────────────────
{
  clearVocab()
  const def = planVoiceCall(
    { name: 'define_word', input: { phrase: 'ta means closed hi hat, and cha means snare' } },
    project,
  )
  check('a definition is accepted', /ta/.test(def.say) && /snare/.test(def.say), def.say)
  check('and takes effect immediately', drumForWord('ta') === 'closedHat', String(drumForWord('ta')))
  check('it reports a change even though the song did not', types(def).join() === 'VOCAB', types(def).join())

  const bad = planVoiceCall({ name: 'define_word', input: { phrase: 'make it louder' } }, project)
  check('a sentence with no definition in it refuses', !!bad.problem, bad.problem ?? '')

  planVoiceCall({ name: 'define_word', input: { clear: true } }, project)
  check('clearing gives the built-ins back', drumForWord('ta') === 'snare', String(drumForWord('ta')))
}

// ── The words that reach all this without the assistant ────────────────────
{
  const ctx = { tracks: project.tracks, tempo: 120 }
  const say = t => interpret(t, ctx).calls[0]
  check('"open the sequencer" is read locally', say('open the sequencer')?.name === 'open_editor',
    String(say('open the sequencer')?.name))
  check('"show me the piano roll" too',
    say('show me the piano roll')?.input?.editor === 'pianoroll',
    JSON.stringify(say('show me the piano roll')?.input))
  check('"make a new sequencer" creates',
    say('make a new sequencer')?.input?.create === true,
    JSON.stringify(say('make a new sequencer')?.input))
  check('"record a beat" is a take', say('record a beat')?.name === 'record_take',
    String(say('record a beat')?.name))
  // Naming a drum is naming the sequencer — the most natural way to ask.
  check('"record the kick" is one lane', say('record the kick')?.input?.drum === 'kick',
    JSON.stringify(say('record the kick')?.input))
  check('"ta means closed hi hat" is a definition',
    say('ta means closed hi hat')?.name === 'define_word',
    String(say('ta means closed hi hat')?.name))
  // ⚠️ "one means C major" is a shorthand, not a key change, and they are the
  // same words apart from what the sentence does with them.
  check('"one means C major" defines rather than sets the key',
    say('one means C major')?.name === 'define_word',
    String(say('one means C major')?.name))
  check('but "put it in C major" still sets the key',
    say('put it in c major')?.name === 'set_key_scale',
    String(say('put it in c major')?.name))
  clearVocab()
}

console.log(failures ? `\n${failures} failing` : '\nthe editors open, and a take can be asked for')
assert.equal(failures, 0)
