// Offline DSP primitives — the Node-side twin of the nodes the DAW builds in
// Web Audio.
//
// Why this exists: every note of a Helios/Apollo track can already be rendered
// in plain Node at ~50x real-time (scripts/apollo-render.mjs runs the real
// worklet). What could NOT be done in Node was the rest of the signal path —
// the track's effect bars, its gain and pan, the master bus. So a song still had
// to be bounced through a browser in real time, which is two minutes of waiting
// per listen, plus a dev server, plus the sample-seeding races that have
// silently dropped a track more than once.
//
// These are deliberately the SAME formulas the browser uses, not lookalikes:
//   • biquads follow the Web Audio spec's cookbook coefficients, including the
//     detail that lowpass/highpass read Q in DECIBELS while peaking/shelving
//     read it as a plain quality factor. Getting that wrong shifts every filter
//     sweep in the song by a resonance bump that is not there in the product.
//   • the distortion curve is daw-engine's `_getDistCurve`, transcribed.
//   • the reverb impulse is daw-engine's `_getReverbIR`, transcribed, and it is
//     normalised the way ConvolverNode normalises by default — otherwise wet
//     reverb comes out roughly 20 dB hotter here than in the app.
//
// Where something is an approximation rather than a transcription it says so at
// the definition, and scripts/render-parity.mjs measures how far off it is.

// ── Sample-rate-independent helpers ─────────────────────────────────────────

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

/** Equal-power pan, exactly as StereoPannerNode does it for a stereo input.
 *  A stereo source does not get rotated through the middle: panning right keeps
 *  the right channel and folds the left into it. */
export function panStereo(l, r, pan) {
  const p = clamp(pan, -1, 1)
  if (p <= 0) {
    const x = (p + 1) * Math.PI / 2
    const g = Math.cos(x), s = Math.sin(x)
    return [l + r * g, r * s]
  }
  const x = p * Math.PI / 2
  const g = Math.cos(x), s = Math.sin(x)
  return [l * g, r + l * s]
}

// ── Biquad ──────────────────────────────────────────────────────────────────
// Coefficients per the Web Audio spec (which is the Audio EQ Cookbook). The
// filters here are time-varying: coefficients are recomputed on a control block
// (every CONTROL samples) rather than per sample, which is what the browser
// effectively does too when a param follows a value curve.

export class Biquad {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.x1 = 0; this.x2 = 0; this.y1 = 0; this.y2 = 0 }

  /** type: 'lowpass' | 'highpass' | 'lowshelf' | 'highshelf' | 'peaking' | 'allpass' */
  set(type, freq, sr, Q = 1, gainDb = 0) {
    const f0 = clamp(freq / (sr / 2), 1e-6, 0.999)   // normalised to Nyquist
    const w0 = Math.PI * f0
    const cw = Math.cos(w0), sw = Math.sin(w0)
    let b0, b1, b2, a0, a1, a2
    switch (type) {
      case 'lowpass': {
        // Q is in dB here — the spec's `10^(Q/20)`. This is the difference
        // between a gentle roll-off and a resonant peak, and the DAW passes
        // filterQ (default 0.8) straight into it.
        const alpha = sw / (2 * Math.pow(10, Q / 20))
        b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
        break
      }
      case 'highpass': {
        const alpha = sw / (2 * Math.pow(10, Q / 20))
        b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
        break
      }
      case 'peaking': {
        const A = Math.pow(10, gainDb / 40)
        const alpha = sw / (2 * Math.max(1e-4, Q))
        b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A
        a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A
        break
      }
      case 'lowshelf': {
        const A = Math.pow(10, gainDb / 40)
        const S = 1
        const alpha = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2)
        const tsa = 2 * Math.sqrt(A) * alpha
        b0 = A * ((A + 1) - (A - 1) * cw + tsa)
        b1 = 2 * A * ((A - 1) - (A + 1) * cw)
        b2 = A * ((A + 1) - (A - 1) * cw - tsa)
        a0 = (A + 1) + (A - 1) * cw + tsa
        a1 = -2 * ((A - 1) + (A + 1) * cw)
        a2 = (A + 1) + (A - 1) * cw - tsa
        break
      }
      case 'highshelf': {
        const A = Math.pow(10, gainDb / 40)
        const S = 1
        const alpha = (sw / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2)
        const tsa = 2 * Math.sqrt(A) * alpha
        b0 = A * ((A + 1) + (A - 1) * cw + tsa)
        b1 = -2 * A * ((A - 1) + (A + 1) * cw)
        b2 = A * ((A + 1) + (A - 1) * cw - tsa)
        a0 = (A + 1) - (A - 1) * cw + tsa
        a1 = 2 * ((A - 1) - (A + 1) * cw)
        a2 = (A + 1) - (A - 1) * cw - tsa
        break
      }
      case 'allpass': {
        const alpha = sw / (2 * Math.max(1e-4, Q))
        b0 = 1 - alpha; b1 = -2 * cw; b2 = 1 + alpha
        a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha
        break
      }
      default: throw new Error(`Biquad: unknown type ${type}`)
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0
    this.a1 = a1 / a0; this.a2 = a2 / a0
  }

  process(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2
    this.x2 = this.x1; this.x1 = x
    this.y2 = this.y1; this.y1 = y
    return y
  }
}

// ── Waveshaping ─────────────────────────────────────────────────────────────

/** daw-engine `_getDistCurve`, transcribed. `drive` 0..1; 0 is identity. */
export function distCurve(drive) {
  const k = drive * 50
  const c = new Float32Array(1024)
  const norm = Math.tanh(k)
  for (let i = 0; i < 1024; i++) {
    const x = i / 511.5 - 1
    c[i] = norm < 1e-6 ? x : Math.tanh(k * x) / norm
  }
  return c
}

/** daw-engine's bitcrush curve. */
export function crushCurve(amount) {
  const bits = Math.max(1.5, 16 - amount * 14.5)
  const levels = Math.pow(2, bits)
  const c = new Float32Array(1024)
  for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; c[i] = Math.round(x * levels) / levels }
  return c
}

/** WaveShaperNode's curve lookup: map -1..1 across the table, interpolating.
 *  The browser oversamples 2x; this does not. The curves in use here are gentle
 *  tanh at drive ≤ 0.05, where the aliasing that oversampling removes sits far
 *  below the noise floor — but a hard `distortion` bar will read slightly
 *  brighter offline than in the app. */
export function shape(curve, x) {
  const n = curve.length
  const v = (clamp(x, -1, 1) + 1) * 0.5 * (n - 1)
  const i = Math.floor(v)
  if (i >= n - 1) return curve[n - 1]
  const f = v - i
  return curve[i] * (1 - f) + curve[i + 1] * f
}

// ── Reverb ──────────────────────────────────────────────────────────────────

/** daw-engine `_getReverbIR`, transcribed — white noise under a (1-t)^2.6
 *  envelope. Seeded here so a render is reproducible; the app uses Math.random,
 *  so the tail differs in detail but not in character or level. */
export function reverbIR(decaySec, sr, seed = 20260826) {
  const len = Math.max(1, Math.floor(sr * (Math.round(decaySec * 10) / 10)))
  let s = seed >>> 0
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
  const l = new Float32Array(len), r = new Float32Array(len)
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 2.6)
    l[i] = (rand() * 2 - 1) * env
    r[i] = (rand() * 2 - 1) * env
  }
  return { l, r, len }
}

/** ConvolverNode normalises by default. The spec's scale is derived from the
 *  impulse's power; without it a noise IR of this length comes back far louder
 *  than the dry signal and every reverb decision made offline would be wrong. */
export function normalizeIR(ir, sr) {
  let power = 0
  for (let i = 0; i < ir.len; i++) power += ir.l[i] * ir.l[i] + ir.r[i] * ir.r[i]
  power = Math.sqrt(power / (ir.len * 2))
  // The spec's calibration constant, referenced to a 44.1 kHz 0.5 s impulse.
  const scale = 0.00125 * Math.sqrt(sr * ir.len / 2) / Math.max(1e-9, power * Math.sqrt(ir.len))
  const g = scale * Math.sqrt(2)
  for (let i = 0; i < ir.len; i++) { ir.l[i] *= g; ir.r[i] *= g }
  return ir
}

// ── FFT (radix-2, in-place) for fast convolution ────────────────────────────

function fft(re, im, inverse) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
}

/** Overlap-add convolution of `sig` with `ir`. A 2-minute track against a
 *  4-second tail is ~6M multiply-adds direct and well under a second by FFT. */
export function convolve(sig, ir) {
  const irLen = ir.length
  if (irLen === 0) return new Float32Array(sig.length)
  let fftSize = 1
  while (fftSize < irLen * 2) fftSize <<= 1
  const blockSize = fftSize - irLen + 1
  const irRe = new Float64Array(fftSize), irIm = new Float64Array(fftSize)
  irRe.set(ir)
  fft(irRe, irIm, false)
  const out = new Float32Array(sig.length + irLen)
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize)
  for (let pos = 0; pos < sig.length; pos += blockSize) {
    re.fill(0); im.fill(0)
    const n = Math.min(blockSize, sig.length - pos)
    for (let i = 0; i < n; i++) re[i] = sig[pos + i]
    fft(re, im, false)
    for (let i = 0; i < fftSize; i++) {
      const r = re[i] * irRe[i] - im[i] * irIm[i]
      const m = re[i] * irIm[i] + im[i] * irRe[i]
      re[i] = r; im[i] = m
    }
    fft(re, im, true)
    for (let i = 0; i < fftSize && pos + i < out.length; i++) out[pos + i] += re[i]
  }
  return out.subarray(0, sig.length)
}

// ── Delay line ──────────────────────────────────────────────────────────────

export class Delay {
  constructor(maxSec, sr) { this.buf = new Float32Array(Math.ceil(maxSec * sr) + 2); this.w = 0; this.sr = sr }
  /** Read `sec` in the past with linear interpolation, then write `x`. */
  tick(x, sec) {
    const d = clamp(sec * this.sr, 1, this.buf.length - 2)
    let rp = this.w - d
    while (rp < 0) rp += this.buf.length
    const i = Math.floor(rp), f = rp - i
    const a = this.buf[i], b = this.buf[(i + 1) % this.buf.length]
    const y = a + (b - a) * f
    this.buf[this.w] = x
    this.w = (this.w + 1) % this.buf.length
    return y
  }
}

// ── Dynamics ────────────────────────────────────────────────────────────────

/**
 * The master bus compressor.
 *
 * APPROXIMATION, and the only meaningful one in this file. Chrome's
 * DynamicsCompressorNode is a specific implementation with 6 ms of lookahead, a
 * dB-domain soft knee, and release curves fitted to a polynomial; this is a
 * standard smooth peak compressor with the same threshold/knee/ratio/attack/
 * release. On the material this renders (a mix peaking a few dB into a -6 dB
 * threshold at ratio 2.5) the two agree closely, but do not read a difference
 * of a few tenths of a dB in gain reduction as a musical fact.
 * scripts/render-parity.mjs is where the real number lives.
 */
export class Compressor {
  constructor({ threshold = -6, knee = 10, ratio = 2.5, attack = 0.003, release = 0.25, sr = 48000 } = {}) {
    Object.assign(this, { threshold, knee, ratio, sr })
    this.aA = Math.exp(-1 / (attack * sr))
    this.aR = Math.exp(-1 / (release * sr))
    this.env = 0
    this.gainDb = 0
  }
  /** dB of output for a dB of input, with a quadratic knee around threshold. */
  curve(db) {
    const { threshold: t, knee: k, ratio: r } = this
    if (db < t - k / 2) return db
    if (db > t + k / 2) return t + (db - t) / r
    const x = db - t + k / 2
    return db + ((1 / r - 1) * x * x) / (2 * k)
  }
  process(l, r) {
    const peak = Math.max(Math.abs(l), Math.abs(r))
    const a = peak > this.env ? this.aA : this.aR
    this.env = a * this.env + (1 - a) * peak
    const db = 20 * Math.log10(Math.max(1e-9, this.env))
    const target = this.curve(db) - db
    // Smooth the gain itself as well, so a transient does not step the level.
    const ag = target < this.gainDb ? this.aA : this.aR
    this.gainDb = ag * this.gainDb + (1 - ag) * target
    const g = Math.pow(10, this.gainDb / 20)
    return [l * g, r * g]
  }
}

// ── WAV I/O ─────────────────────────────────────────────────────────────────

export function readWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV')
  let pos = 12, fmt = null, data = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(pos + 8), channels: buf.readUInt16LE(pos + 10), sr: buf.readUInt32LE(pos + 12), bits: buf.readUInt16LE(pos + 22) }
    if (id === 'data') data = buf.subarray(pos + 8, pos + 8 + size)
    pos += 8 + size + (size & 1)
  }
  if (!fmt || !data) throw new Error('WAV missing fmt/data')
  const { channels, bits, sr, format } = fmt
  const bytes = bits / 8
  const frames = Math.floor(data.length / (bytes * channels))
  const ch = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < channels; c++) {
      const o = (f * channels + c) * bytes
      let v
      if (format === 3 && bits === 32) v = data.readFloatLE(o)
      else if (bits === 16) v = data.readInt16LE(o) / 32768
      else if (bits === 24) v = (((data[o] | (data[o + 1] << 8) | (data[o + 2] << 16)) << 8) >> 8) / 8388608
      else if (bits === 32) v = data.readInt32LE(o) / 2147483648
      else throw new Error(`unsupported WAV: fmt ${format} / ${bits}-bit`)
      ch[c][f] = v
    }
  }
  return { sr, l: ch[0], r: ch[1] ?? ch[0], frames }
}

/** 24-bit stereo. 16 bits is enough for a finished mix but not for a stem that
 *  will be summed with six others and then gained up. */
export function writeWav24(l, r, sr) {
  const frames = l.length
  const data = Buffer.alloc(frames * 6)
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < 2; c++) {
      const v = clamp(c === 0 ? l[i] : r[i], -1, 0.9999999)
      const n = Math.round(v * 8388607)
      const o = i * 6 + c * 3
      data[o] = n & 0xff; data[o + 1] = (n >> 8) & 0xff; data[o + 2] = (n >> 16) & 0xff
    }
  }
  const head = Buffer.alloc(44)
  head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8)
  head.write('fmt ', 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(2, 22)
  head.writeUInt32LE(sr, 24); head.writeUInt32LE(sr * 6, 28); head.writeUInt16LE(6, 32); head.writeUInt16LE(24, 34)
  head.write('data', 36); head.writeUInt32LE(data.length, 40)
  return Buffer.concat([head, data])
}
