// Shared synthesis toolkit for the learn-article audio demos.
//
// Everything is deterministic (seeded noise) so re-renders are byte-stable, and
// every A/B pair should be rendered through the SAME toolkit with only the one
// variable under test changed — so a "before/after" demo is honest and never
// wins on loudness or extra material.

import { execFileSync } from 'child_process'

export const SR = 44100
export const mtof = m => 440 * Math.pow(2, (m - 69) / 12)
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)

// Deterministic noise.
let _seed = 987654321
export function resetNoise(s = 987654321) { _seed = s }
export function noise() { _seed = (_seed * 1103515245 + 12345) & 0x7fffffff; return (_seed / 0x3fffffff) - 1 }

// ── RBJ biquad (lowpass / highpass / peaking) ──────────────────────────────
export function biquad(kind, fc, q, gainDb = 0) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  fc = clamp(fc, 20, SR * 0.45)
  const w = 2 * Math.PI * fc / SR, cs = Math.cos(w), sn = Math.sin(w)
  const alpha = sn / (2 * q)
  const A = Math.pow(10, gainDb / 40)
  let b0, b1, b2, a0, a1, a2
  if (kind === 'lowpass') {
    b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0
    a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha
  } else if (kind === 'highpass') {
    b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0
    a0 = 1 + alpha; a1 = -2 * cs; a2 = 1 - alpha
  } else { // peaking
    b0 = 1 + alpha * A; b1 = -2 * cs; b2 = 1 - alpha * A
    a0 = 1 + alpha / A; a1 = -2 * cs; a2 = 1 - alpha / A
  }
  b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0
  return x => { const y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return y }
}

// ── Oscillators (naive; fine for demos) ────────────────────────────────────
export function osc(type, phase) {
  const p = phase - Math.floor(phase)
  if (type === 'sine') return Math.sin(2 * Math.PI * p)
  if (type === 'square') return p < 0.5 ? 1 : -1
  if (type === 'triangle') return 4 * Math.abs(p - 0.5) - 1
  return 2 * p - 1 // sawtooth
}

// Linear AR envelope value at time `t` for a note [on, on+dur].
export function ar(t, on, dur, attack = 0.005, release = 0.08) {
  const age = t - on
  if (age < 0 || age > dur + release) return 0
  const a = Math.min(1, age / attack)
  const r = age > dur ? Math.max(0, 1 - (age - dur) / release) : 1
  return a * r
}

// ── Drum voices (synthesised) ──────────────────────────────────────────────
export function drumSample(kind, age) {
  if (age < 0) return 0
  if (kind === 'kick') {
    if (age > 0.4) return 0
    const f = 45 + 90 * Math.exp(-age * 45)
    return Math.sin(2 * Math.PI * f * age) * Math.exp(-age * 8) * 0.9
  }
  if (kind === 'snare') {
    if (age > 0.3) return 0
    const e = Math.exp(-age * 22)
    return (noise() * 0.7 + Math.sin(2 * Math.PI * 190 * age) * 0.35) * e * 0.6
  }
  if (kind === 'clap') {
    if (age > 0.3) return 0
    return noise() * Math.exp(-age * 18) * 0.5
  }
  // hat
  if (age > 0.12) return 0
  return noise() * Math.exp(-age * 90) * 0.4
}

// ── Schroeder reverb ───────────────────────────────────────────────────────
export function makeReverb(fb = 0.8) {
  const combs = [1557, 1617, 1491, 1422].map(n => ({ buf: new Float32Array(n), i: 0, fb }))
  const aps = [225, 556].map(n => ({ buf: new Float32Array(n), i: 0, g: 0.5 }))
  return x => {
    let y = 0
    for (const c of combs) { const v = c.buf[c.i]; y += v; c.buf[c.i] = x + v * c.fb; c.i = (c.i + 1) % c.buf.length }
    y *= 0.25
    for (const a of aps) { const v = a.buf[a.i]; const out = -a.g * y + v; a.buf[a.i] = y + a.g * out; a.i = (a.i + 1) % a.buf.length; y = out }
    return y
  }
}

// ── Perceived loudness (K-weighted, gated) ─────────────────────────────────
// A LUFS-style loudness estimate on the mono sum: a ~100 Hz high-pass plus a
// high-frequency tilt, then a gated mean-square. This is what A/B pairs must be
// matched on — plain RMS does NOT capture perceived loudness, so a compressed
// or denser clip measures "matched" by RMS while clearly sounding louder.
// Returns a linear amplitude (compare via 20*log10(ratio)).
export function kloud(L, R = L) {
  const N = L.length
  const Rc = Math.exp(-2 * Math.PI * 100 / SR) // 1-pole high-pass
  const sc = Math.exp(-2 * Math.PI * 2000 / SR) // high-shelf split
  const win = Math.round(0.4 * SR)
  let px = 0, po = 0, shy = 0, acc = 0, cnt = 0, g = 0, gc = 0
  for (let i = 0; i < N; i++) {
    const m = (L[i] + R[i]) / 2
    const hp = Rc * (po + m - px); px = m; po = hp
    shy = sc * shy + (1 - sc) * hp
    const kw = hp + (hp - shy) * 0.6
    acc += kw * kw; cnt++
    if (cnt === win) { const ms = acc / win; if (ms > 6.4e-5) { g += ms; gc++ } acc = 0; cnt = 0 }
  }
  if (cnt > 0) { const ms = acc / cnt; if (ms > 6.4e-5) { g += ms; gc++ } }
  return Math.sqrt(g / (gc || 1))
}

// ── Master: normalise to a target peak + short edge fades ──────────────────
export function finalize(buf, peakTarget = 0.89) {
  let peak = 0
  for (let n = 0; n < buf.length; n++) peak = Math.max(peak, Math.abs(buf[n]))
  const g = peakTarget / (peak || 1)
  const fade = Math.round(0.012 * SR)
  for (let n = 0; n < buf.length; n++) {
    let f = 1
    if (n < fade) f = n / fade
    else if (n > buf.length - fade) f = (buf.length - n) / fade
    buf[n] *= g * f
  }
  return buf
}

// ── WAV (16-bit stereo, same value both channels) ──────────────────────────
export function wav(mono) {
  const N = mono.length
  const data = Buffer.alloc(N * 4)
  for (let n = 0; n < N; n++) {
    const v = Math.round(clamp(mono[n], -1, 1) * 32767)
    data.writeInt16LE(v, n * 4); data.writeInt16LE(v, n * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28)
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

// True-stereo WAV (16-bit).
export function wavStereo(Lch, Rch) {
  const N = Lch.length
  const data = Buffer.alloc(N * 4)
  for (let n = 0; n < N; n++) {
    data.writeInt16LE(Math.round(clamp(Lch[n], -1, 1) * 32767), n * 4)
    data.writeInt16LE(Math.round(clamp(Rch[n], -1, 1) * 32767), n * 4 + 2)
  }
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20)
  h.writeUInt16LE(2, 22); h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 4, 28)
  h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(data.length, 40)
  return Buffer.concat([h, data])
}

// Write a WAV then encode to MP3 with lame, removing the WAV.
import { writeFileSync, rmSync } from 'fs'
export function writeMp3(path, mono) {
  const wavPath = path.replace(/\.mp3$/, '.wav')
  writeFileSync(wavPath, wav(mono))
  execFileSync('lame', ['--quiet', '-V4', wavPath, path])
  rmSync(wavPath)
}
export function writeMp3Stereo(path, Lch, Rch) {
  const wavPath = path.replace(/\.mp3$/, '.wav')
  writeFileSync(wavPath, wavStereo(Lch, Rch))
  execFileSync('lame', ['--quiet', '-V4', wavPath, path])
  rmSync(wavPath)
}
