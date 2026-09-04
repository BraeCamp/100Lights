#!/usr/bin/env node
/**
 * Server loading when storage refuses the browser — and seven parts at once.
 *
 *   PORT=3000 node scripts/check-server-blocked.mjs
 *
 * Brae: "Rendering with server loading keeps failing, and live playing stops
 * working at 7 piano rolls items playing at once."
 *
 * The record, 2026-09-04 09:56, production: the server rendered and stored
 * twenty parts, then the browser was refused every one of them on the hop to
 * storage — the bucket's cross-origin rules did not list www.100lights.com —
 * and the studio asked for the same parts thirty-two times in the next
 * minute. Nothing was ever baked here either, because server loading parked
 * the local bake for as long as it was on, and a bake could not START while
 * the song played. So the song was seven live synths, and at seven the audio
 * thread gave out.
 *
 * This drives that exact shape: server loading remembered on, the route
 * answering every ask with a redirect this origin is not allowed to read,
 * seven pad clips starting together, and play pressed the moment the song
 * opens. It expects one honest line naming the cause, no re-ask loop, and all
 * seven parts baked WHILE the song plays.
 *
 * ⚠️ Needs the dev server with DEV_OPEN=1, like the other headless checks.
 */
import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'

const BASE = `http://localhost:${process.env.PORT || '3000'}`
const { initPatch } = await importTs('lib/apollo/patch.ts')
const PATCH = initPatch()
const PAD = [40, 42, 43, 47, 52, 54, 55, 57, 59, 61, 62, 64, 66, 69]
const PROJECT_ID = `p-blocked-${Date.now().toString(36)}`
const N = 7

function project() {
  const tracks = [], arrangementClips = []
  for (let k = 0; k < N; k++) {
    const id = `t${k}`
    tracks.push({ id, name: `Pad ${k}`, type: 'midi', color: '#8b5cf6', volume: 0.5, pan: 0, mute: false, solo: false, armed: false, height: 90, effects: [], instrument: { type: 'apollo', params: JSON.parse(JSON.stringify(PATCH)) } })
    arrangementClips.push({ kind: 'midi', id: `${PROJECT_ID}-c${k}`, trackId: id, name: 'Pad intro', startBeat: 0, durationBeats: 16, notes: [0, 4, 8, 12].flatMap(b => PAD.map((p, i) => ({ id: `n${k}_${b}_${i}`, pitch: p, velocity: 100, startBeat: b, durationBeats: 3.8 }))) })
  }
  return { id: PROJECT_ID, name: `${N} pads`, tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4, swing: 0, masterVolume: 0.8, tracks, arrangementClips, clipEffects: [], returnTracks: [], automationLanes: [], sessionGrid: [], scenes: [], takeLanes: [], loopStart: 0, loopEnd: 16, loopEnabled: true }
}

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const ctx = await browser.newContext()
await ctx.addCookies([{ name: '__clerk_db_jwt', value: 'dev', domain: 'localhost', path: '/' }])
const page = await ctx.newPage()
let asks = 0
// Every ask answered the way production answered: "it is in storage, here is
// the redirect" — to somewhere this origin is not allowed to read.
await page.route('**/api/render-clip*', route => { asks++; route.fulfill({ status: 302, headers: { Location: 'https://example.com/' } }) })
await page.addInitScript(() => { try { localStorage.setItem('beacon.serverLoading', 'on') } catch { /* private mode */ } })
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 160)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine && !!window.__combineCacheModule, null, { timeout: 180000 })
await page.waitForTimeout(2500)

const ready = () => page.evaluate(() => window.__combineStats?.()?.ready ?? 0)
check('server loading is on from the remembered setting', await page.evaluate(() => window.__combineCacheModule.isServerLoading()))
await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), project())
await page.evaluate(() => window.__dawEngine.play(0))
const timeline = []
for (let s = 2; s <= 24; s += 2) { await page.waitForTimeout(2000); timeline.push(`${s}s:${await ready()}`) }
console.log('  ready while playing: ' + timeline.join(' '))
const at = await ready()
const st = await page.evaluate(() => { const s = window.__combineStats?.(); return { maxFrames: s?.maxFrames, log: (s?.log ?? []).map(e => `${e.kind}${e.detail ? `: ${e.detail}` : ''}`) } })
const errs = st.log.filter(l => /^window-error/.test(l))
check('the failure is named, with the cause', errs.length >= 1 && errs.every(l => /refused the render by storage — its cross-origin rules do not allow/.test(l)), errs[0] ?? '(none)')
check('once per pass, not once per part', errs.length <= 3, `${errs.length} error lines`)
check('no re-ask loop (production saw 32 asks a minute)', asks <= N * 2 + 4, `${asks} asks in 26 s`)
check('the old park ("this machine is not rendering") is gone', !st.log.some(l => /not rendering/.test(l)))
check(`all ${N} parts are baked WHILE the song plays`, at >= N, `ready ${at} of ${N}`)
check('the cache was sized to the song, with the render tail', st.maxFrames >= N * (8 + 2) * 48_000, `maxFrames ${st.maxFrames}`)
await page.evaluate(() => window.__dawEngine.stop())
await browser.close()
console.log(failures ? `\n${failures} failing` : '\nblocked storage, answered — and baked while playing')
process.exit(failures ? 1 : 0)
