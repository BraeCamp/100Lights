#!/usr/bin/env node
/**
 * Where does the main thread actually go?
 *
 *   SLOW=3 PORT=4704 node scripts/profile-cpu.mjs
 *
 * Brae: "Is the problem perhaps adjacent to loading? Can you look around and
 * see what causes cpu spikes?"
 *
 * Every previous answer to "the studio is slow" was reasoned from the loader
 * outward, and each one was wrong in a new way. This does the opposite: it
 * takes a V8 CPU profile of a realistic session and reports what actually
 * burned the samples, ranked, with no theory attached.
 *
 * Three phases are profiled separately, because they are different problems and
 * averaging them hides all three:
 *
 *   LOAD   — LOAD_PROJECT to settled. Instrument warm-up, sample fetch/decode,
 *            React mount. Nothing is playing and nothing should be baking.
 *   IDLE   — sitting still afterwards. Anything here is pure waste: a rAF loop
 *            that never parks, a subscription re-rendering the editor, a timer.
 *   PLAY   — the transport running. Note scheduling, meters, playhead paint.
 *
 * Self time, not total: total time blames whoever is highest on the stack, so
 * everything looks like it is React's fault. Self time says which function's
 * own code ran.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'
import { slowDown, slowLabel } from './lib/slow-browser.mjs'
import { makeTrack, makeClip, makeNotes } from './lib/daw-fixture.mjs'

const BASE = `http://localhost:${process.env.PORT || '4700'}`
const TRACKS = Number(process.env.TRACKS || 6)
const CLIPS = Number(process.env.CLIPS || 4)
const { initPatch } = await importTs('lib/apollo/patch.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await slowDown(page)
const cdp = await page.context().newCDPSession(page)
await cdp.send('Profiler.enable')
await cdp.send('Profiler.setSamplingInterval', { interval: 200 })   // 0.2ms — fine enough to see short spikes

page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })

// Dismiss the first-run dialog, or the studio is not really mounted.
const dlg = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
if (await dlg.count()) {
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Choose your studio setup"]')
    const b = d && [...d.querySelectorAll('button,div[role=button]')].find(e => /Everything/i.test(e.textContent || ''))
    b?.click()
  })
  await dlg.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
}
await page.waitForTimeout(1500)

/** Flatten a V8 profile into self-time per function, in ms. */
function selfTime(profile) {
  const byId = new Map(profile.nodes.map(n => [n.id, n]))
  const hits = new Map()
  // timeDeltas[i] is the time BEFORE samples[i]; attribute it to that sample.
  for (let i = 0; i < profile.samples.length; i++) {
    const id = profile.samples[i]
    const dt = (profile.timeDeltas[i] ?? 0) / 1000        // µs -> ms
    hits.set(id, (hits.get(id) ?? 0) + dt)
  }
  const rows = []
  for (const [id, ms] of hits) {
    const n = byId.get(id)
    if (!n) continue
    const f = n.callFrame
    let name = f.functionName || '(anonymous)'
    if (name === '(program)' || name === '(idle)' || name === '(root)' || name === '(garbage collector)') {
      name = name.replace(/[()]/g, '')
    }
    const url = (f.url || '').replace(/^https?:\/\/[^/]+/, '')
    rows.push({ name, where: url ? `${url}:${f.lineNumber + 1}` : '', ms })
  }
  // Merge by function identity — one function inlined at several call sites
  // appears as several nodes and each looks small.
  const merged = new Map()
  for (const r of rows) {
    const k = `${r.name}|${r.where}`
    merged.set(k, (merged.get(k) ?? 0) + r.ms)
  }
  return [...merged.entries()]
    .map(([k, ms]) => ({ label: k.split('|')[0], where: k.split('|')[1], ms }))
    .sort((a, b) => b.ms - a.ms)
}

async function profile(label, body) {
  await cdp.send('Profiler.start')
  const t0 = Date.now()
  const extra = await body()
  const wall = Date.now() - t0
  const { profile: p } = await cdp.send('Profiler.stop')
  const rows = selfTime(p)
  const busy = rows.filter(r => !/^(idle|program|root)$/.test(r.label)).reduce((n, r) => n + r.ms, 0)
  console.log(`\n── ${label} ── ${(wall / 1000).toFixed(1)}s wall, ${(busy / 1000).toFixed(1)}s on the main thread (${Math.round(busy / wall * 100)}% busy)`)
  if (extra) console.log(`   ${extra}`)
  for (const r of rows.filter(r => !/^(idle|program|root)$/.test(r.label)).slice(0, 14)) {
    if (r.ms < 1) continue
    console.log(`   ${String(Math.round(r.ms)).padStart(6)}ms  ${r.label.slice(0, 42).padEnd(42)} ${r.where.slice(-52)}`)
  }
  return { busy, wall }
}

// A song shaped like one someone would actually build.
const patch = initPatch()
for (const o of patch.oscs) { o.enabled = true; o.unison = 2 }
patch.filters[0] = { ...patch.filters[0], enabled: true, type: 'lp12', cutoff: 0.55 }
patch.fxMain = [{ id: 'fx-reverb', type: 'reverb', enabled: true, mix: 0.3, params: {} }]

const tracks = [], clips = []
for (let t = 0; t < TRACKS; t++) {
  const id = `t${t}`
  tracks.push(makeTrack({ id, name: `T${t}`, instrument: { type: 'apollo', params: JSON.parse(JSON.stringify(patch)) } }))
  for (let c = 0; c < CLIPS; c++) {
    clips.push(makeClip({
      id: `c${t}-${c}`, trackId: id, name: `c${t}-${c}`,
      startBeat: c * 16, durationBeats: 16, notes: makeNotes(12, { step: 1.25, length: 1 }),
    }))
  }
}
const project = { ...defaultProject(), tempo: 110, timeSignatureNum: 4, tracks, arrangementClips: clips }

console.log(`machine: ${slowLabel()}`)
console.log(`song: ${TRACKS} Apollo tracks x ${CLIPS} clips = ${clips.length} clips`)

await page.evaluate(() => window.__clearCombined?.())

const load = await profile('LOAD  (project → settled, nothing playing)', async () => {
  await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)
  await page.waitForTimeout(12000)
  const s = await page.evaluate(() => window.__sampleStats?.() ?? null)
  return s ? `samples: asked ${s.asked}, decoded ${s.decoded}, reused ${s.reused}, ${s.ms}ms (worst ${s.worstMs}ms)` : ''
})

const idle = await profile('IDLE  (sitting still — anything here is waste)', async () => {
  await page.waitForTimeout(10000)
  const st = await page.evaluate(() => window.__combineStats?.() ?? null)
  return st ? `combine: ready ${st.ready}, passes ${st.batches}, phase ${st.progress?.phase}` : ''
})

const play = await profile('PLAY  (transport running)', async () => {
  await page.evaluate(async () => {
    try { await window.__dawEngine?.ctx?.resume?.() } catch { /* already running */ }
    window.__dawEngine?.play?.()
  })
  await page.waitForTimeout(12000)
  await page.evaluate(() => window.__dawEngine?.stop?.())
  return ''
})

console.log(`\nbusy share — load ${Math.round(load.busy / load.wall * 100)}%, idle ${Math.round(idle.busy / idle.wall * 100)}%, play ${Math.round(play.busy / play.wall * 100)}%`)
console.log('IDLE should be near zero. Anything large there runs forever, on every song.')
await browser.close()
