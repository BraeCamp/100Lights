#!/usr/bin/env node
// The three new voice tools: a beat from your voice, the click, and "what am I
// hearing".
//
//   node --experimental-strip-types scripts/apollo-tests/voice-beat.test.mjs
//
// Brae: "We're going to wire metronome and tuner into it and people can ask
// what notes are being played... the user can say something like 'I want to
// make a beat like boom ka boom boom ka'."
//
// beatbox.test.mjs covers the parsing. This covers the part that can be wired
// up wrong without the parser noticing: whether the TIMINGS survive the trip
// from the microphone to the planner, and whether the actions produced are a
// drum part rather than a synth playing GM pitches.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const project = {
  tempo: 120,
  timeSignatureNum: 4,
  timeSignatureDen: 4,
  tracks: [
    { id: 'tb', name: 'Bass', instrument: { type: 'poly', params: {} } },
    { id: 'tp', name: 'Pad', instrument: { type: 'poly', params: {} } },
  ],
  arrangementClips: [
    { id: 'cb', trackId: 'tb', kind: 'midi', name: 'Bass line', startBeat: 0, durationBeats: 16,
      notes: [{ id: 'n1', pitch: 40, startBeat: 0, durationBeats: 4, velocity: 100 }] },
    { id: 'cp', trackId: 'tp', kind: 'midi', name: 'Pad', startBeat: 0, durationBeats: 16,
      notes: [
        { id: 'n2', pitch: 52, startBeat: 0, durationBeats: 4, velocity: 90 },
        { id: 'n3', pitch: 55, startBeat: 0, durationBeats: 4, velocity: 90 },
        { id: 'n4', pitch: 59, startBeat: 0, durationBeats: 4, velocity: 90 },
      ] },
  ],
}
const types = plan => plan.actions.map(a => a.type)

// ── "I want to make a beat like boom ka boom boom ka" ──────────────────────
//
// The microphone heard the whole sentence, with times. The model relays only
// the syllables it recognised — so if the wiring is wrong, the beat silently
// falls back to even spacing and still looks like it worked.
const heard = {
  words: 'I want to make a beat like boom ka boom boom ka'.split(' ').map((word, i) => ({
    word, confidence: 0.9,
    // The beat itself, said on 1, the & of 1, 2, 3, the & of 3.
    s: i < 7 ? i * 0.2 : [10.0, 10.25, 10.5, 11.0, 11.25][i - 7],
  })),
}
const beat = planVoiceCall(
  { name: 'make_beat', input: { pattern: 'boom ka boom boom ka' } },
  project,
  heard,
)
check('it makes a track, an instrument and a clip',
  types(beat).join() === 'ADD_TRACK,SET_INSTRUMENT,ADD_CLIP', types(beat).join())
// ⚠️ Without the drum instrument these notes are GM pitches on a synth — a
// bass playing C1 and D1, not a kick and a snare. It looks right in the
// piano roll and sounds nothing like a beat.
check('and the instrument is a drum kit',
  beat.actions[1].instrument?.type === 'drum', String(beat.actions[1].instrument?.type))

const clip = beat.actions[2].clip
check('the clip is a bar long', clip.durationBeats === 4, String(clip.durationBeats))
check('with one note per syllable', clip.notes.length === 5, String(clip.notes.length))
check('kick and snare, in the order they were said',
  clip.notes.map(n => n.pitch).join() === '36,38,36,36,38', clip.notes.map(n => n.pitch).join())

// THE point of the feature. 0, 0.5, 1, 2, 2.5 beats is the rhythm that was
// spoken; evenly spaced would be 0, 0.5, 1, 1.5, 2.
check('placed in the rhythm it was SAID, not evenly',
  clip.notes.map(n => n.startBeat).join() === '0,0.5,1,2,2.5',
  clip.notes.map(n => n.startBeat).join())
check('and it says so', /rhythm you said/.test(beat.say), beat.say)

// ── The same words with no timings ─────────────────────────────────────────
const typed = planVoiceCall({ name: 'make_beat', input: { pattern: 'boom ka boom boom ka' } }, project)
check('a typed beat still works', types(typed).includes('ADD_CLIP'))
check('but is evenly spaced', typed.actions.at(-1).clip.notes.map(n => n.startBeat).join() === '0,0.5,1,1.5,2',
  typed.actions.at(-1).clip.notes.map(n => n.startBeat).join())
// ⚠️ Admitting this matters. An evenly spaced beat is NOT what they said, and
// reporting it as success is how someone learns not to trust the feature.
check('and it admits the timing was guessed', /evenly spaced/.test(typed.say), typed.say)

// ── An existing drum track is reused, not duplicated ───────────────────────
const withDrums = { ...project, tracks: [...project.tracks, { id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} } }] }
const reuse = planVoiceCall({ name: 'make_beat', input: { pattern: 'boom ka' } }, withDrums)
check('an existing drum track is used', !types(reuse).includes('ADD_TRACK'), types(reuse).join())
check('and the clip lands on it', reuse.actions[0].clip.trackId === 'td', reuse.actions[0].clip.trackId)

// ── Nothing percussive was said ────────────────────────────────────────────
const nonsense = planVoiceCall({ name: 'make_beat', input: { pattern: 'make it louder please' } }, project)
check('a sentence with no drum sounds is refused', !!nonsense.problem, nonsense.problem ?? 'no problem raised')
check('and nothing is added', nonsense.actions.length === 0)

// ── The click ──────────────────────────────────────────────────────────────
const on = planVoiceCall({ name: 'metronome', input: { on: true } }, project)
check('the metronome turns on', types(on).join() === 'METRONOME' && on.actions[0].on === true, JSON.stringify(on.actions))
const off = planVoiceCall({ name: 'metronome', input: { on: false } }, project)
check('and off', off.actions[0].on === false, JSON.stringify(off.actions))

// ── "what notes are being played" ──────────────────────────────────────────
const atPad = planVoiceCall({ name: 'name_notes', input: {} }, project, { atBeat: 2 })
check('it names what is sounding at the playhead',
  /E3/.test(atPad.say) && /G3/.test(atPad.say) && /B3/.test(atPad.say), atPad.say)
check('and names the chord', /Em/.test(atPad.say), atPad.say)
check('naming notes changes nothing', atPad.actions.length === 0)

const namedTrack = planVoiceCall({ name: 'name_notes', input: { target: 'pad' } }, project)
check('a named track is answered without a playhead', /E3/.test(namedTrack.say), namedTrack.say)

// ⚠️ Two different questions wear the same words. Answering "what is in this
// song" when they asked "what is playing right now" is confidently wrong, and
// looks exactly like the right answer.
const noWhere = planVoiceCall({ name: 'name_notes', input: {} }, project)
check('without a playhead or a target it says it cannot see',
  /playhead/.test(noWhere.say), noWhere.say)

const quiet = planVoiceCall({ name: 'name_notes', input: {} }, project, { atBeat: 40 })
check('and silence is reported as silence', /Nothing pitched/.test(quiet.say), quiet.say)

console.log(failures ? `\n${failures} failing` : '\na spoken beat becomes drums, the click answers, and the studio can name what it plays')
assert.equal(failures, 0)
