// The overview strip's arithmetic (lib/arrangement-overview.ts): the minimap
// spans the song, the zoom box mirrors the view, drags map back to scroll
// and zoom, Follow keeps the playhead on screen by page or by glide, track
// heights fit a viewport, and the dB waveform scale keeps the quiet parts.
// The strip itself is driven in .claude/overview-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { overviewSpan, overviewFrame, zoomBox, scrollForBoxX, scrollToCentreOn, beatWForBox, hitZone, followScroll, fitHeights, peakToDb } =
  await importTs('lib/arrangement-overview.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≠ ${b}`)

check('the strip spans the song rounded up to a bar, plus a bar of air, at least 32 beats', () => {
  assert.equal(overviewSpan(0), 32)
  assert.equal(overviewSpan(30), 36)
  assert.equal(overviewSpan(64), 68)
  assert.equal(overviewSpan(65), 72)
})
check('the zoom box sits where the view is and is as wide as the view', () => {
  const f = overviewFrame(64, 680)          // 68 beats over 680 px = 10 px/beat
  near(f.pxPerBeat, 10)
  const box = zoomBox(f, 320, 800, 40)     // view starts at beat 8, shows 20 beats
  near(box.x, 80); near(box.w, 200)
  const home = zoomBox(f, -20, 800, 40)    // the start gutter is not a negative beat
  near(home.x, 0)
})
check('dragging the box scrolls; the edges zoom around the still edge', () => {
  const f = overviewFrame(64, 680)
  near(scrollForBoxX(f, 80, 40, -20), 320)
  near(scrollForBoxX(f, -100, 40, -20), 0)   // the start gutter is not reachable by dragging the box
  near(scrollToCentreOn(f, 340, 800, 40, -20), 34 * 40 - 400)
  const w = beatWForBox(f, 100, 800, 10, 200)  // a 100 px box = 10 beats → 80 px/beat
  near(w, 80)
  near(beatWForBox(f, 1, 800, 10, 200), 200, 1e-9)
})
check('the pointer knows an edge from the inside from outside', () => {
  const box = { x: 80, w: 200 }
  assert.equal(hitZone(82, box), 'left')
  assert.equal(hitZone(279, box), 'right')
  assert.equal(hitZone(150, box), 'inside')
  assert.equal(hitZone(400, box), 'outside')
})
check('Follow by page leaves the view alone until the playhead runs off, then jumps', () => {
  assert.equal(followScroll('page', 10, 0, 800, 40, -20), null)         // beat 10 at 400 px, on screen
  near(followScroll('page', 25, 0, 800, 40, -20), 25 * 40 - 80)         // off the right: playhead lands at 10 %
  assert.equal(followScroll('off', 25, 0, 800, 40, -20), null)
})
check('Follow by scroll glides with the playhead a third of the way in', () => {
  near(followScroll('scroll', 30, 0, 800, 40, -20), 1200 - 264)
  near(followScroll('scroll', 0, 500, 800, 40, -20), -20)
})
check('track heights fill the viewport, never below the minimum', () => {
  assert.equal(fitHeights(600, 6), 100)
  assert.equal(fitHeights(600, 40), 32)
  assert.equal(fitHeights(600, 1), 400)
  assert.equal(fitHeights(600, 0), 32)
})
check('the dB scale lifts the quiet parts and keeps full scale at the top', () => {
  near(peakToDb(1), 1)
  near(peakToDb(0.1), 1 - 20 / 60)
  near(peakToDb(0.001), 0)
  near(peakToDb(0), 0)
  assert.ok(peakToDb(0.05) > 0.05 * 5, 'a quiet peak is far taller than on the linear scale')
})

console.log(failures ? `\n${failures} failing` : '\nthe whole song fits the strip')
process.exit(failures ? 1 : 0)
