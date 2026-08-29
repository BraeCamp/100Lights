#!/usr/bin/env node
/**
 * Does a load survive being interrupted the way a person interrupts it?
 *
 *   SLOW=3 PORT=4671 node scripts/check-load-interruptions.mjs
 *
 * Every loading bug in this session has been about a job that STOPPED and had
 * nobody to restart it: play condemned the clips it had not reached, a silent
 * window aborted the pass, a full cache made a good render look like a failure,
 * and a job that ended early simply had no follow-up booked. Each was found by
 * a person pressing play and pausing at an ordinary moment.
 *
 * So this does that on purpose, on a machine a third of the speed, and the only
 * thing it really asserts is the one that matters: whatever you do to it, the
 * song ends up completely baked and nothing is condemned.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'
import { slowDown, slowLabel } from './lib/slow-browser.mjs'

const { initPatch } = await importTs('lib/apollo/patch.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

const BASE = `http://localhost:${process.env.PORT || '4671'}`
const TRACKS = Number(process.env.TRACKS || 5)
const CLIPS = Number(process.env.CLIPS || 5)

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const fx = (type, params = {}) => ({ id: `fx-${type}`, type, enabled: true, mix: 0.35, params })

function buildProject() {
  const base = defaultProject()
  const patch = initPatch()
  for (const o of patch.oscs) { o.enabled = true; o.unison = 2 }
  patch.filters[0] = { ...patch.filters[0], enabled: true, type: 'lp12', cutoff: 0.6 }
  patch.fxMain = [fx('reverb'), fx('eq')]
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
        notes.push({ id: `n${t}-${c}-${n}`, pitch: 45 + ((t * 7 + n * 3) % 24), startBeat: n * 1.5, durationBeats: 1.4, velocity: 96 })
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
console.log(`song: ${TRACKS} tracks, ${clipCount} clips`)
console.log(`machine: ${slowLabel()}\n`)

await page.evaluate(() => window.__clearCombined?.())
await page.waitForTimeout(500)
const t0 = Date.now()
await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)

const at = ms => ms - (Date.now() - t0)
const say = async (label, fn) => {
  const s = await page.evaluate(() => window.__combineStats?.() ?? null)
  console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s  ${label} (ready=${s?.ready}, "${s?.progress?.layer ?? ''}")`)
  await fn()
}

// Interrupt the way a person does: play early, pause, play again.
await page.waitForTimeout(Math.max(0, at(2000)))
await say('press play', () => page.evaluate(() => window.__dawEngine?.play?.()))
await page.waitForTimeout(Math.max(0, at(7000)))
await say('pause', () => page.evaluate(() => window.__dawEngine?.stop?.()))
await page.waitForTimeout(Math.max(0, at(11000)))
await say('press play again', () => page.evaluate(() => window.__dawEngine?.play?.()))
await page.waitForTimeout(Math.max(0, at(16000)))
await say('pause again', () => page.evaluate(() => window.__dawEngine?.stop?.()))

// Then leave it entirely alone, which is the case that used to strand it.
let stats = null
let lastReady = -1, stuckFor = 0
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(500)
  stats = await page.evaluate(() => window.__combineStats?.() ?? null)
  if (!stats) continue
  if (stats.ready === lastReady) stuckFor += 0.5; else { stuckFor = 0; lastReady = stats.ready }
  if (stats.ready >= clipCount) break
  // A retry ladder tops out at 60s; give it room to prove it fires.
  if (stuckFor > 90) break
}
await browser.close()

console.log()
console.log(`ready ${stats?.ready}/${clipCount} after ${((Date.now() - t0) / 1000).toFixed(1)}s, playingBake=${stats?.playingBake}`)
console.log(`lastError: ${stats?.lastError ?? 'none'}\n`)

check('the song finished despite being interrupted',
  (stats?.ready ?? 0) === clipCount, `${stats?.ready} of ${clipCount}`)
check('nothing was condemned along the way', (stats?.givenUp ?? 0) === 0, `${stats?.givenUp} given up`)
check('it did not sit stuck', stuckFor <= 90, `no progress for ${stuckFor}s`)

console.log(failures ? `\n${failures} failing` : '\nplay, pause and play again, and it still finishes the song')
process.exit(failures ? 1 : 0)
