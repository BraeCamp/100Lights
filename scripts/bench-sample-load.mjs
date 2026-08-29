#!/usr/bin/env node
/**
 * What does loading a SAMPLED song cost?
 *
 *   SLOW=3 PORT=4704 node scripts/bench-sample-load.mjs
 *
 * Every previous loading benchmark in this repo used `initPatch()` — a pure
 * synth patch that references no samples at all. So they all measured a path
 * Brae's songs barely use, and they all passed. The profile made that explicit:
 * "samples: asked 0". A test that cannot fail the thing you are investigating
 * is not evidence.
 *
 * This one seeds the sound library with real audio and builds MULTISAMPLE
 * patches over it, which is the shape that hurts: a multisample references one
 * sample id PER ZONE, so an instrument is dozens of ids, and Beacon builds one
 * ApolloEngine per track. The questions are (a) how long before the song can
 * sound, and (b) does the same instrument on several tracks cost several times.
 *
 * Seeding goes straight into IndexedDB rather than through an app hook, so the
 * app runs exactly the code it ships.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'
import { slowDown, slowLabel } from './lib/slow-browser.mjs'
import { makeTrack, makeClip, makeNotes } from './lib/daw-fixture.mjs'

const BASE = `http://localhost:${process.env.PORT || '4700'}`
const TRACKS = Number(process.env.TRACKS || 4)
const ZONES = Number(process.env.ZONES || 24)      // zones per instrument
const SHARED = process.env.SHARED !== '0'          // all tracks use ONE instrument
const { initPatch } = await importTs('lib/apollo/patch.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1300, height: 850 } })
await slowDown(page)
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })

// Seed the library with `count` short WAVs, written directly to IndexedDB in
// the shape lib/sound-library.ts stores (db 'contentforge-sound-library',
// store 'entries', keyPath 'id'). Signed out, so no user suffix.
const seeded = await page.evaluate(async ({ count }) => {
  const wav = (seconds, freq) => {
    const sr = 44100, n = Math.floor(sr * seconds)
    const buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf)
    const s = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)) }
    s(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); s(8, 'WAVEfmt ')
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
    v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true)
    v.setUint16(34, 16, true); s(36, 'data'); v.setUint32(40, n * 2, true)
    for (let i = 0; i < n; i++) {
      const env = Math.exp(-3 * i / n)
      v.setInt16(44 + i * 2, Math.sin(2 * Math.PI * freq * i / sr) * env * 22000, true)
    }
    return new Blob([buf], { type: 'audio/wav' })
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
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  })

  const ids = []
  const tx = db.transaction('entries', 'readwrite')
  const store = tx.objectStore('entries')
  for (let i = 0; i < count; i++) {
    const id = `bench-zone-${i}`
    ids.push(id)
    store.put({
      id, name: `C${i}`, category: 'custom',
      audioBlob: wav(1.2, 110 * Math.pow(2, i / 12)),
      duration: 1.2, addedAt: new Date().toISOString(),
      folder: 'Bench Instrument', parentFolder: 'Bench',
      tags: [],
    })
  }
  await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error) })
  db.close()
  return ids
}, { count: ZONES * (SHARED ? 1 : TRACKS) })

console.log(`machine: ${slowLabel()}`)
console.log(`seeded ${seeded.length} library samples`)
console.log(`song: ${TRACKS} tracks x ${ZONES}-zone multisample, ${SHARED ? 'ALL TRACKS SHARE one instrument' : 'each track its own'}\n`)

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

// Multisample patches over the seeded ids.
const tracks = [], clips = []
for (let t = 0; t < TRACKS; t++) {
  const p = initPatch()
  const base = SHARED ? 0 : t * ZONES
  p.oscs[0].enabled = true
  p.oscs[0].engine = 'multisample'
  p.oscs[0].ms.zones = Array.from({ length: ZONES }, (_, z) => ({
    sampleId: seeded[base + z], loKey: 24 + z * 2, hiKey: 25 + z * 2, rootKey: 24 + z * 2,
    loVel: 0, hiVel: 127, gain: 0, tune: 0, loopMode: 'off', loopStart: 0, loopEnd: 0,
  }))
  const id = `t${t}`
  tracks.push(makeTrack({ id, name: `T${t}`, instrument: { type: 'apollo', params: p } }))
  clips.push(makeClip({
    id: `c${t}`, trackId: id, name: `c${t}`, startBeat: 0, durationBeats: 32,
    notes: makeNotes(16, { step: 2, length: 1.5 }),
  }))
}
const project = { ...defaultProject(), tempo: 110, timeSignatureNum: 4, tracks, arrangementClips: clips }

await page.evaluate(() => window.__clearCombined?.())
const t0 = Date.now()
await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)

// Poll until the sample loader stops making progress.
let last = -1, still = 0, settledAt = 0
for (let i = 0; i < 240; i++) {
  await page.waitForTimeout(500)
  const s = await page.evaluate(() => window.__sampleStats?.() ?? null)
  if (!s) continue
  const n = s.decoded + s.reused + s.missing
  if (n === last) { still++ } else { still = 0; last = n }
  if (still >= 6 && n > 0) { settledAt = Date.now() - t0; break }
}

const s = await page.evaluate(() => window.__sampleStats?.() ?? null)
const wanted = ZONES * TRACKS
console.log(`settled after ${(settledAt / 1000).toFixed(1)}s`)
console.log(`  asked   ${s?.asked}   (${TRACKS} tracks x ${ZONES} zones = ${wanted})`)
console.log(`  decoded ${s?.decoded}  <- actual fetch+decode work`)
console.log(`  reused  ${s?.reused}   <- served from the shared cache`)
console.log(`  missing ${s?.missing}`)
console.log(`  time in the sample path ${s?.ms}ms (worst single ${s?.worstMs}ms)`)

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}
console.log()
check('every zone was asked for', (s?.asked ?? 0) >= wanted, `${s?.asked} of ${wanted}`)
if (SHARED) {
  // The whole point: one instrument on four tracks must decode ONCE.
  check('a shared instrument decodes once, not once per track',
    (s?.decoded ?? 0) <= ZONES, `${s?.decoded} decoded for ${wanted} asks`)
  check('the rest came from the shared cache',
    (s?.reused ?? 0) >= wanted - ZONES - 2, `${s?.reused} reused`)
}
check('nothing went missing', (s?.missing ?? 0) === 0, `${s?.missing} missing`)

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nsampled instruments load once and are shared across tracks')
process.exit(failures ? 1 : 0)
