// Headless verification for the VoiceMidi offline render fixes.
//
// Proves the two root-cause fixes:
//   Cause 1 — offline detection now runs on RAW uncompressed PCM (stopAndGetPcm),
//             so it matches the live detector's quality instead of being handicapped
//             by an Opus decode. We record a KNOWN melody through a synthetic
//             getUserMedia tone-stream and compare synth / live / offline-PCM pitch.
//   Cause 2 — grid alignment is conditional on the metronome actually running, so a
//             take sung WITHOUT a click keeps its real onsets (no phantom snapping).
//
// Checks:
//   1. detector correctness: live-captured pitches AND offline-PCM notes both match
//      the synthesized melody (±1 semitone), reported side by side.
//   2. no phantom notes: every refined note overlaps a VOICED region of the curve,
//      and none sits over the silence gap.
//   3. grid-conditional: metro OFF → refined onsets == un-aligned offline onsets;
//      metro ON → alignment applies (aligned=true, raw preserved).
//   4. raw-PCM sanity: sane sampleRate + length ≈ duration × sampleRate.
//
//   node scripts/verify-voicemidi-render.mjs
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:3001'

// The known melody the fake mic will "sing" (contiguous tones + one silence gap).
// Sawtooth so it's harmonic-rich like a voice (exercises the octave-fold pass).
const MELODY = [
  { midi: 69, freq: 440.00, t0: 0.0, t1: 0.6 }, // A4
  { midi: 72, freq: 523.25, t0: 0.6, t1: 1.2 }, // C5
  { midi: 76, freq: 659.25, t0: 1.2, t1: 1.8 }, // E5
  // 1.8–2.2s: silence (an unvoiced gap — nothing should be transcribed here)
  { midi: 79, freq: 783.99, t0: 2.2, t1: 2.8 }, // G5
]
const EXPECTED = MELODY.map(n => n.midi)
const CAPTURE_S = 3.0

const browser = await chromium.launch({
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--disable-dev-shm-usage', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage()
const errors = []
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', e => errors.push('pageerror: ' + e.message))

// Override getUserMedia BEFORE the app loads with a WebAudio tone-stream that plays
// MELODY. Each note sets the oscillator frequency; the gap drops the gain to 0.
await page.addInitScript((melody) => {
  const build = () => {
    const AC = window.AudioContext || window.webkitAudioContext
    const ctx = new AC()
    const osc = ctx.createOscillator()
    osc.type = 'sawtooth'
    const gain = ctx.createGain()
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain); gain.connect(dest)
    const t = ctx.currentTime + 0.05
    gain.gain.setValueAtTime(0, t)
    for (const n of melody) {
      osc.frequency.setValueAtTime(n.freq, t + n.t0)
      gain.gain.setValueAtTime(0.3, t + n.t0)
      gain.gain.setValueAtTime(0.0, t + n.t1)  // off at note end (next note re-opens if contiguous)
    }
    osc.start(t)
    // Retain the whole graph on window — otherwise the AudioContext is GC'd once
    // only the stream is referenced, and the tone dies after a fraction of a second.
    ;(window.__fakeKeep = window.__fakeKeep || []).push({ ctx, osc, gain, dest })
    return dest.stream
  }
  if (!navigator.mediaDevices) {
    Object.defineProperty(navigator, 'mediaDevices', { value: {}, configurable: true })
  }
  navigator.mediaDevices.getUserMedia = async () => build()
}, MELODY)

console.log('→ opening', `${BASE}/apps/voicemidi`)
await page.goto(`${BASE}/apps/voicemidi`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => typeof window.__VoiceLivePitchDetector === 'function', null, { timeout: 60000 })
console.log('✓ VoiceMidi mounted (__VoiceLivePitchDetector ready)')

// Drive a real live + PCM capture, then analyze the RAW PCM offline.
const result = await page.evaluate(async ({ captureS, grid }) => {
  const Det = window.__VoiceLivePitchDetector
  const det = new Det()
  const live = []            // r.midi per frame (null → -1)
  await det.start(
    r => live.push(r ? r.midi : -1),
    true,                    // captureAudio → PCM tap on
    undefined,
    { gain: 1, rmsGate: 0.006, peakGate: 0.008, confidenceGate: 0.4 },
  )
  await new Promise(r => setTimeout(r, captureS * 1000))

  // Cause 1: grab RAW PCM (lossless) and analyze it offline.
  const pcm = det.stopAndGetPcm()
  det.stop()
  if (!pcm) return { ok: false, reason: 'no PCM captured' }

  const analysis = await window.__voiceAnalyzeBufferAsync(pcm.samples, pcm.sampleRate, {
    gain: 1, rmsGate: 0.006, minDuration: 0.08,
  })
  const notes = analysis.notes
  const curve = analysis.curve

  // Per-note voiced overlap (phantom-note guard).
  const notesInfo = notes.map(n => {
    const inSpan = curve.filter(f => f.time >= n.startSec && f.time <= n.startSec + n.durSec)
    const voiced = inSpan.filter(f => f.freq !== null && f.freq > 0).length
    return { startSec: n.startSec, midi: n.midi, durSec: n.durSec, frames: inSpan.length, voicedFrac: inSpan.length ? voiced / inSpan.length : 0 }
  })

  // Does the curve contain a genuine unvoiced gap between voiced regions?
  let firstVoiced = -1, lastVoiced = -1
  for (let i = 0; i < curve.length; i++) {
    const v = curve[i].freq !== null && curve[i].freq > 0
    if (v) { if (firstVoiced < 0) firstVoiced = i; lastVoiced = i }
  }
  let maxUnvoicedRun = 0, run = 0
  for (let i = firstVoiced; i <= lastVoiced && i >= 0; i++) {
    const v = curve[i].freq !== null && curve[i].freq > 0
    run = v ? 0 : run + 1
    if (run > maxUnvoicedRun) maxUnvoicedRun = run
  }

  // Cause 2: grid-conditional refinement (pure helper the widget uses).
  const gOpts = { bpm: grid.bpm, phaseSec: grid.phaseSec, division: grid.division }
  const off = window.__voiceConditionalGridAlign(notes, false, gOpts)
  const on  = window.__voiceConditionalGridAlign(notes, true,  gOpts)
  const onsetsEqual = off.refined.length === notes.length &&
    off.refined.every((n, i) => Math.abs(n.startSec - notes[i].startSec) < 1e-9)

  return {
    ok: true,
    live,
    notes: notes.map(n => n.midi),
    notesInfo,
    curveFrames: curve.length,
    maxUnvoicedRun,
    pcm: { length: pcm.samples.length, sampleRate: pcm.sampleRate },
    grid: {
      off: { aligned: off.aligned, rawRefinedNull: off.rawRefined === null, onsetsEqual },
      on:  { aligned: on.aligned, rawRefinedLen: on.rawRefined ? on.rawRefined.length : 0, refinedLen: on.refined.length },
    },
  }
}, { captureS: CAPTURE_S, grid: { bpm: 100, phaseSec: 0, division: 2 } })

await browser.close()

if (!result.ok) {
  console.log('✗ FAIL —', result.reason)
  process.exit(1)
}

// ── Reduce the live pitch stream to a stable ordered melody ────────────────────
// Group consecutive equal midis; keep runs of >= 5 frames (drops transient octave
// blips / attack frames); dedupe consecutive equals.
function stableSequence(arr, minRun = 5) {
  const runs = []
  let cur = null, len = 0
  for (const m of arr) {
    if (m === cur) { len++ }
    else { if (cur !== null && cur >= 0 && len >= minRun) runs.push(cur); cur = m; len = 1 }
  }
  if (cur !== null && cur >= 0 && len >= minRun) runs.push(cur)
  const out = []
  for (const m of runs) if (out.length === 0 || out[out.length - 1] !== m) out.push(m)
  return out
}
const uniqSorted = a => [...new Set(a)].sort((x, y) => x - y)
const setsMatch = (a, b) => {
  const A = uniqSorted(a), B = uniqSorted(b)
  return A.length === B.length && A.every((v, i) => Math.abs(v - B[i]) <= 1)
}

const liveSeq  = stableSequence(result.live)
const liveSet  = uniqSorted(liveSeq)
const offSet   = uniqSorted(result.notes)
const synthSet = uniqSorted(EXPECTED)

console.log('\n── Detector correctness (synth / live / offline-PCM) ──')
console.log('  synth       :', JSON.stringify(synthSet))
console.log('  live        :', JSON.stringify(liveSet), ' (seq', JSON.stringify(liveSeq) + ')')
console.log('  offline-PCM :', JSON.stringify(offSet), ' (notes', JSON.stringify(result.notes) + ')')

const liveOk    = setsMatch(liveSet, synthSet)
const offlineOk = setsMatch(offSet, synthSet)
const agreeOk   = setsMatch(liveSet, offSet)
console.log(`  ${liveOk ? '✓' : '✗'} live matches synth (±1)`)
console.log(`  ${offlineOk ? '✓' : '✗'} offline-PCM matches synth (±1)`)
console.log(`  ${agreeOk ? '✓' : '✗'} live and offline-PCM agree (±1)`)

console.log('\n── No phantom notes ──')
const allVoiced = result.notesInfo.every(n => n.voicedFrac >= 0.5)
for (const n of result.notesInfo) {
  console.log(`  note midi ${n.midi} @${n.startSec.toFixed(2)}s dur ${n.durSec.toFixed(2)}s — voiced ${Math.round(n.voicedFrac * 100)}% of ${n.frames} frames`)
}
const gapOk = result.maxUnvoicedRun >= 3   // the silence gap must actually register as unvoiced
console.log(`  ${allVoiced ? '✓' : '✗'} every note overlaps a voiced region (>=50%)`)
console.log(`  ${gapOk ? '✓' : '✗'} silence gap present in curve (max unvoiced run ${result.maxUnvoicedRun} frames)`)

console.log('\n── Grid-conditional ──')
console.log('  metro OFF:', JSON.stringify(result.grid.off))
console.log('  metro ON :', JSON.stringify(result.grid.on))
const offOk = result.grid.off.aligned === false && result.grid.off.rawRefinedNull && result.grid.off.onsetsEqual
const onOk  = result.grid.on.aligned === true && result.grid.on.rawRefinedLen === result.notes.length && result.grid.on.refinedLen > 0
console.log(`  ${offOk ? '✓' : '✗'} metro OFF keeps real onsets (no snap)`)
console.log(`  ${onOk ? '✓' : '✗'} metro ON applies grid alignment (raw preserved)`)

console.log('\n── Raw-PCM sanity ──')
const sr = result.pcm.sampleRate
const expLen = CAPTURE_S * sr
const lenOk = sr >= 8000 && result.pcm.length >= expLen * 0.8 && result.pcm.length <= expLen * 1.2
console.log(`  sampleRate ${sr} Hz, length ${result.pcm.length} (${(result.pcm.length / sr).toFixed(2)}s, expected ≈${CAPTURE_S}s)`)
console.log(`  ${lenOk ? '✓' : '✗'} PCM length ≈ duration × sampleRate`)

console.log('\nConsole errors:', errors.length)
for (const e of errors.slice(0, 10)) console.log('  [err]', e.slice(0, 200))

const pass = errors.length === 0 && liveOk && offlineOk && agreeOk && allVoiced && gapOk && offOk && onOk && lenOk
console.log(`\n${pass ? '✓ PASS' : '✗ FAIL'}`)
process.exit(pass ? 0 : 1)
