#!/usr/bin/env node
// What a spoken command actually does to the project.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-execute.test.mjs
//
// The two sentences Brae gave are the specification, so they are the tests:
//
//   "loop 'bass 2' 3 more times and add an ascending low pass filter from 80%
//    to 0% over the first 8 seconds of it"
//   "move everything over by one bar and have a 1 bar long crash at the
//    beginning, then restart"
//
// Everything is checked by reading the ACTIONS produced, because that is the
// only way to know a voice command does what it says before it is allowed to
// touch someone's song. The negatives matter as much as the positives: a
// command that edits the wrong track without saying so is the worst outcome
// available here, so ambiguity has to refuse.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { planVoiceCall, planVoiceCalls } = await importTs('lib/voice/execute-music.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

/** A small song: two basses (so "bass" is ambiguous), a kick, one clip each. */
const project = {
  tempo: 120,
  timeSignatureNum: 4,
  timeSignatureDen: 4,
  tracks: [
    { id: 'tk', name: 'Kick' },
    { id: 'tb1', name: 'Bass 1' },
    { id: 'tb2', name: 'Bass 2' },
  ],
  arrangementClips: [
    { id: 'ck', trackId: 'tk', kind: 'midi', name: 'Kick loop', startBeat: 0, durationBeats: 16, notes: [{ id: 'n1', pitch: 36, startBeat: 0, durationBeats: 1, velocity: 100 }] },
    { id: 'cb1', trackId: 'tb1', kind: 'midi', name: 'Bass 1 line', startBeat: 0, durationBeats: 16, notes: [{ id: 'n2', pitch: 40, startBeat: 0, durationBeats: 2, velocity: 100 }] },
    { id: 'cb2', trackId: 'tb2', kind: 'midi', name: 'Bass 2 line', startBeat: 16, durationBeats: 8, notes: [{ id: 'n3', pitch: 43, startBeat: 0, durationBeats: 2, velocity: 100 }] },
  ],
}

const types = plan => plan.actions.map(a => a.type)

// ── "loop bass 2 three more times" ──────────────────────────────────────────
const loop = planVoiceCall({ name: 'duplicate_clip', input: { target: 'bass 2', count: 'three' } }, project)
check('loop resolves the track by spoken name', !loop.problem, loop.problem ?? '')
check('and adds one clip per repeat', types(loop).join() === 'ADD_CLIP,ADD_CLIP,ADD_CLIP', types(loop).join())
check('placed back to back after the original',
  loop.actions.map(a => a.clip.startBeat).join() === '24,32,40',
  loop.actions.map(a => a.clip.startBeat).join())
check('every copy is a NEW clip, not the same id',
  new Set(loop.actions.map(a => a.clip.id)).size === 3 && !loop.actions.some(a => a.clip.id === 'cb2'))
check('and its notes are new too — sharing note ids corrupts the original',
  new Set(loop.actions.flatMap(a => a.clip.notes.map(n => n.id))).size === 3)
check('it says what it did, in bars', /Duplicated/.test(loop.say) && /bar /.test(loop.say), loop.say)

// The negative that matters most.
const ambiguous = planVoiceCall({ name: 'duplicate_clip', input: { target: 'bass', count: 2 } }, project)
check('an ambiguous name refuses rather than picking a bass', !!ambiguous.problem, ambiguous.problem ?? 'no problem raised')
check('and nothing is applied', ambiguous.actions.length === 0)

const missing = planVoiceCall({ name: 'duplicate_clip', input: { target: 'trombone', count: 2 } }, project)
check('an unknown name refuses', !!missing.problem, missing.problem ?? '')

// ── "an ascending low pass filter from 80% to 0% over the first 8 seconds" ──
const sweep = planVoiceCall({
  name: 'automate_parameter',
  input: { target: 'bass 2', parameter: 'lowpass', from: 80, to: 0, length: { seconds: 8 } },
}, project)
check('the sweep resolves', !sweep.problem, sweep.problem ?? '')
check('it adds a filter, a lane and two points',
  types(sweep).join() === 'ADD_EFFECT,ADD_AUTOMATION_LANE,ADD_AUTOMATION_POINT,ADD_AUTOMATION_POINT',
  types(sweep).join())
const [effect, lane, p1, p2] = sweep.actions
check('the filter is the type they asked for', effect.effect.params.type === 'lowpass')
check('the lane automates that effect, by its real id',
  lane.lane.parameter === `fx:${effect.effect.id}:frequency`, lane.lane.parameter)
check('the lane is on the clip\'s track', lane.lane.trackId === 'tb2', lane.lane.trackId)
// 8 seconds at 120bpm is 16 beats, starting at the clip's own start (beat 16).
check('it starts where the clip starts', p1.point.beat === 16, String(p1.point.beat))
check('and ends 8 seconds later, in beats', p2.point.beat === 32, String(p2.point.beat))
// ⚠️ Twice wrong before this, in opposite directions.
//
// First it read `p1.point.value === 0.8 && p2.point.value === 0` — the spoken
// fractions written straight into a lane that was read as HERTZ, so 0 meant a
// 0 Hz cutoff, which is silence. Brae found it by hearing a pad disappear.
//
// The fix for THAT wrote Hertz into the points, and this test asserted it. That
// was wrong too, and Brae found it the same way: "it's consistent through the
// track item instead of being the graph that I need it to be." A point is a
// POSITION, 0 to 1; the lane's min/max carry the units. Hertz in the points
// means the graph no longer draws the shape you drew.
//
// So the invariant is neither of those numbers on its own. It is that a
// position of 0 — the bottom of the graph, which is what "to 0%" means —
// resolves through the lane to a cutoff you can still HEAR. That is the thing
// that broke, and it is the thing worth asserting.
const resolve = (lane, norm) => lane.curve === 'log'
  ? lane.min * Math.pow(lane.max / lane.min, norm)
  : lane.min + norm * (lane.max - lane.min)

check('the points are positions on the graph, not Hertz',
  p1.point.value === 0.8 && p2.point.value === 0,
  `${p1.point.value} → ${p2.point.value}`)
check('and the lane carries the Hertz, on a log taper',
  lane.lane.min >= 20 && lane.lane.max >= 15000 && lane.lane.curve === 'log',
  `${lane.lane.min}–${lane.lane.max} Hz, ${lane.lane.curve}`)
// The one that actually caused the silence.
const hz1 = resolve(lane.lane, p1.point.value), hz2 = resolve(lane.lane, p2.point.value)
check('so sweeping 80% down to 0% lands in audible Hertz',
  hz1 > 1000 && hz2 >= 20 && hz2 < hz1,
  `${Math.round(hz1)} Hz → ${Math.round(hz2)} Hz`)
check('both points belong to the lane it just made',
  p1.laneId === lane.lane.id && p2.laneId === lane.lane.id)

const noRange = planVoiceCall({ name: 'automate_parameter', input: { target: 'bass 2', parameter: 'lowpass' } }, project)
check('a sweep with no range refuses', !!noRange.problem, noRange.problem ?? '')

// ── "move everything over by one bar" ───────────────────────────────────────
const shift = planVoiceCall({ name: 'move_clips', input: { by: { bars: 1 } } }, project)
check('every clip moves', shift.actions.length === 3, String(shift.actions.length))
check('by one bar — four beats at 4/4',
  shift.actions.every(a => {
    const before = project.arrangementClips.find(c => c.id === a.clipId)
    return a.startBeat === before.startBeat + 4
  }))
check('nothing is moved before the start of the song',
  planVoiceCall({ name: 'move_clips', input: { by: { bars: -99 } } }, project).actions.every(a => a.startBeat >= 0))

// ── "a 1 bar long crash at the beginning" ───────────────────────────────────
const crash = planVoiceCall({ name: 'insert_clip', input: { sound: 'crash', at: { bar: 1 }, length: { bars: 1 } } }, project)
check('a crash with no existing track makes one', types(crash).join() === 'ADD_TRACK,ADD_CLIP', types(crash).join())
check('it lands at the beginning', crash.actions[1].clip.startBeat === 0, String(crash.actions[1].clip.startBeat))
check('and is one bar long', crash.actions[1].clip.durationBeats === 4, String(crash.actions[1].clip.durationBeats))
check('the clip is on the track it just created',
  crash.actions[1].clip.trackId === crash.actions[0].id)

// If a matching track already exists, use it rather than making a second one.
const withCrash = { ...project, tracks: [...project.tracks, { id: 'tc', name: 'Crash' }] }
const crash2 = planVoiceCall({ name: 'insert_clip', input: { sound: 'crash', at: { bar: 1 }, length: { bars: 1 } } }, withCrash)
check('an existing Crash track is reused', types(crash2).join() === 'ADD_CLIP', types(crash2).join())
check('and the clip goes on it', crash2.actions[0].clip.trackId === 'tc')

// ── Whole sentences ─────────────────────────────────────────────────────────
const sentence = planVoiceCalls([
  { name: 'move_clips', input: { by: { bars: 1 } } },
  { name: 'insert_clip', input: { sound: 'crash', at: { bar: 1 }, length: { bars: 1 } } },
  { name: 'transport', input: { action: 'restart' } },
], project)
check('a three-part sentence plans in order',
  types(sentence).join() === 'MOVE_CLIP,MOVE_CLIP,MOVE_CLIP,ADD_TRACK,ADD_CLIP,TRANSPORT',
  types(sentence).join())
check('and reads back everything it did', /Moved/.test(sentence.say) && /crash/i.test(sentence.say) && /Restarted/.test(sentence.say),
  sentence.say)

// All-or-nothing: half a command is worse than none.
const halfBad = planVoiceCalls([
  { name: 'move_clips', input: { by: { bars: 1 } } },
  { name: 'duplicate_clip', input: { target: 'bass', count: 2 } },   // ambiguous
], project)
check('one bad call abandons the whole sentence', halfBad.actions.length === 0, `${halfBad.actions.length} actions`)
check('and says why', !!halfBad.problem, halfBad.problem ?? '')

// ── The rest of the vocabulary ──────────────────────────────────────────────
// Each of these is an "official term" command, and the thing worth checking is
// that a POSITION lands where a musician would expect it to.

const tsig = planVoiceCall({ name: 'set_time_signature', input: { numerator: 3, denominator: 4 } }, project)
check('a time signature for the whole song', types(tsig).join() === 'SET_TIME_SIG', types(tsig).join())
check('with the meter they said', tsig.actions[0].num === 3 && tsig.actions[0].den === 4)

const tsigAt = planVoiceCall({ name: 'set_time_signature', input: { numerator: 6, denominator: 8, at: { bar: 5 } } }, project)
check('a meter change mid-song becomes a marker', types(tsigAt).join() === 'ADD_METER_MARKER', types(tsigAt).join())
check('placed at the right beat — bar 5 is beat 16 in 4/4', tsigAt.actions[0].marker.beat === 16,
  String(tsigAt.actions[0].marker.beat))
check('and read back as a bar, not a beat', /bar 5/.test(tsigAt.say), tsigAt.say)

const tempoAt = planVoiceCall({ name: 'set_tempo', input: { bpm: 90, at: { bar: 9 } } }, project)
check('a tempo change mid-song becomes a marker', types(tempoAt).join() === 'ADD_TEMPO_MARKER', types(tempoAt).join())
check('at bar 9 — beat 32', tempoAt.actions[0].marker.beat === 32, String(tempoAt.actions[0].marker.beat))
check('a whole-song tempo does not', types(planVoiceCall({ name: 'set_tempo', input: { bpm: 128 } }, project)).join() === 'SET_TEMPO')

const loopRegion = planVoiceCall({ name: 'set_loop_region', input: { start: { bar: 5 }, end: { bar: 9 } } }, project)
check('a loop brace sets the region and turns looping on',
  types(loopRegion).join() === 'SET_LOOP,SET_LOOP_ENABLED', types(loopRegion).join())
check('from bar 5 to bar 9 — beats 16 to 32',
  loopRegion.actions[0].start === 16 && loopRegion.actions[0].end === 32,
  `${loopRegion.actions[0].start}..${loopRegion.actions[0].end}`)
// A loop given as a length rather than an end point.
const loopLen = planVoiceCall({ name: 'set_loop_region', input: { start: { bar: 5 }, length: { bars: 4 } } }, project)
check('a loop can be given as a length', loopLen.actions[0].end === 32, String(loopLen.actions[0]?.end))
check('a backwards loop refuses',
  !!planVoiceCall({ name: 'set_loop_region', input: { start: { bar: 9 }, end: { bar: 5 } } }, project).problem)

const up = planVoiceCall({ name: 'transpose', input: { target: 'bass 2', semitones: 12 } }, project)
check('transpose moves every note in the clip', types(up).join() === 'UPDATE_MIDI_NOTE', types(up).join())
check('by an octave', up.actions[0].patch.pitch === 55, String(up.actions[0].patch.pitch))
check('and says which way', /up/.test(up.say), up.say)
check('transposing off the keyboard is clamped, not wrapped',
  planVoiceCall({ name: 'transpose', input: { target: 'bass 2', semitones: 999 } }, project)
    .actions.every(a => a.patch.pitch <= 127))

// Moving one track rather than everything.
const moveOne = planVoiceCall({ name: 'move_clips', input: { target: 'Kick', by: { bars: 2 } } }, project)
check('a named target moves only that track', moveOne.actions.length === 1, String(moveOne.actions.length))
check('by two bars', moveOne.actions[0].startBeat === 8, String(moveOne.actions[0].startBeat))

// Volume automation needs no filter — it is the track's own parameter.
const fade = planVoiceCall({
  name: 'automate_parameter',
  input: { target: 'bass 2', parameter: 'volume', from: 100, to: 0, length: { bars: 2 } },
}, project)
check('automating volume adds no effect',
  types(fade).join() === 'ADD_AUTOMATION_LANE,ADD_AUTOMATION_POINT,ADD_AUTOMATION_POINT', types(fade).join())
check('and targets the track parameter directly', fade.actions[0].lane.parameter === 'volume',
  fade.actions[0].lane.parameter)

// ── Unknown tools are reported, never silently dropped ──────────────────────
const unknown = planVoiceCall({ name: 'make_it_funkier', input: {} }, project)
check('an unknown tool is refused with its name', /make_it_funkier/.test(unknown.problem ?? ''), unknown.problem ?? '')

console.log(failures ? `\n${failures} failing` : '\nspoken commands become the right actions, and refuse when unsure')
assert.equal(failures, 0)
