/**
 * Squeeze the machine until the studio breaks, and see what breaks first.
 *
 *   PORT=4681 node scripts/check-under-load.mjs
 *   PORT=4681 CPU=3 HEAP=2048 node scripts/check-under-load.mjs   # one setting
 *
 * Brae: "Continue to reduce the CPU and ram load until it has its problems so
 * that you can find the weak links. start with 1/3 cpu and 1/2 ram."
 *
 * ⚠️ THE RIGHT IDEA, BECAUSE A MACHINE THAT COPES TELLS YOU NOTHING. Every probe
 * here has been run on a fast, idle laptop and reported that everything is fine
 * — which it is, there. The fault needs pressure to appear, so this applies the
 * pressure deliberately and steps it up until something gives.
 *
 * CPU is throttled through the debugger, which slows the MAIN thread — the one
 * the note scheduler runs on. Heap is capped with V8's own limit. Both are the
 * shape of a slower or busier machine.
 *
 * What it reads, each second:
 *
 *   beat rate   the playhead against the wall clock. Below 1.0 the transport is
 *               falling behind, which is "it slows down".
 *   level       the master bus. Zero while the beat still climbs is "it goes
 *               quiet" — a different fault with a different fix.
 *   blocked     long tasks. The scheduler cannot run inside one.
 *   engines     live Apollo worklets, which no heap profiler can see.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = `http://localhost:${process.env.PORT || '4681'}`
const FIXTURE = process.env.FIXTURE
  || join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')
if (!existsSync(FIXTURE)) { console.log(`no fixture at ${FIXTURE}`); process.exit(1) }
const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject

// 8 cores / 16 GB here. "1/3 cpu" is a 3x throttle; "1/2 ram" is half the heap
// V8 would normally take. Escalating from there until it fails.
const STEPS = process.env.CPU
  ? [{ cpu: Number(process.env.CPU), heap: Number(process.env.HEAP || 2048) }]
  : [
      { cpu: 1, heap: 4096 },   // control
      { cpu: 3, heap: 2048 },   // Brae's starting point: 1/3 CPU, 1/2 RAM
      { cpu: 6, heap: 1024 },
      { cpu: 10, heap: 512 },
      { cpu: 20, heap: 256 },
    ]

const SECONDS = Number(process.env.SECONDS || 12)

async function run({ cpu, heap }) {
  const browser = await chromium.launch({
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--mute-audio',
      `--js-flags=--max-old-space-size=${heap}`,
    ],
  })
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e).slice(0, 100)))

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu })

  await page.addInitScript(() => {
    const w = window
    w.__u = { longTasks: 0, blocked: 0, worst: 0, procErrors: 0, made: 0 }
    try {
      new PerformanceObserver(l => {
        for (const e of l.getEntries()) {
          w.__u.longTasks++; w.__u.blocked += e.duration
          if (e.duration > w.__u.worst) w.__u.worst = e.duration
        }
      }).observe({ entryTypes: ['longtask'] })
    } catch { /* unsupported */ }
    const O = w.AudioWorkletNode
    if (O) {
      w.AudioWorkletNode = new Proxy(O, {
        construct(t, a, nt) {
          const n = Reflect.construct(t, a, nt)
          if (String(a[1]) === 'apollo-engine') { w.__u.made++; n.onprocessorerror = () => { w.__u.procErrors++ } }
          return n
        },
      })
    }
  })

  await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 180000 })
  await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
  await page.waitForTimeout(8000)

  await page.evaluate(() => {
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
    }, 40)
  })

  console.log(`\n── CPU 1/${cpu}, heap ${heap}MB ──`)
  console.log('   t    beat   beats/s   level    blocked  engines')
  await page.evaluate(() => { window.__u.blocked = 0; window.__u.longTasks = 0; void window.__dawEngine?.play(0) })

  let prevBeat = 0, silent = 0, slow = 0
  for (let i = 1; i <= SECONDS; i++) {
    await page.waitForTimeout(1000)
    const r = await page.evaluate(() => {
      const u = { ...window.__u }
      window.__u.blocked = 0; window.__u.longTasks = 0
      const p = window.__peak; window.__peak = 0
      const e = window.__dawEngine
      return { p, beat: e?.currentBeat ?? 0, playing: !!e?.isPlaying, blocked: Math.round(u.blocked), made: u.made, procErrors: u.procErrors }
    })
    const rate = r.beat - prevBeat
    prevBeat = r.beat
    // 112bpm ≈ 1.87 beats/s. Anything under ~70% of that is audibly dragging.
    if (rate < 1.3 && i > 1) slow++
    if (r.p < 0.001) silent++
    console.log(`  ${String(i).padStart(2)}s  ${r.beat.toFixed(1).padStart(6)}  ${rate.toFixed(2).padStart(7)}  ${r.p.toFixed(4)}  ${String(r.blocked).padStart(7)}ms  ${String(r.made).padStart(7)}${r.playing ? '' : '  STOPPED'}`)
  }
  const final = await page.evaluate(() => ({ ...window.__u }))
  await browser.close()

  const verdict = silent >= 3 ? 'WENT QUIET' : slow >= 3 ? 'SLOWED' : 'ok'
  console.log(`  → ${verdict}   engines built ${final.made}, processor errors ${final.procErrors}`
    + (errors.length ? `, page errors: ${errors[0]}` : ''))
  return { cpu, heap, verdict, made: final.made, procErrors: final.procErrors, silent, slow }
}

const results = []
for (const step of STEPS) {
  results.push(await run(step))
  if (results.at(-1).verdict !== 'ok') {
    console.log('\n⚠️  Broke here. Stepping no further — this is the weakest link to look at.')
    break
  }
}

console.log(`\n${'='.repeat(64)}`)
for (const r of results) {
  console.log(`  CPU 1/${String(r.cpu).padEnd(3)} heap ${String(r.heap).padEnd(5)}MB  ${r.verdict.padEnd(11)}`
    + `engines ${String(r.made).padStart(4)}  procErrors ${r.procErrors}`)
}
process.exit(0)
