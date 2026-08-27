#!/usr/bin/env node --experimental-strip-types
// Where does each voice in the palette actually live, and what does the palette
// as a whole fail to cover?
//
// `apollo-voices.mjs --audit` already printed a centroid per voice, and that one
// number was not enough to see the problem. Every melodic voice read 200-400 Hz,
// which looks like a stylistic choice until you put it beside a reference: our
// songs carry 1.5% of their energy between 900 Hz and 5 kHz where ElevenLabs
// carries 5.4%, and the reason is that NOTHING in the palette lives there except
// hi-hats. A mix cannot be given a midrange it was never played.
//
// So this reports the full band profile per voice, at real playing pitches, and
// then sums the palette to show which bands are empty. Designing a voice is then
// a matter of watching the numbers move rather than hoping.
//
//   node --experimental-strip-types scripts/voice-audit.mjs [--only=keys] [--json]

import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readWav } from './lib/offline-dsp.mjs'
import { spectralProfile, levels, BANDS } from './lib/audio-features.mjs'
import { VOICES } from './apollo-voices.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const only = argv.find(a => a.startsWith('--only='))?.split('=')[1]
const asJson = argv.includes('--json')

const tmp = mkdtempSync(join(tmpdir(), 'voice-audit-'))

/** Render one voice at its own idiomatic notes and measure the result. */
export function measureVoice(name, v) {
  const pf = join(tmp, `${name}.json`), wf = join(tmp, `${name}.wav`)
  writeFileSync(pf, JSON.stringify(v.build()))
  execFileSync('node', ['--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
    '--patch', pf, '--notes', v.notes, '--seconds', String(v.seconds), '--out', wf, '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  const w = readWav(readFileSync(wf))
  const mono = new Float32Array(w.l.length)
  for (let i = 0; i < mono.length; i++) mono[i] = (w.l[i] + w.r[i]) * 0.5
  const sp = spectralProfile(mono, w.sr)
  const lv = levels(w.l, w.r)
  return { name, ...sp, peak: lv.peak, rmsDb: lv.rmsDb, silent: lv.peak < 0.0005 }
}

// ── Tuning ──────────────────────────────────────────────────────────────────
// Apollo's `detune` is a WIDTH across the unison voices. At unison 2 there is no
// middle voice — both copies sit at the extremes, the lower one dominates, and
// the whole instrument is dragged flat. That was diagnosed once, fixed in ONE
// SONG FILE, and left in the library, so every song built afterwards inherited
// it: Winter Drift's strings render 27 cents flat, a quarter of a semitone.
//
// Measured here so it cannot come back: unison 2 at detune 0.38 lands -22.5c,
// while unison 3 at the same detune lands -7.5c because a centre voice exists.
// The rule is therefore unison >= 3, or detune <= 0.05.
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12)
const centsOf = (f, ref) => 1200 * Math.log2(f / ref)

/** Power-weighted centre of gravity within +/-150 cents of the written note.
 *  Bounded on purpose: a sub bass is a fundamental plus a deliberate octave-down
 *  oscillator, and an unbounded detector reports that as 1200 cents flat. */
function centrePitch(sig, sr, note) {
  const f0 = midiHz(note)
  const lo = f0 * Math.pow(2, -150 / 1200), hi = f0 * Math.pow(2, 150 / 1200)
  const N = 1 << 15
  const start = Math.floor(sig.length * 0.3)
  let num = 0, den = 0
  for (let f = lo; f <= hi; f += 0.05) {
    let re = 0, im = 0
    for (let i = 0; i < N && start + i < sig.length; i++) {
      const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)
      const a = 2 * Math.PI * f * i / sr
      re += sig[start + i] * w * Math.cos(a); im += sig[start + i] * w * Math.sin(a)
    }
    const p = re * re + im * im
    num += f * p; den += p
  }
  return den > 0 ? num / den : 0
}

const PERC_NAME = /kick|snare|hat|tick|cowbell/
function checkTuning(name, v) {
  const written = Number(String(v.notes).split(',')[0].split(':')[0])
  // A voice that is deliberately transposed sounds where it was TOLD to sound,
  // not at the written note. `boom` puts osc A an octave down, and comparing its
  // output against the written pitch reported it 84 cents flat — a misread of
  // exactly the kind check-tuning was built to stop making, so the offset is
  // taken from the patch rather than assumed to be zero.
  const patch = v.build()
  const o0 = patch.oscs?.[0]
  const shift = o0 && o0.enabled && o0.keytrackPitch !== false
    ? (o0.octave ?? 0) * 12 + (o0.semi ?? 0)
    : 0
  const note = written + shift
  const pf = join(tmp, `${name}-t.json`), wf = join(tmp, `${name}-t.wav`)
  writeFileSync(pf, JSON.stringify(patch))
  execFileSync('node', ['--experimental-strip-types', join(ROOT, 'scripts/apollo-render.mjs'),
    '--patch', pf, '--notes', `${written}:0:1.5`, '--seconds', '2', '--out', wf, '--json'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })
  const w = readWav(readFileSync(wf))
  const mono = Float32Array.from(w.l, (x, i) => (x + w.r[i]) * 0.5)
  // Below about 50 Hz this measurement cannot be trusted and must not be
  // reported as though it could. The detector sweeps a DFT over a 32768-sample
  // window, whose main lobe is ~1.5 Hz wide; at 30 Hz that is 82 cents of
  // smear, and on a voice with a pitch envelope and tremolo sidebands the
  // weighted centre wanders well past the 8-cent threshold. `boom` read +20.7c,
  // and compensating by -21 cents made it read +27.5 — which is what chasing a
  // measurement rather than a sound looks like. Above ~110 Hz the resolution is
  // 23 cents and falling, and the estimate is a centroid rather than a
  // peak-pick, so it stays usable; down here it is not.
  const f = centrePitch(mono, w.sr, note)
  if (f > 0 && f < 50) return null
  return f > 0 ? +centsOf(f, midiHz(note)).toFixed(1) : null
}

const rows = []
for (const [name, v] of Object.entries(VOICES)) {
  if (only && !name.includes(only)) continue
  try {
    const r = measureVoice(name, v)
    if (!PERC_NAME.test(name) && !r.silent) { try { r.cents = checkTuning(name, v) } catch { r.cents = null } }
    rows.push(r)
  }
  catch (e) { rows.push({ name, error: String(e.message).split('\n')[0].slice(0, 80) }) }
}
rmSync(tmp, { recursive: true, force: true })

const OUT_OF_TUNE = rows.filter(r => r.cents != null && Math.abs(r.cents) > 8)

if (asJson) { console.log(JSON.stringify(rows, null, 2)); process.exit(0) }

const names = BANDS.map(b => b[0])
console.log('\nvoice        rms   centroid  tune  ' + names.map(n => n.slice(0, 6).padStart(7)).join(''))
console.log('─'.repeat(84))
for (const r of rows) {
  if (r.error) { console.log(`${r.name.padEnd(12)} ERROR ${r.error}`); continue }
  const tune = r.cents == null ? '   —' : `${r.cents > 0 ? '+' : ''}${r.cents}`.padStart(6)   // — = percussive, or too low to measure
  console.log(`${r.name.padEnd(12)}${String(r.rmsDb).padStart(6)}${String(r.centroidHz).padStart(10)}Hz${tune}` +
    names.map(n => (r.bands[n] * 100).toFixed(1).padStart(7)).join('') + (r.silent ? '  ** SILENT **' : ''))
}
if (OUT_OF_TUNE.length) {
  console.log(`\n** OUT OF TUNE — a voice more than 8 cents off is audible as sour, not warm:`)
  for (const r of OUT_OF_TUNE) console.log(`   ${r.name}  ${r.cents > 0 ? '+' : ''}${r.cents}¢   → use unison ≥3 (a centre voice holds the pitch) or detune ≤0.05`)
}

// ── Palette coverage ────────────────────────────────────────────────────────
// Weight every voice equally: this asks what the palette OFFERS, not what any
// one song happens to use. A band that no voice can reach is a band the music
// cannot have.
const ok = rows.filter(r => !r.error && !r.silent)
console.log('\nPALETTE COVERAGE — how many voices put at least 10% of their energy in each band')
for (const n of names) {
  const owners = ok.filter(r => r.bands[n] >= 0.10).map(r => r.name)
  const bar = '█'.repeat(owners.length) || '·'
  console.log(`  ${n.padEnd(11)}${String(owners.length).padStart(3)}  ${bar.padEnd(10)} ${owners.join(', ') || 'NOTHING LIVES HERE'}`)
}

// The pitched voices are the ones that carry the music; percussion filling a
// band is not the same as the harmony being audible there.
const PERC = /kick|snare|hat|tick|cowbell/
const pitched = ok.filter(r => !PERC.test(r.name))
console.log('\n  …counting only the PITCHED voices (percussion cannot carry harmony):')
for (const n of names) {
  const owners = pitched.filter(r => r.bands[n] >= 0.10).map(r => r.name)
  console.log(`  ${n.padEnd(11)}${String(owners.length).padStart(3)}  ${owners.join(', ') || '← gap'}`)
}
console.log('')
process.exit(OUT_OF_TUNE.length ? 1 : 0)
