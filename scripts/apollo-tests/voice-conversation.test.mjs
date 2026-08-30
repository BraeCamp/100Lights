#!/usr/bin/env node
// Asking, answering, and knowing when to keep quiet.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-conversation.test.mjs
//
// Brae: "if there's a bass track with 3 track items on it and one of them is
// named 'bass' then there would be confusion. The program would ask 'Do you mean
// the bass track, or the bass item on the bass track at bar 15?'... We'll have a
// lot more uses besides clarification, like giving tips."
//
// Three things are under test and they fail in opposite directions, which is
// what makes them worth testing together:
//
//   ASKING. The studio must ask when it genuinely has a choice — and must NOT
//   ask when it does not, because a system that checks everything is one people
//   stop reading. Most of what follows is the second half.
//
//   ANSWERING. People reply to a question with the shortest fragment that could
//   work — "the track", "bar 15", "the second one", "yes". None of those mean
//   anything as commands, which is exactly why answers are routed before the
//   parser and matched against the options that were offered.
//
//   REMARKING. A tip is only useful if it is rare. Each notice has to be true,
//   newly true, and hard to see on screen — so the suite checks silence at
//   least as hard as it checks the remarks.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { readYesNo, readChoice } = await importTs('lib/voice/ask.ts')
const { noticeFor } = await importTs('lib/voice/notices.ts')
const { shouldSpeak, spoken } = await importTs('lib/voice/speak.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── A project shaped exactly like Brae's example ────────────────────────────
// A track called Bass with three clips on it, one of which is also called bass.
const note = (i, pitch) => ({ id: `n${i}`, pitch, startBeat: i, durationBeats: 1, velocity: 100 })
const clip = (id, trackId, name, startBeat) => ({
  kind: 'midi', id, trackId, name, startBeat, durationBeats: 4,
  isDrumClip: false, notes: [note(0, 40), note(1, 40)],
})
const track = (id, name, extra = {}) => ({
  id, name, type: 'midi', color: '#888', volume: 0.8, pan: 0,
  mute: false, solo: false, armed: false, height: 80,
  effects: [], instrument: { type: 'poly', params: {} }, ...extra,
})

const base = {
  id: 'p', name: 'Fixture', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  scenes: [], sessionGrid: {}, loopStart: 0, loopEnd: 16, loopEnabled: false,
  masterVolume: 1, automationLanes: [], clipEffects: [], returnTracks: [],
  takeLanes: [], crossfaderValue: 0.5, waveformZoom: 1, swing: 0, cueMarkers: [],
}

const AMBIGUOUS = {
  ...base,
  tracks: [track('t1', 'Bass'), track('t2', 'Drums')],
  arrangementClips: [
    clip('c1', 't1', 'Intro', 0),      // bar 1
    clip('c2', 't1', 'Middle', 32),    // bar 9
    clip('c3', 't1', 'Bass', 56),      // bar 15 — same name as its track
  ],
}

const SIMPLE = {
  ...base,
  tracks: [track('t1', 'Bass'), track('t2', 'Drums')],
  arrangementClips: [clip('c1', 't1', 'Intro', 0), clip('c2', 't2', 'Beat', 0)],
}

const CTX = { tracks: AMBIGUOUS.tracks, tempo: 120 }

// ── It asks, and the question is the one he described ──────────────────────
const asked = planVoiceCall(
  interpret('loop the bass 3 more times', CTX).calls[0],
  AMBIGUOUS,
)
check('an ambiguous target produces a question, not a guess',
  !!asked.ask && asked.actions.length === 0,
  asked.ask ? asked.ask.speak : `no ask — ${asked.say || asked.problem}`)
check('the question offers the clip AND the track readings',
  (asked.ask?.options.length ?? 0) >= 2, String(asked.ask?.options.length))
check('and it names where each one is',
  /bar 15/.test(asked.ask?.speak ?? ''), asked.ask?.speak)

// The offer — the part that stops it being asked again.
check('it offers to fix the cause of the confusion',
  /rename/i.test(asked.ask?.offer?.speak ?? ''), asked.ask?.offer?.speak)
check('and knows what it would be renaming',
  asked.ask?.offer?.call?.name === 'rename_clip',
  JSON.stringify(asked.ask?.offer?.call))

// ── It does NOT ask when there is nothing to ask about ─────────────────────
const unambiguous = planVoiceCall(
  interpret('loop the bass 3 more times', { tracks: SIMPLE.tracks, tempo: 120 }).calls[0],
  SIMPLE,
)
check('one clip on the named track is not a question',
  !unambiguous.ask && unambiguous.actions.length > 0,
  unambiguous.ask ? unambiguous.ask.speak : `${unambiguous.actions.length} actions`)

// A command that names a TRACK cannot be ambiguous with a clip — you cannot
// mute a clip — so the mixer must never ask.
const muted = planVoiceCall(interpret('mute the bass', CTX).calls[0], AMBIGUOUS)
check('muting is never ambiguous, because clips cannot be muted',
  !muted.ask && muted.actions.length === 1, muted.ask?.speak ?? `${muted.actions.length} actions`)

// ── Answering the question ─────────────────────────────────────────────────
const options = asked.ask?.options ?? []
check('"the track" picks the track reading',
  options[readChoice('the track', options)]?.label?.includes('track') === true,
  options[readChoice('the track', options)]?.label)
check('"bar 15" picks the one at bar 15',
  /bar 15/.test(options[readChoice('bar 15', options)]?.label ?? ''),
  options[readChoice('bar 15', options)]?.label)
check('"the second one" counts', readChoice('the second one', options) === 1,
  String(readChoice('the second one', options)))
check('and something unrelated is not an answer',
  readChoice('what time is it', options) === null,
  String(readChoice('what time is it', options)))
check('nor is an answer that fits two options equally',
  readChoice('the bass', [
    { label: 'a', calls: [], keywords: ['bass'] },
    { label: 'b', calls: [], keywords: ['bass'] },
  ]) === null)

// ── Yes and no ─────────────────────────────────────────────────────────────
check('yes', readYesNo('yes please') === true)
check('yeah', readYesNo('yeah go on') === true)
check('no', readYesNo('no thanks') === false)
check('never mind', readYesNo('never mind') === false)
check('neither', readYesNo('mute the drums') === null)
// "no" wins over "yes" in a sentence containing both, because the safe reading
// of an ambiguous consent is the one that does nothing.
check('a muddled answer does not consent', readYesNo('yes no wait') === false)

// ── Tips: said when they matter ────────────────────────────────────────────
{
  const before = SIMPLE
  const after = { ...SIMPLE, tracks: [track('t1', 'Bass', { solo: true }), track('t2', 'Drums')] }
  check('a new solo is worth mentioning',
    /only bass/i.test(noticeFor(before, after) ?? ''), noticeFor(before, after))
}
{
  const before = SIMPLE
  const after = { ...SIMPLE, tracks: [track('t1', 'Bass', { mute: true }), track('t2', 'Drums', { mute: true })] }
  check('muting the last audible track is worth mentioning',
    /nothing will play/i.test(noticeFor(before, after) ?? ''), noticeFor(before, after))
}
{
  const before = SIMPLE
  const after = { ...SIMPLE, tracks: [track('t1', 'Bass', { volume: 0 }), track('t2', 'Drums')] }
  check('a track at zero is not the same as a muted one, and says so',
    /zero/i.test(noticeFor(before, after) ?? ''), noticeFor(before, after))
}
{
  // The one that heads off the whole feature: a collision, mentioned as it is
  // created rather than discovered later as a question.
  const before = SIMPLE
  const after = { ...SIMPLE, tracks: [...SIMPLE.tracks, track('t3', 'Bass')] }
  check('a duplicate track name is mentioned when it is created',
    /two tracks called/i.test(noticeFor(before, after) ?? ''), noticeFor(before, after))
}
{
  const before = SIMPLE
  const after = { ...SIMPLE, arrangementClips: [clip('c1', 't1', 'Bass', 0), SIMPLE.arrangementClips[1]] }
  check('so is a clip named after its own track',
    /same name as its track/i.test(noticeFor(before, after) ?? ''), noticeFor(before, after))
}

// ── Tips: NOT said the rest of the time ────────────────────────────────────
//
// The half that decides whether any of this is bearable.
check('an ordinary change is not remarked on', noticeFor(SIMPLE, SIMPLE) === null,
  noticeFor(SIMPLE, SIMPLE))
{
  const soloed = { ...SIMPLE, tracks: [track('t1', 'Bass', { solo: true }), track('t2', 'Drums')] }
  const stillSoloed = { ...soloed, tempo: 130 }
  check('a solo already in place is not mentioned again',
    noticeFor(soloed, stillSoloed) === null, noticeFor(soloed, stillSoloed))
}
{
  const before = { ...SIMPLE, tracks: [track('t1', 'Bass', { mute: true }), track('t2', 'Drums')] }
  const after = { ...SIMPLE, tracks: [track('t1', 'Bass'), track('t2', 'Drums')] }
  check('unmuting is not a warning', noticeFor(before, after) === null, noticeFor(before, after))
}
{
  const dupes = { ...SIMPLE, tracks: [...SIMPLE.tracks, track('t3', 'Bass')] }
  const stillDupes = { ...dupes, tempo: 100 }
  check('a collision already there is not re-announced',
    noticeFor(dupes, stillDupes) === null, noticeFor(dupes, stillDupes))
}

// ── Knowing when to keep quiet ─────────────────────────────────────────────
check('a report waits for the music to stop',
  shouldSpeak('Bass: muted.', { kind: 'report', playing: true }) === false)
check('but a question does not — it is waiting for an answer',
  shouldSpeak('Which one?', { kind: 'question', playing: true }) === true)
check('nor does a problem', shouldSpeak('No track called that.', { kind: 'problem', playing: true }) === true)
check('and nothing is said into an open microphone',
  shouldSpeak('Which one?', { kind: 'question', listening: true }) === false,
  'it would transcribe itself')
check('silence is not spoken', shouldSpeak('   ', {}) === false)

// ── Written to be read, spoken to be heard ─────────────────────────────────
check('quotes are not read aloud', !spoken('Renamed "Pad" to "Strings".').includes('"'))
check('a meter is read as numbers, not a fraction',
  spoken('Now in 3/4.').includes('3 4'), spoken('Now in 3/4.'))
check('a bar and beat get a pause between them',
  /bar 5, beat/.test(spoken('Moved to bar 5 beat 3')), spoken('Moved to bar 5 beat 3'))

console.log(failures
  ? `\n${failures} failing`
  : '\nit asks when it should, answers what it is told, and stays quiet otherwise')
assert.equal(failures, 0)
