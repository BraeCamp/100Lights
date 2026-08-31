#!/usr/bin/env node
// The commands that replace a sequence with a sentence.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-compound.test.mjs
//
// Brae: "compile all music terms that we don't have commands for and see how
// they are applicable to functions in our program. We need to take into
// consideration more complex tasks so that we can make changes faster."
//
// Each of these is worth several actions, which is the point — and also the
// risk: a command that quietly does four things has four ways to be subtly
// wrong, and none of them look wrong from outside.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const notes = [
  { id: 'n1', pitch: 60, startBeat: 0, durationBeats: 0.5, velocity: 100 },
  { id: 'n2', pitch: 64, startBeat: 1, durationBeats: 0.5, velocity: 100 },
  { id: 'n3', pitch: 67, startBeat: 2, durationBeats: 0.5, velocity: 100 },
]
const project = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [
    { id: 'tp', name: 'Pad', instrument: { type: 'poly', params: {} }, effects: [] },
    { id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} }, effects: [] },
  ],
  arrangementClips: [
    { id: 'cp', trackId: 'tp', kind: 'midi', name: 'Pad clip', startBeat: 0, durationBeats: 4, notes },
    { id: 'cd', trackId: 'td', kind: 'midi', name: 'Drums clip', startBeat: 0, durationBeats: 4, notes: [...notes] },
  ],
  cueMarkers: [{ id: 'm1', beat: 8, name: 'Chorus' }, { id: 'm2', beat: 24, name: 'Drop' }],
}
const plan = (name, input, p = project) => planVoiceCall({ name, input }, p)
const types = pl => pl.actions.map(a => a.type)
const eff = pl => pl.actions.find(a => a.type === 'UPDATE_EFFECT')

// ── Tone ───────────────────────────────────────────────────────────────────
{
  const bright = plan('shape_tone', { target: 'pad', quality: 'brighter' })
  check('brighter adds an EQ and raises the top',
    types(bright).join() === 'ADD_EFFECT,UPDATE_EFFECT' && eff(bright).patch.params.highGain > 0,
    JSON.stringify(eff(bright)?.patch?.params))

  // ⚠️ A shape, not a band. Warmer that only lifted the low end is a muddier
  // track — the top has to come down with it or the balance is unchanged.
  const warm = plan('shape_tone', { target: 'pad', quality: 'warmer' })
  const wp = eff(warm).patch.params
  check('warmer lifts the body AND takes the top down', wp.lowGain > 0 && wp.highGain < 0,
    `low ${wp.lowGain} high ${wp.highGain}`)

  const clean = eff(plan('shape_tone', { target: 'pad', quality: 'cleaner' })).patch.params
  check('cleaner cuts the low end', clean.lowGain < 0, String(clean.lowGain))

  const punch = plan('shape_tone', { target: 'drums', quality: 'punchier' })
  check('punchier reaches for the transient shaper, not the EQ',
    punch.actions.find(a => a.type === 'ADD_EFFECT')?.effect?.type === 'transientshaper',
    String(punch.actions.find(a => a.type === 'ADD_EFFECT')?.effect?.type))
  check('and pushes the attack up', eff(punch).patch.params.attack > 0,
    String(eff(punch).patch.params.attack))

  // ⚠️ Saying it twice must brighten twice, not build a tower of EQs whose
  // combined effect nobody can reason about.
  const withEq = {
    ...project,
    tracks: project.tracks.map(t => t.id === 'tp'
      ? { ...t, effects: [{ id: 'e1', type: 'eq3', params: { enabled: true, lowGain: 0, midGain: 0, highGain: 3 } }] }
      : t),
  }
  const again = plan('shape_tone', { target: 'pad', quality: 'brighter' }, withEq)
  check('a second brighten reuses the EQ that is already there',
    !types(again).includes('ADD_EFFECT'), types(again).join())
  check('and adds to it rather than resetting it',
    eff(again).patch.params.highGain > 3, String(eff(again).patch.params.highGain))

  // ⚠️ patch, not params: the reducer spreads action.patch onto the effect, so
  // sending params at the top level updates nothing and reports success.
  check('the update is shaped the way the reducer reads it',
    !!eff(again).patch && eff(again).params === undefined, Object.keys(eff(again)).join())
}

// ── Width and ducking ──────────────────────────────────────────────────────
{
  const mono = plan('set_width', { target: 'drums', width: 'mono' })
  check('mono sets width to zero', eff(mono).patch.params.width === 0 && eff(mono).patch.params.mono === true,
    JSON.stringify(eff(mono).patch.params))
  const wide = plan('set_width', { target: 'pad', width: 'wider' })
  check('wider goes past one', eff(wide).patch.params.width > 1, String(eff(wide).patch.params.width))

  const duck = plan('duck_under', { target: 'pad', under: 'drums' })
  check('ducking points the pad at the drums',
    eff(duck).patch.params.keyTrackId === 'td', JSON.stringify(eff(duck).patch.params.keyTrackId))
  check('and uses the unmask device',
    duck.actions[0].effect?.type === 'unmask', String(duck.actions[0].effect?.type))
  check('a track cannot duck under itself',
    !!plan('duck_under', { target: 'pad', under: 'pad' }).problem)
}

// ── Feel ───────────────────────────────────────────────────────────────────
{
  const half = plan('time_feel', { target: 'pad', feel: 'half' })
  const moved = half.actions.filter(a => a.type === 'UPDATE_MIDI_NOTE')
  check('half time spreads the notes out',
    moved.map(a => a.patch.startBeat).join() === '0,2,4', moved.map(a => a.patch.startBeat).join())
  // ⚠️ The clip has to grow with them or half time runs off the end and the
  // second half is silently cut.
  check('and the clip grows to hold them',
    half.actions.find(a => a.type === 'UPDATE_CLIP')?.patch?.durationBeats === 8,
    String(half.actions.find(a => a.type === 'UPDATE_CLIP')?.patch?.durationBeats))

  const dbl = plan('time_feel', { target: 'pad', feel: 'double' })
  check('double time pulls them in',
    dbl.actions.filter(a => a.type === 'UPDATE_MIDI_NOTE').map(a => a.patch.startBeat).join() === '0,0.5,1',
    dbl.actions.filter(a => a.type === 'UPDATE_MIDI_NOTE').map(a => a.patch.startBeat).join())

  const behind = plan('time_feel', { target: 'pad', feel: 'behind' })
  check('laying back moves everything later',
    behind.actions.every(a => a.patch.startBeat >= 0) &&
    behind.actions[1].patch.startBeat > 1, String(behind.actions[1].patch.startBeat))

  // ⚠️ Seeded, not random: the same clip humanized twice must give the same
  // feel, or undo-and-redo quietly becomes a different performance.
  const h1 = plan('time_feel', { target: 'pad', feel: 'humanize' })
  const h2 = plan('time_feel', { target: 'pad', feel: 'humanize' })
  check('humanize is the same performance every time',
    JSON.stringify(h1.actions) === JSON.stringify(h2.actions))
  check('and it actually moves things',
    h1.actions.some(a => a.patch.startBeat !== 0 && a.patch.startBeat !== 1 && a.patch.startBeat !== 2))
}

// ── Articulation and dynamics ──────────────────────────────────────────────
{
  const leg = plan('note_length', { target: 'pad', style: 'legato' })
  check('legato runs each note into the next',
    leg.actions.map(a => a.patch.durationBeats).join() === '1,1,2',
    leg.actions.map(a => a.patch.durationBeats).join())

  const stac = plan('note_length', { target: 'pad', style: 'staccato' })
  check('staccato clips them short',
    stac.actions.every(a => a.patch.durationBeats < 0.5))

  const cres = plan('dynamics_ramp', { target: 'pad', direction: 'crescendo' })
  const vs = cres.actions.map(a => a.patch.velocity)
  check('a crescendo rises across the part', vs[0] < vs[1] && vs[1] < vs[2], vs.join())
  const dim = plan('dynamics_ramp', { target: 'pad', direction: 'diminuendo' })
  const dvs = dim.actions.map(a => a.patch.velocity)
  check('and a diminuendo falls', dvs[0] > dvs[2], dvs.join())
}

// ── Harmonise and reverse ──────────────────────────────────────────────────
{
  const harm = plan('harmonize', { target: 'pad', interval: 'third', direction: 'above' })
  const out = harm.actions[0].patch.notes
  // ⚠️ ADDED, not replaced: harmonising is a second voice, and replacing would
  // be a transpose wearing the wrong name.
  check('harmonising keeps the original part', out.length === 6, String(out.length))
  check('and adds it a third above',
    out.slice(3).map(n => n.pitch).join() === '64,68,71', out.slice(3).map(n => n.pitch).join())
  const below = plan('harmonize', { target: 'pad', interval: 'octave', direction: 'below' })
  check('an octave below goes down twelve',
    below.actions[0].patch.notes[3].pitch === 48, String(below.actions[0].patch.notes[3].pitch))

  const rev = plan('reverse_notes', { target: 'pad' })
  // Notes end at 0.5, 1.5, 2.5 in a 4-beat clip, so they mirror to 3.5, 2.5, 1.5.
  check('reversing mirrors the part in time',
    rev.actions.map(a => a.patch.startBeat).join() === '3.5,2.5,1.5',
    rev.actions.map(a => a.patch.startBeat).join())
}

// ── Sections ───────────────────────────────────────────────────────────────
{
  const loop = plan('section', { name: 'chorus', action: 'loop' })
  // The chorus runs from its own marker to the NEXT one.
  check('looping a section runs marker to marker',
    loop.actions[0].start === 8 && loop.actions[0].end === 24, JSON.stringify(loop.actions[0]))
  // ⚠️ SET_LOOP alone moves the loop without switching it on.
  check('and switches looping on',
    loop.actions.some(a => a.type === 'SET_LOOP_ENABLED' && a.enabled === true),
    types(loop).join())

  const go = plan('section', { name: 'drop', action: 'go' })
  check('going to a section moves the playhead', go.actions[0].beat === 24, JSON.stringify(go.actions[0]))

  const missing = plan('section', { name: 'coda' })
  check('an unnamed section says which ones exist',
    /Chorus/.test(missing.problem ?? ''), missing.problem ?? '')
}

// ── The words that reach them ──────────────────────────────────────────────
{
  const ctx = { tracks: project.tracks, tempo: 120 }
  const say = t => interpret(t, ctx).calls[0]
  check('"make the pad brighter"', say('make the pad brighter')?.name === 'shape_tone')
  // ⚠️ "warm UP" and "MORE punch" share their words with volume — tone has to
  // win, or the two commands are the same command.
  check('"warm up the pad" is tone, not volume',
    say('warm up the pad')?.input?.quality === 'warmer', JSON.stringify(say('warm up the pad')))
  check('"the drums need more punch" is tone, not volume',
    say('the drums need more punch')?.input?.quality === 'punchier',
    JSON.stringify(say('the drums need more punch')))
  check('"duck the pad under the drums"',
    say('duck the pad under the drums')?.input?.under === 'Drums',
    JSON.stringify(say('duck the pad under the drums')?.input))
  check('"make the drums half time"', say('make the drums half time')?.input?.feel === 'half')
  check('"reverse the pad"', say('reverse the pad')?.name === 'reverse_notes')
  check('"loop the chorus"', say('loop the chorus')?.input?.action === 'loop')
  // ⚠️ "make" is one edit from "take", which made every "make the…" sentence
  // read as a jump to a section.
  check('"make the pad fuller" is not a section jump',
    say('make the pad fuller')?.name === 'shape_tone', String(say('make the pad fuller')?.name))
  check('and it really is fuller, not darker',
    say('make the pad fuller')?.input?.quality === 'fuller',
    String(say('make the pad fuller')?.input?.quality))
}

console.log(failures ? `\n${failures} failing` : '\none sentence does the work of several, and does it right')
assert.equal(failures, 0)
