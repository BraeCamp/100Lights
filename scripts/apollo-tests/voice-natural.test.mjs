#!/usr/bin/env node
// Sentences people actually say.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-natural.test.mjs
//
// Brae: "'I want a more gradual introduction to the song so let's add a
// descending filter to Bass body 1' can be interpreted as 'Add descending filter
// to Bass (track) body 1 (item)'." And: "if we can make the system be more
// conducive to this kind of command without adding too many separate commands
// that mean the same thing."
//
// That second sentence is the design constraint, and it rules out the obvious
// approach. Adding a phrasing for every way of saying a thing gives you forty
// commands that mean eight things, all of which have to be kept in step with
// each other, and it still fails on the forty-first sentence.
//
// So nothing here was fixed by adding commands. Three changes to the shared
// machinery, each of which every command inherits:
//
//   THE REASON IS NOT THE COMMAND. People say why before they say what, and the
//   why is a whole clause of good English with no instruction in it. Both halves
//   of a joined sentence are now offered and the existing scoring picks — which
//   also handles the reason coming SECOND, where guessing would have failed.
//
//   A TRACK AND AN ITEM ARE ONE TARGET. "Bass body 1" is the most specific thing
//   anybody can say and was the one form that could not be read: it matched no
//   track and no clip, so it was narrowed to "Bass" and the half that made it
//   unambiguous was thrown away.
//
//   A LENGTH IS OPTIONAL. "Fade the pad in" over what? Over the pad. The
//   executor already defaulted to the clip's own length; only the rule was
//   demanding a duration nobody says.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { interpretHeard } = await importTs('lib/voice/interpret.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { clauseCandidates } = await importTs('lib/voice/hypotheses.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const note = (i, p) => ({ id: `n${i}`, pitch: p, startBeat: i, durationBeats: 1, velocity: 100 })
const clip = (id, trackId, name, startBeat) => ({
  kind: 'midi', id, trackId, name, startBeat, durationBeats: 8, isDrumClip: false,
  notes: [note(0, 40), note(1, 42)],
})
const track = (id, name) => ({
  id, name, type: 'midi', color: '#888', volume: 0.8, pan: 0, mute: false, solo: false,
  armed: false, height: 80, effects: [], instrument: { type: 'poly', params: {} },
})

const PROJECT = {
  id: 'p', name: 'F', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [track('t1', 'Bass'), track('t2', 'Drums'), track('t3', 'Pad')],
  arrangementClips: [
    clip('c1', 't1', 'Body 1', 0),
    clip('c2', 't1', 'Body 2', 32),
    clip('c3', 't2', 'Beat', 0),
    clip('c4', 't3', 'Wash', 0),
  ],
  scenes: [], sessionGrid: {}, loopStart: 0, loopEnd: 16, loopEnabled: false, masterVolume: 1,
  automationLanes: [], clipEffects: [], returnTracks: [], takeLanes: [], crossfaderValue: 0.5,
  waveformZoom: 1, swing: 0, cueMarkers: [],
}
const CTX = {
  tracks: PROJECT.tracks,
  tempo: 120,
  clips: PROJECT.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId })),
}

/** Say it the way a person would, and see what the studio would do. */
const said = text => {
  const r = interpretHeard({ text, confidence: 0.95 }, CTX)
  const plan = r.calls.length ? planVoiceCall(r.calls[0], PROJECT) : null
  return { ...r, input: r.calls[0]?.input, plan }
}

// ── The sentence he wrote ───────────────────────────────────────────────────
{
  const r = said("I want a more gradual introduction to the song so let's add a descending filter to Bass body 1")
  check('the whole sentence resolves', r.matched === 'automate_parameter.filter', r.matched)
  check('to the item, not just the track', r.input?.target === 'Bass Body 1', JSON.stringify(r.input))
  check('sweeping downwards', r.input?.from === 100 && r.input?.to === 0, JSON.stringify(r.input))
  check('and it produces real actions',
    !!r.plan && !r.plan.problem && r.plan.actions.length > 0,
    r.plan?.problem ?? `${r.plan?.actions.length} actions`)
  check('over the clip, since no length was given',
    /Body 1/.test(r.plan?.say ?? ''), r.plan?.say)
}

// ── The reason, either side of the command ─────────────────────────────────
//
// Both directions, because guessing which half is the instruction is exactly
// what this must not do.
{
  const after = said("i think it's too busy so let's mute the drums")
  check('a reason BEFORE the command', after.input?.target === 'Drums' && after.input?.muted === true,
    JSON.stringify(after.input))
  const before = said('mute the drums so i can hear the bass')
  check('and a reason AFTER it', before.input?.target === 'Drums' && before.input?.muted === true,
    JSON.stringify(before.input))
}
{
  // The one that proves the halves are genuinely being weighed rather than the
  // last clause taken: "more" in the reason is a volume word, and the plain
  // reading of the whole sentence turns it into a fader move.
  const r = said('i want more space so fade the drums out')
  check('a reason containing a command word does not become the command',
    r.matched === 'automate_parameter.fade', r.matched)
}
{
  const r = said('lets take the bass body 2 up an octave')
  check('a leading "let\'s" is not part of the command',
    r.input?.target === 'Bass Body 2' && r.input?.semitones === 12, JSON.stringify(r.input))
}

// ── Naming a track and an item ─────────────────────────────────────────────
{
  const r = said('mute the drums')
  check('naming only a track still means the track', r.input?.target === 'Drums',
    JSON.stringify(r.input))
}
{
  // The digit in "Body 2" is a NAME, not an argument — the same class of bug as
  // "Bass 2", and the reason the compound is read before numbers are stripped.
  const r = said('duplicate the bass body 2')
  check('a number inside an item name is part of the name',
    r.input?.target === 'Bass Body 2', JSON.stringify(r.input))
}
{
  const r = said('take the bass body 1 up 3 semitones')
  check('and an argument alongside it is still an argument',
    r.input?.target === 'Bass Body 1' && r.input?.semitones === 3, JSON.stringify(r.input))
}
{
  // A track named with no item after it is not a compound.
  const r = said('fade the pad in')
  check('a length is optional', r.matched === 'automate_parameter.fade', r.matched)
  check('and it fades the right way', r.input?.from === 0 && r.input?.to === 100,
    JSON.stringify(r.input))
}

// ── A swept filter is not a switch ─────────────────────────────────────────
{
  // "add ... filter" reads as add_effect until the direction word is noticed,
  // and then it is unmistakably a sweep. Both effect rules stand aside.
  const r = said('put a rising filter on the pad')
  check('a direction word makes it a sweep, not a static effect',
    r.matched === 'automate_parameter.filter' && r.input?.from === 0 && r.input?.to === 100,
    `${r.matched} ${JSON.stringify(r.input)}`)
  const plain = said('put reverb on the pad')
  check('while a plain effect is still a plain effect',
    plain.matched === 'add_effect', plain.matched)
}

// ── Naming the object is not a different command ──────────────────────────
//
// Brae: "I was telling the voice control to 'Start the song' and it didn't know
// what that meant, but it understood start."
//
// The transport rule demanded every word be one of seven, so the extra word —
// not a track, not another command, not noise, just the OBJECT — made it
// refuse. The fix is one shared vocabulary for the thing a transport command
// acts on: every transport rule gains it at once and no rule gains a phrasing.
for (const [phrase, action] of [
  ['start the song', 'play'],
  ['play the song', 'play'],
  ['start the track', 'play'],
  ['play the music', 'play'],
  ['play it back', 'play'],
  ['start playback of the song', 'play'],
  ['play the whole thing', 'play'],
  ['stop the song', 'stop'],
  ['pause the song', 'pause'],
  ['restart the song', 'restart'],
]) {
  const r = said(phrase)
  check(`"${phrase}" is the transport`,
    r.calls[0]?.name === 'transport' && r.calls[0]?.input?.action === action,
    `${r.matched} ${JSON.stringify(r.input)}`)
}
{
  // And it EXPLAINS the extra word rather than tolerating it, so the reading
  // scores like the complete one it is.
  const r = said('start the song')
  const win = r.candidates.find(c => c.id === r.matched)
  check('and the object counts as read', win?.coverage === 1, String(win?.coverage))
}

// ── Without letting anything else in ──────────────────────────────────────
//
// The whole risk of loosening a guard. A word that NAMES something, or belongs
// to another command, is still a reason to decline.
{
  const r = said('play the bass louder')
  check('a track name still keeps it out of the transport',
    r.matched !== 'transport.play' && r.input?.target === 'Bass', r.matched)
}
{
  const r = said('play the drums twice')
  check("and so does another command's work", r.matched !== 'transport.play',
    `${r.matched} ${JSON.stringify(r.input)}`)
}
for (const nonsense of [
  'play me something jazzy',
  'play something with more energy',
  'start writing a bassline',
]) {
  const r = said(nonsense)
  check(`still refuses: "${nonsense}"`, r.calls.length === 0,
    `${r.matched} ${JSON.stringify(r.input ?? null)}`)
}

// ── Asking about the music ────────────────────────────────────────────────
//
// Brae: "I want to be able to ask questions about the track. Things like 'What
// note is pad a playing in?' or 'What are the filters on bass 1?'. Is voice
// control wired in enough to see and respond to things like this?"
//
// It is, and it always was: the executor is handed the whole project — every
// note with its pitch and timing, every effect with its parameters, every
// automation lane — so these are arithmetic on data already in the room. What
// was missing was somebody asking.
{
  const RICH = {
    ...PROJECT,
    tracks: [
      { ...track('t1', 'Pad A') },
      {
        ...track('t2', 'Bass 1'),
        effects: [
          { id: 'e1', type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 820, q: 1 } },
          { id: 'e2', type: 'reverb', params: { enabled: true, wet: 0.3, decay: 2, preDelay: 0.02 } },
        ],
      },
    ],
    arrangementClips: [
      // An A-minor triad, then F major.
      {
        kind: 'midi', id: 'k1', trackId: 't1', name: 'Wash', startBeat: 0,
        durationBeats: 8, isDrumClip: false,
        notes: [
          { id: 'a', pitch: 57, startBeat: 0, durationBeats: 4, velocity: 100 },
          { id: 'b', pitch: 60, startBeat: 0, durationBeats: 4, velocity: 100 },
          { id: 'c', pitch: 64, startBeat: 0, durationBeats: 4, velocity: 100 },
          { id: 'd', pitch: 53, startBeat: 4, durationBeats: 4, velocity: 100 },
          { id: 'e', pitch: 57, startBeat: 4, durationBeats: 4, velocity: 100 },
          { id: 'f', pitch: 60, startBeat: 4, durationBeats: 4, velocity: 100 },
        ],
      },
      // A bass on one note.
      {
        kind: 'midi', id: 'k2', trackId: 't2', name: 'Body 1', startBeat: 0,
        durationBeats: 8, isDrumClip: false,
        notes: [
          { id: 'g', pitch: 33, startBeat: 0, durationBeats: 1, velocity: 100 },
          { id: 'h', pitch: 33, startBeat: 2, durationBeats: 1, velocity: 100 },
        ],
      },
    ],
    automationLanes: [{
      id: 'l1', trackId: 't1', parameter: 'volume', label: 'Volume',
      min: 0, max: 1, defaultValue: 0.8, expanded: false,
      points: [{ id: 'p1', beat: 0, value: 0 }, { id: 'p2', beat: 8, value: 1 }],
    }],
  }
  const rich = {
    tracks: RICH.tracks, tempo: 120,
    clips: RICH.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId })),
  }
  const ask = q => {
    const r = interpretHeard({ text: q, confidence: 0.95 }, rich)
    return {
      matched: r.matched,
      say: r.calls.length ? (planVoiceCall(r.calls[0], RICH).say || planVoiceCall(r.calls[0], RICH).problem) : '',
    }
  }

  {
    // His first question, and the analysis is real: three notes starting
    // together are a chord, and the studio names it.
    const a = ask('what note is pad a playing')
    check('"what note is pad a playing" is answered',
      a.matched === 'describe.notes', a.matched)
    check('and it names the chords, not a list of pitches',
      /Am/.test(a.say) && /F/.test(a.say), a.say)
    check('with the range it covers', /F3 to E4/.test(a.say), a.say)
  }
  {
    // His second, and the useful part is the SETTING — "there is a filter" is
    // not what anybody means by the question.
    const b = ask('what are the filters on bass 1')
    check('"what are the filters on bass 1" is answered',
      b.matched === 'describe.effects', b.matched)
    check('and it says what the filter is doing, not just that it exists',
      /lowpass at 820/.test(b.say), b.say)
    check('and everything else on the track', /reverb at 30%/.test(b.say), b.say)
  }
  {
    const c = ask('what notes are in the bass 1')
    check('a part on one note says so rather than giving a range',
      /plays A/.test(c.say), c.say)
  }
  {
    const d = ask('what automation is on the pad a')
    check('automation is answerable too',
      d.matched === 'describe.automation' && /Volume with 2 points/.test(d.say),
      `${d.matched} — ${d.say}`)
  }
  {
    const e = ask('what is on the bass 1')
    check('and the loose form of the question still finds the rack',
      e.matched === 'describe.effects' && /lowpass/.test(e.say), `${e.matched} — ${e.say}`)
  }
}

// ── Editing the performance ───────────────────────────────────────────────
//
// Brae: "I need to be able to fully edit using voice controls." Arrangement and
// mix were covered; the performance — what the notes actually do — was not.
{
  const off = { ...PROJECT }
  const edits = q => {
    const r = interpretHeard({ text: q, confidence: 0.95 }, CTX)
    return { matched: r.matched, input: r.calls[0]?.input }
  }
  for (const [phrase, id] of [
    ['quantize the drums', 'quantize'],
    ['tighten up the drums', 'quantize'],
    ['make the drums softer', 'set_velocity'],
    ['play the bass 2 harder', 'set_velocity'],
    ['split the bass 2 at bar 3', 'split_clip'],
    ['make the pad 8 bars long', 'resize_clip'],
    ['take the reverb off the drums', 'remove_effect'],
    ['delete the chorus marker', 'remove_marker'],
  ]) {
    check(`"${phrase}" → ${id}`, edits(phrase).matched === id, edits(phrase).matched)
  }
  {
    // "Softer" belongs to the performance, "quieter" to the fader. They are
    // different edits with different results, and the studio used to treat both
    // as the fader.
    check('"softer" moves the notes, not the fader',
      edits('make the drums softer').matched === 'set_velocity')
    check('while "quieter" still moves the fader',
      edits('make the drums quieter').matched === 'set_track.volume.relative',
      edits('make the drums quieter').matched)
  }
  {
    const q = edits('quantize the bass 2 to eighth notes')
    check('an eighth-note grid is read as one', q.input?.division === 0.5,
      JSON.stringify(q.input))
  }
}

// ── The splitting itself stays modest ──────────────────────────────────────
check('a short sentence is not split at all', clauseCandidates('mute the drums').length === 0)
check('and a long one yields a handful, not a cross-product',
  clauseCandidates("i want a gradual intro so let's add a filter then play it").length <= 6,
  String(clauseCandidates("i want a gradual intro so let's add a filter then play it").length))

// ── And ordinary conversation is still ignored ─────────────────────────────
//
// The risk of reading half-sentences: more chances to find a command in
// something that was not one.
for (const chat of [
  'i think the intro is too long so we should probably rework it',
  'can you hear that hiss because i think it is the room',
  'that sounded great so let us keep it',
]) {
  const r = said(chat)
  check(`splitting does not manufacture a command: "${chat.slice(0, 40)}…"`,
    r.calls.length === 0, `${r.matched} ${JSON.stringify(r.input ?? null)}`)
}

console.log(failures
  ? `\n${failures} failing`
  : '\nit reads the command out of the sentence, and the item out of the track')
assert.equal(failures, 0)
