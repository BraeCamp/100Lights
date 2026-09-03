#!/usr/bin/env node
/**
 * Does a SAMPLED instrument actually render?
 *
 *   PORT=4710 node scripts/check-sampled-render.mjs
 *
 * Brae: "Renders seem to be coming back silent."
 *
 * They were, for anything that plays a sample. daw-freeze builds a throwaway
 * `new ApolloEngine()` for every render, and renderManyToBuffer sends each node
 * the samples it finds in THAT engine's map — which nothing ever filled. A synth
 * patch has no samples, so the map being empty was correct for it and every test
 * in the repo used a synth patch. A sampled patch got silence.
 *
 * And silence is discarded rather than reported: a combined buffer replaces live
 * playback, so an empty one is worse than slow. The clip is dropped, never
 * baked, plays live forever, and the loader calls it a clip that "would not
 * render". The one number that would have given it away — the peak of each
 * cached render — is what this checks.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'
import { makeTrack, makeClip, makeNotes } from './lib/daw-fixture.mjs'

const BASE = `http://localhost:${process.env.PORT || '4700'}`
const ZONES = Number(process.env.ZONES || 8)
const { initPatch } = await importTs('lib/apollo/patch.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })

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

// Seed real audio into the library. Loud and sustained on purpose: the question
// is whether ANY audio survives the render, so the source must not be something
// that could plausibly measure as silence on its own.
const ids = await page.evaluate(async ({ count }) => {
  const wav = (sec, f) => {
    const sr = 44100, n = Math.floor(sr * sec)
    const b = new ArrayBuffer(44 + n * 2), v = new DataView(b)
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)) }
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true)
    v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true)
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * f * i / sr) * 30000, true)
    return new Blob([b], { type: 'audio/wav' })
  }
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('contentforge-sound-library', 1)
    r.onupgradeneeded = () => {
      const d = r.result
      if (!d.objectStoreNames.contains('entries')) {
        const st = d.createObjectStore('entries', { keyPath: 'id' })
        st.createIndex('category', 'category', { unique: false })
        st.createIndex('addedAt', 'addedAt', { unique: false })
      }
    }
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  const out = []
  const tx = db.transaction('entries', 'readwrite')
  for (let i = 0; i < count; i++) {
    const id = `sr-${i}`; out.push(id)
    tx.objectStore('entries').put({
      id, name: `C${i}`, category: 'custom', audioBlob: wav(2, 220 * Math.pow(2, i / 12)),
      duration: 2, addedAt: new Date().toISOString(), folder: 'Render Probe', tags: [],
    })
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error) })
  db.close()
  return out
}, { count: ZONES })

// One sampled track and — as a control — one plain synth track. The control is
// the point: if BOTH come back silent the rig is broken, and a "sampled renders
// are silent" result would be meaningless.
const ms = initPatch()
ms.oscs[0].enabled = true
ms.oscs[0].engine = 'multisample'
ms.oscs[0].ms.zones = ids.map((id, z) => ({
  sampleId: id, loKey: 0, hiKey: 127, rootKey: 60 + z, loVel: 0, hiVel: 127,
  gain: 0, tune: 0, loopMode: 'off', loopStart: 0, loopEnd: 0,
}))
const synth = initPatch()
synth.oscs[0].enabled = true

const tracks = [
  makeTrack({ id: 'tS', name: 'Sampled', instrument: { type: 'apollo', params: ms } }),
  makeTrack({ id: 'tY', name: 'Synth', instrument: { type: 'apollo', params: synth } }),
]
const clips = [
  makeClip({ id: 'cS', trackId: 'tS', name: 'cS', startBeat: 0, durationBeats: 16, notes: makeNotes(8, { step: 2, length: 1.5 }) }),
  makeClip({ id: 'cY', trackId: 'tY', name: 'cY', startBeat: 0, durationBeats: 16, notes: makeNotes(8, { step: 2, length: 1.5 }) }),
]
const project = { ...defaultProject(), tempo: 110, timeSignatureNum: 4, tracks, arrangementClips: clips }

await page.evaluate(() => window.__clearCombined?.())
await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)

// Wait for both clips to bake, or for the loader to give up on them.
let stats = null
for (let i = 0; i < 120; i++) {
  await page.waitForTimeout(1000)
  stats = await page.evaluate(() => window.__combineStats?.() ?? null)
  if ((stats?.ready ?? 0) >= 2) break
}
const smp = await page.evaluate(() => window.__sampleStats?.() ?? null)

console.log(`\nsamples: asked ${smp?.asked}, decoded ${smp?.decoded}, reused ${smp?.reused}, missing ${smp?.missing}`)
console.log(`combine: ready ${stats?.ready} of 2, peaks ${JSON.stringify(stats?.peaks)}`)
console.log(`lastError: ${stats?.lastError ?? 'none'}\n`)

const peaks = stats?.peaks ?? []
check('the sampled instrument loaded its zones', (smp?.decoded ?? 0) >= ZONES,
  `${smp?.decoded} of ${ZONES}`)
// The control. If this fails the rig is wrong, not the feature.
check('CONTROL: something rendered at all', (stats?.ready ?? 0) >= 1, `${stats?.ready} ready`)
check('BOTH clips rendered — the sampled one is not silent', (stats?.ready ?? 0) === 2,
  `${stats?.ready} of 2 (a silent render is discarded, so a missing clip IS the silence)`)
check('and no cached render is silent', peaks.length > 0 && peaks.every(p => p > 1e-3),
  `peaks ${JSON.stringify(peaks)}`)

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nsampled instruments render with audio in them')
process.exit(failures ? 1 : 0)
