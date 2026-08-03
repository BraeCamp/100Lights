// Unit tests for lib/tempo-map.ts. Run: node scripts/tempo-map.test.mjs
// Node ≥22 strips the TS types on import — no build step.
import {
  tempoSegments, beatToSeconds, secondsToBeat, spanSeconds, tempoAt,
  meterSegments, meterAt, beatsPerBarAt, barLines, nearestBarBeat,
} from '../lib/tempo-map.ts'

let passed = 0, failed = 0
const approx = (a, b, e = 1e-9) => Math.abs(a - b) <= e
function ok(name, cond) { if (cond) passed++; else { failed++; console.error(`  ✗ ${name}`) } }
function near(name, a, b, e) { ok(`${name} (got ${a}, want ${b})`, approx(a, b, e)) }

// ── SAFETY: no markers → identical to single-tempo math ──────────────────────
{
  const segs = tempoSegments({ tempo: 120 })
  ok('single segment', segs.length === 1 && segs[0].beat === 0 && segs[0].bpm === 120)
  for (const beat of [0, 1, 4, 7.5, 16, 100]) {
    near(`beatToSeconds collapses @${beat}`, beatToSeconds(beat, segs), beat * (60 / 120))
    near(`secondsToBeat collapses @${beat}`, secondsToBeat(beat * 0.5, segs), beat) // 0.5s/beat
  }
  near('span collapses', spanSeconds(3, 11, segs), 8 * 0.5)
}
{
  const segs = tempoSegments({ tempo: 140 })
  for (const beat of [0, 2.25, 13, 64]) {
    near(`round-trip @140 @${beat}`, secondsToBeat(beatToSeconds(beat, segs), segs), beat)
  }
}

// ── Piecewise tempo ──────────────────────────────────────────────────────────
{
  // 120bpm for beats [0,8), then 60bpm from beat 8.
  const segs = tempoSegments({ tempo: 120, tempoMarkers: [
    { id: 'a', beat: 0, tempo: 120 }, { id: 'b', beat: 8, tempo: 60 },
  ] })
  ok('two segments', segs.length === 2)
  near('sec @ boundary', beatToSeconds(8, segs), 8 * 0.5)          // 4s
  near('sec @ beat 12', beatToSeconds(12, segs), 4 + 4 * 1.0)      // 4s + 4beats@1s = 8s
  near('tempoAt before', tempoAt(4, segs), 120)
  near('tempoAt after', tempoAt(9, segs), 60)
  near('inverse @ 8s', secondsToBeat(8, segs), 12)
  for (const beat of [1, 8, 8.0001, 15, 40]) near(`piecewise round-trip @${beat}`, secondsToBeat(beatToSeconds(beat, segs), segs), beat, 1e-7)
  near('span across change', spanSeconds(6, 10, segs), 2 * 0.5 + 2 * 1.0) // 1 + 2 = 3s
}
{
  // Synthesized beat-0 segment when first marker is at beat > 0.
  const segs = tempoSegments({ tempo: 100, tempoMarkers: [{ id: 'x', beat: 16, tempo: 150 }] })
  ok('synthesized beat-0', segs.length === 2 && segs[0].beat === 0 && segs[0].bpm === 100)
}
{
  // Clamping + no-op dedupe + same-beat-last-wins.
  const segs = tempoSegments({ tempo: 120, tempoMarkers: [
    { id: 'a', beat: 0, tempo: 120 }, { id: 'b', beat: 4, tempo: 120 }, // no-op, dropped
    { id: 'c', beat: 8, tempo: 999 }, { id: 'd', beat: 8, tempo: 90 },  // same beat, last wins
  ] })
  ok('no-op dropped', segs.length === 2)
  ok('same-beat last wins + clamp', segs[1].bpm === 90)
}

// ── Meter ────────────────────────────────────────────────────────────────────
{
  const m = meterSegments({ timeSignatureNum: 4, timeSignatureDen: 4 })
  ok('single meter', m.length === 1 && m[0].num === 4)
  ok('beatsPerBar 4', beatsPerBarAt(99, m) === 4)
  const bars = barLines(m, 0, 16)
  ok('uniform bars count', bars.length === 5) // bars starting at 0,4,8,12,16
  ok('uniform bar beats', bars.map(b => b.beat).join(',') === '0,4,8,12,16')
  ok('nearest bar', nearestBarBeat(5, m) === 4 && nearestBarBeat(7, m) === 8)
}
{
  // 4/4 then 3/4 from beat 8.
  const m = meterSegments({ timeSignatureNum: 4, timeSignatureDen: 4, meterMarkers: [
    { id: 'a', beat: 8, num: 3, den: 4 },
  ] })
  ok('meterAt before', meterAt(4, m).num === 4)
  ok('meterAt after', meterAt(10, m).num === 3)
  const bars = barLines(m, 0, 17)
  // 0,4 (4/4); 8,11,14,17 (3/4)
  ok('mixed bar beats', bars.map(b => b.beat).join(',') === '0,4,8,11,14,17')
  ok('nearest bar in 3/4', nearestBarBeat(12, m) === 11 && nearestBarBeat(13, m) === 14)
}
{
  // Meter change mid-bar breaks the bar early.
  const m = meterSegments({ timeSignatureNum: 4, timeSignatureDen: 4, meterMarkers: [
    { id: 'a', beat: 6, num: 2, den: 4 },
  ] })
  const bars = barLines(m, 0, 10)
  // 0,4 (4/4), then change at 6 breaks bar → 6,8,10 (2/4)
  ok('mid-bar break', bars.map(b => b.beat).join(',') === '0,4,6,8,10')
}

console.log(`\ntempo-map: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
