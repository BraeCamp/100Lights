#!/usr/bin/env node
// A place that was SAID but could not be read is a question, not bar 1.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-placing.test.mjs
//
// Brae, on a different argument of the same tool: "It didn't change the reverb
// ... but instead created a lowpass cutoff that did the shape that I wanted."
// The read-back was true, the drawing was correct, and it was the wrong thing.
//
// Every position in the planner used to be read as `positionToBeat(pos(i.at),
// maps) ?? 0` — so a position the model sent in a shape the app could not read
// ("the chorus", { marker: 'chorus' }, "bar 9" as a string) fell through to the
// start of the song, or to "the whole song" for the commands where an unstated
// place means everything. "Added a crash at bar 1" and "Tempo set to 128 bpm"
// were then true sentences about an edit nobody asked for.
//
// Three outcomes now, and these are the assertions:
//   nothing said        → the command's own rule for unstated (clip start,
//                         whole song, global tempo) — unchanged
//   readable, incl. a   → the place — and a section NAME is readable when a
//   marker's name         marker says where it is
//   unreadable          → a problem that says what WOULD read, and no edit

import { importTs } from '../lib/ts-import.mjs'
import { makeTrack, makeClip, makeNotes } from '../lib/daw-fixture.mjs'

const { planVoiceCall, planVoiceCalls, planVoiceCallsEach } = await importTs('lib/voice/execute-music.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const pad = makeTrack({ name: 'Pad' })
const bass = makeTrack({ name: 'Bass' })
const P = {
  id: 'p', name: 'S', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [pad, bass],
  arrangementClips: [
    makeClip({ trackId: pad.id, name: 'Pad 1', startBeat: 0, durationBeats: 32 }),
    makeClip({ trackId: bass.id, name: 'Bass 1', startBeat: 16, durationBeats: 16, notes: makeNotes(4) }),
  ],
  scenes: [], sessionGrid: {}, loopStart: 0, loopEnd: 16, loopEnabled: false, masterVolume: 1,
  automationLanes: [], clipEffects: [], returnTracks: [], takeLanes: [],
  crossfaderValue: 0.5, waveformZoom: 1, swing: 0,
  cueMarkers: [
    { id: 'm1', beat: 16, name: 'Chorus' },
    { id: 'm2', beat: 32, name: 'Drop' },
  ],
}
const plan = (name, input) => planVoiceCall({ name, input }, P)
const refused = (p) => !!p.problem && !p.actions.length

// ── insert_clip: no default sound, no default place ────────────────────────
{
  const named = plan('insert_clip', { sound: 'crash', at: 'the chorus' })
  const clip = named.actions.find(a => a.type === 'ADD_CLIP')?.clip
  check('a section name as a string is that section', !named.problem && clip?.startBeat === 16, named.problem)

  const obj = plan('insert_clip', { sound: 'crash', at: { marker: 'drop' } })
  check('{ marker } — a field the schema never advertised — is read, not refused',
    obj.actions.find(a => a.type === 'ADD_CLIP')?.clip?.startBeat === 32, obj.problem)

  const worded = plan('insert_clip', { sound: 'kick', at: 'bar 3', length: '2 bars' })
  const k = worded.actions.find(a => a.type === 'ADD_CLIP')?.clip
  check('"bar 3" and "2 bars" as strings read as bar 3 for 8 beats',
    k?.startBeat === 8 && k?.durationBeats === 8, worded.problem ?? JSON.stringify(k))
  check('and the read-back says the length in the unit it was said in', /2 bars/.test(worded.say), worded.say)

  const numeral = plan('insert_clip', { sound: 'crash', at: { bar: '5' } })
  check('a bar written as "5" is bar 5', numeral.actions.find(a => a.type === 'ADD_CLIP')?.clip?.startBeat === 16)

  const lost = plan('insert_clip', { sound: 'crash', at: 'somewhere near the end' })
  check('an unreadable place is refused, not bar 1', refused(lost), JSON.stringify(lost.actions))
  check('and the refusal says what would read', /bar number|section marker/.test(lost.problem ?? ''), lost.problem)

  const bare = plan('insert_clip', { sound: 'crash', at: 9 })
  check('a bare number is not a place (bar? beat? seconds?)', refused(bare), bare.say)

  const nowhere = plan('insert_clip', { sound: 'crash' })
  check('no place at all asks where', refused(nowhere) && /where/i.test(nowhere.problem), nowhere.problem)

  const nothing = plan('insert_clip', { at: { bar: 1 } })
  check('no sound is not a crash', refused(nothing) && /what to put/i.test(nothing.problem), nothing.problem)
}

// ── set_tempo: an unreadable place must not become the WHOLE-SONG tempo ────
{
  const global = plan('set_tempo', { bpm: 128 })
  check('no place: the song tempo', global.actions[0]?.type === 'SET_TEMPO')
  const at = plan('set_tempo', { bpm: 128, at: 'the chorus' })
  check('a section: a tempo marker there',
    at.actions[0]?.type === 'ADD_TEMPO_MARKER' && at.actions[0].marker.beat === 16, at.problem)
  const lost = plan('set_tempo', { bpm: 128, at: 'the bit after the solo' })
  check('an unreadable place is refused — NOT a global change', refused(lost), JSON.stringify(lost.actions))
}

// ── automate_parameter: start, length and the new `end` ────────────────────
{
  const sweep = (input) => plan('automate_parameter', { target: 'Pad', parameter: 'volume', from: 100, to: 20, ...input })
  const points = (p) => p.actions.filter(a => a.type === 'ADD_AUTOMATION_POINT').map(a => a.point.beat)

  const whole = sweep({})
  check('nothing said: over the clip', JSON.stringify(points(whole)) === '[0,32]', JSON.stringify(points(whole)))

  const fromSection = sweep({ start: 'the drop' })
  check('start as a section name starts there', points(fromSection)[0] === 32, fromSection.problem)

  const until = sweep({ start: { bar: 2 }, end: { bar: 6 } })
  check('"until bar 6" as an end is read as an end, not a length',
    JSON.stringify(points(until)) === '[4,20]', until.problem ?? JSON.stringify(points(until)))
  check('and the read-back says until', /until bar 6/.test(until.say), until.say)

  const backwards = sweep({ start: { bar: 6 }, end: { bar: 2 } })
  check('an end before the start is refused', refused(backwards) && /not after/.test(backwards.problem), backwards.problem)

  const lostStart = sweep({ start: 'somewhere' })
  check('an unreadable start is refused, not the clip start', refused(lostStart))
  const lostLen = sweep({ length: 'a while' })
  check('an unreadable length is refused, not the clip length', refused(lostLen) && /2 bars/.test(lostLen.problem), lostLen.problem)
  const wordedLen = sweep({ length: '4 beats' })
  check('a length in words is read', JSON.stringify(points(wordedLen)) === '[0,4]', wordedLen.problem)
}

// ── modulate: "from the chorus" that did not read used to modulate EVERYTHING
{
  const lost = plan('modulate', { semitones: 2, at: 'later on' })
  check('modulate with an unreadable place is refused', refused(lost), JSON.stringify(lost.actions))
  const from = plan('modulate', { semitones: 2, at: 'chorus' })
  check('modulate from a section name', !from.problem && from.actions.length > 0, from.problem)
}

// ── transport: no default action; locate reads worded places ───────────────
{
  const empty = plan('transport', {})
  check('a transport call with no action is a question, not play', refused(empty), empty.say)
  const worded = plan('transport', { action: 'locate', at: 'bar 9' })
  check('"bar 9" as a string locates bar 9',
    worded.actions[0]?.action === 'locate' && worded.actions[0].beat === 32, worded.problem)
  const section = plan('transport', { action: 'locate', at: 'the drop' })
  check('a section name locates the marker', section.actions[0]?.beat === 32, section.problem)
}

// ── the loop, split and marker follow the same rule ────────────────────────
{
  const loop = plan('set_loop_region', { start: 'chorus', end: 'drop' })
  check('a loop between two sections', loop.actions[0]?.start === 16 && loop.actions[0]?.end === 32, loop.problem)
  const lostLoop = plan('set_loop_region', { start: { bar: 1 }, end: 'the end of the song' })
  check('a loop with an unreadable end is refused', refused(lostLoop))

  const split = plan('split_clip', { target: 'Pad 1', at: 'the middle' })
  check('a split at an unreadable place is refused', refused(split))
  const splitAt = plan('split_clip', { target: 'Pad 1', at: 'chorus' })
  check('a split at a section', !splitAt.problem && splitAt.actions.length > 0, splitAt.problem)

  const marker = plan('add_marker', { name: 'Verse', at: 'roughly a third in' })
  check('a marker at an unreadable place is refused, not put at bar 1', refused(marker))
}

// ── the assistant's batch sees what earlier calls made ─────────────────────
{
  const calls = [
    { name: 'add_track', input: { name: 'Lead' } },
    { name: 'set_track', input: { target: 'Lead', muted: true } },
  ]
  const each = planVoiceCallsEach(calls, P)
  check('the second call finds the track the first one added',
    each.length === 2 && !each[0].problem && !each[1].problem, each[1]?.problem)
  const single = planVoiceCall(calls[1], P)
  check('(which it could not, planned against the original project)', !!single.problem)
  const together = planVoiceCalls(calls, P)
  check('and the local path agrees', !together.problem)
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
