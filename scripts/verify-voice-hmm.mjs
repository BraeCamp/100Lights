/**
 * verify-voice-hmm.mjs — pure Node ESM verifier for lib/voice-hmm.ts.
 *
 * Compiles the module to a temp dir (tsc), imports it, and runs 6 synthetic
 * frame-sequence cases plus a decode-timing benchmark. No audio, no DOM.
 *
 *   node scripts/verify-voice-hmm.mjs
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = new URL('..', import.meta.url).pathname
const outDir = mkdtempSync(join(tmpdir(), 'voice-hmm-'))

console.log('Compiling lib/voice-hmm.ts …')
execSync(
  `npx tsc lib/voice-hmm.ts --outDir ${outDir} --rootDir lib ` +
    `--target es2022 --module esnext --moduleResolution bundler --skipLibCheck --strict`,
  { cwd: ROOT, stdio: 'inherit' },
)

const { trackNotesHMM } = await import(pathToFileURL(join(outDir, 'voice-hmm.js')).href)

const HOP = 0.01 // 10 ms

// ── Frame builders ─────────────────────────────────────────────────────────────

/** Push `n` voiced frames at `midi` (fractional ok) into `frames`; onset only on 1st. */
function pushNote(frames, n, midi, { onsetFirst = 1, conf = 0.9, energy = 0.7 } = {}) {
  for (let i = 0; i < n; i++) {
    frames.push({
      time: frames.length * HOP,
      midi,
      conf,
      onset: i === 0 ? onsetFirst : 0.0,
      energy,
    })
  }
}
function pushSilence(frames, n) {
  for (let i = 0; i < n; i++) {
    frames.push({ time: frames.length * HOP, midi: null, conf: 0.0, onset: 0.0, energy: 0.01 })
  }
}
function retime(frames) {
  frames.forEach((f, i) => (f.time = i * HOP))
  return frames
}

// ── Naive baseline: round each voiced frame, merge equal consecutive runs ────────
function naiveBaseline(frames, minDurSec = 0.06) {
  const notes = []
  let cur = null
  let start = 0
  let count = 0
  const flush = () => {
    if (cur != null && count * HOP >= minDurSec) notes.push({ midi: cur, startSec: start * HOP, durSec: count * HOP })
    cur = null
    count = 0
  }
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (f.midi == null || f.energy < 0.05) {
      flush()
      continue
    }
    const m = Math.round(f.midi)
    if (m !== cur) {
      flush()
      cur = m
      start = i
    }
    count++
  }
  flush()
  return notes
}

// ── Assertion helpers ───────────────────────────────────────────────────────────
let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}  ${detail}`)
  }
}
const pitches = (notes) => notes.map((n) => n.midi)

// ── Case 1: clean scale ─────────────────────────────────────────────────────────
console.log('\nCase 1 — clean C3→C4 scale (8 notes)')
const SCALE = [48, 50, 52, 53, 55, 57, 59, 60] // C3 D3 E3 F3 G3 A3 B3 C4
function buildScale() {
  const f = []
  for (const m of SCALE) pushNote(f, 25, m) // 25 frames = 250 ms each
  return retime(f)
}
{
  const frames = buildScale()
  const hmm = trackNotesHMM(frames)
  check('8 notes', hmm.length === 8, `got ${hmm.length}`)
  check('correct pitches', JSON.stringify(pitches(hmm)) === JSON.stringify(SCALE), `got ${pitches(hmm)}`)
  var case1 = { expected: SCALE.length, hmm: hmm.length, naive: naiveBaseline(frames).length }
}

// ── Case 2: robustness — corrupt ~18% of frames ─────────────────────────────────
console.log('\nCase 2 — corrupted scale (~18% frames: ±12 octave flips + ±1–2 semitone noise)')
function corrupt(frames, rng) {
  const out = frames.map((f) => ({ ...f }))
  let corrupted = 0
  for (let i = 0; i < out.length; i++) {
    if (out[i].midi == null) continue
    if (rng() < 0.18) {
      corrupted++
      const roll = rng()
      if (roll < 0.55) out[i].midi += rng() < 0.5 ? 12 : -12 // octave flip (YIN's classic failure)
      else out[i].midi += (rng() < 0.5 ? 1 : -1) * (rng() < 0.5 ? 1 : 2) // ±1–2 semitone
      // conf UNCHANGED (as specified)
    }
  }
  return { out, corrupted }
}
// small deterministic PRNG (mulberry32)
function mulberry32(seed) {
  return function () {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
{
  const clean = buildScale()
  const { out: frames, corrupted } = corrupt(clean, mulberry32(12345))
  const hmm = trackNotesHMM(frames)
  const naive = naiveBaseline(frames)
  const hmmPitchErr = pitches(hmm).length === SCALE.length
    ? pitches(hmm).reduce((a, p, i) => a + (p === SCALE[i] ? 0 : 1), 0)
    : NaN
  console.log(`  (${corrupted}/${clean.length} frames corrupted)`)
  check('HMM still 8 notes', hmm.length === 8, `got ${hmm.length}`)
  check('HMM correct pitches', JSON.stringify(pitches(hmm)) === JSON.stringify(SCALE), `got ${pitches(hmm)}`)
  check('naive baseline FAILS (>8 notes)', naive.length > 8, `naive got ${naive.length}`)
  var case2 = {
    expected: SCALE.length,
    hmm: hmm.length,
    hmmPitchErrors: Number.isNaN(hmmPitchErr) ? 'n/a' : hmmPitchErr,
    naive: naive.length,
    corrupted,
  }
}

// ── Case 3: re-articulation ─────────────────────────────────────────────────────
console.log('\nCase 3 — same pitch (60) with 3 onset spikes + energy dips → 3 notes')
{
  const f = []
  const SEG = 30 // frames per articulation
  for (let s = 0; s < 3; s++) {
    for (let i = 0; i < SEG; i++) {
      // small energy dip right before each onset (articulation gap), onset spike on first frame
      const energy = i === 0 ? 0.75 : i < 3 ? 0.4 : 0.7
      f.push({ time: 0, midi: 60, conf: 0.9, onset: i === 0 ? 1.0 : 0.0, energy })
    }
  }
  retime(f)
  const hmm = trackNotesHMM(f)
  check('3 notes', hmm.length === 3, `got ${hmm.length}`)
  check('all pitch 60', hmm.every((n) => n.midi === 60), `got ${pitches(hmm)}`)
  var case3 = { expected: 3, hmm: hmm.length, naive: naiveBaseline(f).length }
}

// ── Case 4: vibrato / wobble ────────────────────────────────────────────────────
console.log('\nCase 4 — one note (57) with ±40-cent vibrato, no onsets → 1 note')
{
  const f = []
  const N = 120
  for (let i = 0; i < N; i++) {
    const wobble = 0.4 * Math.sin((i / 8) * 2 * Math.PI) // ±0.4 semitone
    f.push({ time: 0, midi: 57 + wobble, conf: 0.9, onset: i === 0 ? 1.0 : 0.0, energy: 0.7 })
  }
  retime(f)
  const hmm = trackNotesHMM(f)
  check('1 note', hmm.length === 1, `got ${hmm.length}`)
  check('pitch 57', hmm[0]?.midi === 57, `got ${pitches(hmm)}`)
  var case4 = { expected: 1, hmm: hmm.length, naive: naiveBaseline(f).length }
}

// ── Case 5: silence gaps ────────────────────────────────────────────────────────
console.log('\nCase 5 — voiced / unvoiced(low energy) / voiced → 2 notes')
{
  const f = []
  pushNote(f, 30, 62)
  pushSilence(f, 20)
  pushNote(f, 30, 62)
  retime(f)
  const hmm = trackNotesHMM(f)
  check('2 notes', hmm.length === 2, `got ${hmm.length}`)
  // none of the notes should span the gap (all durations < full length)
  const spansGap = hmm.some((n) => n.durSec > 0.55)
  check('no note over the gap', !spansGap, `durs ${hmm.map((n) => n.durSec.toFixed(2))}`)
  var case5 = { expected: 2, hmm: hmm.length, naive: naiveBaseline(f).length }
}

// ── Case 6: consistent detune +35 cents ─────────────────────────────────────────
console.log("\nCase 6 — every frame +35 cents sharp, tuning='auto' → correct semitones")
{
  const f = []
  for (const m of SCALE) pushNote(f, 25, m + 0.35)
  retime(f)
  const hmm = trackNotesHMM(f, { tuning: 'auto' })
  check('8 notes', hmm.length === 8, `got ${hmm.length}`)
  check('rounds to correct semitones', JSON.stringify(pitches(hmm)) === JSON.stringify(SCALE), `got ${pitches(hmm)}`)
  // HONEST NOTE: tuning is recoverable only MOD 1 semitone. A single consistent offset
  // inside (0, 0.5) rounds to the same note with or without tuning (σ=0.6 + capped
  // emission + self-loop absorb it), and an offset ≥ 0.5 is inherently ambiguous (the
  // auto-estimate becomes offset−1 and also flips). So there is no clean single-offset
  // case where tuning=0 FAILS but auto RESCUES. Tuning's real value is de-biasing the
  // whole line (a flat/sharp singer stops accumulating systematic emission penalty) and
  // disambiguating near the half-semitone line under added noise. Assert auto matches
  // and does not harm, and that the emission is genuinely re-centred (WRONG tuning hurts).
  const f2 = []
  for (const m of SCALE) pushNote(f2, 25, m + 0.45)
  retime(f2)
  const hmmAuto = trackNotesHMM(f2, { tuning: 'auto' })
  const hmmWrong = trackNotesHMM(f2, { tuning: -0.6 }) // deliberately wrong tuning ⇒ mis-round
  check('+45c: auto-tuning correct', JSON.stringify(pitches(hmmAuto)) === JSON.stringify(SCALE), `got ${pitches(hmmAuto)}`)
  check('emission IS re-centred: wrong tuning mis-rounds', JSON.stringify(pitches(hmmWrong)) !== JSON.stringify(SCALE), `got ${pitches(hmmWrong)}`)
  var case6 = { expected: 8, hmm: hmm.length, naive: naiveBaseline(f).length }
}

// ── Timing: ~15 s / 1500-frame sequence ──────────────────────────────────────────
console.log('\nTiming — 1500-frame (~15 s) decode')
{
  const f = []
  const rng = mulberry32(777)
  const NOTES = 40
  for (let n = 0; n < NOTES; n++) {
    const midi = 48 + Math.floor(rng() * 24)
    for (let i = 0; i < 37; i++) {
      const noise = rng() < 0.15 ? (rng() < 0.5 ? 12 : 1) : 0
      f.push({ time: 0, midi: midi + noise, conf: 0.85, onset: i === 0 ? 1 : 0, energy: 0.7 })
    }
  }
  retime(f)
  const t0 = performance.now()
  const hmm = trackNotesHMM(f)
  const t1 = performance.now()
  var timing = { frames: f.length, ms: (t1 - t0).toFixed(2), notes: hmm.length }
  console.log(`  ${f.length} frames decoded in ${timing.ms} ms → ${hmm.length} notes`)
}

// ── Summary table ────────────────────────────────────────────────────────────────
console.log('\n── Summary: expected vs HMM vs naive-baseline ──')
const rows = [
  ['1 clean scale', case1.expected, case1.hmm, case1.naive],
  ['2 corrupted scale', case2.expected, `${case2.hmm} (pitchErr ${case2.hmmPitchErrors})`, case2.naive],
  ['3 re-articulation', case3.expected, case3.hmm, case3.naive],
  ['4 vibrato', case4.expected, case4.hmm, case4.naive],
  ['5 silence gaps', case5.expected, case5.hmm, case5.naive],
  ['6 detune +35c', case6.expected, case6.hmm, case6.naive],
]
console.log('  case                 | expected | HMM               | naive')
console.log('  ---------------------+----------+-------------------+------')
for (const [name, exp, hmm, naive] of rows) {
  console.log(`  ${name.padEnd(20)} | ${String(exp).padEnd(8)} | ${String(hmm).padEnd(17)} | ${naive}`)
}
console.log(`\n  corrupted-scale detail: ${case2.corrupted} frames corrupted; HMM ${case2.hmm} notes (${case2.hmmPitchErrors} pitch errors) vs naive ${case2.naive} notes`)
console.log(`  decode timing: ${timing.frames} frames in ${timing.ms} ms`)

rmSync(outDir, { recursive: true, force: true })
console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
