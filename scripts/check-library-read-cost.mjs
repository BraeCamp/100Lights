/**
 * Does reading the sound library get slower as it fills with audio?
 *
 *   PORT=4679 node scripts/check-library-read-cost.mjs
 *
 * Brae: "It's also slower after time even after reloading the page."
 *
 * ⚠️ ONLY SOMETHING PERSISTED CAN DO THAT. A reload gives a new JS context and
 * a new AudioContext, so leaked worklets and heap die with it. The sound library
 * is the biggest thing that survives — and it GROWS with use, because a catalog
 * sound's audio is written into the record the first time it is played.
 *
 * The read is one getAll() over the whole store per page load, and every record
 * carries its `audioBlob` inline. This measures that read against a store that
 * is filling up, which is the shape of a session that gets slower every day and
 * never gets better.
 */
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4679'}`
const DB = 'contentforge-sound-library'
const STORE = 'entries'

const browser = await chromium.launch({ args: ['--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 140)))

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
await page.waitForTimeout(4000)

const measure = async () => page.evaluate(async ({ DB, STORE }) => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open(DB); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error)
  })
  const t0 = performance.now()
  const rows = await new Promise(res => {
    const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll()
    r.onsuccess = () => res(r.result); r.onerror = () => res([])
  })
  const readMs = performance.now() - t0
  // What it costs to actually TOUCH the audio, which is what playing does.
  const withBlob = rows.filter(x => x && x.audioBlob)
  let bytes = 0
  for (const x of withBlob) bytes += x.audioBlob.size || 0
  db.close()
  return { rows: rows.length, withBlob: withBlob.length, mb: +(bytes / 1048576).toFixed(1), readMs: +readMs.toFixed(1) }
}, { DB, STORE })

/** Add `n` records each carrying `kb` of audio, as using the app does. */
const fill = async (n, kb) => page.evaluate(async ({ DB, STORE, n, kb }) => {
  const db = await new Promise(res => { const r = indexedDB.open(DB); r.onsuccess = () => res(r.result) })
  const blob = new Blob([new Uint8Array(kb * 1024)], { type: 'audio/wav' })
  await new Promise(res => {
    const tx = db.transaction(STORE, 'readwrite')
    const st = tx.objectStore(STORE)
    for (let i = 0; i < n; i++) {
      st.put({
        id: `__probe_${Date.now()}_${i}`, name: `probe ${i}`, category: 'drums',
        audioBlob: blob, duration: 1, addedAt: new Date().toISOString(),
      })
    }
    tx.oncomplete = () => res(); tx.onerror = () => res()
  })
  db.close()
}, { DB, STORE, n, kb })

console.log('\nReading the whole sound library, as every page load does.\n')
console.log('  records   with audio   audio size   getAll()')
for (const [n, kb] of [[0, 0], [200, 150], [400, 150], [800, 150]]) {
  if (n) await fill(n, kb)
  const m = await measure()
  console.log(`  ${String(m.rows).padStart(7)}   ${String(m.withBlob).padStart(10)}   ${String(m.mb).padStart(8)}MB   ${String(m.readMs).padStart(7)}ms`)
}

// Leave the profile as we found it.
await page.evaluate(async ({ DB, STORE }) => {
  const db = await new Promise(res => { const r = indexedDB.open(DB); r.onsuccess = () => res(r.result) })
  await new Promise(res => {
    const tx = db.transaction(STORE, 'readwrite')
    const st = tx.objectStore(STORE)
    const all = st.getAllKeys()
    all.onsuccess = () => { for (const k of all.result) if (String(k).startsWith('__probe_')) st.delete(k) }
    tx.oncomplete = () => res(); tx.onerror = () => res()
  })
  db.close()
}, { DB, STORE })

console.log('\nThis read happens once per page load, on the main thread, before')
console.log('anything can be scheduled. It is the cost a reload cannot clear.')
await browser.close()
process.exit(0)
