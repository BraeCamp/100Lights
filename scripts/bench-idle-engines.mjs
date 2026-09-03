#!/usr/bin/env node
/**
 * What does an Apollo engine cost when it is playing NOTHING?
 *
 *   SLOW=3 PORT=4700 node scripts/bench-idle-engines.mjs
 *
 * Beacon makes one full ApolloEngine per track (lib/apollo/daw-instrument.ts:
 * `new ApolloEngine()` per destination), and the worklet's renderQuantum runs
 * unconditionally — there is no early-out when no voice is active. So six
 * silent tracks still pay six complete DSP passes: 32-voice pool, three
 * oscillators, two filters, four envelopes, ten LFOs, the mod matrix and three
 * FX buses, 375 times a second.
 *
 * That is the number this measures, because it decides the whole design. If
 * idle engines are nearly free, live playback of six tracks is a scheduling
 * problem. If they are expensive, no loader can rescue it — baking became
 * mandatory for a reason, and the reason is here rather than in the loader.
 *
 * Measured as the audio clock's ability to keep real time: an AudioContext that
 * cannot finish its work in a block falls behind the wall clock, and that ratio
 * is the honest measure of headroom. 1.0 is comfortable; below 1 is a studio
 * that crackles.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'
import { slowDown, slowLabel } from './lib/slow-browser.mjs'

const { initPatch } = await importTs('lib/apollo/patch.ts')
const BASE = `http://localhost:${process.env.PORT || '4700'}`
const COUNTS = (process.env.COUNTS || '1,2,4,6,8').split(',').map(Number)
const SECONDS = Number(process.env.SECONDS || 6)

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
await slowDown(page)
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 140)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
await page.waitForTimeout(3000)

console.log(`machine: ${slowLabel()}`)
console.log(`live Apollo tracks, nothing baked, ${SECONDS}s each\n`)
console.log(' engines  audio clock  fps   verdict')

import { makeTrack, makeClip, makeNotes } from './lib/daw-fixture.mjs'
const { defaultProject } = await importTs('lib/daw-types.ts')

const patch = initPatch()
// HEAVY=1 makes each track look like a real preset rather than a test tone:
// every oscillator on, unison stacked, a filter, and a reverb + delay + EQ
// chain. Live playback being fine for a sine wave proves very little; the
// question is whether it is fine for what people actually build.
if (process.env.HEAVY) {
  const fx = (type, params = {}) => ({ id: `fx-${type}`, type, enabled: true, mix: 0.35, params })
  for (const o of patch.oscs) { o.enabled = true; o.unison = 4; o.detune = 0.06 }
  patch.sub.enabled = true
  patch.filters[0] = { ...patch.filters[0], enabled: true, type: 'lp12', cutoff: 0.6, res: 0.3 }
  patch.fxMain = [fx('reverb', { size: 0.7 }), fx('delay', { time: 0.3 }), fx('eq')]
  patch.global.poly = 16
}

// Dismiss the first-run dialog once, so the studio is really mounted.
const dlg = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
if (await dlg.count()) {
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Choose your studio setup"]')
    const b = d && [...d.querySelectorAll('button,div[role=button]')].find(e => /Everything/i.test(e.textContent || ''))
    b?.click()
  })
  await dlg.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
}
await page.waitForTimeout(1200)

for (const n of COUNTS) {
  // N Apollo tracks, plain patches, nothing baked — every note is synthesised
  // live, which is the state Brae's six-track song is in while it waits.
  const tracks = [], clips = []
  for (let t = 0; t < n; t++) {
    const id = `t${t}`
    tracks.push(makeTrack({ id, name: `T${t}`, instrument: { type: 'apollo', params: JSON.parse(JSON.stringify(patch)) } }))
    clips.push(makeClip({ id: `c${t}`, trackId: id, name: `c${t}`, startBeat: 0, durationBeats: 64, notes: makeNotes(24, { step: 2, length: 1.5 }) }))
  }
  const project = { ...defaultProject(), tempo: 120, timeSignatureNum: 4, tracks, arrangementClips: clips }

  const r = await page.evaluate(async ({ project, seconds }) => {
    window.__clearCombined?.()                       // nothing baked: all live
    window.__dawDispatch({ type: 'LOAD_PROJECT', project })
    await new Promise(r => setTimeout(r, 1500))
    const eng = window.__dawEngine
    if (!eng?.ctx) return { error: 'no engine' }
    try { await eng.ctx.resume?.() } catch { /* already running */ }
    eng.play?.()
    await new Promise(r => setTimeout(r, 800))       // let voices spin up
    let frames = 0
    const raf = () => { frames++; requestAnimationFrame(raf) }
    requestAnimationFrame(raf)
    const t0 = performance.now(); const c0 = eng.ctx.currentTime
    await new Promise(r => setTimeout(r, seconds * 1000))
    const wall = (performance.now() - t0) / 1000
    const clock = (eng.ctx.currentTime - c0) / wall
    eng.stop?.()
    return { clock, fps: frames / wall }
  }, { project, seconds: SECONDS })

  if (r.error) { console.log(`  ${String(n).padStart(6)}  ${r.error}`); continue }
  const verdict = r.clock > 0.98 ? 'fine' : r.clock > 0.9 ? 'slipping' : 'CANNOT KEEP UP'
  console.log(`  ${String(n).padStart(6)}  ${r.clock.toFixed(3).padStart(10)}  ${r.fps.toFixed(0).padStart(4)}  ${verdict}`)
  await page.waitForTimeout(600)
}

await browser.close()
console.log('\nA clock ratio below 1 means the audio thread cannot finish its work in real time.')
