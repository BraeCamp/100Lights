#!/usr/bin/env node
// Pointing at something beats having talked about something.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-selection.test.mjs
//
// Brae: "the voice control should keep track of what I'm selecting in case I
// say something like 'this track'. This would supersede context if the item is
// selected after the previous context was created."
//
// Two halves, and they fail differently. The LOCAL rules resolve "this track"
// from the selection directly, and that either works or reads nothing. The
// ASSISTANT holds up to forty previous messages, several of which may be about
// a track the user has since clicked away from — so the summary has to say not
// just what is selected but that it was selected AFTER the last reply, which is
// the one fact the model cannot work out for itself.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { interpret } = await importTs('lib/voice/interpret.ts')
const { musicStateSummary, MUSIC_SYSTEM_HINT } = await importTs('lib/voice/music-tools.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const tracks = [{ id: 't1', name: 'Bass' }, { id: 't2', name: 'Pad' }]
const project = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, tracks,
  arrangementClips: [
    { id: 'c1', trackId: 't2', kind: 'midi', name: 'Pad chords', startBeat: 0, durationBeats: 8, notes: [] },
  ],
}

// ── The local rules ────────────────────────────────────────────────────────
const say = (text, ctx) => interpret(text, { tracks, tempo: 120, ...ctx }).calls[0]

check('"mute this track" means the selected one',
  say('mute this track', { selectedTrackName: 'Pad' })?.input?.target === 'Pad',
  JSON.stringify(say('mute this track', { selectedTrackName: 'Pad' })?.input))

// ⚠️ A NAMED track still wins over the selection. Somebody who says a name has
// been specific, and overriding that with what happens to be highlighted would
// act on the wrong track while appearing to understand perfectly.
check('but a named track still beats the selection',
  say('mute the bass', { selectedTrackName: 'Pad' })?.input?.target === 'Bass',
  JSON.stringify(say('mute the bass', { selectedTrackName: 'Pad' })?.input))

check('and with nothing selected it refuses rather than guessing',
  !say('mute this track', {}), JSON.stringify(say('mute this track', {})))

check('"delete this clip" resolves the selected clip by id',
  say('delete this clip', { selectedClipId: 'c1' })?.input?.target === '#c1',
  JSON.stringify(say('delete this clip', { selectedClipId: 'c1' })?.input))

// ── What the assistant is told ─────────────────────────────────────────────
const stale = musicStateSummary({ ...project, selectedTrackId: 't2' })
const fresh = musicStateSummary({ ...project, selectedTrackId: 't2', selectionIsNew: true })

check('the summary always names the selected track', /Pad/.test(stale), stale.slice(0, 90))
// The whole point: without recency the model has two equally-confident sources
// — the selection and forty messages of conversation — and no rule for which
// wins.
check('and says so LOUDLY when it was selected just now',
  /SELECTED JUST NOW/.test(fresh) && !/SELECTED JUST NOW/.test(stale), fresh.slice(-140))
check('naming what "this" now means',
  /"this".*mean/i.test(fresh), '')
check('and that it supersedes the conversation',
  /supersedes/i.test(fresh), '')

const withClip = musicStateSummary({ ...project, selectedClipId: 'c1', selectionIsNew: true })
check('a clip selection is reported the same way',
  /SELECTED JUST NOW/.test(withClip) && /Pad chords/.test(withClip), withClip.slice(-120))

// Nothing selected is not a statement about anything.
check('nothing selected says nothing about recency',
  !/SELECTED JUST NOW/.test(musicStateSummary({ ...project, selectionIsNew: true })))

// The rule has to reach the model as a rule, not only as a one-off note in one
// turn's summary — the summary is evidence, the hint is the instruction.
check('the system hint tells the model pointing beats remembering',
  /POINTING BEATS REMEMBERING/.test(MUSIC_SYSTEM_HINT))

console.log(failures ? `\n${failures} failing` : '\nwhat you are pointing at wins')
assert.equal(failures, 0)
