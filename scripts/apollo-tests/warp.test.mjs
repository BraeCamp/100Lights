// Warp markers (lib/warp.ts): the beat↔second map is piecewise linear through
// the markers and keeps the nearest span's speed beyond them; markers insert,
// move and remove without ever running backwards; Set 1.1.1 Here re-bases;
// straight, as-loop and at-BPM warps are two markers; transient quantising
// pins attacks to the grid. The renderer is checked in warp-render.test.mjs
// and the engine in .claude/warp-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { sortMarkers, validMarkers, beatToSec, secToBeat, insertMarker, moveMarker, moveMarkerBeat, removeMarker, set111Here, warpStraight, warpAsLoop, warpAtBpm, quantizeTransients, beatsThroughMap, markersKey } = await importTs('lib/warp.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol
// A drum loop whose hits drifted: beats 0..4 land at 0, 0.45, 1.05, 1.5, 2.0 s.
const ms = [{ beat: 0, sec: 0 }, { beat: 1, sec: 0.45 }, { beat: 2, sec: 1.05 }, { beat: 3, sec: 1.5 }, { beat: 4, sec: 2 }]

check('markers sort by beat and a list going backwards in time is not valid', () => {
  assert.deepEqual(sortMarkers([ms[2], ms[0], ms[1]]).map(m => m.beat), [0, 1, 2])
  assert.ok(validMarkers(ms))
  assert.equal(validMarkers([{ beat: 0, sec: 1 }, { beat: 1, sec: 0.5 }]), null)
  assert.equal(validMarkers([{ beat: 0, sec: 0 }]), null, 'one marker maps nothing')
})
check('the map is linear between markers and extrapolates with the nearest span', () => {
  assert.ok(near(beatToSec(ms, 1), 0.45)); assert.ok(near(beatToSec(ms, 1.5), 0.75)); assert.ok(near(beatToSec(ms, 2.5), 1.275))
  assert.ok(near(beatToSec(ms, 5), 2.5), 'past the end at the last span\'s half-second per beat')
  assert.ok(near(beatToSec(ms, -1), -0.45), 'before the start at the first span\'s speed')
  assert.ok(near(secToBeat(ms, 0.75), 1.5)); assert.ok(near(secToBeat(ms, 1.275), 2.5)); assert.ok(near(secToBeat(ms, 2.5), 5))
})
check('insert clamps the second between its neighbours and replaces a marker on the same beat', () => {
  const a = insertMarker(ms, 2.5, 1.2)
  assert.equal(a.length, 6); assert.ok(near(a[3].sec, 1.2))
  const clamped = insertMarker(ms, 2.5, 1.9)
  assert.ok(clamped[3].sec < 1.5, 'cannot pass the next marker in time')
  const replaced = insertMarker(ms, 2, 1.1)
  assert.equal(replaced.length, 5); assert.ok(near(replaced[2].sec, 1.1))
})
check('move slides the audio under a beat, clamped; ⇧-move changes the beat; remove drops one', () => {
  assert.ok(near(moveMarker(ms, 1, 0.5)[1].sec, 0.5))
  assert.ok(moveMarker(ms, 1, 1.2)[1].sec < 1.05, 'clamped before the next marker')
  assert.ok(near(moveMarkerBeat(ms, 1, 1.25)[1].beat, 1.25))
  assert.equal(removeMarker(ms, 4).length, 4)
})
check('Set 1.1.1 Here re-bases: the point becomes beat 0, later markers keep their seconds', () => {
  const r = set111Here(ms, 0.45)
  assert.deepEqual(r.map(m => [m.beat, m.sec]), [[0, 0.45], [1, 1.05], [2, 1.5], [3, 2]])
  const mid = set111Here(ms, 0.75)   // beat 1.5 under the old map
  assert.ok(near(mid[0].sec, 0.75) && near(mid[1].beat, 0.5) && near(mid[1].sec, 1.05))
})
check('straight, as-loop and at-BPM warps are two markers', () => {
  assert.deepEqual(warpStraight(0, 2, 4), [{ beat: 0, sec: 0 }, { beat: 4, sec: 2 }])
  assert.deepEqual(warpAsLoop(0.5, 2.5, 2, 4), [{ beat: 0, sec: 0.5 }, { beat: 8, sec: 2.5 }])
  assert.deepEqual(warpAtBpm(0, 2, 90), [{ beat: 0, sec: 0 }, { beat: 3, sec: 2 }])
  assert.deepEqual(warpStraight(1, 1, 4), [])
})
check('quantising transients pins each attack to the grid beat nearest where the map put it', () => {
  const straight = warpStraight(0, 2, 4)     // 0.5 s per beat
  const q = quantizeTransients(straight, [0, 0.45, 1.05, 1.5, 2], 1)
  assert.deepEqual(q.map(m => [m.beat, m.sec]), [[0, 0], [1, 0.45], [2, 1.05], [3, 1.5], [4, 2]])
  const half = quantizeTransients(straight, [0.45], 1, 0.5)
  assert.ok(near(half[1].beat, 0.95), 'half the way: 0.9 → 0.95')
  assert.ok(near(half[1].sec, 0.45))
})
check('the beats a sample spans through its map, and a stable key', () => {
  assert.ok(near(beatsThroughMap(ms, 2), 4)); assert.ok(near(beatsThroughMap(ms, 2.5), 5))
  assert.equal(markersKey(ms), markersKey([...ms].reverse()))
})

console.log(failures ? `\n${failures} failing` : '\nthe grid holds the beat')
process.exit(failures ? 1 : 0)
