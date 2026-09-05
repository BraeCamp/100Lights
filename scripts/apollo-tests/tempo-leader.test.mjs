// Tempo leader (lib/tempo-leader.ts) and how a sample lands
// (lib/import-settings.ts). Pure functions: the clip's markers become the
// song's tempo map; a dropped sample becomes a one-shot, a loop or a straight
// warp by its length and the setting.
//
//   node scripts/apollo-tests/tempo-leader.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { leaderOf, leaderMap, followLeader, setLeader, releaseLeader, touchesLeader, describeLeaderMap } = await importTs('lib/tempo-leader.ts')
const { loopGuess, landingFor, landingPlan, describeLanding, LONG_SAMPLE_SEC, IMPORT_DEFAULT } = await importTs('lib/import-settings.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
const near = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) < eps, `${msg} expected ${b}, got ${a}`)

const audio = (extra = {}) => ({ kind: 'audio', id: 'a', trackId: 't', name: 'Loop', startBeat: 0, durationBeats: 8, gain: 1, loopEnabled: false, reverse: false, fadeIn: 0, fadeOut: 0, trimStart: 0, trimEnd: 0, ...extra })
const midi = { kind: 'midi', id: 'm', trackId: 't2', name: 'Pad', startBeat: 0, durationBeats: 8, notes: [] }
const project = (clips, tempo = 120, tempoMarkers) => ({ arrangementClips: clips, tempo, tempoMarkers })

console.log('\nthe leader\'s markers become the tempo map')

ok('two markers, one segment: the map is one tempo — the opening marker carries it', () => {
  // 8 beats over 4 s = 120 BPM.
  const m = leaderMap(audio({ warpMarkers: [{ beat: 0, sec: 0 }, { beat: 8, sec: 4 }] }))
  assert.equal(m.tempo, 120)
  assert.deepEqual(m.tempoMarkers, [{ id: 'leader-0', beat: 0, tempo: 120 }])
  assert.equal(m.segments, 1)
})

ok('three markers, two tempos: a marker where the second segment begins', () => {
  // beats 0–4 over 2 s = 120; beats 4–8 over 1 s = 240.
  const m = leaderMap(audio({ warpMarkers: [{ beat: 0, sec: 0 }, { beat: 4, sec: 2 }, { beat: 8, sec: 3 }] }))
  assert.equal(m.tempo, 120)
  assert.deepEqual(m.tempoMarkers, [{ id: 'leader-0', beat: 0, tempo: 120 }, { id: 'leader-2', beat: 4, tempo: 240 }].map((x, i) => ({ ...x, id: i === 0 ? 'leader-0' : 'leader-1' })))
  assert.equal(m.segments, 2)
  assert.equal(describeLeaderMap(m), '2 tempos, 120–240 BPM')
})

ok('the clip\'s place moves its tempo changes: a leader at bar 3 puts the second tempo at bar 3 + 4 beats', () => {
  const m = leaderMap(audio({ startBeat: 8, warpMarkers: [{ beat: 0, sec: 0 }, { beat: 4, sec: 2 }, { beat: 8, sec: 3 }] }))
  assert.equal(m.tempoMarkers[1].beat, 12)
  assert.equal(m.tempoMarkers[0].beat, 0, 'the opening marker still pins beat 0 with the first tempo')
})

ok('no markers: the Seg BPM is the tempo, straight', () => {
  // A 2 s sample spanning 8 beats is 240 BPM.
  const m = leaderMap(audio({ bufferDuration: 2 }))
  assert.equal(m.tempo, 240)
  assert.equal(m.tempoMarkers.length, 1)
  assert.equal(describeLeaderMap(m), '240 BPM, straight')
})

ok('no markers and no length: nothing to follow yet', () => {
  assert.equal(leaderMap(audio()), null)
})

ok('equal tempos on both sides of a marker need no tempo marker; the BPM is clamped to the song range', () => {
  const m = leaderMap(audio({ warpMarkers: [{ beat: 0, sec: 0 }, { beat: 4, sec: 2 }, { beat: 8, sec: 4 }] }))
  assert.equal(m.tempoMarkers.length, 1)
  const fast = leaderMap(audio({ warpMarkers: [{ beat: 0, sec: 0 }, { beat: 8, sec: 0.5 }] }))
  assert.equal(fast.tempo, 300, 'a 960 BPM segment clamps to 300')
})

console.log('\nthe project follows one leader')

ok('setLeader flags the clip and rewrites tempo and markers; a MIDI clip is untouched', () => {
  const p = setLeader(project([audio({ warpMarkers: [{ beat: 0, sec: 0 }, { beat: 4, sec: 2 }, { beat: 8, sec: 3 }] }), midi], 100, [{ id: 'old', beat: 16, tempo: 90 }]), 'a')
  assert.equal(leaderOf(p).id, 'a')
  assert.equal(p.tempo, 120)
  assert.deepEqual(p.tempoMarkers.map(m => [m.beat, m.tempo]), [[0, 120], [4, 240]])
  assert.equal(p.arrangementClips[1], midi, 'the MIDI clip is the same object')
})

ok('a second leader replaces the first — only one leads', () => {
  const p1 = setLeader(project([audio({ bufferDuration: 4 }), audio({ id: 'b', bufferDuration: 2 })]), 'a')
  assert.equal(p1.tempo, 120)
  const p2 = setLeader(p1, 'b')
  assert.equal(leaderOf(p2).id, 'b')
  assert.equal(p2.arrangementClips[0].tempoLeader, undefined)
  assert.equal(p2.tempo, 240)
})

ok('setLeader(null) and releaseLeader clear the flag and keep the tempo where it was', () => {
  const p = setLeader(project([audio({ bufferDuration: 2 })]), 'a')
  assert.equal(p.tempo, 240)
  const r = setLeader(p, null)
  assert.equal(leaderOf(r), null)
  assert.equal(r.tempo, 240)
  const r2 = releaseLeader(p)
  assert.equal(leaderOf(r2), null)
  assert.equal(r2.tempo, 240)
  assert.equal(releaseLeader(r2), r2, 'nothing to release: the same object back')
})

ok('followLeader re-derives after the leader\'s markers change, and returns the same object when nothing changed', () => {
  const p = setLeader(project([audio({ warpMarkers: [{ beat: 0, sec: 0 }, { beat: 8, sec: 4 }] })]), 'a')
  assert.equal(followLeader(p), p, 'unchanged: same object')
  const edited = { ...p, arrangementClips: [{ ...p.arrangementClips[0], warpMarkers: [{ beat: 0, sec: 0 }, { beat: 8, sec: 2 }] }] }
  const f = followLeader(edited)
  assert.equal(f.tempo, 240)
  const moved = { ...p, arrangementClips: [{ ...p.arrangementClips[0], startBeat: 4, warpMarkers: [{ beat: 0, sec: 0 }, { beat: 4, sec: 2 }, { beat: 8, sec: 3 }] }] }
  assert.deepEqual(followLeader(moved).tempoMarkers.map(m => m.beat), [0, 8], 'the tempo change moved with the clip')
})

ok('followLeader with no leader, or a leader whose length is unknown, is a no-op', () => {
  const p = project([audio({ bufferDuration: 2 })])
  assert.equal(followLeader(p), p)
  const unknown = project([audio({ tempoLeader: true })])
  assert.equal(followLeader(unknown), unknown)
})

ok('touchesLeader: markers, place, length, Seg BPM, trims and the flag itself — not the gain', () => {
  for (const f of ['warpMarkers', 'startBeat', 'durationBeats', 'segBpm', 'bufferDuration', 'trimStart', 'trimEnd', 'tempoLeader']) assert.ok(touchesLeader({ [f]: 1 }), f)
  assert.ok(!touchesLeader({ gain: 0.5, name: 'x' }))
})

console.log('\nhow a sample lands (Loop/Warp Short Samples)')

ok('loopGuess: a 2 s sample at 120 in 4/4 is one bar exactly; 2.1 s is one bar, 5% off', () => {
  assert.deepEqual(loopGuess(2, 120, 4), { bars: 1, segBpm: 120, error: 0 })
  const g = loopGuess(2.1, 120, 4)
  assert.equal(g.bars, 1); near(g.error, 0.05); near(g.segBpm, 114.29, 0.01)
  assert.equal(loopGuess(0, 120, 4), null)
})

ok('Auto: whole bars at a plausible tempo is a loop; an odd length or a wild tempo is a one-shot', () => {
  const s = { shortSamples: 'auto', autoWarpLong: true }
  assert.equal(landingFor(4, 120, 4, s), 'loop', 'two bars exactly')
  assert.equal(landingFor(4.1, 120, 4, s), 'loop', '2.5% off two bars')
  assert.equal(landingFor(2.7, 120, 4, s), 'oneshot', '35% off a bar')
  assert.equal(landingFor(0.3, 120, 4, s), 'oneshot', 'a hit: 0.3 s "is" one bar at 800 BPM — not a loop tempo')
  assert.equal(landingFor(29, 120, 4, s), 'oneshot', '14.5 bars is not whole')
})

ok('Unwarped one-shot and Warped loop force the short-sample decision', () => {
  assert.equal(landingFor(2.7, 120, 4, { shortSamples: 'oneshot', autoWarpLong: true }), 'oneshot')
  assert.equal(landingFor(4, 120, 4, { shortSamples: 'oneshot', autoWarpLong: true }), 'oneshot')
  assert.equal(landingFor(2.7, 120, 4, { shortSamples: 'loop', autoWarpLong: true }), 'loop')
  assert.equal(landingFor(0.3, 120, 4, { shortSamples: 'loop', autoWarpLong: true }), 'loop', 'asked for loops: even a hit becomes a one-bar loop')
})

ok('long samples: auto-warped straight, or left as a one-shot', () => {
  assert.equal(landingFor(LONG_SAMPLE_SEC, 120, 4, { shortSamples: 'auto', autoWarpLong: true }), 'straight')
  assert.equal(landingFor(180, 120, 4, { shortSamples: 'loop', autoWarpLong: true }), 'straight', 'the loop setting is for short samples')
  assert.equal(landingFor(180, 120, 4, { shortSamples: 'auto', autoWarpLong: false }), 'oneshot')
})

ok('landingPlan: a one-shot spans its own seconds at the song tempo with warp and loop off', () => {
  const p = landingPlan(2.7, 120, 4, { shortSamples: 'oneshot', autoWarpLong: true })
  assert.equal(p.landing, 'oneshot')
  near(p.patch.durationBeats, 5.4)
  assert.equal(p.patch.warpEnabled, false); assert.equal(p.patch.loopEnabled, false)
  assert.equal(describeLanding(p, 4), 'one-shot, at its own speed')
})

ok('landingPlan: a loop spans whole bars, warped as that loop, looping, at the Seg BPM that fits', () => {
  const p = landingPlan(4.1, 120, 4, IMPORT_DEFAULT)
  assert.equal(p.landing, 'loop')
  assert.equal(p.patch.durationBeats, 8)
  assert.equal(p.patch.warpEnabled, true); assert.equal(p.patch.loopEnabled, true)
  near(p.patch.segBpm, 117.07, 0.01)
  assert.deepEqual(p.patch.warpMarkers.map(m => [m.beat, m.sec]), [[0, 0], [8, 4.1]])
  assert.equal(describeLanding(p, 4), '2-bar loop at 117.07 BPM')
})

ok('landingPlan: a long sample is warped straight — no markers, Seg BPM the song tempo, its own seconds', () => {
  const p = landingPlan(45, 100, 4, IMPORT_DEFAULT)
  assert.equal(p.landing, 'straight')
  near(p.patch.durationBeats, 75)
  assert.equal(p.patch.warpEnabled, true); assert.equal(p.patch.loopEnabled, false)
  assert.equal(p.patch.segBpm, 100); assert.equal(p.patch.warpMarkers, undefined)
})

ok('a nonsense tempo or bar length falls back to 120 in 4/4', () => {
  const p = landingPlan(2, 0, 0, { shortSamples: 'loop', autoWarpLong: true })
  assert.equal(p.patch.durationBeats, 4); assert.equal(p.patch.segBpm, 120)
})

console.log(`\n${passed} passed`)
