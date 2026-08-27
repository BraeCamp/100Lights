#!/usr/bin/env node
// Prove the measurements against signals whose answer is known, before they are
// allowed to say anything about a song.
//
// This exists because the band maths was wrong in its first version — rounding
// both ends of every band outward put the bins either side of each boundary into
// two bands at once, and since the sub/bass boundary is exactly where the energy
// lives, a balanced mix measured as 15% more sub than it had. Nothing would have
// caught that except a signal whose spectrum is known in advance. The same class
// of mistake sent an earlier tuning checker hunting a bug in a part that was
// perfectly in tune.
//
//   node scripts/audio-features.test.mjs

import {
  BANDS, spectralProfile, loudness, truePeak, levels, stereo, envelope, onsets, analyze, db, pitchAt, pitchNear } from './lib/audio-features.mjs'

const SR = 48000
let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? '   ' + detail : ''}`) }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol

const sine = (hz, sec, amp = 1, sr = SR) => {
  const n = Math.floor(sec * sr), s = new Float32Array(n)
  for (let i = 0; i < n; i++) s[i] = amp * Math.sin(2 * Math.PI * hz * i / sr)
  return s
}
const noise = (sec, amp = 1, seed = 1, sr = SR) => {
  const n = Math.floor(sec * sr), s = new Float32Array(n)
  let x = seed >>> 0
  for (let i = 0; i < n; i++) { x = (x * 1664525 + 1013904223) >>> 0; s[i] = (x / 4294967296 * 2 - 1) * amp }
  return s
}

console.log('\nbands')
{
  // A tone lands in exactly one band, and the bands account for all of it.
  for (const [name, lo, hi] of BANDS) {
    const hz = Math.sqrt(lo * Math.min(hi, 20000))          // geometric centre
    const p = spectralProfile(sine(hz, 2), SR)
    const top = Object.entries(p.bands).sort((a, b) => b[1] - a[1])[0]
    ok(`${Math.round(hz)}Hz tone lands in "${name}"`, top[0] === name, `got ${top[0]} (${top[1]})`)
  }
  const wn = spectralProfile(noise(3), SR)
  const sum = Object.values(wn.bands).reduce((a, b) => a + b, 0)
  ok('white noise bands sum to ~1', near(sum, 1, 0.06), `sum=${sum.toFixed(3)}`)
  // The bug that started this file: no double counting at a boundary.
  const atEdge = spectralProfile(sine(60, 2), SR)
  const edgeSum = Object.values(atEdge.bands).reduce((a, b) => a + b, 0)
  ok('a tone exactly on a band edge is not counted twice', edgeSum <= 1.02, `sum=${edgeSum.toFixed(3)}`)
}

console.log('\ncentroid and rolloff')
{
  const p = spectralProfile(sine(1000, 2), SR)
  ok('centroid of a 1kHz tone is 1kHz', near(p.centroidHz, 1000, 30), `${p.centroidHz}Hz`)
  ok('rolloff of a 1kHz tone is 1kHz', near(p.rolloffHz, 1000, 30), `${p.rolloffHz}Hz`)
  const lo = spectralProfile(sine(100, 2), SR), hi = spectralProfile(sine(6000, 2), SR)
  ok('a bright signal reads brighter than a dark one', hi.centroidHz > lo.centroidHz * 5)
}

console.log('\nlevels')
{
  const s = sine(1000, 2, 0.5)
  const lv = levels(s, s)
  ok('peak of a 0.5 sine is -6 dBFS', near(lv.peakDb, -6.02, 0.1), `${lv.peakDb}`)
  ok('crest of a sine is 3 dB', near(lv.crestDb, 3.01, 0.1), `${lv.crestDb}`)
  const loud = levels(sine(1000, 1, 1.0), sine(1000, 1, 1.0))
  ok('a full-scale sine counts as clipped', loud.clipped > 0)
}

console.log('\ntrue peak')
{
  // A tone just off a bin centre peaks BETWEEN samples: sample peak understates
  // it, true peak does not. This is the whole reason true peak exists.
  const s = sine(11025, 1, 0.9)
  const tp = db(truePeak(s, s, SR)), sp = levels(s, s).peakDb
  ok('true peak is at least sample peak', tp >= sp - 0.01, `tp=${tp.toFixed(2)} sp=${sp.toFixed(2)}`)
  ok('true peak catches an inter-sample over', tp > sp - 0.5)

  // truePeak only looks near the loudest samples, because oversampling every
  // sample of a two-minute file took longer than rendering the song. That is a
  // SPEED change that must not change the answer, so it is checked against the
  // exhaustive search it replaced — including a signal built to defeat the gate.
  const exhaustive = (l, r) => {
    const OS = 4, TAPS = 32, HALF = TAPS / 2
    const filt = []
    for (let p = 0; p < OS; p++) {
      const h = new Float32Array(TAPS)
      for (let t = 0; t < TAPS; t++) {
        const x = t - HALF + 1 - p / OS
        const si = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
        h[t] = si * (0.5 - 0.5 * Math.cos(2 * Math.PI * (t + 0.5) / TAPS))
      }
      filt.push(h)
    }
    let peak = 0
    for (const ch of [l, r]) {
      for (let i = HALF; i < ch.length - HALF; i++) {
        for (let p = 0; p < OS; p++) {
          let acc = 0
          const h = filt[p]
          for (let t = 0; t < TAPS; t++) acc += ch[i - HALF + t] * h[t]
          const a = Math.abs(acc)
          if (a > peak) peak = a
        }
      }
    }
    return peak
  }

  const same = (name, sig) => {
    const g = db(truePeak(sig, sig, SR)), e = db(exhaustive(sig, sig))
    ok(name, g >= e - 0.001 && g - e < 0.05, `gated ${g.toFixed(3)} vs exhaustive ${e.toFixed(3)}`)
  }
  same('gated search agrees on a plain tone', sine(1000, 0.3, 0.8))
  same('gated search agrees on noise', noise(0.3, 0.8, 5))

  // The adversarial case: a LOUD isolated spike sets the gate high, and a
  // quieter passage elsewhere carries the real inter-sample overshoot. A sine at
  // a quarter of the sample rate, phased so every sample lands at 0.707 of the
  // true peak, is the worst case there is — about 3 dB of overshoot.
  {
    const n = SR / 2
    const sig = new Float32Array(n)
    for (let i = 0; i < n; i++) sig[i] = 0.5 * Math.sin(2 * Math.PI * (SR / 4) * i / SR + Math.PI / 4)
    sig[100] = 0.8                                   // a louder lone sample, to raise the gate
    const g = db(truePeak(sig, sig, SR)), e = db(exhaustive(sig, sig))
    ok('a loud spike does not hide an overshoot elsewhere', Math.abs(g - e) < 0.01,
      `gated ${g.toFixed(3)} vs exhaustive ${e.toFixed(3)}`)
  }
}

console.log('\nloudness')
{
  const s = sine(1000, 4, 0.1)                              // -20 dBFS
  const l = loudness(s, s, SR)
  ok('a -20 dBFS 1kHz tone reads about -20 LUFS', near(l.lufs, -20, 1.5), `${l.lufs} LUFS`)
  const louder = loudness(sine(1000, 4, 0.2), sine(1000, 4, 0.2), SR)
  ok('doubling amplitude adds 6 LU', near(louder.lufs - l.lufs, 6.02, 0.2), `Δ=${(louder.lufs - l.lufs).toFixed(2)}`)
  ok('a steady tone has almost no loudness range', l.lra < 1.0, `LRA=${l.lra}`)
  // Something that genuinely moves should show it.
  const quiet = sine(1000, 3, 0.02), loudPart = sine(1000, 3, 0.4)
  const varied = new Float32Array(quiet.length + loudPart.length)
  varied.set(quiet); varied.set(loudPart, quiet.length)
  const vr = loudness(varied, varied, SR)
  ok('a quiet half plus a loud half has real range', vr.dynamicRangeDb > 15, `range=${vr.dynamicRangeDb}`)
}

console.log('\nstereo')
{
  const a = noise(2, 0.5, 1), b = noise(2, 0.5, 99)
  ok('identical channels correlate at 1', near(stereo(a, a).correlation, 1, 0.01))
  const inv = Float32Array.from(a, v => -v)
  ok('inverted channels correlate at -1', near(stereo(a, inv).correlation, -1, 0.01))
  const indep = stereo(a, b).correlation
  ok('independent channels correlate near 0', Math.abs(indep) < 0.05, `${indep}`)
  ok('identical channels have no side energy', stereo(a, a).sideDb < -80)
}

console.log('\ntime')
{
  const fade = new Float32Array(SR * 2)
  for (let i = 0; i < fade.length; i++) fade[i] = Math.sin(2 * Math.PI * 440 * i / SR) * (1 - i / fade.length)
  const env = envelope(fade, fade, SR, 0.25)
  ok('a fade-out reads as a falling envelope', env[0] > env[env.length - 1] + 10, `${env[0]} → ${env[env.length - 1]}`)

  // Four spaced hits. A held note is ONE onset, which is the case flux-based
  // detection gets wrong when a sound starts at full amplitude.
  const hits = new Float32Array(SR * 2)
  for (const t of [0.1, 0.6, 1.1, 1.6]) {
    const s = Math.floor(t * SR)
    for (let i = 0; i < SR * 0.05; i++) hits[s + i] = Math.sin(2 * Math.PI * 200 * i / SR) * (1 - i / (SR * 0.05))
  }
  ok('four hits read as four onsets', onsets(hits, SR).length === 4, `got ${onsets(hits, SR).length}`)
  const held = sine(200, 2, 0.5)
  ok('one held note is one onset', onsets(held, SR).length === 1, `got ${onsets(held, SR).length}`)
}

console.log('\nfull analyze()')
{
  const s = sine(1000, 3, 0.25)
  const a = analyze(s, s, SR, { withTruePeak: true, withBandStereo: true })
  ok('reports every field', ['lufs', 'lra', 'peakDb', 'truePeakDb', 'crestDb', 'centroidHz', 'bands', 'correlation'].every(k => a[k] !== undefined && a[k] !== null))
  ok('duration is right', near(a.seconds, 3, 0.01), `${a.seconds}`)
}

console.log('\npitch')
{
  const SR = 48000
  const tone = (fn, sec = 1.5) => {
    const n = Math.round(SR * sec), a = new Float32Array(n)
    let ph = 0
    for (let i = 0; i < n; i++) { ph += 2 * Math.PI * fn(i / SR) / SR; a[i] = Math.sin(ph) }
    return a
  }
  const rich = (f, sec = 1.5) => {
    const n = Math.round(SR * sec), a = new Float32Array(n)
    let ph = 0
    for (let i = 0; i < n; i++) {
      ph += 2 * Math.PI * f / SR
      let v = 0
      for (let k = 1; k <= 20 && f * k < SR / 2; k++) v += Math.sin(ph * k) / k
      a[i] = v * 0.5
    }
    return a
  }
  const hz = m => 440 * Math.pow(2, (m - 69) / 12)

  // pitchAt: two earlier hand-rolled estimators were confidently wrong on these
  // exact shapes — a zero-crossing counter counted a saw's harmonics, and an
  // autocorrelator locked onto a sub-oscillator's octave.
  for (const m of [22, 34, 55, 79]) {
    ok(`pitchAt reads a ${hz(m).toFixed(0)} Hz sine`, Math.abs(pitchAt(tone(() => hz(m)), SR, 0.7, 0.2).midi - m) * 100 < 5)
  }
  ok('pitchAt is not fooled by 20 harmonics', Math.abs(pitchAt(rich(hz(43)), SR, 0.7, 0.2).midi - 43) * 100 < 5)
  ok('pitchAt is not fooled by an octave-down sub-oscillator', (() => {
    const a = rich(hz(34)), b = tone(() => hz(22))
    const mix = Float32Array.from(a, (v, i) => v + 0.4 * b[i])
    return Math.abs(pitchAt(mix, SR, 0.7, 0.2).midi - 34) * 100 < 5
  })())
  ok('pitchAt returns null on silence', pitchAt(new Float32Array(SR), SR, 0.5, 0.2) === null)
  ok('pitchAt tracks a moving pitch', (() => {
    const gl = tone(t => hz(55 + 12 * Math.min(1, t)), 1.5)
    return [0.25, 0.5, 0.75].every(t => Math.abs(pitchAt(gl, SR, t, 0.08).midi - (55 + 12 * t)) < 0.15)
  })())

  // pitchNear: verifying a pitch we WROTE, which is a different question.
  ok('pitchNear finds an in-tune tone', Math.abs(pitchNear(tone(() => hz(43)), SR, 0.7, hz(43)).cents) < 2)
  ok('pitchNear measures a known detuning', (() => {
    const r = pitchNear(tone(() => hz(43) * Math.pow(2, 35 / 1200)), SR, 0.7, hz(43))
    return Math.abs(r.cents - 35) < 3
  })())
  ok('pitchNear works where blind detection is ambiguous', (() => {
    // an oscillator plus a sub-oscillator an octave down: two strong components,
    // and the written note is the upper one
    const a = rich(hz(34)), b = tone(() => hz(22))
    const mix = Float32Array.from(a, (v, i) => v + 0.7 * b[i])
    return Math.abs(pitchNear(mix, SR, 0.7, hz(34)).cents) < 5
  })())
  ok('pitchNear admits when the window cannot resolve the band',
    pitchNear(tone(() => hz(22)), SR, 0.7, hz(22)).resolved === false)
  ok('pitchNear is resolved at a normal pitch',
    pitchNear(tone(() => hz(69)), SR, 0.7, hz(69)).resolved === true)
  ok('pitchNear returns null on silence', pitchNear(new Float32Array(SR), SR, 0.5, 100) === null)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
