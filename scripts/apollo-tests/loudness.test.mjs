#!/usr/bin/env node
// Measuring how loud something actually sounds.
//
//   node --experimental-strip-types scripts/apollo-tests/loudness.test.mjs
//
// ⚠️ The whole reason this exists rather than an RMS one-liner: RMS says a bass
// and a hi-hat at the same number are equally loud, and they are nowhere near.
// Matching two tracks by RMS leaves the bass booming and the vocal buried,
// which is the exact fault "match these two" is asked to fix. So the tests that
// matter here are the ones a plain RMS would fail.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { loudnessLufs, matchGainDb, applyGainDb } = await importTs('lib/loudness.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const SR = 48000
const tone = (hz, secs, amp = 0.5) => {
  const n = Math.round(secs * SR)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = Math.sin(2 * Math.PI * hz * i / SR) * amp
  return out
}
const rmsDb = x => {
  let s = 0
  for (let i = 0; i < x.length; i++) s += x[i] * x[i]
  return 10 * Math.log10(s / x.length)
}

// ── The calibration the standard defines ───────────────────────────────────
// A 1 kHz sine at -20 dBFS reads -20 LUFS on one channel pair. This is the
// number that says the filters and the -0.691 offset are right rather than
// merely self-consistent.
{
  const amp = Math.pow(10, -20 / 20) * Math.SQRT2   // -20 dBFS RMS
  const r = loudnessLufs([tone(1000, 3, amp)], SR)
  check('a 1 kHz tone at -20 dBFS reads about -20 LUFS',
    Math.abs(r.lufs + 20) < 0.6, `${r.lufs.toFixed(2)} LUFS`)
}

// ── The thing RMS gets wrong ───────────────────────────────────────────────
// Same RMS, wildly different loudness: 60 Hz is barely weighted, 3 kHz sits at
// the top of the curve. A measurement that called these equal would be the
// reason a balanced mix still sounded wrong.
{
  const low = tone(60, 3, 0.5)
  const high = tone(3000, 3, 0.5)
  check('RMS says these two are identical',
    Math.abs(rmsDb(low) - rmsDb(high)) < 0.1,
    `${rmsDb(low).toFixed(2)} vs ${rmsDb(high).toFixed(2)} dB`)
  const l = loudnessLufs([low], SR).lufs
  const h = loudnessLufs([high], SR).lufs
  // About 7 LU apart: the RLB high-pass costs the 60 Hz tone roughly 3 dB and
  // the shelf gives the 3 kHz one its full +4. K-weighting is a gentle curve,
  // not a drastic one — an earlier version of this test asserted 8 LU and was
  // simply wrong about the shape of the thing it was measuring.
  check('and K-weighting hears the 3 kHz one clearly louder', h - l > 5,
    `${l.toFixed(1)} vs ${h.toFixed(1)} LUFS — ${(h - l).toFixed(1)} LU apart`)
}

// ── Level, and only level, moves the number ────────────────────────────────
{
  const a = loudnessLufs([tone(1000, 2, 0.5)], SR).lufs
  const b = loudnessLufs([tone(1000, 2, 0.25)], SR).lufs
  check('halving the amplitude costs about 6 LU', Math.abs((a - b) - 6.02) < 0.2,
    `${(a - b).toFixed(2)} LU`)
}

// ── Gating ─────────────────────────────────────────────────────────────────
// ⚠️ The musical point of the gate. A sparse part is not a quiet part: without
// gating, silence between hits drags the average down and matching would turn
// the sparse track up until its hits were far too loud.
{
  const dense = tone(1000, 4, 0.4)
  const sparse = new Float32Array(dense.length)
  // Same hits, quarter of the time — three seconds of nothing between them.
  for (let s = 0; s < 4; s++) {
    const at = Math.round(s * SR)
    const hit = tone(1000, 0.25, 0.4)
    for (let i = 0; i < hit.length && at + i < sparse.length; i++) sparse[at + i] = hit[i]
  }
  const d = loudnessLufs([dense], SR).lufs
  const sp = loudnessLufs([sparse], SR).lufs
  check('a sparse part is not measured as a quiet one', Math.abs(d - sp) < 4,
    `dense ${d.toFixed(1)} vs sparse ${sp.toFixed(1)} LUFS`)
  // The same comparison without gating is what the gate is protecting against.
  check('where plain RMS would call it 6 dB quieter',
    rmsDb(dense) - rmsDb(sparse) > 4,
    `${(rmsDb(dense) - rmsDb(sparse)).toFixed(1)} dB apart by RMS`)
}

// ── Silence and edges ──────────────────────────────────────────────────────
{
  check('silence is not a level', loudnessLufs([new Float32Array(SR)], SR).lufs === -Infinity)
  check('nothing at all is handled', loudnessLufs([], SR).lufs === -Infinity)
  // Shorter than one 400ms window — a one-shot IS something people match.
  const short = loudnessLufs([tone(1000, 0.1, 0.5)], SR)
  check('a clip shorter than the window still measures', Number.isFinite(short.lufs),
    `${short.lufs.toFixed(1)} LUFS`)
  check('and the peak is reported', Math.abs(short.peak - 0.5) < 0.01, String(short.peak.toFixed(3)))
}

// ── Two channels ───────────────────────────────────────────────────────────
{
  const mono = loudnessLufs([tone(1000, 2, 0.5)], SR).lufs
  const stereo = loudnessLufs([tone(1000, 2, 0.5), tone(1000, 2, 0.5)], SR).lufs
  // The same signal in both channels is 3 LU louder, which is what summing two
  // equally-weighted channels does.
  check('the same signal in stereo is 3 LU louder', Math.abs((stereo - mono) - 3.01) < 0.2,
    `${(stereo - mono).toFixed(2)} LU`)
}

// ── Turning one into the other ─────────────────────────────────────────────
{
  check('matching gives the difference', Math.abs(matchGainDb(-24, -18) - 6) < 1e-9)
  // ⚠️ Clamped: the honest answer to "this track is 40 dB quiet" is that it is
  // silent, and acting on it would blow up the mix rather than balance it.
  check('and refuses to make an enormous move', matchGainDb(-70, -18) === 18)
  check('a silent track is left alone', matchGainDb(-Infinity, -18) === 0)

  check('a fader move of +6 dB doubles it', Math.abs(applyGainDb(0.4, 6.02) - 0.8) < 0.01,
    String(applyGainDb(0.4, 6.02).toFixed(3)))
  check('and a fader cannot be pushed past its top', applyGainDb(1.4, 12) <= 1.5)
  check('nor below zero', applyGainDb(0.1, -80) >= 0)
}

console.log(failures ? `\n${failures} failing` : '\nloudness is measured the way it is heard')
assert.equal(failures, 0)
