/**
 * Does the forced cache purge run once, and only once, and keep the data?
 *
 *   PORT=4686 node scripts/check-cache-purge.mjs
 *
 * Two things must both be true, and getting either wrong is worse than the
 * stale cache the purge exists to clear:
 *
 *   ⚠️ IT MUST NOT LOOP. The purge reloads the page. If the flag that records
 *   it were written after the reload rather than before, or failed silently in
 *   private mode, every load would purge and reload again — an app that never
 *   finishes opening. The flag is written FIRST for exactly this reason, and
 *   this counts loads to prove it.
 *
 *   ⚠️ IT MUST NOT TOUCH IndexedDB. Cache Storage holds copies of files the
 *   server can send again. IndexedDB holds the sound library and offline
 *   projects — work that took real time and that nothing can regenerate. This
 *   seeds a row and checks it survives, because "clear site data" is the advice
 *   this replaces and it deletes both.
 */
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4686'}`

let failed = 0
const check = (label, pass, extra = '') => {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
// One context throughout: the purge flag lives in localStorage, so a fresh
// profile per load would make every load look like the first.
const ctx = await browser.newContext()
const page = await ctx.newPage()

let loads = 0
page.on('load', () => { loads++ })
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 130)))

// Seed the store that must survive, before anything registers.
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.evaluate(async () => {
  await new Promise(res => {
    const r = indexedDB.open('__purge_probe__', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('keep')
    r.onsuccess = () => {
      const db = r.result
      const tx = db.transaction('keep', 'readwrite')
      tx.objectStore('keep').put({ precious: 'a sound library' }, 'row')
      tx.oncomplete = () => { db.close(); res() }
      tx.onerror = () => { db.close(); res() }
    }
    r.onerror = () => res()
  })
  // And something in Cache Storage that SHOULD be swept away.
  const c = await caches.open('100l-assets-v3')
  await c.put('/stale-thing.js', new Response('old'))
})

loads = 0
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

const after = await page.evaluate(async () => {
  const row = await new Promise(res => {
    const r = indexedDB.open('__purge_probe__')
    r.onsuccess = () => {
      const db = r.result
      if (![...db.objectStoreNames].includes('keep')) { db.close(); return res(null) }
      const g = db.transaction('keep', 'readonly').objectStore('keep').get('row')
      g.onsuccess = () => { db.close(); res(g.result ?? null) }
      g.onerror = () => { db.close(); res(null) }
    }
    r.onerror = () => res(null)
  })
  return {
    row,
    caches: await caches.keys(),
    flag: (() => { try { return localStorage.getItem('100l.cache.purge') } catch { return null } })(),
  }
})

check('the purge ran and recorded itself', !!after.flag, after.flag ?? 'no flag')
// ⚠️ THE ONE THAT MATTERS MOST.
check('IndexedDB survived — nothing to recreate', !!after.row,
  after.row ? JSON.stringify(after.row) : 'THE SEEDED ROW IS GONE')
check('the stale cache entry was swept',
  !after.caches.includes('100l-assets-v3'), after.caches.join(', ') || '(no caches)')
// One purge reload is expected; anything more is a loop.
check('it reloaded at most once', loads <= 2, `${loads} loads`)

// Now the second visit: it must do nothing at all.
loads = 0
await page.goto(`${BASE}/dashboard`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
check('a later visit does not purge again', loads <= 1, `${loads} loads on the second visit`)

console.log(failed ? `\n${failed} failing` : '\nthe purge is safe: once, and it keeps your work')
await browser.close()
process.exit(failed ? 1 : 0)
