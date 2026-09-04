#!/usr/bin/env node
// Naming one clip, or many, out loud — and the other things a hand did that a
// voice now can: colour, a clip's own fades and level, the track order.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-select.test.mjs
//
// Brae: "give the voice control control over the multiselect function, and
// make each item have an individual item code or duplicate number so that one
// can be selected or many with the same name can be selected by name or by
// place on the track."
//
// ⚠️ The record, 23:43: "Delete all pad intro part" deleted ONE clip, five
// commands over. Every planner resolved a name to one clip.

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
const { clipOrdinals, clipLabel, parseClipAddress, addressClips } = await importTs('lib/clip-address.ts')
const { describeAction } = await importTs('lib/voice/transcript.ts')

const project = {
  id: 'p', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [
    { id: 't1', name: 'Pad', volume: 0.8, effects: [] },
    { id: 't2', name: 'Bass 2', volume: 0.8, effects: [] },
    { id: 't3', name: 'Drums', volume: 0.8, effects: [] },
    { id: 't4', name: 'White noise', volume: 0.8, effects: [] },
  ],
  arrangementClips: [
    { id: 'c1', kind: 'midi', trackId: 't1', name: 'Pad intro', startBeat: 0, durationBeats: 16, isDrumClip: false, notes: [{ id: 'n1', pitch: 60, startBeat: 0, durationBeats: 4, velocity: 100 }] },
    { id: 'c2', kind: 'midi', trackId: 't1', name: 'Pad intro', startBeat: 32, durationBeats: 16, isDrumClip: false, notes: [{ id: 'n2', pitch: 60, startBeat: 0, durationBeats: 4, velocity: 100 }] },
    { id: 'c3', kind: 'midi', trackId: 't1', name: 'Pad intro', startBeat: 64, durationBeats: 3, isDrumClip: false, notes: [{ id: 'n3', pitch: 60, startBeat: 0, durationBeats: 1, velocity: 100 }] },
    { id: 'c4', kind: 'midi', trackId: 't2', name: 'Bass 2', startBeat: 0, durationBeats: 16, isDrumClip: false, notes: [{ id: 'n4', pitch: 40, startBeat: 0, durationBeats: 4, velocity: 100 }] },
    { id: 'c5', kind: 'audio', trackId: 't3', name: 'Drum loop', startBeat: 0, durationBeats: 16, sampleId: 's1', duration: 8, offset: 0, gain: 1 },
  ],
  automationLanes: [],
}
const ctx = {
  tracks: project.tracks.map(t => ({ id: t.id, name: t.name, volume: t.volume })),
  tempo: 120,
  clips: project.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId, kind: c.kind })),
}
const first = s => interpret(s, ctx).calls[0]
const plan = (name, input) => planVoiceCall({ name, input }, project)
const ofType = (p, type) => (p.actions ?? []).filter(a => a.type === type)

// ── Every clip has a number among its namesakes ────────────────────────────
{
  const o = clipOrdinals(project)
  check('three "Pad intro" clips are #1 #2 #3 by start time', o.get('c1')?.n === 1 && o.get('c2')?.n === 2 && o.get('c3')?.n === 3 && o.get('c3')?.of === 3, JSON.stringify([...o]))
  check('a lone clip is 1 of 1', o.get('c4')?.of === 1)
  check('the label carries the number only when the name is shared', clipLabel(project, project.arrangementClips[1]) === 'Pad intro #2' && clipLabel(project, project.arrangementClips[3]) === 'Bass 2')
  const clip = readFileSync('components/editor/daw/ClipView.tsx', 'utf8')
  check('and the arrangement shows it beside the name', /data-clip-ordinal=\{o\.n\}/.test(clip) && /o && o\.of > 1/.test(clip))
}

// ── The spoken address ─────────────────────────────────────────────────────
{
  check('"all the pad intro parts"', (() => { const a = parseClipAddress('all the pad intro parts'); return a.which === 'all' && /^pad intro/.test(a.name) })(), JSON.stringify(parseClipAddress('all the pad intro parts')))
  check('"the third pad intro"', (() => { const a = parseClipAddress('the third pad intro'); return a.which === 3 && a.name === 'pad intro' })())
  check('"pad intro #2"', (() => { const a = parseClipAddress('pad intro #2'); return a.which === 2 && a.name === 'pad intro' })())
  check('"the last pad intro clip"', (() => { const a = parseClipAddress('the last pad intro clip'); return a.which === 'last' && a.name === 'pad intro' })())
  check('a name addresses all three', addressClips(project, { name: 'pad intro' }).length === 3)
  check('a number addresses one, by start time', addressClips(project, { name: 'pad intro', which: 2 })[0]?.id === 'c2')
  check('"after bar 9" keeps the later two', addressClips(project, { name: 'pad intro', after: 32 }).map(c => c.id).join() === 'c2,c3')
  check('"shorter than a bar" keeps the short one', addressClips(project, { shorterThan: 4 }).map(c => c.id).join() === 'c3')
  check('a track name with no clip of that name means its clips', addressClips(project, { name: 'drums' }).map(c => c.id).join() === 'c5')
  check('"Bass 2" is a name, not the second Bass', addressClips(project, { name: 'bass 2' }).map(c => c.id).join() === 'c4')
}

// ── 23:43: "Delete all pad intro part" — one command, all of them ──────────
{
  const c = first('delete all the pad intro parts')
  check('"delete all the pad intro parts" is one remove_clip for the set', c?.name === 'remove_clip' && c.input.which === 'all' && /pad intro/i.test(c.input.target), JSON.stringify(c))
  const p = plan('remove_clip', { target: 'pad intro', which: 'all' })
  check('and the planner deletes all three', ofType(p, 'REMOVE_CLIP').length === 3 && /Deleted 3 clips/.test(p.say ?? ''), p.say ?? p.problem)
  const third = first('delete the third pad intro part')
  check('"delete the third pad intro part" is number 3', third?.name === 'remove_clip' && third.input.which === 3, JSON.stringify(third))
  const one = plan('remove_clip', { target: 'pad intro', which: 3 })
  check('and only that one goes', ofType(one, 'REMOVE_CLIP').length === 1 && ofType(one, 'REMOVE_CLIP')[0].clipId === 'c3', JSON.stringify(one))
  const bass = first('delete the bass 2 clip')
  check('"delete the bass 2 clip" is still the one clip called Bass 2', bass?.name === 'remove_clip' && bass.input.which === undefined && /bass 2/i.test(bass.input.target), JSON.stringify(bass))
  const bassPlan = plan('remove_clip', { target: 'Bass 2' })
  check('and deletes exactly it', ofType(bassPlan, 'REMOVE_CLIP').length === 1 && ofType(bassPlan, 'REMOVE_CLIP')[0].clipId === 'c4', JSON.stringify(bassPlan))
  const short = plan('remove_clip', { target: 'pad intro', shorterThan: { bars: 1 } })
  check('"the pad intro parts that are not a full bar long" deletes the short one', ofType(short, 'REMOVE_CLIP').length === 1 && ofType(short, 'REMOVE_CLIP')[0].clipId === 'c3', JSON.stringify(short))
}

// ── The multi-select, by voice ─────────────────────────────────────────────
{
  const all = first('select all the pad intro parts')
  check('"select all the pad intro parts" selects the set', all?.name === 'select' && all.input.what === 'clips' && all.input.which === 'all', JSON.stringify(all))
  const p = plan('select', { what: 'clips', target: 'pad intro', which: 'all' })
  const sel = ofType(p, 'SELECT')[0]
  check('and the planner selects all three', sel && (sel.clipIds ?? sel.ids ?? []).length === 3, JSON.stringify(p))
  const third = first('select the third pad intro part')
  check('"select the third pad intro part" is number 3', third?.name === 'select' && third.input.what === 'clips' && third.input.which === 3, JSON.stringify(third))
  const p3 = plan('select', { what: 'clips', target: 'pad intro', which: 3 })
  check('and selects only it', (ofType(p3, 'SELECT')[0]?.clipIds ?? ofType(p3, 'SELECT')[0]?.ids ?? []).join() === 'c3', JSON.stringify(p3))
  const bare = first('select pad intro 2')
  check('"select pad intro 2" is the second, because "pad intro 2" is not a name', bare?.name === 'select' && bare.input.what === 'clips' && bare.input.which === 2, JSON.stringify(bare))
  const after = first('select the pad intro clips after bar 9')
  check('"…after bar 9" carries the place', after?.name === 'select' && after.input.what === 'clips' && after.input.after?.bar === 9, JSON.stringify(after))
  const pa = plan('select', { what: 'clips', target: 'pad intro', after: { bar: 9 } })
  check('and selects the later two', (ofType(pa, 'SELECT')[0]?.clipIds ?? ofType(pa, 'SELECT')[0]?.ids ?? []).join() === 'c2,c3', JSON.stringify(pa))
  const shorter = first('select the clips shorter than a bar')
  check('"select the clips shorter than a bar" carries the length', shorter?.name === 'select' && shorter.input.what === 'clips' && shorter.input.shorterThan?.bars === 1, JSON.stringify(shorter))
  const ps = plan('select', { what: 'clips', shorterThan: { bars: 1 } })
  check('and finds the short one', (ofType(ps, 'SELECT')[0]?.clipIds ?? ofType(ps, 'SELECT')[0]?.ids ?? []).join() === 'c3', JSON.stringify(ps))
  check('"select everything" is still everything', first('select everything')?.input.what === 'all')
  check('"select all the clips" is still everything', first('select all the clips')?.input.what === 'all', JSON.stringify(first('select all the clips')))
  check('"select the pad" is still the track', first('select the pad')?.input.what === 'track', JSON.stringify(first('select the pad')))
  const none = plan('select', { what: 'clips', target: 'strings' })
  check('nothing by that name is said, not silently nothing', !(none.actions ?? []).length && /(no|nothing|can't find|couldn't find)/i.test(none.problem || none.say || ''), none.problem || none.say)
}

// ── The record: a complaint with a bar number in it is not a locate ────────
{
  const complaint = interpret("It doesn't seem to be that it's 1 full bar long", ctx)
  check('"it doesn\'t seem to be that it\'s 1 full bar long" does not move the playhead', !complaint.calls.some(c => c.name === 'transport' && c.input.action === 'locate'), JSON.stringify(complaint.calls))
  check('"go to bar 9" still does', first('go to bar 9')?.input.action === 'locate')
  check('"bar 9" alone still does', first('bar 9')?.input.action === 'locate', JSON.stringify(first('bar 9')))
  check('"take me to bar 5" still does', first('take me to bar 5')?.input.action === 'locate', JSON.stringify(first('take me to bar 5')))
}

// ── Colour ─────────────────────────────────────────────────────────────────
{
  const c = first('colour the pad intro clips blue')
  check('"colour the pad intro clips blue" is set_colour', c?.name === 'set_colour' && c.input.colour === 'blue' && /pad intro/i.test(c.input.target), JSON.stringify(c))
  const p = plan('set_colour', { target: 'pad intro', colour: 'blue', which: 'all' })
  check('and colours all three', ofType(p, 'UPDATE_CLIP').length === 3 && ofType(p, 'UPDATE_CLIP').every(a => a.patch.color === '#3b82f6'), JSON.stringify(p))
  const t = first('make the drums track red')
  check('"make the drums track red" is the track', t?.name === 'set_colour' && t.input.of === 'track' && t.input.colour === 'red', JSON.stringify(t))
  const pt = plan('set_colour', { target: 'drums', colour: 'red', of: 'track' })
  check('and colours the track', ofType(pt, 'UPDATE_TRACK').length === 1 && ofType(pt, 'UPDATE_TRACK')[0].patch.color === '#ef4444', JSON.stringify(pt))
  const noise = first('make the white noise louder')
  check('"make the white noise louder" is not a colour', noise?.name !== 'set_colour', JSON.stringify(noise))
  check('the transcript says recoloured', /Recoloured/.test(describeAction({ type: 'UPDATE_CLIP', clipId: 'c1', patch: { color: '#fff' } })))
}

// ── An audio clip's own settings ───────────────────────────────────────────
{
  const f = first('fade out the drum loop clip over a bar')
  check('"fade out the drum loop clip over a bar" is set_clip_audio', f?.name === 'set_clip_audio' && f.input.fadeOut?.bars === 1, JSON.stringify(f))
  const p = plan('set_clip_audio', { target: 'drum loop', fadeOut: { bars: 1 } })
  check('and sets the fade on the clip', ofType(p, 'UPDATE_CLIP').length === 1 && ofType(p, 'UPDATE_CLIP')[0].clipId === 'c5' && ofType(p, 'UPDATE_CLIP')[0].patch.fadeOut > 0, JSON.stringify(p))
  const r = first('reverse the drum loop')
  check('"reverse the drum loop" is a reverse', r?.name === 'set_clip_audio' && r.input.reverse === true, JSON.stringify(r))
  const l = first('loop the drum loop clip')
  check('"loop the drum loop clip" loops', l?.name === 'set_clip_audio' && l.input.loop === true, JSON.stringify(l))
  const g = first('turn the drum loop clip down to 60%')
  check('"turn the drum loop clip down to 60%" is the clip level', g?.name === 'set_clip_audio' && g.input.gain === '60%', JSON.stringify(g))
  const pg = plan('set_clip_audio', { target: 'drum loop', gain: '60%' })
  check('and sets gain 0.6', Math.abs((ofType(pg, 'UPDATE_CLIP')[0]?.patch.gain ?? 0) - 0.6) < 1e-6, JSON.stringify(pg))
  const track = first('fade out the drums over 2 bars')
  check('"fade out the drums over 2 bars" is not a clip setting', track?.name !== 'set_clip_audio', JSON.stringify(track))
  const midi = plan('set_clip_audio', { target: 'pad intro', which: 1, reverse: true })
  check('a MIDI clip says so instead', !(midi.actions ?? []).length && /audio/i.test(midi.problem || midi.say || ''), midi.problem || midi.say)
}

// ── Track order ────────────────────────────────────────────────────────────
{
  const top = first('move the drums track to the top')
  check('"move the drums track to the top" is move_track', top?.name === 'move_track' && top.input.to === 'top', JSON.stringify(top))
  const p = plan('move_track', { target: 'drums', to: 'top' })
  check('and puts it before the first track', ofType(p, 'MOVE_TRACK').length === 1 && ofType(p, 'MOVE_TRACK')[0].trackId === 't3' && ofType(p, 'MOVE_TRACK')[0].beforeId === 't1', JSON.stringify(p))
  const below = first('put the pad below the bass 2')
  check('"put the pad below the bass 2" is after Bass 2', below?.name === 'move_track' && /bass 2/i.test(below.input.after ?? ''), JSON.stringify(below))
  const pb = plan('move_track', { target: 'pad', after: 'bass 2' })
  check('and lands above the track that followed it', ofType(pb, 'MOVE_TRACK')[0]?.beforeId === 't3', JSON.stringify(pb))
  check('"move the drums to the top" names a track, so it is the track', first('move the drums to the top')?.name === 'move_track', JSON.stringify(first('move the drums to the top')))
  check('"move everything to bar 1" names no track, so it is the clips', first('move everything to bar 1')?.name === 'move_clips', JSON.stringify(first('move everything to bar 1')))
  check('"move the pad intro back 2 bars" is still a clip move', first('move the pad intro back 2 bars')?.name === 'move_clips')
  check('the transcript reads the move', /Moved .* above/.test(describeAction({ type: 'MOVE_TRACK', trackId: 't3', beforeId: 't1' })))
}

// ── The assistant is told the same ─────────────────────────────────────────
{
  const tools = readFileSync('lib/voice/music-tools.ts', 'utf8')
  check('select takes "clips" and an address', /enum: \['all', 'none', 'track', 'loop', 'clips'\]/.test(tools) && /const ADDRESS = \{/.test(tools))
  check('remove_clip takes the address', /name: 'remove_clip'[\s\S]*?properties: \{ target: TARGET, \.\.\.ADDRESS \}/.test(tools))
  for (const name of ['set_colour', 'set_clip_audio', 'move_track']) check(`the ${name} tool exists`, new RegExp(`name: '${name}'`).test(tools))
}

console.log(failures ? `\n${failures} failing` : '\none, or many, by name')
assert.equal(failures, 0)
