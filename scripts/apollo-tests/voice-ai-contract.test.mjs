#!/usr/bin/env node
// The contract the ASSISTANT works against.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-ai-contract.test.mjs
//
// Brae: "Can you check all previously edited ones so that we can make it work
// with AI"
//
// The local rules have a conformance suite because every phrasing they accept
// is written down. The assistant's side had nothing: a tool could advertise an
// argument the executor rejected, or a whole tool could have no executor case
// at all, and the only way to find out was to say it out loud and be told the
// studio had never heard of it. Four real faults turned up the first time this
// ran, and every one was invisible from the local path.
//
// ⚠️ Every tool must have a probe below. That is not bookkeeping: a new tool
// with no probe is exactly the one nobody checked.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { MUSIC_TOOLS, MUSIC_SYSTEM_HINT } = await importTs('lib/voice/music-tools.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')

const notes = [
  { id: 'n1', pitch: 60, startBeat: 0, durationBeats: 0.5, velocity: 100 },
  { id: 'n2', pitch: 64, startBeat: 1, durationBeats: 0.5, velocity: 100 },
]
const PROJECT = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, masterVolume: 0.8, swing: 0,
  tracks: [
    { id: 'tp', name: 'Pad', instrument: { type: 'poly', params: {} }, effects: [], midiEffects: [], volume: 0.8 },
    { id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} }, effects: [], midiEffects: [], volume: 0.8 },
  ],
  arrangementClips: [
    { id: 'cp', trackId: 'tp', kind: 'midi', name: 'Pad clip', startBeat: 0, durationBeats: 8, notes, fadeIn: 0, fadeOut: 0 },
    { id: 'cd', trackId: 'td', kind: 'midi', name: 'Drums clip', startBeat: 8, durationBeats: 8, notes: [...notes], fadeIn: 0, fadeOut: 0 },
    // An audio clip, for the clip's own settings — the two above are MIDI.
    { id: 'ca', trackId: 'tp', kind: 'audio', name: 'Pad take', startBeat: 16, durationBeats: 8, sampleId: 's1', duration: 4, offset: 0, gain: 1, fadeIn: 0, fadeOut: 0 },
  ],
  cueMarkers: [{ id: 'm1', beat: 8, name: 'Chorus' }, { id: 'm2', beat: 24, name: 'Drop' }],
  // A return track and a loop, so the send and selection probes have something
  // real to aim at rather than passing by refusing.
  returnTracks: [{ id: 'r1', name: 'Reverb', volume: 0.8, pan: 0, mute: false, effects: [] }],
  loopStart: 0, loopEnd: 8, key: 0, scale: 'major',
}

// A plausible model call per tool: required fields filled the way the schema
// asks for them, with a real track/clip name where a target is wanted.
const CALLS = {
  duplicate_clip: { target: 'pad clip', count: 2 },
  set_clip_active: { target: 'pad clip', active: false },
  copy_notes: { target: 'pad clip', part: 'first chord', at: { bar: 1 }, times: 2 },
  automate_parameter: { target: 'pad', parameter: 'lowpass', from: 100, to: 20, length: { bars: 2 } },
  modulate_parameter: { target: 'pad', parameter: 'lowpass', rate: '1/8', depth: 50 },
  set_delay_compensation: { on: false },
  set_chance: { target: 'pad clip', chance: 50 },
  invert_notes: { target: 'pad clip' },
  stretch_notes: { target: 'pad clip', factor: 2 },
  edit_notes: { target: 'pad clip', op: 'chop', parts: 2 },
  clip_time: { target: 'pad clip', op: 'set_loop_length', length: { bars: 2 } },
  warp_markers: { target: 'drums clip', op: 'as_loop', bars: 1 },
  import_settings: { shortSamples: 'loop' },
  audio_to_midi: { target: 'drums clip', op: 'slice' },
  set_launch: { target: 'session take', mode: 'gate' },
  set_punch: { punchIn: true, punchOut: true },
  set_record_quantize: { grid: '1/16' },
  set_metronome: { sound: 'cowbell', rhythm: '1/8' },
  bounce_track: { target: 'pad', where: 'new track' },
  set_global_quantization: { quantization: 'bar' },
  set_automation_arm: { mode: 'touch' },
  sound_like: { target: 'pad', like: 'fuzzier', sense: 'muffled' },
  adjust_it: { how: 'less', size: 'little' },
  move_clips: { by: { bars: 1 } },
  insert_clip: { sound: 'crash', at: { bar: 2 } },
  set_tempo: { bpm: 128 },
  set_time_signature: { numerator: 3, denominator: 4 },
  set_loop_region: { start: { bar: 1 }, end: { bar: 5 } },
  set_track: { target: 'pad', muted: true },
  transpose: { target: 'pad clip', semitones: 12 },
  transport: { action: 'play' },
  set_master_volume: { volume: 70 },
  set_swing: { amount: 30 },
  add_track: { name: 'Keys' },
  rename_track: { target: 'pad', name: 'Warm Pad' },
  duplicate_track: { target: 'pad' },
  remove_track: { target: 'drums' },
  add_marker: { name: 'Bridge', at: { bar: 5 } },
  add_effect: { target: 'pad', effect: 'reverb' },
  set_effect: { target: 'pad', effect: 'reverb', amount: 40 },
  describe: { topic: 'tempo' },
  rename_clip: { target: 'pad clip', name: 'Warm' },
  set_key_scale: { key: 'C', scale: 'major' },
  remove_clip: { target: 'drums clip' },
  set_all_tracks: { muted: true },
  quantize: { target: 'pad clip', division: 1 },
  set_velocity: { target: 'pad clip', velocity: 90 },
  make_beat: { pattern: 'boom ka boom' },
  metronome: { on: true },
  name_notes: {},
  open_editor: { editor: 'sequencer' },
  record_take: { editor: 'sequencer' },
  define_word: { phrase: 'ta means closed hi hat' },
  shape_tone: { target: 'pad', quality: 'brighter' },
  set_width: { target: 'pad', width: 'wider' },
  duck_under: { target: 'pad', under: 'drums' },
  time_feel: { target: 'pad clip', feel: 'half' },
  note_length: { target: 'pad clip', style: 'legato' },
  dynamics_ramp: { target: 'pad clip', direction: 'crescendo' },
  harmonize: { target: 'pad clip', interval: 'third' },
  reverse_notes: { target: 'pad clip' },
  section: { name: 'chorus', action: 'loop' },
  balance_levels: {},
  apply_groove: { target: 'pad clip', groove: 'shuffle' },
  crossfade: {},
  stutter: { target: 'pad clip' },
  split_clip: { target: 'pad clip', at: { bar: 2 } },
  resize_clip: { target: 'pad clip', length: { bars: 4 } },
  remove_marker: { name: 'Chorus' },
  add_clip_effect: { target: 'pad', parameter: 'lowpass', amount: 60, at: { bar: 1 }, length: { bars: 2 } },
  group_tracks: { targets: ['pad', 'drums'], name: 'Band' },
  set_instrument: { target: 'pad', instrument: 'Piano' },
  add_midi_effect: { target: 'pad', effect: 'arp' },
  remove_midi_effect: { target: 'pad', effect: 'arp' },
  remove_effect: { target: 'pad', effect: 'reverb' },
  set_apollo_layer: { target: 'pad', layer: 'sub', on: true },
  write_part: { part: 'bass', character: 'dark sad', instrument: 'piano' },
  project_action: { action: 'save_version', name: 'Before the drop' },
  edit_note: { target: 'pad', action: 'add', note: 'C', at: { bar: 1, beat: 3 } },
  set_apollo_switch: { target: 'pad', setting: 'unison', value: '4', module: 'osc1' },
  set_apollo_param: { target: 'pad', parameter: 'filter 1 cutoff', value: 800 },
  set_apollo_filter: { target: 'pad', type: 'ladder filter' },
  set_device_param: { target: 'pad', device: 'reverb', parameter: 'decay', percent: 70 },
  set_sound: { target: 'pad', parameter: 'attack', value: 0.5 },
  eq_band: { target: 'pad', frequency: 300, action: 'cut' },
  send_to: { target: 'pad', to: 'reverb', amount: 30 },
  nudge: { target: 'pad clip', direction: 'later', milliseconds: 20 },
  tempo_ramp: { to: { bar: 5 }, bpm: 100 },
  select: { what: 'all' },
  set_colour: { target: 'pad clip', colour: 'blue' },
  set_clip_audio: { target: 'pad take', fadeOut: { bars: 1 } },
  move_track: { target: 'drums', to: 'top' },
  workspace: { view: 'mixer' },
  strip_back: { keep: ['drums'] },
  chord_inversion: { target: 'pad clip', direction: 'up' },
  modulate: { semitones: 2 },
  browse_sounds: { tag: 'dark' },
  define_macro: { name: 'test swell', fx: { reverbWet: 1 }, shape: 'fall' },
  run_macro: { name: 'test swell', target: 'Bass' },
  show_view: { view: 'devices', target: 'Bass' },
  undo: {},
  redo: {},
}

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const noCase = [], threw = [], noExample = [], thin = [], missing = [], refused = []
for (const t of MUSIC_TOOLS) {
  const d = t.description ?? ''
  // A description a model cannot tell apart from another one IS the problem:
  // its failure mode is confident misuse, not failure to find.
  if (d.length < 60) thin.push(`${t.name} (${d.length} chars)`)
  // Example phrasings are what a model matches somebody's actual words against.
  if (!/["“']/.test(d)) noExample.push(t.name)
  const input = CALLS[t.name]
  if (input === undefined) { missing.push(t.name); continue }
  let plan
  try { plan = planVoiceCall({ name: t.name, input }, PROJECT) }
  catch (e) { threw.push(`${t.name}: ${String(e).slice(0, 90)}`); continue }
  if (/I don't know how to \w+ yet/.test(plan.problem ?? '')) noCase.push(t.name)
  else if (!plan.problem && !plan.actions.length && !plan.say && !plan.ask) {
    noCase.push(`${t.name} (did nothing at all)`)
  } else if (plan.problem) refused.push(t.name)
}

check('every tool has a probe here', missing.length === 0,
  missing.length ? `no probe for ${missing.join(', ')}` : '')
check('no tool throws on a plausible call', threw.length === 0, threw.join(' | '))
// undo and redo were tools with no executor case for their whole life: the
// local path intercepted them before planning, and the assistant path never
// reached that interception.
check('every tool the assistant can call has an executor case', noCase.length === 0, noCase.join(', '))
check('every description is long enough to choose between', thin.length === 0, thin.join(', '))
check('and carries phrasings to match against', noExample.length === 0, noExample.join(', '))
if (refused.length) {
  // Refusals are fine here: the fixture has no reverb to remove and no sound
  // library. Printed rather than asserted, so a NEW one is at least visible.
  console.log(`     (legitimate refusals on this fixture: ${refused.join(', ')})`)
}

// Every advertised enum value must be one the executor takes.
// describe advertised a "help" topic with no case, so a model asking "what can
// you do" was told the studio did not know how to answer that.
const badEnum = []
for (const t of MUSIC_TOOLS) {
  const props = t.input_schema?.properties ?? {}
  for (const [key, spec] of Object.entries(props)) {
    if (!Array.isArray(spec?.enum)) continue
    for (const v of spec.enum) {
      const input = { ...(CALLS[t.name] ?? {}), [key]: v }
      try {
        const plan = planVoiceCall({ name: t.name, input }, PROJECT)
        if (/I don't know how to/.test(plan.problem ?? '')) badEnum.push(`${t.name}.${key}="${v}"`)
      } catch { badEnum.push(`${t.name}.${key}="${v}" THREW`) }
    }
  }
}
check('the executor accepts every value the schema advertises', badEnum.length === 0, badEnum.join(', '))

// A model omits a required field far more often than it invents one.
const threwEmpty = []
for (const t of MUSIC_TOOLS) {
  try { planVoiceCall({ name: t.name, input: {} }, PROJECT) }
  catch (e) { threwEmpty.push(`${t.name}: ${String(e).slice(0, 70)}`) }
}
check('nothing throws when a required argument is missing', threwEmpty.length === 0, threwEmpty.join(' | '))

// The schemas say `type: number`, so the model sends one — while the executor
// reads them with spokenNumber, which was written for "one twenty eight".
{
  const t = planVoiceCall({ name: 'set_tempo', input: { bpm: 128 } }, PROJECT)
  check('a numeric argument works as a number', /128/.test(t.say ?? ''), t.say || t.problem)
  // And as a string, which is what the local path hands over. ⚠️ NOT as a
  // compound number word: spokenNumber reads single words and digits, and the
  // recogniser is asked for numerals precisely so "one hundred and twenty
  // eight" never has to arrive. Asserting it would be testing a capability
  // nothing needs and nothing has.
  const w = planVoiceCall({ name: 'set_tempo', input: { bpm: '128' } }, PROJECT)
  check('and as a string of digits', /128/.test(w.say ?? ''), w.say || w.problem)
}

// The things a model says that are not the schema's own spelling.
{
  const key = planVoiceCall({ name: 'set_key_scale', input: { key: 'F', scale: 'minor' } }, PROJECT)
  check('a key given by name, not as a semitone number', /F minor/.test(key.say ?? ''), key.say || key.problem)
  const lp = planVoiceCall({
    name: 'add_clip_effect',
    input: { target: 'pad', parameter: 'lowpass', amount: 60, at: { bar: 1 }, length: { bars: 2 } },
  }, PROJECT)
  check('a parameter given in plain words', !lp.problem, lp.say || lp.problem)
  // The read-back used to say "0 bars" whatever the length: the action was
  // right and the words were wrong, which is the worse way round.
  check('and the read-back says the real length', /2 bars/.test(lp.say ?? ''), lp.say)
}

// Rules a schema cannot carry have to live in the system prompt.
check('the assistant is told a sentence can be several requests', /SEVERAL REQUESTS/.test(MUSIC_SYSTEM_HINT))
check('that drum syllables are a beat', /DRUM SYLLABLES/.test(MUSIC_SYSTEM_HINT))
check('and that a selection outranks the conversation', /POINTING BEATS REMEMBERING/.test(MUSIC_SYSTEM_HINT))

console.log(failures
  ? `\n${failures} failing`
  : '\nthe assistant can reach everything, and everything it is told is true')
assert.equal(failures, 0)
