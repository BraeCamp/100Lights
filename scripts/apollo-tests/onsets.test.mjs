#!/usr/bin/env node
// Finding the moment a sound starts.
//
//   node --experimental-strip-types scripts/apollo-tests/onsets.test.mjs
//
// Brae: "the program connects those names to the audio spikes from the user
// saying the words to place the applicable instrument."
//
// The signals here are synthetic on purpose: a real recording cannot tell you
// whether the detector is right, only whether it looks plausible. Built ones
// have a known answer, so "found five hits at 0, 0.25, 0.5, 1.0, 1.25" is a
// fact rather than an impression.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { detectOnsets, alignToOnsets } = await importTs('lib/onsets.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const SR = 48000

/** A syllable: a sharp attack and a short decay, like a spoken consonant. */
function say(buf, at, { gain = 0.6, ms = 120, freq = 220 } = {}) {
  const start = Math.round(at * SR)
  const len = Math.round(ms / 1000 * SR)
  for (let i = 0; i < len; i++) {
    const env = Math.exp(-i / (len * 0.35))
    // Noise plus a tone — a vowel has pitch, a consonant does not, and a
    // detector that only works on one of them is no use.
    const n = (Math.sin(2 * Math.PI * freq * i / SR) * 0.6 + (rnd() * 2 - 1) * 0.4)
    if (start + i < buf.length) buf[start + i] += n * env * gain
  }
}
// Deterministic noise: a test that fails one run in ten teaches nothing.
let seed = 12345
function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 }

const silence = secs => new Float32Array(Math.round(secs * SR))
const near = (a, b, tol = 0.03) => Math.abs(a - b) <= tol

// ── The basic job ──────────────────────────────────────────────────────────
{
  const buf = silence(3)
  const at = [0.20, 0.45, 0.70, 1.20, 1.45]
  for (const t of at) say(buf, t)
  const on = detectOnsets(buf, SR)
  check('every syllable is found', on.length === at.length, `${on.length} of ${at.length}`)
  const times = on.map(o => o.t)
  check('and at the right moments', at.every((t, i) => near(times[i], t)),
    times.map(t => t.toFixed(3)).join(', '))
}

// ── Quiet room, loud room ──────────────────────────────────────────────────
// ⚠️ The failure a fixed threshold gives you: somebody leans back mid-take and
// the second half of the bar vanishes.
{
  const buf = silence(3)
  say(buf, 0.2, { gain: 0.9 })
  say(buf, 0.6, { gain: 0.5 })
  say(buf, 1.0, { gain: 0.22 })
  say(buf, 1.4, { gain: 0.12 })
  const on = detectOnsets(buf, SR)
  check('a fading voice is still heard to the end', on.length === 4, `${on.length} of 4`)
}

// ── A held sound is not four onsets ────────────────────────────────────────
// The reason the detector looks at the RISE and not the level.
{
  const buf = silence(2)
  const len = Math.round(0.8 * SR)
  for (let i = 0; i < len; i++) buf[Math.round(0.3 * SR) + i] = Math.sin(2 * Math.PI * 200 * i / SR) * 0.5
  const on = detectOnsets(buf, SR)
  check('a held note is one onset, not many', on.length === 1, `${on.length}`)
}

// ── One syllable is one hit ────────────────────────────────────────────────
// "ka" has a burst then a vowel. Two rises, one hit.
{
  const buf = silence(2)
  say(buf, 0.5, { ms: 40, freq: 3000, gain: 0.7 })   // the k
  say(buf, 0.53, { ms: 140, freq: 300, gain: 0.6 })  // the aa
  const on = detectOnsets(buf, SR)
  check('a two-part syllable is one hit', on.length === 1, `${on.length} at ${on.map(o => o.t.toFixed(3))}`)
}

// ── Fast is still separate ─────────────────────────────────────────────────
// 16ths at 160bpm are 94ms apart, which must NOT merge.
{
  const buf = silence(2)
  const gap = 60 / 160 / 4
  const at = [0.3, 0.3 + gap, 0.3 + gap * 2, 0.3 + gap * 3]
  for (const t of at) say(buf, t, { ms: 60 })
  const on = detectOnsets(buf, SR)
  check('sixteenths at 160bpm stay four hits', on.length === 4, `${on.length} at ${on.map(o => o.t.toFixed(3))}`)
}

// ── Silence is silence ─────────────────────────────────────────────────────
{
  check('an empty recording has no onsets', detectOnsets(silence(1), SR).length === 0)
  const room = silence(2)
  for (let i = 0; i < room.length; i++) room[i] = (rnd() * 2 - 1) * 0.002
  check('and room tone is not a drum part', detectOnsets(room, SR).length <= 1,
    String(detectOnsets(room, SR).length))
}

// ── Words take their time from the spikes ──────────────────────────────────
{
  const onsets = [{ t: 0.500, strength: 1 }, { t: 0.740, strength: 0.8 }, { t: 1.010, strength: 0.9 }]
  // The recogniser's times, each drifting late by a different amount — which is
  // exactly what makes them unusable for rhythm and fine for identity.
  const words = [{ word: 'kick', s: 0.54 }, { word: 'clap', s: 0.80 }, { word: 'kick', s: 1.04 }]
  const aligned = alignToOnsets(words, onsets)
  check('each word moves to its spike',
    aligned.every((w, i) => near(w.s, onsets[i].t, 0.001)),
    aligned.map(w => w.s.toFixed(3)).join(', '))
  check('and says where its time came from', aligned.every(w => w.from === 'onset'))
  check('carrying the strength for velocity', aligned[0].strength === 1)
}

// ⚠️ In ORDER, not nearest. With drifting times, nearest-neighbour lets two
// words claim one spike and drops a hit — the bug this pairing exists to avoid.
{
  const onsets = [{ t: 1.00, strength: 1 }, { t: 1.10, strength: 1 }, { t: 1.20, strength: 1 }]
  const words = [{ word: 'a', s: 1.09 }, { word: 'b', s: 1.11 }, { word: 'c', s: 1.13 }]
  const aligned = alignToOnsets(words, onsets)
  check('three words claim three different spikes',
    new Set(aligned.map(w => w.s)).size === 3, aligned.map(w => w.s.toFixed(2)).join(', '))
}

// A word with no spike near it keeps its own time rather than inventing one.
{
  const aligned = alignToOnsets([{ word: 'x', s: 5.0 }], [{ t: 0.1, strength: 1 }])
  check('an unmatched word keeps its own time', aligned[0].s === 5.0 && aligned[0].from === 'word')
}

console.log(failures ? `\n${failures} failing` : '\nthe spikes are found and the words sit on them')
assert.equal(failures, 0)
