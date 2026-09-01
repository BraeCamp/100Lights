/**
 * Does playing, stopping, or looping leave Apollo worklets behind?
 *
 *   PORT=4670 node scripts/check-worklet-leak.mjs
 *
 * The hypothesis this exists to settle:
 *
 *   daw-instrument.ts keys ONE Apollo worklet engine per track by its
 *   destination node (`byDest`, a WeakMap). daw-engine.ts:53 says the
 *   `midiInput` bus is "swapped on stop so ringing notes cut off", and
 *   _killAllSources() says Apollo instruments "rebuild on the next play".
 *   _killAllSources() is called on stop, on seek — and on LOOP WRAPAROUND
 *   (daw-engine.ts:2275).
 *
 *   So every stop, and every pass around a loop, throws away every Apollo
 *   engine and builds new ones. If the old ones are not reclaimed, each is an
 *   AudioWorkletNode still running Helios DSP, and the cost grows with time
 *   spent playing and never comes back down — which is exactly the report:
 *   "it gets slower and slower, and stays slow even back at the beginning".
 *
 * ⚠️ Counts CONSTRUCTED worklets, not `ctx.createX` calls: AudioWorkletNode is
 * built with `new`, so a create*-only probe sees none of this.
 *
 * ⚠️ Never awaits engine.play() — it is async and does not settle headlessly,
 * which hung an earlier version of this for 32 minutes.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const PORT = process.env.PORT || '4670'
const BASE = process.argv[2]?.replace(/\/$/, '') || `http://localhost:${PORT}`
const CYCLES = Number(process.env.CYCLES || 5)
const FIXTURE = process.env.FIXTURE
  || join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')

if (!existsSync(FIXTURE)) { console.log(`no fixture at ${FIXTURE}`); process.exit(1) }
const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject
const apolloTracks = dawProject.tracks.filter(t => t.instrument?.type === 'apollo').length
console.log(`fixture: ${FIXTURE.split('/').pop()} — ${dawProject.tracks.length} tracks, ${apolloTracks} of them Apollo\n`)

let failed = 0
const check = (label, pass, extra = '') => {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--js-flags=--expose-gc'],
})
const page = await browser.newPage()
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 140)))

await page.addInitScript(() => {
  const w = window
  w.__wl = { made: 0, disconnected: 0, byName: {}, live: new Set() }
  const Orig = w.AudioWorkletNode
  if (Orig) {
    w.AudioWorkletNode = new Proxy(Orig, {
      construct(target, args, nt) {
        w.__wl.made++
        const name = String(args[1] ?? '?')
        w.__wl.byName[name] = (w.__wl.byName[name] || 0) + 1
        const node = Reflect.construct(target, args, nt)
        // Weakly held, so anything the collector reclaims drops out on its own.
        // What is still here after a GC is what is genuinely retained.
        w.__wl.live.add(new WeakRef(node))
        return node
      },
    })
  }
  w.__wl.liveCount = () => {
    let n = 0
    for (const ref of w.__wl.live) { if (ref.deref()) n++; else w.__wl.live.delete(ref) }
    return n
  }
  const origDisc = AudioNode.prototype.disconnect
  AudioNode.prototype.disconnect = function (...a) { w.__wl.disconnected++; return origDisc.apply(this, a) }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
  .catch(() => console.log('  (no __dawEngine hook — is NEXT_PUBLIC_DAW_HOOKS on?)'))
await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
await page.waitForTimeout(6000)

const worklets = () => page.evaluate(() => window.__wl.made)
const liveWorklets = () => page.evaluate(() => window.__wl.liveCount())
const byName = () => page.evaluate(() => window.__wl.byName)
const heapMB = () => page.evaluate(() =>
  performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null)

const afterLoad = await worklets()
console.log(`after loading the project: ${afterLoad} worklets constructed, heap ${await heapMB()}MB\n`)

// ── 1. play / stop cycles ───────────────────────────────────────────────────
console.log(`── ${CYCLES} play/stop cycles ──`)
const perCycle = []
for (let i = 0; i < CYCLES; i++) {
  await page.evaluate(() => { void window.__dawEngine?.play(0) })   // never await: async, does not settle headlessly
  await page.waitForTimeout(5000)
  await page.evaluate(() => window.__dawEngine?.stop())
  await page.waitForTimeout(1200)
  const n = await worklets()
  perCycle.push(n)
  console.log(`  cycle ${i + 1}: ${n} worklets total (+${n - (perCycle[i - 1] ?? afterLoad)}), heap ${await heapMB()}MB`)
}

// ── 2. loop wraparound, which hits the same teardown far more often ─────────
console.log(`\n── a short loop, wrapping every ~2s, for 30s ──`)
const beforeLoop = await worklets()
await page.evaluate(() => {
  const e = window.__dawEngine
  if (!e) return
  e.loopEnabled = true; e.loopStart = 0; e.loopEnd = 4    // 4 beats ≈ 2s at 112bpm
  void e.play(0)
})
await page.waitForTimeout(30000)
const duringLoop = await worklets()
await page.evaluate(() => { const e = window.__dawEngine; if (e) { e.stop(); e.loopEnabled = false } })
await page.waitForTimeout(1500)

console.log(`  worklets before the loop: ${beforeLoop}`)
console.log(`  after 30s of looping:     ${duringLoop}   (+${duringLoop - beforeLoop})`)

// ── 3. does anything come back? ─────────────────────────────────────────────
const before = await heapMB()
await page.evaluate(async () => {
  if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 300)); window.gc() }
})
await page.waitForTimeout(2500)
const after = await heapMB()
console.log(`\nheap after forcing GC: ${before}MB -> ${after}MB`)
const stillLive = await liveWorklets()
console.log(`worklet NODES still reachable after GC: ${stillLive} of ${await worklets()} ever built`)
console.log(`\nby processor name:`)
for (const [k, v] of Object.entries(await byName()).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(v).padStart(5)}  ${k}`)
}

const cycleGrowth = perCycle.at(-1) - afterLoad
const perCycleAvg = cycleGrowth / CYCLES
const loopGrowth = duringLoop - beforeLoop

console.log(`\n${'='.repeat(60)}`)
console.log(`worklets built while loading:        ${afterLoad}`)
console.log(`worklets built per play/stop cycle:  ${perCycleAvg.toFixed(1)}  (${apolloTracks} Apollo tracks)`)
console.log(`worklets built by 30s of looping:    ${loopGrowth}`)

check('a play/stop cycle does not rebuild every Apollo engine',
  perCycleAvg < 1, `${perCycleAvg.toFixed(1)} per cycle`)
check('looping does not rebuild engines on every wraparound',
  loopGrowth < 5, `${loopGrowth} over ~15 wraparounds`)

console.log(failed
  ? '\n⚠️  Engines ARE being rebuilt. Whether that COSTS anything depends on\n' +
    '    whether the old ones are reclaimed — check the heap trend above and\n' +
    '    the CPU of a long session. Rebuild count is the leading indicator.'
  : '\nEngines are reused across stop and loop.')
await browser.close()
process.exit(0)   // reporting tool: the numbers are the output, not a gate
