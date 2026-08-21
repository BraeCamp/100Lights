/* Helios — the Apollo synthesizer's engine. A single AudioWorkletProcessor
   running the whole synth: 3 oscillators (wavetable / sample / multisample /
   granular / spectral), sub + noise, dual filters, 4 envelopes, 10 LFOs, mod
   matrix, three FX lanes with splitters, arp + clip sequencer.
   Plain JS: worklet-loaded. */
/* eslint-disable */
/* build 2026-08-20-16 — keep in sync with lib/apollo/engine-version.ts */
'use strict'

const TWO_PI = Math.PI * 2
const WT_LEN = 2048

// ---------- utils ----------
function clamp(v, a, b) { return v < a ? a : v > b ? b : v }
function lerp(a, b, t) { return a + (b - a) * t }
function midiFreq(n) { return 440 * Math.pow(2, (n - 69) / 12) }
function dbToLin(db) { return Math.pow(10, db / 20) }
function cutoffHz(norm) { return 8 * Math.pow(2500, clamp(norm, 0, 1)) } // 8 Hz .. 20 kHz

// xorshift RNG (deterministic per seed)
function makeRng(seed) {
  let s = seed >>> 0 || 1
  return function () {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}
const grng = makeRng(0x9e3779b9)

// Curve interpolation: t 0..1, c -1..1
function curveShape(t, c) {
  if (c === 0) return t
  const k = Math.pow(4, Math.abs(c) * 2)
  return c > 0 ? Math.pow(t, k) : 1 - Math.pow(1 - t, k)
}

// evaluate 257-entry LUT at phase 0..1
function lutEval(lut, x) {
  const p = clamp(x, 0, 1) * 256
  const i = p | 0
  const f = p - i
  return i >= 256 ? lut[256] : lut[i] + (lut[i + 1] - lut[i]) * f
}

// ---------- FFT (radix-2, in-place) ----------
function fftInPlace(re, im, inverse) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 1 : -1) * TWO_PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const nwr = cwr * wr - cwi * wi
        cwi = cwr * wi + cwi * wr; cwr = nwr
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

// ---------- envelope ----------
const ENV_IDLE = 0, ENV_ATK = 1, ENV_HOLD = 2, ENV_DEC = 3, ENV_SUS = 4, ENV_REL = 5
class Env {
  constructor() { this.state = ENV_IDLE; this.t = 0; this.out = 0; this.relFrom = 0 }
  trigger(legato) { if (!legato || this.state === ENV_IDLE || this.state === ENV_REL) { this.state = ENV_ATK; this.t = 0 } else if (this.state !== ENV_IDLE) { this.state = ENV_ATK; this.t = this.out } }
  release() { if (this.state !== ENV_IDLE) { this.relFrom = this.out; this.state = ENV_REL; this.t = 0 } }
  kill() { this.state = ENV_IDLE; this.out = 0 }
  process(cfg, dt) {
    switch (this.state) {
      case ENV_IDLE: this.out = 0; break
      case ENV_ATK: {
        const a = Math.max(cfg.attack, 0.0005)
        this.t += dt / a
        if (this.t >= 1) { this.t = 0; this.state = cfg.hold > 0 ? ENV_HOLD : ENV_DEC; this.out = 1 }
        else this.out = curveShape(this.t, cfg.aCurve)
        break
      }
      case ENV_HOLD:
        this.t += dt
        this.out = 1
        if (this.t >= cfg.hold) { this.t = 0; this.state = ENV_DEC }
        break
      case ENV_DEC: {
        const d = Math.max(cfg.decay, 0.001)
        this.t += dt / d
        if (this.t >= 1) { this.state = ENV_SUS; this.out = cfg.sustain }
        else this.out = 1 - curveShape(this.t, cfg.dCurve) * (1 - cfg.sustain)
        break
      }
      case ENV_SUS: this.out = cfg.sustain; break
      case ENV_REL: {
        const r = Math.max(cfg.release, 0.002)
        this.t += dt / r
        if (this.t >= 1) { this.state = ENV_IDLE; this.out = 0 }
        else this.out = this.relFrom * (1 - curveShape(this.t, cfg.rCurve))
        break
      }
    }
    return this.out
  }
  get active() { return this.state !== ENV_IDLE }
}

// ---------- chaos oscillators ----------
class Chaos {
  constructor(type) { this.type = type; this.x = 0.1; this.y = 0; this.z = 0; this.sh = 0; this.shPhase = 1 }
  step(rateHz, dt) {
    const h = clamp(rateHz * dt * 0.5, 0, 0.2)
    if (this.type === 'lorenz') {
      const { x, y, z } = this
      this.x += h * 10 * (y - x)
      this.y += h * (x * (28 - z) - y)
      this.z += h * (x * y - 8 / 3 * z)
      return clamp(this.x / 20, -1, 1) * 0.5 + 0.5
    }
    if (this.type === 'rossler') {
      const { x, y, z } = this
      this.x += h * 3 * (-y - z)
      this.y += h * 3 * (x + 0.2 * y)
      this.z += h * 3 * (0.2 + z * (x - 5.7))
      return clamp(this.x / 10, -1, 1) * 0.5 + 0.5
    }
    // sample & hold
    this.shPhase += rateHz * dt
    if (this.shPhase >= 1) { this.shPhase -= Math.floor(this.shPhase); this.sh = grng() }
    return this.sh
  }
}

// ---------- filters ----------
// TPT state-variable filter, one per channel
class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0 }
  reset() { this.ic1 = 0; this.ic2 = 0 }
  // returns {lp, bp, hp} for input x
  process(x, g, k) {
    const a1 = 1 / (1 + g * (g + k))
    const a2 = g * a1
    const v1 = a1 * this.ic1 + a2 * (x - this.ic2)
    const v2 = this.ic2 + g * v1
    this.ic1 = 2 * v1 - this.ic1
    this.ic2 = 2 * v2 - this.ic2
    this.lp = v2; this.bp = v1; this.hp = x - k * v1 - v2
    return v2
  }
}
function svfG(freq, sr) { return Math.tan(Math.PI * clamp(freq, 5, sr * 0.49) / sr) }

class OnePole {
  constructor() { this.z = 0 }
  lp(x, coeff) { this.z += coeff * (x - this.z); return this.z }
}
function onePoleCoeff(freq, sr) { const c = 1 - Math.exp(-TWO_PI * clamp(freq, 1, sr * 0.49) / sr); return c }

// 4-stage ladder w/ tanh nonlinearity
class Ladder {
  constructor() { this.s = [0, 0, 0, 0]; this.d = 0 }
  reset() { this.s[0] = this.s[1] = this.s[2] = this.s[3] = 0; this.d = 0 }
  process(x, freq, res, drive, sr, flavor) {
    const f = clamp(freq / (sr * 0.5), 0.0005, 0.99)
    const g = 1 - Math.exp(-Math.PI * f)
    // acid pushes resonance harder (self-osc squelch), EMS is wilder still
    const k = res * (flavor === 4 ? 4.6 : flavor === 5 ? 5.2 : 4.2)
    const s = this.s
    // acid: AC-couple the feedback (DC blocker) — the classic clicky 303 bite
    let fb = s[3]
    if (flavor === 4) { this.d += 0.002 * (s[3] - this.d); fb = s[3] - this.d }
    let inp = x - k * (fb - x * 0.5 * res)
    if (flavor === 2) inp = Math.tanh(inp * (1 + drive * 3)) // german: hard sat
    else if (flavor === 3) inp = inp / (1 + Math.abs(inp) * (0.4 + drive)) // french: soft fold
    else if (flavor === 5) inp = Math.tanh(inp * 1.4 + 0.12) - 0.119 // EMS diode: asymmetric
    else if (flavor === 6) inp = Math.tanh(inp * (2.2 + drive * 6) + 0.25 * inp * inp) * 0.8 // dirty: heavy asym drive
    else inp = Math.tanh(inp * (1 + drive * 2))
    s[0] += g * (inp - s[0])
    s[1] += g * (Math.tanh(s[0]) - s[1])
    s[2] += g * (s[1] - s[2])
    s[3] += g * (Math.tanh(s[2]) - s[3])
    if (flavor === 4) return s[2] * 0.35 + s[3] * (0.85 + res * 1.1) // acid: brighter 18dB-ish blend
    if (flavor === 5) return Math.tanh(s[3] * (1 + res * 1.6)) // EMS: resonance folds back in
    if (flavor === 6) return s[3] * (1 + res * 0.9) * 1.15
    return s[3] * (1 + res * 0.9)
  }
}

class DelayLine {
  constructor(maxSamps) { this.buf = new Float32Array(Math.max(4, maxSamps | 0)); this.pos = 0 }
  write(x) { this.buf[this.pos] = x; this.pos = (this.pos + 1) % this.buf.length }
  read(delaySamps) {
    const d = clamp(delaySamps, 1, this.buf.length - 2)
    let idx = this.pos - d
    while (idx < 0) idx += this.buf.length
    const i = idx | 0, f = idx - i
    const a = this.buf[i], b = this.buf[(i + 1) % this.buf.length]
    return a + (b - a) * f
  }
  reset() { this.buf.fill(0) }
}

class Allpass {
  constructor(maxSamps) { this.dl = new DelayLine(maxSamps); this.last = 0 }
  process(x, delaySamps, coeff) {
    const d = this.dl.read(delaySamps)
    const y = -coeff * x + d
    this.dl.write(x + coeff * y)
    return y
  }
}

const VOWELS = [ // f1,f2,f3 for A E I O U
  [800, 1150, 2900], [400, 1600, 2700], [350, 1700, 2700], [450, 800, 2830], [325, 700, 2700],
]

// Full multimode voice filter: one instance handles one channel of any FilterType
class VoiceFilter {
  constructor(sr) {
    this.sr = sr
    this.svf1 = new SVF(); this.svf2 = new SVF(); this.svf3 = new SVF(); this.svf4 = new SVF()
    this.ladder = new Ladder()
    this.dl = new DelayLine(Math.ceil(sr / 20))
    this.aps = [new Allpass(2048), new Allpass(2048), new Allpass(2048), new Allpass(2048), new Allpass(2048), new Allpass(2048), new Allpass(2048), new Allpass(2048)]
    this.op = new OnePole()
    this.rmPhase = 0
    this.ap1 = new Float32Array(8) // 1st-order allpass states (phaser filters)
    this.fbAP = 0
    this.shVal = 0; this.shPhase = 0
    this.dsVal = 0; this.dsPhase = 0
    // mini reverb-filter state
    this.rvDl = [new DelayLine(sr * 0.05), new DelayLine(sr * 0.06), new DelayLine(sr * 0.071), new DelayLine(sr * 0.083)]
    this.combLp = 0
  }
  reset() { this.svf1.reset(); this.svf2.reset(); this.svf3.reset(); this.svf4.reset(); this.ladder.reset(); this.ap1.fill(0); this.fbAP = 0; this.combLp = 0 }
  process(x, type, cutNorm, res, drive, fat) {
    const sr = this.sr
    const freq = cutoffHz(cutNorm)
    const k = 2 - 1.9 * clamp(res, 0, 0.98)
    const g = svfG(freq, sr)
    if (drive > 0 && type !== 'ladder12' && type !== 'ladder24' && type !== 'germanLP' && type !== 'frenchLP'
      && type !== 'acidLadder' && type !== 'emsLadder' && type !== 'mgDirty') {
      x = Math.tanh(x * (1 + drive * 4)) * (1 / (1 + drive * 0.5))
    }
    switch (type) {
      case 'lp6': return this.op.lp(x, onePoleCoeff(freq, sr))
      case 'lp12': this.svf1.process(x, g, k); return this.svf1.lp
      case 'lp18': { this.svf1.process(x, g, k); return this.op.lp(this.svf1.lp, onePoleCoeff(freq, sr)) }
      case 'lp24': { this.svf1.process(x, g, k); this.svf2.process(this.svf1.lp, g, k); return this.svf2.lp }
      case 'hp6': return x - this.op.lp(x, onePoleCoeff(freq, sr))
      case 'hp12': this.svf1.process(x, g, k); return this.svf1.hp
      case 'hp24': { this.svf1.process(x, g, k); this.svf2.process(this.svf1.hp, g, k); return this.svf2.hp }
      case 'bp12': this.svf1.process(x, g, k); return this.svf1.bp * (1 + res * 2)
      case 'bp24': { this.svf1.process(x, g, k); this.svf2.process(this.svf1.bp, g, k); return this.svf2.bp * (1 + res * 3) }
      case 'notch12': this.svf1.process(x, g, k); return this.svf1.lp + this.svf1.hp
      case 'peak12': this.svf1.process(x, g, k); return this.svf1.lp + this.svf1.hp + this.svf1.bp * (1 + res * 4)
      case 'multiLBH': { // fat: 0 lp, .5 bp, 1 hp
        this.svf1.process(x, g, k)
        const m = fat * 2
        if (m <= 1) return this.svf1.lp * (1 - m) + this.svf1.bp * m * (1 + res)
        return this.svf1.bp * (2 - m) * (1 + res) + this.svf1.hp * (m - 1)
      }
      case 'multiLNH': {
        this.svf1.process(x, g, k)
        const notch = this.svf1.lp + this.svf1.hp
        const m = fat * 2
        if (m <= 1) return this.svf1.lp * (1 - m) + notch * m
        return notch * (2 - m) + this.svf1.hp * (m - 1)
      }
      case 'morphSVF': { // fat morphs lp -> bp -> hp -> notch -> lp
        this.svf1.process(x, g, k)
        const outs = [this.svf1.lp, this.svf1.bp * (1 + res * 2), this.svf1.hp, this.svf1.lp + this.svf1.hp]
        const m = fat * 4
        const i = Math.min(3, m | 0), f = m - i
        return outs[i] * (1 - f) + outs[(i + 1) % 4] * f
      }
      case 'ladder12': { this.svf1.process(Math.tanh(x * (1 + drive * 3)), g, 2 - 1.6 * res); return this.svf1.lp * (1 + res * 0.5) }
      case 'ladder24': return this.ladder.process(x, freq, res, drive, sr, 1)
      case 'acidLadder': return this.ladder.process(x, freq, res, drive, sr, 4)
      case 'emsLadder': return this.ladder.process(x, freq, res, drive, sr, 5)
      case 'mgDirty': return this.ladder.process(x, freq, res, drive, sr, 6)
      case 'germanLP': return this.ladder.process(x, freq, res, drive, sr, 2)
      case 'frenchLP': return this.ladder.process(x, freq, res, drive, sr, 3)
      case 'formant': {
        // fat = vowel morph 0..1 over A E I O U; cutoff shifts formants
        const pos = clamp(fat, 0, 0.999) * (VOWELS.length - 1)
        const vi = pos | 0, vf = pos - vi
        const scale = Math.pow(2, (cutNorm - 0.5) * 2)
        const q = 4 + res * 20
        let out = 0
        const va = VOWELS[vi], vb = VOWELS[Math.min(vi + 1, VOWELS.length - 1)]
        const svfs = [this.svf1, this.svf2, this.svf3]
        const gains = [1, 0.6, 0.3]
        for (let fi = 0; fi < 3; fi++) {
          const ffreq = lerp(va[fi], vb[fi], vf) * scale
          const gg = svfG(ffreq, sr)
          svfs[fi].process(x, gg, 1 / q)
          out += svfs[fi].bp * gains[fi] * q * 0.5
        }
        return out * 0.5
      }
      case 'comb2': {
        // feedback comb with a damped (lowpassed) loop — smoother, more 'tuned'
        // than Comb ±; fat sets the damping darkness
        const d = sr / clamp(freq, 20, sr * 0.45)
        const fb = clamp(res, 0, 0.96)
        const rd = this.dl.read(d)
        this.combLp += (0.15 + (1 - fat) * 0.8) * (rd - this.combLp)
        const y = x + this.combLp * fb
        this.dl.write(y)
        return y * 0.65
      }
      case 'expBPF': {
        // steep resonant bandpass: two cascaded BP stages, tight k, exponential emphasis
        const k2 = 2 - 1.95 * clamp(res, 0, 0.985)
        this.svf1.process(x, g, k2)
        this.svf2.process(this.svf1.bp, g, k2)
        return this.svf2.bp * (1 + res * res * 14)
      }
      case 'combPlus': case 'combMinus': {
        const d = sr / clamp(freq, 20, sr * 0.45)
        const fb = clamp(res, 0, 0.95)
        const rd = this.dl.read(d)
        const y = type === 'combPlus' ? x + rd * fb : x - rd * fb
        this.dl.write(y)
        return y * 0.7
      }
      case 'flangePlus': case 'flangeMinus': {
        const d = sr / clamp(freq, 20, sr * 0.45)
        const rd = this.dl.read(d)
        this.dl.write(x + rd * clamp(res, 0, 0.9) * (type === 'flangeMinus' ? -1 : 1))
        return (x + rd * (type === 'flangeMinus' ? -1 : 1)) * 0.6
      }
      case 'phasePlus': case 'phaseMinus': {
        // proper 6-stage 1st-order allpass phaser: a = (1-t)/(1+t)
        const t = Math.tan(Math.PI * clamp(freq, 20, sr * 0.45) / sr)
        const a = clamp((1 - t) / (1 + t), -0.98, 0.98)
        let y = x + this.fbAP * clamp(res, 0, 0.9) * (type === 'phaseMinus' ? -1 : 1)
        for (let st = 0; st < 6; st++) {
          const z = this.ap1[st]
          const out = a * y + z
          this.ap1[st] = y - a * out
          y = out
        }
        this.fbAP = y
        return (x + y * (type === 'phaseMinus' ? -1 : 1)) * 0.6
      }
      case 'ringMod': {
        this.rmPhase += freq / sr
        if (this.rmPhase >= 1) this.rmPhase -= 1
        const carrier = Math.sin(this.rmPhase * TWO_PI)
        return lerp(x, x * carrier * (1 + res), clamp(0.3 + fat * 0.7, 0, 1))
      }
      case 'sampHold': {
        this.shPhase += freq / sr
        if (this.shPhase >= 1) { this.shPhase -= Math.floor(this.shPhase); this.shVal = x + this.shVal * clamp(res, 0, 0.9) }
        return this.shVal
      }
      case 'downsample': {
        this.dsPhase += clamp(freq, 20, sr) / sr
        if (this.dsPhase >= 1) { this.dsPhase -= Math.floor(this.dsPhase); this.dsVal = x }
        return this.dsVal
      }
      case 'reverbFilter': {
        const fb = 0.5 + clamp(res, 0, 0.95) * 0.48
        const scale = 0.3 + (1 - cutNorm) * 0.7
        let out = 0
        for (let i = 0; i < 4; i++) {
          const dl = this.rvDl[i]
          const d = dl.buf.length * scale * (0.5 + i * 0.13)
          const rd = dl.read(d)
          dl.write(x * 0.4 + rd * fb * (i % 2 ? -1 : 1))
          out += rd
        }
        return out * 0.4 + x * 0.2
      }
      case 'dj': {
        // cutoff < .5: LP sweep; > .5: HP sweep
        if (cutNorm < 0.5) {
          const f2 = cutoffHz(cutNorm * 2)
          this.svf1.process(x, svfG(f2, sr), k)
          return this.svf1.lp
        }
        const f2 = cutoffHz((cutNorm - 0.5) * 2)
        this.svf1.process(x, svfG(f2, sr), k)
        return this.svf1.hp
      }
      case 'diffuser': {
        let y = x
        const coeff = 0.4 + clamp(res, 0, 0.95) * 0.45
        const base = 7 + (1 - cutNorm) * 90
        for (let i = 0; i < 8; i++) y = this.aps[i].process(y, base * (1 + i * 0.618 % 1.9), coeff)
        return y
      }
      default: return x
    }
  }
}

// ---------- wavetable warps ----------
// phase-domain warps: return warped phase 0..1
function warpPhase(mode, p, a) {
  switch (mode) {
    case 'sync': { const w = p * (1 + a * 7); return w - Math.floor(w) }
    case 'bendPlus': return curveShape(p, a)
    case 'bendMinus': return curveShape(p, -a)
    case 'bendBoth': { // pinch toward middle
      if (p < 0.5) return curveShape(p * 2, a) * 0.5
      return 0.5 + curveShape((p - 0.5) * 2, -a) * 0.5
    }
    case 'pwm': { const w = clamp(0.5 + a * 0.49, 0.5, 0.99); return p < w ? p / w * 0.5 : 0.5 + (p - w) / (1 - w) * 0.5 }
    case 'asym': { const w = clamp(0.5 - a * 0.49, 0.01, 0.5); return p < w ? p / w * 0.5 : 0.5 + (p - w) / (1 - w) * 0.5 }
    case 'flip': { if (a <= 0.001 || p < 1 - a) return p; return 1 - (p - (1 - a)) } // reverse the tail
    case 'mirror': { const m = p * (1 + a); return m <= 1 ? m : 2 - m }
    case 'quantize': { const steps = 2 + Math.floor(a * 62); return Math.floor(p * steps) / steps }
    case 'squeeze': { const s = 1 + a * 3; const c = (p - 0.5) * s + 0.5; return clamp(c, 0, 1) }
    case 'shift': { const w = p + a; return w - Math.floor(w) }
    case 'pd': { // classic casio-style phase distortion: knee
      const knee = clamp(0.5 - a * 0.45, 0.05, 0.5)
      return p < knee ? p / knee * 0.5 : 0.5 + (p - knee) / (1 - knee) * 0.5
    }
    default: return p
  }
}

// amplitude-domain warps: applied to output sample
function warpAmp(mode, y, a, modSample) {
  switch (mode) {
    case 'am': return y * (1 - a + a * (modSample * 0.5 + 0.5))
    case 'rm': return lerp(y, y * modSample, a)
    case 'saturate': { const d = 1 + a * 15; return Math.tanh(y * d) / Math.tanh(d) }
    default: return y
  }
}
const PHASE_WARPS = { sync: 1, bendPlus: 1, bendMinus: 1, bendBoth: 1, pwm: 1, asym: 1, mirror: 1, quantize: 1, squeeze: 1, shift: 1, pd: 1, remap: 1 }
const AMP_WARPS = { am: 1, rm: 1, saturate: 1 }

// unison detune ratio table for voice i of n, mode + detune amount, note
function unisonRatio(mode, i, n, detune, note) {
  if (n <= 1) return 1
  const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1 // -1..1
  switch (mode) {
    case 'harmonic': { // detune toward integer harmonic ratios
      const h = Math.round(Math.abs(t) * detune * 3)
      const r = 1 + h
      return t < 0 ? 1 / r : r
    }
    case 'ratio': return 1 + t * detune * 0.5
    case 'semitone': return Math.pow(2, Math.round(t * detune * 12) / 12)
    case 'step': return Math.pow(2, (Math.round(t * detune * 24) / 24))
    default: { // classic: cents spread, denser near center
      const shaped = Math.sign(t) * Math.pow(Math.abs(t), 1.2)
      return Math.pow(2, shaped * detune * 100 / 1200)
    }
  }
}

const MAX_UNI = 16
const MAX_GRAINS = 48 // per osc-voice

class OscState {
  constructor(sr) {
    this.sr = sr
    this.phases = new Float32Array(MAX_UNI)
    this.samplePos = new Float64Array(MAX_UNI)
    this.sampleDir = new Float32Array(MAX_UNI).fill(1)
    this.lastOut = 0
    this.ended = false
    // granular
    this.grains = []
    for (let i = 0; i < MAX_GRAINS; i++) this.grains.push({ active: false, pos: 0, t: 0, dur: 1, rate: 1, panL: 1, panR: 1, dir: 1 })
    this.grainTimer = 0
    this.grainAlt = 0
    this.scanPos = 0
    this.scanInit = false
    // spectral
    this.specPhases = null
    this.specSmear = null
    this.specFrame = -1
    this.specPos = 0
    this.olaBuf = null
    this.olaWrite = 0
    this.olaReadFrac = 0
    this.olaFilled = 0
    // multisample zone chosen at noteOn
    this.msZone = null
    this.msBuf = null
  }
  initNote(cfg, note, rng) {
    for (let i = 0; i < MAX_UNI; i++) {
      const base = cfg.phase
      this.phases[i] = (base + (cfg.rand > 0 ? rng() * cfg.rand : 0)) % 1
      this.samplePos[i] = -1
      this.sampleDir[i] = 1
    }
    this.ended = false
    this.grainTimer = 0
    this.scanInit = false
    for (const g of this.grains) g.active = false
    this.specFrame = -1
    this.specPhases = null
    this.olaBuf = null
    this.olaFilled = 0
  }
}

let VOICE_SERIAL = 0

class Voice {
  constructor(sr) {
    this.sr = sr
    this.active = false
    this.note = 60; this.vel = 1; this.gate = false
    this.freq = 261.6; this.glideFrom = 261.6; this.glideT = 1
    this.envs = [new Env(), new Env(), new Env(), new Env()]
    this.lfoPhase = new Float32Array(10)
    this.lfoRiseT = new Float32Array(10)
    this.lfoOut = new Float32Array(10)
    this.lfoOutY = new Float32Array(10)
    this.lfoSm = new Float32Array(10)
    this.lfoSmY = new Float32Array(10)
    this.rand = 0
    this.serial = 0
    this.ch = 0
    this.oscs = [new OscState(sr), new OscState(sr), new OscState(sr)]
    this.subPhase = 0
    this.noisePos = 0
    // filters: [f1L, f1R, f2L, f2R]
    this.filters = [new VoiceFilter(sr), new VoiceFilter(sr), new VoiceFilter(sr), new VoiceFilter(sr)]
    this.mod = new Float32Array(64) // per-voice mod accum, indexed by destIdx
    this.uniPan = new Float32Array(MAX_UNI)
    this.fromSeq = false
  }
  start(note, vel, patch, engine, legato, fromSeq) {
    this.note = note; this.vel = vel; this.gate = true; this.fromSeq = !!fromSeq
    this.serial = ++VOICE_SERIAL
    const wasActive = this.active
    this.active = true
    this.rand = grng()
    const targetFreq = engine.noteFreq(note) * Math.pow(2, patch.global.masterTune / 1200)
    const glide = engine.pv['global.glide'] != null ? engine.pv['global.glide'] : patch.global.glide
    if (glide > 0.001 && engine.lastFreq && (!patch.global.glideLegatoOnly || legato)) {
      this.glideFrom = engine.lastFreq; this.glideT = 0
      this.glideRate = 1 / (glide * this.sr)
    } else { this.glideFrom = targetFreq; this.glideT = 1 }
    this.freq = targetFreq
    engine.lastFreq = targetFreq
    const rng = makeRng((note * 7919 + this.serial * 104729) >>> 0)
    for (let i = 0; i < 3; i++) this.oscs[i].initNote(patch.oscs[i], note, rng)
    // multisample zone pick
    for (let i = 0; i < 3; i++) {
      const o = patch.oscs[i]
      if (o.engine === 'multisample' && o.ms.zones.length) {
        const v127 = Math.round(vel * 127)
        let z = o.ms.zones.find(z => note >= z.loKey && note <= z.hiKey && v127 >= z.loVel && v127 <= z.hiVel)
        if (!z) { // nearest by key
          let best = null, bd = 1e9
          for (const zz of o.ms.zones) { const d = Math.abs(zz.rootKey - note); if (d < bd) { bd = d; best = zz } }
          z = best
        }
        this.oscs[i].msZone = z
        this.oscs[i].msBuf = z ? engine.samples.get(z.sampleId) : null
      }
    }
    this.subPhase = patch.sub.enabled ? 0 : 0
    this.noisePos = -1
    const legatoEnv = legato && wasActive && patch.global.mode === 'legato'
    for (let e = 0; e < 4; e++) {
      if (!(legatoEnv && patch.envs[e].legato)) this.envs[e].trigger(legatoEnv)
    }
    // per-voice LFO retrig
    for (let l = 0; l < 10; l++) {
      const cfg = patch.lfos[l]
      if (cfg.trigMode === 'trig' || cfg.trigMode === 'env' || cfg.trigMode === 'loopHold') {
        if (!legatoEnv) { this.lfoPhase[l] = 0; this.lfoRiseT[l] = 0 }
      }
    }
    if (!wasActive) { for (const f of this.filters) f.reset() }
    this.prevCut1 = null
    this.prevCut2 = null
    // unison pan spread
    return this
  }
  release() { this.gate = false; for (const e of this.envs) e.release() }
  kill() { this.active = false; for (const e of this.envs) e.kill() }
}

// ---------- source renderers ----------
const BLOCK = 128

function tableSample(tbl, framePos, phase, data, dataOff) {
  const frames = tbl.frames
  const arr = data || tbl.data
  const off = dataOff || 0
  const fp = clamp(framePos, 0, frames - 1)
  const f0 = fp | 0
  const ff = fp - f0
  const p = phase * WT_LEN
  const i0 = p | 0
  const pf = p - i0
  const ia = i0 & (WT_LEN - 1), ib = (i0 + 1) & (WT_LEN - 1)
  const base0 = off + f0 * WT_LEN
  const s0 = arr[base0 + ia] + (arr[base0 + ib] - arr[base0 + ia]) * pf
  if (ff < 1e-4 || f0 + 1 >= frames) return s0
  const base1 = off + (f0 + 1) * WT_LEN
  const s1 = arr[base1 + ia] + (arr[base1 + ib] - arr[base1 + ia]) * pf
  return s0 + (s1 - s0) * ff
}

// pick the band-limited mip whose harmonics fit under Nyquist for phaseInc
function mipFor(tbl, inc) {
  if (!tbl.mips || inc <= 0) return null
  const H = 0.45 / inc
  if (H >= 1024) return null
  let lvl = Math.ceil(Math.log2(1024 / H))
  if (lvl < 1) return null
  if (lvl > 7) lvl = 7
  return (lvl - 1) * tbl.frames * WT_LEN
}

// ---------- spectral warp (harmonic-domain wavetable warps, Vital-style) ----
// Operates on the CURRENT wavetable frame in the frequency domain, cached per
// (frame, mode, amount, band-limit) on the per-voice osc state. Band-limiting
// happens in the same pass (zeroing bins above the note's Nyquist headroom),
// so warped output is alias-safe without the mip chain.
const swRe = new Float32Array(WT_LEN)
const swIm = new Float32Array(WT_LEN)
function swRead(buf, phase) {
  const p = phase * WT_LEN
  const i0 = p | 0
  const pf = p - i0
  const ia = i0 & (WT_LEN - 1), ib = (i0 + 1) & (WT_LEN - 1)
  return buf[ia] + (buf[ib] - buf[ia]) * pf
}
function swRand(k) { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }
function computeSpecWarp(tbl, framePos, mode, amt, maxH) {
  // render the (interpolated) source frame
  for (let i = 0; i < WT_LEN; i++) { swRe[i] = tableSample(tbl, framePos, i / WT_LEN, null, 0); swIm[i] = 0 }
  let srcPeak = 0
  for (let i = 0; i < WT_LEN; i++) { const a = Math.abs(swRe[i]); if (a > srcPeak) srcPeak = a }
  fftInPlace(swRe, swIm, false)
  const H = WT_LEN >> 1
  // magnitude/phase per bin 1..H-1
  const mags = new Float32Array(H)
  const phs = new Float32Array(H)
  for (let k = 1; k < H; k++) { mags[k] = Math.hypot(swRe[k], swIm[k]); phs[k] = Math.atan2(swIm[k], swRe[k]) }
  const out = new Float32Array(H)
  const oph = new Float32Array(H)
  if (mode === 'stretch') {
    // harmonic stretch: harmonic k comes from source position k/(1+amt*1.5)
    const f = 1 + amt * 1.5
    for (let k = 1; k < H; k++) {
      const srcK = k / f
      const k0 = srcK | 0, kf = srcK - k0
      if (k0 >= 1 && k0 + 1 < H) { out[k] = mags[k0] * (1 - kf) + mags[k0 + 1] * kf; oph[k] = phs[k0] }
    }
  } else if (mode === 'shift') {
    const sh = Math.round(amt * 48)
    for (let k = 1; k < H; k++) { const sk = k - sh; if (sk >= 1 && sk < H) { out[k] = mags[sk]; oph[k] = phs[sk] } }
  } else if (mode === 'smear') {
    const w = Math.max(1, Math.round(amt * 14))
    for (let k = 1; k < H; k++) {
      let sum = 0, cnt = 0
      for (let j = -w; j <= w; j++) { const kk = k + j; if (kk >= 1 && kk < H) { sum += mags[kk]; cnt++ } }
      out[k] = sum / cnt; oph[k] = phs[k]
    }
  } else if (mode === 'lowpass') {
    const keep = Math.max(1, Math.round(Math.pow(1 - amt, 2) * H))
    for (let k = 1; k < H; k++) { out[k] = k <= keep ? mags[k] : 0; oph[k] = phs[k] }
  } else if (mode === 'evenodd') {
    // tilt toward odd harmonics (hollow/square-like) as amount rises
    for (let k = 1; k < H; k++) { out[k] = mags[k] * (k % 2 === 0 ? (1 - amt) : (1 + amt * 0.4)); oph[k] = phs[k] }
  } else if (mode === 'inharm') {
    for (let k = 1; k < H; k++) {
      const off = Math.round((swRand(k) - 0.5) * 2 * amt * Math.min(12, k * 0.5))
      const sk = k + off
      if (sk >= 1 && sk < H) { out[k] = mags[sk]; oph[k] = phs[sk] }
    }
  } else {
    for (let k = 1; k < H; k++) { out[k] = mags[k]; oph[k] = phs[k] }
  }
  // rebuild spectrum, band-limited to maxH
  for (let i = 0; i < WT_LEN; i++) { swRe[i] = 0; swIm[i] = 0 }
  const lim = Math.min(H - 1, maxH)
  for (let k = 1; k <= lim; k++) {
    const re = out[k] * Math.cos(oph[k]), im = out[k] * Math.sin(oph[k])
    swRe[k] = re; swIm[k] = im
    swRe[WT_LEN - k] = re; swIm[WT_LEN - k] = -im
  }
  fftInPlace(swRe, swIm, true)
  const buf = new Float32Array(WT_LEN)
  let peak = 0
  for (let i = 0; i < WT_LEN; i++) { buf[i] = swRe[i]; const a = Math.abs(buf[i]); if (a > peak) peak = a }
  if (peak > 1e-6 && srcPeak > 1e-6) { const g = srcPeak / peak; for (let i = 0; i < WT_LEN; i++) buf[i] *= g }
  return buf
}

function grainWindow(t, shape, skew, amount) {
  // t 0..1; skew shifts peak; shape morphs triangle->hann->gauss
  let tt = t
  if (skew !== 0) {
    const peak = clamp(0.5 + skew * 0.45, 0.05, 0.95)
    tt = t < peak ? t / peak * 0.5 : 0.5 + (t - peak) / (1 - peak) * 0.5
  }
  let w
  if (shape < 0.5) {
    const tri = 1 - Math.abs(tt * 2 - 1)
    const hann = 0.5 - 0.5 * Math.cos(TWO_PI * tt)
    w = lerp(tri, hann, shape * 2)
  } else {
    const hann = 0.5 - 0.5 * Math.cos(TWO_PI * tt)
    const g = Math.exp(-Math.pow((tt - 0.5) * 5, 2))
    w = lerp(hann, g, shape * 2 - 1)
  }
  return lerp(1, w, amount)
}

function sampleAt(smp, pos, chan) {
  const i = pos | 0
  if (i < 0 || i >= smp.len - 1) return 0
  const f = pos - i
  const d = chan === 0 ? smp.l : (smp.r || smp.l)
  return d[i] + (d[i + 1] - d[i]) * f
}

class ApolloEngineCore {
  // (defined in part 5; source renderers live on prototype below)
}

// Render one oscillator for one voice into monoBuf (pre-pan) and stereo tmpL/tmpR.
// Returns false if the source produced nothing (ended one-shot).
function renderOscBlock(engine, voice, oi, patch, n, outL, outR, monoOut) {
  const cfg = patch.oscs[oi]
  const os = voice.oscs[oi]
  const sr = engine.sr
  const vp = (vv, pp, bb) => engine.vp(vv, pp, bb)
  const level = clamp(vp(voice, `osc${oi}.level`, cfg.level), 0, 1)
  // NOTE: a level-0 osc still renders (into oscMono) so it can serve as an
  // FM/AM/RM modulator for another oscillator — the classic silent-modulator trick
  if (!cfg.enabled) return false
  const pan = clamp(vp(voice, `osc${oi}.pan`, cfg.pan), -1, 1)
  const semi = vp(voice, `osc${oi}.semi`, cfg.semi)
  const fine = vp(voice, `osc${oi}.fine`, cfg.fine)
  const pitchRatioBase = Math.pow(2, (cfg.octave * 12 + semi + fine / 100 + engine.pitchBendSemis) / 12)
  const panL = Math.cos((pan + 1) * Math.PI / 4) * level
  const panR = Math.sin((pan + 1) * Math.PI / 4) * level
  const eng = cfg.engine

  if (eng === 'wavetable') {
    const tbl = engine.tables.get(cfg.wt.tableId) || engine.defaultTable
    if (!tbl) return false
    const uni = clamp(Math.round(cfg.unison), 1, engine.patch.global.quality === 'draft' ? 4 : MAX_UNI)
    const detune = clamp(vp(voice, `osc${oi}.detune`, cfg.detune), 0, 1)
    const blend = clamp(vp(voice, `osc${oi}.blend`, cfg.blend), 0, 1)
    const width = clamp(vp(voice, `osc${oi}.width`, cfg.width), 0, 1)
    const stW = clamp(cfg.stereo != null ? cfg.stereo : 1, 0, 1)
    const wtPos = clamp(vp(voice, `osc${oi}.wt.pos`, cfg.wt.pos), 0, 1)
    const framePos = cfg.wt.interp === 'off' ? Math.round(wtPos * (tbl.frames - 1)) : wtPos * (tbl.frames - 1)
    const w1m = cfg.wt.warp1.mode, w2m = cfg.wt.warp2.mode
    const w1a = clamp(vp(voice, `osc${oi}.wt.warp1.amount`, cfg.wt.warp1.amount), 0, 1)
    const w2a = clamp(vp(voice, `osc${oi}.wt.warp2.amount`, cfg.wt.warp2.amount), 0, 1)
    const fmSrc = cfg.wt.fmSource
    const modBuf = engine.oscMono[fmSrc]
    const remap = engine.remapLuts.get(`osc${oi}`)
    const freq = voice.curFreq * pitchRatioBase * (cfg.keytrackPitch ? 1 : midiFreq(60) / voice.curFreq)
    const norm = 1 / Math.sqrt(uni)
    // spectral warp: swap the table read for a cached harmonic-warped frame
    let swBuf = null
    const swCfg = cfg.wt.specWarp
    if (swCfg && swCfg.mode && swCfg.mode !== 'off') {
      const swAmt = clamp(vp(voice, `osc${oi}.wt.specWarp.amount`, swCfg.amount), 0, 1)
      const amtQ = Math.round(swAmt * 32)
      if (amtQ > 0) {
        const fpQ = Math.round(framePos * 4) / 4
        const baseInc = freq / sr
        let maxH = Math.floor(0.45 / Math.max(1e-6, baseInc * (1 + detune * 0.06)))
        maxH = Math.max(4, Math.min(1023, maxH))
        let bucket = 4
        while (bucket < maxH) bucket <<= 1
        const key = fpQ + '|' + swCfg.mode + '|' + amtQ + '|' + bucket + '|' + tbl.frames
        if (os.swKey !== key) { os.swBuf = computeSpecWarp(tbl, fpQ, swCfg.mode, amtQ / 32, Math.min(bucket, 1023)); os.swKey = key }
        swBuf = os.swBuf
      }
    }
    let ended = true
    for (let u = 0; u < uni; u++) {
      const ratio = unisonRatio(cfg.unisonMode, u, uni, detune, voice.note)
      const inc = freq * ratio / sr
      if (inc >= 0.5) continue
      ended = false
      const mipOff = mipFor(tbl, inc)
      const tData = mipOff == null ? tbl.data : tbl.mips
      const centerW = uni === 1 ? 1 : (u === (uni - 1) >> 1 ? 1 : blend)
      const sidePan = uni === 1 ? 0 : ((u % 2 ? 1 : -1) * ((u >> 1) + 1) / Math.max(1, uni >> 1)) * width
      let gl = centerW * norm * Math.cos((sidePan + 1) * Math.PI / 4) * 1.414
      let gr = centerW * norm * Math.sin((sidePan + 1) * Math.PI / 4) * 1.414
      if (stW < 1) { const mid = (gl + gr) * 0.5; gl = mid + (gl - mid) * stW; gr = mid + (gr - mid) * stW }
      let ph = os.phases[u]
      for (let s = 0; s < n; s++) {
        let p = ph
        // FM warp adds phase from mod osc
        if (w1m === 'fm') p += modBuf[s] * w1a * 0.5
        if (w2m === 'fm') p += modBuf[s] * w2a * 0.5
        p -= Math.floor(p)
        if (PHASE_WARPS[w1m] && w1m !== 'fm') p = w1m === 'remap' && remap ? lutEval(remap, p) : warpPhase(w1m, p, w1a)
        if (PHASE_WARPS[w2m] && w2m !== 'fm') p = w2m === 'remap' && remap ? lutEval(remap, p) : warpPhase(w2m, p, w2a)
        let y = swBuf ? swRead(swBuf, p) : tableSample(tbl, framePos, p, tData, mipOff == null ? 0 : mipOff)
        if (AMP_WARPS[w1m]) y = warpAmp(w1m, y, w1a, modBuf[s])
        if (AMP_WARPS[w2m]) y = warpAmp(w2m, y, w2a, modBuf[s])
        outL[s] += y * gl * panL
        outR[s] += y * gr * panR
        monoOut[s] += y * centerW * norm
        ph += inc
        if (ph >= 1) ph -= 1
      }
      os.phases[u] = ph
    }
    return !ended
  }

  if (eng === 'sample' || eng === 'multisample') {
    let smp, zone = null
    if (eng === 'multisample') { zone = os.msZone; smp = os.msBuf; if (!zone || !smp) return false }
    else { smp = engine.samples.get(cfg.smp.sampleId); if (!smp) return false }
    const sc = cfg.smp
    const srRatio = smp.sr / sr
    let pitchRatio
    if (eng === 'multisample') {
      pitchRatio = cfg.keytrackPitch ? Math.pow(2, (voice.note - zone.rootKey + zone.tune / 100) / 12) * pitchRatioBase : pitchRatioBase
    } else if (sc.keytrack && cfg.keytrackPitch) {
      pitchRatio = (voice.curFreq / midiFreq(sc.rootKey)) * pitchRatioBase
    } else pitchRatio = pitchRatioBase
    const rate = eng === 'sample' ? clamp(vp(voice, `osc${oi}.smp.rate`, sc.rate), -2, 2) : 1
    const startN = eng === 'sample' ? clamp(vp(voice, `osc${oi}.smp.start`, sc.start), 0, 1) : 0
    const endN = eng === 'sample' ? sc.end : 1
    const loopMode = eng === 'sample' ? sc.loopMode : zone.loopMode
    let loopS, loopE
    if (eng === 'sample') {
      loopS = clamp(vp(voice, `osc${oi}.smp.loopStart`, sc.loopStart), 0, 1) * smp.len
      loopE = clamp(vp(voice, `osc${oi}.smp.loopEnd`, sc.loopEnd), 0, 1) * smp.len
    } else { loopS = zone.loopStart * smp.len; loopE = zone.loopEnd * smp.len }
    if (loopE <= loopS + 4) loopE = loopS + 4
    const xfade = eng === 'sample' ? sc.xfade * (loopE - loopS) : 64
    const gain = (eng === 'multisample' ? dbToLin(zone.gain) : 1)
    // slice targeting
    let sliceStart = startN * smp.len, sliceEnd = endN * smp.len
    if (eng === 'sample' && sc.sliceMap === 'keys' && sc.slices.length) {
      const idx = clamp(voice.note - 36, 0, sc.slices.length - 1)
      const sorted = sc.slices
      sliceStart = sorted[idx].pos * smp.len
      sliceEnd = idx + 1 < sorted.length ? sorted[idx + 1].pos * smp.len : smp.len
      pitchRatio = pitchRatioBase // slices play at native pitch
    }
    const step0 = pitchRatio * srRatio * rate
    const stereo = smp.r ? 1 : 0
    let ended = true
    if (os.samplePos[0] < 0) { os.samplePos[0] = rate >= 0 ? sliceStart : sliceEnd - 2; os.sampleDir[0] = 1 }
    let pos = os.samplePos[0]
    let dir = os.sampleDir[0]
    const releasing = !voice.gate
    // sample-osc warps: fm = position modulation from another osc; pd = sine fold;
    // am/rm/saturate = amplitude warps
    const w1m = eng === 'sample' ? sc.warp1.mode : 'off'
    const w2m = eng === 'sample' ? sc.warp2.mode : 'off'
    const hasWarp = w1m !== 'off' || w2m !== 'off'
    const w1a = hasWarp ? clamp(vp(voice, `osc${oi}.smp.warp1.amount`, sc.warp1.amount), 0, 1) : 0
    const w2a = hasWarp ? clamp(vp(voice, `osc${oi}.smp.warp2.amount`, sc.warp2.amount), 0, 1) : 0
    const modBuf = engine.oscMono[cfg.wt.fmSource != null ? cfg.wt.fmSource : (oi + 1) % 3]
    for (let s = 0; s < n; s++) {
      let rpos = pos
      if (w1m === 'fm') rpos += modBuf[s] * w1a * 700 * srRatio
      if (w2m === 'fm') rpos += modBuf[s] * w2a * 700 * srRatio
      if (rpos >= sliceStart - 1 && rpos <= sliceEnd + 1) {
        let l = sampleAt(smp, rpos, 0)
        let r = stereo ? sampleAt(smp, rpos, 1) : l
        if (hasWarp) {
          for (const [wm, wa] of [[w1m, w1a], [w2m, w2a]]) {
            if (wa <= 0) continue
            if (wm === 'pd') { const d = 1 + wa * 6; l = Math.sin(l * d) / Math.tanh(d) * 0.8; r = Math.sin(r * d) / Math.tanh(d) * 0.8 }
            else if (AMP_WARPS[wm]) { l = warpAmp(wm, l, wa, modBuf[s]); r = warpAmp(wm, r, wa, modBuf[s]) }
          }
        }
        // loop crossfade: blend the approaching edge into the far edge
        if (loopMode !== 'off' && xfade > 1) {
          if (step0 * dir > 0 && pos > loopE - xfade && pos <= loopE) {
            const xf = (pos - (loopE - xfade)) / xfade
            const xpos = loopS - xfade + (pos - (loopE - xfade))
            if (xpos >= 0) {
              l = l * (1 - xf) + sampleAt(smp, xpos, 0) * xf
              r = stereo ? r * (1 - xf) + sampleAt(smp, xpos, 1) * xf : l
            }
          } else if (step0 * dir < 0 && pos < loopS + xfade && pos >= loopS) {
            const xf = (loopS + xfade - pos) / xfade
            const xpos = loopE + xfade - (loopS + xfade - pos)
            if (xpos < smp.len) {
              l = l * (1 - xf) + sampleAt(smp, xpos, 0) * xf
              r = stereo ? r * (1 - xf) + sampleAt(smp, xpos, 1) * xf : l
            }
          }
        }
        outL[s] += l * panL * gain
        outR[s] += r * panR * gain
        monoOut[s] += (l + r) * 0.5 * gain
        ended = false
      }
      pos += step0 * dir
      if (loopMode === 'loop' && !(loopMode === 'tails' && releasing)) {
        if (step0 * dir > 0 && pos >= loopE) pos = loopS + (pos - loopE)
        else if (step0 * dir < 0 && pos <= loopS) pos = loopE - (loopS - pos)
      } else if (loopMode === 'pingpong') {
        if (pos >= loopE) { pos = loopE - (pos - loopE); dir = -dir }
        else if (pos <= loopS && s > 0) { pos = loopS + (loopS - pos); dir = -dir }
      } else if (loopMode === 'tails') {
        if (!releasing) {
          if (step0 * dir > 0 && pos >= loopE) pos = loopS + (pos - loopE)
          else if (step0 * dir < 0 && pos <= loopS) pos = loopE - (loopS - pos)
        }
      }
    }
    os.samplePos[0] = pos
    os.sampleDir[0] = dir
    if (pos > sliceEnd + 2 && loopMode === 'off') { os.ended = true; return false }
    return !ended || loopMode !== 'off'
  }

  if (eng === 'granular') {
    const smp = engine.samples.get(cfg.gran.sampleId)
    if (!smp) return false
    const gc = cfg.gran
    const density = clamp(vp(voice, `osc${oi}.gran.density`, gc.density), 0.5, 200)
    const lengthMs = clamp(vp(voice, `osc${oi}.gran.length`, gc.length), 1, 500)
    const scan = clamp(vp(voice, `osc${oi}.gran.scan`, gc.scan), -2, 2)
    const posKnob = clamp(vp(voice, `osc${oi}.gran.pos`, gc.pos), 0, 1)
    const spray = clamp(vp(voice, `osc${oi}.gran.spray`, gc.spray), 0, 1)
    const pitchRand = vp(voice, `osc${oi}.gran.pitchRand`, gc.pitchRand)
    const panRand = clamp(vp(voice, `osc${oi}.gran.panRand`, gc.panRand), 0, 1)
    const winShape = clamp(vp(voice, `osc${oi}.gran.windowShape`, gc.windowShape), 0, 1)
    const srRatio = smp.sr / sr
    const pitchRatio = (gc.keytrack && cfg.keytrackPitch ? voice.curFreq / midiFreq(gc.rootKey) : 1) * pitchRatioBase
    if (!os.scanInit) { os.scanPos = posKnob * smp.len; os.scanInit = true }
    if (gc.manual) os.scanPos = posKnob * smp.len
    const uni = clamp(Math.round(cfg.unison), 1, MAX_UNI)
    const detune = clamp(vp(voice, `osc${oi}.detune`, cfg.detune), 0, 1)
    const spawnPeriod = sr / density
    const stereo = smp.r ? 1 : 0
    for (let s = 0; s < n; s++) {
      // advance scan
      if (!gc.manual) {
        os.scanPos += scan * srRatio
        if (os.scanPos >= smp.len) os.scanPos = gc.loopGrains ? 0 : smp.len - 1
        if (os.scanPos < 0) os.scanPos = gc.loopGrains ? smp.len - 1 : 0
      }
      os.grainTimer -= 1
      if (os.grainTimer <= 0) {
        os.grainTimer += spawnPeriod
        // true per-grain unison: one grain per unison voice, own detune/pan/blend
        const blend = clamp(vp(voice, `osc${oi}.blend`, cfg.blend), 0, 1)
        const width = clamp(vp(voice, `osc${oi}.width`, cfg.width), 0, 1)
        const uniNorm = 1 / Math.sqrt(uni)
        const sprayOff = (grng() * 2 - 1) * spray * smp.len * 0.25
        const basePos = clamp(os.scanPos + sprayOff, 0, smp.len - 2)
        os.grainAlt++
        for (let u = 0; u < uni; u++) {
          let g = null
          for (const gg of os.grains) if (!gg.active) { g = gg; break }
          if (!g) break
          g.active = true
          g.t = 0
          g.dur = Math.max(8, lengthMs * 0.001 * sr)
          g.pos = basePos
          const uRatio = unisonRatio(cfg.unisonMode, u, uni, detune, voice.note)
          const pr = pitchRand > 0 ? Math.pow(2, (grng() * 2 - 1) * pitchRand / 12) : 1
          g.rate = pitchRatio * uRatio * pr * srRatio
          g.dir = gc.direction === 'rev' ? -1 : gc.direction === 'alt' ? (os.grainAlt % 2 ? 1 : -1) : 1
          const centerW = uni === 1 ? 1 : (u === (uni - 1) >> 1 ? 1 : blend)
          const sidePan = uni === 1 ? 0 : ((u % 2 ? 1 : -1) * ((u >> 1) + 1) / Math.max(1, uni >> 1)) * width
          const gp = clamp(sidePan + (grng() * 2 - 1) * panRand, -1, 1)
          const lvl = centerW * uniNorm
          g.panL = Math.cos((gp + 1) * Math.PI / 4) * 1.414 * lvl
          g.panR = Math.sin((gp + 1) * Math.PI / 4) * 1.414 * lvl
        }
      }
      let accL = 0, accR = 0
      for (const g of os.grains) {
        if (!g.active) continue
        const tNorm = g.t / g.dur
        if (tNorm >= 1) { g.active = false; continue }
        const w = grainWindow(tNorm, winShape, gc.windowSkew, gc.windowAmount)
        const sm = sampleAt(smp, g.pos, 0)
        const smR = stereo ? sampleAt(smp, g.pos, 1) : sm
        accL += sm * w * g.panL
        accR += smR * w * g.panR
        g.pos += g.rate * g.dir
        if (gc.loopGrains) {
          if (g.pos >= smp.len) g.pos = 0
          if (g.pos < 0) g.pos = smp.len - 1
        } else if (g.pos < 0 || g.pos >= smp.len) g.active = false
        g.t++
      }
      const sc = 0.5
      outL[s] += accL * sc * panL
      outR[s] += accR * sc * panR
      monoOut[s] += (accL + accR) * 0.25
    }
    engine.grainViz[oi] = os.scanPos / smp.len
    return true
  }

  if (eng === 'spectral') {
    const spec = engine.spectral.get(cfg.spec.sampleId)
    if (!spec) return false
    return renderSpectral(engine, voice, oi, cfg, spec, n, outL, outR, monoOut, panL, panR, pitchRatioBase)
  }
  return false
}

// ---------- spectral resynthesis (phase vocoder + pitch resample) ----------
const SPEC_FFT = 2048
const SPEC_HOP = 512
const specRe = new Float32Array(SPEC_FFT)
const specIm = new Float32Array(SPEC_FFT)
const specMagWork = new Float32Array(SPEC_FFT / 2 + 1)
const specEnvWork = new Float32Array(SPEC_FFT / 2 + 1)
const specEnvShift = new Float32Array(SPEC_FFT / 2 + 1)
const specHann = new Float32Array(SPEC_FFT)
for (let i = 0; i < SPEC_FFT; i++) specHann[i] = 0.5 - 0.5 * Math.cos(TWO_PI * i / SPEC_FFT)
const specPeakOf = new Int32Array(SPEC_FFT / 2 + 1) // nearest-peak index per bin

function renderSpectral(engine, voice, oi, cfg, spec, n, outL, outR, monoOut, panL, panR, pitchRatioBase) {
  const os = voice.oscs[oi]
  const sr = engine.sr
  const sc = cfg.spec
  const vp = (vv, pp, bb) => engine.vp(vv, pp, bb)
  const bins = spec.bins
  const frames = spec.frames
  if (!os.specPhases) {
    os.specPhases = new Float32Array(bins)
    os.specSmear = new Float32Array(bins)
    os.olaBuf = new Float32Array(SPEC_FFT * 4)
    os.olaWrite = 0
    os.olaRead = 0
    os.olaFilled = 0
    os.specPos = clamp(vp(voice, `osc${oi}.spec.pos`, sc.pos), 0, 1) * (frames - 1)
    for (let b = 0; b < bins; b++) os.specPhases[b] = grng() * TWO_PI
  }
  const speed = sc.freeze ? 0 : clamp(vp(voice, `osc${oi}.spec.speed`, sc.speed), -2, 2)
  const posMod = engine.destTouched(voice, `osc${oi}.spec.pos`)
  const smear = clamp(vp(voice, `osc${oi}.spec.smear`, sc.smear), 0, 1)
  const shift = clamp(vp(voice, `osc${oi}.spec.shift`, sc.shift), -1, 1)
  const pitchShift = vp(voice, `osc${oi}.spec.pitchShift`, sc.pitchShift)
  const formant = vp(voice, `osc${oi}.spec.formant`, sc.formant)
  const spread = clamp(vp(voice, `osc${oi}.spec.spread`, sc.spread), 0, 1)
  const gate = clamp(vp(voice, `osc${oi}.spec.gate`, sc.gate), 0, 1)
  const curve = sc.filterCurve
  const keyRatio = sc.keytrack && cfg.keytrackPitch ? voice.curFreq / midiFreq(sc.rootKey) : 1
  const readStep = keyRatio * pitchRatioBase * Math.pow(2, pitchShift / 12) * (spec.sr / sr)
  const olaLen = os.olaBuf.length

  for (let s = 0; s < n; s++) {
    // ensure enough synthesized samples ahead of read cursor
    while (os.olaFilled < SPEC_FFT + SPEC_HOP) {
      // pull one hop of resynthesis at analysis frame os.specPos
      if (posMod) os.specPos = clamp(vp(voice, `osc${oi}.spec.pos`, sc.pos), 0, 1) * (frames - 1)
      const fp = clamp(os.specPos, 0, frames - 1)
      const f0 = fp | 0, ff = fp - f0
      const m0 = f0 * bins, m1 = Math.min(f0 + 1, frames - 1) * bins
      for (let b = 0; b < bins; b++) {
        specMagWork[b] = spec.mags[m0 + b] * (1 - ff) + spec.mags[m1 + b] * ff
      }
      // smear (temporal low-pass on magnitudes)
      if (smear > 0.001) {
        const c = 1 - Math.pow(smear, 0.35) * 0.98
        for (let b = 0; b < bins; b++) { os.specSmear[b] += c * (specMagWork[b] - os.specSmear[b]); specMagWork[b] = os.specSmear[b] }
      }
      // formant shift: extract envelope (smoothed log-mag), divide out, shift, re-apply
      if (Math.abs(formant) > 0.05) {
        let acc = 0
        for (let b = 0; b < bins; b++) { acc += (specMagWork[b] - acc) * 0.08; specEnvWork[b] = acc }
        for (let b = bins - 1; b >= 0; b--) { acc += (specEnvWork[b] - acc) * 0.5; specEnvWork[b] = Math.max(specEnvWork[b], acc * 0.7) }
        const fr = Math.pow(2, -formant / 12)
        for (let b = 0; b < bins; b++) {
          const src = clamp(Math.round(b * fr), 0, bins - 1)
          specEnvShift[b] = specEnvWork[src]
        }
        for (let b = 0; b < bins; b++) {
          const e = specEnvWork[b] > 1e-9 ? specMagWork[b] / specEnvWork[b] : 0
          specMagWork[b] = e * specEnvShift[b]
        }
      }
      // spread: stretch harmonics upward
      if (spread > 0.001) {
        for (let b = bins - 1; b >= 1; b--) {
          const src = b / (1 + spread * (b / bins))
          const si = src | 0
          if (si < bins - 1) specMagWork[b] = specMagWork[si] + (specMagWork[si + 1] - specMagWork[si]) * (src - si)
        }
      }
      // linear bin shift
      if (Math.abs(shift) > 0.002) {
        const off = Math.round(shift * bins * 0.25)
        if (off > 0) { for (let b = bins - 1; b >= off; b--) specMagWork[b] = specMagWork[b - off]; for (let b = 0; b < off; b++) specMagWork[b] = 0 }
        else { for (let b = 0; b < bins + off; b++) specMagWork[b] = specMagWork[b - off]; for (let b = bins + off; b < bins; b++) specMagWork[b] = 0 }
      }
      // gate
      if (gate > 0.001) {
        let mx = 0
        for (let b = 0; b < bins; b++) if (specMagWork[b] > mx) mx = specMagWork[b]
        const th = mx * gate * gate
        for (let b = 0; b < bins; b++) if (specMagWork[b] < th) specMagWork[b] = 0
      }
      // drawable spectral filter curve (64 points over log bins)
      if (curve && curve.length === 64) {
        for (let b = 1; b < bins; b++) {
          const x = Math.log2(1 + b) / Math.log2(bins) * 63
          const xi = x | 0
          const g = curve[xi] + (curve[Math.min(63, xi + 1)] - curve[xi]) * (x - xi)
          specMagWork[b] *= g
        }
      }
      // phase handling: onsets reset toward analysis phases (transient punch);
      // otherwise identity phase-locking (Laroche-Dolson): only spectral peaks
      // accumulate phase, neighbors keep their analysis-frame offset from the
      // peak — dramatically less phasiness on complex material.
      const isOnset = spec.onsets && spec.onsets[f0] && os.specFrame !== f0
      const usePhases = isOnset && spec.phases && sc.transients > 0.01
      if (usePhases) {
        for (let b = 0; b < bins; b++) {
          const ap = spec.phases[m0 + b]
          os.specPhases[b] += (ap - os.specPhases[b]) * sc.transients
        }
      } else if (spec.phases) {
        // mark peaks and assign every bin to its nearest peak (valley split)
        let lastPeak = -1
        for (let b = 1; b < bins - 1; b++) {
          if (specMagWork[b] > 1e-7 && specMagWork[b] >= specMagWork[b - 1] && specMagWork[b] > specMagWork[b + 1]) {
            if (lastPeak >= 0) {
              // split the region between the two peaks at the magnitude valley
              let valley = lastPeak
              for (let k = lastPeak + 1; k < b; k++) if (specMagWork[k] < specMagWork[valley]) valley = k
              for (let k = lastPeak; k <= valley; k++) specPeakOf[k] = lastPeak
              for (let k = valley + 1; k <= b; k++) specPeakOf[k] = b
            } else {
              for (let k = 0; k <= b; k++) specPeakOf[k] = b
            }
            lastPeak = b
          }
        }
        if (lastPeak < 0) lastPeak = 0
        for (let k = lastPeak; k < bins; k++) specPeakOf[k] = lastPeak
        // advance peak phases, lock members to peak + analysis offset
        for (let b = 0; b < bins; b++) {
          if (specPeakOf[b] === b) {
            os.specPhases[b] += TWO_PI * b * SPEC_HOP / SPEC_FFT
            if (os.specPhases[b] > 1e4) os.specPhases[b] %= TWO_PI
          }
        }
        for (let b = 0; b < bins; b++) {
          const pk = specPeakOf[b]
          if (pk !== b) os.specPhases[b] = os.specPhases[pk] + (spec.phases[m0 + b] - spec.phases[m0 + pk])
        }
      } else {
        for (let b = 0; b < bins; b++) {
          os.specPhases[b] += TWO_PI * b * SPEC_HOP / SPEC_FFT
          if (os.specPhases[b] > 1e4) os.specPhases[b] %= TWO_PI
        }
      }
      os.specFrame = f0
      // iFFT
      specRe.fill(0); specIm.fill(0)
      for (let b = 0; b < bins; b++) {
        const m = specMagWork[b]
        if (m < 1e-9) continue
        const phc = os.specPhases[b]
        const re = m * Math.cos(phc), im = m * Math.sin(phc)
        specRe[b] = re; specIm[b] = im
        if (b > 0 && b < bins - 1) { specRe[SPEC_FFT - b] = re; specIm[SPEC_FFT - b] = -im }
      }
      fftInPlace(specRe, specIm, true)
      // overlap-add hop into ring
      for (let i = 0; i < SPEC_FFT; i++) {
        const idx = (os.olaWrite + i) % olaLen
        os.olaBuf[idx] += specRe[i] * specHann[i] * (2 / 3)
      }
      os.olaWrite = (os.olaWrite + SPEC_HOP) % olaLen
      os.olaFilled += SPEC_HOP
      // advance analysis playhead: speed 1 = natural rate
      os.specPos += speed * (SPEC_HOP / spec.hop) * (spec.hop / SPEC_HOP)
      if (os.specPos >= frames - 1) os.specPos = speed > 0 ? 0 : frames - 1
      if (os.specPos < 0) os.specPos = frames - 1
    }
    // read with pitch resample
    const ri = os.olaRead | 0
    const rf = os.olaRead - ri
    const a = os.olaBuf[ri % olaLen]
    const b2 = os.olaBuf[(ri + 1) % olaLen]
    const y = a + (b2 - a) * rf
    outL[s] += y * panL
    outR[s] += y * panR
    monoOut[s] += y
    const prevRead = os.olaRead
    os.olaRead += readStep
    const consumed = (os.olaRead | 0) - (prevRead | 0)
    if (consumed > 0) {
      // zero consumed cells so future OLA writes start clean
      for (let c = 0; c < consumed; c++) os.olaBuf[((prevRead | 0) + c) % olaLen] = 0
      os.olaFilled -= consumed
    }
    if (os.olaRead >= olaLen) os.olaRead -= olaLen
  }
  engine.specViz[oi] = os.specPos / Math.max(1, frames - 1)
  return true
}

// ---------- FX ----------
class Biquad {
  constructor() { this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0; this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0 }
  set(b0, b1, b2, a0, a1, a2) { this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0 }
  peak(freq, q, gainDb, sr) {
    const A = Math.pow(10, gainDb / 40), w = TWO_PI * clamp(freq, 10, sr * 0.49) / sr
    const al = Math.sin(w) / (2 * q), c = Math.cos(w)
    this.set(1 + al * A, -2 * c, 1 - al * A, 1 + al / A, -2 * c, 1 - al / A)
  }
  shelf(freq, gainDb, high, sr) {
    const A = Math.pow(10, gainDb / 40), w = TWO_PI * clamp(freq, 10, sr * 0.49) / sr
    const c = Math.cos(w), s = Math.sin(w)
    const beta = Math.sqrt(A) / 0.9
    if (!high) this.set(A * ((A + 1) - (A - 1) * c + beta * s), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - beta * s), (A + 1) + (A - 1) * c + beta * s, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - beta * s)
    else this.set(A * ((A + 1) + (A - 1) * c + beta * s), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - beta * s), (A + 1) - (A - 1) * c + beta * s, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - beta * s)
  }
  lp(freq, q, sr) {
    const w = TWO_PI * clamp(freq, 10, sr * 0.49) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w)
    this.set((1 - c) / 2, 1 - c, (1 - c) / 2, 1 + al, -2 * c, 1 - al)
  }
  hp(freq, q, sr) {
    const w = TWO_PI * clamp(freq, 10, sr * 0.49) / sr, al = Math.sin(w) / (2 * q), c = Math.cos(w)
    this.set((1 + c) / 2, -(1 + c), (1 + c) / 2, 1 + al, -2 * c, 1 - al)
  }
  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y
    return y
  }
}

const DIST_MODES = ['tube', 'soft', 'hard', 'diode', 'fold', 'sine', 'zeroSquare', 'asym', 'rectify', 'bitcrush', 'downsample', 'overdrive']
function distSample(mode, x, d) {
  const drive = 1 + d * 30
  switch (mode) {
    case 0: return Math.tanh(x * drive) // tube
    case 1: { const y = x * drive; return y / (1 + Math.abs(y)) } // soft
    case 2: return clamp(x * drive, -0.8, 0.8) * 1.25 // hard
    case 3: { const y = x * drive; return (y > 0 ? 1 - Math.exp(-y) : -1 + Math.exp(y)) * 0.9 } // diode
    case 4: { let y = x * drive; y = y - 4 * Math.floor((y + 2) / 4) ; return Math.abs(y - 1) - 1 ? (Math.abs(((y + 1) % 4 + 4) % 4 - 2) - 1) : y } // fold
    case 5: return Math.sin(x * drive) // sine
    case 6: return x === 0 ? 0 : Math.sign(x) * Math.pow(Math.abs(clamp(x * drive, -1, 1)), 0.3) // zero square
    case 7: { const y = x * drive; return Math.tanh(y + 0.3 * y * y) * 0.9 } // asym
    case 8: return Math.abs(x * drive) * 2 - 0.5 // rectify-ish
    case 11: { const y = x * drive * 0.7; return Math.tanh(y * (1 + Math.abs(y))) } // overdrive (2-stage)
    default: return Math.tanh(x * drive)
  }
}

// simple IIR Hilbert-pair approximation for frequency shifting
class Hilbert {
  constructor() {
    this.a = [0.6923878, 0.9360654322959, 0.9882295226860, 0.9987488452737].map(c => ({ c, x1: 0, x2: 0, y1: 0, y2: 0 }))
    this.b = [0.4021921162426, 0.8561710882420, 0.9722909545651, 0.9952884791278].map(c => ({ c, x1: 0, x2: 0, y1: 0, y2: 0 }))
    this.delay = 0
  }
  static ap(st, x) {
    const c2 = st.c * st.c
    const y = c2 * (x + st.y2) - st.x2
    st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y
    return y
  }
  process(x) {
    let re = x, im = x
    for (const st of this.a) re = Hilbert.ap(st, re)
    for (const st of this.b) im = Hilbert.ap(st, im)
    const d = this.delay; this.delay = re
    return [d, im]
  }
}

class FxState {
  constructor(type, sr, bpm) {
    this.type = type
    this.sr = sr
    const S = sr
    this.phase = 0
    this.phase2 = 0
    switch (type) {
      case 'chorus': case 'flanger':
        this.dlL = new DelayLine(S * 0.06); this.dlR = new DelayLine(S * 0.06); break
      case 'phaser':
        this.apL = Array.from({ length: 12 }, () => ({ z: 0 }))
        this.apR = Array.from({ length: 12 }, () => ({ z: 0 }))
        this.fbL = 0; this.fbR = 0; break
      case 'delay':
        this.dlL = new DelayLine(S * 4); this.dlR = new DelayLine(S * 4)
        this.lpL = new OnePole(); this.lpR = new OnePole(); this.hpL = new OnePole(); this.hpR = new OnePole(); break
      case 'echobode':
        this.dlL = new DelayLine(S * 4); this.dlR = new DelayLine(S * 4)
        this.hilL = new Hilbert(); this.hilR = new Hilbert()
        this.apsL = [new Allpass(1024), new Allpass(1400), new Allpass(1900)]
        this.apsR = [new Allpass(1100), new Allpass(1500), new Allpass(2100)]; break
      case 'compressor':
        this.envG = 0
        this.bands = [0, 1, 2].map(() => ({ envG: 0, lpL: new SVF(), lpR: new SVF(), hpL: new SVF(), hpR: new SVF() }))
        this.xoLo = [new SVF(), new SVF()], this.xoHi = [new SVF(), new SVF()]
        this.xoLo2 = [new SVF(), new SVF()], this.xoHi2 = [new SVF(), new SVF()]; break
      case 'reverb': this.initReverb(sr); break
      case 'convolve': this.conv = null; this.irKey = ''; break
      case 'eq': this.bq = [new Biquad(), new Biquad(), new Biquad(), new Biquad()]; break
      case 'noisegate': this.env = 0; this.g = 0; this.holdN = 0; break
      case 'deesser': this.bpL = new SVF(); this.bpR = new SVF(); this.envG = 0; break
      case 'transientshaper': this.envF = 0; this.envS = 0; break
      case 'dyneq':
        this.bqL = new Biquad(); this.bqR = new Biquad()
        this.det = new SVF(); this.envDb = -90; this.lastG = 0; this.eqKey = ''; break
      case 'filter': this.vfL = new VoiceFilter(sr); this.vfR = new VoiceFilter(sr); break
      case 'hyper':
        this.taps = Array.from({ length: 8 }, () => new DelayLine(S * 0.05))
        this.dimL = new DelayLine(S * 0.1); this.dimR = new DelayLine(S * 0.1); break
      case 'octaver':
        this.obuf = new Float32Array(4096); this.opos = 0; this.oread = 0; this.oread2 = 0; break
      case 'bitcrush': this.hL = 0; this.hR = 0; this.ph = 0; break
    }
  }
  initReverb(sr) {
    const S = sr / 44100
    this.preDl = new DelayLine(sr * 0.25)
    this.inLp = new OnePole()
    this.inAp = [142, 107, 379, 277].map(d => new Allpass(Math.ceil(d * S) + 8))
    this.tank = {
      ap1: new Allpass(Math.ceil(672 * S) + 2400), ap2: new Allpass(Math.ceil(1800 * S) + 8),
      dl1: new DelayLine(Math.ceil(4453 * S) + 8), dl2: new DelayLine(Math.ceil(3720 * S) + 8),
      ap3: new Allpass(Math.ceil(908 * S) + 2400), ap4: new Allpass(Math.ceil(2656 * S) + 8),
      dl3: new DelayLine(Math.ceil(4217 * S) + 8), dl4: new DelayLine(Math.ceil(3163 * S) + 8),
      lp1: new OnePole(), lp2: new OnePole(), f1: 0, f2: 0,
    }
    this.modPhase = 0
    this.hpL = new OnePole(); this.hpR = new OnePole()
  }
}

function processFxUnit(engine, unit, st, L, R, n) {
  const p = unit.params
  const sr = engine.sr
  const mixKey = `fx.${unit.id}.mix`
  const mix = clamp(engine.gmodVal(mixKey, unit.mix), 0, 1)
  const P = (key, def) => engine.gmodVal(`fx.${unit.id}.${key}`, p[key] != null ? p[key] : def)
  switch (unit.type) {
    case 'distortion': {
      const mode = Math.round(P('mode', 0))
      const drive = clamp(P('drive', 0.3), 0, 1)
      const bias = clamp(P('bias', 0), -1, 1) * 0.3
      const fpos = Math.round(P('filterPos', 0))
      const ftype = Math.round(P('filterType', 0))
      const cutoff = cutoffHz(clamp(P('cutoff', 0.7), 0, 1))
      const res = clamp(P('res', 0.2), 0, 0.95)
      if (!st.fbqL) { st.fbqL = new SVF(); st.fbqR = new SVF(); st.dcL = new OnePole(); st.dcR = new OnePole() }
      const g = svfG(cutoff, sr), k = 2 - 1.9 * res
      const dcC = onePoleCoeff(10, sr)
      for (let i = 0; i < n; i++) {
        let l = L[i] + bias, r = R[i] + bias
        if (fpos === 1) {
          st.fbqL.process(l, g, k); st.fbqR.process(r, g, k)
          l = ftype === 0 ? st.fbqL.lp : ftype === 1 ? st.fbqL.bp : st.fbqL.hp
          r = ftype === 0 ? st.fbqR.lp : ftype === 1 ? st.fbqR.bp : st.fbqR.hp
        }
        if (mode === 9) { // bitcrush in dist menu
          const q = Math.pow(2, 2 + (1 - drive) * 12)
          l = Math.round(l * q) / q; r = Math.round(r * q) / q
        } else if (mode === 10) {
          st.ph = (st.ph || 0) + 1
          const hold = 1 + Math.round(drive * 40)
          if (st.ph % hold === 0) { st.hL = l; st.hR = r }
          l = st.hL; r = st.hR
        } else { l = distSample(mode, l, drive); r = distSample(mode, r, drive) }
        if (fpos === 2) {
          st.fbqL.process(l, g, k); st.fbqR.process(r, g, k)
          l = ftype === 0 ? st.fbqL.lp : ftype === 1 ? st.fbqL.bp : st.fbqL.hp
          r = ftype === 0 ? st.fbqR.lp : ftype === 1 ? st.fbqR.bp : st.fbqR.hp
        }
        if (bias !== 0) { l -= st.dcL.lp(l, dcC); r -= st.dcR.lp(r, dcC) }
        L[i] = lerp(L[i], l, mix); R[i] = lerp(R[i], r, mix)
      }
      return
    }
    case 'chorus': {
      const rate = P('rate', 0.4), depth = clamp(P('depth', 0.4), 0, 1)
      const baseMs = P('delay', 8), fb = clamp(P('feedback', 0.2), 0, 0.95), lpf = clamp(P('lpf', 0.8), 0, 1)
      const voices = Math.round(clamp(P('voices', 2), 2, 4))
      if (!st.lpfL) { st.lpfL = new OnePole(); st.lpfR = new OnePole() }
      const lpc = onePoleCoeff(cutoffHz(lpf), sr)
      for (let i = 0; i < n; i++) {
        st.phase += rate / sr
        if (st.phase >= 1) st.phase -= 1
        let wl = 0, wr = 0
        for (let v = 0; v < voices; v++) {
          const ph = st.phase + v / voices
          const lfo = Math.sin(TWO_PI * ph)
          const lfo2 = Math.sin(TWO_PI * (ph + 0.25))
          const dl = (baseMs + lfo * depth * baseMs * 0.6) * sr / 1000
          const dr = (baseMs + lfo2 * depth * baseMs * 0.6) * sr / 1000
          wl += st.dlL.read(dl); wr += st.dlR.read(dr)
        }
        wl /= voices; wr /= voices
        st.dlL.write(L[i] + st.lpfL.lp(wl, lpc) * fb)
        st.dlR.write(R[i] + st.lpfR.lp(wr, lpc) * fb)
        L[i] = lerp(L[i], (L[i] + wl) * 0.7, mix)
        R[i] = lerp(R[i], (R[i] + wr) * 0.7, mix)
      }
      return
    }
    case 'flanger': {
      const rate = P('rate', 0.25), depth = clamp(P('depth', 0.6), 0, 1)
      const fb = clamp(P('feedback', 0.6), 0, 0.97), phOff = P('phase', 90) / 360
      const center = clamp(P('center', 0.3), 0, 1)
      for (let i = 0; i < n; i++) {
        st.phase += rate / sr
        if (st.phase >= 1) st.phase -= 1
        const baseMs = 0.5 + center * 9
        const dl = (baseMs + Math.sin(TWO_PI * st.phase) * depth * baseMs * 0.9) * sr / 1000
        const dr = (baseMs + Math.sin(TWO_PI * (st.phase + phOff)) * depth * baseMs * 0.9) * sr / 1000
        const wl = st.dlL.read(Math.max(2, dl))
        const wr = st.dlR.read(Math.max(2, dr))
        st.dlL.write(L[i] + wl * fb)
        st.dlR.write(R[i] + wr * fb)
        L[i] = lerp(L[i], (L[i] + wl) * 0.7, mix)
        R[i] = lerp(R[i], (R[i] + wr) * 0.7, mix)
      }
      return
    }
    case 'phaser': {
      const rate = P('rate', 0.3), depth = clamp(P('depth', 0.6), 0, 1)
      const freqN = clamp(P('freq', 0.5), 0, 1), fb = clamp(P('feedback', 0.5), 0, 0.95)
      const stages = Math.round(clamp(P('stages', 6), 2, 12))
      const phOff = P('phase', 45) / 360
      for (let i = 0; i < n; i++) {
        st.phase += rate / sr
        if (st.phase >= 1) st.phase -= 1
        const fL = cutoffHz(clamp(freqN + Math.sin(TWO_PI * st.phase) * depth * 0.35, 0, 1))
        const fR = cutoffHz(clamp(freqN + Math.sin(TWO_PI * (st.phase + phOff)) * depth * 0.35, 0, 1))
        const cL = clamp((1 - Math.tan(Math.PI * Math.min(fL, sr * 0.45) / sr)) / (1 + Math.tan(Math.PI * Math.min(fL, sr * 0.45) / sr)), -0.98, 0.98)
        const cR = clamp((1 - Math.tan(Math.PI * Math.min(fR, sr * 0.45) / sr)) / (1 + Math.tan(Math.PI * Math.min(fR, sr * 0.45) / sr)), -0.98, 0.98)
        let yl = L[i] + st.fbL * fb, yr = R[i] + st.fbR * fb
        for (let s2 = 0; s2 < stages; s2++) {
          const a = st.apL[s2]; const yo = -cL * yl + a.z; a.z = yl + cL * yo; yl = yo
          const b = st.apR[s2]; const yo2 = -cR * yr + b.z; b.z = yr + cR * yo2; yr = yo2
        }
        st.fbL = yl; st.fbR = yr
        L[i] = lerp(L[i], (L[i] + yl) * 0.6, mix)
        R[i] = lerp(R[i], (R[i] + yr) * 0.6, mix)
      }
      return
    }
    case 'delay': {
      const sync = P('sync', 1) > 0.5
      const beats = engine.SYNC_BEATS
      const tl = sync ? beats[Math.round(clamp(P('timeL', 9), 0, beats.length - 1))] * 60 / engine.bpm : P('freeMs', 350) / 1000
      const tr = sync ? beats[Math.round(clamp(P('timeR', 9), 0, beats.length - 1))] * 60 / engine.bpm : P('freeMs', 350) / 1000
      const fb = clamp(P('feedback', 0.4), 0, 1.1)
      const pp = P('pingpong', 0) > 0.5
      const lpc = onePoleCoeff(cutoffHz(clamp(P('lpf', 0.75), 0, 1)), sr)
      const hpc = onePoleCoeff(cutoffHz(clamp(P('hpf', 0.1), 0, 1)), sr)
      const tape = clamp(P('tape', 0), 0, 1)
      const dSampsL = clamp(tl * sr, 32, sr * 4 - 4)
      const dSampsR = clamp(tr * sr, 32, sr * 4 - 4)
      for (let i = 0; i < n; i++) {
        st.phase += 0.6 / sr
        if (st.phase >= 1) st.phase -= 1
        const wob = tape > 0 ? Math.sin(TWO_PI * st.phase) * tape * 30 : 0
        let wl = st.dlL.read(dSampsL + wob)
        let wr = st.dlR.read(dSampsR + wob * 1.3)
        wl = st.lpL.lp(wl, lpc); wl = wl - st.hpL.lp(wl, hpc)
        wr = st.lpR.lp(wr, lpc); wr = wr - st.hpR.lp(wr, hpc)
        if (tape > 0) { wl = Math.tanh(wl * (1 + tape)); wr = Math.tanh(wr * (1 + tape)) }
        if (pp) {
          st.dlL.write(R[i] * 0.9 + wr * fb)
          st.dlR.write(wl * fb + L[i] * 0.0)
        } else {
          st.dlL.write(L[i] + wl * fb)
          st.dlR.write(R[i] + wr * fb)
        }
        L[i] = lerp(L[i], L[i] + wl, mix)
        R[i] = lerp(R[i], R[i] + wr, mix)
      }
      return
    }
    case 'echobode': {
      const shift = P('shift', 120)
      const sync = P('sync', 1) > 0.5
      const beats = engine.SYNC_BEATS
      const t = sync ? beats[Math.round(clamp(P('time', 7), 0, beats.length - 1))] * 60 / engine.bpm : 0.35
      const fb = clamp(P('feedback', 0.5), 0, 0.98)
      const diff = clamp(P('diffusion', 0.3), 0, 1)
      const lfoRate = P('lfoRate', 0.3), lfoAmt = clamp(P('lfoAmt', 0), 0, 1)
      const dSamps = clamp(t * sr, 32, sr * 4 - 4)
      for (let i = 0; i < n; i++) {
        st.phase2 += lfoRate / sr
        if (st.phase2 >= 1) st.phase2 -= 1
        const sh = shift * (1 + Math.sin(TWO_PI * st.phase2) * lfoAmt * 0.5)
        st.phase += sh / sr
        st.phase -= Math.floor(st.phase)
        const c = Math.cos(TWO_PI * st.phase), s2 = Math.sin(TWO_PI * st.phase)
        let wl = st.dlL.read(dSamps)
        let wr = st.dlR.read(dSamps * 1.01)
        if (diff > 0.01) {
          for (const ap of st.apsL) wl = ap.process(wl, 200 + diff * 700, 0.5 * diff)
          for (const ap of st.apsR) wr = ap.process(wr, 220 + diff * 750, 0.5 * diff)
        }
        const [reL, imL] = st.hilL.process(wl)
        const [reR, imR] = st.hilR.process(wr)
        const shL = reL * c - imL * s2
        const shR = reR * c - imR * s2
        st.dlL.write(L[i] + shL * fb)
        st.dlR.write(R[i] + shR * fb)
        L[i] = lerp(L[i], L[i] + shL, mix)
        R[i] = lerp(R[i], R[i] + shR, mix)
      }
      return
    }
    case 'compressor': {
      const th = P('threshold', -18), ratio = Math.max(1, P('ratio', 4))
      const atk = Math.exp(-1 / (P('attack', 10) * 0.001 * sr))
      const rel = Math.exp(-1 / (P('release', 120) * 0.001 * sr))
      const makeup = dbToLin(P('makeup', 0))
      // OTT-style upward compression: signals BELOW threshold are pushed up
      // toward it (capped at 24 dB, gated below -60 dB so silence stays silent)
      const upAmt = clamp(P('upward', 0), 0, 1)
      const upTarget = (db) => {
        if (upAmt <= 0 || db >= th || db < -60) return 0
        return Math.min(24, (th - db) * (1 - 1 / ratio)) * upAmt
      }
      const mb = P('multiband', 0) > 0.5
      // external sidechain key (fx-only host mode): the detector listens to
      // the key input while the gain applies to the chain signal
      const keyL = P('sidechain', 0) > 0.5 && engine._key && engine._key[0] ? engine._key[0] : null
      const keyR = keyL && engine._key[1] ? engine._key[1] : keyL
      if (!mb) {
        for (let i = 0; i < n; i++) {
          const inLvl = keyL
            ? Math.max(Math.abs(keyL[i] || 0), Math.abs(keyR[i] || 0))
            : Math.max(Math.abs(L[i]), Math.abs(R[i]))
          const db = 20 * Math.log10(inLvl + 1e-9)
          const over = db - th
          const targetGr = over > 0 ? -over * (1 - 1 / ratio) : upTarget(db)
          st.envG = targetGr < st.envG ? atk * st.envG + (1 - atk) * targetGr : rel * st.envG + (1 - rel) * targetGr
          const g = dbToLin(st.envG) * makeup
          L[i] = lerp(L[i], L[i] * g, mix); R[i] = lerp(R[i], R[i] * g, mix)
        }
        engine.fxGr[unit.id] = [st.envG]
      } else {
        const loF = cutoffHz(clamp(P('loFreq', 0.25), 0, 1)), hiF = cutoffHz(clamp(P('hiFreq', 0.7), 0, 1))
        const gLo = svfG(loF, sr), gHi = svfG(hiF, sr)
        for (let i = 0; i < n; i++) {
          // 3-band split (12 dB crossovers)
          st.xoLo[0].process(L[i], gLo, 1.414); st.xoLo[1].process(R[i], gLo, 1.414)
          const lowL = st.xoLo[0].lp, lowR = st.xoLo[1].lp
          const rem1L = st.xoLo[0].hp, rem1R = st.xoLo[1].hp
          st.xoHi[0].process(rem1L, gHi, 1.414); st.xoHi[1].process(rem1R, gHi, 1.414)
          const midL = st.xoHi[0].lp, midR = st.xoHi[1].lp
          const hiL = st.xoHi[0].hp, hiR = st.xoHi[1].hp
          let outL2 = 0, outR2 = 0
          const bandsL = [lowL, midL, hiL], bandsR = [lowR, midR, hiR]
          for (let b = 0; b < 3; b++) {
            const bl = bandsL[b], br = bandsR[b]
            const bs = st.bands[b]
            const db = 20 * Math.log10(Math.max(Math.abs(bl), Math.abs(br)) + 1e-9)
            const over = db - th
            const tg = over > 0 ? -over * (1 - 1 / ratio) : upTarget(db)
            bs.envG = tg < bs.envG ? atk * bs.envG + (1 - atk) * tg : rel * bs.envG + (1 - rel) * tg
            const g = dbToLin(bs.envG)
            outL2 += bl * g; outR2 += br * g
          }
          L[i] = lerp(L[i], outL2 * makeup, mix); R[i] = lerp(R[i], outR2 * makeup, mix)
        }
        engine.fxGr[unit.id] = [st.bands[0].envG, st.bands[1].envG, st.bands[2].envG]
      }
      return
    }
    case 'noisegate': {
      // downward expander with hold: detector env vs threshold; below it the
      // gain glides to the reduction floor (never a hard mute click)
      const th = P('threshold', -40)
      const atkC = Math.exp(-1 / (Math.max(0.1, P('attack', 10)) * 0.001 * sr))
      const relC = Math.exp(-1 / (Math.max(1, P('release', 200)) * 0.001 * sr))
      const holdSamps = Math.max(0, P('hold', 50)) * 0.001 * sr
      const floorLin = dbToLin(-Math.abs(P('reduction', 60)))
      const detC = Math.exp(-1 / (0.002 * sr))
      for (let i = 0; i < n; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]))
        st.env = a > st.env ? a : st.env * detC + a * (1 - detC)
        const open = 20 * Math.log10(st.env + 1e-9) > th
        if (open) { st.holdN = holdSamps }
        else if (st.holdN > 0) st.holdN--
        const target = open || st.holdN > 0 ? 1 : floorLin
        st.g = target > st.g ? atkC * st.g + (1 - atkC) * target : relC * st.g + (1 - relC) * target
        L[i] = lerp(L[i], L[i] * st.g, mix); R[i] = lerp(R[i], R[i] * st.g, mix)
      }
      engine.fxGr[unit.id] = [20 * Math.log10(st.g + 1e-9)]
      return
    }
    case 'deesser': {
      // dynamic sibilance cut: detect a band, reduce ONLY that band when hot
      const f = cutoffHz(clamp(P('freq', 0.82), 0, 1))
      const q = clamp(2 / Math.max(0.3, P('bandwidth', 1)), 0.5, 8)
      const th = P('threshold', -20)
      const maxRed = Math.abs(P('reduction', 12))
      const g = svfG(f, sr), k = 1 / q
      const atk = Math.exp(-1 / (0.002 * sr)), rel = Math.exp(-1 / (0.05 * sr))
      for (let i = 0; i < n; i++) {
        st.bpL.process(L[i], g, k); st.bpR.process(R[i], g, k)
        // SVF bp peaks at ~q gain with k=1/q — scale by k for unity at center
        const bl = st.bpL.bp * k * q, br = st.bpR.bp * k * q
        const db = 20 * Math.log10(Math.max(Math.abs(bl), Math.abs(br)) + 1e-9)
        const over = db - th
        const tg = over > 0 ? -Math.min(maxRed, over) : 0
        st.envG = tg < st.envG ? atk * st.envG + (1 - atk) * tg : rel * st.envG + (1 - rel) * tg
        const cut = 1 - dbToLin(st.envG)
        L[i] = lerp(L[i], L[i] - bl * cut, mix); R[i] = lerp(R[i], R[i] - br * cut, mix)
      }
      engine.fxGr[unit.id] = [st.envG]
      return
    }
    case 'transientshaper': {
      // fast-vs-slow envelope split: transients get the Attack gain, the body
      // gets the Sustain gain
      const atkDb = clamp(P('attack', 0), -12, 12)
      const susDb = clamp(P('sustain', 0), -12, 12)
      const outG = dbToLin(clamp(P('gain', 0), -6, 6))
      const fC = Math.exp(-1 / (0.001 * sr)), fR = Math.exp(-1 / (0.05 * sr))
      const sC = Math.exp(-1 / (0.04 * sr)), sR = Math.exp(-1 / (0.3 * sr))
      for (let i = 0; i < n; i++) {
        const a = Math.max(Math.abs(L[i]), Math.abs(R[i]))
        st.envF = a > st.envF ? fC * st.envF + (1 - fC) * a : fR * st.envF + (1 - fR) * a
        st.envS = a > st.envS ? sC * st.envS + (1 - sC) * a : sR * st.envS + (1 - sR) * a
        const t = clamp((st.envF - st.envS) / (st.envS + 1e-4), 0, 1)
        const gDb = atkDb * t + susDb * (1 - t)
        const g = dbToLin(gDb) * outG
        L[i] = lerp(L[i], L[i] * g, mix); R[i] = lerp(R[i], R[i] * g, mix)
      }
      return
    }
    case 'dyneq': {
      // one peak band whose gain follows the band's own level past threshold
      const f = cutoffHz(clamp(P('freq', 0.5), 0, 1))
      const q = clamp(P('q', 2), 0.3, 12)
      const th = P('threshold', -30)
      const range = clamp(P('range', -6), -18, 18)
      const atk = Math.exp(-1 / (Math.max(1, P('attack', 10)) * 0.001 * sr))
      const rel = Math.exp(-1 / (Math.max(5, P('release', 150)) * 0.001 * sr))
      const g = svfG(f, sr), k = 1 / q
      for (let i = 0; i < n; i++) {
        st.det.process((L[i] + R[i]) * 0.5, g, k)
        const db = 20 * Math.log10(Math.abs(st.det.bp * q) + 1e-9)
        st.envDb = db > st.envDb ? atk * st.envDb + (1 - atk) * db : rel * st.envDb + (1 - rel) * db
        // recompute the peak filter only when the applied gain moved >0.4 dB
        const over = clamp((st.envDb - th) / 12, 0, 1)
        const gain = range * over
        if (Math.abs(gain - st.lastG) > 0.4) {
          st.lastG = gain
          st.bqL.peak(f, q, gain, sr); st.bqR.peak(f, q, gain, sr)
        }
        L[i] = lerp(L[i], st.bqL.process(L[i]), mix)
        R[i] = lerp(R[i], st.bqR.process(R[i]), mix)
      }
      engine.fxGr[unit.id] = [st.lastG]
      return
    }
    case 'autopan': {
      // LFO pan (stereoPhase 180 = classic autopan) or tremolo (phase 0)
      const rate = clamp(P('rate', 1), 0.01, 20)
      const depth = clamp(P('depth', 0.5), 0, 1)
      const wave = Math.round(P('wave', 0))
      const phOff = (P('phase', 180) / 360)
      const shape = (ph) => {
        const x = ph - Math.floor(ph)
        if (wave === 1) return 1 - 4 * Math.abs(x - 0.5)      // triangle
        if (wave === 2) return x < 0.5 ? 1 : -1               // square
        return Math.sin(x * TWO_PI)                            // sine
      }
      for (let i = 0; i < n; i++) {
        st.phase += rate / sr
        const gL = 1 - depth * (0.5 + 0.5 * shape(st.phase))
        const gR = 1 - depth * (0.5 + 0.5 * shape(st.phase + phOff))
        L[i] = lerp(L[i], L[i] * gL, mix); R[i] = lerp(R[i], R[i] * gR, mix)
      }
      return
    }
    case 'reverb': {
      const mode = Math.round(P('mode', 0))
      const size = clamp(P('size', 0.5), 0, 1)
      const decay = clamp(P('decay', 0.5), 0, 1)
      const dampN = clamp(P('damp', 0.4), 0, 1)
      const preMs = P('predelay', 10)
      const width = clamp(P('width', 1), 0, 1)
      const lowcut = clamp(P('lowcut', 0.1), 0, 1)
      const t = st.tank
      // mode flavors: 0 hall, 1 plate, 2 vintage(dark, modulated), 3 nitrous(bright, tight), 4 basin(long, hollow)
      let fbBase = 0.55 + decay * 0.44
      let dampF = cutoffHz(1 - dampN * 0.85)
      let diff = 0.7, modAmt = 6, szMul = 0.4 + size * 0.6
      if (mode === 1) { diff = 0.62; modAmt = 2; szMul *= 0.7 }
      if (mode === 2) { dampF *= 0.4; modAmt = 18; fbBase *= 0.98 }
      if (mode === 3) { dampF = Math.min(dampF * 2.2, sr * 0.45); szMul *= 0.5; diff = 0.75 }
      if (mode === 4) { fbBase = Math.min(0.995, fbBase * 1.02); szMul *= 1.2; diff = 0.5; dampF *= 0.7 }
      const dampC = onePoleCoeff(dampF, sr)
      const hpc = onePoleCoeff(cutoffHz(lowcut * 0.5), sr)
      const pre = clamp(preMs * sr / 1000, 1, sr * 0.24)
      for (let i = 0; i < n; i++) {
        st.modPhase += 0.9 / sr
        if (st.modPhase >= 1) st.modPhase -= 1
        const mod = Math.sin(TWO_PI * st.modPhase) * modAmt
        const inp = (L[i] + R[i]) * 0.5
        st.preDl.write(inp)
        let x = st.preDl.read(pre)
        x = st.inLp.lp(x, dampC)
        x = st.inAp[0].process(x, 142 * szMul + 2, diff)
        x = st.inAp[1].process(x, 107 * szMul + 2, diff)
        x = st.inAp[2].process(x, 379 * szMul + 2, diff * 0.9)
        x = st.inAp[3].process(x, 277 * szMul + 2, diff * 0.9)
        // figure-8 tank
        let a = x + t.f2 * fbBase
        a = t.ap1.process(a, (672 + mod) * szMul + 2, 0.7)
        t.dl1.write(a)
        let a2 = t.dl1.read(4453 * szMul)
        a2 = t.lp1.lp(a2, dampC) * fbBase
        a2 = t.ap2.process(a2, 1800 * szMul + 2, 0.5)
        t.dl2.write(a2)
        t.f1 = t.dl2.read(3720 * szMul)
        let b = x + t.f1 * fbBase
        b = t.ap3.process(b, (908 - mod) * szMul + 2, 0.7)
        t.dl3.write(b)
        let b2 = t.dl3.read(4217 * szMul)
        b2 = t.lp2.lp(b2, dampC) * fbBase
        b2 = t.ap4.process(b2, 2656 * szMul + 2, 0.5)
        t.dl4.write(b2)
        t.f2 = t.dl4.read(3163 * szMul)
        let wl = t.dl1.read(266 * szMul) + t.dl3.read(1990 * szMul) - t.dl4.read(1066 * szMul)
        let wr = t.dl3.read(353 * szMul) + t.dl1.read(2111 * szMul) - t.dl2.read(1223 * szMul)
        wl = wl - st.hpL.lp(wl, hpc)
        wr = wr - st.hpR.lp(wr, hpc)
        const mid = (wl + wr) * 0.5, side = (wl - wr) * 0.5 * width
        wl = mid + side; wr = mid - side
        L[i] = (1 - mix) * L[i] + wl * mix * 1.5
        R[i] = (1 - mix) * R[i] + wr * mix * 1.5
      }
      return
    }
    case 'convolve': {
      const irIdx = Math.round(P('ir', 0))
      const size = clamp(P('size', 0.7), 0.1, 1)
      const key = irIdx + ':' + size.toFixed(2)
      if (st.irKey !== key) { st.conv = engine.makeConvolver(irIdx, size); st.irKey = key }
      if (!st.conv) return
      const preMs = P('predelay', 0)
      const damp = clamp(P('damp', 0.3), 0, 1)
      const width = clamp(P('width', 1), 0, 1)
      st.conv.process(engine, L, R, n, mix, preMs, damp, width)
      return
    }
    case 'eq': {
      const b1t = Math.round(P('t1', 1)), b2t = Math.round(P('t2', 1))
      const f1 = cutoffHz(clamp(P('f1', 0.2), 0, 1)), f2 = cutoffHz(clamp(P('f2', 0.75), 0, 1))
      const g1 = P('g1', 0), g2 = P('g2', 0), q1 = P('q1', 0.8), q2 = P('q2', 0.8)
      if (st.eqKey !== `${b1t}${b2t}${f1}${f2}${g1}${g2}${q1}${q2}`) {
        st.eqKey = `${b1t}${b2t}${f1}${f2}${g1}${g2}${q1}${q2}`
        if (b1t === 0) { st.bq[0].shelf(f1, g1, false, sr); st.bq[1].shelf(f1, g1, false, sr) }
        else if (b1t === 2) { st.bq[0].shelf(f1, g1, true, sr); st.bq[1].shelf(f1, g1, true, sr) }
        else { st.bq[0].peak(f1, q1, g1, sr); st.bq[1].peak(f1, q1, g1, sr) }
        if (b2t === 0) { st.bq[2].shelf(f2, g2, false, sr); st.bq[3].shelf(f2, g2, false, sr) }
        else if (b2t === 2) { st.bq[2].shelf(f2, g2, true, sr); st.bq[3].shelf(f2, g2, true, sr) }
        else { st.bq[2].peak(f2, q2, g2, sr); st.bq[3].peak(f2, q2, g2, sr) }
      }
      for (let i = 0; i < n; i++) {
        L[i] = st.bq[2].process(st.bq[0].process(L[i]))
        R[i] = st.bq[3].process(st.bq[1].process(R[i]))
      }
      return
    }
    case 'filter': {
      const types = engine.FILTER_TYPE_IDS
      const type = types[Math.round(clamp(P('type', 1), 0, types.length - 1))]
      const cut = clamp(P('cutoff', 0.7), 0, 1)
      const res = clamp(P('res', 0.2), 0, 1)
      const drive = clamp(P('drive', 0), 0, 1)
      const fat = clamp(P('fat', 0.5), 0, 1)
      const fpan = clamp(P('pan', 0), -1, 1)
      for (let i = 0; i < n; i++) {
        const yl = st.vfL.process(L[i], type, clamp(cut - fpan * 0.1, 0, 1), res, drive, fat)
        const yr = st.vfR.process(R[i], type, clamp(cut + fpan * 0.1, 0, 1), res, drive, fat)
        L[i] = lerp(L[i], yl, mix); R[i] = lerp(R[i], yr, mix)
      }
      return
    }
    case 'hyper': {
      const rate = P('rate', 0.6), detune = clamp(P('detune', 0.35), 0, 1)
      const unison = Math.round(clamp(P('unison', 4), 1, 7))
      if (P('retrig', 0) > 0.5 && engine.hyperRetrigFlag) { st.phase = 0; engine.hyperRetrigFlag = false }
      const dimSize = clamp(P('dimSize', 0.4), 0, 1), dimMix = clamp(P('dimMix', 0.3), 0, 1)
      for (let i = 0; i < n; i++) {
        st.phase += rate / sr
        if (st.phase >= 1) st.phase -= 1
        let wl = 0, wr = 0
        for (let v = 0; v < unison; v++) {
          const ph = st.phase + v * 0.618
          const lfo = Math.sin(TWO_PI * (ph - Math.floor(ph)))
          const d = (2 + v * 2.7 + lfo * detune * 8) * sr / 1000
          const w = st.taps[v].read(Math.max(2, d))
          if (v % 2) wr += w; else wl += w
          st.taps[v].write(v % 2 ? R[i] : L[i])
        }
        const hl = (L[i] + wl * 0.8), hr = (R[i] + wr * 0.8)
        // dimension expander
        const dd = (5 + dimSize * 40) * sr / 1000
        const dl = st.dimL.read(dd), dr = st.dimR.read(dd * 1.02)
        st.dimL.write(hl - dr * 0.5)
        st.dimR.write(hr - dl * 0.5)
        L[i] = lerp(L[i], hl * (1 - dimMix) + (hl + dl - dr) * dimMix * 0.7, mix)
        R[i] = lerp(R[i], hr * (1 - dimMix) + (hr + dr - dl) * dimMix * 0.7, mix)
      }
      return
    }
    case 'utility': {
      const g = dbToLin(P('gain', 0))
      const pan = clamp(P('pan', 0), -1, 1)
      const width = clamp(P('width', 1), 0, 2)
      const gl = g * Math.cos((pan + 1) * Math.PI / 4) * 1.414
      const gr = g * Math.sin((pan + 1) * Math.PI / 4) * 1.414
      for (let i = 0; i < n; i++) {
        const mid = (L[i] + R[i]) * 0.5, side = (L[i] - R[i]) * 0.5 * width
        L[i] = (mid + side) * gl
        R[i] = (mid - side) * gr
      }
      return
    }
    case 'octaver': {
      const sub = clamp(P('sub', 0.5), 0, 1), up = clamp(P('up', 0), 0, 1), dry = clamp(P('dry', 1), 0, 1)
      const N = st.obuf.length
      for (let i = 0; i < n; i++) {
        const x = (L[i] + R[i]) * 0.5
        st.obuf[st.opos] = x
        st.opos = (st.opos + 1) % N
        // half-speed read (octave down) with crossfaded dual taps
        st.oread += 0.5
        if (st.oread >= N) st.oread -= N
        const ri = st.oread | 0
        const w1 = st.obuf[ri % N]
        const win = 0.5 - 0.5 * Math.cos(TWO_PI * ((st.oread * 2) % N) / N)
        const ri2 = (ri + (N >> 1)) % N
        const w2 = st.obuf[ri2]
        const down = w1 * win + w2 * (1 - win)
        // double-speed read (octave up)
        st.oread2 += 2
        if (st.oread2 >= N) st.oread2 -= N
        const upS = st.obuf[(st.oread2 | 0) % N]
        const wet = down * sub + upS * up
        L[i] = lerp(L[i], L[i] * dry + wet, mix)
        R[i] = lerp(R[i], R[i] * dry + wet, mix)
      }
      return
    }
    case 'bitcrush': {
      const bits = clamp(P('bits', 8), 1, 16)
      const ds = clamp(P('downsample', 1), 1, 64)
      const q = Math.pow(2, bits - 1)
      for (let i = 0; i < n; i++) {
        st.ph += 1
        if (st.ph >= ds) { st.ph -= ds; st.hL = Math.round(L[i] * q) / q; st.hR = Math.round(R[i] * q) / q }
        L[i] = lerp(L[i], st.hL, mix); R[i] = lerp(R[i], st.hR, mix)
      }
      return
    }
  }
}

// ---------- partitioned convolution ----------
const CONV_B = 1024        // hop / partition size
const CONV_FFT = 2048
class PartConv {
  constructor(sr, irL, irR) {
    this.sr = sr
    const K = Math.max(1, Math.ceil(irL.length / CONV_B))
    this.K = K
    this.HL = []; this.HR = []
    const re = new Float32Array(CONV_FFT), im = new Float32Array(CONV_FFT)
    for (let k = 0; k < K; k++) {
      for (const [H, ir] of [[this.HL, irL], [this.HR, irR]]) {
        re.fill(0); im.fill(0)
        for (let i = 0; i < CONV_B; i++) re[i] = ir[k * CONV_B + i] || 0
        fftInPlace(re, im, false)
        H.push([new Float32Array(re), new Float32Array(im)])
      }
    }
    this.X = [] // ring of input spectra
    for (let k = 0; k < K; k++) this.X.push([new Float32Array(CONV_FFT), new Float32Array(CONV_FFT)])
    this.xPos = 0
    this.inBuf = new Float32Array(CONV_B)
    this.prevBuf = new Float32Array(CONV_B)
    this.inFill = 0
    this.outL = new Float32Array(CONV_B)
    this.outR = new Float32Array(CONV_B)
    this.outPos = CONV_B // empty
    this.accRe = new Float32Array(CONV_FFT); this.accIm = new Float32Array(CONV_FFT)
    this.accRe2 = new Float32Array(CONV_FFT); this.accIm2 = new Float32Array(CONV_FFT)
    this.preDl = new DelayLine(sr * 0.25)
    this.dampL = new OnePole(); this.dampR = new OnePole()
  }
  process(engine, L, R, n, mix, preMs, damp, width) {
    const pre = clamp(preMs * this.sr / 1000, 0, this.sr * 0.24)
    const dampC = onePoleCoeff(cutoffHz(1 - damp * 0.8), this.sr)
    for (let i = 0; i < n; i++) {
      const mono = (L[i] + R[i]) * 0.5
      this.preDl.write(mono)
      this.inBuf[this.inFill++] = pre > 1 ? this.preDl.read(pre) : mono
      if (this.inFill >= CONV_B) {
        this.inFill = 0
        this.convolveBlock()
      }
      let wl = this.outPos < CONV_B ? this.outL[this.outPos] : 0
      let wr = this.outPos < CONV_B ? this.outR[this.outPos] : 0
      this.outPos++
      wl = this.dampL.lp(wl, dampC); wr = this.dampR.lp(wr, dampC)
      const mid = (wl + wr) * 0.5, side = (wl - wr) * 0.5 * width
      wl = mid + side; wr = mid - side
      L[i] = (1 - mix) * L[i] + wl * mix
      R[i] = (1 - mix) * R[i] + wr * mix
    }
  }
  convolveBlock() {
    // overlap-save: FFT [prev | current]
    const re = this.accRe2, im = this.accIm2
    re.fill(0); im.fill(0)
    for (let i = 0; i < CONV_B; i++) { re[i] = this.prevBuf[i]; re[CONV_B + i] = this.inBuf[i] }
    this.prevBuf.set(this.inBuf)
    fftInPlace(re, im, false)
    this.xPos = (this.xPos + 1) % this.K
    this.X[this.xPos][0].set(re)
    this.X[this.xPos][1].set(im)
    const aRe = this.accRe, aIm = this.accIm
    aRe.fill(0); aIm.fill(0)
    const a2Re = this.accRe2, a2Im = this.accIm2 // reuse for R after copying X
    // accumulate L
    for (let k = 0; k < this.K; k++) {
      const xi = (this.xPos - k + this.K) % this.K
      const [xr, xim] = this.X[xi]
      const [hLr, hLi] = this.HL[k]
      for (let b = 0; b < CONV_FFT; b++) {
        aRe[b] += xr[b] * hLr[b] - xim[b] * hLi[b]
        aIm[b] += xr[b] * hLi[b] + xim[b] * hLr[b]
      }
    }
    fftInPlace(aRe, aIm, true)
    for (let i = 0; i < CONV_B; i++) this.outL[i] = aRe[CONV_B + i]
    // accumulate R
    a2Re.fill(0); a2Im.fill(0)
    for (let k = 0; k < this.K; k++) {
      const xi = (this.xPos - k + this.K) % this.K
      const [xr, xim] = this.X[xi]
      const [hRr, hRi] = this.HR[k]
      for (let b = 0; b < CONV_FFT; b++) {
        a2Re[b] += xr[b] * hRr[b] - xim[b] * hRi[b]
        a2Im[b] += xr[b] * hRi[b] + xim[b] * hRr[b]
      }
    }
    fftInPlace(a2Re, a2Im, true)
    for (let i = 0; i < CONV_B; i++) this.outR[i] = a2Re[CONV_B + i]
    this.outPos = 0
  }
}

const IR_NAMES = ['Room', 'Hall', 'Cathedral', 'Plate', 'Spring', 'Chamber', 'Reverse', 'Gated']
function generateIR(sr, idx, size) {
  const durs = [0.4, 1.6, 2.6, 1.1, 0.9, 0.8, 1.2, 0.5, 0.09, 2.4, 1.6]
  const dur = durs[idx % durs.length] * (0.35 + size * 0.85)
  const len = Math.min(Math.floor(sr * dur), sr * 3)
  const irL = new Float32Array(len), irR = new Float32Array(len)
  const rngL = makeRng(1234 + idx), rngR = makeRng(9876 + idx)
  // Non-reverb IR models (Serum 2's Convolve ships cabinets/metallic IRs, not
  // just rooms): built from resonant modes instead of enveloped noise.
  if (idx === 8) {
    // guitar cabinet: tight noise burst + speaker-body modes, dark rolloff
    const modes = [96, 210, 420, 760, 1350, 2400]
    for (let i = 0; i < len; i++) {
      const t = i / sr
      let v = (rngL() * 2 - 1) * Math.exp(-t * 260)
      for (let m = 0; m < modes.length; m++) v += Math.sin(TWO_PI * modes[m] * t) * Math.exp(-t * (34 + m * 26)) * (0.5 - m * 0.06)
      irL[i] = v; irR[i] = v * 0.985 + (rngR() * 2 - 1) * Math.exp(-t * 300) * 0.1
    }
  } else if (idx === 9) {
    // chimes: sparse inharmonic metallic partials, long shimmer
    const f0 = 480 * (0.6 + size * 0.9)
    const ratios = [1, 2.76, 5.4, 8.93, 13.3, 18.6]
    for (let i = 0; i < len; i++) {
      const t = i / sr
      let vl = 0, vr = 0
      for (let m = 0; m < ratios.length; m++) {
        const a = Math.exp(-t * (1.6 + m * 1.1)) * (0.6 - m * 0.08)
        vl += Math.sin(TWO_PI * f0 * ratios[m] * t) * a
        vr += Math.sin(TWO_PI * f0 * ratios[m] * 1.004 * t + m) * a
      }
      irL[i] = vl + (rngL() * 2 - 1) * Math.exp(-t * 40) * 0.05
      irR[i] = vr + (rngR() * 2 - 1) * Math.exp(-t * 40) * 0.05
    }
  } else if (idx === 10) {
    // metal tank: dense noise + clangy ringing modes with flutter
    const modes = [311, 522, 941, 1570, 2210]
    for (let i = 0; i < len; i++) {
      const t = i / sr
      let v = (rngL() * 2 - 1) * Math.exp(-t * 2.6) * 0.5
      for (let m = 0; m < modes.length; m++) v += Math.sin(TWO_PI * modes[m] * (1 + 0.002 * Math.sin(t * 7 + m)) * t) * Math.exp(-t * (2.2 + m * 0.8)) * 0.28
      irL[i] = v; irR[i] = v * 0.7 + (rngR() * 2 - 1) * Math.exp(-t * 2.6) * 0.25
    }
  }
  if (idx >= 8) {
    let e = 0
    for (let i = 0; i < len; i++) e += irL[i] * irL[i]
    const g = 1 / Math.sqrt(Math.max(e, 1e-9))
    for (let i = 0; i < len; i++) { irL[i] *= g * 3; irR[i] *= g * 3 }
    return [irL, irR]
  }
  for (let i = 0; i < len; i++) {
    const t = i / len
    let env
    switch (idx) {
      case 6: env = Math.pow(t, 2.5); break // reverse
      case 7: env = t < 0.7 ? Math.pow(1 - t / 0.7, 0.5) : 0; break // gated
      case 3: env = Math.exp(-t * 5.5) * (1 + 0.3 * Math.sin(t * 90)); break // plate shimmer
      case 4: env = Math.exp(-t * 6) * (0.7 + 0.5 * Math.sin(t * t * 4000 + t * 60)); break // spring chirp
      case 2: env = Math.exp(-t * 3.2); break // cathedral
      default: env = Math.exp(-t * (idx === 0 ? 9 : 4.5))
    }
    irL[i] = (rngL() * 2 - 1) * env
    irR[i] = (rngR() * 2 - 1) * env
  }
  // darken tail: simple progressive lowpass
  let zl = 0, zr = 0
  for (let i = 0; i < len; i++) {
    const c = 1 - (i / len) * 0.85
    zl += c * (irL[i] - zl); irL[i] = zl
    zr += c * (irR[i] - zr); irR[i] = zr
  }
  // normalize energy
  let e = 0
  for (let i = 0; i < len; i++) e += irL[i] * irL[i]
  const g = 1 / Math.sqrt(Math.max(e, 1e-9))
  for (let i = 0; i < len; i++) { irL[i] *= g * 3; irR[i] *= g * 3 }
  return [irL, irR]
}

// ---------- main processor ----------
const PER_VOICE_DEST_RE = /^(osc[012]|f[12]|sub|noise)\./

function polyBlep(t, dt) {
  if (dt <= 0) return 0
  if (t < dt) { const x = t / dt; return x + x - x * x - 1 }
  if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1 }
  return 0
}

class ApolloProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.sr = sampleRate
    this.patch = null
    this.ranges = {}
    this.tables = new Map()
    this.samples = new Map()
    this.spectral = new Map()
    this.lfoLuts = Array.from({ length: 10 }, () => null)
    this.lfoLutsY = Array.from({ length: 10 }, () => null)
    this.remapLuts = new Map()
    this.rowLuts = new Map()
    this.defaultTable = null
    this.voices = Array.from({ length: 32 }, () => new Voice(this.sr))
    this.fxGr = {}
    this.heldNotes = []
    this.sustainPedal = false
    this.macros = new Float32Array(8)
    this.modwheel = 0; this.pitchbend = 0; this.aftertouch = 0
    this.chanBend = new Float32Array(16)     // MPE per-channel bend (semitones)
    this.chanPressure = new Float32Array(16) // MPE per-channel pressure
    this.pitchBendSemis = 0
    this.lastFreq = 0
    this.bpm = 120
    this.playing = false
    this.beat = 0
    this.clickOn = false
    this.arpNotesDown = []          // notes the arp is currently sounding
    this.arpStep = 0
    this.arpNextBeat = 0
    this.clipNotesOn = []           // {note, endBeat}
    this.oscMono = [new Float32Array(BLOCK), new Float32Array(BLOCK), new Float32Array(BLOCK)]
    this.srcL = new Float32Array(BLOCK); this.srcR = new Float32Array(BLOCK)
    this.f1inL = new Float32Array(BLOCK); this.f1inR = new Float32Array(BLOCK)
    this.f2inL = new Float32Array(BLOCK); this.f2inR = new Float32Array(BLOCK)
    this.byL = new Float32Array(BLOCK); this.byR = new Float32Array(BLOCK)
    this.out2L = new Float32Array(BLOCK); this.out2R = new Float32Array(BLOCK)
    this.byBus = {
      main: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
      bus1: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
      bus2: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
      direct: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
    }
    this.busses = {
      main: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
      bus1: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
      bus2: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
      direct: [new Float32Array(BLOCK), new Float32Array(BLOCK)],
    }
    this.tmpPool = Array.from({ length: 24 }, () => new Float32Array(BLOCK))
    this.tmpPoolIdx = 0
    this.fxStates = new Map()      // unitId -> FxState
    this.convCache = new Map()
    this.matrixRows = []
    this.destIndex = {}
    this.destCount = 0
    this.gmodRows = []
    this.gmodCache = {}
    this.chaosInst = Array.from({ length: 10 }, () => new Chaos('lorenz'))
    this.lfoFreePhase = new Float32Array(10)
    this.lfoGlobalOut = new Float32Array(10)
    this.lfoGlobalOutY = new Float32Array(10)
    this.grainViz = new Float32Array(3)
    this.specViz = new Float32Array(3)
    this.meterCounter = 0
    this.pv = {}                   // base param values (path -> value), synced from UI
    this.monoVoice = null
    this.SYNC_BEATS = [32, 16, 8, 4, 2, 4 / 3, 1.5, 1, 2 / 3, 0.75, 0.5, 1 / 3, 0.375, 0.25, 1 / 6, 0.125, 0.0625]
    this.FILTER_TYPE_IDS = ['lp6', 'lp12', 'lp18', 'lp24', 'hp6', 'hp12', 'hp24', 'bp12', 'bp24', 'notch12', 'peak12', 'multiLBH', 'multiLNH', 'morphSVF', 'ladder12', 'ladder24', 'germanLP', 'frenchLP', 'formant', 'combPlus', 'combMinus', 'flangePlus', 'flangeMinus', 'phasePlus', 'phaseMinus', 'ringMod', 'sampHold', 'downsample', 'reverbFilter', 'dj', 'diffuser', 'acidLadder', 'emsLadder', 'mgDirty', 'comb2', 'expBPF']
    this.port.onmessage = (e) => this.onMessage(e.data)
    // default table: saw
    const dt = new Float32Array(WT_LEN)
    for (let i = 0; i < WT_LEN; i++) dt[i] = 1 - 2 * (i / WT_LEN)
    this.defaultTable = { frames: 1, data: dt }
  }

  makeConvolver(idx, size) {
    const key = idx + ':' + size.toFixed(2)
    if (this.convCache.has(key)) return this.convCache.get(key)
    const [l, r] = generateIR(this.sr, idx, size)
    const c = new PartConv(this.sr, l, r)
    if (this.convCache.size > 4) this.convCache.clear()
    this.convCache.set(key, c)
    return c
  }

  onMessage(m) {
    // Same crash armor as process(): a throwing message handler (bad patch
    // shape, note event hitting a corrupt voice) must never take the engine
    // down — report, rebuild voices, keep running.
    try {
      this.onMessageInner(m)
    } catch (err) {
      try {
        this.procErrCount = (this.procErrCount || 0) + 1
        if (this.procErrCount <= 5) {
          this.port.postMessage({ type: 'procError', message: String((err && err.stack) || err), count: this.procErrCount })
        }
        this.voices = Array.from({ length: 32 }, () => new Voice(this.sr))
        this.monoVoice = null
      } catch (e2) { /* keep running regardless */ }
    }
  }

  onMessageInner(m) {
    switch (m.type) {
      case 'patch': {
        this.patch = m.patch
        this.bpm = m.patch.global.bpm
        this.pv = {} // patch is the new source of truth; drop knob-drag overrides
        // seed macro values from the patch — without this, saved macro states
        // are silent in offline renders, the DAW instrument, and the CLI
        // (live UI drags still land via the 'macro' message afterwards)
        if (Array.isArray(m.patch.macros)) {
          for (let i = 0; i < 8 && i < m.patch.macros.length; i++) this.macros[i] = m.patch.macros[i] || 0
        }
        this.compileMatrix()
        // quality switches change the internal rate — do it here, before notes
        const desired = sampleRate * (m.patch.global.quality === 'high' ? 2 : 1)
        if (this.sr !== desired) this.reconfigure(desired)
        // microtuning table (128 note frequencies) or null = 12-TET
        const tun = m.patch.global.tuning
        this.tuningFreqs = tun && tun.freqs && tun.freqs.length === 128 ? tun.freqs : null
        break
      }
      case 'pv': { // base param values map
        Object.assign(this.pv, m.values)
        break
      }
      case 'ranges': this.ranges = m.ranges; break
      case 'table': this.tables.set(m.id, { frames: m.frames, data: m.data, mips: m.mips || null }); break
      case 'dropTable': this.tables.delete(m.id); break
      case 'sample': this.samples.set(m.id, { sr: m.sr, len: m.len, l: m.l, r: m.r || null }); break
      case 'spectral': this.spectral.set(m.id, { frames: m.frames, bins: m.bins, hop: m.hop, sr: m.sr, mags: m.mags, phases: m.phases || null, onsets: m.onsets || null }); break
      case 'lfoLut': this.lfoLuts[m.index] = m.main; this.lfoLutsY[m.index] = m.y || null; break
      case 'remapLut':
        if (m.rowId) this.rowLuts.set(m.rowId, m.lut)
        else this.remapLuts.set(m.key, m.lut)
        break
      case 'noteOn': this.noteOn(m.note, m.vel, false, m.ch || 0); break
      case 'chanBend': this.chanBend[m.ch & 15] = m.semis; break
      case 'chanPressure': this.chanPressure[m.ch & 15] = m.value; break
      case 'noteOff': this.noteOff(m.note, false); break
      case 'allOff': this.allNotesOff(); break
      case 'sustain': this.sustainPedal = m.on; if (!m.on) this.releaseSustained(); break
      case 'macro': this.macros[m.index] = m.value; break
      case 'wheel': this.modwheel = m.mod != null ? m.mod : this.modwheel
        if (m.pitch != null) { this.pitchbend = m.pitch; this.pitchBendSemis = m.pitch * (this.patch ? this.patch.global.pbRange : 2) }
        break
      case 'aftertouch': this.aftertouch = m.value; break
      case 'transport': {
        if (m.playing != null && m.playing !== this.playing) {
          this.playing = m.playing
          if (m.playing) { this.beat = m.beat || 0; this.arpNextBeat = this.beat; this.arpStep = 0 }
          else { this.seqAllOff() }
        }
        if (m.bpm) this.bpm = m.bpm
        if (m.click != null) this.clickOn = m.click
        break
      }
      case 'fxMode':
        // FX-only host mode (Beacon track inserts): external audio is routed
        // through the fxMain lane; voices/sequencer stay dormant. Forced to
        // 1x internal rate so the worklet input needs no resampling.
        this.fxOnly = !!m.on
        // ack — offline hosts must KNOW the patch+mode landed before they
        // call startRendering (port delivery can lose that race silently)
        try { this.port.postMessage({ type: 'fxModeAck' }) } catch { /* ok */ }
        break
      case 'panic':
        this.allNotesOff(true)
        // a panic also clears every pitch offset that could linger — a stray
        // MPE channel bend (±48st!) or a stuck wheel otherwise transposes
        // every future note ("MIDI plays a few notes higher" bug)
        this.chanBend.fill(0)
        this.pitchbend = 0
        this.pitchBendSemis = 0
        break
      case 'schedule': // sample-accurate event list for offline rendering
        this.schedule = (m.events || []).slice().sort((a, b) => a.t - b.t)
        this.timeSec = 0
        break
      case 'scheduleAt': // events at absolute context time (DAW instrument mode)
        if (!this.absEvents) this.absEvents = []
        for (const ev of m.events || []) this.absEvents.push(ev)
        this.absEvents.sort((a, b) => a.t - b.t)
        break
      case 'clearScheduled':
        if (this.absEvents) this.absEvents.length = 0
        break
    }
  }

  runSchedule(blockSec) {
    if (!this.schedule || !this.schedule.length) return
    this.timeSec = (this.timeSec || 0)
    const end = this.timeSec + blockSec
    while (this.schedule.length && this.schedule[0].t < end) {
      const ev = this.schedule.shift()
      if (ev.type === 'noteOn') this.noteOn(ev.note, ev.vel != null ? ev.vel : 0.9, false)
      else if (ev.type === 'noteOff') this.noteOff(ev.note, false)
      else if (ev.type === 'macro') this.macros[ev.index] = ev.value
    }
    this.timeSec = end
  }

  compileMatrix() {
    const patch = this.patch
    this.matrixRows = []
    this.gmodRows = []
    this.destIndex = {}
    let idx = 0
    for (const row of patch.matrix) {
      if (row.bypass || row.source === 'none' || !row.dest) continue
      const range = this.ranges[row.dest]
      const compiled = {
        src: row.source, dest: row.dest, amt: row.amount, bipolar: row.bipolar,
        aux: row.aux, auxAmt: row.auxAmount, id: row.id,
        span: range ? range[1] - range[0] : 1,
        lo: range ? range[0] : 0, hi: range ? range[1] : 1,
      }
      if (PER_VOICE_DEST_RE.test(row.dest)) {
        if (this.destIndex[row.dest] == null) this.destIndex[row.dest] = idx++
        compiled.destIdx = this.destIndex[row.dest]
        this.matrixRows.push(compiled)
      } else {
        this.gmodRows.push(compiled)
      }
    }
    this.destCount = idx
  }

  destTouched(voice, path) { return this.destIndex[path] != null }

  noteFreq(note) {
    const n = clamp(Math.round(note), 0, 127)
    return this.tuningFreqs ? this.tuningFreqs[n] : midiFreq(note)
  }

  vp(voice, path, base) {
    const b = this.pv[path] != null ? this.pv[path] : base
    const idx = this.destIndex[path]
    if (idx == null) return b
    return b + voice.mod[idx]
  }

  gmodVal(path, base) {
    const b = this.pv[path] != null ? this.pv[path] : base
    const g = this.gmodCache[path]
    return g != null ? b + g : b
  }

  // source value for GLOBAL rows (voice-independent); returns 0..1 or -1..1
  globalSourceVal(src) {
    if (src[0] === 'm' && src.startsWith('macro')) return this.macros[+src.slice(5) - 1]
    switch (src) {
      case 'follower': return this.followEnv || 0
      case 'modwheel': return this.modwheel
      case 'pitchwheel': return this.pitchbend
      case 'aftertouch': return this.aftertouch
      case 'gate': return this.heldNotes.length ? 1 : 0
      case 'vel': case 'note': case 'rand': {
        const v = this.newestVoice()
        if (!v) return 0
        return src === 'vel' ? v.vel : src === 'note' ? v.note / 127 : v.rand
      }
    }
    if (src.startsWith('env')) {
      const v = this.newestVoice()
      return v ? v.envs[+src.slice(3) - 1].out : 0
    }
    if (src.startsWith('lfo')) {
      const y = src.endsWith('y')
      const i = +(y ? src.slice(3, -1) : src.slice(3)) - 1
      const cfg = this.patch.lfos[i]
      if (cfg.trigMode === 'off' || cfg.mode === 'chaos') return y ? this.lfoGlobalOutY[i] : this.lfoGlobalOut[i]
      const v = this.newestVoice()
      if (!v) return y ? this.lfoGlobalOutY[i] : this.lfoGlobalOut[i]
      return y ? v.lfoOutY[i] : v.lfoOut[i]
    }
    return 0
  }

  voiceSourceVal(voice, src) {
    if (src[0] === 'm' && src.startsWith('macro')) return this.macros[+src.slice(5) - 1]
    switch (src) {
      case 'follower': return this.followEnv || 0
      case 'vel': return voice.vel
      case 'note': return voice.note / 127
      case 'rand': return voice.rand
      case 'gate': return voice.gate ? 1 : 0
      case 'modwheel': return this.modwheel
      case 'pitchwheel': return this.pitchbend
      case 'aftertouch': return Math.max(this.aftertouch, this.chanPressure[voice.ch || 0])
    }
    if (src.startsWith('env')) return voice.envs[+src.slice(3) - 1].out
    if (src.startsWith('lfo')) {
      const y = src.endsWith('y')
      const i = +(y ? src.slice(3, -1) : src.slice(3)) - 1
      const cfg = this.patch.lfos[i]
      if (cfg.trigMode === 'off' || cfg.mode === 'chaos') return y ? this.lfoGlobalOutY[i] : this.lfoGlobalOut[i]
      return y ? voice.lfoOutY[i] : voice.lfoOut[i]
    }
    return 0
  }

  applyRowShaping(row, v) {
    // v arrives 0..1 (or -1..1 for inherently bipolar sources)
    if (row.bipolar) { if (v >= 0 && v <= 1) v = v * 2 - 1 }
    const lut = this.rowLuts.get(row.id)
    if (lut) {
      const t = clamp((v + 1) / 2, 0, 1)
      v = lutEval(lut, row.bipolar ? t : clamp(v, 0, 1)) * (row.bipolar ? 2 : 1) - (row.bipolar ? 1 : 0)
    }
    return v
  }

  newestVoice() {
    let best = null
    for (const v of this.voices) if (v.active && (!best || v.serial > best.serial)) best = v
    return best
  }

  noteOn(note, vel, fromSeq, ch) {
    if (!this.patch) return
    ch = ch || 0
    this.hyperRetrigFlag = true
    const patch = this.patch
    if (patch.arp.on && !fromSeq) {
      if (!this.heldNotes.includes(note)) this.heldNotes.push(note)
      return
    }
    if (!fromSeq && !this.heldNotes.includes(note)) this.heldNotes.push(note)
    // Scale lock changes the SOUNDING pitch, but the voice must stay findable
    // by the PLAYED key — otherwise noteOff(playedKey) never matches and the
    // voice leaks (stuck gated forever, silently eating polyphony).
    const srcNote = note
    if (patch.global.scaleLock) note = this.snapScale(note)
    const mode = patch.global.mode
    if (mode !== 'poly') {
      let v = this.monoVoice && this.monoVoice.active ? this.monoVoice : null
      const legato = !!v && mode === 'legato'
      if (!v) v = this.allocVoice()
      v.start(note, vel, patch, this, legato, fromSeq)
      v.ch = ch
      v.srcNote = srcNote
      this.monoVoice = v
      this.port.postMessage({ type: 'voiceOn', note, fromSeq: !!fromSeq })
      return
    }
    const v = this.allocVoice()
    v.start(note, vel, patch, this, false, fromSeq)
    v.ch = ch
    v.srcNote = srcNote
    this.port.postMessage({ type: 'voiceOn', note, fromSeq: !!fromSeq })
  }

  noteOff(note, fromSeq) {
    if (!this.patch) return
    // only real (user) note-offs release held notes — a sequencer/arp note-off
    // for the same pitch must not steal the player's held note
    if (!fromSeq) {
      const hi = this.heldNotes.indexOf(note)
      if (hi >= 0) this.heldNotes.splice(hi, 1)
    }
    if (this.patch.arp.on && !fromSeq) {
      if (!this.patch.arp.hold && !this.heldNotes.length) this.stopArpNotes()
      return
    }
    if (this.sustainPedal && !fromSeq) return
    for (const v of this.voices) {
      // match on the PLAYED key (srcNote) — with scale lock on, v.note is the
      // snapped pitch and would never equal the released key
      const key = v.srcNote != null ? v.srcNote : v.note
      if (v.active && v.gate && (key === note || v.note === note) && v.fromSeq === !!fromSeq) v.release()
    }
    if (this.patch.global.mode !== 'poly' && this.heldNotes.length && !fromSeq) {
      // return to previous held note (legato back-step) — snapped like noteOn
      const prev = this.heldNotes[this.heldNotes.length - 1]
      const prevSnapped = this.patch.global.scaleLock ? this.snapScale(prev) : prev
      if (this.monoVoice && this.monoVoice.active) {
        this.monoVoice.start(prevSnapped, this.monoVoice.vel, this.patch, this, true, false)
        this.monoVoice.srcNote = prev
      }
    }
    this.port.postMessage({ type: 'voiceOff', note, fromSeq: !!fromSeq })
  }

  releaseSustained() {
    for (const v of this.voices) {
      const key = v.srcNote != null ? v.srcNote : v.note
      if (v.active && v.gate && !this.heldNotes.includes(key)) v.release()
    }
  }

  allocVoice() {
    const poly = this.patch ? this.patch.global.poly : 16
    let free = null
    for (const v of this.voices) if (!v.active) { free = v; break }
    if (free) {
      let count = 0
      for (const v of this.voices) if (v.active) count++
      if (count < poly) return free
    }
    // steal: released first, then oldest
    let steal = null
    for (const v of this.voices) {
      if (!v.active) continue
      if (!steal) { steal = v; continue }
      const vRel = !v.gate, sRel = !steal.gate
      if (vRel && !sRel) steal = v
      else if (vRel === sRel && v.serial < steal.serial) steal = v
    }
    if (steal) { steal.kill(); return steal }
    return this.voices[0]
  }

  allNotesOff(hard) {
    this.heldNotes.length = 0
    this.stopArpNotes()
    for (const v of this.voices) { if (v.active) { if (hard) v.kill(); else v.release() } }
  }

  seqAllOff() {
    for (const no of this.clipNotesOn) this.noteOff(no.note, true)
    this.clipNotesOn.length = 0
    this.stopArpNotes()
  }

  stopArpNotes() {
    for (const n of this.arpNotesDown) this.noteOff(n, true)
    this.arpNotesDown.length = 0
  }

  snapScale(note) {
    const patch = this.patch
    const SC = { Major: [0, 2, 4, 5, 7, 9, 11], Minor: [0, 2, 3, 5, 7, 8, 10], Dorian: [0, 2, 3, 5, 7, 9, 10], Phrygian: [0, 1, 3, 5, 7, 8, 10], Lydian: [0, 2, 4, 6, 7, 9, 11], Mixolydian: [0, 2, 4, 5, 7, 9, 10], 'Harmonic Minor': [0, 2, 3, 5, 7, 8, 11], 'Melodic Minor': [0, 2, 3, 5, 7, 9, 11], 'Pentatonic Maj': [0, 2, 4, 7, 9], 'Pentatonic Min': [0, 3, 5, 7, 10], Blues: [0, 3, 5, 6, 7, 10], Chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] }
    const iv = SC[patch.global.scaleName] || SC.Minor
    const root = patch.global.scaleRoot
    const rel = ((note - root) % 12 + 12) % 12
    // nearest scale tone with signed octave wrap: a note just under the root
    // must snap UP 1 semitone to the next root, not 11 semitones DOWN (the
    // old `note - rel + best` had no wrap and did exactly that)
    let delta = 0, bd = 99
    for (const s of iv) {
      let d = s - rel
      if (d > 6) d -= 12
      if (d < -6) d += 12
      if (Math.abs(d) < bd) { bd = Math.abs(d); delta = d }
    }
    return note + delta
  }

  // ------- sequencer -------
  arpPool() {
    const patch = this.patch
    const held = this.heldNotes.slice()
    if (!held.length) return held
    const base = patch.arp.mode === 'asplayed' ? held : held.slice().sort((a, b) => a - b)
    const pool = []
    for (let o = 0; o < patch.arp.octaves; o++) for (const nn of base) pool.push(nn + o * 12)
    switch (patch.arp.mode) {
      case 'down': pool.reverse(); break
      case 'updown': { const rev = pool.slice(1, -1).reverse(); return pool.concat(rev) }
      case 'downup': { const r = pool.slice().reverse(); const rev = r.slice(1, -1).reverse(); return r.concat(rev) }
      case 'converge': {
        const out = []
        let lo = 0, hi = pool.length - 1
        while (lo <= hi) { out.push(pool[lo++]); if (lo <= hi) out.push(pool[hi--]) }
        return out
      }
      case 'diverge': {
        const out = []
        let mid = pool.length >> 1
        let l = mid - 1, r2 = mid
        while (r2 < pool.length || l >= 0) { if (r2 < pool.length) out.push(pool[r2++]); if (l >= 0) out.push(pool[l--]) }
        return out
      }
    }
    return pool
  }

  stepSequencer(blockBeats) {
    const patch = this.patch
    const endBeat = this.beat + blockBeats
    // --- arp ---
    if (patch.arp.on && (this.heldNotes.length || (patch.arp.hold && this.arpHeldCache && this.arpHeldCache.length))) {
      if (this.heldNotes.length) this.arpHeldCache = this.heldNotes.slice()
      const stepBeats = this.SYNC_BEATS[clamp(Math.round(patch.arp.syncRate), 0, this.SYNC_BEATS.length - 1)]
      // never try to catch up over a long idle gap — snap to the current beat
      if (this.arpNextBeat < this.beat - stepBeats) this.arpNextBeat = this.beat
      while (this.arpNextBeat + (this.arpStep % 2 === 1 ? patch.arp.swing * stepBeats * 0.33 : 0) < endBeat) {
        const swing = this.arpStep % 2 === 1 ? patch.arp.swing * stepBeats * 0.33 : 0
        // release previous by gate
        this.stopArpNotes()
        const pool = this.heldNotes.length ? this.arpPool() : this.arpHeldCacheToPool()
        if (pool.length) {
          let note
          if (patch.arp.mode === 'random') note = pool[(grng() * pool.length) | 0]
          else if (patch.arp.mode === 'pattern') {
            const pat = patch.arp.pattern
            const ps = pat.length ? pat[this.arpStep % pat.length] : null
            if (ps && ps.on) note = pool[((ps.step % pool.length) + pool.length) % pool.length]
          } else note = pool[this.arpStep % pool.length]
          if (note != null) {
            note += patch.arp.transpose
            if (patch.arp.scaleLock || patch.global.scaleLock) note = this.snapScale(note)
            this.noteOn(note, 0.85, true)
            this.arpNotesDown.push(note)
            this.arpOffBeat = this.arpNextBeat + swing + stepBeats * clamp(patch.arp.gate, 0.05, 2)
            void 0
          }
        }
        this.arpStep++
        this.arpNextBeat += stepBeats
      }
      if (this.arpOffBeat != null && this.beat >= this.arpOffBeat) { this.stopArpNotes(); this.arpOffBeat = null }
    } else if (this.arpNotesDown.length) this.stopArpNotes()
    // --- clip ---
    if (this.playing && patch.clipMode && patch.activeClip >= 0 && patch.clips[patch.activeClip]) {
      const clip = patch.clips[patch.activeClip]
      const len = clip.lengthBeats || 4
      const lb = this.beat % len
      const le = lb + blockBeats
      for (const note of clip.notes) {
        let hit = note.start >= lb && note.start < le
        if (!hit && le > len) hit = note.start < le - len // wrap
        if (hit) {
          if (note.chance >= 1 || grng() < note.chance) {
            this.noteOn(note.note, note.vel, true)
            this.clipNotesOn.push({ note: note.note, endBeat: this.beat + note.len })
          }
        }
      }
      for (let i = this.clipNotesOn.length - 1; i >= 0; i--) {
        if (this.beat >= this.clipNotesOn[i].endBeat) {
          this.noteOff(this.clipNotesOn[i].note, true)
          this.clipNotesOn.splice(i, 1)
        }
      }
      // automation lanes -> macros
      for (const lane of clip.automation || []) {
        const m = lane.param.match(/^macro([1-8])$/)
        if (!m || !lane.points.length) continue
        const x = lb / len
        let val = lane.points[0].y
        for (let i2 = 0; i2 < lane.points.length; i2++) {
          const p0 = lane.points[i2], p1 = lane.points[i2 + 1]
          if (!p1) { if (x >= p0.x) val = p0.y; break }
          if (x >= p0.x && x <= p1.x) { val = p1.x > p0.x ? lerp(p0.y, p1.y, (x - p0.x) / (p1.x - p0.x)) : p0.y; break }
        }
        this.macros[+m[1] - 1] = val
      }
    }
  }

  arpHeldCacheToPool() {
    const saved = this.heldNotes
    this.heldNotes = this.arpHeldCache || []
    const pool = this.arpPool()
    this.heldNotes = saved
    return pool
  }

  // ------- LFOs -------
  lfoFreq(i) {
    const cfg = this.patch.lfos[i]
    if (cfg.sync) {
      const beats = this.SYNC_BEATS[clamp(Math.round(cfg.syncRate), 0, this.SYNC_BEATS.length - 1)]
      return 1 / (beats * 60 / this.bpm)
    }
    return this.gmodVal(`lfo${i + 1}.rate`, cfg.rate)
  }

  lfoEval(i, phase, wantY) {
    const cfg = this.patch.lfos[i]
    let ph = phase + (cfg.phase || 0)
    ph -= Math.floor(ph)
    if (cfg.swing > 0 && cfg.sync) {
      const seg = ph * 2
      const w = 0.5 + cfg.swing * 0.25
      ph = seg < 1 ? curveShape(seg, cfg.swing * 0.5) * 0.5 : 0.5 + curveShape(seg - 1, -cfg.swing * 0.5) * 0.5
    }
    const lut = wantY ? this.lfoLutsY[i] : this.lfoLuts[i]
    if (!lut) return Math.sin(ph * TWO_PI) * 0.5 + 0.5
    return lutEval(lut, ph)
  }

  updateGlobalLfos(blockSec) {
    const patch = this.patch
    for (let i = 0; i < 10; i++) {
      const cfg = patch.lfos[i]
      if (cfg.mode === 'chaos') {
        const c = this.chaosInst[i]
        if (c.type !== cfg.chaosType) { this.chaosInst[i] = new Chaos(cfg.chaosType); continue }
        this.lfoGlobalOut[i] = c.step(this.lfoFreq(i), blockSec)
        this.lfoGlobalOutY[i] = clamp(c.y != null ? c.y / 25 + 0.5 : this.lfoGlobalOut[i], 0, 1)
        continue
      }
      const f = this.lfoFreq(i)
      this.lfoFreePhase[i] += f * blockSec
      this.lfoFreePhase[i] -= Math.floor(this.lfoFreePhase[i])
      const ph = this.lfoFreePhase[i]
      this.lfoGlobalOut[i] = this.lfoEval(i, ph, false)
      this.lfoGlobalOutY[i] = cfg.mode === 'path' ? this.lfoEval(i, ph, true) : this.lfoGlobalOut[i]
    }
  }

  updateVoiceLfos(v, blockSec) {
    const patch = this.patch
    for (let i = 0; i < 10; i++) {
      const cfg = patch.lfos[i]
      if (cfg.mode === 'chaos' || cfg.trigMode === 'off') { v.lfoOut[i] = this.lfoGlobalOut[i]; v.lfoOutY[i] = this.lfoGlobalOutY[i]; continue }
      const f = this.lfoFreq(i)
      let ph = v.lfoPhase[i]
      // delay/rise
      if (cfg.delay > 0 && v.lfoRiseT[i] < cfg.delay) { v.lfoRiseT[i] += blockSec; v.lfoOut[i] = this.lfoEval(i, 0, false); continue }
      ph += f * blockSec
      if (cfg.trigMode === 'env') ph = Math.min(ph, 0.99999)
      else if (cfg.trigMode === 'loopHold' && !v.gate) { /* freeze phase at release */ ph = v.lfoPhase[i] }
      else ph -= Math.floor(ph)
      v.lfoPhase[i] = ph
      let out = this.lfoEval(i, ph, false)
      let outY = cfg.mode === 'path' ? this.lfoEval(i, ph, true) : out
      if (cfg.rise > 0) {
        const riseAmt = clamp((v.lfoRiseT[i] - cfg.delay) / Math.max(cfg.rise, 0.001), 0, 1)
        v.lfoRiseT[i] += blockSec
        out = lerp(0.5, out, riseAmt); outY = lerp(0.5, outY, riseAmt)
      } else v.lfoRiseT[i] += blockSec
      if (cfg.smooth > 0) {
        const c = 1 - Math.pow(clamp(cfg.smooth, 0, 1), 0.3) * 0.995
        v.lfoSm[i] += c * (out - v.lfoSm[i]); out = v.lfoSm[i]
        v.lfoSmY[i] += c * (outY - v.lfoSmY[i]); outY = v.lfoSmY[i]
      }
      v.lfoOut[i] = out
      v.lfoOutY[i] = outY
    }
  }

  computeGmod() {
    this.gmodCache = {}
    for (const row of this.gmodRows) {
      let v = this.globalSourceVal(row.src)
      v = this.applyRowShaping(row, v)
      let aux = 1
      if (row.aux && row.aux !== 'none') aux = lerp(1, clamp(this.globalSourceVal(row.aux), -1, 1), row.auxAmt)
      const contrib = v * row.amt * aux * row.span
      this.gmodCache[row.dest] = (this.gmodCache[row.dest] || 0) + contrib
    }
  }

  computeVoiceMod(v) {
    const mod = v.mod
    for (let i = 0; i < this.destCount; i++) mod[i] = 0
    for (const row of this.matrixRows) {
      let val = this.voiceSourceVal(v, row.src)
      val = this.applyRowShaping(row, val)
      let aux = 1
      if (row.aux && row.aux !== 'none') aux = lerp(1, clamp(this.voiceSourceVal(v, row.aux), -1, 1), row.auxAmt)
      mod[row.destIdx] += val * row.amt * aux * row.span
    }
  }

  // ------- voice block render -------
  renderVoice(v, n, blockSec) {
    const patch = this.patch
    // glide
    if (v.glideT < 1) {
      v.glideT = Math.min(1, v.glideT + (v.glideRate || 1) * n)
    }
    v.curFreq = v.glideT >= 1 ? v.freq : v.glideFrom * Math.pow(v.freq / v.glideFrom, v.glideT)
    const chB = this.chanBend[v.ch || 0]
    if (chB !== 0) v.curFreq *= Math.pow(2, chB / 12)
    const spreadIdxE = v.serial % 7 - 3
    if (patch.global.voiceSpreadTune > 0) v.curFreq *= Math.pow(2, patch.global.voiceSpreadTune * spreadIdxE * 25 / 1200)
    this.updateVoiceLfos(v, blockSec)
    // envs 2-4 at block rate (env1 per-sample below)
    for (let e = 1; e < 4; e++) v.envs[e].process(this.envCfg(e), blockSec)
    this.computeVoiceMod(v)
    // clear work buffers
    const f1L = this.f1inL, f1R = this.f1inR, f2L = this.f2inL, f2R = this.f2inR
    f1L.fill(0, 0, n); f1R.fill(0, 0, n); f2L.fill(0, 0, n); f2R.fill(0, 0, n)
    for (const key of ['main', 'bus1', 'bus2', 'direct']) { this.byBus[key][0].fill(0, 0, n); this.byBus[key][1].fill(0, 0, n) }
    for (let i = 0; i < 3; i++) this.oscMono[i].fill(0, 0, n)
    let anyAlive = false
    // render osc C,B,A so FM sources are fresh
    for (let oi = 2; oi >= 0; oi--) {
      const cfg = patch.oscs[oi]
      if (!cfg.enabled) continue
      const sL = this.srcL, sR = this.srcR
      sL.fill(0, 0, n); sR.fill(0, 0, n)
      const alive = renderOscBlock(this, v, oi, patch, n, sL, sR, this.oscMono[oi])
      if (alive) anyAlive = true
      this.routeSource(cfg, sL, sR, n, f1L, f1R, f2L, f2R)
    }
    // sub
    if (patch.sub.enabled) {
      const sL = this.srcL, sR = this.srcR
      sL.fill(0, 0, n); sR.fill(0, 0, n)
      this.renderSub(v, patch.sub, n, sL, sR)
      anyAlive = true
      if (patch.sub.direct) {
        // direct = skip filters AND all FX: straight to the direct accumulator
        const [dl, dr] = this.byBus.direct
        for (let i = 0; i < n; i++) { dl[i] += sL[i]; dr[i] += sR[i] }
      } else {
        this.routeSource(patch.sub, sL, sR, n, f1L, f1R, f2L, f2R)
      }
    }
    // noise
    if (patch.noise.enabled && patch.noise.sampleId) {
      const smp = this.samples.get(patch.noise.sampleId)
      if (smp) {
        const sL = this.srcL, sR = this.srcR
        sL.fill(0, 0, n); sR.fill(0, 0, n)
        this.renderNoise(v, patch.noise, smp, n, sL, sR)
        anyAlive = true
        this.routeSource(patch.noise, sL, sR, n, f1L, f1R, f2L, f2R)
      }
    }
    // filters (per voice) — each filter owns a bus assignment; serial mode's
    // combined output takes the last enabled filter's bus
    const vs = patch.global
    const spreadIdx = v.serial % 7 - 3
    const ktBase = (v.note - 60) * 0.00738
    const serial = patch.filterRouting === 'serial'
    const outL = this.srcL, outR = this.srcR
    outL.fill(0, 0, n); outR.fill(0, 0, n)
    const out2L = this.out2L, out2R = this.out2R
    out2L.fill(0, 0, n); out2R.fill(0, 0, n)
    const fcfg1 = patch.filters[0], fcfg2 = patch.filters[1]
    const cutSpread = vs.voiceSpreadCutoff * spreadIdx * 0.02
    if (fcfg1.enabled) {
      const cut = clamp(this.vp(v, 'f1.cutoff', fcfg1.cutoff) + ktBase * fcfg1.keytrack + cutSpread, 0, 1)
      const res = clamp(this.vp(v, 'f1.res', fcfg1.res), 0, 1)
      const drv = clamp(this.vp(v, 'f1.drive', fcfg1.drive), 0, 1)
      const fat = clamp(this.vp(v, 'f1.fat', fcfg1.fat), 0, 1)
      const fmix = clamp(this.vp(v, 'f1.mix', fcfg1.mix), 0, 1)
      const fpan = clamp(this.vp(v, 'f1.pan', fcfg1.pan), -1, 1)
      // per-sample cutoff ramp from the previous block's value: no zipper
      const cutFrom = v.prevCut1 == null || patch.global.quality === 'draft' ? cut : v.prevCut1
      v.prevCut1 = cut
      for (let i = 0; i < n; i++) {
        const cutI = cutFrom + (cut - cutFrom) * ((i + 1) / n)
        const wl = v.filters[0].process(f1L[i], fcfg1.type, clamp(cutI - fpan * 0.08, 0, 1), res, drv, fat)
        const wr = v.filters[1].process(f1R[i], fcfg1.type, clamp(cutI + fpan * 0.08, 0, 1), res, drv, fat)
        const l = lerp(f1L[i], wl, fmix), r = lerp(f1R[i], wr, fmix)
        if (serial && fcfg2.enabled) { f2L[i] += l; f2R[i] += r } else { outL[i] += l; outR[i] += r }
      }
    } else {
      for (let i = 0; i < n; i++) {
        if (serial && fcfg2.enabled) { f2L[i] += f1L[i]; f2R[i] += f1R[i] }
        else { outL[i] += f1L[i]; outR[i] += f1R[i] }
      }
    }
    const f2Target = serial ? [outL, outR] : [out2L, out2R]
    if (fcfg2.enabled) {
      const cut = clamp(this.vp(v, 'f2.cutoff', fcfg2.cutoff) + ktBase * fcfg2.keytrack + cutSpread, 0, 1)
      const res = clamp(this.vp(v, 'f2.res', fcfg2.res), 0, 1)
      const drv = clamp(this.vp(v, 'f2.drive', fcfg2.drive), 0, 1)
      const fat = clamp(this.vp(v, 'f2.fat', fcfg2.fat), 0, 1)
      const fmix = clamp(this.vp(v, 'f2.mix', fcfg2.mix), 0, 1)
      const fpan = clamp(this.vp(v, 'f2.pan', fcfg2.pan), -1, 1)
      const cutFrom2 = v.prevCut2 == null || patch.global.quality === 'draft' ? cut : v.prevCut2
      v.prevCut2 = cut
      for (let i = 0; i < n; i++) {
        const cutI = cutFrom2 + (cut - cutFrom2) * ((i + 1) / n)
        const wl = v.filters[2].process(f2L[i], fcfg2.type, clamp(cutI - fpan * 0.08, 0, 1), res, drv, fat)
        const wr = v.filters[3].process(f2R[i], fcfg2.type, clamp(cutI + fpan * 0.08, 0, 1), res, drv, fat)
        f2Target[0][i] += lerp(f2L[i], wl, fmix)
        f2Target[1][i] += lerp(f2R[i], wr, fmix)
      }
    } else if (!serial || !fcfg1.enabled) {
      for (let i = 0; i < n; i++) { f2Target[0][i] += f2L[i]; f2Target[1][i] += f2R[i] }
    }
    // amp env (per-sample), velocity, voice pan spread
    const e1cfg = this.envCfg(0)
    const dt = 1 / this.sr
    const velG = 0.2 + 0.8 * v.vel
    const panSpread = clamp(vs.voiceSpreadPan * spreadIdx / 3, -1, 1)
    const pl = Math.cos((panSpread + 1) * Math.PI / 4) * 1.414 * velG
    const pr = Math.sin((panSpread + 1) * Math.PI / 4) * 1.414 * velG
    // amp env once per sample into a gain buffer, then fan out to every bus
    const env1 = v.envs[0]
    const gBuf = this.oscMono[0] // reuse as scratch (osc rendering is done)
    for (let i = 0; i < n; i++) gBuf[i] = env1.process(e1cfg, dt)
    const busOf = (b) => this.busses[b] || this.busses.main
    // filtered path 1 (serial: the whole chain)
    const bus1Key = serial
      ? (fcfg2.enabled ? (fcfg2.bus || 'main') : (fcfg1.bus || 'main'))
      : (fcfg1.bus || 'main')
    {
      const [bL, bR] = busOf(bus1Key)
      for (let i = 0; i < n; i++) { bL[i] += outL[i] * gBuf[i] * pl; bR[i] += outR[i] * gBuf[i] * pr }
    }
    if (!serial) {
      const [bL, bR] = busOf(fcfg2.bus || 'main')
      for (let i = 0; i < n; i++) { bL[i] += out2L[i] * gBuf[i] * pl; bR[i] += out2R[i] * gBuf[i] * pr }
    }
    // filter-bypassed sources: each on its own bus
    for (const key of ['main', 'bus1', 'bus2', 'direct']) {
      const [sBL, sBR] = this.byBus[key]
      const [bL, bR] = this.busses[key]
      for (let i = 0; i < n; i++) { bL[i] += sBL[i] * gBuf[i] * pl; bR[i] += sBR[i] * gBuf[i] * pr }
    }
    if (!env1.active) v.active = false
    if (!anyAlive && !v.gate && !env1.active) v.active = false
  }

  env1Gain(v) { return v.envs[0].out }

  envCfg(i) {
    const cfg = this.patch.envs[i]
    const n = i + 1
    // bpmSync: env times are authored at a 120 BPM reference and scale with tempo
    const ts = cfg.bpmSync ? 120 / clamp(this.bpm, 40, 300) : 1
    return {
      attack: this.gmodVal(`env${n}.attack`, cfg.attack) * ts,
      hold: cfg.hold * ts,
      decay: this.gmodVal(`env${n}.decay`, cfg.decay) * ts,
      sustain: clamp(this.gmodVal(`env${n}.sustain`, cfg.sustain), 0, 1),
      release: this.gmodVal(`env${n}.release`, cfg.release) * ts,
      aCurve: cfg.aCurve, dCurve: cfg.dCurve, rCurve: cfg.rCurve,
    }
  }

  routeSource(cfg, sL, sR, n, f1L, f1R, f2L, f2R) {
    let w1 = 0, w2 = 0, wb = 0
    switch (cfg.dest) {
      case 'f1': w1 = 1; break
      case 'f2': w2 = 1; break
      case 'both': w1 = 1 - cfg.filterBal; w2 = cfg.filterBal; break
      default: wb = 1
    }
    if (w1 > 0) for (let i = 0; i < n; i++) { f1L[i] += sL[i] * w1; f1R[i] += sR[i] * w1 }
    if (w2 > 0) for (let i = 0; i < n; i++) { f2L[i] += sL[i] * w2; f2R[i] += sR[i] * w2 }
    if (wb > 0) {
      // filter-bypassed sources keep their own bus assignment
      const bb = this.byBus[cfg.bus] || this.byBus.main
      const [byL, byR] = bb
      for (let i = 0; i < n; i++) { byL[i] += sL[i] * wb; byR[i] += sR[i] * wb }
    }
  }

  renderSub(v, cfg, n, sL, sR) {
    const level = clamp(this.vp(v, 'sub.level', cfg.level), 0, 1)
    const pan = clamp(this.vp(v, 'sub.pan', cfg.pan), -1, 1)
    const pl = Math.cos((pan + 1) * Math.PI / 4) * level
    const pr = Math.sin((pan + 1) * Math.PI / 4) * level
    const freq = v.curFreq * Math.pow(2, cfg.octave) * Math.pow(2, this.pitchBendSemis / 12)
    const inc = freq / this.sr
    let ph = v.subPhase
    for (let i = 0; i < n; i++) {
      let y
      switch (cfg.shape) {
        case 'triangle': y = 4 * Math.abs(ph - 0.5) - 1; break
        case 'square': {
          y = ph < 0.5 ? 1 : -1
          y -= polyBlep(ph, inc); y += polyBlep((ph + 0.5) % 1, inc)
          break
        }
        case 'saw': {
          y = 2 * ph - 1
          y -= polyBlep(ph, inc)
          break
        }
        default: y = Math.sin(ph * TWO_PI)
      }
      sL[i] += y * pl
      sR[i] += y * pr
      ph += inc
      if (ph >= 1) ph -= 1
    }
    v.subPhase = ph
  }

  renderNoise(v, cfg, smp, n, sL, sR) {
    const level = clamp(this.vp(v, 'noise.level', cfg.level), 0, 1)
    const pan = clamp(this.vp(v, 'noise.pan', cfg.pan), -1, 1)
    const pitch = this.vp(v, 'noise.pitch', cfg.pitch)
    const pl = Math.cos((pan + 1) * Math.PI / 4) * level
    const pr = Math.sin((pan + 1) * Math.PI / 4) * level
    const kt = cfg.keytrack ? v.curFreq / midiFreq(60) : 1
    const step = Math.pow(2, pitch / 12) * kt * (smp.sr / this.sr)
    if (v.noisePos < 0) v.noisePos = (cfg.phase + (cfg.rand > 0 ? v.rand * cfg.rand : 0)) % 1 * smp.len
    let pos = v.noisePos
    const stereo = !!smp.r
    for (let i = 0; i < n; i++) {
      if (pos >= smp.len) {
        if (cfg.oneShot) break
        pos -= smp.len
      }
      const l = sampleAt(smp, pos, 0)
      sL[i] += l * pl
      sR[i] += (stereo ? sampleAt(smp, pos, 1) : l) * pr
      pos += step
    }
    v.noisePos = pos
  }

  // ------- FX chains -------
  fxState(unit) {
    let st = this.fxStates.get(unit.id)
    if (!st || st.type !== unit.type) { st = new FxState(unit.type, this.sr, this.bpm); this.fxStates.set(unit.id, st) }
    return st
  }

  tmp() {
    if (this.tmpPoolIdx >= this.tmpPool.length) this.tmpPool.push(new Float32Array(BLOCK))
    const b = this.tmpPool[this.tmpPoolIdx++]
    b.fill(0)
    return b
  }

  processChain(units, L, R, n) {
    for (const unit of units) {
      if (!unit.enabled) continue
      if (unit.type === 'splitLH' || unit.type === 'splitLMH' || unit.type === 'splitMS') {
        this.processSplitter(unit, L, R, n)
        continue
      }
      processFxUnit(this, unit, this.fxState(unit), L, R, n)
    }
  }

  processSplitter(unit, L, R, n) {
    const st = this.fxState(unit)
    if (!st.xo) { st.xo = [new SVF(), new SVF(), new SVF(), new SVF()] }
    const save = this.tmpPoolIdx
    const chains = unit.chains || []
    if (unit.type === 'splitMS') {
      const mL = this.tmp(), mR = this.tmp(), sL2 = this.tmp(), sR2 = this.tmp()
      for (let i = 0; i < n; i++) {
        const mid = (L[i] + R[i]) * 0.5, side = (L[i] - R[i]) * 0.5
        mL[i] = mid; mR[i] = mid; sL2[i] = side; sR2[i] = -side
      }
      if (chains[0]) this.processChain(chains[0], mL, mR, n)
      if (chains[1]) this.processChain(chains[1], sL2, sR2, n)
      for (let i = 0; i < n; i++) {
        const mid = (mL[i] + mR[i]) * 0.5, side = (sL2[i] - sR2[i]) * 0.5
        L[i] = mid + side; R[i] = mid - side
      }
      this.tmpPoolIdx = save
      return
    }
    if (unit.type === 'splitLH') {
      const xf = cutoffHz(clamp(this.gmodVal(`fx.${unit.id}.xover`, unit.params.xover != null ? unit.params.xover : 0.4), 0, 1))
      const g = svfG(xf, this.sr)
      const loL = this.tmp(), loR = this.tmp(), hiL = this.tmp(), hiR = this.tmp()
      for (let i = 0; i < n; i++) {
        st.xo[0].process(L[i], g, 1.414); st.xo[1].process(R[i], g, 1.414)
        loL[i] = st.xo[0].lp; hiL[i] = st.xo[0].hp
        loR[i] = st.xo[1].lp; hiR[i] = st.xo[1].hp
      }
      if (chains[0]) this.processChain(chains[0], loL, loR, n)
      if (chains[1]) this.processChain(chains[1], hiL, hiR, n)
      for (let i = 0; i < n; i++) { L[i] = loL[i] + hiL[i]; R[i] = loR[i] + hiR[i] }
      this.tmpPoolIdx = save
      return
    }
    // LMH
    const xlo = cutoffHz(clamp(this.gmodVal(`fx.${unit.id}.xlo`, unit.params.xlo != null ? unit.params.xlo : 0.3), 0, 1))
    const xhi = cutoffHz(clamp(this.gmodVal(`fx.${unit.id}.xhi`, unit.params.xhi != null ? unit.params.xhi : 0.65), 0, 1))
    const gLo = svfG(xlo, this.sr), gHi = svfG(Math.max(xhi, xlo * 1.02), this.sr)
    const loL = this.tmp(), loR = this.tmp(), miL = this.tmp(), miR = this.tmp(), hiL = this.tmp(), hiR = this.tmp()
    for (let i = 0; i < n; i++) {
      st.xo[0].process(L[i], gLo, 1.414); st.xo[1].process(R[i], gLo, 1.414)
      loL[i] = st.xo[0].lp; loR[i] = st.xo[1].lp
      st.xo[2].process(st.xo[0].hp, gHi, 1.414); st.xo[3].process(st.xo[1].hp, gHi, 1.414)
      miL[i] = st.xo[2].lp; miR[i] = st.xo[3].lp
      hiL[i] = st.xo[2].hp; hiR[i] = st.xo[3].hp
    }
    if (chains[0]) this.processChain(chains[0], loL, loR, n)
    if (chains[1]) this.processChain(chains[1], miL, miR, n)
    if (chains[2]) this.processChain(chains[2], hiL, hiR, n)
    for (let i = 0; i < n; i++) { L[i] = loL[i] + miL[i] + hiL[i]; R[i] = loR[i] + miR[i] + hiR[i] }
    this.tmpPoolIdx = save
  }

  // ------- main -------
  reconfigure(newSr) {
    // quality switch: rebuild everything whose state is sample-rate bound
    this.sr = newSr
    this.voices = Array.from({ length: 32 }, () => new Voice(newSr))
    this.monoVoice = null
    this.fxStates.clear()
    this.convCache.clear()
  }

  process(inputs, outputs) {
    // Crash armor: an uncaught exception in an AudioWorklet's process() kills
    // the processor PERMANENTLY (silent until reload). Any edge case — a stale
    // autosaved patch shape, a corrupt FX state — must degrade to one silent
    // block + killed voices, never to dead audio. Errors are reported to the
    // client (→ console + Sentry) with the first few stacks.
    try {
      return this.processInner(inputs, outputs)
    } catch (err) {
      try {
        const out = outputs[0]
        if (out && out[0]) out[0].fill(0)
        if (out && out[1]) out[1].fill(0)
        this.procErrCount = (this.procErrCount || 0) + 1
        if (this.procErrCount <= 5) {
          this.port.postMessage({ type: 'procError', message: String((err && err.stack) || err), count: this.procErrCount })
        }
        // rebuild the whole voice pool — the throwing voice's internals are in
        // an unknown state and would throw again the next time it's allocated
        this.voices = Array.from({ length: 32 }, () => new Voice(this.sr))
        this.monoVoice = null
      } catch (e3) { /* even recovery failed — still keep the processor alive */ }
      return true
    }
  }

  processInner(inputs, outputs) {
    const out = outputs[0]
    const OL = out[0], OR = out.length > 1 ? out[1] : out[0]
    if (!this.patch) return true
    this._inp = this.fxOnly && inputs && inputs[0] && inputs[0].length ? inputs[0] : null
    this._key = this.fxOnly && inputs && inputs[1] && inputs[1].length ? inputs[1] : null
    const desired = this.fxOnly ? sampleRate : sampleRate * (this.patch.global.quality === 'high' ? 2 : 1)
    if (this.sr !== desired) this.reconfigure(desired)
    const n = OL.length
    // absolute-time events (DAW mode): currentTime is the context clock in
    // both live and offline rendering
    if (this.absEvents && this.absEvents.length) {
      const end = currentTime + n / sampleRate
      while (this.absEvents.length && this.absEvents[0].t < end) {
        const ev = this.absEvents.shift()
        if (ev.type === 'noteOn') this.noteOn(ev.note, ev.vel != null ? ev.vel : 0.9, false, ev.ch || 0)
        else if (ev.type === 'noteOff') this.noteOff(ev.note, false)
      }
    }
    if (this.sr === sampleRate) { this.renderQuantum(OL, OR, n); return true }
    // 2x oversampled: render two internal quanta, half-band decimate
    if (!this.osUpL || this.osUpL.length !== n * 2) {
      this.osUpL = new Float32Array(n * 2); this.osUpR = new Float32Array(n * 2)
      const TAPS = 33
      this.osFir = new Float32Array(TAPS)
      const fc = 0.23
      for (let i = 0; i < TAPS; i++) {
        const m = i - (TAPS - 1) / 2
        const sinc = m === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * m) / (Math.PI * m)
        this.osFir[i] = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (TAPS - 1)))
      }
      let g = 0
      for (let i = 0; i < TAPS; i++) g += this.osFir[i]
      for (let i = 0; i < TAPS; i++) this.osFir[i] /= g
      this.osHistL = new Float32Array(TAPS)
      this.osHistR = new Float32Array(TAPS)
    }
    this.renderQuantum(this.osUpL.subarray(0, n), this.osUpR.subarray(0, n), n)
    this.renderQuantum(this.osUpL.subarray(n), this.osUpR.subarray(n), n)
    const TAPS = this.osFir.length
    const hL = this.osHistL, hR = this.osHistR, fir = this.osFir
    let oi = 0
    for (let i = 0; i < n * 2; i++) {
      // shift history (small TAPS — fine)
      for (let k = TAPS - 1; k > 0; k--) { hL[k] = hL[k - 1]; hR[k] = hR[k - 1] }
      hL[0] = this.osUpL[i]; hR[0] = this.osUpR[i]
      if (i & 1) {
        let al = 0, ar = 0
        for (let k = 0; k < TAPS; k++) { al += hL[k] * fir[k]; ar += hR[k] * fir[k] }
        OL[oi] = al; OR[oi] = ar; oi++
      }
    }
    return true
  }

  renderQuantum(OL, OR, n) {
    const patch = this.patch
    const blockSec = n / this.sr
    const blockBeats = this.bpm / 60 * blockSec
    this.tmpPoolIdx = 0
    for (const key of ['main', 'bus1', 'bus2', 'direct']) { this.busses[key][0].fill(0, 0, n); this.busses[key][1].fill(0, 0, n) }
    this.updateGlobalLfos(blockSec)
    this.computeGmod()
    let voiceCount = 0
    if (this.fxOnly) {
      // external input becomes the "voice mix": straight into the main lane
      const inp = this._inp
      if (inp && inp[0]) {
        const IL = inp[0], IR = inp[1] || inp[0]
        const ML = this.busses.main[0], MR = this.busses.main[1]
        for (let i = 0; i < n; i++) { ML[i] = IL[i] || 0; MR[i] = IR[i] || 0 }
      }
    } else {
      this.runSchedule(blockSec)
      this.stepSequencer(blockBeats)
      for (const v of this.voices) {
        if (!v.active) continue
        voiceCount++
        this.renderVoice(v, n, blockSec)
      }
    }
    // FX lanes
    this.processChain(patch.fxMain, this.busses.main[0], this.busses.main[1], n)
    this.processChain(patch.fxBus1, this.busses.bus1[0], this.busses.bus1[1], n)
    this.processChain(patch.fxBus2, this.busses.bus2[0], this.busses.bus2[1], n)
    const r1 = clamp(this.gmodVal('bus1Return', patch.bus1Return), 0, 1)
    const r2 = clamp(this.gmodVal('bus2Return', patch.bus2Return), 0, 1)
    const mg = clamp(this.gmodVal('global.masterGain', patch.global.masterGain), 0, 1)
    let peak = 0
    // Master peak limiter: polyphonic summing easily exceeds ±1 (8 notes ≈ 2.2
    // peak), which used to slam the old ±1.5 soft clip and then the DAC — harsh
    // distortion that reads as "it breaks when I play too many notes". Instant
    // attack, ~120 ms release, 0.98 ceiling; unity gain below the ceiling.
    if (this.limEnv === undefined || !isFinite(this.limEnv)) this.limEnv = 0
    if (this.followEnv !== undefined && !isFinite(this.followEnv)) this.followEnv = 0
    const limRel = 1 - Math.exp(-1 / (0.12 * this.sr))
    // envelope follower mod source: tracks the master output level (pre-limiter)
    if (this.followEnv === undefined) this.followEnv = 0
    const folCfg = patch.global.follower || {}
    const folAtk = 1 - Math.exp(-1 / (Math.max(1, folCfg.attack != null ? folCfg.attack : 10) * 0.001 * this.sr))
    const folRel = 1 - Math.exp(-1 / (Math.max(5, folCfg.release != null ? folCfg.release : 200) * 0.001 * this.sr))
    const folGain = folCfg.gain != null ? folCfg.gain : 1
    for (let i = 0; i < n; i++) {
      let l = (this.busses.main[0][i] + this.busses.bus1[0][i] * r1 + this.busses.bus2[0][i] * r2 + this.busses.direct[0][i]) * mg
      let r = (this.busses.main[1][i] + this.busses.bus1[1][i] * r1 + this.busses.bus2[1][i] * r2 + this.busses.direct[1][i]) * mg
      // a single NaN from any voice/FX must stay a transient blip — unflushed
      // it poisons the limiter envelope and mutes the synth PERMANENTLY
      if (!isFinite(l)) l = 0
      if (!isFinite(r)) r = 0
      const aIn = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r)
      const folTarget = Math.min(1, aIn * folGain)
      this.followEnv += (folTarget - this.followEnv) * (folTarget > this.followEnv ? folAtk : folRel)
      if (aIn > this.limEnv) this.limEnv = aIn
      else this.limEnv += (aIn - this.limEnv) * limRel
      // fx-only host mode is a TRANSPARENT insert: the host (Beacon) owns gain
      // staging, and hot inter-effect levels are legitimate there — limiting or
      // clipping them adds harmonics the legacy path never had. Standalone
      // Apollo keeps its limiter + hard safety unchanged.
      if (!this.fxOnly) {
        if (this.limEnv > 0.98) { const g = 0.98 / this.limEnv; l *= g; r *= g }
        // hard safety for anything pathological the limiter can't catch in-sample
        if (l > 1.2) l = 1.2; else if (l < -1.2) l = -1.2
        if (r > 1.2) r = 1.2; else if (r < -1.2) r = -1.2
      }
      OL[i] = l; OR[i] = r
      const a = Math.abs(l) + Math.abs(r)
      if (a > peak) peak = a
    }
    // metronome click
    if (this.playing && this.clickOn) {
      const beatIn = Math.ceil(this.beat)
      if (beatIn < this.beat + blockBeats) {
        this.clickT = 0
        this.clickHi = beatIn % 4 === 0
      }
      if (this.clickT != null && this.clickT < 0.05 * this.sr) {
        const f = this.clickHi ? 1500 : 1000
        for (let i = 0; i < n && this.clickT < 0.05 * this.sr; i++, this.clickT++) {
          const env = Math.exp(-this.clickT / (0.012 * this.sr))
          const c = Math.sin(TWO_PI * f * this.clickT / this.sr) * env * 0.25
          OL[i] += c; OR[i] += c
        }
      }
    }
    // the musical clock always runs so the arp free-runs without transport;
    // clip playback + metronome are separately gated on this.playing
    this.beat += blockBeats
    // meters
    if (++this.meterCounter >= 4) {
      this.meterCounter = 0
      const nv = this.newestVoice()
      this.port.postMessage({
        type: 'meters',
        peak: peak * 0.5,
        voices: voiceCount,
        beat: this.beat,
        playing: this.playing,
        lfo: Array.from({ length: 10 }, (_, i) => {
          const cfg = patch.lfos[i]
          if (cfg.trigMode === 'off' || cfg.mode === 'chaos') return this.lfoGlobalOut[i]
          return nv ? nv.lfoOut[i] : this.lfoGlobalOut[i]
        }),
        lfoPhase: Array.from({ length: 10 }, (_, i) => {
          const cfg = patch.lfos[i]
          if (cfg.trigMode === 'off' || cfg.mode === 'chaos') return this.lfoFreePhase[i]
          // trig/env LFOs only run per-voice: report -1 when idle so the UI
          // shows a still curve instead of a free-running playhead
          return nv ? nv.lfoPhase[i] : -1
        }),
        env: nv ? nv.envs.map(e => e.out) : [0, 0, 0, 0],
        grain: Array.from(this.grainViz),
        spec: Array.from(this.specViz),
        macros: Array.from(this.macros),
        follower: this.followEnv || 0,
        fxGr: this.fxGr,
      })
    }
  }
}

registerProcessor('apollo-engine', ApolloProcessor)
