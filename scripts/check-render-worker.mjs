/**
 * Does the render worker produce real audio without stalling the page?
 *
 *   PORT=4691 node scripts/check-render-worker.mjs
 *
 * The three things that decide whether freezing is viable at all:
 *
 *   ⚠️ IT MUST MAKE SOUND. A renderer that returns silence is worse than none —
 *   it would replace working live audio with nothing, and look like a fix.
 *
 *   ⚠️ IT MUST NOT BLOCK THE PAGE. This is the entire reason it is a worker.
 *   Auto-freeze was switched off in August because rendering inline stalled the
 *   main thread for eleven seconds; an eleven-second freeze is worse than the
 *   dropouts it cures. Measured by hammering the main thread with a timer while
 *   the render runs and watching for a gap.
 *
 *   ⚠️ IT MUST BE FASTER THAN REAL TIME, or rendering ahead of the playhead can
 *   never catch up.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = `http://localhost:${process.env.PORT || '4691'}`
const FIXTURE = join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')
if (!existsSync(FIXTURE)) { console.log(`no fixture at ${FIXTURE}`); process.exit(1) }
const PATCH = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  .dawProject.tracks.find(t => t.instrument?.type === 'apollo').instrument.params

let failed = 0
const check = (label, pass, extra = '') => {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({ args: ['--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 160)))
page.on('console', m => { if (m.type() === 'error') console.log('  console:', m.text().slice(0, 160)) })

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

const result = await page.evaluate(async ({ patch }) => {
  const SECONDS = 8
  const SR = 48000
  const events = []
  for (let b = 0; b < SECONDS * 2; b++) {
    for (let v = 0; v < 4; v++) {
      const t = b * 0.5
      events.push({ t, type: 'noteOn', note: 48 + v * 4, vel: 0.8 })
      events.push({ t: t + 0.45, type: 'noteOff', note: 48 + v * 4 })
    }
  }

  // ⚠️ A HEARTBEAT ON THE MAIN THREAD. If the render blocks it, these stop
  // arriving and the largest gap says for how long. This is the measurement
  // that August's inline render would have failed at eleven thousand ms.
  let last = performance.now()
  let worstGap = 0
  const beat = setInterval(() => {
    const now = performance.now()
    worstGap = Math.max(worstGap, now - last)
    last = now
  }, 10)

  const w = new Worker('/apollo/render-worker.js?v=probe-' + Date.now())
  const t0 = performance.now()
  const out = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker timed out')), 60000)
    w.onmessage = e => { clearTimeout(timer); resolve(e.data) }
    w.onerror = e => { clearTimeout(timer); reject(new Error(e.message || 'worker error')) }
    w.postMessage({ id: 1, job: { patch, events, seconds: SECONDS, sampleRate: SR } })
  }).catch(e => ({ ok: false, error: String(e.message || e) }))
  const wall = performance.now() - t0
  clearInterval(beat)
  w.terminate()

  if (!out.ok) return { error: out.error, worstGap: Math.round(worstGap) }

  const L = new Float32Array(out.left)
  let peak = 0, sounding = 0
  for (let i = 0; i < L.length; i++) {
    const a = Math.abs(L[i])
    if (a > peak) peak = a
    if (a > 0.002) sounding++
  }
  return {
    ok: true,
    peak: +peak.toFixed(4),
    soundingPct: Math.round((sounding / L.length) * 100),
    samples: L.length,
    expected: SECONDS * SR,
    workerMs: out.ms,
    wallMs: Math.round(wall),
    ratio: +(wall / 1000 / SECONDS).toFixed(3),
    worstGap: Math.round(worstGap),
  }
}, { patch: PATCH })

if (result.error) {
  console.log(`\n  worker error: ${result.error}`)
  check('the worker rendered', false)
} else {
  console.log(`\n  rendered ${result.samples} samples (expected ${result.expected})`)
  console.log(`  peak ${result.peak}, sounding ${result.soundingPct}% of the time`)
  console.log(`  took ${result.wallMs}ms of wall clock for 8s of audio (${result.ratio}x real time)`)
  console.log(`  worst main-thread gap during the render: ${result.worstGap}ms\n`)

  check('it produced audio, not silence', result.peak > 0.01, `peak ${result.peak}`)
  check('and the audio has notes in it, not a click',
    result.soundingPct > 20, `${result.soundingPct}% above the noise floor`)
  check('the buffer is the length that was asked for',
    Math.abs(result.samples - result.expected) < 200, `${result.samples} vs ${result.expected}`)
  // ⚠️ THE WHOLE REASON THIS IS A WORKER. Inline, this number was ~11000.
  check('the main thread kept running throughout',
    result.worstGap < 250, `worst gap ${result.worstGap}ms`)
  check('and it renders faster than real time',
    result.ratio < 1, `${result.ratio}x`)
}

console.log(failed ? `\n${failed} failing` : '\nrendering off the main thread works')
await browser.close()
process.exit(failed ? 1 : 0)
