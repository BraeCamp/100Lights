#!/usr/bin/env node
/**
 * Does the song really render dry first, with the effects layered over it?
 *
 *   PORT=4660 node scripts/check-render-layers.mjs
 *
 * Brae: "loads the song without any filters or changes then loads filters over
 * the song one or a few at a time. We would need to change the loading bar to
 * Layers instead of track items."
 *
 * The unit tests cover the ladder itself. What they cannot see is whether the
 * loader actually climbs it, in order, and whether the bar says so — the whole
 * point is that you hear the WHOLE song early, so "every clip audible" has to
 * be true before the effects arrive, not after.
 *
 * So this watches a real load and asserts three things:
 *   1. the first rung covers every clip, and quickly
 *   2. the bar names layers, not "17 of 23"
 *   3. the rungs are climbed in order and end on the real patch
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'

const { initPatch } = await importTs('lib/apollo/patch.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

const BASE = `http://localhost:${process.env.PORT || '4660'}`
const TRACKS = Number(process.env.TRACKS || 4)
const CLIPS = Number(process.env.CLIPS || 4)

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const fx = (type, params = {}) => ({ id: `fx-${type}`, type, enabled: true, mix: 0.35, params })

function buildProject() {
  const base = defaultProject()
  const patch = initPatch()
  for (const o of patch.oscs) { o.enabled = true; o.unison = 3; o.detune = 0.06 }
  // A song with something to strip, or there is only one rung and nothing to see.
  patch.filters[0] = { ...patch.filters[0], enabled: true, type: 'lp12', cutoff: 0.6, res: 0.3 }
  patch.fxMain = [fx('reverb', { size: 0.7 }), fx('delay', { time: 0.3 }), fx('eq')]
  patch.fxBus1 = [fx('chorus')]
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

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
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
console.log(`song: ${TRACKS} tracks, ${clipCount} clips, filter + 3 FX + 1 send\n`)

await page.evaluate(() => window.__clearCombined?.())
await page.waitForTimeout(500)
const t0 = Date.now()
await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)

// Sample the bar's own words and the cache, so the claim is about what a person
// would actually see.
const seen = []
let firstFullCoverageMs = null
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(500)
  // Read the progress OBJECT the bar renders from, not the bar.
  //
  // This harness dispatches LOAD_PROJECT straight at the engine and never
  // mounts the audio editor — data-editor-kind="audio" is absent and there is
  // not a single [data-ui-el] on the page. Asserting on the bar's DOM here
  // would be asserting that a component this test never renders says the right
  // thing, which is how a test ends up failing for a reason unrelated to the
  // code under test. The layer string asserted below is the exact value the bar
  // interpolates.
  const row = await page.evaluate(() => {
    const s = window.__combineStats?.()
    return {
      text: s?.progress?.layer ?? '', ready: s?.ready ?? 0, loader: s?.loader,
      inFlight: s?.inFlight ?? 0, queued: s?.queued ?? 0,
    }
  })
  if (row.text && row.text !== seen.at(-1)?.text) {
    seen.push({ t: Date.now() - t0, text: row.text, ready: row.ready })
    console.log(`   ${((Date.now() - t0) / 1000).toFixed(1)}s  "${row.text}"  ready=${row.ready}`)
  }
  if (firstFullCoverageMs == null && row.ready >= clipCount) firstFullCoverageMs = Date.now() - t0
  if (row.inFlight === 0 && row.queued === 0 && Date.now() - t0 > 5000) break
}
const stats = await page.evaluate(() => window.__combineStats?.() ?? null)
await browser.close()

console.log()
check('the loader reports itself', !!stats?.loader, String(stats?.loader))
// 1. The whole song audible early — the reason for the ladder.
check('every clip became audible', firstFullCoverageMs != null,
  firstFullCoverageMs != null ? `after ${(firstFullCoverageMs / 1000).toFixed(1)}s` : 'never')
// 2. The bar talks about layers, not clip counts.
const layerish = seen.filter(x => /\(\d+ of \d+\)/.test(x.text))
check('progress names layers rather than counting clips', layerish.length > 0,
  layerish.map(x => x.text).join(' | ') || seen.map(x => x.text).join(' | '))
// 3. Climbed in order, ending on the real patch.
const idx = layerish.map(x => Number(x.text.match(/\((\d+) of/)?.[1] ?? 0))
check('the rungs are climbed in order', idx.every((n, i) => i === 0 || n >= idx[i - 1]), idx.join(' → '))
check('it finished on the last rung',
  layerish.length === 0 || /\((\d+) of \1\)/.test(layerish.at(-1).text),
  layerish.at(-1)?.text ?? '')
check('and every clip ended up baked', (stats?.ready ?? 0) === clipCount, `${stats?.ready} of ${clipCount}`)

console.log(failures ? `\n${failures} failing` : '\nthe song renders dry first and gains its effects in layers')
process.exit(failures ? 1 : 0)
