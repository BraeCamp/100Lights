#!/usr/bin/env node
// The record from 21:15–22:05, and the overlay that greys what is not here yet.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-record-fixes.test.mjs
//
// Brae: "Check the commands that I gave Light and fix problems… create an
// overlay menu. One overlay will be 'Loading' where the user can see unloaded
// parts of the song in gray."

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { interpret } = await importTs('lib/voice/interpret.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')
const ctx = { tracks: [{ id: 't1', name: 'Pad', volume: 0.8 }, { id: 't2', name: 'Stab', volume: 0.8 }, { id: 't3', name: 'Drums', volume: 0.8 }], tempo: 120, clips: [{ id: 'c1', name: 'Pad intro', trackId: 't1' }] }
const first = s => interpret(s, ctx).calls[0]
const project = {
  id: 'p', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [
    { id: 't1', name: 'Pad', volume: 0.8, effects: [] },
    { id: 't2', name: 'Stab', volume: 0.8, effects: [{ id: 'f1', type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 18000, q: 1 } }] },
  ],
  arrangementClips: [
    { id: 'c1', kind: 'midi', trackId: 't1', name: 'Pad intro', startBeat: 16, durationBeats: 16, isDrumClip: false, notes: [
      { id: 'n1', pitch: 52, startBeat: 0, durationBeats: 4, velocity: 100 },
      { id: 'n2', pitch: 56, startBeat: 0, durationBeats: 4, velocity: 100 },
      { id: 'n3', pitch: 59, startBeat: 0.05, durationBeats: 4, velocity: 100 },
      { id: 'n4', pitch: 64, startBeat: 4, durationBeats: 4, velocity: 100 },
    ] },
    { id: 'c2', kind: 'midi', trackId: 't2', name: 'Stab', startBeat: 32, durationBeats: 32, isDrumClip: false, notes: [{ id: 'm1', pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }] },
  ],
  automationLanes: [],
}

// ── 22:03–22:05: "Restart." ×3, "Pause." ×5, "Play." ×3 — its own read-back ─
{
  for (const said of ['Playing.', 'Paused.', 'Restarting.', 'Stopped.']) {
    check(`"${said}" heard back is not a command`, interpret(said, ctx).calls.length === 0, JSON.stringify(interpret(said, ctx).calls))
  }
  const play = planVoiceCall({ name: 'transport', input: { action: 'play' } }, project)
  const pause = planVoiceCall({ name: 'transport', input: { action: 'pause' } }, project)
  const restart = planVoiceCall({ name: 'transport', input: { action: 'restart' } }, project)
  check('the read-backs no longer use the command word', play.say === 'Playing.' && pause.say === 'Paused.' && restart.say === 'Restarting.', `${play.say} ${pause.say} ${restart.say}`)
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('and a transcript that is what Light just said is dropped as an echo', /ignored an echo of the read-back/.test(control) && /spokeN\.includes\(heardN\) \|\| heardN\.includes\(spokeN\)/.test(control))
}

// ── 21:27 / 21:58 / 21:15: the first chord of the pad intro ────────────────
{
  const c = first('Take the first chord of the pad intro and put it at bar 1')
  check('"take the first chord of the pad intro and put it at bar 1" is a copy, not a move',
    c?.name === 'copy_notes' && c.input.part === 'first chord' && c.input.at?.bar === 1, JSON.stringify(c))
  const r = first('recreate the opening chord of the pad intro at the first bar and repeat it 4 times')
  check('"…and repeat it 4 times" carries the count', r?.name === 'copy_notes' && r.input.times === 4 && r.input.at?.bar === 1, JSON.stringify(r))
  check('"move the pad intro" is still a move', first('move the pad intro back 2 bars')?.name === 'move_clips')

  const plan = planVoiceCall({ name: 'copy_notes', input: { target: 'Pad intro', part: 'first chord', at: { bar: 1 }, times: 4 } }, project)
  const clips = (plan.actions ?? []).filter(a => a.type === 'ADD_CLIP').map(a => a.clip)
  check('the planner makes four clips back to back at bar 1', clips.length === 4 && clips[0].startBeat === 0 && clips[1].startBeat === clips[0].durationBeats, JSON.stringify(clips.map(c => c.startBeat)))
  check('each holds only the chord — the three notes that start together', clips.every(c => c.notes.length === 3 && c.notes.every(n => n.startBeat === 0)), JSON.stringify(clips[0]?.notes))
  check('cut at the next onset', clips[0].durationBeats === 4)
  check('on the same track', clips.every(c => c.trackId === 't1'))
  check('and says so', /Copied the first chord \(3 notes\) of "Pad intro" to bar 1, 4 times back to back/.test(plan.say ?? ''), plan.say)
  const bars = planVoiceCall({ name: 'copy_notes', input: { target: 'Pad intro', part: '1 bar', at: { bar: 9 } } }, project)
  check('"the first bar" copies everything inside it', (bars.actions ?? []).length === 1 && bars.actions[0].clip.notes.length === 3 && bars.actions[0].clip.durationBeats === 4, JSON.stringify(bars))
}

// ── 21:59: "Move everything back to the left, to the 1st bar" ──────────────
{
  const to = planVoiceCall({ name: 'move_clips', input: { to: { bar: 1 } } }, project)
  const moves = (to.actions ?? []).filter(a => a.type === 'MOVE_CLIP' || (a.type === 'UPDATE_CLIP' && a.patch?.startBeat != null))
  check('a destination moves the earliest clip there and keeps the spacing',
    moves.length === 2 && moves.some(a => (a.startBeat ?? a.patch?.startBeat) === 0) && moves.some(a => (a.startBeat ?? a.patch?.startBeat) === 16), JSON.stringify(to.actions))
  const already = planVoiceCall({ name: 'move_clips', input: { to: { bar: 5 } } }, project)
  check('and already there is said, not moved', (already.actions ?? []).length === 0 && /already starts at/.test(already.say ?? ''), already.say)
}

// ── 22:02–22:04: "stays at about 80%", "down to 50%" — a level, not a shape ─
{
  const flat = planVoiceCall({ name: 'automate_parameter', input: { target: 'Stab', parameter: 'lowpass', from: '50%', to: '50%' } }, project)
  check('one value with no span sets the filter itself', (flat.actions ?? []).some(a => a.type === 'UPDATE_EFFECT' && a.effectId === 'f1' && a.patch.params.frequency < 18000) && !(flat.actions ?? []).some(a => a.type === 'ADD_AUTOMATION_LANE'), JSON.stringify(flat))
  check('and reads back in Hertz', /Low-pass cutoff on "Stab" set to/.test(flat.say ?? ''), flat.say)
  const withLane = { ...project, automationLanes: [{ id: 'L', trackId: 't2', parameter: 'fx:f1:frequency', label: 'Low-pass cutoff', min: 200, max: 18000, curve: 'log', defaultValue: 1, expanded: true, points: [{ id: 'a', beat: 32, value: 1 }, { id: 'b', beat: 48, value: 0.2 }] }] }
  const flatLane = planVoiceCall({ name: 'automate_parameter', input: { target: 'Stab', parameter: 'lowpass', from: '50%', to: '50%' } }, withLane)
  check('an existing lane goes flat at the level too', (flatLane.actions ?? []).filter(a => a.type === 'UPDATE_AUTOMATION_POINT' && Math.abs(a.patch.value - 0.5) < 1e-9).length === 2 && /flat/.test(flatLane.say ?? ''), flatLane.say)
  const sweep = planVoiceCall({ name: 'automate_parameter', input: { target: 'Stab', parameter: 'lowpass', from: '100%', to: '50%', start: { bar: 9 }, end: { bar: 13 } } }, project)
  check('a real sweep is still a lane', (sweep.actions ?? []).some(a => a.type === 'ADD_AUTOMATION_LANE'))
}

// ── The record itself: the column that says which rung answered ────────────
{
  const db = readFileSync('lib/voice-gaps-db.ts', 'utf8')
  check('the gaps list now carries the path', /\(ARRAY_AGG\(path ORDER BY ts DESC\)\)\[1\] AS path/.test(db) && /path: String\(r\.path \?\? ''\)/.test(db))
}

// ── Overlays ───────────────────────────────────────────────────────────────
{
  const { OVERLAYS } = await importTs('lib/daw-state.ts').catch(() => ({ OVERLAYS: null }))
  const state = readFileSync('lib/daw-state.ts', 'utf8')
  check('the overlay kinds are one list', /export const OVERLAYS/.test(state) && /kind: 'loading'/.test(state))
  if (OVERLAYS) check('Loading is among them', OVERLAYS.some(o => o.kind === 'loading'))
  const clip = readFileSync('components/editor/daw/ClipView.tsx', 'utf8')
  check('a clip greys itself when it is not the answer', /overlay === 'loading' \? !loaded/.test(clip) && /data-overlay-grey=\{greyed \|\| undefined\}/.test(clip) && /filter: greyed \? 'grayscale\(1\)'/.test(clip))
  const arr = readFileSync('components/editor/daw/ArrangementView.tsx', 'utf8')
  check('the toolbar has the menu', /data-overlay-button/.test(arr) && /data-overlay-menu/.test(arr) && /OVERLAYS\.map/.test(arr))
  check('and the Loading overlay counts what is still on its way', /engine\.readiness\(\)\.waiting\.length/.test(arr))
}

console.log(failures ? `\n${failures} failing` : '\nthe record, answered')
assert.equal(failures, 0)
