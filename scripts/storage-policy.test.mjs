// Writing renders down only when it is free to do so.
//
//   npm run test:storage
//
// Brae's rule: "it should only be loading into persistent storage if the song is
// paused and only after detecting how fast it can load without slowing down the
// browser." Both halves matter and both are easy to get subtly wrong, so they
// are asserted directly rather than inferred from behaviour in a browser.
//
// Playback must never depend on any of this. A device with no storage renders
// ahead of the playhead exactly as a first open does — so the interesting case
// is not "does it write", it is "does it stay out of the way".

import assert from 'node:assert'
import { createRequire } from 'node:module'

// Pretend to be a browser that HAS storage, before the module is loaded — the
// policy is probed once and remembered, so this has to be in place first.
//
// Without this the test passes vacuously: in node there is no indexedDB, the
// policy correctly answers "no storage", and every assertion about writing is
// trivially satisfied by writing nothing. That is the right behaviour and the
// wrong test.
globalThis.indexedDB = {}
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'test',
    storage: {
      estimate: async () => ({ quota: 2 * 1024 * 1024 * 1024 }),
      persisted: async () => true,
    },
  },
  configurable: true,
})

const require_ = createRequire(import.meta.url)
const mod = require_('../.test-build/apollo/storage-policy.js')

// The detection itself, before anything is written.
{
  const p = await mod.storagePolicy()
  console.log(`PASS storage detected as "${p.mode}" — ${p.reason}`)
}

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// A writer that records what it was asked to keep, and how slowly.
const written = []
let writeDelayMs = 0
mod.setCombineWriter(async (stamp) => {
  if (writeDelayMs) await new Promise(r => setTimeout(r, writeDelayMs))
  written.push(stamp)
})

const fakeBuf = { numberOfChannels: 2, length: 1000, sampleRate: 48000, getChannelData: () => new Float32Array(1000) }
const settle = () => new Promise(r => setTimeout(r, 60))

// ── Nothing is written while the song is playing ────────────────────────────
mod.setStorageTransportPlaying(true)
for (let i = 0; i < 5; i++) await mod.keepForNextTime(`playing-${i}`, fakeBuf)
await settle()
check('nothing is written while the transport is running', written.length === 0,
  written.length ? `wrote ${written.length}` : '')
check('but the renders are not thrown away', mod.storageStats().pending === 5,
  `${mod.storageStats().pending} waiting`)

// ── Stopping flushes them ───────────────────────────────────────────────────
mod.setStorageTransportPlaying(false)
await settle(); await settle(); await settle()
check('stopping writes down what was waiting', written.length === 5, `${written.length} written`)
check('and nothing is left waiting', mod.storageStats().pending === 0)

// ── Starting again holds new work back ──────────────────────────────────────
written.length = 0
mod.setStorageTransportPlaying(true)
await mod.keepForNextTime('during-playback', fakeBuf)
await settle()
check('a render made during playback waits its turn', written.length === 0)
mod.setStorageTransportPlaying(false)
await settle(); await settle()
check('and lands as soon as the song stops', written.includes('during-playback'))

// ── The burst is sized to how fast the machine writes ───────────────────────
//
// This is the "detect how fast it can load" half. The size is not a constant:
// it comes from the time the last writes actually took, so the same code does
// twelve at a time on a fast machine and two on a slow one.
{
  const fast = mod.storageStats().burst
  check('a fast machine takes a big burst', fast >= 8, `burst ${fast}`)

  written.length = 0
  writeDelayMs = 40                       // pretend this device is slow
  mod.setStorageTransportPlaying(true)
  for (let i = 0; i < 8; i++) await mod.keepForNextTime(`slow-${i}`, fakeBuf)
  mod.setStorageTransportPlaying(false)
  await new Promise(r => setTimeout(r, 1200))
  const slow = mod.storageStats().burst
  check('a slow machine takes a small one', slow < fast, `burst ${slow} vs ${fast}`)
  check('it still writes everything, just in more passes', written.length === 8, `${written.length}/8`)
  writeDelayMs = 0
}

// ── Play pressed in the MIDDLE of a burst ───────────────────────────────────
//
// Every case above turns the transport on BEFORE queueing, so the flush loop
// always meets the change at its `while` condition — between bursts, where it
// was already handled. The gap was inside a burst: the loop checked "is it
// playing" once per burst and then wrote the whole thing, so pressing play
// after the first write let the remaining eleven run. saveCombined converts
// both channels to Int16 synchronously before its first await, so those are
// heard.
//
// A CPU profile of a playing studio put `transaction` (483ms) and `put` (105ms)
// at the top of the main thread — above everything the transport itself does.
//
// The setup is fiddly and it matters: queue while PLAYING so nothing flushes
// and the queue fills, then pause so the flush takes a full burst, then press
// play one write in. Queueing while stopped instead starts a flush on the very
// first item, so the burst is a burst of one and this never reproduces.
{
  written.length = 0
  writeDelayMs = 10
  let playing = true
  let began = 0
  mod.setCombineWriter(async (stamp) => {
    if (playing) began++
    await new Promise(r => setTimeout(r, writeDelayMs))
    written.push(stamp)
  })

  mod.setStorageTransportPlaying(true)
  for (let i = 0; i < 40; i++) await mod.keepForNextTime(`burst-${i}`, fakeBuf)
  check('queueing while playing writes nothing', written.length === 0, `${written.length} written`)

  playing = false
  mod.setStorageTransportPlaying(false)       // a full burst is taken here
  await new Promise(r => setTimeout(r, 15))   // one write goes through
  playing = true
  mod.setStorageTransportPlaying(true)        // ...play lands mid-burst
  await new Promise(r => setTimeout(r, 400))

  check('pressing play stops the burst it is in the middle of', began <= 1,
    `${began} write(s) began after play`)
  check('and what it did not write is still queued', mod.storageStats().pending > 0,
    `${mod.storageStats().pending} pending`)

  const held = mod.storageStats().pending
  playing = false
  mod.setStorageTransportPlaying(false)
  await new Promise(r => setTimeout(r, 2000))
  check('pausing writes down everything that was held back',
    mod.storageStats().pending === 0, `${mod.storageStats().pending} left of ${held}`)
  check('and every clip was written exactly once',
    written.length === 40 && new Set(written).size === 40,
    `${written.length} writes, ${new Set(written).size} unique`)
  writeDelayMs = 0
}

console.log(failures ? `\n${failures} failing` : '\nrenders are kept only when keeping them is free')
assert.equal(failures, 0)
