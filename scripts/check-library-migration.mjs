/**
 * The v1 → v2 sound-library upgrade, on a database that already has data.
 *
 *   PORT=4670 node scripts/check-library-migration.mjs
 *
 * The risky half of the loading/caching fix is not the caching — it is the
 * schema bump. Every existing user opens a v1 database the first time they load
 * the new build, and `onupgradeneeded` has to add the folder indexes to a store
 * that already exists rather than creating a fresh one. Getting that wrong
 * either throws on open (no library at all) or silently leaves the indexes
 * missing (every lookup quietly falls back to the full scan the fix exists to
 * remove — which would pass every other test).
 *
 * So: build a REAL v1 database the way the old code did, in the page, then let
 * the app open it and check what actually happened to it.
 */
import { chromium } from 'playwright'

const PORT = process.env.PORT || '4670'
const BASE = process.argv[2]?.replace(/\/$/, '') || `http://localhost:${PORT}`

let failed = 0
const check = (label, pass, extra = '') => {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))

// Land on the origin first so IndexedDB is scoped to it, but do NOT let the app
// boot yet — the v1 database has to exist before anything opens it.
await page.goto(`${BASE}/download`, { waitUntil: 'domcontentloaded' })

const DB = 'contentforge-sound-library'
const seeded = await page.evaluate(async (DB) => {
  await new Promise(r => { const d = indexedDB.deleteDatabase(DB); d.onsuccess = d.onerror = d.onblocked = r })
  // Exactly the old v1 schema: id keyPath, category + addedAt indexes, no folder.
  const db = await new Promise((res, rej) => {
    const rq = indexedDB.open(DB, 1)
    rq.onupgradeneeded = () => {
      const s = rq.result.createObjectStore('entries', { keyPath: 'id' })
      s.createIndex('category', 'category', { unique: false })
      s.createIndex('addedAt', 'addedAt', { unique: false })
    }
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error)
  })
  const N = 600, FOLDERS = 20
  await new Promise((res, rej) => {
    const t = db.transaction('entries', 'readwrite'), s = t.objectStore('entries')
    for (let i = 0; i < N; i++) {
      s.put({
        id: 'migtest-' + i,
        name: 'Note ' + i,
        category: 'instrument',
        folder: 'Folder ' + (i % FOLDERS),
        parentFolder: i % 3 === 0 ? 'Pack A' : undefined,   // some entries have none
        audioBlob: new Blob([new Uint8Array(512)]),
        duration: 1, addedAt: new Date().toISOString(),
      })
    }
    t.oncomplete = res; t.onerror = () => rej(t.error)
  })
  db.close()
  return N
}, DB)
console.log(`seeded a v1 database with ${seeded} entries\n`)

// Now let the real app open it. This is the upgrade under test.
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(9000)

const result = await page.evaluate(async (DB) => {
  const db = await new Promise((res, rej) => {
    const rq = indexedDB.open(DB)          // no version: open whatever is there
    rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error)
  })
  const store = db.transaction('entries', 'readonly').objectStore('entries')
  const all = await new Promise(r => { const q = store.getAll(); q.onsuccess = () => r(q.result) })
  const idx = [...store.indexNames]
  const byFolder = name => new Promise(r => {
    const q = db.transaction('entries', 'readonly').objectStore('entries')
      .index('folder').getAll(name)
    q.onsuccess = () => r(q.result)
  })
  const byParent = name => new Promise(r => {
    const q = db.transaction('entries', 'readonly').objectStore('entries')
      .index('parentFolder').getAll(name)
    q.onsuccess = () => r(q.result)
  })
  const out = {
    version: db.version,
    indexes: idx,
    total: all.length,
    seedsKept: all.filter(e => String(e.id).startsWith('migtest-')).length,
    blobsKept: all.filter(e => String(e.id).startsWith('migtest-') && e.audioBlob instanceof Blob).length,
  }
  if (idx.includes('folder')) {
    const f3 = await byFolder('Folder 3')
    out.folderHits = f3.length
    out.folderScanHits = all.filter(e => e.folder === 'Folder 3').length
    out.folderIdsMatch = JSON.stringify(f3.map(e => e.id).sort())
      === JSON.stringify(all.filter(e => e.folder === 'Folder 3').map(e => e.id).sort())
  }
  if (idx.includes('parentFolder')) {
    const p = await byParent('Pack A')
    out.parentHits = p.length
    out.parentScanHits = all.filter(e => e.parentFolder === 'Pack A').length
  }
  db.close()
  return out
}, DB)

console.log(`database is now v${result.version}, indexes: ${result.indexes.join(', ')}`)
console.log(`entries: ${result.total} total, ${result.seedsKept} of the seeded 600 still there\n`)

check('the upgrade ran', result.version === 2, `v${result.version}`)
check('the folder index exists', result.indexes.includes('folder'))
check('the parentFolder index exists', result.indexes.includes('parentFolder'))
check('the original indexes survive', result.indexes.includes('category') && result.indexes.includes('addedAt'))
check('no seeded entry was lost', result.seedsKept === 600, `${result.seedsKept}/600`)
check('audio blobs survived the upgrade', result.blobsKept === 600, `${result.blobsKept}/600`)
// The point of the whole exercise: existing rows must be IN the new index.
// A migration that adds an empty index passes every check above and still
// makes every lookup miss.
check('existing rows were indexed, not just the index created',
  result.folderHits === 30, `${result.folderHits} hits for Folder 3, expected 30`)
check('the index returns exactly what a full scan would',
  result.folderIdsMatch === true, `index ${result.folderHits} vs scan ${result.folderScanHits}`)
check('entries with no parentFolder are simply absent from that index',
  result.parentHits === result.parentScanHits && result.parentHits === 200,
  `${result.parentHits} vs scan ${result.parentScanHits}`)

console.log(`\n${failed ? `${failed} failing` : 'the upgrade is safe on an existing library'}`)
await browser.close()
process.exit(failed ? 1 : 0)
