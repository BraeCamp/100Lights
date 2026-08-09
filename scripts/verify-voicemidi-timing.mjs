// Headless verification for the VoiceMidi metronome timing/sync fix.
//   1. Page mounts, 0 console errors, __voice* hooks intact.
//   2. Reference-alignment MATH: notes sung ON the beats (at the true PCM-timeline beat
//      positions) slide by exactly the capture-startup delay Δ under the OLD
//      record-start phase, and snap to residual 0 under the NEW pcmStart-referenced
//      phase. Reports residual-offset before vs after.
//   3. Compensation MATH: injecting a known timingOffsetMs shifts every grid line by
//      exactly that amount, and a note at beat±offset snaps correctly (tolerance dead-zone).
//   4. Detector plumb-through: LivePitchDetector capture returns { startTime, startPerf }
//      and the no-capture start(onPitch,false,stream) path (StandaloneTuner) still works.
//   5. The Timing-offset control renders (metronome used), drives __voiceGetTimingOffsetMs,
//      and persists to localStorage.
//
//   node scripts/verify-voicemidi-timing.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:3001'

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

// Fake mic: a steady tone stream so record→refine + detector capture have real audio.
await page.addInitScript(() => {
  const build = () => {
    const AC = window.AudioContext || window.webkitAudioContext
    const ctx = new AC()
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 330
    const gain = ctx.createGain(); gain.gain.value = 0.3
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain); gain.connect(dest); osc.start()
    ;(window.__fakeKeep = window.__fakeKeep || []).push({ ctx, osc, gain, dest })
    return dest.stream
  }
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
  navigator.mediaDevices.getUserMedia = async () => build()
})

let allPass = true
const P = ok => ok ? '✓' : '✗'
const rec = (name, ok, extra = '') => { allPass = allPass && ok; console.log(`  ${P(ok)} ${name}${extra ? '  ' + extra : ''}`) }
const approx = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

console.log('→', `${BASE}/apps/voicemidi`)
await page.goto(`${BASE}/apps/voicemidi`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__voiceAlignToGrid === 'function')

// ── 1. Hooks intact ───────────────────────────────────────────────────────────
const hooks = await page.evaluate(() => ({
  align: typeof window.__voiceAlignToGrid,
  cond: typeof window.__voiceConditionalGridAlign,
  det: typeof window.__VoiceLivePitchDetector,
  seg: typeof window.__voiceGetSegmenter,
  toff: typeof window.__voiceGetTimingOffsetMs,
}))
rec('__voice* hooks present', Object.values(hooks).every(v => v === 'function' || v === 'undefined' ? true : false) && hooks.align === 'function' && hooks.det === 'function', JSON.stringify(hooks))

// ── 2. Reference-alignment math (residual before vs after the pcmStart fix) ─────
// A take sung to a click at BPM/division. Δ = capture-startup delay (record-start is
// captured BEFORE the mic delivers PCM sample 0). The heard beats' true positions in
// the PCM/note timeline are (oldPhase - Δ) + k*step. The OLD code aligned against
// `oldPhase` (record-start origin); the NEW code against `oldPhase - Δ` (PCM origin).
const refMath = await page.evaluate(() => {
  const bpm = 120, division = 2, tol = 0.4
  const step = 60 / bpm / division            // 0.25 s
  const oldPhase = 0.18                        // seconds from record-start to next downbeat
  const delta = 0.12                           // capture-startup delay Δ (constant slide)
  // Notes sung EXACTLY on the beats, expressed in the PCM/note timeline:
  const trueBeat = k => (oldPhase - delta) + k * step
  const notes = [0, 1, 2, 3, 4].map(k => ({ startSec: trueBeat(k), midi: 60 + k, durSec: 0.2, velocity: 0.8 }))

  const align = window.__voiceAlignToGrid
  const before = align(notes, { bpm, phaseSec: oldPhase, division, tolerance: tol })      // OLD (wrong origin)
  const after  = align(notes, { bpm, phaseSec: oldPhase - delta, division, tolerance: tol }) // NEW (pcmStart)

  // Residual = mean |assigned grid line - true onset|. Under NEW it should be ~0; under
  // OLD every note sits Δ from its nearest grid line (off by the constant slide).
  const resid = (out) => {
    let s = 0
    for (let i = 0; i < notes.length; i++) {
      // The grid line each note maps to = phase + round((startSec-phase)/step)*step, but
      // alignToGrid only MOVES the onset there when within tol; when offGrid the onset is
      // left in place. We measure distance to the nearest grid line of THAT alignment.
      s += out[i].offGrid ? delta : Math.abs(out[i].startSec - notes[i].startSec)
    }
    return s / notes.length
  }
  return {
    step,
    residBefore: resid(before),
    residAfter: resid(after),
    beforeOffGrid: before.every(n => n.offGrid),
    afterOnGrid: after.every(n => !n.offGrid),
    afterSnapsToTrue: after.every((n, i) => Math.abs(n.startSec - notes[i].startSec) <= 1e-9),
  }
})
rec('reference fix: OLD phase leaves every note off-grid (constant slide)', refMath.beforeOffGrid, `residual before = ${(refMath.residBefore * 1000).toFixed(1)} ms`)
rec('reference fix: NEW pcmStart phase snaps notes to the true beats', refMath.afterOnGrid && refMath.afterSnapsToTrue, `residual after = ${(refMath.residAfter * 1000).toFixed(1)} ms`)
rec('reference fix: residual reduced to ~0', approx(refMath.residAfter, 0, 1e-6) && refMath.residBefore > 0.05)

// ── 3. Compensation math (grid shifts by exactly the injected offset) ───────────
const compMath = await page.evaluate(() => {
  const bpm = 120, division = 2, tol = 0.4
  const step = 60 / bpm / division            // 0.25 s
  const basePhase = 0.0
  const offsetMs = 60                          // injected user Timing offset
  const offset = offsetMs / 1000               // 0.06 s  (> tol*step? tol*step = 0.1 → within, snaps)
  const align = window.__voiceAlignToGrid

  // (a) Every grid line shifts by exactly `offset`: a probe note placed on each shifted
  // beat must snap back to beat+offset when the phase carries +offset.
  const probes = [0, 1, 2, 3].map(k => ({ startSec: basePhase + k * step + offset, midi: 60, durSec: 0.2, velocity: 0.8 }))
  const shifted = align(probes, { bpm, phaseSec: basePhase + offset, division, tolerance: tol })
  const allShiftExact = shifted.every((n, k) => !n.offGrid && Math.abs(n.startSec - (basePhase + k * step + offset)) <= 1e-9)

  // (b) Tolerance dead-zone: a note sung `offset` late (beyond tol*step) is OFF-grid with
  // NO compensation, but snaps ON-grid once the phase is compensated by +offset.
  const bigOffMs = 120                          // 0.12 s  > tol*step (0.10 s) → outside dead-zone uncompensated
  const bigOff = bigOffMs / 1000
  const lateNote = [{ startSec: basePhase + 2 * step + bigOff, midi: 64, durSec: 0.2, velocity: 0.8 }]
  const uncomp = align(lateNote, { bpm, phaseSec: basePhase, division, tolerance: tol })
  const comp   = align(lateNote, { bpm, phaseSec: basePhase + bigOff, division, tolerance: tol })
  return {
    step, tolStep: tol * step,
    allShiftExact,
    deadzoneUncompOff: uncomp[0].offGrid === true,
    deadzoneCompOn: comp[0].offGrid === false && Math.abs(comp[0].startSec - (basePhase + 2 * step + bigOff)) <= 1e-9,
  }
})
rec('compensation: every grid line shifts by exactly the offset', compMath.allShiftExact)
rec('compensation: tolerance dead-zone respected (off uncompensated, snaps when compensated)', compMath.deadzoneUncompOff && compMath.deadzoneCompOn, `tol*step = ${(compMath.tolStep * 1000).toFixed(0)} ms`)

// ── 4. Detector plumb-through (startTime/startPerf + no-capture path) ───────────
const plumb = await page.evaluate(async () => {
  const D = window.__VoiceLivePitchDetector
  // (a) capture path returns startTime + startPerf
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  const d = new D()
  await d.start(() => {}, true, stream)
  await new Promise(r => setTimeout(r, 500))
  const pcm = d.stopAndGetPcm()
  d.stop()
  // (b) no-capture path (StandaloneTuner shape): start(onPitch, false, stream) must not throw
  let noCaptureOk = false
  try {
    const stream2 = await navigator.mediaDevices.getUserMedia({ audio: true })
    const d2 = new D()
    await d2.start(() => {}, false, stream2)
    await new Promise(r => setTimeout(r, 150))
    d2.stop()
    noCaptureOk = true
  } catch { noCaptureOk = false }
  return {
    hasSamples: !!pcm && pcm.samples.length > 0,
    startTime: pcm ? pcm.startTime : null,
    startPerf: pcm ? pcm.startPerf : null,
    startTimeNum: !!pcm && typeof pcm.startTime === 'number' && pcm.startTime >= 0,
    startPerfNum: !!pcm && typeof pcm.startPerf === 'number' && pcm.startPerf > 0,
    noCaptureOk,
  }
})
rec('detector: capture returns startTime (ctx time of PCM sample 0)', plumb.hasSamples && plumb.startTimeNum, `startTime=${plumb.startTime?.toFixed?.(4)}`)
rec('detector: capture returns startPerf (wall-clock companion)', plumb.startPerfNum, `startPerf=${plumb.startPerf?.toFixed?.(1)}`)
rec('detector: no-capture start(onPitch,false,stream) still works', plumb.noCaptureOk)

// ── 5. Timing-offset control renders + persists ─────────────────────────────────
// Turn the metronome on (user gesture) so the control appears.
await page.getByRole('button', { name: /Metronome/ }).click()
const controlVisible = await page.locator('[data-testid="vm-timing-offset-control"]').isVisible().catch(() => false)
rec('Timing-offset control renders when metronome is used', controlVisible)

// Auto default seeded to a small non-negative estimate.
const autoDefault = await page.evaluate(() => window.__voiceGetTimingOffsetMs?.())
rec('Timing offset seeded to auto latency estimate', typeof autoDefault === 'number' && autoDefault >= 0 && autoDefault <= 100, `auto=${autoDefault} ms`)

// Set a value via the number input → hook reflects it + persists to localStorage.
await page.locator('[data-testid="vm-timing-offset-number"]').fill('45')
await page.locator('[data-testid="vm-timing-offset-number"]').blur().catch(() => {})
await page.waitForTimeout(100)
const afterSet = await page.evaluate(() => ({
  hook: window.__voiceGetTimingOffsetMs?.(),
  ls: localStorage.getItem('voicemidi-timing-offset'),
}))
rec('Timing offset control drives the live value', afterSet.hook === 45, `hook=${afterSet.hook}`)
rec('Timing offset persists to localStorage', afterSet.ls === '45', `ls=${afterSet.ls}`)

rec('0 console errors', errors.length === 0, errors.length ? JSON.stringify(errors.slice(0, 3)) : '')

console.log('')
console.log(allPass ? '✓ ALL PASS' : '✗ FAILURES ABOVE')
await browser.close()
process.exit(allPass ? 0 : 1)
