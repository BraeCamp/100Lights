#!/usr/bin/env node
// Does the song keep making sound all the way through — cold, and once baked?
//
//   node scripts/check-no-dropouts.mjs [baseUrl]
//   APOLLO_OPEN=1 node scripts/check-no-dropouts.mjs
//
// Brae: "I'm still having problems with audio not playing before and after
// full song loading."
//
// check:realtime-play only ever proved that the FIRST sound arrived. Silence
// ten seconds in passes that test perfectly. This one plays through and asks a
// harder question: at each moment, does the project say notes should be
// sounding, and is anything actually coming out?
//
// Musical rests are why this cannot just measure silence. The expected-notes
// map comes from the project itself, so a gap only counts as a dropout when
// notes were supposed to be playing and were not.

import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.PORT || '4618'
const BASE = process.argv[2]?.replace(/\/$/, '') || `http://localhost:${PORT}`
const FIXTURE = process.env.FIXTURE
  || join(homedir(), 'Desktop', '100lights-ai-renders', 'Hallway Light.cfproj')
const PLAY_SECONDS = Number(process.env.PLAY_SECONDS || 45)
const SILENCE = 0.002

if (!existsSync(FIXTURE)) {
  console.log(`no fixture at ${FIXTURE} — run: node scripts/song-hallwaylight.mjs`)
  process.exit(1)
}
const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject
const bpm = dawProject.tempo || 120

// Where notes sound, in beats. A note counts as sounding from its start until
// its end, with a little tail for the release.
const spans = []
for (const c of dawProject.arrangementClips ?? []) {
  for (const n of c.notes ?? []) {
    const a = (c.startBeat ?? 0) + (n.startBeat ?? 0)
    spans.push([a, a + (n.durationBeats ?? 1) + 0.25])
  }
}
spans.sort((x, y) => x[0] - y[0])
const notesAt = beat => spans.some(([a, b]) => beat >= a && beat <= b)

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// NO autoplay override, and no muting.
//
// Every earlier check launched with --autoplay-policy=no-user-gesture-required
// and started the transport by calling engine.play() from a script. That is not
// how a browser behaves for a person: without a real gesture an AudioContext
// stays suspended and produces silence, and the override was hiding whether the
// studio resumes it properly. Three rounds of "no dropouts here" were measured
// in a browser that had been told to ignore the rule being tested.
const browser = await chromium.launch({ args: ['--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  page error:', e.message))

await page.addInitScript(() => {
  const w = window
  const OrigCtx = w.AudioContext
  w.__probes = []
  w.AudioContext = class extends OrigCtx {
    constructor(...a) {
      super(...a)
      const an = this.createAnalyser(); an.fftSize = 512
      this.__probe = an; w.__probes.push(an)
    }
  }
  const tap = n => { try { if (n.context?.__probe) n.connect(n.context.__probe) } catch { /* channel shape */ } }
  const OW = w.AudioWorkletNode
  if (OW) w.AudioWorkletNode = class extends OW { constructor(...a) { super(...a); tap(this) } }
  const ocb = OrigCtx.prototype.createBufferSource
  OrigCtx.prototype.createBufferSource = function (...a) { const n = ocb.apply(this, a); tap(n); return n }
  w.__readPeak = () => {
    let peak = 0
    for (const an of w.__probes) {
      const buf = new Float32Array(an.fftSize)
      an.getFloatTimeDomainData(buf)
      for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]))
    }
    return peak
  }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
  .catch(() => console.log('  (no __dawEngine hook — needs a dev build or NEXT_PUBLIC_DAW_HOOKS=1)'))
// Dismiss the first-run studio-tier chooser. It is a modal dialog and it
// intercepts pointer events, so a real click on the transport cannot land
// while it is up.
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /Everything|Standard/i.test(x.textContent || ''))
  b?.click()
})
await page.waitForTimeout(1500)

await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
await page.waitForTimeout(3000)
await page.evaluate(async () => { await window.__clearCombined?.() })

if (process.env.APOLLO_OPEN === '1') {
  await page.keyboard.press('Meta+k'); await page.waitForTimeout(700)
  await page.keyboard.type('Apollo', { delay: 40 }); await page.waitForTimeout(900)
  await page.keyboard.press('Enter'); await page.waitForTimeout(5000)
}

/** Play from the top and report every stretch where notes were due but nothing came out. */
async function playThrough(label) {
  await page.evaluate(() => window.__dawEngine?.stop())
  await page.waitForTimeout(400)
  // A REAL click on the transport, which is a trusted user gesture. Calling
  // engine.play() from script is not one, and an AudioContext will not leave
  // the suspended state for it.
  const playBtn = page.locator('button[title="Play / Stop (Space)"]').first()
  if (await playBtn.count()) await playBtn.click()
  else await page.evaluate(() => window.__dawEngine?.play(0))
  const samples = []
  const t0 = Date.now()
  for (let i = 0; i < PLAY_SECONDS * 4; i++) {
    await page.waitForTimeout(250)
    const elapsed = Date.now() - t0
    samples.push(await page.evaluate(() => ({
      peak: window.__readPeak(),
      beat: window.__dawEngine?.currentBeat ?? 0,
      ready: window.__combineStats?.()?.ready ?? 0,
      // If the context never left 'suspended', nothing can be heard no matter
      // what the transport says it is doing.
      ctxState: window.__dawEngine?.ctx?.state ?? null,
      // PER TRACK, not just the total.
      //
      // The sum of every track is non-zero as long as ONE of them sounds, so a
      // whole instrument can drop out and a total-level check sails past it.
      // Every track already owns an analyser for its meter; read those.
      //
      // Sampled every FOURTH tick. Reading nine analysers on every tick was
      // heavy enough to starve headless Chrome's null audio sink: the playhead
      // fell to 20% of real time and two tracks appeared to drop out. That was
      // the probe, not the studio — currentBeat comes from ctx.currentTime, an
      // audio-thread clock that main-thread load cannot slow down, so a reading
      // of 20% was evidence the measurement was broken, not the transport.
      tracks: (window.__tick = (window.__tick || 0) + 1) % 4 ? null : (() => {
        const e = window.__dawEngine
        if (!e?.trackNodes) return {}
        const out = {}
        for (const [id, n] of e.trackNodes) {
          const buf = new Float32Array(n.analyser.fftSize)
          n.analyser.getFloatTimeDomainData(buf)
          let p = 0
          for (let i = 0; i < buf.length; i++) p = Math.max(p, Math.abs(buf[i]))
          out[id] = p
        }
        return out
      })(),
    })).then(o => ({ ...o, elapsed })))
  }
  await page.evaluate(() => window.__dawEngine?.stop())

  // A dropout: notes were due, and nothing came out.
  const dueButSilent = samples.filter(s => notesAt(s.beat) && s.peak < SILENCE)
  const due = samples.filter(s => notesAt(s.beat))
  let run = 0, worstRun = 0, worstAt = 0
  for (const s of samples) {
    if (notesAt(s.beat) && s.peak < SILENCE) { run++; if (run > worstRun) { worstRun = run; worstAt = s.beat } }
    else run = 0
  }
  const pct = due.length ? (dueButSilent.length / due.length) * 100 : 0
  console.log(`\n  ${label}`)
  console.log(`    played to beat ${samples[samples.length - 1].beat.toFixed(1)}, ${samples[samples.length - 1].ready} clips baked`)
  console.log(`    silent while notes were due   ${dueButSilent.length}/${due.length} samples (${pct.toFixed(1)}%)`)
  console.log(`    longest unbroken dropout      ${(worstRun * 0.25).toFixed(2)}s around beat ${worstAt.toFixed(1)}`)
  // Is the transport keeping up with the clock? "Audio not playing" and
  // "playing at a crawl" are easy to confuse from the outside, and the sampler
  // above cannot tell them apart on its own.
  const first = samples[0], last = samples[samples.length - 1]
  const musicSec = (last.beat - first.beat) * 60 / bpm
  const wallSec = (last.elapsed - first.elapsed) / 1000
  const rate = wallSec > 0 ? musicSec / wallSec : 0
  console.log(`    playhead vs wall clock        ${(rate * 100).toFixed(1)}%  (${musicSec.toFixed(1)}s of music in ${wallSec.toFixed(1)}s)`)
  const states = [...new Set(samples.map(s => s.ctxState))]
  console.log(`    audio context state           ${states.join(', ')}`)

  // Which tracks never made a sound, and which fell silent while their own
  // notes were due?
  const names = new Map((dawProject.tracks ?? []).map(t => [t.id, t.name]))
  const clipsFor = new Map()
  for (const c of dawProject.arrangementClips ?? []) {
    if (!clipsFor.has(c.trackId)) clipsFor.set(c.trackId, [])
    clipsFor.get(c.trackId).push(c)
  }
  const trackDueAt = (trackId, beat) => (clipsFor.get(trackId) ?? []).some(c =>
    (c.notes ?? []).some(n => {
      const a = (c.startBeat ?? 0) + (n.startBeat ?? 0)
      return beat >= a && beat <= a + (n.durationBeats ?? 1) + 0.25
    }))

  const withTracks = samples.filter(s => s.tracks)
  const perTrack = []
  for (const id of Object.keys(withTracks[0]?.tracks ?? {})) {
    const due = withTracks.filter(s => trackDueAt(id, s.beat))
    if (!due.length) continue
    const silent = due.filter(s => (s.tracks[id] ?? 0) < SILENCE)
    perTrack.push({ name: names.get(id) ?? id.slice(0, 8), due: due.length, silent: silent.length })
  }
  const bad = perTrack.filter(t => t.silent / t.due > 0.15)
  console.log(`    tracks silent when due        ${bad.length ? bad.map(t => `${t.name} ${Math.round(t.silent / t.due * 100)}%`).join(', ') : 'none'}`)
  return { pct, worstRun, rate, bad }
}

const cold = await playThrough('COLD — nothing baked yet (live synthesis)')
check('the song sounds before it has finished loading',
  cold.pct < 5 && cold.worstRun * 0.25 < 1.0,
  `${cold.pct.toFixed(1)}% silent, worst ${(cold.worstRun * 0.25).toFixed(2)}s`)
check('and it plays at the right speed before loading',
  cold.rate > 0.9, `${(cold.rate * 100).toFixed(1)}%`)
check('every track sounds before loading', cold.bad.length === 0,
  cold.bad.map(t => t.name).join(', ') || 'all tracks sound')

// Let the bake finish (it only runs while stopped), then play the same song again.
console.log('\n  baking while stopped…')
for (let i = 0; i < 60; i++) {
  await page.waitForTimeout(2000)
  const st = await page.evaluate(() => window.__combineStats?.() ?? {})
  if ((st.queued ?? 0) === 0 && (st.inFlight ?? 0) === 0 && i > 3) break
}
const stats = await page.evaluate(() => window.__combineStats?.() ?? {})
const silentRenders = (stats.peaks ?? []).filter(p => p < 0.001).length
console.log(`    ${stats.ready} clips baked, ${silentRenders} of them silent`)
check('no clip was baked as silence', silentRenders === 0, `${silentRenders} silent renders`)

const warm = await playThrough('WARM — baked, playing from the cache')
check('the song still sounds once it has finished loading',
  warm.pct < 5 && warm.worstRun * 0.25 < 1.0,
  `${warm.pct.toFixed(1)}% silent, worst ${(warm.worstRun * 0.25).toFixed(2)}s`)
check('and it plays at the right speed once loaded',
  warm.rate > 0.9, `${(warm.rate * 100).toFixed(1)}%`)
check('every track sounds once loaded', warm.bad.length === 0,
  warm.bad.map(t => t.name).join(', ') || 'all tracks sound')

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe song sounds all the way through, cold and baked')
process.exit(failures ? 1 : 0)
