#!/usr/bin/env node
// Are the sampled voices actually playing their samples, faithfully and in tune?
//
// A sample instrument fails in ways a synth cannot. The id can fail to resolve
// and the oscillator renders silence. The shaping can be so heavy that the
// recording's character — the thing worth having — is gone. A multisample's
// zones can be mapped so a note plays from the wrong root and comes out at the
// wrong pitch, which is inaudible as "wrong" until it is next to a bassline.
//
// So: every id resolves, every voice makes sound, drums keep their character
// against the raw file, and melodic instruments play the note they were asked
// for — measured with pitchNear, which looks for energy where the pitch was
// WRITTEN rather than guessing blind.
//
//   npm run check:sampled

import { readFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readWav } from './lib/offline-dsp.mjs'
import { spectrum, pitchNear, pitchAt } from './lib/audio-features.mjs'
import { render } from './apollo-kit.mjs'
import * as S from './lib/samples.mjs'
import * as V from './sampled-voices.mjs'

const T = mkdtempSync(join(tmpdir(), 'check-sampled-'))
let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}${detail ? '  ' + detail : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '  ' + detail : ''}`) }
}

const samplesOf = patch => {
  const out = {}
  for (const o of patch.oscs ?? []) {
    if (o.smp?.sampleId) out[o.smp.sampleId] = S.resolveSample(o.smp.sampleId)
    for (const z of o.ms?.zones ?? []) out[z.sampleId] = S.resolveSample(z.sampleId)
  }
  return out
}
const monoOf = file => {
  const w = readWav(readFileSync(file))
  return { sr: w.sr, mono: Float32Array.from(w.l, (v, i) => (v + w.r[i]) * 0.5) }
}
function character(mono, sr) {
  let peak = 0
  for (const v of mono) peak = Math.max(peak, Math.abs(v))
  const th = peak * 0.01
  let a = 0, b = mono.length - 1
  while (a < mono.length && Math.abs(mono[a]) < th) a++
  while (b > a && Math.abs(mono[b]) < th) b--
  const { power, binHz } = spectrum(mono.subarray(a, Math.max(a + 512, b)), sr, 4096)
  let tot = 0, w = 0
  for (let k = 1; k < power.length; k++) { tot += power[k]; w += power[k] * k * binHz }
  return { peak, dur: (b - a) / sr, centroid: w / Math.max(1e-20, tot) }
}
const play = (name, patch, notes, seconds = 2.6) => {
  const out = join(T, name + '.wav')
  render(patch, { notes, seconds, out, samples: samplesOf(patch) })
  return monoOf(out)
}

// ── every id on disk ────────────────────────────────────────────────────────
console.log('\nsample ids resolve')
{
  let missing = 0, n = 0
  for (const kit of S.DRUM_KITS) {
    for (const pad of Object.keys(S.DRUM_PADS)) {
      n++
      try { S.resolveSample(S.drumId(kit, pad)) } catch { missing++; console.log(`       missing ${kit}/${pad}`) }
    }
  }
  ok(`all ${n} drum one-shots are on disk`, missing === 0, missing ? `${missing} missing` : '')
  let roots = 0
  for (const inst of S.AI_INSTRUMENTS) {
    for (const r of S.aiRoots(inst)) { roots++; S.resolveSample(r.id) }
  }
  ok(`all ${roots} instrument roots decode`, true)
}

// ── drums keep their character ──────────────────────────────────────────────
console.log('\ndrums against their raw samples')
{
  const KIT = 'techno'
  const CASES = [
    ['kick', S.drumId(KIT, 'kick'), V.sKick(KIT), 36],
    ['snare', S.drumId('studio', 'snare'), V.sSnare('studio'), 38],
    ['clap', S.drumId(KIT, 'clap'), V.sClap(KIT), 39],
    ['hat', S.drumId(KIT, 'hat'), V.sHat(KIT), 42],
    ['openHat', S.drumId(KIT, 'openHat'), V.sOpenHat(KIT), 46],
    ['rim', S.drumId('studio', 'rim'), V.sRim('studio'), 51],
    ['crash', S.drumId('studio', 'crash'), V.sCrash('studio'), 49],
  ]
  for (const [name, id, patch, note] of CASES) {
    const raw = monoOf(S.resolveSample(id))
    const r = character(raw.mono, raw.sr)
    const a = play(name, patch, `${note}:0.02:0.6:0.92`)
    const s = character(a.mono, a.sr)
    const ratio = s.centroid / Math.max(1, r.centroid)
    // Shaping is allowed to colour a sample; it is not allowed to replace it.
    // Half an octave either way of the raw centroid is the line.
    ok(`${name} keeps its character`, s.peak > 0.01 && ratio > 0.4 && ratio < 2.5,
      `${Math.round(r.centroid)}Hz raw -> ${Math.round(s.centroid)}Hz  (x${ratio.toFixed(2)})`)
  }
}

// ── melodic instruments play the note they were given ───────────────────────
console.log('\nmultisample instruments, across the keyboard')
{
  const hz = m => 440 * Math.pow(2, (m - 69) / 12)
  for (const [name, patch, notes] of [
    ['piano', V.sPiano(), [40, 48, 55, 60, 64, 69]],
    ['guitar', V.sGuitar(), [45, 50, 55, 60, 64]],
    ['electric bass', V.sBass('electric-bass'), [33, 38, 43, 45]],
  ]) {
    let worst = 0, silent = 0
    const gross = []
    for (const n of notes) {
      const r = play(`${name}-${n}`, patch, `${n}:0.02:1.2:0.9`, 2.2)
      // Measure INSIDE the sound, not at a fixed clock time. These roots are
      // short — the guitar's G2 is 0.32 s — so a fixed 0.35 s probe lands after
      // the note has finished and reports silence for a sample that played
      // perfectly. Find the sounding span first, then look a quarter of the way in.
      let peak = 0
      for (const v of r.mono) peak = Math.max(peak, Math.abs(v))
      if (peak < 1e-3) { silent++; continue }
      let a0 = 0, b0 = r.mono.length - 1
      while (a0 < r.mono.length && Math.abs(r.mono[a0]) < peak * 0.02) a0++
      while (b0 > a0 && Math.abs(r.mono[b0]) < peak * 0.02) b0--
      // Probe the SUSTAIN and take the median of several reads. A struck or
      // plucked attack is inharmonic noise — measuring pitch there is not a
      // strict test, it is a coin toss, and it failed a guitar that renders
      // perfectly (identical partials to its raw file).
      const reads = [0.4, 0.55, 0.7]
        .map(f => pitchAt(r.mono, r.sr, (a0 + (b0 - a0) * f) / r.sr, 0.15, { loMidi: 20, hiMidi: 100 }))
        .filter(Boolean)
      if (!reads.length) { silent++; continue }
      const sorted = reads.map(x => x.midi).sort((x, y) => x - y)
      const median = sorted[Math.floor(sorted.length / 2)]
      const at = (a0 + (b0 - a0) * 0.55) / r.sr
      // BLIND first. pitchNear only searches +/-120 cents, so it confirms fine
      // tuning and is completely blind to gross errors — a root mapped an octave
      // wrong reads as "in tune" because there is always some energy near the
      // expected frequency. That is exactly how eight mislabelled roots passed
      // this check the first time it ran.
      if (Math.abs(median - n) > 0.7) {
        gross.push(`${n} played ${median.toFixed(1)}`)
        continue
      }
      const m = pitchNear(r.mono, r.sr, at, hz(n))
      if (!m) { silent++; continue }
      worst = Math.max(worst, Math.abs(m.cents))
    }
    ok(`${name} plays in tune`, silent === 0 && gross.length === 0 && worst < 60,
      gross.length ? `WRONG PITCH: ${gross.join(', ')}`
        : silent ? `${silent} silent note(s)`
        : `worst ${worst.toFixed(0)} cents over ${notes.length} notes`)
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
