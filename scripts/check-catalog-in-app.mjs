#!/usr/bin/env node
// Do the catalog sounds actually reach the Sound Library — and do they stream
// on demand rather than all at once?
//
//   node scripts/check-catalog-in-app.mjs [baseUrl]
//
// The catalog is only useful if it lands in the library, because that is what
// Apollo's sample picker reads. And it is only SAFE if entries arrive as
// metadata: a 731-sound pack is about 500MB, and downloading that into every
// visitor's IndexedDB before they touch one of them is not a feature.

import assert from 'node:assert'
import { chromium } from 'playwright'

const BASE = (process.argv[2] || 'https://www.100lights.com').replace(/\/$/, '')
let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()

// Count what actually goes over the wire, which is the whole point.
let audioRequests = 0
let audioBytes = 0
page.on('response', async r => {
  if (!/\/api\/catalog\/audio/.test(r.url())) return
  audioRequests++
  const len = Number(r.headers()['content-length'] || 0)
  if (len) audioBytes += len
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'commit', timeout: 90000 })
await page.waitForTimeout(20000)   // let the background catalog sync finish

const lib = await page.evaluate(async () => {
  // Read the library the way the app does.
  // The library db is per-user: 'contentforge-sound-library[-<userId>]'.
  // Find it rather than guessing — an earlier version guessed the name and the
  // store, and failed on both.
  const names = (await indexedDB.databases()).map(d => d.name).filter(n => n && n.startsWith('contentforge-sound-library'))
  if (!names.length) return { error: 'no library db', dbs: (await indexedDB.databases()).map(d => d.name) }
  const db = await new Promise(res => {
    const rq = indexedDB.open(names[0])
    rq.onsuccess = () => res(rq.result)
    rq.onerror = () => res(null)
  })
  if (!db) return { error: 'could not open ' + names[0] }
  const store = 'entries'
  if (![...db.objectStoreNames].includes(store)) return { error: 'no entries store', stores: [...db.objectStoreNames] }
  const all = await new Promise(res => {
    const rq = db.transaction(store, 'readonly').objectStore(store).getAll()
    rq.onsuccess = () => res(rq.result || [])
    rq.onerror = () => res([])
  })
  const cat = all.filter(e => e.catalog)
  return {
    total: all.length,
    catalog: cat.length,
    withBlob: cat.filter(e => e.audioBlob).length,
    withUrl: cat.filter(e => e.catalogUrl).length,
    sample: cat.slice(0, 3).map(e => `${e.name} (${e.category})`),
    folders: [...new Set(cat.map(e => e.folder).filter(Boolean))].sort(),
  }
})

console.log(`  library: ${lib.total} entries, ${lib.catalog} from the catalog`)
console.log(`  of those: ${lib.withUrl} carry a stream URL, ${lib.withBlob} already hold audio`)
console.log(`  folders: ${(lib.folders || []).join(', ')}`)
console.log(`  audio fetched during load: ${audioRequests} requests, ${(audioBytes / 1e6).toFixed(1)} MB`)

check('the catalog reached the library', (lib.catalog ?? 0) > 500, `${lib.catalog}`)
check('entries arrive as metadata, not audio', (lib.withUrl ?? 0) > 500, `${lib.withUrl} with a URL`)
// The claim that matters: opening the studio must not pull the whole pack.
check('opening the studio does not download the pack',
  audioBytes < 30e6, `${(audioBytes / 1e6).toFixed(1)} MB over ${audioRequests} requests`)
check('the drum folders are all there',
  ['kick', 'snare', 'hihat', 'clap', 'tom'].every(f => (lib.folders || []).includes(f)),
  (lib.folders || []).join(', '))

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe catalog is in the library and streams on demand')
assert.equal(failures, 0)
