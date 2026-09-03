/**
 * What is on disk, and does opening the studio get slower as it grows?
 *
 *   PORT=4679 node scripts/check-persisted-growth.mjs
 *
 * Brae: "It's also slower after time even after reloading the page."
 *
 * ⚠️ THAT RULES OUT ALMOST EVERYTHING WE HAVE BEEN LOOKING AT. A reload builds
 * a new JavaScript context and a new AudioContext, so leaked worklets, leaked
 * listeners and a bloated heap all die with it. Slowness that SURVIVES a reload
 * has to come from something the browser kept: IndexedDB, the Cache Storage the
 * service worker writes, localStorage, or the server.
 *
 * So this measures the stores rather than the page: what is in them, how big
 * they are, and how long a cold open takes with them in place.
 */
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4679'}`

const browser = await chromium.launch({ args: ['--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 140)))

const openStudio = async label => {
  const t0 = Date.now()
  await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
  const ms = Date.now() - t0
  console.log(`  ${label.padEnd(28)} engine ready in ${String(ms).padStart(5)}ms`)
  return ms
}

const report = async () => {
  const s = await page.evaluate(async () => {
    const out = { quotaMB: null, usageMB: null, dbs: [], caches: [], localStorageKB: 0, localStorageKeys: 0 }
    try {
      const e = await navigator.storage.estimate()
      out.quotaMB = +(e.quota / 1048576).toFixed(0)
      out.usageMB = +(e.usage / 1048576).toFixed(2)
      // Chrome breaks usage down by store — the useful half.
      if (e.usageDetails) out.details = Object.fromEntries(
        Object.entries(e.usageDetails).map(([k, v]) => [k, +(v / 1048576).toFixed(2)]))
    } catch { /* not supported */ }

    try {
      for (const d of await indexedDB.databases()) {
        // Count rows per store, since a store with many tiny rows is as slow to
        // scan as one with few large ones and does not show up as bytes.
        const rows = await new Promise(res => {
          const req = indexedDB.open(d.name)
          req.onsuccess = () => {
            const db = req.result
            const names = [...db.objectStoreNames]
            if (!names.length) { db.close(); return res({}) }
            const tx = db.transaction(names, 'readonly')
            const counts = {}
            let left = names.length
            for (const n of names) {
              const c = tx.objectStore(n).count()
              c.onsuccess = () => { counts[n] = c.result; if (--left === 0) { db.close(); res(counts) } }
              c.onerror = () => { if (--left === 0) { db.close(); res(counts) } }
            }
          }
          req.onerror = () => res({})
          setTimeout(() => res({}), 4000)
        })
        out.dbs.push({ name: d.name, rows })
      }
    } catch { /* not supported */ }

    try {
      for (const n of await caches.keys()) {
        const c = await caches.open(n)
        out.caches.push({ name: n, entries: (await c.keys()).length })
      }
    } catch { /* not supported */ }

    try {
      let bytes = 0
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        bytes += k.length + (localStorage.getItem(k) || '').length
      }
      out.localStorageKB = +(bytes / 1024).toFixed(1)
      out.localStorageKeys = localStorage.length
    } catch { /* private mode */ }
    return out
  })

  console.log(`\n  storage used: ${s.usageMB}MB of ${s.quotaMB}MB quota`)
  if (s.details) console.log('  by store:', JSON.stringify(s.details))
  console.log(`  localStorage: ${s.localStorageKB}KB across ${s.localStorageKeys} keys`)
  if (s.dbs.length) {
    console.log('  IndexedDB:')
    for (const d of s.dbs) {
      const rows = Object.entries(d.rows)
      const total = rows.reduce((n, [, v]) => n + v, 0)
      console.log(`    ${d.name.padEnd(28)} ${String(total).padStart(6)} rows   ${rows.map(([k, v]) => `${k}=${v}`).join(' ')}`)
    }
  }
  if (s.caches.length) {
    console.log('  Cache Storage:')
    for (const c of s.caches) console.log(`    ${c.name.padEnd(28)} ${c.entries} entries`)
  }
  return s
}

console.log('\nCold open, then repeated open/play cycles, watching what accumulates.\n')
const first = await openStudio('1st open (empty profile)')
await report()

for (let i = 2; i <= 4; i++) {
  await page.evaluate(() => { void window.__dawEngine?.play(0) })
  await page.waitForTimeout(4000)
  await page.evaluate(() => window.__dawEngine?.stop())
  await page.waitForTimeout(500)
  console.log('')
  await openStudio(`${i}th open`)
}
const last = await report()

console.log(`\n${'='.repeat(70)}`)
console.log(`first open ${first}ms   ·   storage now ${last.usageMB}MB`)
console.log('If a store grows every cycle here, it grows forever on a real machine —')
console.log('and it is read on every cold open, which is what a reload cannot clear.')

await browser.close()
process.exit(0)
