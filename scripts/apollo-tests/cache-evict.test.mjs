#!/usr/bin/env node
// What a small device throws away first.
//
//   node --experimental-strip-types scripts/apollo-tests/cache-evict.test.mjs
//
// Brae: "Try with lower cpu and ram limits as well."
//
// ⚠️ On a roomy machine the render cache never evicts, so its eviction ORDER is
// invisible. On a 2 GB phone it is the normal state: deviceCeiling() gives that
// device 60 seconds of cache, and a seven-track song wants roughly seven times
// its own length. There, what gets thrown away is the whole experience.
//
// It was throwing away the OPENING. `buffers.keys().next()` is Map INSERTION
// order, a song is rendered from the beginning, so the first thing inserted is
// the first thing you hear — on every single play. The cache was systematically
// discarding the most-heard music in the project and keeping the least-heard.
//
// Growing the budget to fit the project hid that on big machines and did
// nothing for small ones. This pins the order instead of the size.
//
// The policy is reproduced here rather than imported: freeze-cache reaches the
// worklet, the DOM and a Worker on the way in. What is under test is the RULE —
// keep what the listener is near — and the rule is small enough to state twice
// and compare against the real one in review.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── the rule, as freeze-cache now applies it ───────────────────────────────
function evict(buffers, keyBeat, playheadBeat, maxFrames) {
  let frames = 0
  for (const b of buffers.values()) frames += b.length
  if (frames <= maxFrames) return
  const order = [...buffers.keys()].sort((a, b) => {
    const da = keyBeat.has(a) ? Math.abs(keyBeat.get(a) - playheadBeat) : Infinity
    const db = keyBeat.has(b) ? Math.abs(keyBeat.get(b) - playheadBeat) : Infinity
    return db - da
  })
  for (const key of order) {
    if (frames <= maxFrames || buffers.size <= 1) break
    frames -= buffers.get(key)?.length ?? 0
    buffers.delete(key)
  }
}

// A seven-track song, rendered front to back, on a device that cannot hold it.
const SECOND = 48_000
const build = () => {
  const buffers = new Map()
  const keyBeat = new Map()
  for (let bar = 0; bar < 16; bar++) {
    for (let track = 0; track < 7; track++) {
      const key = `bar${bar}-t${track}`
      buffers.set(key, { length: SECOND * 2 })   // two seconds each
      keyBeat.set(key, bar * 4)
    }
  }
  return { buffers, keyBeat }
}

// ── at the top of the song, the opening survives ───────────────────────────
{
  const { buffers, keyBeat } = build()
  const budget = SECOND * 60                     // a 2 GB device
  evict(buffers, keyBeat, 0, budget)
  const kept = [...buffers.keys()]
  const keptBars = new Set(kept.map(k => Number(k.match(/bar(\d+)/)[1])))
  check('a device that cannot hold the song keeps SOMETHING', kept.length > 0, `${kept.length} clips`)
  check('and it is under budget afterwards',
    [...buffers.values()].reduce((n, b) => n + b.length, 0) <= budget)
  // ⚠️ The whole point. Bar 1 is what you hear every time you press play.
  check('the opening bar is kept', keptBars.has(0), `bars kept: ${[...keptBars].sort((a, b) => a - b).join(',')}`)
  check('and the far end of the song is what went', !keptBars.has(15))
}

// ── after a seek, it follows the listener ──────────────────────────────────
//
// The module already renders nearest-the-playhead first. Evicting
// furthest-from-the-playhead is the same idea pointed the other way, and
// without it a seek left the cache holding music nobody was near.
{
  const { buffers, keyBeat } = build()
  evict(buffers, keyBeat, 15 * 4, SECOND * 60)   // listener at bar 16
  const keptBars = new Set([...buffers.keys()].map(k => Number(k.match(/bar(\d+)/)[1])))
  check('after a seek to the end, the end is what is kept', keptBars.has(15),
    `bars kept: ${[...keptBars].sort((a, b) => a - b).join(',')}`)
  check('and the opening is now the expendable part', !keptBars.has(0))
}

// ── it terminates even when one clip alone busts the budget ────────────────
//
// ⚠️ The loop stops at one buffer rather than emptying itself, so a single
// oversized clip leaves the cache over budget by design. What must not happen
// is looping forever trying to get under.
{
  const buffers = new Map([['huge', { length: SECOND * 900 }]])
  const keyBeat = new Map([['huge', 0]])
  evict(buffers, keyBeat, 0, SECOND * 60)
  check('one clip bigger than the whole budget still terminates', buffers.size === 1)
}

// ── and the real module agrees with the rule stated above ──────────────────
//
// Cheap guard against this test drifting away from the code it describes: if
// somebody puts insertion-order eviction back, the source stops matching.
{
  const src = readFileSync('lib/apollo/freeze-cache.ts', 'utf8')
  check('freeze-cache evicts by distance from the playhead',
    /playheadBeat/.test(src) && /keyBeat/.test(src) && /furthest away first/.test(src))
  check('and no longer takes whatever was inserted first',
    !/const oldest = buffers\.keys\(\)\.next\(\)/.test(src))
}

console.log(failures ? `\n${failures} failing` : '\na small device keeps the music you are nearest')
assert.equal(failures, 0)
