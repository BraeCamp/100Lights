#!/usr/bin/env node
/**
 * Loading a song: how long, and does WATCHING it make it slower?
 *
 *   PORT=4626 node scripts/check-load-speed.mjs
 *
 * Brae, twice: "It still just says 2/23 for a long time and lags at 4 tracks."
 *
 * The loader has a politeness mode. While `userIsBusy()` it shrinks each render
 * window to a 250ms budget and rests 400-2000ms between passes, so baking never
 * competes with a drag. `pointermove` used to refresh that flag, with an 1800ms
 * window — so anyone whose pointer drifted while they watched the progress bar
 * held the loader in its slowest mode for the entire load. Measured on a
 * 21-clip, 6-track song from a cold cache:
 *
 *     pointer still     25.7s, 19 passes
 *     pointer moving    55.8s, 21 passes      <- 2.2x slower, for watching it
 *
 * Movement now only counts while the pointer is DOWN, which is what a drag is.
 * This asserts the penalty stays gone, because it is invisible: everything
 * works, the bar advances, it is simply slow — and only for the person looking.
 *
 * Both runs clear the combined cache first (memory AND IndexedDB). A warm cache
 * makes any loader look instant, which has fooled me before.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'

const { initPatch } = await importTs('lib/apollo/patch.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

const BASE = `http://localhost:${process.env.PORT || '4626'}`
const TRACKS = Number(process.env.TRACKS || 6)
const CLIPS = Number(process.env.CLIPS || 4)
/** How much slower "being watched" may be before this is a regression. */
const MAX_WATCH_PENALTY = 1.4

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

/**
 * A song shaped like a real one: Apollo instruments (nothing else produces
 * render groups, so a song without them measures zero and looks fast), and
 * clips spread down the timeline so windows have to span real distance.
 */
function buildProject() {
  const base = defaultProject()
  const patch = initPatch()
  const tracks = []
  const clips = []
  for (let t = 0; t < TRACKS; t++) {
    const id = `t${t}`
    tracks.push({
      ...(base.tracks[0] ?? {}),
      id, name: `T${t + 1}`, type: 'midi',
      instrument: { type: 'apollo', params: JSON.parse(JSON.stringify(patch)) },
      effects: [],
    })
    for (let c = 0; c < CLIPS; c++) {
      const notes = []
      for (let n = 0; n < 10; n++) {
        notes.push({
          id: `n${t}-${c}-${n}`,
          pitch: 45 + ((t * 7 + n * 3) % 24),
          startBeat: n * 1.5,
          durationBeats: 1.2,
          velocity: 96,
        })
      }
      clips.push({
        id: `c${t}-${c}`, trackId: id, kind: 'midi', name: `c${t}-${c}`,
        startBeat: c * 16, durationBeats: 16, notes, loopEnabled: false,
      })
    }
  }
  return { ...base, tempo: 100, tracks, arrangementClips: clips }
}

async function openStudio(browser) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
  page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 140)))
  await page.goto(`${BASE}/create?modules=audio&audioMode=music`, {
    waitUntil: 'domcontentloaded', timeout: 180000,
  })
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
  return page
}

async function runOnce(project, { watching }) {
  const browser = await chromium.launch()
  try {
    const page = await openStudio(browser)
    await page.evaluate(() => window.__clearCombined?.())
    await page.waitForTimeout(500)

    const t0 = Date.now()
    await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)

    // A watching user's pointer: small movements, continuously. That is all it
    // took to hold userIsBusy() true, because the window is 1800ms.
    const timer = watching
      ? setInterval(() => { page.mouse.move(700 + Math.random() * 40, 500 + Math.random() * 40).catch(() => {}) }, 400)
      : null

    const deadline = t0 + 240000
    let stats = null
    while (Date.now() < deadline) {
      stats = await page.evaluate(() => window.__combineStats?.() ?? null)
      if (stats && stats.inFlight === 0 && stats.queued === 0 && Date.now() - t0 > 6000) break
      await page.waitForTimeout(400)
    }
    if (timer) clearInterval(timer)
    return { ms: Date.now() - t0, stats }
  } finally {
    await browser.close()
  }
}

const project = buildProject()
const clipCount = project.arrangementClips.length
console.log(`song: ${TRACKS} Apollo tracks, ${clipCount} clips, ${project.tempo}bpm\n`)

const still = await runOnce(project, { watching: false })
console.log(`  pointer still    ${(still.ms / 1000).toFixed(1)}s  ${still.stats?.batches} passes  ${still.stats?.ready} ready`)
const watched = await runOnce(project, { watching: true })
console.log(`  pointer moving   ${(watched.ms / 1000).toFixed(1)}s  ${watched.stats?.batches} passes  ${watched.stats?.ready} ready\n`)

check('the song finishes loading', (still.stats?.ready ?? 0) > 0 && (watched.stats?.ready ?? 0) > 0,
  `${still.stats?.ready}/${clipCount} and ${watched.stats?.ready}/${clipCount}`)
check('every clip is baked, not left playing live',
  still.stats?.ready === clipCount, `${still.stats?.ready} of ${clipCount}`)

const penalty = watched.ms / Math.max(1, still.ms)
check(`watching the loader does not slow it down (< ${MAX_WATCH_PENALTY}x)`,
  penalty < MAX_WATCH_PENALTY, `${penalty.toFixed(2)}x`)

console.log(failures ? `\n${failures} failing` : '\nloading is not slower for the person watching it')
process.exit(failures ? 1 : 0)
