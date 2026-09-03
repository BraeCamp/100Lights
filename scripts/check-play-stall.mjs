/**
 * Why does audio stop a second or two after pressing play?
 *
 *   PORT=4674 node scripts/check-play-stall.mjs
 *
 * Brae: "it still slows and stops playing audio after a few seconds, usually
 * only playing one chord or half of a chord before the audio cuts out and it
 * begins to slow down."
 *
 * ⚠️ ONE CHORD THEN SILENCE IS NOT GRADUAL LOAD. Something stops, and the two
 * ways that happens are very different:
 *
 *   the PROCESSOR dies   an uncaught throw in an AudioWorklet's process() ends
 *                        it permanently and silently. Audio from that engine
 *                        never comes back, however quiet the song gets.
 *
 *   the SCHEDULER stalls the note scheduler runs on the MAIN thread. Block that
 *                        thread and nothing new is scheduled — what was already
 *                        queued finishes, and then silence, while the page also
 *                        feels slow. A chord's worth of queue is about right.
 *
 * They need opposite fixes, so this tells them apart: processor errors on one
 * side, main-thread long tasks on the other, with the engine count alongside
 * because building engines is main-thread work.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = `http://localhost:${process.env.PORT || '4674'}`
const FIXTURE = process.env.FIXTURE
  || join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')
if (!existsSync(FIXTURE)) { console.log(`no fixture at ${FIXTURE}`); process.exit(1) }
const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const page = await browser.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 160)))
page.on('console', m => {
  const t = m.text()
  if (/error|fail|throw|processor/i.test(t)) console.log('  console:', t.slice(0, 160))
})

await page.addInitScript(() => {
  const w = window
  w.__s = { made: 0, procErrors: 0, longTasks: [], blockedMs: 0 }

  // ⚠️ Long tasks are the main thread not answering. Anything over 50ms is one;
  // the scheduler cannot run during them, and neither can anything else.
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries()) {
        w.__s.longTasks.push(Math.round(e.duration))
        w.__s.blockedMs += e.duration
      }
    }).observe({ entryTypes: ['longtask'] })
  } catch { /* not supported */ }

  const Orig = w.AudioWorkletNode
  if (Orig) {
    w.AudioWorkletNode = new Proxy(Orig, {
      construct(t, a, nt) {
        const node = Reflect.construct(t, a, nt)
        if (String(a[1]) === 'apollo-engine') {
          w.__s.made++
          // A processor that throws is gone for good — count it loudly.
          node.onprocessorerror = () => { w.__s.procErrors++ }
        }
        return node
      },
    })
  }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
await page.waitForTimeout(6000)
await page.evaluate(() => { window.__s.made = 0; window.__s.longTasks = []; window.__s.blockedMs = 0 })

console.log('\nPressing play. Sampling every second.\n')
console.log('  t     engines  proc errors  blocked on main thread   worst task')
await page.evaluate(() => { void window.__dawEngine?.play(0) })

for (let i = 1; i <= 12; i++) {
  await page.waitForTimeout(1000)
  const s = await page.evaluate(() => {
    const r = { ...window.__s, playing: !!window.__dawEngine?.isPlaying, beat: window.__dawEngine?.currentBeat }
    window.__s.longTasks = []; window.__s.blockedMs = 0
    return r
  })
  const worst = s.longTasks.length ? Math.max(...s.longTasks) : 0
  console.log(`  ${String(i).padStart(2)}s   ${String(s.made).padStart(7)}  ${String(s.procErrors).padStart(11)}  `
    + `${String(Math.round(s.blockedMs)).padStart(16)}ms  ${String(worst).padStart(9)}ms`
    + `   beat ${typeof s.beat === 'number' ? s.beat.toFixed(1) : '?'}${s.playing ? '' : '  (STOPPED)'}`)
}

const final = await page.evaluate(() => ({ made: window.__s.made, procErrors: window.__s.procErrors }))
console.log(`\n${'='.repeat(72)}`)
console.log(`engines built during play: ${final.made}`)
console.log(`processors that died:      ${final.procErrors}`)
console.log(final.procErrors > 0
  ? '\n⚠️  A worklet processor THREW. That engine is silent for good — this is the\n'
    + '    cut-out, and no amount of reducing load will bring it back.'
  : '\nNo processor died — so the cut-out is the main thread stalling, and the\n'
    + 'blocked-ms column above is where the scheduler could not run.')

await browser.close()
process.exit(0)
