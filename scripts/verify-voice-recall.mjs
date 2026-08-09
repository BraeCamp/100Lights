// verify-voice-recall.mjs — Part 1 (recover missing notes) + Part 2 (debug lanes) for the
// VoiceMidi recall improvements. Simulates real-voice conditions headlessly (no mic): quiet
// notes, breathy/short notes, and notes the tracker drops — asserting each mechanism now
// KEEPS them (before/after counts) while a silent buffer still yields 0 notes; confirms the
// prior wins don't regress; then drives a real record→refine→debug flow and checks the
// volume/clarity/flux/pitch-change lanes render.
//
//   node scripts/verify-voice-recall.mjs
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

const LIVE_MELODY = [
  { freq: 261.63, t0: 0.10, t1: 0.55, g: 0.30 }, // C4
  { freq: 329.63, t0: 0.65, t1: 1.05, g: 0.30 }, // E4
  { freq: 392.00, t0: 1.15, t1: 1.55, g: 0.30 }, // G4
]
await page.addInitScript((melody) => {
  const build = () => {
    const AC = window.AudioContext || window.webkitAudioContext
    const ctx = new AC()
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'
    const gain = ctx.createGain()
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain); gain.connect(dest)
    const t = ctx.currentTime + 0.05
    gain.gain.setValueAtTime(0, t)
    for (const n of melody) {
      osc.frequency.setValueAtTime(n.freq, t + n.t0)
      gain.gain.setValueAtTime(n.g, t + n.t0)
      gain.gain.setValueAtTime(0.0, t + n.t1)
    }
    osc.start(t)
    ;(window.__fakeKeep = window.__fakeKeep || []).push({ ctx, osc, gain, dest })
    return dest.stream
  }
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
  navigator.mediaDevices.getUserMedia = async () => build()
}, LIVE_MELODY)

console.log('→ opening', `${BASE}/apps/voicemidi`)
await page.goto(`${BASE}/apps/voicemidi`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__voiceAnalyzeBuffer === 'function', null, { timeout: 60000 })
console.log('✓ VoiceMidi mounted\n')

const offline = await page.evaluate(() => {
  const SR = 44100
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12)
  function render(totalDur, freqAt, ampAt, noiseAt) {
    const N = Math.round(totalDur * SR)
    const out = new Float32Array(N)
    let ph = 0
    for (let i = 0; i < N; i++) {
      const t = i / SR
      ph += freqAt(t) / SR; ph -= Math.floor(ph)
      const noise = noiseAt ? noiseAt(t) * (Math.random() * 2 - 1) : 0
      out[i] = 2 * (ph - 0.5) * ampAt(t) + noise
    }
    return out
  }
  function schedule(midis, noteDur, gap, start = 0.1) {
    const notes = []; let t = start
    for (const m of midis) { notes.push({ midi: m, start: t, dur: noteDur }); t += noteDur + gap }
    return notes
  }
  function noteAt(notes, t) {
    let cur = notes[0]
    for (const n of notes) { if (t >= n.start) cur = n; if (t >= n.start && t < n.start + n.dur) return n }
    return { ...cur, _silent: true }
  }
  function renderMelody(notes, totalDur) {
    const freqAt = t => mtof(noteAt(notes, t).midi)
    const ampAt = t => {
      const n = noteAt(notes, t)
      if (n._silent) return 0
      const e = Math.min(t - n.start, n.start + n.dur - t)
      return (n.amp ?? 0.3) * Math.max(0, Math.min(1, e / 0.008))
    }
    const noiseAt = t => { const n = noteAt(notes, t); return n._silent ? 0 : (n.noise ?? 0) }
    return render(totalDur ?? (notes[notes.length - 1].start + notes[notes.length - 1].dur), freqAt, ampAt, noiseAt)
  }
  function renderScoop() {
    const start = 0.1, dur = 0.5
    const freqAt = t => { const e = t - start; const m = (e >= 0 && e < 0.06) ? 61 - (e / 0.06) : 60; return mtof(m) }
    const ampAt = t => { const e = Math.min(t - start, start + dur - t); return e < 0 ? 0 : 0.3 * Math.max(0, Math.min(1, e / 0.008)) }
    return render(start + dur + 0.05, freqAt, ampAt)
  }
  function renderVibrato() {
    const start = 0.1, dur = 1.2, depth = 0.5, rate = 6
    const freqAt = t => { const e = t - start; return e < 0 ? mtof(62) : mtof(62 + depth * Math.sin(2 * Math.PI * rate * e)) }
    const ampAt = t => { const e = Math.min(t - start, start + dur - t); return e < 0 ? 0 : 0.3 * Math.max(0, Math.min(1, e / 0.01)) }
    return render(start + dur + 0.05, freqAt, ampAt)
  }

  const anF = (buf, opts) => window.__voiceAnalyzeBuffer(buf, SR, opts)
  const an  = (buf, opts) => anF(buf, opts).notes
  const seq = ns => ns.map(n => n.midi)
  const uniq = a => [...new Set(a)].sort((x, y) => x - y)
  const near = (arr, m) => uniq(arr).some(x => Math.abs(x - m) <= 1)
  const dedupe = a => a.filter((v, i) => i === 0 || v !== a[i - 1])
  const contourOk = (got, exp) => { const g = dedupe(got); return g.length === exp.length && g.every((v, i) => Math.abs(v - exp[i]) <= 1) }
  // "before" = strict, ~prior gating; "after" = the shipped default (sensitivity 0.5).
  const AFTER = { segmenter: 'hmm', minDuration: 0.06, sensitivity: 0.5 }

  const R = {}

  // (a) LOW-AMPLITUDE quiet note — the HMM keepBias recall knob. Middle note at ~5% of peak.
  //     before = keepBias off (sensitivity 0); after = max recall (sensitivity 1). Plus the
  //     DEFAULT (0.5) must keep a common ~10% quiet note.
  {
    const quiet = [{ midi: 67, start: 0.10, dur: 0.34, amp: 0.30 }, { midi: 69, start: 0.52, dur: 0.34, amp: 0.015 }, { midi: 71, start: 0.94, dur: 0.34, amp: 0.30 }]
    const buf = renderMelody(quiet, 1.4)
    const before = an(buf, { segmenter: 'hmm', minDuration: 0.06, sensitivity: 0.0, recoverNotes: false })
    const after  = an(buf, { segmenter: 'hmm', minDuration: 0.06, sensitivity: 1.0, recoverNotes: false })
    const common = [{ midi: 67, start: 0.10, dur: 0.34, amp: 0.30 }, { midi: 69, start: 0.52, dur: 0.34, amp: 0.032 }, { midi: 71, start: 0.94, dur: 0.34, amp: 0.30 }] // ~11%
    const def = an(renderMelody(common, 1.4), AFTER)
    R.keepBias = {
      beforeCount: before.length, afterCount: after.length,
      beforeKept: near(seq(before), 69), afterKept: near(seq(after), 69),
      defaultKeptCommon: near(seq(def), 69),
      pass: !near(seq(before), 69) && near(seq(after), 69) && near(seq(def), 69),
    }
  }

  // (b) EXISTENCE GATE (onset path) — quiet note at ~8% of peak. before existFrac 0.12 drops
  //     it as a near-silence phantom; after (~0.05, sensitivity-scaled) keeps it.
  {
    const notes = [{ midi: 67, start: 0.10, dur: 0.34, amp: 0.30 }, { midi: 69, start: 0.52, dur: 0.34, amp: 0.024 }, { midi: 71, start: 0.94, dur: 0.34, amp: 0.30 }]
    const buf = renderMelody(notes, 1.4)
    const before = an(buf, { segmenter: 'onset', minDuration: 0.08, volumeExistFrac: 0.12, sensitivity: 0.0, recoverNotes: false })
    const after  = an(buf, { segmenter: 'onset', minDuration: 0.06, sensitivity: 0.5 })
    R.existGate = {
      beforeCount: before.length, afterCount: after.length,
      beforeKept: near(seq(before), 69), afterKept: near(seq(after), 69),
      pass: !near(seq(before), 69) && near(seq(after), 69),
    }
  }

  // (c) SHORT-but-real notes (~100ms ×5) — the default must keep them.
  {
    const midis = [67, 69, 71, 72, 74]
    const notes = midis.map((m, i) => ({ midi: m, start: 0.10 + i * 0.16, dur: 0.10, amp: 0.30 }))
    const buf = renderMelody(notes, 0.10 + midis.length * 0.16)
    const strict = an(buf, { segmenter: 'hmm', minDuration: 0.13, sensitivity: 0.0, recoverNotes: false })
    const after  = an(buf, AFTER)
    R.shortNotes = {
      expect: midis, strictCount: strict.length, afterCount: after.length, afterNotes: seq(after),
      pass: after.length >= 4 && contourOk(seq(after), midis),
    }
  }

  // (d) RECOVERY PASS — a real ~90ms note the tracker drops as sub-minDuration is re-added.
  //     before recoverNotes:false leaves a gap; after recovers it (recovered ≥ 1).
  {
    const dur = 0.09
    const notes = [{ midi: 67, start: 0.10, dur: 0.40, amp: 0.30 }, { midi: 69, start: 0.62, dur, amp: 0.30 }, { midi: 71, start: 0.62 + dur + 0.14, dur: 0.40, amp: 0.30 }]
    const buf = renderMelody(notes, 0.62 + dur + 0.14 + 0.40)
    const opts = { segmenter: 'hmm', minDuration: 0.12, sensitivity: 0.8 } // strict floor drops the 90ms note
    const before = anF(buf, { ...opts, recoverNotes: false })
    const after  = anF(buf, { ...opts, recoverNotes: true })
    R.recovery = {
      beforeCount: before.notes.length, afterCount: after.notes.length,
      beforeKept: near(seq(before.notes), 69), afterKept: near(seq(after.notes), 69),
      recoveredCount: after.recovered.length,
      pass: !near(seq(before.notes), 69) && near(seq(after.notes), 69) && after.recovered.length >= 1,
    }
  }

  // FALSE-POSITIVE guard — silence-only buffer → 0 notes, even at max recall.
  {
    const N = Math.round(1.5 * SR)
    const buf = new Float32Array(N)
    for (let i = 0; i < N; i++) buf[i] = (Math.random() * 2 - 1) * 0.0008
    const def = an(buf, AFTER)
    const hi  = anF(buf, { segmenter: 'hmm', minDuration: 0.045, sensitivity: 1.0 })
    R.silence = { defCount: def.length, hiCount: hi.notes.length, hiRecovered: hi.recovered.length, pass: def.length === 0 && hi.notes.length === 0 }
  }

  // ── No-regression on the prior wins (all at the shipped default) ────────────────
  const reg = {}
  const quick = dur => {
    const midis = [67, 69, 71, 72, 74]
    const on = an(renderMelody(schedule(midis, dur, 0.03)), AFTER)
    return { count: on.length, notes: seq(on), pass: on.length >= 4 && contourOk(seq(on), midis) }
  }
  reg.quick110 = quick(0.11)
  reg.quick120 = quick(0.12)
  { const on = an(renderMelody(schedule([64, 64, 64], 0.30, 0.03)), AFTER); reg.reartic3 = { count: on.length, notes: seq(on), pass: on.length === 3 && on.every(n => Math.abs(n.midi - 64) <= 1) } }
  { const on = an(renderMelody(schedule([62], 2.5, 0)), AFTER); reg.held = { count: on.length, notes: seq(on), pass: on.length === 1 && Math.abs(on[0]?.midi - 62) <= 1 } }
  { const on = an(renderVibrato(), AFTER); reg.vibrato = { count: on.length, notes: seq(on), pass: on.length === 1 && Math.abs(on[0]?.midi - 62) <= 1 } }
  { const on = an(renderScoop(), AFTER); reg.scoop = { count: on.length, notes: seq(on), pass: on.length >= 1 && on.every(n => n.midi === 60) } }
  { const low = [45, 47, 48, 50, 52, 53, 55, 57]; const on = an(renderMelody(schedule(low, 0.34, 0.06)), AFTER); reg.lowScale = { count: on.length, notes: seq(on), pass: on.length >= low.length && contourOk(seq(on), low) } }
  { const up = [48, 50, 52, 53, 55, 57, 59, 60]; const contour = up.concat([59, 57, 55, 53, 52, 50, 48]); const on = an(renderMelody(schedule(contour, 0.22, 0.05)), AFTER); reg.contour = { count: on.length, notes: seq(on), pass: contourOk(seq(on), contour) } }
  R.regression = reg

  // Part 2 data plumbing: analysis exposes every lane's array.
  {
    const a = anF(renderMelody(schedule([60, 62, 64], 0.3, 0.05)), AFTER)
    R.arrays = {
      hasRms: Array.isArray(a.rms) && a.rms.length > 0,
      hasClarity: Array.isArray(a.clarity) && a.clarity.length > 0,
      hasPitchDelta: Array.isArray(a.pitchDelta) && a.pitchDelta.length > 0,
      hasFlux: Array.isArray(a.flux) && a.flux.length > 0,
      hasRecovered: Array.isArray(a.recovered),
      pass: Array.isArray(a.rms) && Array.isArray(a.pitchDelta) && Array.isArray(a.clarity) && Array.isArray(a.flux) && Array.isArray(a.recovered),
    }
  }
  return R
})

// ── LIVE: record → refine → toggle debug overlay → assert the lanes render ──────────
async function liveDebugLanes() {
  await page.getByRole('button', { name: /Sing a tune/ }).click()
  await page.waitForTimeout(2000)
  await page.getByRole('button', { name: /Stop/ }).click()
  await page.waitForFunction(() => {
    const el = [...document.querySelectorAll('p')].find(p => /Refining take/.test(p.textContent || ''))
    return !el
  }, null, { timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(300)
  const toggle = page.getByTestId('vm-debug-toggle')
  if (!(await toggle.isChecked())) await toggle.check()
  await page.waitForTimeout(300)
  const lanes = {}
  for (const id of ['vm-volume-lane', 'vm-clarity-lane', 'vm-flux-lane', 'vm-pitchdelta-lane', 'vm-debug-legend']) {
    lanes[id] = await page.getByTestId(id).count()
  }
  return lanes
}
let lanes = {}
try { lanes = await liveDebugLanes() } catch (e) { lanes = { error: String(e).slice(0, 120) } }

await browser.close()

// ── Report ──────────────────────────────────────────────────────────────────────
const P = ok => ok ? '✓' : '✗'
let allPass = errors.length === 0
const rec = ok => { allPass = allPass && ok; return ok }

console.log('════════ PART 1 — recover missing notes (before → after) ════════\n')
const k = offline.keepBias
console.log('(a) LOW-AMPLITUDE quiet note (~5% of peak) — HMM keepBias recall knob')
console.log(`    before(keepBias off) → ${k.beforeCount} notes, quietKept=${k.beforeKept}`)
console.log(`    after (keepBias max) → ${k.afterCount} notes, quietKept=${k.afterKept}`)
console.log(`    default(sens .5) keeps a common ~11% quiet note = ${k.defaultKeptCommon}`)
console.log(`    ${P(rec(k.pass))} quiet note dropped before, kept after (+ default keeps common case)\n`)

const e = offline.existGate
console.log('(b) EXISTENCE GATE (onset path) — quiet note (~8% of peak)')
console.log(`    before(existFrac .12) → ${e.beforeCount} notes, kept=${e.beforeKept}`)
console.log(`    after (existFrac ~.05) → ${e.afterCount} notes, kept=${e.afterKept}`)
console.log(`    ${P(rec(e.pass))} phantom-gated before, kept after\n`)

const c = offline.shortNotes
console.log('(c) SHORT notes (~100ms ×5)')
console.log(`    strict minDur .13 → ${c.strictCount} notes · after → ${c.afterCount} ${JSON.stringify(c.afterNotes)}`)
console.log(`    ${P(rec(c.pass))} short notes kept after (≥4 of 5, contour)\n`)

const rc = offline.recovery
console.log('(d) RECOVERY PASS — a real ~90ms note the tracker drops as sub-minDuration')
console.log(`    before(recover off) → ${rc.beforeCount} notes, kept=${rc.beforeKept}`)
console.log(`    after (recover on)  → ${rc.afterCount} notes, kept=${rc.afterKept}, recovered=${rc.recoveredCount}`)
console.log(`    ${P(rec(rc.pass))} dropped note recovered after\n`)

const s = offline.silence
console.log('FALSE-POSITIVE guard — silence-only buffer')
console.log(`    default → ${s.defCount} notes · max-recall → ${s.hiCount} notes (recovered ${s.hiRecovered})`)
console.log(`    ${P(rec(s.pass))} silence yields 0 notes even at max recall\n`)

console.log('════════ NO-REGRESSION (all at the shipped default) ════════\n')
const r = offline.regression
const row = (name, o, want) => console.log(`    ${P(rec(o.pass))} ${name.padEnd(14)} → ${JSON.stringify(o.notes)} (count ${o.count}${want ? ', want ' + want : ''})`)
row('quick 110ms', r.quick110, '≥4/5')
row('quick 120ms', r.quick120, '≥4/5')
row('re-artic ×3', r.reartic3, '3')
row('held 2.5s', r.held, '1')
row('vibrato', r.vibrato, '1')
row('scoop 61→60', r.scoop, 'all 60')
row('low A2→A3', r.lowScale, '8')
row('contour', r.contour, 'up+down')

console.log('\n════════ PART 2 — debug arrays + lanes ════════\n')
const ar = offline.arrays
console.log(`    BufferAnalysis arrays: rms=${ar.hasRms} clarity=${ar.hasClarity} pitchDelta=${ar.hasPitchDelta} flux=${ar.hasFlux} recovered=${ar.hasRecovered}`)
console.log(`    ${P(rec(ar.pass))} analysis exposes every lane's data`)
console.log(`    DOM lanes after record→refine→debug: ${JSON.stringify(lanes)}`)
const lanesOk = ['vm-volume-lane', 'vm-clarity-lane', 'vm-flux-lane', 'vm-pitchdelta-lane'].every(k => lanes[k] >= 1)
console.log(`    ${P(rec(lanesOk))} volume + clarity + flux + pitch-change lanes render`)

console.log(`\nConsole errors: ${errors.length}`)
for (const e of errors.slice(0, 8)) console.log('   [err]', e.slice(0, 160))
console.log(`\n${allPass ? '✓ ALL PASS' : '✗ SOME FAIL'}`)
process.exit(allPass ? 0 : 1)
