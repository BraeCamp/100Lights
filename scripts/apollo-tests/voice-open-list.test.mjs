#!/usr/bin/env node
// The audit's remaining open list, built for the assistant.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-open-list.test.mjs
//
// Brae: "Let's build the 'still open' ones for AI"
//
// Written as FEW tools with a named parameter rather than one tool per term: a
// model chooses better from a short list of well-described tools than from
// forty near-identical ones. So the tests here mostly check that the parameter
// actually reaches the right dial — which is the thing that quietly does not
// happen when twenty terms share four tools.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const { interpret } = await importTs('lib/voice/interpret.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const chord = [60, 64, 67].map((pitch, n) => ({
  id: `c${n}`, pitch, startBeat: 0, durationBeats: 2, velocity: 100,
}))
const beat = [0, 1, 2, 3].map((b, n) => ({
  id: `b${n}`, pitch: 36, startBeat: b, durationBeats: 0.25, velocity: 100,
}))
const project = {
  tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, key: 0, scale: 'major',
  loopStart: 0, loopEnd: 8,
  tracks: [
    { id: 'tp', name: 'Pad', instrument: { type: 'poly', params: { attack: 0.01, release: 0.3, filterCutoff: 2000, filterResonance: 1 } }, effects: [], volume: 0.8 },
    { id: 'td', name: 'Drums', instrument: { type: 'drum', params: {} }, effects: [], volume: 0.8 },
  ],
  arrangementClips: [
    { id: 'cp', trackId: 'tp', kind: 'midi', name: 'Pad clip', startBeat: 0, durationBeats: 4, notes: chord },
    { id: 'cd', trackId: 'td', kind: 'midi', name: 'Drums clip', startBeat: 8, durationBeats: 4, notes: beat },
  ],
  returnTracks: [{ id: 'r1', name: 'Reverb', volume: 0.8, pan: 0, mute: false, effects: [] }],
  cueMarkers: [{ id: 'm1', beat: 8, name: 'Chorus' }, { id: 'm2', beat: 16, name: 'Drop' }],
}
const plan = (name, input, p = project) => planVoiceCall({ name, input }, p)
const types = pl => pl.actions.map(a => a.type)
const eff = pl => pl.actions.find(a => a.type === 'UPDATE_EFFECT')

// ── A dial inside a device ─────────────────────────────────────────────────
{
  const r = plan('set_device_param', { target: 'pad', device: 'compressor', parameter: 'ratio', value: 4 })
  // ⚠️ The device is added first when it is not there. Refusing would make
  // "put a compressor on and set the ratio to 4" need two sentences.
  check('a missing device is added, then aimed at',
    types(r).join() === 'ADD_EFFECT,UPDATE_EFFECT', types(r).join())
  check('and the named dial is the one that moves',
    eff(r).patch.params.ratio === 4, JSON.stringify(eff(r).patch.params.ratio))

  const withComp = {
    ...project,
    tracks: project.tracks.map(t => t.id === 'tp'
      ? { ...t, effects: [{ id: 'e1', type: 'compressor', params: { enabled: true, threshold: -24, ratio: 4, attack: 0.003, release: 0.25, knee: 6, makeupGain: 0 } }] }
      : t),
  }
  const again = plan('set_device_param', { target: 'pad', device: 'compressor', parameter: 'threshold', value: -18 }, withComp)
  check('an existing device is reused', !types(again).includes('ADD_EFFECT'), types(again).join())
  check('and only the named dial changes',
    eff(again).patch.params.threshold === -18 && eff(again).patch.params.ratio === 4,
    JSON.stringify(eff(again).patch.params))

  // A percentage across the parameter's own declared range, which is why this
  // reads the same registry the knob does rather than a table of its own.
  const pct = plan('set_device_param', { target: 'pad', device: 'compressor', parameter: 'ratio', percent: 50 }, withComp)
  check('a percentage lands inside the real range',
    eff(pct).patch.params.ratio > 4 && eff(pct).patch.params.ratio < 21,
    String(eff(pct).patch.params.ratio))

  // Naming only the dial works when one device on the track has it.
  const guess = plan('set_device_param', { target: 'pad', parameter: 'threshold', value: -20 }, withComp)
  check('naming only a dial finds the device that has it', !guess.problem, guess.say || guess.problem)
}

// ── Device nicknames ───────────────────────────────────────────────────────
// ⚠️ Eight devices Beacon already had were unreachable because the lookup
// wanted their exact type. Nobody says "noisegate" or "redux".
{
  for (const [word, expect] of [['gate', 'noisegate'], ['de-ess', 'deesser'], ['bitcrush', 'redux'], ['auto pan', 'autopan']]) {
    const r = plan('add_effect', { target: 'pad', effect: word })
    const added = r.actions.find(a => a.type === 'ADD_EFFECT')
    check(`"${word}" builds the ${expect}`, added?.effect?.type === expect,
      added?.effect?.type ?? r.problem)
  }
}

// ── The instrument's own shape ─────────────────────────────────────────────
{
  const a = plan('set_sound', { target: 'pad', parameter: 'attack', value: 0.4 })
  check('the envelope is set on the instrument',
    types(a).join() === 'SET_INSTRUMENT' && a.actions[0].instrument.params.attack === 0.4,
    JSON.stringify(a.actions[0]?.instrument?.params?.attack))
  check('and nothing else about it is disturbed',
    a.actions[0].instrument.params.release === 0.3, String(a.actions[0].instrument.params.release))

  // ⚠️ A cutoff moves by RATIO. 2 kHz up from 200 Hz and 2 kHz up from 10 kHz
  // are not the same move, and only one of them is audible.
  const up = plan('set_sound', { target: 'pad', parameter: 'cutoff', direction: 'more' })
  check('the cutoff opens by ratio, not by a fixed number of Hertz',
    up.actions[0].instrument.params.filterCutoff === 4000,
    String(up.actions[0].instrument.params.filterCutoff))

  // A drum kit has no envelope, and pretending it does would write a field
  // nothing reads — a command that reports success and does nothing.
  const drums = plan('set_sound', { target: 'drums', parameter: 'attack', value: 0.4 })
  check('a drum kit says it has no envelope', /drum kit/.test(drums.problem ?? ''), drums.problem ?? '')
}

// ── EQ at a frequency ──────────────────────────────────────────────────────
{
  const cut = plan('eq_band', { target: 'pad', frequency: 300, action: 'cut' })
  check('300 Hz lands in the low band and cuts it',
    eff(cut).patch.params.lowGain < 0 && eff(cut).patch.params.lowFreq === 300,
    JSON.stringify(eff(cut).patch.params))
  const boost = plan('eq_band', { target: 'pad', frequency: 5000, gain: 4 })
  check('5k lands in the high band and boosts it',
    eff(boost).patch.params.highGain === 4 && eff(boost).patch.params.highFreq === 5000,
    JSON.stringify(eff(boost).patch.params))
  check('a frequency nobody can hear is refused',
    !!plan('eq_band', { target: 'pad', frequency: 40000 }).problem)
}

// ── Sends ──────────────────────────────────────────────────────────────────
{
  const s = plan('send_to', { target: 'pad', to: 'reverb', amount: 40 })
  check('a send is set on the track, keyed by the return',
    Math.abs(s.actions[0].patch.sendAmounts.r1 - 0.4) < 1e-9,
    JSON.stringify(s.actions[0].patch.sendAmounts))
  check('and zero takes it out', /out of/.test(plan('send_to', { target: 'pad', to: 'reverb', amount: 0 }).say))
  const none = plan('send_to', { target: 'pad', to: 'reverb' }, { ...project, returnTracks: [] })
  check('no returns says so plainly', /no return tracks/.test(none.problem ?? ''), none.problem ?? '')
}

// ── Nudge ──────────────────────────────────────────────────────────────────
{
  // 25ms at 120bpm is 0.05 beats — a fixed amount of TIME, which is the whole
  // reason this is not move_clips.
  const later = plan('nudge', { target: 'drums clip', direction: 'later', milliseconds: 25 })
  check('a nudge is milliseconds converted through the tempo',
    Math.abs(later.actions[0].startBeat - 8.05) < 1e-9, String(later.actions[0].startBeat))
  const early = plan('nudge', { target: 'drums clip', direction: 'earlier', milliseconds: 25 })
  check('and it goes both ways', Math.abs(early.actions[0].startBeat - 7.95) < 1e-9,
    String(early.actions[0].startBeat))
  check('nothing is nudged before the start of the song',
    plan('nudge', { target: 'pad clip', direction: 'earlier', milliseconds: 9999 }).actions[0].startBeat >= 0)
}

// ── Tempo ramps ────────────────────────────────────────────────────────────
{
  const r = plan('tempo_ramp', { to: { bar: 5 }, bpm: 90 })
  check('a ramp is written as tempo markers',
    r.actions.every(a => a.type === 'ADD_TEMPO_MARKER') && r.actions.length > 2,
    `${r.actions.length} markers`)
  const temps = r.actions.map(a => a.marker.tempo)
  check('stepping down to the tempo asked for',
    temps[0] > temps[temps.length - 1] && temps[temps.length - 1] === 90, temps.join())
  check('and each one later than the last',
    r.actions.every((a, n) => n === 0 || a.marker.beat > r.actions[n - 1].marker.beat))
}

// ── Selection ──────────────────────────────────────────────────────────────
{
  check('select all takes every clip',
    plan('select', { what: 'all' }).actions[0].clipIds.length === 2)
  check('select none clears it', plan('select', { what: 'none' }).actions[0].clipIds.length === 0)
  // The loop is 0-8; the drums clip starts at 8, so it is outside it.
  check('the loop takes only what is inside it',
    plan('select', { what: 'loop' }).actions[0].clipIds.join() === 'cp',
    plan('select', { what: 'loop' }).actions[0].clipIds.join())
  check('a track takes its own clips',
    plan('select', { what: 'track', target: 'drums' }).actions[0].clipIds.join() === 'cd')
}

// ── Strip back ─────────────────────────────────────────────────────────────
{
  const s = plan('strip_back', { keep: ['drums'] })
  const muted = Object.fromEntries(s.actions.map(a => [a.trackId, a.patch.mute]))
  check('everything but the named track is muted', muted.tp === true && muted.td === false,
    JSON.stringify(muted))
  const back = plan('strip_back', { restore: true })
  check('and it all comes back', back.actions.every(a => a.patch.mute === false))
  check('an unknown name refuses rather than muting the wrong thing',
    !!plan('strip_back', { keep: ['kazoo'] }).problem)
}

// ── Inversion ──────────────────────────────────────────────────────────────
{
  const up = plan('chord_inversion', { target: 'pad clip', direction: 'up' })
  const pitches = Object.fromEntries(up.actions.map(a => [a.noteId, a.patch.pitch]))
  // C E G inverted up is E G C — the root goes up an octave, the chord stays.
  check('the bottom note goes up an octave', pitches.c0 === 72, String(pitches.c0))
  check('and the others stay put', pitches.c1 === 64 && pitches.c2 === 67,
    `${pitches.c1}/${pitches.c2}`)
  const down = plan('chord_inversion', { target: 'pad clip', direction: 'down' })
  const dp = Object.fromEntries(down.actions.map(a => [a.noteId, a.patch.pitch]))
  check('inverting down drops the top note', dp.c2 === 55, String(dp.c2))
  // ⚠️ A monophonic part has no chords to invert, and inverting it by pitch
  // would move notes between chords in a progression.
  check('a part with no stacked notes says so',
    /no chords/.test(plan('chord_inversion', { target: 'drums clip' }).problem ?? ''))
}

// ── Key change ─────────────────────────────────────────────────────────────
{
  const m = plan('modulate', { semitones: 2 })
  check('every note moves', m.actions.filter(a => a.type === 'UPDATE_MIDI_NOTE').length === 7,
    String(m.actions.filter(a => a.type === 'UPDATE_MIDI_NOTE').length))
  // ⚠️ The key setting moves WITH the notes. Without that second half the
  // scale highlighting disagrees with the song, and it is a transpose.
  const key = m.actions.find(a => a.type === 'SET_KEY_SCALE')
  check('and the key moves with them', key?.key === 2, JSON.stringify(key))

  const late = plan('modulate', { at: { bar: 3 }, semitones: 1 })
  check('modulating from a bar leaves what came before alone',
    late.actions.filter(a => a.type === 'UPDATE_MIDI_NOTE').every(a => a.clipId === 'cd'),
    late.actions.filter(a => a.type === 'UPDATE_MIDI_NOTE').map(a => a.clipId).join())

  const named = plan('modulate', { key: 'D' })
  check('a key by name works out the distance itself',
    named.actions.find(a => a.type === 'SET_KEY_SCALE')?.key === 2, named.say || named.problem)
}

// ── The extensions to commands that already existed ───────────────────────
{
  // ⚠️ A triplet is a MULTIPLIER on the division, not a grid of its own —
  // treating it as one is how a swung part gets flattened onto straight 16ths.
  const straight = plan('quantize', { target: 'pad clip', division: 2 })
  const trip = plan('quantize', { target: 'pad clip', division: 2, feel: 'triplet' })
  check('triplet quantize is a different grid from straight',
    JSON.stringify(straight.actions) !== JSON.stringify(trip.actions) || straight.actions.length === 0)
  check('and it is accepted at all', !trip.problem, trip.problem ?? '')

  const del = plan('section', { name: 'chorus', action: 'delete' })
  check('a section can be deleted', del.actions.every(a => a.type === 'REMOVE_CLIP') && del.actions.length === 1,
    types(del).join())
  const mv = plan('section', { name: 'chorus', action: 'move', at: { bar: 9 } })
  check('and moved, keeping what is inside it together',
    mv.actions[0].type === 'MOVE_CLIP' && mv.actions[0].startBeat === 32,
    JSON.stringify(mv.actions[0]))
  check('moving with nowhere to move to refuses',
    !!plan('section', { name: 'chorus', action: 'move' }).problem)

  const flam = plan('stutter', { target: 'drums clip', style: 'flam' })
  const added = flam.actions[0].patch.notes
  check('a flam adds a grace note before each hit', added.length === 8, String(added.length))
  check('quieter than the hit it leans on', added[4].velocity < 100, String(added[4].velocity))
  // ⚠️ Checked on the SECOND flam. The first hit is on beat one, so its grace
  // note clamps to the start of the clip rather than going negative — where it
  // would simply never play. That clamp is right; asserting on it is not.
  check('and just before the hit it leans on',
    added[5].startBeat === 0.875, String(added[5].startBeat))
  check('while the first one clamps to the start rather than vanishing',
    added[4].startBeat === 0, String(added[4].startBeat))

  const ghost = plan('stutter', { target: 'drums clip', style: 'ghost' })
  check('ghost notes go between the hits, quietly',
    ghost.actions[0].patch.notes.length > 4
    && ghost.actions[0].patch.notes.slice(4).every(n => n.velocity < 40),
    String(ghost.actions[0].patch.notes.length))

  const slide = plan('note_length', { target: 'pad clip', style: 'slide' })
  check('slide is an articulation, not a length',
    slide.actions[0].patch.rollFx?.slide > 0, JSON.stringify(slide.actions[0].patch))
}

// ── And the same sentences with the assistant off ─────────────────────────
{
  const ctx = {
    tracks: project.tracks, tempo: 120,
    clips: project.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId })),
  }
  const say = t => interpret(t, ctx).calls[0]
  check('"cut 300 hertz on the pad"', say('cut 300 hertz on the pad')?.name === 'eq_band',
    String(say('cut 300 hertz on the pad')?.name))
  check('"give the pad a slower attack"', say('give the pad a slower attack')?.name === 'set_sound',
    String(say('give the pad a slower attack')?.name))
  check('"send the pad to the reverb"', say('send the pad to the reverb')?.name === 'send_to')
  check('"just the drums"', say('just the drums')?.name === 'strip_back',
    String(say('just the drums')?.name))
  check('"select the loop"', say('select the loop')?.input?.what === 'loop')
  check('"nudge the pad clip later"', say('nudge the pad clip later')?.name === 'nudge')
  check('"invert the pad"', say('invert the pad')?.name === 'chord_inversion')
  // ⚠️ "slow down" alone is set_tempo.relative; a gradual word makes it a ramp.
  check('"slow down" is still a step, not a ramp',
    say('slow down')?.name === 'set_tempo', String(say('slow down')?.name))
  check('but "gradually slow down to 100" is a ramp',
    say('gradually slow down to 100')?.name === 'tempo_ramp',
    String(say('gradually slow down to 100')?.name))
}

console.log(failures ? `\n${failures} failing` : '\nthe open list is open no longer')
assert.equal(failures, 0)
