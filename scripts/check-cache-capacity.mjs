#!/usr/bin/env node
/**
 * What happens to a song that does not fit in the cache?
 *
 *   SLOW=3 PORT=4670 node scripts/check-cache-capacity.mjs
 *
 * Every loading bug found so far has been invisible on a small song and obvious
 * on a big one, because the interesting behaviour only starts when the cache is
 * FULL. setProjectNeed sizes it to the song plus 10%, so a song comfortably
 * inside the budget never evicts anything and never exercises the code that
 * decides what to throw away.
 *
 * Two failures live here:
 *
 *   - "Did this render land?" was answered by asking whether the cache GREW.
 *     At capacity a successful render adds one buffer and drops another, so the
 *     size does not move and a working render reads as total failure. That is
 *     fixed; this is the test that would have caught it.
 *
 *   - Layers make it worse. Two rungs of the same clip exist at once during a
 *     transition, so a song sized for one render per clip goes over budget the
 *     moment the second rung starts, and eviction takes the OLDEST buffers —
 *     the opening of the song, the part you are most likely to be listening to.
 *     A clip whose audio is evicted falls back to the live synth, which is the
 *     load undoing its own work.
 *
 * `ready` going DOWN is the signature of both, so it is sampled throughout
 * rather than only at the end.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'
import { slowDown, slowLabel } from './lib/slow-browser.mjs'

const { initPatch } = await importTs('lib/apollo/patch.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

const BASE = `http://localhost:${process.env.PORT || '4670'}`
// Big enough to fill the cache: long clips, many tracks.
const TRACKS = Number(process.env.TRACKS || 7)
const CLIPS = Number(process.env.CLIPS || 6)
const CLIP_BEATS = Number(process.env.CLIP_BEATS || 32)

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
  patch.fxMain = [fx('reverb', { size: 0.6 }), fx('eq')]
  const tracks = [], clips = []
  for (let t = 0; t < TRACKS; t++) {
    const id = `t${t}`
    tracks.push({
      ...(base.tracks[0] ?? {}), id, name: `T${t + 1}`, type: 'midi', effects: [],
      instrument: { type: 'apollo', params: JSON.parse(JSON.stringify(patch)) },
    })
    for (let c = 0; c < CLIPS; c++) {
      const notes = []
      for (let n = 0; n < 12; n++) {
        notes.push({ id: `n${t}-${c}-${n}`, pitch: 40 + ((t * 5 + n * 3) % 28), startBeat: n * 2.5, durationBeats: 2, velocity: 96 })
      }
      clips.push({
        id: `c${t}-${c}`, trackId: id, kind: 'midi', name: `c${t}-${c}`,
        startBeat: c * CLIP_BEATS, durationBeats: CLIP_BEATS, notes, loopEnabled: false,
      })
    }
  }
  return { ...base, tempo: 90, tracks, arrangementClips: clips }
}

const browser = await chromium.launch()
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
console.log(`song: ${TRACKS} tracks x ${CLIPS} clips of ${CLIP_BEATS} beats = ${clipCount} clips`)
console.log(`machine: ${slowLabel()}\n`)

await page.evaluate(() => window.__clearCombined?.())
await page.waitForTimeout(500)
const t0 = Date.now()
await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)

let peakReady = 0
let worstDrop = 0
let overBudget = 0
const layersSeen = new Set()
let last = null
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(500)
  const s = await page.evaluate(() => window.__combineStats?.() ?? null)
  if (!s) continue
  if (s.progress?.layer) layersSeen.add(s.progress.layer)
  if (last != null && s.ready < last) worstDrop = Math.max(worstDrop, last - s.ready)
  if (s.frames > s.maxFrames) overBudget++
  peakReady = Math.max(peakReady, s.ready)
  last = s.ready
  if (s.inFlight === 0 && s.queued === 0 && Date.now() - t0 > 8000) break
}
const stats = await page.evaluate(() => window.__combineStats?.() ?? null)
await browser.close()

const secs = ((Date.now() - t0) / 1000).toFixed(1)
console.log(`finished in ${secs}s — ready ${stats?.ready}/${clipCount}, frames ${stats?.frames} of ${stats?.maxFrames} allowed`)
console.log(`layers: ${[...layersSeen].join(' | ') || '(none)'}`)
console.log(`lastError: ${stats?.lastError ?? 'none'}\n`)

check('the cache actually filled (or this test proves nothing)',
  (stats?.frames ?? 0) > (stats?.maxFrames ?? Infinity) * 0.5,
  `${stats?.frames} of ${stats?.maxFrames}`)
check('the song finished', (stats?.ready ?? 0) === clipCount, `${stats?.ready} of ${clipCount}`)
check('nothing was left to play live', (stats?.setAside ?? 0) === 0, `${stats?.setAside} set aside`)
// Eviction taking work back is the failure this test exists for.
check('baked clips were not evicted while still loading', worstDrop === 0,
  worstDrop ? `ready fell by ${worstDrop} at its worst` : 'ready never fell')
check('the cache stayed within its budget', overBudget === 0, `${overBudget} samples over`)

console.log(failures ? `\n${failures} failing` : '\na song bigger than the cache still finishes, and keeps what it baked')
process.exit(failures ? 1 : 0)
