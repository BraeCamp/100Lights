/**
 * Is there actually any SIGNAL, and when?
 *
 *   PORT=4678 node scripts/check-audio-output.mjs
 *
 * Brae: "It still starts silent."
 *
 * ⚠️ EVERY OTHER PROBE HERE COUNTS THINGS. Worklets built, engines live, tasks
 * blocked — all of which can look perfect while the mix is silent, because none
 * of them listen. This one taps the master bus and reads the level, which is
 * the only measurement that can tell "playing" from "making sound".
 *
 * Runs the sequence that matters: first play, stop, play again. An engine that
 * survives a stop is new behaviour, so a second play going quiet would be a
 * fault introduced by keeping it.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = `http://localhost:${process.env.PORT || '4678'}`
const FIXTURE = process.env.FIXTURE
  || join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')
if (!existsSync(FIXTURE)) { console.log(`no fixture at ${FIXTURE}`); process.exit(1) }
const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject

let failed = 0
const check = (label, pass, extra = '') => {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const page = await browser.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 150)))

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
await page.waitForTimeout(6000)

// Tap the master. Peak, not RMS: a sparse arrangement is mostly silence between
// hits, and an average would report a real mix as quiet.
const tapped = await page.evaluate(() => {
  const e = window.__dawEngine
  const node = e?.masterGain ?? e?.master ?? null
  if (!node || !e?.ctx) return false
  const an = e.ctx.createAnalyser()
  an.fftSize = 2048
  node.connect(an)                       // a tap, not a re-route: nothing else changes
  const buf = new Float32Array(an.fftSize)
  window.__peak = 0
  window.__ctxState = () => e.ctx.state
  setInterval(() => {
    an.getFloatTimeDomainData(buf)
    let p = 0
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v }
    if (p > window.__peak) window.__peak = p
  }, 50)
  return true
})
if (!tapped) { console.log('could not reach the master bus'); await browser.close(); process.exit(1) }

const listen = async (label, seconds) => {
  await page.evaluate(() => { window.__peak = 0 })
  await page.waitForTimeout(seconds * 1000)
  const r = await page.evaluate(() => ({ peak: window.__peak, state: window.__ctxState(), beat: window.__dawEngine?.currentBeat }))
  console.log(`  ${label.padEnd(26)} peak ${r.peak.toFixed(4)}   ctx ${r.state}   beat ${typeof r.beat === 'number' ? r.beat.toFixed(1) : '?'}`)
  return r
}

console.log('\nListening to the master bus.\n')
await page.evaluate(() => { void window.__dawEngine?.play(0) })
const first2 = await listen('first play, 0-2s', 2)
const first6 = await listen('first play, 2-6s', 4)

await page.evaluate(() => window.__dawEngine?.stop())
await page.waitForTimeout(1200)

await page.evaluate(() => { void window.__dawEngine?.play(0) })
const second2 = await listen('second play, 0-2s', 2)
const second6 = await listen('second play, 2-6s', 4)
await page.evaluate(() => window.__dawEngine?.stop())

const AUDIBLE = 0.001
console.log('')
check('the first play makes sound in its first two seconds', first2.peak > AUDIBLE, first2.peak.toFixed(4))
check('and keeps making sound after that', first6.peak > AUDIBLE, first6.peak.toFixed(4))
// ⚠️ Engines now survive a stop, so this is the case that change could break.
check('a SECOND play still makes sound', second2.peak > AUDIBLE, second2.peak.toFixed(4))
check('and keeps going', second6.peak > AUDIBLE, second6.peak.toFixed(4))

// ⚠️ NON-ZERO IS NOT ENOUGH. When engines survived a stop but their released
// entries were still handed out, SOME tracks were scheduled onto a dead engine
// and the mix came back at half level — audible, and wrong, and invisible to
// every check that only asks whether there is any sound at all.
const ratio = first2.peak > 0 ? second2.peak / first2.peak : 0
check('the second play is as loud as the first — no track lost',
  ratio > 0.7, `second/first = ${ratio.toFixed(2)}`)

console.log(failed ? `\n${failed} failing` : '\nthere is signal throughout')
await browser.close()
process.exit(failed ? 1 : 0)
