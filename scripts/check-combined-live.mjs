// Does a song sound the SAME combined as it does live?
//
//   node scripts/check-combined-live.mjs <song.cfproj> [--url=http://localhost:4618]
//
// Combining swaps a synthesised performance for a pre-rendered buffer, and it is
// supposed to be inaudible. Twice now it has not been:
//
//   • clip-effect bars were dropped entirely by the combined path, so every pan
//     walk, filter sweep and drive bar vanished the moment a render landed
//   • clips were evicted from the cache and quietly fell back to live
//
// Both changed how a finished song sounded, and both were invisible from the
// outside because playback carried on regardless. This check makes that class of
// bug loud: play each track soloed, first live and then combined, and compare
// level and spectral balance. A real difference means combining is altering the
// music rather than just making it cheaper.
import { readFileSync } from 'fs'
import { chromium } from '../node_modules/playwright/index.mjs'

const args = process.argv.slice(2)
const file = args.find(a => !a.startsWith('--'))
const url = (args.find(a => a.startsWith('--url=')) ?? '--url=http://localhost:4618').split('=')[1]
const atBeat = Number((args.find(a => a.startsWith('--beat=')) ?? '--beat=64').split('=')[1])
if (!file) { console.error('usage: check-combined-live.mjs <song.cfproj> [--url=…] [--beat=N]'); process.exit(2) }

// How far apart the two can drift before it counts. Renders are not bit-exact
// and the analyser samples asynchronously, so a few percent is noise.
const DB_TOLERANCE = 2.5      // level, in dB
const BAND_TOLERANCE = 8      // share of energy in a band, in percentage points

const cf = JSON.parse(readFileSync(file, 'utf8'))
const dp = cf.dawProject ?? cf
const browser = await chromium.launch({ channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 160)))

async function boot() {
  await page.goto(`${url}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.evaluate(() => localStorage.setItem('100lights-ui-tier', 'full'))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__dawDispatch, { timeout: 180000 })
  await page.waitForTimeout(2000)
  await page.click('body')
  await page.evaluate(() => new Promise(res => { const r = indexedDB.deleteDatabase('apollo-combines'); r.onsuccess = r.onerror = r.onblocked = () => res() }))
  await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), dp)
  // LOAD_PROJECT goes through React state, so the snapshot still holds the OLD
  // project for a moment. Reading it too early gives zero tracks — and a check
  // that finds nothing to look at reports a cheerful pass, which is worse than
  // having no check at all. Wait for the project to actually land.
  await page.waitForFunction(
    n => (window.__dawSnapshot?.()?.project?.tracks?.length ?? 0) >= n,
    (dp.tracks ?? []).length,
    { timeout: 60000 },
  )
}

/** Solo one track and measure level + where its energy sits. */
async function measure(trackName, beat) {
  return page.evaluate(async ([name, b]) => {
    const p = window.__dawSnapshot().project
    for (const t of p.tracks) window.__dawDispatch({ type: 'UPDATE_TRACK', trackId: t.id, patch: { solo: t.name === name } })
    await new Promise(r => setTimeout(r, 350))
    const e = window.__daw, an = e.masterAnalyser
    an.fftSize = 8192
    const freq = new Float32Array(an.frequencyBinCount)
    const time = new Float32Array(an.fftSize)
    const acc = new Float64Array(an.frequencyBinCount)
    let sum = 0, n = 0, frames = 0
    e.play(b)
    const t0 = performance.now()
    while (performance.now() - t0 < 14000) {
      an.getFloatFrequencyData(freq); an.getFloatTimeDomainData(time)
      for (let i = 0; i < freq.length; i++) acc[i] += Math.pow(10, freq[i] / 20)
      for (let i = 0; i < time.length; i++) { sum += time[i] * time[i]; n++ }
      frames++
      await new Promise(r => setTimeout(r, 60))
    }
    e.stop()
    const hzPer = e.ctx.sampleRate / 2 / acc.length
    const band = (lo, hi) => { let s = 0; for (let i = 0; i < acc.length; i++) { const f = i * hzPer; if (f >= lo && f < hi) s += acc[i] / frames } return s }
    const bands = [band(20, 120), band(120, 500), band(500, 2000), band(2000, 20000)]
    const tot = bands.reduce((a, x) => a + x, 0) || 1
    const rms = Math.sqrt(sum / n)
    return { db: +(20 * Math.log10(Math.max(1e-9, rms))).toFixed(1), bands: bands.map(x => +(x / tot * 100).toFixed(1)) }
  }, [trackName, beat])
}

await boot()
const names = await page.evaluate(() => window.__dawSnapshot().project.tracks.map(t => t.name))
if (!names.length) {
  console.error('FAIL no tracks found — the project did not load, so nothing was checked')
  await browser.close()
  process.exit(2)
}

// LIVE first — measure before combining has had a chance to land.
const live = {}
for (const n of names) live[n] = await measure(n, atBeat)

// Then let it combine fully and measure again.
await page.evaluate(() => window.__daw.stop())
for (let i = 0; i < 300; i++) {
  const s = await page.evaluate(() => window.__combineStats?.() ?? null)
  if (s && s.inFlight === 0 && s.queued === 0 && s.ready > 0) break
  await page.waitForTimeout(500)
}
const stats = await page.evaluate(() => window.__combineStats())
const comb = {}
for (const n of names) comb[n] = await measure(n, atBeat)

console.log(`combined-vs-live at beat ${atBeat}   (${stats.ready} clips combined)\n`)
console.log('track      level live → combined      energy 20-120 / 120-500 / 500-2k / 2k+   verdict')
let bad = 0
for (const n of names) {
  const L = live[n], C = comb[n]
  const dDb = Math.abs(C.db - L.db)
  const dBand = Math.max(...L.bands.map((v, i) => Math.abs(v - C.bands[i])))
  const ok = dDb <= DB_TOLERANCE && dBand <= BAND_TOLERANCE
  if (!ok) bad++
  const bands = L.bands.map((v, i) => `${String(v).padStart(5)}→${String(C.bands[i]).padStart(5)}`).join(' ')
  console.log(`  ${n.padEnd(8)} ${String(L.db).padStart(6)} → ${String(C.db).padStart(6)} dB   ${bands}   ${ok ? 'ok' : `DIFFERS (${dDb.toFixed(1)}dB, ${dBand.toFixed(1)}pt)`}`)
}
console.log()
console.log(bad === 0
  ? 'PASS combining does not change how any track sounds'
  : `FAIL ${bad} track(s) sound different once combined`)
await browser.close()
process.exit(bad === 0 ? 0 : 1)
