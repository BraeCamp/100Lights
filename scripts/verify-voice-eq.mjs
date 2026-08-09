// Verification for the multi-band "Detect EQ" pitch source.
//
//   node scripts/verify-voice-eq.mjs
//
// Drives the pure window.__voiceAnalyzeBuffer / __voiceAnalyzeBands hooks on synthesized
// buffers (no mic), plus the real corr-fixture take. Reports full-signal vs EQ pitch on the
// octave-ambiguity case, analyzeBands correctness, the panel render, and the real-take result.
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'

const BASE = process.env.BASE || 'http://localhost:3001'
const EXPLORE = process.env.EXPLORE === '1'

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

console.log('→ opening', `${BASE}/apps/voicemidi`)
await page.goto(`${BASE}/apps/voicemidi`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(
  () => typeof window.__voiceAnalyzeBuffer === 'function' && typeof window.__voiceAnalyzeBands === 'function',
  null, { timeout: 60000 })
console.log('✓ VoiceMidi mounted (__voiceAnalyzeBands ready)\n')

// Load the real corr-fixture take (if present) into the page as a Float32 + sampleRate.
let take1 = null
if (existsSync('corr-fixture/take1.wav')) {
  const wav = readFileSync('corr-fixture/take1.wav')
  take1 = await page.evaluate(async (b64) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    const ac = new (window.AudioContext || window.webkitAudioContext)()
    const audio = await ac.decodeAudioData(bytes.buffer)
    const ch = audio.numberOfChannels
    let mono
    if (ch === 1) mono = Array.from(audio.getChannelData(0))
    else {
      const n = audio.length; const m = new Float32Array(n)
      for (let c = 0; c < ch; c++) { const d = audio.getChannelData(c); for (let i = 0; i < n; i++) m[i] += d[i] / ch }
      mono = Array.from(m)
    }
    await ac.close()
    return { samples: mono, sampleRate: audio.sampleRate }
  }, wav.toString('base64'))
}

const out = await page.evaluate(({ explore }) => {
  const SR = 44100
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12)
  // Deterministic PRNG so noise is reproducible.
  let seed = 12345
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff * 2 - 1 }

  // Additive-harmonic tone renderer. harmonics = [amp1,amp2,...] on f0,2f0,... noiseAmp adds a
  // treble-ish broadband hiss (high-passed white by 1st-difference), or plain broadband white
  // when broadband=true. 8ms edges, gap→silence.
  function renderTone(f0, harmonics, dur, noiseAmp = 0, start = 0.1, total, broadband = false) {
    total = total ?? (start + dur + 0.05)
    const N = Math.round(total * SR)
    const buf = new Float32Array(N)
    let prevNoise = 0
    for (let i = 0; i < N; i++) {
      const t = i / SR
      const e = Math.min(t - start, start + dur - t)
      if (e < 0) { prevNoise = 0; continue }
      const env = Math.max(0, Math.min(1, e / 0.008))
      let s = 0
      for (let h = 0; h < harmonics.length; h++) s += harmonics[h] * Math.sin(2 * Math.PI * f0 * (h + 1) * t)
      if (noiseAmp > 0) { const w = rnd(); if (broadband) { s += noiseAmp * w } else { const hp = w - prevNoise; prevNoise = w; s += noiseAmp * hp } }
      buf[i] = s * env
    }
    return buf
  }
  const octFrac = (analysis, trueMidi) => {
    const v = analysis.rawCurve.filter(f => f.midi !== null)
    if (!v.length) return 0
    return v.filter(f => f.midi - trueMidi >= 8).length / v.length
  }

  const rawPitchMidis = (analysis) => analysis.rawCurve.filter(f => f.midi !== null).map(f => f.midi)
  const median = arr => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return a[Math.floor(a.length / 2)] }
  const notesMidis = analysis => analysis.notes.map(n => n.midi)
  const uniq = a => [...new Set(a)].sort((x, y) => x - y)

  const results = { explore: null, octave: null, bandsClean: null, bandsNoise: null }

  // ── Exploration: sweep a few octave-ambiguity configs to find one where FULL octave-errors
  //    but EQ (dominant band) reads the true octave, and the winner is a bass/mid band. ──────
  if (explore) {
    const cfgs = []
    const trials = [
      // Fundamental in BASS, 2f0 pushed into MID, moderate f0 so bass isolates it but full
      // (dominated by the loud 2f0/4f0) octave-errors. Sweep f0 amp to find the flip.
      { note: 55, h: [0.30, 1.0, 0.10, 0.6, 0.05, 0.35], noise: 0.05 }, // G3=196, 2f0=392
      { note: 55, h: [0.22, 1.0, 0.08, 0.6, 0.04, 0.35], noise: 0.05 },
      { note: 55, h: [0.15, 1.0, 0.06, 0.6, 0.03, 0.35], noise: 0.05 },
      { note: 57, h: [0.20, 1.0, 0.08, 0.6, 0.04, 0.35], noise: 0.05 }, // A3=220, 2f0=440
      { note: 59, h: [0.20, 1.0, 0.08, 0.6, 0.04, 0.35], noise: 0.05 }, // B3=247, 2f0=494
      { note: 60, h: [0.20, 1.0, 0.08, 0.6, 0.04, 0.35], noise: 0.05 }, // C4=262, 2f0=524
      { note: 62, h: [0.20, 1.0, 0.08, 0.6, 0.04, 0.35], noise: 0.05 }, // D4=294, 2f0=587
    ]
    for (const tr of trials) {
      const buf = renderTone(mtof(tr.note), tr.h, 0.7, tr.noise, 0.1, undefined, tr.bb)
      const full = window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08, pitchSource: 'full' })
      const eq = window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08, pitchSource: 'eq' })
      const bands = window.__voiceAnalyzeBands(buf, SR, {})
      cfgs.push({
        note: tr.note, h: tr.h, noise: tr.noise,
        fullRawMed: median(rawPitchMidis(full)), fullNotes: uniq(notesMidis(full)), fullOct: +octFrac(full, tr.note).toFixed(2),
        eqRawMed: median(rawPitchMidis(eq)), eqNotes: uniq(notesMidis(eq)), eqOct: +octFrac(eq, tr.note).toFixed(2),
        winner: bands.winner,
        bands: bands.bands.map(b => ({ n: b.name, L: +b.perceptualLoudness.toFixed(4), c: +b.meanClarity.toFixed(2), s: +b.score.toFixed(4), midi: (() => { const m = b.pitchTrack.filter(p => p.midi !== null).map(p => p.midi); return median(m) })() })),
      })
    }
    results.explore = cfgs
    return results
  }

  // ── THE VALUE TEST: octave error, full vs eq ─────────────────────────────────────────────
  {
    // Classic octave ambiguity: a LOW fundamental (G3≈196 Hz) whose 2nd harmonic (392 Hz) is
    // much LOUDER, with weak odd harmonics — so the full signal is ~periodic at T0/2 and YIN
    // reads an octave high. The fundamental sits alone in the BASS band (2f0 is up in MID).
    const NOTE = 55           // G3 (MIDI 55 ≈ 196 Hz)
    const H = [0.15, 1.0, 0.06, 0.6, 0.03, 0.35]   // 2f0 & 4f0 dominate; f0/3f0/5f0 weak
    const NOISE = 0.05
    const buf = renderTone(mtof(NOTE), H, 0.6, NOISE)
    const full = window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08, pitchSource: 'full' })
    const eq = window.__voiceAnalyzeBuffer(buf, SR, { minDuration: 0.08, pitchSource: 'eq' })
    const bands = window.__voiceAnalyzeBands(buf, SR, {})
    const fullRawMed = median(rawPitchMidis(full))
    const eqRawMed = median(rawPitchMidis(eq))
    results.octave = {
      trueMidi: NOTE,
      fullRawMed, eqRawMed,
      fullNotes: uniq(notesMidis(full)), eqNotes: uniq(notesMidis(eq)),
      winner: bands.winner,
      winnerIsLowMid: bands.winner === 'bass' || bands.winner === 'mid',
      // Full octave-errors HIGH on the raw curve; EQ returns the correct octave.
      fullOctaveError: fullRawMed !== null && fullRawMed - NOTE >= 8,
      eqCorrect: eqRawMed !== null && Math.abs(eqRawMed - NOTE) <= 1,
    }
  }

  // ── analyzeBands correctness on a normal vocal tone: 4 bands, numeric fields, bass/mid wins ──
  {
    const buf = renderTone(mtof(57), [1.0, 0.5, 0.3, 0.2, 0.12], 0.7, 0.02) // A3, natural rolloff
    const bands = window.__voiceAnalyzeBands(buf, SR, {})
    const ok4 = bands.bands.length === 4
    const numeric = bands.bands.every(b =>
      Number.isFinite(b.perceptualLoudness) && Number.isFinite(b.meanClarity) && Number.isFinite(b.score))
    results.bandsClean = {
      count: bands.bands.length, numeric, winner: bands.winner,
      winnerLowMid: bands.winner === 'bass' || bands.winner === 'mid',
      rows: bands.bands.map(b => ({ n: b.name, L: +b.perceptualLoudness.toFixed(4), c: +b.meanClarity.toFixed(2), s: +b.score.toFixed(4) })),
      pass: ok4 && numeric && (bands.winner === 'bass' || bands.winner === 'mid'),
    }
  }

  // ── Treble-heavy NOISE must NOT let treble win (clarity low in noise) ─────────────────────
  {
    // A real low tone (A3) buried under strong treble hiss. Treble has the most raw energy but
    // near-zero clarity, so perceptual-loudness × clarity must still crown a pitched low band.
    const tone = renderTone(mtof(57), [1.0, 0.4, 0.2], 0.7, 0.0)
    const noise = renderTone(1, [0], 0.7, 0.9) // pure treble hiss, same length
    const buf = new Float32Array(tone.length)
    for (let i = 0; i < buf.length; i++) buf[i] = tone[i] + noise[i]
    const bands = window.__voiceAnalyzeBands(buf, SR, {})
    const trebRow = bands.bands.find(b => b.name === 'treble')
    results.bandsNoise = {
      winner: bands.winner, trebleWon: bands.winner === 'treble',
      trebleClarity: +trebRow.meanClarity.toFixed(2),
      rows: bands.bands.map(b => ({ n: b.name, L: +b.perceptualLoudness.toFixed(4), c: +b.meanClarity.toFixed(2), s: +b.score.toFixed(4) })),
      pass: bands.winner !== 'treble',
    }
  }

  return results
}, { explore: EXPLORE })

// ── corr-fixture real take: default (full) must be 7; report EQ ─────────────────────────────
let real = null
if (take1) {
  real = await page.evaluate(({ samples, sampleRate }) => {
    const buf = Float32Array.from(samples)
    const full = window.__voiceAnalyzeBuffer(buf, sampleRate, { minDuration: 0.08 })
    const eq = window.__voiceAnalyzeBuffer(buf, sampleRate, { minDuration: 0.08, pitchSource: 'eq' })
    const bands = window.__voiceAnalyzeBands(buf, sampleRate, {})
    const uniq = a => [...new Set(a)].sort((x, y) => x - y)
    return {
      fullCount: full.notes.length, fullMidis: uniq(full.notes.map(n => n.midi)),
      eqCount: eq.notes.length, eqMidis: uniq(eq.notes.map(n => n.midi)),
      winner: bands.winner,
    }
  }, take1)
}

// ── Detect EQ panel renders after a real (synthetic) take ───────────────────────────────────
// Mock getUserMedia with a sung tone, record → stop (which stashes the take + refines), then
// click "Detect EQ" and assert the 4-band panel with a highlighted winner appears.
let panel = null
try {
  await page.evaluate(async () => {
    const AC = window.AudioContext || window.webkitAudioContext
    const ctx = new AC()
    const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 196 // G3
    const gain = ctx.createGain(); gain.gain.value = 0.3
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain); gain.connect(dest); osc.start()
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
    navigator.mediaDevices.getUserMedia = async () => dest.stream
    return true
  })
  // Record ~1.2s then stop.
  await page.click('[data-testid="vm-record"]')
  await page.waitForTimeout(1300)
  await page.click('[data-testid="vm-record"]')
  // Wait for the refine to settle + the Detect EQ button to be enabled, then click it.
  await page.waitForSelector('[data-testid="vm-detect-eq"]:not([disabled])', { timeout: 30000 })
  await page.click('[data-testid="vm-detect-eq"]')
  await page.waitForSelector('[data-testid="vm-eq-panel"]', { timeout: 15000 })
  panel = await page.evaluate(() => {
    const rows = ['sub', 'bass', 'mid', 'treble'].map(n => {
      const el = document.querySelector(`[data-testid="vm-eq-band-${n}"]`)
      return el ? { name: n, winner: el.getAttribute('data-eq-winner') === '1' } : null
    })
    return { present: !!document.querySelector('[data-testid="vm-eq-panel"]'), rows, winners: rows.filter(r => r && r.winner).length }
  })
} catch (e) {
  panel = { present: false, error: String(e).slice(0, 120) }
}

await browser.close()

if (EXPLORE) {
  console.log('════════ EXPLORATION ════════')
  for (const c of out.explore) {
    console.log(`note ${c.note} h=${JSON.stringify(c.h)} noise=${c.noise}`)
    console.log(`   full rawMed=${c.fullRawMed} oct%=${c.fullOct} notes=${JSON.stringify(c.fullNotes)}  |  eq rawMed=${c.eqRawMed} oct%=${c.eqOct} notes=${JSON.stringify(c.eqNotes)}  winner=${c.winner}`)
    console.log(`   bands: ${c.bands.map(b => `${b.n}(L${b.L} c${b.c} s${b.s} m${b.midi})`).join(' ')}`)
  }
  process.exit(0)
}

// ── Report ──────────────────────────────────────────────────────────────────────
const P = ok => ok ? '✓' : '✗'
let allPass = errors.length === 0
const rec = ok => { allPass = allPass && ok; return ok }

console.log('════════ THE VALUE TEST — octave error (full vs eq) ════════')
const o = out.octave
console.log(`   true note = MIDI ${o.trueMidi}`)
console.log(`   FULL raw-curve median MIDI = ${o.fullRawMed}  notes ${JSON.stringify(o.fullNotes)}`)
console.log(`   EQ   raw-curve median MIDI = ${o.eqRawMed}  notes ${JSON.stringify(o.eqNotes)}`)
console.log(`   dominant band = ${o.winner}`)
console.log(`   ${P(rec(o.fullOctaveError))} FULL octave-errors HIGH (≥ +8 semis) on the raw curve`)
console.log(`   ${P(rec(o.eqCorrect))} EQ returns the correct octave (±1 semitone)`)
console.log(`   ${P(rec(o.winnerIsLowMid))} dominant band is bass/mid (not treble)\n`)

console.log('════════ analyzeBands correctness (normal vocal tone) ════════')
const bc = out.bandsClean
console.log(`   bands=${bc.count} numeric=${bc.numeric} winner=${bc.winner}`)
console.log(`   ${bc.rows.map(r => `${r.n}(L${r.L} c${r.c} s${r.s})`).join('  ')}`)
console.log(`   ${P(rec(bc.pass))} 4 bands, numeric loudness/clarity/score, bass/mid winner\n`)

console.log('════════ treble noise must not win (clarity guard) ════════')
const bn = out.bandsNoise
console.log(`   winner=${bn.winner}  treble clarity=${bn.trebleClarity}`)
console.log(`   ${bn.rows.map(r => `${r.n}(L${r.L} c${r.c} s${r.s})`).join('  ')}`)
console.log(`   ${P(rec(bn.pass))} treble does NOT win under perceptual-loudness × clarity\n`)

console.log('════════ real corr-fixture take1.wav ════════')
if (real) {
  console.log(`   FULL (default): ${real.fullCount} notes  ${JSON.stringify(real.fullMidis)}`)
  console.log(`   EQ mode:        ${real.eqCount} notes  ${JSON.stringify(real.eqMidis)}  (winner ${real.winner})`)
  console.log(`   ${P(rec(real.fullCount === 7))} default (full) still 7 notes`)
} else {
  console.log('   (corr-fixture/take1.wav not found — skipped)')
}

console.log('\n════════ Detect EQ panel renders after a synthetic take ════════')
if (panel && panel.present) {
  const rows4 = panel.rows.filter(Boolean).length === 4
  console.log(`   panel present, ${panel.rows.filter(Boolean).length} band rows, ${panel.winners} winner highlighted`)
  console.log(`   ${P(rec(rows4 && panel.winners === 1))} 4 bands rendered with exactly one winner highlighted`)
} else {
  console.log(`   ✗ panel did not render ${panel ? JSON.stringify(panel) : ''}`)
  rec(false)
}

console.log(`\nConsole errors: ${errors.length}`)
for (const e of errors.slice(0, 8)) console.log('   [err]', e.slice(0, 160))
console.log(`\n${allPass ? '✓ ALL PASS' : '✗ SOME FAIL'}`)
process.exit(allPass ? 0 : 1)
