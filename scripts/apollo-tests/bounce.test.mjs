// Bounce (lib/bounce.ts): a track's devices printed as audio — what gets
// printed, what the new track inherits, and what is said afterwards.
//
//   node scripts/apollo-tests/bounce.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { bounceSpan, clipsInSpan, bounceName, bouncedTrack, preMixerProject, describeBounce } =
  await importTs('lib/bounce.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }

const track = (over = {}) => ({
  id: 't1', name: 'Pad', type: 'audio', color: '#a78bfa',
  volume: 0.42, pan: -0.5, mute: false, solo: false, armed: false, height: 90,
  effects: [{ id: 'fx1', type: 'reverb', params: {} }],
  instrument: { type: 'poly', params: {} },
  sendAmounts: { r1: 0.3 }, sendModes: { r1: 'post' }, crossfader: 'A',
  ...over,
})

const project = (over = {}) => ({
  timeSignatureNum: 4, timeSignatureDen: 4,
  tracks: [track(), { ...track(), id: 't2', name: 'Drums' }],
  arrangementClips: [
    { kind: 'midi', id: 'a', trackId: 't1', name: 'A', startBeat: 4, durationBeats: 8, notes: [] },
    { kind: 'midi', id: 'b', trackId: 't1', name: 'B', startBeat: 16, durationBeats: 4, notes: [] },
    { kind: 'midi', id: 'c', trackId: 't2', name: 'C', startBeat: 0, durationBeats: 32, notes: [] },
  ],
  returnTracks: [{ id: 'r1', name: 'Reverb' }],
  ...over,
})

console.log('\nwhat gets printed')

ok('everything the track plays, when nothing is selected', () => {
  assert.deepEqual(bounceSpan(project(), 't1'), { startBeat: 4, endBeat: 20 })
})

ok('only the selected clips, when some are', () => {
  assert.deepEqual(bounceSpan(project(), 't1', ['b']), { startBeat: 16, endBeat: 20 })
})

ok('a selection on ANOTHER track does not narrow this one', () => {
  // ⚠️ 'c' is on t2. Narrowing to nothing would refuse the bounce for a reason
  // nobody could see, so the whole track prints instead.
  assert.deepEqual(bounceSpan(project(), 't1', ['c']), { startBeat: 4, endBeat: 20 })
  assert.deepEqual(clipsInSpan(project(), 't1', { startBeat: 4, endBeat: 20 }, ['c']).map(x => x.id), ['a', 'b'])
})

ok('parked clips are not printed', () => {
  const p = project()
  p.arrangementClips[0].active = false
  assert.deepEqual(bounceSpan(p, 't1'), { startBeat: 16, endBeat: 20 })
})

ok('an empty track is refused rather than printing silence', () => {
  // ⚠️ A silent clip on the timeline looks exactly like a working one until
  // somebody presses play.
  assert.equal(bounceSpan(project({ arrangementClips: [] }), 't1'), null)
})

ok('the clips a bounce covers are the ones that overlap it', () => {
  const ids = clipsInSpan(project(), 't1', { startBeat: 4, endBeat: 20 }).map(c => c.id)
  assert.deepEqual(ids, ['a', 'b'])
  assert.deepEqual(clipsInSpan(project(), 't1', { startBeat: 16, endBeat: 20 }).map(c => c.id), ['b'])
})

console.log('\nhow it renders')

ok('the source plays at unity and centre with its sends off', () => {
  // ⚠️ Pre-mixer: what is printed is its devices and nothing else.
  const p = preMixerProject(project(), 't1')
  const t = p.tracks.find(x => x.id === 't1')
  assert.equal(t.volume, 1)
  assert.equal(t.pan, 0)
  assert.deepEqual(t.sendAmounts, {})
  assert.equal(t.crossfader, undefined)
  assert.deepEqual(t.effects.map(e => e.id), ['fx1'], 'the devices are the whole point — they stay')
})

ok('the other tracks are left alone, not deleted', () => {
  // A track removed here would take its group bus with it.
  const p = preMixerProject(project(), 't1')
  assert.equal(p.tracks.length, 2)
  assert.equal(p.tracks.find(x => x.id === 't2').volume, 0.42)
})

console.log('\nthe new track')

ok('it inherits the mixer position, so the bounce sounds like the source', () => {
  // ⚠️ Live leaves the new track at default, which makes a bounce of a track
  // you had pulled down come back twice as loud.
  const t = bouncedTrack(track(), 'new1')
  assert.equal(t.volume, 0.42)
  assert.equal(t.pan, -0.5)
  assert.deepEqual(t.sendAmounts, { r1: 0.3 })
  assert.deepEqual(t.sendModes, { r1: 'post' })
  assert.equal(t.crossfader, 'A')
  assert.equal(t.color, '#a78bfa')
  assert.equal(t.height, 90)
})

ok('and none of the devices — they are in the audio now', () => {
  assert.deepEqual(bouncedTrack(track(), 'new1').effects, [])
})

ok('it joins the same group', () => {
  assert.equal(bouncedTrack(track({ groupId: 'g1' }), 'new1').groupId, 'g1')
})

ok('the name says what it is, once', () => {
  assert.equal(bounceName('Pad'), 'Pad (bounced)')
  assert.equal(bounceName('Pad (bounced)'), 'Pad (bounced)', 'twice would give "(bounced) (bounced)"')
  assert.equal(bounceName(''), 'Track (bounced)')
})

console.log('\nwhat it says')

ok('to a new track it says the originals are parked', () => {
  const s = describeBounce('newTrack', 'Pad', { startBeat: 4, endBeat: 20 }, 4, 2)
  assert.match(s, /bars 2 to 5/)
  assert.match(s, /parked/)
  assert.match(s, /2 clips are/)
})

ok('in place it says what was replaced', () => {
  const s = describeBounce('inPlace', 'Pad', { startBeat: 0, endBeat: 4 }, 4, 1)
  assert.match(s, /bar 1/)
  assert.match(s, /replacing the clip/)
})

console.log(`\n${passed} passed`)
