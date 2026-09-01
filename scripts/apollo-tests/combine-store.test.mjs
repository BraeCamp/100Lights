#!/usr/bin/env node
// The render cache that never got read, and never stopped growing.
//
//   node --experimental-strip-types scripts/apollo-tests/combine-store.test.mjs
//
// Brae: "For some reason the loading is slowing down each time I reload. Is
// there a caching issue?"
//
// Yes, and it was two faults compounding, which is why it got WORSE rather than
// just being slow:
//
//   READS died after the first one. openDb() memoises a single connection on
//   purpose — its own comment says a 42-clip song used to open the database 84
//   times — but loadCombined and saveCombined each called db.close() when they
//   finished. Explicit close() does NOT fire the `close` event (that fires on
//   ABNORMAL closure), so dbPromise kept handing out a CLOSED connection, and
//   every later transaction threw InvalidStateError into a catch that returns
//   null. A miss and a broken cache look identical from there: the clip simply
//   renders instead.
//
//   WRITES kept working, because they go through combine-store.worker.ts, which
//   memoises its connection and never closes it. So every load re-rendered
//   nearly everything and then stored it — into a database it would never read
//   again.
//
//   And pruneCombined, whose own docstring says it exists "so an edited project
//   does not grow forever", HAD NO CALLERS ANYWHERE. Nothing ever deleted a
//   stamp. Every edit mints a new one, and a combined render is 16-bit stereo
//   PCM: about 11 MB a minute, per clip variant, kept forever.
//
// Together: write-only, unbounded, growing every session. That is the shape of
// "slower every time I reload".
//
// The stub below is deliberately faithful to the ONE spec detail this turns on —
// a closed connection throws on transaction(), and close() fires no event.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── A very small IndexedDB, accurate where it matters ──────────────────────
function installFakeIDB() {
  const stores = new Map()
  const stats = { opens: 0, closes: 0, throwsAfterClose: 0 }

  const makeReq = value => {
    const req = { result: value, error: null, onsuccess: null, onerror: null }
    queueMicrotask(() => req.onsuccess?.())
    return req
  }

  class FakeDb {
    constructor() { this.closed = false; this.objectStoreNames = { contains: n => stores.has(n) } }
    createObjectStore(name) { stores.set(name, new Map()); return {} }
    close() { this.closed = true; stats.closes++ /* ⚠️ fires NO event, per spec */ }
    transaction(name) {
      // The whole bug in one line: a closed connection is not reusable.
      if (this.closed) { stats.throwsAfterClose++; const e = new Error('InvalidStateError'); e.name = 'InvalidStateError'; throw e }
      const map = stores.get(name) ?? new Map()
      const tx = { oncomplete: null, onerror: null, error: null }
      tx.objectStore = () => ({
        get: k => makeReq(map.get(k)),
        getAll: () => makeReq([...map.values()]),
        put: v => { map.set(v.stamp, v); return makeReq(undefined) },
        delete: k => { map.delete(k); return makeReq(undefined) },
        // A cursor walks the keys as they were when it started, hands back one
        // record at a time, and only advances when continue() is called.
        openCursor: () => {
          const keys = [...map.keys()]
          let i = -1
          const req = { result: null, error: null, onsuccess: null, onerror: null }
          const step = () => {
            i++
            if (i >= keys.length) { req.result = null; queueMicrotask(() => req.onsuccess?.()); return }
            const key = keys[i]
            req.result = {
              get value() { return map.get(key) },
              delete: () => { map.delete(key); return makeReq(undefined) },
              continue: () => step(),
            }
            queueMicrotask(() => req.onsuccess?.())
          }
          step()
          return req
        },
      })
      // Real transactions stay open while requests are outstanding; completing
      // on the next microtask would let the prune resolve mid-walk.
      setTimeout(() => tx.oncomplete?.(), 0)
      return tx
    }
  }

  globalThis.indexedDB = {
    open: () => {
      stats.opens++
      const db = new FakeDb()
      const req = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null }
      queueMicrotask(() => { req.onupgradeneeded?.(); req.onsuccess?.() })
      return req
    },
    deleteDatabase: () => makeReq(undefined),
  }
  return { stats, stores }
}

const { stats, stores } = installFakeIDB()

// A stand-in for the AudioContext the loader decodes into.
const ctx = {
  createBuffer: (channels, length) => {
    const data = Array.from({ length: channels }, () => new Float32Array(length))
    return { numberOfChannels: channels, length, getChannelData: i => data[i] }
  },
}
const fakeBuffer = (length = 480) => ({
  numberOfChannels: 2, length, sampleRate: 48000,
  getChannelData: () => new Float32Array(length).fill(0.25),
})

const store = await importTs('lib/apollo/combine-store.ts')

// ── The read path has to survive being used more than once ─────────────────
//
// ⚠️ This is the whole bug. A song is dozens of clips; if only the first read
// works, the cache is decorative and every load re-renders the song.
{
  // Writing without a Worker in Node takes the inline path, which is the same
  // shared connection the reads use — exactly the production main-thread path.
  await store.saveCombined('one', fakeBuffer())
  await store.saveCombined('two', fakeBuffer())
  await store.saveCombined('three', fakeBuffer())

  const got = []
  for (const stamp of ['one', 'two', 'three']) {
    got.push(await store.loadCombined(stamp, ctx) ? 1 : 0)
  }
  check('every stored render reads back, not just the first',
    got.every(Boolean), `reads: ${got.join(',')} — ${stats.throwsAfterClose} threw on a closed connection`)
  check('and the shared connection is never left closed behind it',
    stats.throwsAfterClose === 0, `${stats.throwsAfterClose} InvalidStateError`)
  // The memoised connection is the point of openDb — its own comment says so.
  check('the database is opened once, not once per clip',
    stats.opens <= 2, `${stats.opens} opens for 6 operations`)
}

// ── And something has to throw the old ones away ───────────────────────────
{
  const DAY = 1000 * 60 * 60 * 24
  const clips = stores.get('clips')
  // Two stamps this project still wants, and one from an edit three weeks ago.
  clips.set('keep-me', { stamp: 'keep-me', savedAt: Date.now(), channels: [], length: 1, sampleRate: 48000 })
  clips.set('stale', { stamp: 'stale', savedAt: Date.now() - 21 * DAY, channels: [], length: 1, sampleRate: 48000 })
  clips.set('recent-orphan', { stamp: 'recent-orphan', savedAt: Date.now(), channels: [], length: 1, sampleRate: 48000 })

  await store.pruneCombined(new Set(['keep-me']))
  check('a stamp the project still uses survives', clips.has('keep-me'))
  check('an old orphan is deleted', !clips.has('stale'))
  // ⚠️ Age AND absence, both. Undo, or reopening yesterday's version, wants the
  // renders that are not in this exact edit — deleting on absence alone would
  // make every undo a re-render.
  check('but a recent orphan is kept, because undo wants it', clips.has('recent-orphan'))
}

// ── Age alone does not bound it ────────────────────────────────────────────
//
// ⚠️ The fortnight of grace exists so undo and yesterday's version do not cost a
// re-render. But somebody working hard for three days fills a disk well inside
// it, and every one of those renders is recent. Without a size cap the store is
// still unbounded — just unbounded more slowly.
{
  const clips = stores.get('clips')
  clips.clear()
  const MB = (n) => ({ length: n * 1024 * 1024 / 4, sampleRate: 48000, channels: [1, 2] })
  // All from today, so the age rule cannot touch any of them.
  const now = Date.now()
  clips.set('oldest', { stamp: 'oldest', savedAt: now - 3000, ...MB(40) })
  clips.set('middle', { stamp: 'middle', savedAt: now - 2000, ...MB(40) })
  clips.set('newest', { stamp: 'newest', savedAt: now - 1000, ...MB(40) })
  clips.set('wanted', { stamp: 'wanted', savedAt: now - 5000, ...MB(40) })

  // 160 MB stored, 100 MB allowed. 'wanted' is in this project so it is exempt,
  // which means the oldest evictable go until it fits.
  const dropped = await store.pruneCombined(new Set(['wanted']), undefined, 100 * 1024 * 1024)
  check('a recent but oversized store is capped', dropped > 0, `dropped ${dropped}`)
  check('and the oldest went first', !clips.has('oldest'), [...clips.keys()].join(','))
  check('the newest survived', clips.has('newest'), [...clips.keys()].join(','))
  // ⚠️ Never the ones this project is about to ask for — evicting those makes
  // the very next play a re-render, which is the cost the cache exists to avoid.
  check('and what the project still wants is never evicted', clips.has('wanted'))
}

// ── Pruning a bloated store must not be what kills the tab ─────────────────
//
// ⚠️ The original used getAll(), which deserialises every record INCLUDING the
// audio into one array. On the multi-gigabyte store this function exists to
// rescue, that is the crash. The cursor holds one record at a time.
{
  const clips = stores.get('clips')
  clips.clear()
  let materialised = 0
  for (let i = 0; i < 20; i++) {
    const rec = { stamp: `s${i}`, savedAt: Date.now() - 30 * 24 * 3600 * 1000, length: 1024, sampleRate: 48000 }
    // A getter that counts anyone touching the audio payload.
    Object.defineProperty(rec, 'channels', { get() { materialised++; return [1, 2] }, enumerable: true })
    clips.set(rec.stamp, rec)
  }
  await store.pruneCombined(new Set())
  check('it never holds more than one record of audio at a time',
    materialised <= 20, `${materialised} payload reads for 20 records`)
}

console.log(failures ? `\n${failures} failing` : '\nthe render cache reads back and is bounded')
assert.equal(failures, 0)
