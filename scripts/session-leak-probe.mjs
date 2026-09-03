/**
 * Does a long session leak — navigating, loading projects, with Light mounted?
 *
 *   PORT=4670 node scripts/session-leak-probe.mjs
 *
 * Brae: "seeing that Light lags in session too, I think it could be a memory
 * leak someplace."
 *
 * Two things make this worth measuring rather than assuming. Light is now
 * mounted in the ROOT layout so it survives navigation — which also means it
 * never unmounts, so anything it fails to clean up accumulates for the life of
 * the tab instead of being swept away by leaving the page. And loading a
 * project rebuilds the whole engine graph.
 *
 * Measures across repeated navigation + project loads: JS heap after a forced
 * GC, live DOM nodes, and how many event listeners are attached to window and
 * document — the classic accumulation that no heap graph makes obvious.
 */
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4670'}`
const ROUNDS = Number(process.env.ROUNDS || 6)

const trackId = 't1'
const proj = n => ({
  id: `p${n}`, name: `probe ${n}`, tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
  swing: 0, masterVolume: 0.8,
  tracks: [{
    id: trackId, name: 'Apollo', type: 'midi', color: '#8b5cf6',
    volume: 0.8, pan: 0, mute: false, solo: false, armed: false, height: 90,
    effects: [], instrument: { type: 'apollo', params: { version: 1 } },
  }],
  arrangementClips: [{
    kind: 'midi', id: 'c0', trackId, name: 'Clip', startBeat: 0, durationBeats: 4,
    notes: [0, 1, 2, 3].map(i => ({ id: `n${i}`, pitch: 60 + i, velocity: 100, startBeat: i, durationBeats: 0.5 })),
  }],
  clipEffects: [], returnTracks: [], automationLanes: [], sessionGrid: [], scenes: [], takeLanes: [],
  loopStart: 0, loopEnd: 4, loopEnabled: false,
})

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--js-flags=--expose-gc'],
})
const page = await browser.newPage()
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 120)))

// Count listeners by wrapping add/remove on the two shared targets everything
// reaches for. A listener that is added on mount and never removed is the
// classic session leak, and it never shows up as heap growth.
await page.addInitScript(() => {
  const w = window
  w.__l = { added: 0, removed: 0, byType: {} }
  for (const target of [w, w.document]) {
    const add = target.addEventListener.bind(target)
    const rem = target.removeEventListener.bind(target)
    target.addEventListener = function (type, ...rest) {
      w.__l.added++; w.__l.byType[type] = (w.__l.byType[type] || 0) + 1
      return add(type, ...rest)
    }
    target.removeEventListener = function (type, ...rest) {
      w.__l.removed++; w.__l.byType[type] = (w.__l.byType[type] || 0) - 1
      return rem(type, ...rest)
    }
  }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
await page.waitForTimeout(3000)

const sample = async () => {
  await page.evaluate(async () => {
    if (window.gc) { window.gc(); await new Promise(r => setTimeout(r, 300)); window.gc() }
  })
  return page.evaluate(() => ({
    heap: performance.memory ? +(performance.memory.usedJSHeapSize / 1048576).toFixed(1) : null,
    dom: document.getElementsByTagName('*').length,
    listeners: window.__l.added - window.__l.removed,
    added: window.__l.added,
  }))
}

console.log(`\nNavigating and loading projects, ${ROUNDS} rounds.\n`)
console.log('  round   heap    DOM nodes   live listeners')
const rows = []
for (let i = 0; i < ROUNDS; i++) {
  // A real session: load a project, play a little, walk around the app, come back.
  await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), proj(i))
  await page.waitForTimeout(1200)
  await page.evaluate(() => { void window.__dawEngine?.play(0) })
  await page.waitForTimeout(2500)
  await page.evaluate(() => window.__dawEngine?.stop())
  await page.waitForTimeout(600)

  // ⚠️ CLIENT-SIDE, never page.goto(). A full page load builds a new JavaScript
  // context, which resets exactly the accumulation being measured — and it is
  // also not what happens in the app, where Light survives navigation precisely
  // because the context is kept. One tab, for the whole run.
  await page.evaluate(async () => {
    for (const path of ['/projects', '/dashboard', '/create?modules=audio&audioMode=music']) {
      history.pushState({}, '', path)
      dispatchEvent(new PopStateEvent('popstate'))
      await new Promise(r => setTimeout(r, 900))
    }
  })
  await page.waitForTimeout(1200)

  const r = await sample()
  rows.push(r)
  console.log(`  ${String(i + 1).padStart(5)}   ${String(r.heap).padStart(5)}MB   ${String(r.dom).padStart(9)}   ${String(r.listeners).padStart(14)}`)
}

const first = rows[0], last = rows.at(-1)
console.log(`\n${'='.repeat(64)}`)
console.log(`heap      ${first.heap}MB -> ${last.heap}MB   (${(last.heap - first.heap).toFixed(1)}MB over ${ROUNDS} rounds)`)
console.log(`DOM       ${first.dom} -> ${last.dom}`)
console.log(`listeners ${first.listeners} -> ${last.listeners}`)
const grew = last.heap - first.heap
console.log(grew > first.heap * 0.5
  ? `\n⚠️  Heap grows across sessions — worth chasing.`
  : `\nNo runaway heap growth across ${ROUNDS} rounds of navigation and project loads.`)

// Which listener types are net-positive — the actual leak, by name.
const byType = await page.evaluate(() => window.__l.byType)
const leaked = Object.entries(byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1])
console.log(`\nlisteners still attached, by type:`)
for (const [k, v] of leaked.slice(0, 12)) console.log(`   ${String(v).padStart(4)}  ${k}`)

// One tab throughout, so these numbers are what a real session accumulates.
await browser.close()
process.exit(0)
