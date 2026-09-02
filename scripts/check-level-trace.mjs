/**
 * A second-by-second trace of the master level, and of the voices behind it.
 *
 *   PORT=4680 node scripts/check-level-trace.mjs
 *
 * Brae: "It plays one chord then goes quiet, but still plays at about the same
 * speed."
 *
 * ⚠️ THE SPEED IS THE CLUE. The note scheduler runs on the main thread, so a
 * blocked main thread shows up as the playhead SLOWING. A playhead that keeps
 * perfect time while the sound stops means scheduling is fine and the notes are
 * going somewhere that does not sound — a dead engine, or voices that were
 * allocated and never released, which after one chord leaves nothing to
 * allocate.
 *
 * So this prints the level next to the beat, once a second: if the beat climbs
 * steadily while the level falls to nothing, that is the fault, and the shape of
 * the trace says which of the two it is.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = `http://localhost:${process.env.PORT || '4680'}`
const FIXTURE = process.env.FIXTURE
  || join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')
if (!existsSync(FIXTURE)) { console.log(`no fixture at ${FIXTURE}`); process.exit(1) }
const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 140)))

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
await page.waitForTimeout(6000)

await page.evaluate(() => {
  const e = window.__dawEngine
  const an = e.ctx.createAnalyser()
  an.fftSize = 2048
  ;(e.masterGain ?? e.master).connect(an)
  const buf = new Float32Array(an.fftSize)
  window.__peak = 0
  setInterval(() => {
    an.getFloatTimeDomainData(buf)
    let p = 0
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v }
    if (p > window.__peak) window.__peak = p
  }, 40)
})

console.log('\n  t     beat    peak     bar')
await page.evaluate(() => { void window.__dawEngine?.play(0) })

let silentRun = 0, firstSound = -1
for (let i = 1; i <= 14; i++) {
  await page.waitForTimeout(1000)
  const r = await page.evaluate(() => {
    const p = window.__peak
    window.__peak = 0
    return { p, beat: window.__dawEngine?.currentBeat ?? 0, playing: !!window.__dawEngine?.isPlaying }
  })
  const bar = '█'.repeat(Math.min(30, Math.round(r.p * 120)))
  console.log(`  ${String(i).padStart(2)}s  ${r.beat.toFixed(1).padStart(6)}  ${r.p.toFixed(4)}  ${bar}${r.playing ? '' : '  (STOPPED)'}`)
  if (r.p < 0.001) silentRun++
  else { silentRun = 0; if (firstSound < 0) firstSound = i }
}
await page.evaluate(() => window.__dawEngine?.stop())

console.log(`\n${'='.repeat(60)}`)
if (firstSound < 0) console.log('Never made a sound at all.')
else if (silentRun >= 3) console.log(`⚠️  Sound started at ${firstSound}s and then stopped for the last ${silentRun}s\n    while the transport kept running — the reported fault, reproduced.`)
else console.log('Sound throughout — this fixture does not reproduce it here.')

await browser.close()
process.exit(0)
