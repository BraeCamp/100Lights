// Prove the pitch detector before trusting anything it says about a song.
//
//   npm run test:tuning
//
// The first version of check-tuning reported Sub, Bass and Hats as 1200 cents
// flat. That is not a tuning error, it is the detector locking onto a
// subharmonic — plain autocorrelation always finds a second peak at twice the
// period, so it drifts an octave down on anything with a strong fundamental.
// Had I passed that on, it would have sent someone hunting a bug in a bass part
// that was perfectly in tune.
//
// So: synthesise signals whose pitch is known exactly, and check the detector
// returns it. Cents are a demanding unit — 5 cents is 0.3% — and the octave
// cases are the ones that actually failed, so they are the ones tested hardest.

import assert from 'node:assert'
import { pitchOf, beatOf } from './check-tuning.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const RATE = 48000
const midiHz = m => 440 * Math.pow(2, (m - 69) / 12)

/** A tone with harmonics — a bare sine is far easier than anything real. */
function tone(hz, seconds = 3, harmonics = [1, 0.5, 0.32, 0.2, 0.12], detuneCents = 0) {
  const f = hz * Math.pow(2, detuneCents / 1200)
  const n = Math.floor(RATE * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    let v = 0
    harmonics.forEach((a, h) => { v += a * Math.sin(2 * Math.PI * f * (h + 1) * t) })
    out[i] = v * 0.25
  }
  return out
}

/** Two copies a given number of cents apart — what unison detune really is. */
function detunedPair(hz, spreadCents, seconds = 3) {
  const a = tone(hz, seconds, [1, 0.5, 0.32, 0.2, 0.12], -spreadCents / 2)
  const b = tone(hz, seconds, [1, 0.5, 0.32, 0.2, 0.12], +spreadCents / 2)
  const out = new Float32Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) * 0.5
  return out
}

// ── It finds the right note, in every register ──────────────────────────────
for (const midi of [36, 48, 60, 67, 72, 79]) {
  const hz = midiHz(midi)
  const r = pitchOf(tone(hz), RATE, hz)
  const ok = r && Math.abs(r.err) < 5
  check(`MIDI ${midi} (${hz.toFixed(1)}Hz) reads in tune`, ok, r ? `${r.err.toFixed(1)}¢` : '(nothing)')
}

// ── The failure that started this: it must NOT drop an octave ───────────────
for (const midi of [36, 41, 48]) {
  const hz = midiHz(midi)
  // A strong fundamental with weak upper harmonics is the shape that fooled the
  // old detector — bass parts look exactly like this.
  const r = pitchOf(tone(hz, 3, [1, 0.15, 0.06]), RATE, hz)
  const ok = r && Math.abs(r.err) < 20
  check(`low ${hz.toFixed(1)}Hz is not heard an octave down`, ok, r ? `${r.err.toFixed(1)}¢` : '(nothing)')
}

// ── It reports pitch error accurately, with the right sign ──────────────────
for (const off of [-40, -18, -7, 7, 18, 40]) {
  const hz = midiHz(60)
  const r = pitchOf(tone(hz, 3, [1, 0.5, 0.32], off), RATE, hz)
  const ok = r && Math.abs(r.err - off) < 6
  check(`${off > 0 ? '+' : ''}${off}¢ detuned reads as about ${off}¢`, ok, r ? `${r.err.toFixed(1)}¢` : '(nothing)')
}

// ── Unison spread shows up as BEATING, which is what the ear objects to ─────
//
// Not as pitch movement: two steady detuned copies keep a perfectly steady
// period between them. Measuring pitch stability found nothing here (1¢ against
// 0¢) and the first version of this test passed anyway, on a comparison so weak
// it would have passed on noise. The symptom is in the amplitude.
{
  const hz = midiHz(55)                                    // G3, 196Hz
  const steady = beatOf(tone(hz), RATE)
  const tight  = beatOf(detunedPair(hz, 8), RATE)
  const wide   = beatOf(detunedPair(hz, 92), RATE)

  check('a single tone barely throbs at all', steady && steady.depth < 0.05,
    steady ? `depth ${steady.depth.toFixed(3)}` : '(nothing)')

  // The discriminator is the RATE, not the depth — I had this backwards.
  //
  // Two copies of equal loudness cancel and reinforce completely whatever their
  // spacing, so the depth is near-total either way; a tight ±4¢ unison measured
  // 0.38 and the horrible ±46¢ one measured 0.34. What separates lush from sour
  // is how FAST it swings, and that follows straight from the arithmetic: the
  // beat rate is the frequency difference. At G3, 8 cents apart is 0.9Hz — a
  // slow swell you hear as richness. 92 cents apart is 10.2Hz — a flutter the
  // ear reads as two instruments failing to agree.
  check('a tight ±4¢ unison beats slowly, like chorus',
    tight && tight.rate < 2.5, tight ? `${tight.rate.toFixed(1)}Hz` : '(nothing)')
  check('a 92¢-wide unison beats fast enough to sound rough',
    wide && wide.rate > 6, wide ? `${wide.rate.toFixed(1)}Hz` : '(nothing)')
  check('and the rate matches the arithmetic (~10.2Hz)',
    wide && Math.abs(wide.rate - 10.2) < 2.5, wide ? `${wide.rate.toFixed(1)}Hz vs 10.2Hz` : '(nothing)')
  check('both are genuinely modulating, so rate is meaningful',
    tight && wide && tight.depth > 0.15 && wide.depth > 0.15,
    `${tight?.depth.toFixed(2)} / ${wide?.depth.toFixed(2)}`)
}

// ── Silence is reported as "no pitch", never as a wrong one ─────────────────
{
  const r = pitchOf(new Float32Array(RATE * 2), RATE, midiHz(60))
  check('silence returns no pitch rather than a guess', r === null, r ? `got ${r.hz.toFixed(1)}Hz` : '')
}

console.log(failures ? `\n${failures} failing` : '\nthe pitch detector can be trusted')
assert.equal(failures, 0)
