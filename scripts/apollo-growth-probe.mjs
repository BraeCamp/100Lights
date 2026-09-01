/**
 * Does one track get slower the longer it plays?
 *
 *   PORT=4670 node scripts/apollo-growth-probe.mjs
 *
 * apollo-attach-probe.mjs showed that a clip effect makes the note destination
 * per-NOTE, and Apollo keys one engine per destination — so a clip effect buys
 * one Helios polysynth per note played.
 *
 * This asks the question that decides how bad that is: are they RECLAIMED while
 * the transport runs? The per-note FX chain is torn down on a timer, but the
 * engine bound to it is held strongly in byCtx, and only apolloStopAll() — which
 * runs on stop, seek and loop wraparound — ever releases those. If nothing
 * releases them mid-play, the count grows for as long as you keep playing, which
 * is precisely "it gets slower and slower even with one track".
 */
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4670'}`
const SECONDS = Number(process.env.SECONDS || 40)

const trackId = 't-apollo'
const clips = []
for (let c = 0; c < 16; c++) {
  clips.push({
    kind: 'midi', id: `c${c}`, trackId, name: `Clip ${c}`,
    startBeat: c * 4, durationBeats: 4,
    notes: [0, 1, 2, 3].map(i => ({
      id: `n${c}_${i}`, pitch: 60 + i, velocity: 100, startBeat: i, durationBeats: 0.5,
    })),
  })
}
const proj = {
  id: 'p1', name: 'growth', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  swing: 0, masterVolume: 0.8,
  tracks: [{
    id: trackId, name: 'Apollo', type: 'midi', color: '#8b5cf6',
    volume: 0.8, pan: 0, mute: false, solo: false, armed: false, height: 90,
    effects: [], instrument: { type: 'apollo', params: { version: 1 } },
  }],
  arrangementClips: clips,
  // The one ingredient that makes the destination per-note.
  clipEffects: [{ id: 'ce1', trackId, type: 'lowpass', startBeat: 0, durationBeats: 256, amount: 0.5 }],
  returnTracks: [], automationLanes: [], sessionGrid: [], scenes: [], takeLanes: [],
  loopStart: 0, loopEnd: 64, loopEnabled: false,
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--js-flags=--expose-gc'],
})
const page = await browser.newPage()
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 120)))

await page.addInitScript(() => {
  const w = window
  w.__n = { made: 0, live: new Set() }
  const Orig = w.AudioWorkletNode
  if (Orig) {
    w.AudioWorkletNode = new Proxy(Orig, {
      construct(t, a, nt) {
        const node = Reflect.construct(t, a, nt)
        if (String(a[1]) === 'apollo-engine') { w.__n.made++; w.__n.live.add(new WeakRef(node)) }
        return node
      },
    })
  }
  w.__n.liveCount = () => {
    let n = 0
    for (const r of w.__n.live) { if (r.deref()) n++; else w.__n.live.delete(r) }
    return n
  }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), proj)
await page.waitForTimeout(3000)
await page.evaluate(() => { window.__n.made = 0 })

console.log(`\nONE Apollo track, 16 clips, one clip effect. Playing continuously.\n`)
console.log(`   time    engines built   still live   heap`)
await page.evaluate(() => { void window.__dawEngine?.play(0) })

const rows = []
for (let s = 5; s <= SECONDS; s += 5) {
  await page.waitForTimeout(5000)
  const r = await page.evaluate(() => ({
    made: window.__n.made,
    live: window.__n.liveCount(),
    heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
  }))
  rows.push(r)
  console.log(`   ${String(s).padStart(3)}s   ${String(r.made).padStart(9)}   ${String(r.live).padStart(10)}   ${r.heap}MB`)
}
await page.evaluate(() => window.__dawEngine?.stop())
await page.waitForTimeout(1500)

// Does stopping actually give them back?
const afterStop = await page.evaluate(async () => {
  if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 400)); window.gc() }
  return { live: window.__n.liveCount(), made: window.__n.made }
})
console.log(`\n   after stop + forced GC:  ${afterStop.live} still live of ${afterStop.made} built`)

const first = rows[0], last = rows.at(-1)
console.log(`\n${'='.repeat(64)}`)
console.log(`engines live at ${5}s:  ${first.live}`)
console.log(`engines live at ${SECONDS}s: ${last.live}`)
console.log(last.live > first.live * 1.5
  ? `\n⚠️  LIVE ENGINES GROW WHILE THE TRANSPORT RUNS. Each is a full Helios\n`
    + `    polysynth rendering every 128-sample quantum, so the DSP load climbs\n`
    + `    for as long as you keep playing — on ONE track. Nothing releases them\n`
    + `    until stop, seek or a loop wraparound calls apolloStopAll().`
  : `\nLive engine count is stable while playing.`)

await browser.close()
process.exit(0)
