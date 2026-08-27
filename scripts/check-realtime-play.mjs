#!/usr/bin/env node
// Does the studio PLAY when you press play, or does it render first?
//
//   node scripts/check-realtime-play.mjs [url]
//   PORT=4618 node scripts/check-realtime-play.mjs
//
// Brae, more than once: "it still plays painfully slowly and with no audio…
// I think that it's still loading the whole song instead of switching to the
// real time loading on the playhead."
//
// So the claim under test is not "loading is faster" — a faster render is still
// a render. It is that pressing play produces sound NOW and the playhead keeps
// up with the clock. Three things get measured, and all three have to hold:
//
//   1. time to first audio     — silence for seconds is the complaint
//   2. playhead vs wall clock  — "painfully slowly" is the playhead falling behind
//   3. longest main-thread gap — an offline render blocks paint AND the note
//                                scheduler, which is why the audio stops
//
// Every run starts from a cleared cache, because a warm freeze cache turns this
// into a test of the cache rather than of the first play, which is the one that
// hurts.

import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.PORT || '4618'
const URL_ARG = process.argv[2]
const PLAY_SECONDS = Number(process.env.PLAY_SECONDS || 20)

// The fixture is generated, not committed: nine Apollo tracks, 37 clips, 2:05 —
// "Hallway Light", the song Brae reported as "super slow again". A public song
// link cannot be used here because opening one needs an account, and a headless
// run has none.
//
//   node scripts/song-hallwaylight.mjs      # regenerates it
const FIXTURE = process.env.FIXTURE
  || join(homedir(), 'Desktop', '100lights-ai-renders', 'Hallway Light.cfproj')
// Pass a base URL to run this against a deployed build:
//   node scripts/check-realtime-play.mjs https://www.100lights.com
// The fixture is still loaded into it, so the measurement is of the deployed
// code playing a real nine-track song rather than of whatever happens to be
// saved in that account. Public song links cannot be used: opening one needs a
// sign-in, and a signed-out visitor is told the project does not exist.
const BASE_URL = URL_ARG ? URL_ARG.replace(/\/$/, '') : `http://localhost:${PORT}`
const TARGET = `${BASE_URL}/create?modules=audio&audioMode=music`

if (!existsSync(FIXTURE)) {
  console.log(`no fixture at ${FIXTURE} — run: node scripts/song-hallwaylight.mjs`)
  process.exit(1)
}
const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
// A fresh context every run: no service worker, no IndexedDB, no freeze cache.
const ctx = await browser.newContext()
const page = await ctx.newPage()
page.on('pageerror', e => console.log('  page error:', e.message))

// Tap the audio BEFORE any of it is built. Apollo's DSP is an AudioWorklet, so
// counting AudioBufferSourceNode.start() is blind to the live path — the very
// path this test exists to prove. Wrap both and route a copy into one analyser.
await page.addInitScript(() => {
  const w = window
  w.__tap = { peak: 0, firstSoundAt: 0, frames: [], longestGapMs: 0, stalls: [], startedAt: 0 }
  const OrigCtx = w.AudioContext
  w.AudioContext = class extends OrigCtx {
    constructor(...a) {
      super(...a)
      const an = this.createAnalyser()
      an.fftSize = 512
      this.__probe = an
      w.__probes = w.__probes || []
      w.__probes.push(an)
    }
  }
  const tapInto = (node) => {
    try {
      const c = node.context
      if (c && c.__probe) node.connect(c.__probe)
    } catch { /* wrong channel shape; not worth failing the run over */ }
  }
  const OrigWorklet = w.AudioWorkletNode
  if (OrigWorklet) {
    w.AudioWorkletNode = class extends OrigWorklet {
      constructor(...a) { super(...a); tapInto(this) }
    }
  }
  const origCreateBuf = OrigCtx.prototype.createBufferSource
  OrigCtx.prototype.createBufferSource = function (...a) {
    const n = origCreateBuf.apply(this, a)
    tapInto(n)
    return n
  }
  // Main-thread responsiveness: the gap between animation frames IS the stall.
  let last = performance.now()
  const tick = () => {
    const t = performance.now()
    const gap = t - last
    if (w.__tap.watching) {
      if (gap > w.__tap.longestGapMs) w.__tap.longestGapMs = gap
      // Keep WHEN each stall happened. One uncancellable render at the moment
      // play is pressed is a very different thing from stalls all the way
      // through, and a single max cannot tell them apart.
      if (gap > 50) w.__tap.stalls.push({ at: Math.round(t - w.__tap.startedAt), ms: Math.round(gap) })
    }
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  w.__readPeak = () => {
    let peak = 0
    for (const an of (w.__probes || [])) {
      const buf = new Float32Array(an.fftSize)
      an.getFloatTimeDomainData(buf)
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
    }
    return peak
  }
})

console.log(`loading ${TARGET}`)
await page.goto(TARGET, { waitUntil: 'domcontentloaded' })

// Wait for the engine hook rather than a fixed sleep — the studio is heavy and
// a fixed wait either wastes time or measures a half-built page.
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
  .catch(() => console.log('  (no __dawEngine hook — is NEXT_PUBLIC_DAW_HOOKS on?)'))
// Load the project the way the app does, then give it exactly as long as a
// person would before reaching for play. Deliberately NOT waiting for a loading
// bar to finish: what happens when you press play before it is "ready" is the
// entire complaint.
if (dawProject) {
  await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
  await page.waitForTimeout(3000)
}
// Cold cache, memory AND disk. A fresh browser context already gives a fresh
// IndexedDB, but this also makes the check usable against a real logged-in
// browser, where clearing site data would sign the user out.
await page.evaluate(async () => { await window.__clearCombined?.() })
const trackCount = await page.evaluate(() => window.__dawEngine?.trackNodes?.size ?? null)
console.log(`  engine up, ${trackCount} tracks wired, render cache cleared`)

// Brae: "To clarify, I mean when Apollo opens in Beacon." The Apollo rack is a
// SECOND engine running beside the DAW's, so it is its own load, and testing
// playback without it open tests a lighter studio than the one being complained
// about. Opened through the command palette, which is the path a person takes.
if (process.env.APOLLO_OPEN === '1') {
  await page.keyboard.press('Meta+k')
  await page.waitForTimeout(700)
  await page.keyboard.type('Apollo', { delay: 40 })
  await page.waitForTimeout(900)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(6000)
  const rackUp = await page.evaluate(() =>
    !!document.querySelector('[data-apollo-card], [data-apollo-sample-slot]')
    || /OSC\s*1|WAVETABLE/i.test(document.body.innerText))
  console.log(`  Apollo rack open: ${rackUp}`)
  if (!rackUp) { console.log('  FAIL could not open the Apollo rack — the rest of this run is meaningless'); failures++ }
}
await page.waitForTimeout(2000)

const t0 = Date.now()
await page.evaluate(() => {
  window.__tap.watching = true
  window.__tap.longestGapMs = 0
  window.__tap.stalls = []
  window.__tap.startedAt = performance.now()
  return window.__dawEngine?.play(0)
})

// Poll for first audio and for how the playhead tracks the clock.
let firstSoundMs = null
const samples = []
for (let i = 0; i < PLAY_SECONDS * 4; i++) {
  await page.waitForTimeout(250)
  const s = await page.evaluate(() => {
    const cs = window.__combineStats?.()
    return {
      peak: window.__readPeak(),
      beat: window.__dawEngine?.currentBeat ?? null,
      tempo: window.__dawEngine?.tempo ?? 120,
      // Whether the bake loop is engaged at all. A run where it never starts is
      // a run that cannot reproduce the complaint, and would pass for the wrong
      // reason — worse than no test.
      ready: cs?.ready ?? 0, inFlight: cs?.inFlight ?? 0, queued: cs?.queued ?? 0,
      renderMs: cs?.renderMs ?? 0, attempts: cs?.attempts ?? 0,
    }
  })
  const elapsed = Date.now() - t0
  if (firstSoundMs === null && s.peak > 0.005) firstSoundMs = elapsed
  samples.push({ elapsed, ...s })
}

// Did anything bake DURING playback? That is the claim: playing means playing.
//
// Measured as the growth in READY clips, not in `attempts` — attempts is reset
// at the top of every combine request, so it goes DOWN as often as up and an
// earlier version of this check reported "-9 renders" and drew a conclusion
// from it. Ready only ever grows within a run.
const bakeDuring = samples[samples.length - 1].ready - samples[0].ready
const renderMsDuring = samples[samples.length - 1].renderMs - samples[0].renderMs
const wallSecondsPre = (samples[samples.length - 1].elapsed - samples[0].elapsed) / 1000
const gap = await page.evaluate(() => window.__tap.longestGapMs)
const stalls = await page.evaluate(() => window.__tap.stalls)
// How much of the playback was the studio frozen?
//
// This replaces a per-stall threshold, which kept needing to be argued about:
// one 102ms stall is fine, thirty 80ms stalls are the complaint, and no single
// number separates them. Total blocked time does, and it is also the thing a
// person actually experiences. Measured on this fixture with nine Apollo
// tracks and the rack open:
//
//   rendering during playback   2760ms lost across 21s  = 13.1% frozen
//   playing live                 141ms lost across 20s  =  0.7% frozen
//
// One render may already be in flight when play is pressed and cannot be
// cancelled — Chrome runs an OfflineAudioContext carrying JS worklets on the
// main thread, atomically. That is the floor until Helios moves to a Worker.
const blockedMs = stalls.reduce((n, x) => n + x.ms, 0)
const blockedPct = (blockedMs / (wallSecondsPre * 1000)) * 100
const last = samples[samples.length - 1]
const first = samples[0]
const beatsPlayed = (last.beat ?? 0) - (first.beat ?? 0)
const secondsOfMusic = beatsPlayed * 60 / (last.tempo || 120)
const wallSeconds = (last.elapsed - first.elapsed) / 1000
const realtimeRatio = wallSeconds > 0 ? secondsOfMusic / wallSeconds : 0
const peakSeen = Math.max(...samples.map(s => s.peak))

console.log('')
console.log(`  time to first audio     ${firstSoundMs === null ? 'never made a sound' : firstSoundMs + ' ms'}`)
console.log(`  peak level seen         ${peakSeen.toFixed(4)}`)
console.log(`  playhead vs wall clock  ${(realtimeRatio * 100).toFixed(1)}%  (${secondsOfMusic.toFixed(1)}s of music in ${wallSeconds.toFixed(1)}s)`)
console.log(`  longest main-thread gap ${gap.toFixed(0)} ms`)
console.log(`  time frozen             ${blockedPct.toFixed(1)}% of playback (${blockedMs}ms)`)
console.log(`  stalls over 50ms        ${stalls.length ? stalls.map(x => `${x.ms}ms@${(x.at/1000).toFixed(1)}s`).join(', ') : 'none'}`)
console.log(`  bake activity           ${last.attempts} attempts, ${last.ready} ready, ${last.inFlight} in flight, ${last.queued} queued, ${Math.round(last.renderMs)} ms spent rendering`)
console.log('')

check('it makes a sound within two seconds of pressing play',
  firstSoundMs !== null && firstSoundMs < 2000,
  firstSoundMs === null ? 'silent' : `${firstSoundMs} ms`)
check('the playhead keeps up with the clock',
  realtimeRatio > 0.9 && realtimeRatio < 1.1, `${(realtimeRatio * 100).toFixed(1)}%`)
// A render already in flight when play is pressed cannot be cancelled, so the
// claim is about the STEADY STATE: once playing, the studio stays responsive.
check('the studio is not frozen for any real part of playback',
  blockedPct < 3, `${blockedPct.toFixed(1)}% of playback blocked (${blockedMs}ms)`)
// A run in which nothing ever tried to bake proves nothing about baking.
// One render may already be in flight when play is pressed and cannot be
// cancelled; anything beyond that is the loop failing to park.
check('nothing new baked while the transport was running', bakeDuring <= 1,
  `${bakeDuring} clips baked mid-playback`)

// Pausing has to hand the work back, or the cache never fills and the second
// pass is as expensive as the first.
await page.evaluate(() => window.__dawEngine?.stop())
const readyAtPause = last.ready
await page.waitForTimeout(9000)
const afterPause = await page.evaluate(() => {
  const cs = window.__combineStats?.()
  return { ready: cs?.ready ?? 0, attempts: cs?.attempts ?? 0 }
})
console.log(`  baking on pause         ${readyAtPause} -> ${afterPause.ready} clips ready`)
check('pausing starts the baking again', afterPause.ready > readyAtPause || afterPause.attempts > 0,
  `${readyAtPause} -> ${afterPause.ready}`)

await browser.close()
console.log(failures ? `\n${failures} failing` : '\npressing play plays')
process.exit(failures ? 1 : 0)
