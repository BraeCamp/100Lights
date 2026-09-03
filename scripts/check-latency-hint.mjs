/**
 * Does a bigger audio buffer stop the dropouts?
 *
 *   PORT=4689 node scripts/check-latency-hint.mjs
 *
 * Brae: "It plays one chord then goes quiet" in Brave, "Still works in Safari."
 *
 * ⚠️ THE BUFFER IS THE DIFFERENCE. The studio asked for latencyHint
 * 'interactive', which means the SMALLEST buffer the device will give — the
 * least time to finish rendering each block before its deadline. Apollo needs
 * ~0.72 of that budget on eight tracks with the machine idle, so there is
 * almost no slack; Safari's audio path absorbs the jitter and Chromium's does
 * not. Same code, same song, two outcomes.
 *
 * This plays the same song under each setting in the SAME browser and counts
 * the seconds that come back silent while the transport is still running. That
 * is the dropout, measured, rather than inferred from a bug report.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = `http://localhost:${process.env.PORT || '4689'}`
const FIXTURE = join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')
if (!existsSync(FIXTURE)) { console.log(`no fixture at ${FIXTURE}`); process.exit(1) }
const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject

const SECONDS = Number(process.env.SECONDS || 12)
// ⚠️ Throttled on purpose. An idle laptop hides this — the whole complaint is
// about a machine that is busy, which every real one is.
const CPU = Number(process.env.CPU || 4)

async function trial(hint) {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
  const page = await browser.newPage()
  page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 120)))
  await page.addInitScript(h => {
    try { localStorage.setItem('100l.latency', h) } catch { /* ignore */ }
  }, String(hint))

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })

  await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 180000 })
  await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
  await page.waitForTimeout(7000)

  const info = await page.evaluate(() => {
    const e = window.__dawEngine
    const an = e.ctx.createAnalyser(); an.fftSize = 1024
    ;(e.masterGain ?? e.master).connect(an)
    const buf = new Float32Array(an.fftSize)
    window.__peak = 0
    setInterval(() => {
      an.getFloatTimeDomainData(buf)
      let p = 0
      for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v }
      if (p > window.__peak) window.__peak = p
    }, 25)
    return { base: +(e.ctx.baseLatency ?? 0).toFixed(4), rate: e.ctx.sampleRate }
  })

  await page.evaluate(() => { void window.__dawEngine?.play(0) })
  let silent = 0, prev = 0, stalled = 0
  const levels = []
  for (let i = 1; i <= SECONDS; i++) {
    await page.waitForTimeout(1000)
    const r = await page.evaluate(() => {
      const p = window.__peak; window.__peak = 0
      return { p, beat: window.__dawEngine?.currentBeat ?? 0 }
    })
    levels.push(r.p)
    if (r.p < 0.002) silent++
    if (i > 1 && r.beat - prev < 1.3) stalled++
    prev = r.beat
  }
  await browser.close()
  const spark = levels.map(v => v < 0.002 ? '·' : v < 0.05 ? '▁' : v < 0.12 ? '▄' : '█').join('')
  return { silent, stalled, base: info.base, spark }
}

console.log(`\nSame song, same browser, CPU throttled ${CPU}x. Buffer setting varied.\n`)
console.log('  latencyHint    buffer     silent secs   dragging secs   level over time')
for (const hint of ['interactive', 'balanced', 'playback']) {
  const r = await trial(hint)
  console.log(`  ${hint.padEnd(14)} ${String(r.base).padEnd(9)} ${String(r.silent).padStart(11)} ${String(r.stalled).padStart(15)}   ${r.spark}`)
}
console.log('\n· = silence while the transport was still running. That is the dropout.')
process.exit(0)
