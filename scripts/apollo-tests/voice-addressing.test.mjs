#!/usr/bin/env node
// Naming what a command acts on: the selection ("them"), a place ("between
// bar 9 and 17", "after the chorus"), a set of tracks ("all the drum tracks",
// "every muted track"), and notes inside a clip ("the third chord", "the notes
// above C5") — and a chord told apart from the rest of a progression.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-addressing.test.mjs
//
// Brae: "Let's do all of them. A note for note level addressing, I asked
// Light to recreate the first chord in a chord progression and it gave me
// every note in the track item."

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
const { chordsOf, parseNoteAddress, addressNotes } = await importTs('lib/note-address.ts')
const { parseTrackAddress, addressTracks } = await importTs('lib/track-address.ts')
const { addressClips, sectionSpan } = await importTs('lib/clip-address.ts')

const chordNotes = (chords, prefix, len = 4) => chords.flatMap((chord, i) => chord.map((pitch, k) => ({ id: `${prefix}-${i}-${k}`, pitch, startBeat: i * len, durationBeats: len, velocity: 100 })))
const project = {
  id: 'p', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [
    { id: 't1', name: 'Pad', volume: 0.8, mute: false, solo: false, effects: [], instrument: { type: 'poly', params: {} } },
    { id: 't2', name: 'Drums', volume: 0.8, mute: false, solo: false, effects: [{ id: 'f1', type: 'reverb', params: { enabled: true } }], instrument: { type: 'drum', params: {} } },
    { id: 't3', name: 'Bass', volume: 0.8, mute: false, solo: false, effects: [], instrument: { type: 'poly', params: {} } },
    { id: 't4', name: 'Organ', volume: 0.8, mute: false, solo: false, effects: [], instrument: { type: 'poly', params: {} } },
    { id: 't5', name: 'Vox', volume: 0.8, mute: false, solo: false, effects: [] },
    { id: 't6', name: 'Spare', volume: 0.8, mute: false, solo: false, effects: [], instrument: { type: 'poly', params: {} } },
    { id: 't7', name: 'FX', volume: 0.6, mute: true, solo: false, effects: [{ id: 'f2', type: 'reverb', params: { enabled: true } }], instrument: { type: 'poly', params: {} } },
  ],
  arrangementClips: [
    { id: 'c1', kind: 'midi', trackId: 't1', name: 'Pad intro', startBeat: 0, durationBeats: 16, isDrumClip: false, notes: [{ id: 'p1', pitch: 60, startBeat: 0, durationBeats: 4, velocity: 100 }] },
    { id: 'c2', kind: 'midi', trackId: 't1', name: 'Pad intro', startBeat: 32, durationBeats: 16, isDrumClip: false, notes: [{ id: 'p2', pitch: 60, startBeat: 0, durationBeats: 4, velocity: 100 }] },
    { id: 'c3', kind: 'audio', trackId: 't2', name: 'Drum loop', startBeat: 0, durationBeats: 16, sampleId: 's1', duration: 8, offset: 0, gain: 1 },
    // A melody: one note at a time, never a chord.
    { id: 'c4', kind: 'midi', trackId: 't3', name: 'Bass line', startBeat: 0, durationBeats: 8, isDrumClip: false, notes: [40, 43, 45, 47].map((pitch, i) => ({ id: `b${i}`, pitch, startBeat: i * 2, durationBeats: 2, velocity: 100 })) },
    // A progression: a pickup note, then four chords, a melody note between two of them.
    { id: 'c5', kind: 'midi', trackId: 't4', name: 'Organ chords', startBeat: 0, durationBeats: 16, isDrumClip: false, notes: [
      { id: 'pick', pitch: 55, startBeat: 0, durationBeats: 0.5, velocity: 80 },
      ...chordNotes([[60, 64, 67], [62, 65, 69], [64, 67, 71], [67, 71, 74]], 'o').map(n => ({ ...n, startBeat: n.startBeat + 1 })),
      { id: 'mel', pitch: 76, startBeat: 3, durationBeats: 1, velocity: 90 },
    ] },
    { id: 'c6', kind: 'audio', trackId: 't5', name: 'Vox take', startBeat: 0, durationBeats: 8, sampleId: 's2', duration: 4, offset: 0, gain: 1 },
    { id: 'c7', kind: 'midi', trackId: 't7', name: 'FX pad', startBeat: 64, durationBeats: 8, isDrumClip: false, notes: [{ id: 'x1', pitch: 72, startBeat: 0, durationBeats: 8, velocity: 100 }] },
  ],
  cueMarkers: [{ id: 'm1', beat: 32, name: 'Chorus' }, { id: 'm2', beat: 64, name: 'Drop' }],
  automationLanes: [],
}
const ctxOf = (extra = {}) => ({
  tracks: project.tracks.map(t => ({ id: t.id, name: t.name, volume: t.volume })),
  tempo: 120,
  clips: project.arrangementClips.map(c => ({ id: c.id, name: c.name, trackId: c.trackId, kind: c.kind })),
  markers: project.cueMarkers.map(m => ({ name: m.name, beat: m.beat })),
  ...extra,
})
const ctx = ctxOf()
const first = (s, c = ctx) => interpret(s, c).calls[0]
const plan = (name, input, heard) => planVoiceCall({ name, input }, project, heard)
const ofType = (p, type) => (p.actions ?? []).filter(a => a.type === type)
const organ = project.arrangementClips[4]

// ── Telling when a chord plays ──────────────────────────────────────────────
{
  const chords = chordsOf(organ.notes)
  check('a pickup note and a melody note are not chords; four moments of two-or-more notes are', chords.length === 4, JSON.stringify(chords.map(c => [c.startBeat, c.notes.length])))
  check('the first chord is the three notes at beat 1, not the pickup', chords[0].startBeat === 1 && chords[0].notes.map(n => n.pitch).join() === '60,64,67')
  check('a chord lasts until the next chord, melody note or not', chords[0].endBeat === 5)
  check('the last chord lasts as long as it is held', chords[3].endBeat === 17)
  const strum = chordsOf([0, 0.05, 0.12].map((s, i) => ({ id: `s${i}`, pitch: 60 + i * 4, startBeat: s, durationBeats: 2, velocity: 100 })))
  check('a strummed chord is one chord', strum.length === 1 && strum[0].notes.length === 3)
  const arp = chordsOf([0, 0.25, 0.5, 0.75].map((s, i) => ({ id: `a${i}`, pitch: 60 + i * 4, startBeat: s, durationBeats: 0.25, velocity: 100 })))
  check('an arpeggio is not', arp.length === 0)
}

// ── The spoken note address ─────────────────────────────────────────────────
{
  const p = s => parseNoteAddress(s)
  check('"the first chord"', p('the first chord')?.addr.chord === 1)
  check('"the third chord"', p('the third chord')?.addr.chord === 3)
  check('"the last chord"', p('the last chord')?.addr.chord === 'last')
  check('"chord 2"', p('chord 2')?.addr.chord === 2)
  check('"the first two chords"', (() => { const a = p('the first two chords')?.addr; return a?.chord === 1 && a?.count === 2 })())
  check('"the second note"', p('the second note')?.addr.note === 2)
  check('"the highest note"', p('the highest note')?.addr.note === 'highest')
  check('"the notes above C5"', p('the notes above C5')?.addr.above === 72, JSON.stringify(p('the notes above C5')))
  check('"the notes below C3"', p('the notes below C3')?.addr.below === 48)
  check('"every C"', p('every C')?.addr.pitchClass === 0)
  check('"the chord at bar 3"', (() => { const r = p('the chord at bar 3'); return r?.addr.chord === 'first' && r?.atSaid === 'bar 3' })(), JSON.stringify(p('the chord at bar 3')))
  check('"the chord about a second in"', p('the chord about a second in')?.atSeconds === 1, JSON.stringify(p('the chord about a second in')))
  check('"take the bass up an octave" names no part', p('take the bass up an octave') === null)
  check('"1 bar" names no part', p('1 bar') === null)
  const third = addressNotes(organ.notes, { chord: 3 })
  check('the third chord is picked with its span', third.notes.map(n => n.pitch).join() === '64,67,71' && third.startBeat === 9 && third.endBeat === 13)
  const above = addressNotes(organ.notes, { above: 72 })
  check('"above C5" keeps only the notes above it', above.notes.map(n => n.pitch).join() === '76,74')
}

// ── The record: "recreate the first chord in a chord progression" ───────────
{
  const p = plan('copy_notes', { target: 'Organ chords', part: 'first chord', at: { bar: 5 } })
  const clip = ofType(p, 'ADD_CLIP')[0]?.clip
  check('"the first chord" of a progression is that chord, not every note', clip && clip.notes.length === 3 && clip.notes.map(n => n.pitch).join() === '60,64,67', JSON.stringify(p))
  check('starting at the chord, cut at the next chord', clip && clip.notes.every(n => n.startBeat === 0 && n.durationBeats === 4), JSON.stringify(clip?.notes))
  check('and says so', /Copied the first chord \(3 notes\)/.test(p.say ?? ''), p.say)
  const third = plan('copy_notes', { target: 'Organ chords', notes: 'the third chord', at: { bar: 5 } })
  check('"the third chord" is the third', ofType(third, 'ADD_CLIP')[0]?.clip.notes.map(n => n.pitch).join() === '64,67,71', JSON.stringify(third))
  const melody = plan('copy_notes', { target: 'Bass line', part: 'first chord', at: { bar: 5 } })
  check('"the first chord" of a melody is its first note, and says so', ofType(melody, 'ADD_CLIP')[0]?.clip.notes.length === 1 && /first note/.test(melody.say ?? ''), melody.say)
  const named = plan('name_notes', { target: 'Organ chords', notes: 'the first chord' })
  check('"what is the first chord in the organ chords" names only that chord', /The first chord in "Organ chords" \(bar 1 beat 2\): C4, E4, G4 - that's C/.test(named.say ?? ''), named.say)
  const whole = plan('name_notes', { target: 'Organ chords' })
  check('the whole clip is answered as a progression', /4 chords: C, Dm, Em, G/.test(whole.say ?? ''), whole.say)
  const c = first('what is the first chord in the organ chords')
  check('the rule reads which clip and which part', c?.name === 'name_notes' && /organ chords/i.test(c.input.target ?? '') && c.input.notes === 'the first chord', JSON.stringify(c))
}

// ── Notes inside a clip, by command ─────────────────────────────────────────
{
  const t = first('transpose the third chord of the organ chords up an octave')
  check('"transpose the third chord of the organ chords up an octave"', t?.name === 'transpose' && t.input.semitones === 12 && t.input.notes === 'the third chord' && /organ chords/i.test(t.input.target), JSON.stringify(t))
  const tp = plan('transpose', { target: 'Organ chords', semitones: 12, notes: 'the third chord' })
  check('and only those three notes move', ofType(tp, 'UPDATE_MIDI_NOTE').length === 3 && ofType(tp, 'UPDATE_MIDI_NOTE').every(a => a.noteId.startsWith('o-2-')), JSON.stringify(tp))
  check('"take the bass up an octave" is still the whole clip', ofType(plan('transpose', { target: 'Bass line', semitones: 12 }), 'UPDATE_MIDI_NOTE').length === 4)
  const v = first('make the last chord of the organ chords softer')
  check('"make the last chord of the organ chords softer"', v?.name === 'set_velocity' && v.input.notes === 'the last chord', JSON.stringify(v))
  const vp = plan('set_velocity', { target: 'Organ chords', scale: 80, notes: 'the last chord' })
  check('and only the last chord gets softer', ofType(vp, 'UPDATE_MIDI_NOTE').length === 3 && ofType(vp, 'UPDATE_MIDI_NOTE').every(a => a.noteId.startsWith('o-3-')), JSON.stringify(vp))
  const d = first('delete the third note of the bass line')
  check('"delete the third note of the bass line"', d?.name === 'edit_note' && d.input.action === 'remove' && d.input.notes === 'the third note', JSON.stringify(d))
  const dp = plan('edit_note', { action: 'remove', target: 'Bass line', notes: 'the third note' })
  check('and it is the third by onset', ofType(dp, 'REMOVE_MIDI_NOTE')[0]?.noteId === 'b2', JSON.stringify(dp))
  const a = first('remove the notes above C5 in the organ chords')
  check('"remove the notes above C5 in the organ chords"', a?.name === 'edit_note' && /above C5/i.test(a.input.notes ?? ''), JSON.stringify(a))
  const ap = plan('edit_note', { action: 'remove', target: 'Organ chords', notes: 'the notes above C5' })
  check('and takes out the two above it', ofType(ap, 'REMOVE_MIDI_NOTE').length === 2, JSON.stringify(ap))
  check('"delete the last note of the bass" still works', first('delete the last note of the bass')?.name === 'edit_note')
  const oc = first('delete the organ chords clip')
  check('"delete the organ chords clip" is the clip, not its last note', oc?.name === 'remove_clip' && /organ chords/i.test(oc.input.target ?? ''), JSON.stringify(oc))
  const beat = first('delete the beat clip', ctxOf({ clips: [...ctx.clips, { id: 'cb', name: 'Beat', trackId: 't2', kind: 'midi' }] }))
  check('"delete the beat clip" is a clip called Beat', beat?.name === 'remove_clip' && /beat/i.test(beat.input.target ?? ''), JSON.stringify(beat))
  const lc = first('delete the last chord of the organ chords')
  check('"delete the last chord of the organ chords" is the chord', lc?.name === 'edit_note' && lc.input.notes === 'the last chord', JSON.stringify(lc))
}

// ── The selection: "them", "these" ──────────────────────────────────────────
{
  const sel = ctxOf({ selectedClipIds: ['c1', 'c2'] })
  const heard = { selectedClipIds: ['c1', 'c2'] }
  const d = first('delete them', sel)
  check('"delete them" with two clips selected is the set', d?.name === 'remove_clip' && d.input.target === '#sel:c1,c2', JSON.stringify(d))
  const dp = plan('remove_clip', { target: '#sel:c1,c2' }, heard)
  check('and the planner deletes both', ofType(dp, 'REMOVE_CLIP').length === 2, JSON.stringify(dp))
  const c = first('colour these blue', sel)
  check('"colour these blue" is the set', c?.name === 'set_colour' && c.input.target === '#sel:c1,c2', JSON.stringify(c))
  const cp = plan('set_colour', { target: 'the selected clips', colour: 'blue' }, heard)
  check('"the selected clips" from the assistant is the set too', ofType(cp, 'UPDATE_CLIP').length === 2, JSON.stringify(cp))
  const m = first('move them back a bar', sel)
  check('"move them back a bar" moves the set, not everything', m?.name === 'move_clips' && m.input.target === '#sel:c1,c2', JSON.stringify(m))
  const mp = plan('move_clips', { target: '#sel:c1,c2', by: { bars: 1 } }, heard)
  check('and the planner moves the two', (mp.actions ?? []).filter(a => a.type === 'MOVE_CLIP' || (a.type === 'UPDATE_CLIP' && a.patch?.startBeat != null)).length === 2, JSON.stringify(mp))
  const mu = first('mute these', sel)
  check('"mute these" with clips selected is their tracks', mu?.name === 'set_track' && mu.input.target === '#sel:c1,c2', JSON.stringify(mu))
  const mup = plan('set_track', { target: '#sel:c1,c2', muted: true }, heard)
  check('and the planner mutes the one track they are on', ofType(mup, 'UPDATE_TRACK').length === 1 && ofType(mup, 'UPDATE_TRACK')[0].trackId === 't1', JSON.stringify(mup))
  const one = ctxOf({ selectedClipIds: ['c1'] })
  check('one clip selected keeps the old id form', first('delete it', one)?.input.target === '#c1', JSON.stringify(first('delete it', one)))
  const audioSel = ctxOf({ selectedClipIds: ['c3', 'c6'] })
  const f = first('fade them out over a bar', audioSel)
  check('"fade them out over a bar" with two takes selected', f?.name === 'set_clip_audio' && f.input.target === '#sel:c3,c6' && f.input.fadeOut?.bars === 1, JSON.stringify(f))
  const tp = plan('transpose', { target: 'them', semitones: 12 }, heard)
  check('"transpose them up an octave" moves both clips\' notes', ofType(tp, 'UPDATE_MIDI_NOTE').length === 2, JSON.stringify(tp))
}

// ── Places: ranges and sections ─────────────────────────────────────────────
{
  check('the chorus runs from its marker to the next', (() => { const s = sectionSpan(project, 'chorus'); return s?.start === 32 && s?.end === 64 })())
  check('clips in the chorus', addressClips(project, { section: 'chorus' }).map(c => c.id).join() === 'c2')
  const b = first('select the clips between bar 1 and 5')
  check('"select the clips between bar 1 and 5"', b?.name === 'select' && b.input.after?.bar === 1 && b.input.before?.bar === 5, JSON.stringify(b))
  const bp = plan('select', { what: 'clips', after: { bar: 1 }, before: { bar: 5 } })
  check('and selects what starts inside', (ofType(bp, 'SELECT')[0]?.clipIds ?? []).length === 5, JSON.stringify(bp))
  const s = first('select everything on the pad before the chorus')
  check('"select everything on the pad before the chorus"', s?.name === 'select' && /pad/i.test(s.input.track ?? '') && s.input.before?.marker === 'chorus', JSON.stringify(s))
  const sp = plan('select', { what: 'clips', track: 'pad', before: { marker: 'chorus' } })
  check('and it is the one pad clip before bar 9', (ofType(sp, 'SELECT')[0]?.clipIds ?? []).join() === 'c1', JSON.stringify(sp))
  const i = first('select the clips in the chorus')
  check('"select the clips in the chorus" is the section', i?.name === 'select' && i.input.section === 'chorus', JSON.stringify(i))
  const ip = plan('select', { what: 'clips', section: 'chorus' })
  check('and finds the clip inside it', (ofType(ip, 'SELECT')[0]?.clipIds ?? []).join() === 'c2', JSON.stringify(ip))
  const d = first('delete everything on the pad before the chorus')
  check('"delete everything on the pad before the chorus"', d?.name === 'remove_clip' && /pad/i.test(d.input.track ?? '') && d.input.before?.marker === 'chorus', JSON.stringify(d))
  const dp = plan('remove_clip', { target: '', track: 'pad', before: { marker: 'chorus' } })
  check('and deletes just that one', ofType(dp, 'REMOVE_CLIP').length === 1 && ofType(dp, 'REMOVE_CLIP')[0].clipId === 'c1', JSON.stringify(dp))
  const m = first('move everything on the pad before the chorus back 2 bars')
  check('"move everything on the pad before the chorus back 2 bars"', m?.name === 'move_clips' && /pad/i.test(m.input.track ?? '') && m.input.before?.marker === 'chorus' && m.input.by?.bars === 2, JSON.stringify(m))
  const a = first('select the pad clips after the chorus')
  check('"after the chorus" is a place', a?.name === 'select' && a.input.after?.marker === 'chorus', JSON.stringify(a))
  check('"select everything" is still everything', first('select everything')?.input.what === 'all')
  check('"move everything back a bar" still moves everything', (() => { const x = first('move everything back a bar'); return x?.name === 'move_clips' && x.input.target === undefined })(), JSON.stringify(first('move everything back a bar')))
}

// ── Tracks: sets ────────────────────────────────────────────────────────────
{
  const p = s => parseTrackAddress(s)
  check('"all the drum tracks"', p('all the drum tracks')?.only?.join() === 'drums', JSON.stringify(p('all the drum tracks')))
  check('"every muted track"', p('every muted track')?.only?.join() === 'muted')
  check('"the tracks with reverb"', p('the tracks with reverb')?.withEffect === 'reverb', JSON.stringify(p('the tracks with reverb')))
  check('"everything except the drums"', (() => { const a = p('everything except the drums'); return a?.all === true && a?.except?.join() === 'drums' })(), JSON.stringify(p('everything except the drums')))
  check('"the drums" is one track, not a set', p('the drums') === null)
  check('"the drums track" is one track, not a set', p('the drums track') === null)
  check('the drum tracks are the drums', addressTracks(project, { only: ['drums'] }).map(t => t.name).join() === 'Drums')
  check('the muted tracks', addressTracks(project, { only: ['muted'] }).map(t => t.name).join() === 'FX')
  check('the tracks with reverb', addressTracks(project, { withEffect: 'reverb' }).map(t => t.name).join() === 'Drums,FX')
  check('the audio tracks', addressTracks(project, { only: ['audio'] }).map(t => t.name).join() === 'Vox')
  check('the empty tracks', addressTracks(project, { only: ['empty'] }).map(t => t.name).join() === 'Spare')
  check('everything except the drums', addressTracks(project, { all: true, except: ['drums'] }).length === 6)

  const m = first('mute all the drum tracks')
  check('"mute all the drum tracks"', m?.name === 'set_track' && m.input.muted === true && m.input.only?.join() === 'drums', JSON.stringify(m))
  const mp = plan('set_track', { target: 'all the drum tracks', muted: true, only: ['drums'] })
  check('and the planner mutes the drums', ofType(mp, 'UPDATE_TRACK').length === 1 && ofType(mp, 'UPDATE_TRACK')[0].trackId === 't2' && /1 track muted/.test(mp.say ?? ''), mp.say ?? mp.problem)
  const u = first('unmute every muted track')
  check('"unmute every muted track"', u?.name === 'set_track' && u.input.muted === false && u.input.only?.join() === 'muted', JSON.stringify(u))
  const up = plan('set_track', { target: 'every muted track', muted: false })
  check('and the planner finds FX', ofType(up, 'UPDATE_TRACK').map(a => a.trackId).join() === 't7', JSON.stringify(up))
  const r = first('turn down the tracks with reverb')
  check('"turn down the tracks with reverb" moves by an amount', r?.name === 'set_track' && r.input.withEffect === 'reverb' && r.input.volumeBy < 0, JSON.stringify(r))
  const rp = plan('set_track', { target: 'the tracks with reverb', withEffect: 'reverb', volumeBy: -15 })
  check('and each starts from its own fader', ofType(rp, 'UPDATE_TRACK').length === 2 && Math.abs(ofType(rp, 'UPDATE_TRACK')[0].patch.volume - 0.65) < 1e-9 && Math.abs(ofType(rp, 'UPDATE_TRACK')[1].patch.volume - 0.45) < 1e-9, JSON.stringify(rp))
  const s = first('solo the audio tracks')
  check('"solo the audio tracks"', s?.name === 'set_track' && s.input.solo === true && s.input.only?.join() === 'audio', JSON.stringify(s))
  const e = first('mute everything except the drums')
  check('"mute everything except the drums" stays with strip_back, which owns it', e?.name === 'strip_back', JSON.stringify(e))
  const e2 = first('solo everything except the drums')
  check('"solo everything except the drums" is a set', e2?.name === 'set_track' && e2.input.all === true && e2.input.except?.join() === 'drums', JSON.stringify(e2))
  const ep = plan('set_track', { target: 'everything', muted: true, all: true, except: ['drums'] })
  check('and the drums stay', ofType(ep, 'UPDATE_TRACK').length === 6 && !ofType(ep, 'UPDATE_TRACK').some(a => a.trackId === 't2'), JSON.stringify(ep))
  const d = first('delete the empty tracks')
  check('"delete the empty tracks"', d?.name === 'remove_track' && d.input.only?.join() === 'empty', JSON.stringify(d))
  const dp = plan('remove_track', { target: 'the empty tracks', only: ['empty'] })
  check('and only Spare goes', ofType(dp, 'REMOVE_TRACK').map(a => a.trackId).join() === 't6', JSON.stringify(dp))
  const c = first('colour all the drum tracks red')
  check('"colour all the drum tracks red"', c?.name === 'set_colour' && c.input.of === 'track' && c.input.only?.join() === 'drums', JSON.stringify(c))
  const cp = plan('set_colour', { target: 'all the drum tracks', colour: 'red', of: 'track', only: ['drums'] })
  check('and colours the drums track', ofType(cp, 'UPDATE_TRACK').length === 1 && ofType(cp, 'UPDATE_TRACK')[0].patch.color === '#ef4444', JSON.stringify(cp))
  check('"mute the drums" is still one track', first('mute the drums')?.input.only === undefined && /drums/i.test(first('mute the drums')?.input.target ?? ''))
  check('"bring the drums down a bit" is still one track', (() => { const x = first('bring the drums down a bit'); return x?.name === 'set_track' && x.input.volumeBy === undefined })(), JSON.stringify(first('bring the drums down a bit')))
}

// ── Signed out, a delete is confirmed, not refused ──────────────────────────
{
  const control = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  check('the signed-out fallback asks instead of refusing a destructive read', /local\.destructive\) \{[\s\S]*?Say yes, or press Do it/.test(control))
  check('and "yes" runs it, "no" cancels it, before the gate', /pendingDoRef\.current\) \{[\s\S]*?yes\|yeah\|yep[\s\S]*?confirmed by voice[\s\S]*?cancelled by voice/.test(control))
  check('as one undo step', /beginUndoGroup\?\.\(pending\.label\)[\s\S]*?endUndoGroup\?\.\(\)/.test(control))
  check('the selection reaches the rules and the planner', /selectedClipIds: \[\.\.\.\(selectedClipIds \?\? \[\]\)\]/.test(control) && /selectedClipIds: \[\.\.\.\(selectedClipIdsRef\.current \?\? \[\]\)\]/.test(control))
  check('and the markers reach the rules', /markers: \(project\.cueMarkers \?\? \[\]\)\.map/.test(control))
}

console.log(failures ? `\n${failures} failing` : '\nnamed, whatever it is')
assert.equal(failures, 0)
