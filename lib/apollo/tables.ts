// Apollo factory wavetables + formula evaluator + Serum-compatible .wav export.

export const WT_LEN = 2048

export interface WavetableData {
  id: string
  name: string
  frames: number
  data: Float32Array // frames * WT_LEN
}

function normalizeFrames(data: Float32Array, frames: number): void {
  for (let f = 0; f < frames; f++) {
    let mx = 0
    for (let i = 0; i < WT_LEN; i++) mx = Math.max(mx, Math.abs(data[f * WT_LEN + i]))
    if (mx > 1e-6) {
      const g = 1 / mx
      for (let i = 0; i < WT_LEN; i++) data[f * WT_LEN + i] *= g
    }
  }
}

// additive synthesis of one frame from harmonic magnitudes (+ optional phases)
function additive(target: Float32Array, offset: number, mags: number[], phases?: number[]): void {
  for (let i = 0; i < WT_LEN; i++) {
    let y = 0
    for (let h = 0; h < mags.length; h++) {
      if (mags[h] === 0) continue
      y += mags[h] * Math.sin(2 * Math.PI * (h + 1) * (i / WT_LEN) + (phases ? phases[h] : 0))
    }
    target[offset + i] = y
  }
}

function gen(frames: number, fn: (x: number, t: number) => number): Float32Array {
  const data = new Float32Array(frames * WT_LEN)
  for (let f = 0; f < frames; f++) {
    const t = frames === 1 ? 0 : f / (frames - 1)
    for (let i = 0; i < WT_LEN; i++) data[f * WT_LEN + i] = fn(i / WT_LEN, t)
  }
  normalizeFrames(data, frames)
  return data
}

function genAdditive(frames: number, fn: (t: number) => number[]): Float32Array {
  const data = new Float32Array(frames * WT_LEN)
  for (let f = 0; f < frames; f++) {
    additive(data, f * WT_LEN, fn(frames === 1 ? 0 : f / (frames - 1)))
  }
  normalizeFrames(data, frames)
  return data
}

const sign = (v: number) => (v >= 0 ? 1 : -1)

export function generateFactoryTable(id: string): WavetableData | null {
  switch (id) {
    case 'basic-shapes': {
      // sine -> triangle -> saw -> square -> pulse
      const shapes = [
        (x: number) => Math.sin(2 * Math.PI * x),
        (x: number) => 1 - 4 * Math.abs(x - 0.5),
        (x: number) => 1 - 2 * x,
        (x: number) => (x < 0.5 ? 1 : -1),
        (x: number) => (x < 0.15 ? 1 : -1),
      ]
      const frames = 64
      const data = gen(frames, (x, t) => {
        const pos = t * (shapes.length - 1)
        const i = Math.min(shapes.length - 2, Math.floor(pos))
        const f = pos - i
        return shapes[i](x) * (1 - f) + shapes[i + 1](x) * f
      })
      return { id, name: 'Basic Shapes', frames, data }
    }
    case 'analog-saws':
      return { id, name: 'Analog Saws', frames: 32, data: genAdditive(32, t => {
        const n = 64
        const mags: number[] = []
        for (let h = 1; h <= n; h++) mags.push((1 / h) * Math.exp(-h * t * 0.12) * (h % 2 === 0 ? 1 - t * 0.5 : 1))
        return mags
      }) }
    case 'pwm':
      return { id, name: 'PWM', frames: 64, data: gen(64, (x, t) => {
        const w = 0.5 - t * 0.45
        return x < w ? 1 : -1
      }) }
    case 'harmonic-sweep':
      return { id, name: 'Harmonic Sweep', frames: 64, data: genAdditive(64, t => {
        const mags = new Array(48).fill(0)
        const center = 1 + t * 30
        for (let h = 1; h <= 48; h++) mags[h - 1] = Math.exp(-Math.pow((h - center) / (2 + t * 3), 2)) + (h === 1 ? 0.4 : 0)
        return mags
      }) }
    case 'organ':
      return { id, name: 'Drawbar Organ', frames: 16, data: genAdditive(16, t => {
        const draw = [1, 0.7 + t * 0.3, 0.4, 0.6 * t, 0.3, 0.5 * t, 0.2 * t, 0.6 * t * t, 0.3 * t]
        const mags = new Array(20).fill(0)
        const harm = [1, 2, 3, 4, 6, 8, 10, 12, 16]
        harm.forEach((h, i) => { if (h <= 20) mags[h - 1] = draw[i] })
        return mags
      }) }
    case 'bells':
      return { id, name: 'Bells', frames: 32, data: gen(32, (x, t) => {
        let y = 0
        const partials = [1, 2.76, 5.4, 8.93, 13.34, 18.64]
        for (let p = 0; p < partials.length; p++) {
          const detune = 1 + t * 0.08 * p
          y += Math.sin(2 * Math.PI * Math.round(partials[p] * detune * 2) / 2 * x) * Math.exp(-p * (0.5 + t))
        }
        return y
      }) }
    case 'vocal':
      return { id, name: 'Vocal', frames: 40, data: genAdditive(40, t => {
        const vowels = [[800, 1150, 2900], [400, 1600, 2700], [350, 1700, 2700], [450, 800, 2830], [325, 700, 2700]]
        const pos = t * (vowels.length - 1)
        const vi = Math.min(vowels.length - 2, Math.floor(pos))
        const vf = pos - vi
        const f0 = 110
        const mags = new Array(60).fill(0)
        for (let h = 1; h <= 60; h++) {
          const freq = h * f0
          let m = 0.08 / h
          for (let fo = 0; fo < 3; fo++) {
            const ff = vowels[vi][fo] * (1 - vf) + vowels[vi + 1][fo] * vf
            m += Math.exp(-Math.pow((freq - ff) / 120, 2)) * (1 - fo * 0.25)
          }
          mags[h - 1] = m
        }
        return mags
      }) }
    case 'fm-scan':
      return { id, name: 'FM Scan', frames: 64, data: gen(64, (x, t) =>
        Math.sin(2 * Math.PI * x + t * 8 * Math.sin(2 * Math.PI * 3 * x))) }
    case 'digital-glitch': {
      const frames = 32
      const data = new Float32Array(frames * WT_LEN)
      let seed = 12345
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
      for (let f = 0; f < frames; f++) {
        const steps = 4 + f * 2
        const vals: number[] = []
        for (let s = 0; s < steps; s++) vals.push(rnd() * 2 - 1)
        for (let i = 0; i < WT_LEN; i++) {
          const s = Math.floor((i / WT_LEN) * steps)
          const base = Math.sin(2 * Math.PI * (i / WT_LEN))
          data[f * WT_LEN + i] = base * 0.3 + vals[s] * 0.7
        }
      }
      normalizeFrames(data, frames)
      return { id, name: 'Digital Glitch', frames, data }
    }
    case 'squares-morph':
      return { id, name: 'Square Morphs', frames: 48, data: gen(48, (x, t) => {
        const y = x < 0.5 ? 1 : -1
        return sign(y) * Math.pow(Math.abs(Math.sin(Math.PI * x)), 1 - t * 0.9)
      }) }
    case 'sub-fold':
      return { id, name: 'Sub Fold', frames: 48, data: gen(48, (x, t) => {
        const s = Math.sin(2 * Math.PI * x) * (1 + t * 6)
        return Math.sin(s) // repeated sine fold
      }) }
    case 'reso-sweep':
      return { id, name: 'Reso Sweep', frames: 64, data: gen(64, (x, t) => {
        const f2 = 2 + Math.floor(t * 24)
        return (1 - 2 * x) * 0.5 + Math.sin(2 * Math.PI * f2 * x) * Math.exp(-x * 3) * 0.9
      }) }
    case 'metallic':
      return { id, name: 'Metallic', frames: 32, data: genAdditive(32, t => {
        const mags = new Array(64).fill(0)
        for (let h = 1; h <= 64; h++) {
          const inharm = Math.abs(Math.sin(h * 2.7 + t * 6))
          mags[h - 1] = inharm > 0.7 ? (1 / Math.sqrt(h)) : 0
        }
        return mags
      }) }
    default: return null
  }
}

export const FACTORY_TABLE_IDS = [
  'basic-shapes', 'analog-saws', 'pwm', 'harmonic-sweep', 'organ', 'bells',
  'vocal', 'fm-scan', 'digital-glitch', 'squares-morph', 'sub-fold', 'reso-sweep', 'metallic',
]

export const FACTORY_TABLE_NAMES: Record<string, string> = {
  'basic-shapes': 'Basic Shapes', 'analog-saws': 'Analog Saws', pwm: 'PWM',
  'harmonic-sweep': 'Harmonic Sweep', organ: 'Drawbar Organ', bells: 'Bells',
  vocal: 'Vocal', 'fm-scan': 'FM Scan', 'digital-glitch': 'Digital Glitch',
  'squares-morph': 'Square Morphs', 'sub-fold': 'Sub Fold', 'reso-sweep': 'Reso Sweep', metallic: 'Metallic',
}

// ---------------------------------------------------------------------------
// Formula parser: safe-ish evaluator for user formulas f(x, t).
// x: phase 0..1, t: frame position 0..1. Returns compiled fn or throws.


export function compileFormula(src: string): (x: number, t: number) => number {
  const cleaned = src.trim()
  if (!cleaned) throw new Error('Empty formula')
  if (cleaned.length > 400) throw new Error('Formula too long')
  // token whitelist check
  const tokens = cleaned.match(/[a-zA-Z_]+|[^a-zA-Z_\s]/g) || []
  const allowedWords = new Set(['x', 't', 'abs', 'sin', 'cos', 'tan', 'atan', 'sqrt', 'pow', 'exp', 'log', 'floor', 'ceil', 'round', 'min', 'max', 'sign', 'pi', 'tri', 'saw', 'sqr', 'noise'])
  for (const tok of tokens) {
    if (/^[a-zA-Z_]+$/.test(tok) && !allowedWords.has(tok)) throw new Error(`Unknown token: ${tok}`)
    if (/^[^a-zA-Z_\s]$/.test(tok) && !'0123456789+-*/%^(),.<>=?:!&|'.includes(tok)) throw new Error(`Bad char: ${tok}`)
  }
  const body = cleaned.replace(/\^/g, '**')
  const fn = new Function('x', 't', `
    'use strict'
    const { abs, sin, cos, tan, atan, sqrt, exp, log, floor, ceil, round, min, max, sign } = Math
    const pow = (a, b) => Math.sign(a) * Math.pow(Math.abs(a), b)
    const pi = Math.PI
    const tri = (p) => 1 - 4 * Math.abs(((p % 1) + 1) % 1 - 0.5)
    const saw = (p) => 2 * (((p % 1) + 1) % 1) - 1
    const sqr = (p) => (((p % 1) + 1) % 1) < 0.5 ? 1 : -1
    let _ns = (x * 12.9898 + t * 78.233) * 43758.5453
    const noise = () => { const v = Math.sin(_ns) * 43758.5453; _ns = v; return (v - Math.floor(v)) * 2 - 1 }
    const r = (${body})
    return Number.isFinite(r) ? r : 0
  `) as (x: number, t: number) => number
  fn(0.3, 0.5) // throws now if malformed
  return fn
}

export function tableFromFormula(src: string, frames = 32): Float32Array {
  const fn = compileFormula(src)
  const data = new Float32Array(frames * WT_LEN)
  for (let f = 0; f < frames; f++) {
    const t = frames === 1 ? 0 : f / (frames - 1)
    for (let i = 0; i < WT_LEN; i++) data[f * WT_LEN + i] = fn(i / WT_LEN, t)
  }
  normalizeFrames(data, frames)
  return data
}

// ---------------------------------------------------------------------------
// Build wavetable frames from an arbitrary audio buffer (slice into cycles).
export function tableFromAudio(samples: Float32Array, frames = 32): Float32Array {
  const data = new Float32Array(frames * WT_LEN)
  const span = samples.length / frames
  for (let f = 0; f < frames; f++) {
    const start = f * span
    for (let i = 0; i < WT_LEN; i++) {
      const pos = start + (i / WT_LEN) * span
      const i0 = Math.floor(pos)
      const fr = pos - i0
      const a = samples[Math.min(i0, samples.length - 1)] || 0
      const b = samples[Math.min(i0 + 1, samples.length - 1)] || 0
      data[f * WT_LEN + i] = a + (b - a) * fr
    }
    // remove DC + fade ends to avoid clicks
    let dc = 0
    for (let i = 0; i < WT_LEN; i++) dc += data[f * WT_LEN + i]
    dc /= WT_LEN
    for (let i = 0; i < WT_LEN; i++) data[f * WT_LEN + i] -= dc
  }
  normalizeFrames(data, frames)
  return data
}

// ---------------------------------------------------------------------------
// Export as Serum-compatible wavetable wav: 32-bit float mono, 'clm ' chunk
// declaring 2048-sample frames.
export function exportWavetableWav(data: Float32Array, sampleRate = 44100): Blob {
  const clm = `<!>2048 01000000 wavetable (apollo)`
  const clmBytes = new TextEncoder().encode(clm)
  const clmPadded = clmBytes.length % 2 ? clmBytes.length + 1 : clmBytes.length
  const dataBytes = data.length * 4
  const total = 12 + (8 + 16) + (8 + clmPadded) + (8 + dataBytes)
  const buf = new ArrayBuffer(8 + total)
  const dv = new DataView(buf)
  let o = 0
  const wstr = (s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)) }
  wstr('RIFF'); dv.setUint32(o, total, true); o += 4; wstr('WAVE')
  wstr('fmt '); dv.setUint32(o, 16, true); o += 4
  dv.setUint16(o, 3, true); o += 2 // IEEE float
  dv.setUint16(o, 1, true); o += 2
  dv.setUint32(o, sampleRate, true); o += 4
  dv.setUint32(o, sampleRate * 4, true); o += 4
  dv.setUint16(o, 4, true); o += 2
  dv.setUint16(o, 32, true); o += 2
  wstr('clm '); dv.setUint32(o, clmPadded, true); o += 4
  for (let i = 0; i < clmBytes.length; i++) dv.setUint8(o++, clmBytes[i])
  if (clmBytes.length % 2) dv.setUint8(o++, 0)
  wstr('data'); dv.setUint32(o, dataBytes, true); o += 4
  for (let i = 0; i < data.length; i++) { dv.setFloat32(o, data[i], true); o += 4 }
  return new Blob([buf], { type: 'audio/wav' })
}

// ---------------------------------------------------------------------------
// Band-limited mip levels. Level k (1..7) keeps 1024>>k harmonics per frame;
// the engine picks the level whose harmonic count fits under Nyquist for the
// playing frequency, killing wavetable aliasing at high notes.

export const MIP_LEVELS = 7

function fftRadix2(re: Float32Array, im: Float32Array, inverse: boolean): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 1 : -1) * 2 * Math.PI / len
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

/** Build MIP_LEVELS band-limited copies of every frame.
 *  Returns Float32Array(MIP_LEVELS * frames * WT_LEN); level k-1 keeps 1024>>k harmonics. */
export function buildTableMips(data: Float32Array, frames: number): Float32Array {
  const out = new Float32Array(MIP_LEVELS * frames * WT_LEN)
  const re = new Float32Array(WT_LEN)
  const im = new Float32Array(WT_LEN)
  const fre = new Float32Array(WT_LEN)
  const fim = new Float32Array(WT_LEN)
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < WT_LEN; i++) { fre[i] = data[f * WT_LEN + i]; fim[i] = 0 }
    fftRadix2(fre, fim, false)
    for (let lvl = 1; lvl <= MIP_LEVELS; lvl++) {
      const keep = 1024 >> lvl // 512, 256, … 8 harmonics
      re.set(fre); im.set(fim)
      for (let b = keep + 1; b <= WT_LEN - keep - 1; b++) { re[b] = 0; im[b] = 0 }
      fftRadix2(re, im, true)
      out.set(re, ((lvl - 1) * frames + f) * WT_LEN)
    }
  }
  return out
}

// base64 helpers for embedding user tables in patches
export function tableToBase64(data: Float32Array): string {
  const u8 = new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  let s = ''
  for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192))
  return btoa(s)
}

export function tableFromBase64(b64: string): Float32Array {
  const bin = atob(b64)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new Float32Array(u8.buffer)
}
