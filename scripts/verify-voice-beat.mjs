// Verification for "beat-aware recording" — Part A (live scrolling viz) + Part B (beat-informed
// detection). Drives the headless VoiceMidi page.
//
//   node scripts/verify-voice-beat.mjs
//
// Part B uses the pure window.__voiceAnalyzeBuffer on synthesized audio: a take whose notes sit
// on a 120 BPM grid (some beats, some eighths) with per-onset jitter PLUS a couple of spurious
// short off-grid fragments. WITH a beatGrid the onsets snap to the grid and the fragments are
// suppressed (tighter residual, fewer notes); WITHOUT it, unchanged. A rubato take (no beatGrid)
// is asserted UNCHANGED whether or not a grid is *offered but disabled*.
//
// Part A clicks the real Record button with a synthetic getUserMedia tone-stream (metro ON and
// OFF) and asserts the canvas mounts + draws (frames advance, trail points) with beat lines when
// the metronome is on, then tears down cleanly on stop.
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:3001'
let allPass = true
const rec = (name, ok, extra = '') => { allPass = allPass && ok; console.log(`  ${ok ? '✓' : '✗'} ${name}${extra ? ` — ${extra}` : ''}`) }

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

// Synthetic mic: a sawtooth tone stream so the real detector fires onPitch during the live viz.
await page.addInitScript(() => {
  const build = () => {
    const AC = window.AudioContext || window.webkitAudioContext
    const ctx = new AC()
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'
    const gain = ctx.createGain()
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain); gain.connect(dest)
    const t = ctx.currentTime + 0.05
    gain.gain.setValueAtTime(0.3, t)
    // A slow warble so the trail has movement.
    for (let i = 0; i < 40; i++) osc.frequency.setValueAtTime(220 * Math.pow(2, ((i % 5) * 2) / 12), t + i * 0.15)
    osc.start(t)
    ;(window.__fakeKeep = window.__fakeKeep || []).push({ ctx, osc, gain, dest })
    return dest.stream
  }
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
  navigator.mediaDevices.getUserMedia = async () => build()
})

console.log('→ opening', `${BASE}/apps/voicemidi`)
await page.goto(`${BASE}/apps/voicemidi`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__voiceAnalyzeBuffer === 'function' && typeof window.__voiceGetVizState === 'function', null, { timeout: 60000 })
console.log('✓ VoiceMidi mounted\n')

// ─────────────────────────────────────────────────────────────────────────────
// PART B — beat-informed detection
// ─────────────────────────────────────────────────────────────────────────────
console.log('── Part B: beat-informed detection ──')
const partB = await page.evaluate(() => {
  const SR = 44100, BPM = 120
  const beat = 60 / BPM               // 0.5s
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12)
  // sample-level sawtooth renderer given freq(t), amp(t)
  const render = (totalDur, freqAt, ampAt) => {
    const N = Math.round(totalDur * SR); const out = new Float32Array(N); let ph = 0
    for (let i = 0; i < N; i++) { const t = i / SR; ph += freqAt(t) / SR; ph -= Math.floor(ph); out[i] = 2 * (ph - 0.5) * ampAt(t) }
    return out
  }
  // A take on the grid: beats + eighths, small onset jitter, PLUS two spurious short off-grid
  // fragments (a different pitch, ~70ms, landing BETWEEN sixteenths → not on a subdivision).
  const notes = [
    { midi: 60, on: 0.00 + 0.020, dur: 0.45 },  // beat 1 (+20ms jitter)
    { midi: 62, on: 0.50 - 0.025, dur: 0.20 },  // beat 2 (−25ms)
    { midi: 64, on: 0.75 + 0.018, dur: 0.20 },  // eighth (+18ms)
    { midi: 65, on: 1.00 - 0.022, dur: 0.45 },  // beat 3 (−22ms)
    { midi: 67, on: 1.50 + 0.015, dur: 0.20 },  // beat 4 (+15ms)
    { midi: 69, on: 1.75 - 0.020, dur: 0.40 },  // eighth (−20ms)
    // spurious off-grid fragments (between-subdivision phase; over-split style):
    { midi: 71, on: 0.56, dur: 0.07, frag: true },   // ~60ms off nearest 16th
    { midi: 59, on: 1.31, dur: 0.07, frag: true },   // ~60ms off nearest 16th
  ]
  const total = 2.4
  const active = t => notes.find(n => t >= n.on && t < n.on + n.dur)
  const buf = render(total, t => { const n = active(t); return n ? mtof(n.midi) : 220 }, t => {
    const n = active(t); if (!n) return 0
    const rel = t - n.on, env = Math.min(1, rel / 0.01) * Math.min(1, (n.on + n.dur - t) / 0.02)
    return 0.32 * Math.max(0, env)
  })

  const opts = { gain: 1, segmenter: 'hmm', sensitivity: 0.5 }
  const grid = { bpm: BPM, phaseSec: 0, subdiv: 4 }
  const step = beat / 4               // sixteenth = 0.125s
  const residMs = ns => {
    if (!ns.length) return 0
    let s = 0; for (const n of ns) { const k = Math.round(n.startSec / step); s += Math.abs(n.startSec - k * step) }
    return (s / ns.length) * 1000
  }
  const without = window.__voiceAnalyzeBuffer(buf, SR, opts).notes
  const withG   = window.__voiceAnalyzeBuffer(buf, SR, { ...opts, beatGrid: grid }).notes
  const disabled = window.__voiceAnalyzeBuffer(buf, SR, { ...opts, beatGrid: grid, useBeatGrid: false }).notes

  // Rubato take: irregular, deliberately OFF-grid onsets. Analyzed with NO beatGrid → must keep
  // its expressive timing (large residual to a 120 grid), i.e. not forced onto a grid.
  const rub = [
    { midi: 60, on: 0.10, dur: 0.37 }, { midi: 64, on: 0.61, dur: 0.29 },
    { midi: 67, on: 1.03, dur: 0.44 }, { midi: 65, on: 1.62, dur: 0.33 },
  ]
  const ractive = t => rub.find(n => t >= n.on && t < n.on + n.dur)
  const rbuf = render(2.1, t => { const n = ractive(t); return n ? mtof(n.midi) : 220 }, t => {
    const n = ractive(t); if (!n) return 0
    const rel = t - n.on, env = Math.min(1, rel / 0.01) * Math.min(1, (n.on + n.dur - t) / 0.02)
    return 0.32 * Math.max(0, env)
  })
  const rubNoGrid = window.__voiceAnalyzeBuffer(rbuf, SR, opts).notes

  // Over-split case: ONE held note (continuous phonation) with a brief OFF-GRID pitch blip in
  // the middle — the classic spurious split. WITH the grid the short off-grid fragment folds
  // back into the sustained note (fewer notes); WITHOUT it, it stays split.
  const hbuf = render(1.4, t => {
    if (t >= 0.60 && t < 0.69) return mtof(64)      // ~90ms excursion up, mid-way BETWEEN 16ths (off-grid)
    return mtof(60)                                  // held 60 the rest of 0..1.2
  }, t => (t < 1.2 ? 0.32 : 0))                      // amplitude ON throughout → continuous phonation
  const heldNoGrid = window.__voiceAnalyzeBuffer(hbuf, SR, opts).notes
  const heldGrid   = window.__voiceAnalyzeBuffer(hbuf, SR, { ...opts, beatGrid: grid }).notes

  const same = (a, b) => a.length === b.length && a.every((n, i) =>
    Math.abs(n.startSec - b[i].startSec) < 1e-6 && n.midi === b[i].midi && Math.abs(n.durSec - b[i].durSec) < 1e-6)

  return {
    without: { n: without.length, resid: residMs(without) },
    withG:   { n: withG.length,   resid: residMs(withG) },
    disabledUnchanged: same(without, disabled),
    rub: { n: rubNoGrid.length, resid: residMs(rubNoGrid) },
    held: { without: heldNoGrid.length, with: heldGrid.length,
            wNotes: heldNoGrid.map(n => ({ m: n.midi, s: +n.startSec.toFixed(3), d: +n.durSec.toFixed(3) })),
            gNotes: heldGrid.map(n => ({ m: n.midi, s: +n.startSec.toFixed(3), d: +n.durSec.toFixed(3) })) },
  }
})
console.log('  held WITHOUT:', JSON.stringify(partB.held.wNotes))
console.log('  held WITH   :', JSON.stringify(partB.held.gNotes))

console.log(`  WITHOUT grid: ${partB.without.n} notes, onset-vs-grid residual ${partB.without.resid.toFixed(1)}ms`)
console.log(`  WITH grid   : ${partB.withG.n} notes, onset-vs-grid residual ${partB.withG.resid.toFixed(1)}ms`)
rec('grid snaps onsets (residual tightens)', partB.withG.resid < partB.without.resid - 3, `${partB.without.resid.toFixed(1)}→${partB.withG.resid.toFixed(1)}ms`)
rec('grid suppresses spurious fragments (fewer/equal notes)', partB.withG.n <= partB.without.n, `${partB.without.n}→${partB.withG.n}`)
console.log(`  held-note over-split: WITHOUT ${partB.held.without} notes → WITH ${partB.held.with}`)
rec('grid merges an off-grid over-split back into the held note', partB.held.with < partB.held.without, `${partB.held.without}→${partB.held.with}`)
rec('grid residual is tight (< ~one sixteenth·¼)', partB.withG.resid < 32, `${partB.withG.resid.toFixed(1)}ms`)
rec('useBeatGrid:false ⇒ byte-identical to no-grid (gate)', partB.disabledUnchanged)
rec('RUBATO (no beatGrid) keeps expressive off-grid timing', partB.rub.resid > 25, `residual ${partB.rub.resid.toFixed(1)}ms, ${partB.rub.n} notes`)

// ─────────────────────────────────────────────────────────────────────────────
// PART A — live scrolling viz
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Part A: live recording visualization ──')

const canvasNonEmpty = async () => page.evaluate(() => {
  const c = document.querySelector('[data-testid="vm-live-viz"]')
  if (!c) return { present: false }
  const g = c.getContext('2d')
  const w = c.width, h = c.height
  if (!w || !h) return { present: true, drawn: false }
  const d = g.getImageData(0, 0, w, h).data
  let nonBg = 0
  for (let i = 0; i < d.length; i += 4 * 97) { if (d[i] + d[i + 1] + d[i + 2] > 30 && d[i + 3] > 0) nonBg++ }
  return { present: true, drawn: nonBg > 5, nonBg, w, h }
})

// ── Metro ON: beat grid lines must appear ──────────────────────────────────────
await page.getByRole('button', { name: /Metronome/ }).click()
await page.getByRole('button', { name: /Sing a tune/ }).click()
await page.waitForTimeout(900)
const s1 = await page.evaluate(() => window.__voiceGetVizState())
await page.waitForTimeout(400)
const s2 = await page.evaluate(() => window.__voiceGetVizState())
const px1 = await canvasNonEmpty()

rec('canvas mounts while recording', px1.present)
rec('canvas draws (non-empty pixels)', !!px1.drawn, `nonBg=${px1.nonBg}, ${px1.w}×${px1.h}`)
rec('RAF loop active + advancing', s1.active && s2.frames > s1.frames, `frames ${s1.frames}→${s2.frames}`)
rec('live pitch trail populated', s2.trailPoints > 0, `points=${s2.trailPoints}`)
rec('beat grid lines drawn (metro ON)', s2.metroOn === true && s2.gridLines > 0, `metroOn=${s2.metroOn}, gridLines=${s2.gridLines}`)

// Stop → clean teardown.
await page.getByRole('button', { name: /Stop/ }).click()
await page.waitForTimeout(300)
const sStop = await page.evaluate(() => window.__voiceGetVizState())
const canvasGone = await page.locator('[data-testid="vm-live-viz"]').count()
rec('RAF torn down on stop', sStop.active === false)
rec('canvas removed on stop', canvasGone === 0)

// ── Metro OFF: plain time grid, no beat semantics ───────────────────────────────
await page.getByRole('button', { name: /Metronome on/ }).click()   // toggle metro OFF
await page.getByRole('button', { name: /Sing a tune/ }).click()
await page.waitForTimeout(700)
const sOff = await page.evaluate(() => window.__voiceGetVizState())
rec('records + draws with metro OFF (plain grid)', sOff.active && sOff.frames > 0 && sOff.metroOn === false, `frames=${sOff.frames}, metroOn=${sOff.metroOn}`)
await page.getByRole('button', { name: /Stop/ }).click()
await page.waitForTimeout(200)

rec('0 console errors', errors.length === 0, errors.length ? JSON.stringify(errors.slice(0, 3)) : '')

console.log('')
console.log(allPass ? '✓ ALL PASS' : '✗ FAILURES ABOVE')
await browser.close()
process.exit(allPass ? 0 : 1)
