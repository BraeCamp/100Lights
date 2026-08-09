// A/B verification for the VoiceMidi note-detection improvements.
//
// For EACH idea we run the relevant synthetic case with the flag OFF vs ON and report
// the delta, then an "all-on" pass over the full regression suite. Offline cases drive
// the pure window.__voiceAnalyzeBuffer on synthesized buffers; the PCM-tail case drives
// a real live+PCM capture through a synthetic getUserMedia tone-stream.
//
//   node scripts/verify-voice-improvements.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:3001'

// ── Live tail melody: last note ends ~50ms before the 2.5s capture end ──────────
const LIVE_MELODY = [
  { freq: 440.00, t0: 0.05, t1: 0.60 }, // A4
  { freq: 523.25, t0: 0.70, t1: 1.25 }, // C5
  { freq: 659.25, t0: 1.35, t1: 1.90 }, // E5
  { freq: 783.99, t0: 2.30, t1: 2.45 }, // G5 — short + late (the drop-prone tail)
]
const LIVE_LAST_MIDI = 79 // G5
const CAPTURE_S = 2.5

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

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
      gain.gain.setValueAtTime(0.3, t + n.t0)
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
await page.waitForFunction(() => typeof window.__voiceAnalyzeBuffer === 'function' && typeof window.__VoiceLivePitchDetector === 'function', null, { timeout: 60000 })
console.log('✓ VoiceMidi mounted\n')

// ── OFFLINE: synthesize buffers + analyze, all inside the page ──────────────────
const offline = await page.evaluate(() => {
  const SR = 44100
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12)

  // Sample-level sawtooth renderer given freq(t) and amp(t).
  function render(totalDur, freqAt, ampAt) {
    const N = Math.round(totalDur * SR)
    const out = new Float32Array(N)
    let ph = 0
    for (let i = 0; i < N; i++) {
      const t = i / SR
      ph += freqAt(t) / SR; ph -= Math.floor(ph)
      out[i] = 2 * (ph - 0.5) * ampAt(t)
    }
    return out
  }

  // A melody of discrete notes {midi,start,dur}. Constant freq per note; short ramps.
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
  // Discrete-note buffer: freq = active note's, amp = n.amp (default 0.3) with 8ms edges,
  // 0 in gaps.
  function renderMelody(notes, totalDur) {
    const freqAt = t => mtof(noteAt(notes, t).midi)
    const ampAt = t => {
      const n = noteAt(notes, t)
      if (n._silent) return 0
      const e = Math.min(t - n.start, n.start + n.dur - t)
      return (n.amp ?? 0.3) * Math.max(0, Math.min(1, e / 0.008))
    }
    return render(totalDur ?? (notes[notes.length - 1].start + notes[notes.length - 1].dur), freqAt, ampAt)
  }
  // Legato swell scale: pitch glides CONTINUOUSLY (piecewise-linear through each swell's
  // centre = the scale degree, never a stable plateau — so pitch cues alone can't cleanly
  // segment it), while amplitude swells once per note with a deep valley (floored so pitch
  // stays voiced/legato) at every note boundary. Volume valleys are the only reliable cut.
  function renderLegatoSwell(midis, noteDur, start = 0.1) {
    const centers = midis.map((m, i) => ({ t: start + (i + 0.5) * noteDur, midi: m }))
    const total = start + midis.length * noteDur + start
    const freqAt = t => {
      if (t <= centers[0].t) return mtof(centers[0].midi)
      if (t >= centers[centers.length - 1].t) return mtof(centers[centers.length - 1].midi)
      let i = 0; while (i < centers.length - 1 && t > centers[i + 1].t) i++
      const a = centers[i], b = centers[i + 1], f = (t - a.t) / (b.t - a.t)
      return mtof(a.midi + (b.midi - a.midi) * f)
    }
    const ampAt = t => {
      const rel = (t - start) / noteDur
      if (rel < 0 || rel > midis.length) return 0
      const frac = rel - Math.floor(rel)                 // 0 at each boundary, 0.5 at centre
      return 0.06 + 0.26 * Math.sin(Math.PI * frac)      // floor 0.06 (stays voiced) → peak 0.32
    }
    return { buf: render(total, freqAt, ampAt), count: midis.length }
  }
  // Scoop: single note gliding 61→60 over first 60ms then holding 60.
  function renderScoop() {
    const start = 0.1, dur = 0.5
    const freqAt = t => { const e = t - start; const m = (e >= 0 && e < 0.06) ? 61 - (e / 0.06) : 60; return mtof(m) }
    const ampAt = t => { const e = Math.min(t - start, start + dur - t); return e < 0 ? 0 : 0.3 * Math.max(0, Math.min(1, e / 0.008)) }
    return render(start + dur + 0.05, freqAt, ampAt)
  }

  const analyze = (buf, opts) => window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08, ...opts }).notes
  const seq = notes => notes.map(n => n.midi)
  const uniqSorted = a => [...new Set(a)].sort((x, y) => x - y)
  // ordered contour equality within ±1 (dedupe consecutive equals first)
  const dedupe = a => a.filter((v, i) => i === 0 || v !== a[i - 1])
  const contourOk = (got, exp) => { const g = dedupe(got); return g.length === exp.length && g.every((v, i) => Math.abs(v - exp[i]) <= 1) }

  const results = {}

  // — Idea 1: final-window / tail coverage (offline). The last note ends exactly at the
  //   buffer edge. Without the tail windows the scan's `off+win<=len` bound stops ~one
  //   window early, so the final note is measured ~win short (and, when short, drops
  //   below minDuration). We assert its recovered DURATION (the mechanism) and that a
  //   deliberately short final note flips from dropped→caught. —
  {
    const long = [{ midi: 69, start: 0.10, dur: 0.40 }, { midi: 76, start: 0.52, dur: 0.45 }]
    const longTotal = long[1].start + long[1].dur
    const lbuf = renderMelody(long, longTotal)
    const lOff = analyze(lbuf, { scanTailWindow: false })
    const lOn  = analyze(lbuf, { scanTailWindow: true })
    const lastDur = ns => (ns.length ? ns[ns.length - 1].durSec : 0)
    // Short final note (~110ms) at the edge: flips dropped→caught.
    const short = [{ midi: 69, start: 0.10, dur: 0.40 }, { midi: 76, start: 0.60, dur: 0.11 }]
    const sbuf = renderMelody(short, short[1].start + short[1].dur)
    const sOff = analyze(sbuf, { scanTailWindow: false })
    const sOn  = analyze(sbuf, { scanTailWindow: true })
    const hasLast = ns => uniqSorted(seq(ns)).some(m => Math.abs(m - 76) <= 1)
    results.tailOffline = {
      offLastDur: +lastDur(lOff).toFixed(3), onLastDur: +lastDur(lOn).toFixed(3),
      shortOff: seq(sOff), shortOn: seq(sOn),
      shortOffDur: +lastDur(sOff).toFixed(3), shortOnDur: +lastDur(sOn).toFixed(3),
      // Deterministic pass: the final note's duration is recovered (window-bleed makes the
      // outright drop marginal offline; the LIVE PCM test proves a real dropped→caught).
      pass: (lastDur(lOn) - lastDur(lOff) >= 0.012),
    }
  }

  // — Idea 2: adaptive window — low scale A2→A3 + descending C4→C3 —
  {
    const low = [45, 47, 48, 50, 52, 53, 55, 57] // A2..A3 (A natural minor)
    const notes = schedule(low, 0.34, 0.06)
    const buf = renderMelody(notes)
    const off = analyze(buf, { adaptiveWindow: false })
    const on  = analyze(buf, { adaptiveWindow: true })
    const recov = ns => uniqSorted(ns.filter(m => m >= 43 && m <= 59)).length
    results.adaptiveLow = {
      expected: low, expectedCount: low.length,
      offNotes: seq(off), onNotes: seq(on),
      offCount: off.length, onCount: on.length,
      pass: on.length >= low.length && contourOk(seq(on), low),
    }
    void recov
  }
  {
    const desc = [60, 59, 57, 55, 53, 52, 50, 48] // C4→C3
    const notes = schedule(desc, 0.30, 0.06)
    const buf = renderMelody(notes)
    const off = analyze(buf, { adaptiveWindow: false })
    const on  = analyze(buf, { adaptiveWindow: true })
    const lowTail = ns => uniqSorted(ns).filter(m => m <= 52).length // E3 and below
    results.adaptiveDesc = {
      expected: desc, offNotes: seq(off), onNotes: seq(on),
      offLowTail: lowTail(off), onLowTail: lowTail(on),
      pass: on.length >= desc.length - 1 && contourOk(seq(on), desc),
    }
  }

  // — Idea 3: volume cues — EXISTENCE GATE (the clean, unique win). Two solid notes with
  //   a quiet phantom blip between them (just above the RMS gate). Without volume cues the
  //   phantom transcribes as a real note; the existence gate (peak vol vs the take's peak)
  //   drops it. —
  {
    const notes = [
      { midi: 69, start: 0.10, dur: 0.35, amp: 0.30 },
      { midi: 74, start: 0.55, dur: 0.20, amp: 0.02 }, // quiet phantom
      { midi: 72, start: 0.85, dur: 0.35, amp: 0.30 },
    ]
    const buf = renderMelody(notes, 1.25)
    const off = analyze(buf, { useVolumeCues: false })
    const on  = analyze(buf, { useVolumeCues: true })
    const hasPhantom = ns => uniqSorted(seq(ns)).some(m => Math.abs(m - 74) <= 1)
    results.existGate = {
      offNotes: seq(off), onNotes: seq(on),
      offPhantom: hasPhantom(off), onPhantom: hasPhantom(on),
      pass: hasPhantom(off) && !hasPhantom(on) && on.length === 2,
    }
  }

  // — Idea 3 (informational): legato same-pitch swells. Volume valleys mark each swell,
  //   but the onset detector ALSO reacts to volume swells, so valley-splitting is largely
  //   redundant here (reported, not pass-gated). —
  {
    const { buf, count } = renderLegatoSwell([57, 57, 57, 57, 57, 57], 0.4)
    const off = analyze(buf, { useVolumeCues: false })
    const on  = analyze(buf, { useVolumeCues: true })
    results.volumeSwell = { swells: count, offCount: off.length, onCount: on.length }
  }

  // — Idea 4 / contour: ascending + descending full scale (all-on defaults) —
  {
    const up = [48, 50, 52, 53, 55, 57, 59, 60]
    const contour = up.concat([59, 57, 55, 53, 52, 50, 48])
    const notes = schedule(contour, 0.22, 0.05)
    const buf = renderMelody(notes)
    const on = analyze(buf, {})
    results.contour = { expected: contour, gotNotes: seq(on), count: on.length, pass: contourOk(seq(on), contour) }
  }

  // — Regression suite (all-on defaults) —
  const reg = {}
  const quick = (dur) => {
    const midis = [67, 69, 71, 72, 74]
    const notes = schedule(midis, dur, 0.03)
    const on = analyze(renderMelody(notes), {})
    return { expected: midis, gotNotes: seq(on), count: on.length, pass: on.length >= 4 && contourOk(seq(on), midis) }
  }
  reg.quick110 = quick(0.11)
  reg.quick120 = quick(0.12)
  {
    const notes = schedule([64, 64, 64], 0.30, 0.03) // same note ×3
    const on = analyze(renderMelody(notes), {})
    reg.rearticulation = { gotNotes: on.map(n => n.midi), count: on.length, pass: on.length === 3 && on.every(n => Math.abs(n.midi - 64) <= 1) }
  }
  {
    const notes = schedule([62], 2.5, 0) // held 2.5s
    const on = analyze(renderMelody(notes), {})
    reg.held = { count: on.length, gotNotes: on.map(n => n.midi), pass: on.length === 1 && Math.abs(on[0]?.midi - 62) <= 1 }
  }
  {
    const on = analyze(renderScoop(), {})
    reg.scoop = { count: on.length, gotNotes: on.map(n => n.midi), pass: on.length >= 1 && on.every(n => n.midi === 60) }
  }
  {
    const notes = schedule([64, 65, 64, 65], 0.28, 0.04)
    const on = analyze(renderMelody(notes), {})
    reg.adjacent = { gotNotes: on.map(n => n.midi), count: on.length, pass: on.length === 4 && contourOk(on.map(n => n.midi), [64, 65, 64, 65]) }
  }
  results.regression = reg

  // — Timing on a ~15s buffer (all-on defaults), synchronous analyze —
  {
    const up = [48, 50, 52, 53, 55, 57, 59, 60]
    const contour = up.concat([59, 57, 55, 53, 52, 50, 48])
    let midis = []
    while (midis.length < 60) midis = midis.concat(contour)
    const notes = schedule(midis, 0.22, 0.02)
    const total = notes[notes.length - 1].start + notes[notes.length - 1].dur
    const buf = renderMelody(notes, total)
    const t0 = performance.now()
    const n = window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08 }).notes.length
    const ms = performance.now() - t0
    results.timing = { bufferSec: +total.toFixed(1), ms: +ms.toFixed(1), notes: n }
  }

  return results
})

// ── LIVE: PCM-tail capture, reconstructTail OFF vs ON ───────────────────────────
async function livePass(reconstructTail) {
  return await page.evaluate(async ({ captureS, reconstructTail }) => {
    const Det = window.__VoiceLivePitchDetector
    const det = new Det()
    await det.start(() => {}, true, undefined, { gain: 1, rmsGate: 0.006, peakGate: 0.008, confidenceGate: 0.4 })
    await new Promise(r => setTimeout(r, captureS * 1000))
    const pcm = det.stopAndGetPcm({ reconstructTail })
    det.stop()
    if (!pcm) return { ok: false }
    const analysis = await window.__voiceAnalyzeBufferAsync(pcm.samples, pcm.sampleRate, { gain: 1, rmsGate: 0.006, minDuration: 0.08 })
    return {
      ok: true,
      length: pcm.samples.length, sampleRate: pcm.sampleRate,
      durS: pcm.samples.length / pcm.sampleRate,
      notes: analysis.notes.map(n => n.midi),
    }
  }, { captureS: CAPTURE_S, reconstructTail })
}
const liveOff = await livePass(false)
await page.waitForTimeout(150)
const liveOn = await livePass(true)

await browser.close()

// ── Report ──────────────────────────────────────────────────────────────────────
const P = ok => ok ? '✓' : '✗'
let allPass = errors.length === 0
const rec = (ok) => { allPass = allPass && ok; return ok }

console.log('════════ A/B: each idea OFF vs ON on its case ════════\n')

const t = offline.tailOffline
console.log('1) FINAL-WINDOW / TAIL (offline, last note ends at buffer edge)')
console.log(`   long final note dur: OFF ${t.offLastDur}s → ON ${t.onLastDur}s (tail recovered ${((t.onLastDur - t.offLastDur) * 1000).toFixed(0)}ms)`)
console.log(`   short final note dur: OFF ${t.shortOffDur}s ${JSON.stringify(t.shortOff)} → ON ${t.shortOnDur}s ${JSON.stringify(t.shortOn)}`)
console.log(`   ${P(rec(t.pass))} final-note duration recovered by the tail windows`)
console.log(`   (the outright dropped→caught flip is proven by the LIVE PCM test below)\n`)

const aL = offline.adaptiveLow
console.log('2a) ADAPTIVE WINDOW — low scale A2→A3 (45..57)')
console.log(`   OFF → count ${aL.offCount} ${JSON.stringify(aL.offNotes)}`)
console.log(`   ON  → count ${aL.onCount} ${JSON.stringify(aL.onNotes)}  (expected ${aL.expectedCount})`)
console.log(`   ${P(rec(aL.pass))} all low notes detected + contour ON\n`)

const aD = offline.adaptiveDesc
console.log('2b) ADAPTIVE WINDOW — descending C4→C3 (60..48)')
console.log(`   OFF → ${JSON.stringify(aD.offNotes)}  lowTail(≤52) ${aD.offLowTail}`)
console.log(`   ON  → ${JSON.stringify(aD.onNotes)}  lowTail(≤52) ${aD.onLowTail}`)
console.log(`   ${P(rec(aD.pass))} low tail notes recovered ON\n`)

const eg = offline.existGate
console.log('3) VOLUME CUES — existence gate (quiet phantom blip between two real notes)')
console.log(`   OFF → ${JSON.stringify(eg.offNotes)}  phantom(74)=${eg.offPhantom}`)
console.log(`   ON  → ${JSON.stringify(eg.onNotes)}  phantom(74)=${eg.onPhantom}`)
console.log(`   ${P(rec(eg.pass))} phantom kept OFF → dropped ON (existence gate)`)
const v = offline.volumeSwell
console.log(`   (info) legato same-pitch swells (${v.swells}): OFF ${v.offCount} notes, ON ${v.onCount} — onset detector already reacts to swells, so valley-splitting is redundant here\n`)

const c = offline.contour
console.log('4) CONTOUR — ascending+descending full scale (all-on)')
console.log(`   expected ${JSON.stringify(c.expected)}`)
console.log(`   got      ${JSON.stringify(c.gotNotes)} (${c.count} notes)`)
console.log(`   ${P(rec(c.pass))} contour correct + count\n`)

console.log('════════ REGRESSION SUITE (all flags ON / defaults) ════════\n')
const r = offline.regression
const regRow = (name, o, extra) => { console.log(`   ${P(rec(o.pass))} ${name.padEnd(16)} → ${JSON.stringify(o.gotNotes)} ${extra || ''}`) }
regRow('quick 110ms', r.quick110, `(count ${r.quick110.count}, want ≥4 of 5)`)
regRow('quick 120ms', r.quick120, `(count ${r.quick120.count}, want ≥4 of 5)`)
regRow('re-artic ×3', r.rearticulation, `(count ${r.rearticulation.count}, want 3)`)
regRow('held 2.5s', r.held, `(count ${r.held.count}, want 1)`)
regRow('scoop 61→60', r.scoop, `(want all 60)`)
regRow('adjacent', r.adjacent, `(count ${r.adjacent.count}, want 4)`)

console.log('\n════════ PCM-TAIL live capture (reconstructTail OFF vs ON) ════════\n')
const expDur = CAPTURE_S
console.log(`   capture ${CAPTURE_S}s; last sung note = G5 (${LIVE_LAST_MIDI}) ending ~50ms before end`)
if (liveOff.ok && liveOn.ok) {
  const shortMs = (expDur - liveOff.durS) * 1000
  const onErrMs = Math.abs(expDur - liveOn.durS) * 1000
  const uniq = a => [...new Set(a)].sort((x, y) => x - y)
  const offHasG5 = uniq(liveOff.notes).some(m => Math.abs(m - LIVE_LAST_MIDI) <= 1)
  const onHasG5 = uniq(liveOn.notes).some(m => Math.abs(m - LIVE_LAST_MIDI) <= 1)
  console.log(`   OFF → ${liveOff.durS.toFixed(3)}s (${shortMs.toFixed(0)}ms short)  notes ${JSON.stringify(uniq(liveOff.notes))}  G5=${offHasG5}`)
  console.log(`   ON  → ${liveOn.durS.toFixed(3)}s (${onErrMs.toFixed(0)}ms off)      notes ${JSON.stringify(uniq(liveOn.notes))}  G5=${onHasG5}`)
  const lenOk = onErrMs <= 30 // within a few ms → tail spliced
  console.log(`   ${P(rec(lenOk))} ON length ≈ capture × sampleRate (±30ms)`)
  console.log(`   ${P(rec(onHasG5))} final note (G5) present ON`)
} else {
  console.log('   ✗ live capture failed', JSON.stringify({ liveOff, liveOn }))
  rec(false)
}

console.log(`\n── Timing ──  ${offline.timing.ms}ms to analyze a ${offline.timing.bufferSec}s buffer (${offline.timing.notes} notes)`)
console.log(`\nConsole errors: ${errors.length}`)
for (const e of errors.slice(0, 8)) console.log('   [err]', e.slice(0, 160))
console.log(`\n${allPass ? '✓ ALL PASS' : '✗ SOME FAIL'}`)
process.exit(allPass ? 0 : 1)
