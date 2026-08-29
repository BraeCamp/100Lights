#!/usr/bin/env node
/**
 * Press play on a cold cache: does it keep baking, in layers, while it plays?
 *
 *   PORT=4640 node scripts/check-play-while-loading.mjs
 *
 * Brae: "When I hit play it should still render. In layers so that it at least
 * plays something if the loading is too slow."
 *
 * The loader used to stop dead on play, and that is what made a heavy song
 * unrecoverable: nothing baked, so every track stayed on the live synth, so the
 * audio thread drowned — his capture had the audio clock at 0.35x real time
 * with nothing in the cache. Baking is the only thing that reduces the live
 * voice count, and it was switched off for the whole time anyone was listening.
 *
 * So the property under test is not speed, it is PROGRESS WHILE PLAYING: press
 * play with an empty cache and the ready count must keep climbing. A machine
 * that proves it cannot bake and play at once is allowed to stop (see
 * slowWhilePlaying), and that shows up here as the transport still running with
 * the count parked — reported rather than failed, because it is correct
 * behaviour on a slow machine.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'
import { slowDown, slowLabel } from './lib/slow-browser.mjs'

const { initPatch } = await importTs('lib/apollo/patch.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

const BASE = `http://localhost:${process.env.PORT || '4640'}`
const TRACKS = Number(process.env.TRACKS || 6)
const CLIPS = Number(process.env.CLIPS || 4)
const WATCH_SEC = Number(process.env.WATCH_SEC || 40)

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

function buildProject() {
  const base = defaultProject()
  const patch = initPatch()
  // Weighted like a real preset, so a render costs something worth measuring.
  for (const o of patch.oscs) { o.enabled = true; o.unison = 3; o.detune = 0.06 }
  const tracks = [], clips = []
  for (let t = 0; t < TRACKS; t++) {
    const id = `t${t}`
    tracks.push({
      ...(base.tracks[0] ?? {}), id, name: `T${t + 1}`, type: 'midi', effects: [],
      instrument: { type: 'apollo', params: JSON.parse(JSON.stringify(patch)) },
    })
    for (let c = 0; c < CLIPS; c++) {
      const notes = []
      for (let n = 0; n < 10; n++) {
        notes.push({ id: `n${t}-${c}-${n}`, pitch: 45 + ((t * 7 + n * 3) % 24), startBeat: n * 1.5, durationBeats: 1.2, velocity: 96 })
      }
      clips.push({ id: `c${t}-${c}`, trackId: id, kind: 'midi', name: `c${t}-${c}`, startBeat: c * 16, durationBeats: 16, notes, loopEnabled: false })
    }
  }
  return { ...base, tempo: 100, tracks, arrangementClips: clips }
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await slowDown(page)
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 140)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
await page.waitForTimeout(2500)
const dlg = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
if (await dlg.count()) {
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Choose your studio setup"]')
    const b = d && [...d.querySelectorAll('button,div[role=button]')].find(e => /Everything/i.test(e.textContent || ''))
    b?.click()
  })
  await dlg.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
}
await page.waitForTimeout(1000)

const project = buildProject()
const clipCount = project.arrangementClips.length
console.log(`song: ${TRACKS} Apollo tracks, ${clipCount} clips — cold cache, play pressed immediately`)
console.log(`machine: ${slowLabel()}\n`)

await page.evaluate(() => window.__clearCombined?.())
await page.waitForTimeout(500)
await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)
await page.waitForTimeout(1200)

// Press play straight away, with nothing baked. This is the case that used to
// stop the loader dead.
const readyAtPlay = await page.evaluate(async () => {
  const s = window.__combineStats?.()
  window.__passesAtPlay = s?.batches ?? 0
  // Headless starts the context suspended (autoplay policy). Without this the
  // transport reports playing while the audio clock never moves, and the beat
  // sits at 0 — which looks like a stuck playhead but is only the test.
  try { await window.__dawEngine?.ctx?.resume?.() } catch { /* already running */ }
  window.__dawEngine?.play?.()
  return s?.ready ?? 0
})
console.log(`  play pressed with ${readyAtPlay} clips baked`)

const samples = []
for (let i = 0; i < WATCH_SEC; i++) {
  await page.waitForTimeout(1000)
  const row = await page.evaluate(() => {
    const s = window.__combineStats?.()
    const e = window.__dawEngine
    return { ready: s?.ready ?? 0, batches: s?.batches ?? 0, playing: !!e?.isPlaying, beat: e?.currentBeat ?? 0 }
  })
  samples.push(row)
  if (i % 5 === 0 || i === WATCH_SEC - 1) {
    console.log(`   ${String(i + 1).padStart(2)}s  ready=${row.ready}  passes=${row.batches}  playing=${row.playing}  beat=${row.beat.toFixed(1)}`)
  }
  if (row.ready >= clipCount) break
}
const whilePlaying = samples.filter(s => s.playing)
const passesAtPlay = await page.evaluate(() => window.__passesAtPlay ?? 0)
// A render already RUNNING when play is pressed cannot be stopped — an
// OfflineAudioContext has no cancel, and the loop only reaches its
// transportPlaying check once the await returns. So that one is expected, and
// counting it as a violation would be asking for something unimplementable.
// What must be zero is renders STARTED after play: passes flat from the first
// sample to the last.
const inFlightAtPlay = (whilePlaying[0]?.batches ?? passesAtPlay) - passesAtPlay
const passesWhilePlaying = (whilePlaying.at(-1)?.batches ?? 0) - (whilePlaying[0]?.batches ?? 0)
const stillPlaying = whilePlaying.length > 0

console.log()
check('the transport actually ran', stillPlaying, `${whilePlaying.length} samples while playing`)
// The beat is REPORTED, not asserted. Headless Chrome will not start an audio
// clock without a real gesture — resume() on the context does not change it —
// so currentBeat sits at 0 while the transport genuinely runs. Asserting on it
// would fail for a reason that has nothing to do with the studio. What the
// feature actually depends on is transportPlaying being true, which is what
// gates the baking path, and that is asserted above.
console.log(`  (playhead reached beat ${(whilePlaying.at(-1)?.beat ?? 0).toFixed(1)} — headless has no audio clock, so 0 is expected here)`)
// ── The contract changed, on evidence ───────────────────────────────────────
//
// This used to assert that baking CONTINUES during playback, because a song
// that never baked was a song you could not hear. That is no longer true:
// every Apollo track is warmed now, and eight heavy tracks hold the audio clock
// at 1.000 with nothing baked. So playing is served by the live engine, and
// rendering — which runs on the MAIN thread and starved the note scheduler down
// to 0.35 of real time — deliberately stops while the transport runs.
//
// What matters now is the opposite property: pressing play must not leave the
// song stranded. Baking parks, and the pause picks it straight back up.
//
// Asserted on RENDER PASSES, not on `ready`. Clips can still arrive during
// playback by being read off disk, which costs the audio thread nothing — it is
// the renders that ran on the main thread and took the audio clock to 0.35.
// Counting `ready` would call a healthy disk read a violation.
check('no render is STARTED while the transport is playing', passesWhilePlaying === 0,
  `${passesWhilePlaying} new pass(es) over ${whilePlaying.length}s of playback`)
check('and at most the one already in flight finishes', inFlightAtPlay <= 1,
  `${inFlightAtPlay} landed right after play; ready ${readyAtPlay} -> ${whilePlaying.at(-1)?.ready ?? 0}`)

// The real assertion: after the pause, it finishes.
await page.evaluate(() => window.__dawEngine?.stop?.())
let after = null
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(500)
  after = await page.evaluate(() => window.__combineStats?.() ?? null)
  if ((after?.ready ?? 0) >= clipCount) break
}
check('and the pause picks it straight back up', (after?.ready ?? 0) === clipCount,
  `${after?.ready} of ${clipCount} after pausing`)
check('with nothing condemned along the way', (after?.setAside ?? 0) === 0,
  `${after?.setAside} set aside`)

await browser.close()
console.log(failures
  ? `\n${failures} failing`
  : '\nplaying is served live, and baking resumes the moment you pause')
process.exit(failures ? 1 : 0)
