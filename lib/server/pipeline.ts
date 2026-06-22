/**
 * Server-side audio processing pipeline.
 * Pure TypeScript — no Web Audio API, no browser globals.
 * All DSP is implemented directly using Float32Array and biquad math.
 *
 * Mirrors the client-side pipeline:
 *   pitch detect → HPSS → per-band synthesis (7 bands) → spectral smoothing → envelope shaping
 */

// ── Minimal AudioBuffer polyfill ──────────────────────────────────────────

export class AudioBuf {
  sampleRate: number
  numberOfChannels: number
  length: number
  duration: number
  private _ch: Float32Array[]

  constructor({ numberOfChannels, length, sampleRate }: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.sampleRate = sampleRate
    this.numberOfChannels = numberOfChannels
    this.length = length
    this.duration = length / sampleRate
    this._ch = Array.from({ length: numberOfChannels }, () => new Float32Array(length))
  }

  getChannelData(ch: number): Float32Array {
    return this._ch[Math.min(ch, this._ch.length - 1)]
  }

  static fromChannels(channels: Float32Array[], sampleRate: number): AudioBuf {
    const buf = new AudioBuf({ numberOfChannels: channels.length, length: channels[0].length, sampleRate })
    for (let ch = 0; ch < channels.length; ch++) buf.getChannelData(ch).set(channels[ch])
    return buf
  }
}

// ── FFT (Cooley-Tukey, shared by HPSS and spectral smoothing) ─────────────

function hann(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n)
  return w
}

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const cosA = Math.cos(ang), sinA = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0
      const half = len >> 1
      for (let j = 0; j < half; j++) {
        const aR = re[i+j], aI = im[i+j]
        const bR = re[i+j+half]*wr - im[i+j+half]*wi
        const bI = re[i+j+half]*wi + im[i+j+half]*wr
        re[i+j] = aR+bR; im[i+j] = aI+bI
        re[i+j+half] = aR-bR; im[i+j+half] = aI-bI
        const nwr = wr*cosA - wi*sinA; wi = wr*sinA + wi*cosA; wr = nwr
      }
    }
  }
}

function ifft(re: Float32Array, im: Float32Array): void {
  for (let i = 0; i < im.length; i++) im[i] = -im[i]
  fft(re, im)
  const n = re.length
  for (let i = 0; i < n; i++) { re[i] /= n; im[i] = -im[i] / n }
}

// ── Biquad filter (Audio EQ Cookbook, Direct Form II Transposed) ──────────

interface Coeffs { b0: number; b1: number; b2: number; a1: number; a2: number }
interface BqState { z1: number; z2: number }

function mkState(): BqState { return { z1: 0, z2: 0 } }

function biquadPass(data: Float32Array, c: Coeffs, st: BqState): Float32Array {
  const out = new Float32Array(data.length)
  let { z1, z2 } = st
  const { b0, b1, b2, a1, a2 } = c
  for (let i = 0; i < data.length; i++) {
    const x = data[i]
    const y = b0 * x + z1
    z1 = b1 * x - a1 * y + z2
    z2 = b2 * x - a2 * y
    out[i] = y
  }
  st.z1 = z1; st.z2 = z2
  return out
}

function lowpassCoeffs(freq: number, Q: number, sr: number): Coeffs {
  const w0 = 2 * Math.PI * freq / sr
  const cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q)
  const a0 = 1 + alpha
  return { b0: (1 - cw) / 2 / a0, b1: (1 - cw) / a0, b2: (1 - cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - alpha) / a0 }
}

function highpassCoeffs(freq: number, Q: number, sr: number): Coeffs {
  const w0 = 2 * Math.PI * freq / sr
  const cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q)
  const a0 = 1 + alpha
  return { b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - alpha) / a0 }
}

function peakingCoeffs(freq: number, Q: number, gainDb: number, sr: number): Coeffs {
  const A = Math.pow(10, gainDb / 40)
  const w0 = 2 * Math.PI * freq / sr
  const cw = Math.cos(w0), alpha = Math.sin(w0) / (2 * Q)
  const a0 = 1 + alpha / A
  return { b0: (1 + alpha * A) / a0, b1: -2 * cw / a0, b2: (1 - alpha * A) / a0, a1: -2 * cw / a0, a2: (1 - alpha / A) / a0 }
}

// Apply two cascaded filters of the same type (4th-order rolloff)
function cascade2(data: Float32Array, c: Coeffs): Float32Array {
  return biquadPass(biquadPass(data, c, mkState()), c, mkState())
}

// ── Pitch detection (MPM algorithm) ──────────────────────────────────────

export interface PitchFrame { time: number; freq: number | null; amplitude: number; midi: number | null }

function freqToMidi(hz: number) { return Math.round(69 + 12 * Math.log2(hz / 440)) }
function midiToFreq(midi: number) { return 440 * Math.pow(2, (midi - 69) / 12) }

function detectPitchInFrame(frame: Float32Array, sr: number): number | null {
  const n = frame.length, half = n >> 1
  const r = new Float32Array(half), m = new Float32Array(half)
  for (let lag = 0; lag < half; lag++) {
    let sum = 0, sq1 = 0, sq2 = 0
    for (let i = 0; i < half; i++) {
      sum += frame[i] * frame[i + lag]; sq1 += frame[i] ** 2; sq2 += frame[i + lag] ** 2
    }
    r[lag] = sum; m[lag] = (sq1 + sq2) * 0.5
  }
  const nsdf = new Float32Array(half)
  for (let i = 0; i < half; i++) nsdf[i] = m[i] > 0 ? (2 * r[i]) / m[i] : 0
  const THRESH = 0.30
  let d = 1
  while (d < half - 1 && nsdf[d] > 0) d++
  let bestLag = -1, bestVal = -1, prevPos = nsdf[d] > 0
  for (let i = d + 1; i < half - 1; i++) {
    const cur = nsdf[i]
    if (cur > THRESH && cur >= nsdf[i+1] && cur > nsdf[i-1] && !prevPos) {
      if (cur > bestVal) { bestVal = cur; bestLag = i }
    }
    prevPos = cur > 0
  }
  if (bestLag < 2) {
    const minLag = Math.floor(sr / 4000)
    for (let i = Math.max(minLag, 2); i < half - 1; i++) {
      const cur = nsdf[i]
      if (cur > THRESH && cur > nsdf[i-1] && cur >= nsdf[i+1] && cur > bestVal) { bestVal = cur; bestLag = i }
    }
  }
  if (bestLag < 2 || bestVal < THRESH) return null
  const a = nsdf[bestLag-1], b = nsdf[bestLag], c = nsdf[bestLag+1]
  const denom = a - 2*b + c
  const lag = denom !== 0 ? bestLag + 0.5 * (a - c) / denom : bestLag
  const freq = sr / lag
  return freq >= 50 && freq <= 4000 ? freq : null
}

export function detectPitch(buf: AudioBuf, frameSize = 2048, hopSize = 512): PitchFrame[] {
  const raw = buf.getChannelData(0), sr = buf.sampleRate
  const out: PitchFrame[] = []
  for (let off = 0; off + frameSize <= raw.length; off += hopSize) {
    const frame = raw.subarray(off, off + frameSize)
    let sq = 0; for (let i = 0; i < frame.length; i++) sq += frame[i] ** 2
    const amplitude = Math.sqrt(sq / frame.length)
    const freq = amplitude > 0.008 ? detectPitchInFrame(frame as Float32Array, sr) : null
    out.push({ time: off / sr, freq, amplitude: Math.min(1, amplitude * 4), midi: freq ? freqToMidi(freq) : null })
  }
  // Fill isolated null frames
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i].midi === null && out[i-1].midi !== null && out[i+1].midi !== null) {
      const med = Math.round(((out[i-1].midi ?? 0) + (out[i+1].midi ?? 0)) / 2)
      out[i] = { ...out[i], midi: med, freq: midiToFreq(med) }
    }
  }
  return out
}

function freqToCents(hz: number) { return 1200 * Math.log2(hz / 440) }
function centsToFreq(c: number) { return 440 * Math.pow(2, c / 1200) }

export function smoothPitch(curve: PitchFrame[], windowMs = 35): PitchFrame[] {
  if (curve.length < 2) return curve
  const hop = (curve[curve.length-1].time - curve[0].time) / (curve.length - 1) * 1000
  const halfWin = Math.max(1, Math.round(windowMs / 2 / Math.max(hop, 1)))
  const sigma = halfWin / 2.5
  return curve.map((f, i) => {
    if (!f.freq || f.freq <= 0) return f
    let sumC = 0, sumW = 0
    for (let d = -halfWin; d <= halfWin; d++) {
      const o = curve[i + d]
      if (!o || !o.freq || o.freq <= 0) continue
      const w = Math.exp(-0.5 * (d / sigma) ** 2)
      sumC += freqToCents(o.freq) * w; sumW += w
    }
    return sumW > 0 ? { ...f, freq: centsToFreq(sumC / sumW) } : f
  })
}

// ── Note event extraction ─────────────────────────────────────────────────

interface NoteEvent { start: number; end: number; midi: number; amplitude: number }

function extractNotes(curve: PitchFrame[], minDur = 0.04): NoteEvent[] {
  const events: NoteEvent[] = []
  const hopSec = curve.length > 1 ? curve[1].time - curve[0].time : 0.012
  const maxSilence = Math.ceil(0.06 / hopSec)
  let noteStart = -1, noteMidi = -1, ampSum = 0, ampCount = 0, silenceFrames = 0

  const flush = (endTime: number) => {
    if (noteStart >= 0 && endTime - noteStart >= minDur)
      events.push({ start: noteStart, end: endTime, midi: noteMidi, amplitude: Math.min(0.9, ampSum / ampCount * 0.9) })
    noteStart = -1; silenceFrames = 0
  }

  for (const f of curve) {
    if (f.midi !== null) {
      silenceFrames = 0
      if (noteStart < 0) { noteStart = f.time; noteMidi = f.midi; ampSum = 0; ampCount = 0 }
      else if (Math.abs(f.midi - noteMidi) > 1) { flush(f.time); noteStart = f.time; noteMidi = f.midi; ampSum = 0; ampCount = 0 }
      ampSum += f.amplitude; ampCount++
    } else {
      silenceFrames++
      if (noteStart >= 0 && silenceFrames > maxSilence) flush(f.time - silenceFrames * hopSec)
    }
  }
  if (noteStart >= 0 && curve.length > 0) flush(curve[curve.length - 1].time)
  return events
}

// ── HPSS (Harmonic / Percussive Source Separation) ───────────────────────

function medianFilter1d(col: Float32Array, halfWin: number): Float32Array {
  const out = new Float32Array(col.length)
  const buf: number[] = []
  for (let i = 0; i < col.length; i++) {
    const lo = Math.max(0, i - halfWin), hi = Math.min(col.length - 1, i + halfWin)
    buf.length = 0
    for (let k = lo; k <= hi; k++) buf.push(col[k])
    buf.sort((a, b) => a - b)
    const m = buf.length >> 1
    out[i] = buf.length & 1 ? buf[m] : (buf[m-1] + buf[m]) * 0.5
  }
  return out
}

export function hpss(buf: AudioBuf): { harmonic: AudioBuf; percussive: AudioBuf } {
  const FFT_SIZE = 2048, HOP = 512, H_HALF = 12, P_HALF = 25
  const ch = buf.getChannelData(0), sr = buf.sampleRate
  const win = hann(FFT_SIZE), numBins = FFT_SIZE >> 1

  const offsets: number[] = []
  for (let off = 0; off + FFT_SIZE <= ch.length; off += HOP) offsets.push(off)
  const T = offsets.length

  const specRe = Array.from({ length: T }, () => new Float32Array(FFT_SIZE))
  const specIm = Array.from({ length: T }, () => new Float32Array(FFT_SIZE))
  const specMag = Array.from({ length: T }, () => new Float32Array(numBins))

  for (let t = 0; t < T; t++) {
    const re = specRe[t], im = specIm[t], off = offsets[t]
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = (ch[off + i] ?? 0) * win[i]; im[i] = 0 }
    fft(re, im)
    for (let f = 0; f < numBins; f++) specMag[t][f] = Math.sqrt(re[f] ** 2 + im[f] ** 2)
  }

  const hMag = Array.from({ length: T }, () => new Float32Array(numBins))
  const colBuf = new Float32Array(T)
  for (let f = 0; f < numBins; f++) {
    for (let t = 0; t < T; t++) colBuf[t] = specMag[t][f]
    const filt = medianFilter1d(colBuf, H_HALF)
    for (let t = 0; t < T; t++) hMag[t][f] = filt[t]
  }

  const pMag = Array.from({ length: T }, () => new Float32Array(numBins))
  for (let t = 0; t < T; t++) {
    const f = medianFilter1d(specMag[t], P_HALF)
    for (let i = 0; i < numBins; i++) pMag[t][i] = f[i]
  }

  const hOut = new Float32Array(buf.length), pOut = new Float32Array(buf.length), norm = new Float32Array(buf.length)
  for (let t = 0; t < T; t++) {
    const hRe = new Float32Array(FFT_SIZE), hIm = new Float32Array(FFT_SIZE)
    const pRe = new Float32Array(FFT_SIZE), pIm = new Float32Array(FFT_SIZE)
    for (let f = 0; f < numBins; f++) {
      const h2 = hMag[t][f] ** 2, p2 = pMag[t][f] ** 2, d = h2 + p2 + 1e-14
      const mH = h2 / d, mP = p2 / d
      hRe[f] = specRe[t][f] * mH; hIm[f] = specIm[t][f] * mH
      pRe[f] = specRe[t][f] * mP; pIm[f] = specIm[t][f] * mP
      if (f > 0) {
        const mirror = FFT_SIZE - f
        hRe[mirror] = specRe[t][mirror] * mH; hIm[mirror] = specIm[t][mirror] * mH
        pRe[mirror] = specRe[t][mirror] * mP; pIm[mirror] = specIm[t][mirror] * mP
      }
    }
    ifft(hRe, hIm); ifft(pRe, pIm)
    const off = offsets[t]
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = off + i; if (s >= buf.length) break
      hOut[s] += hRe[i] * win[i]; pOut[s] += pRe[i] * win[i]; norm[s] += win[i] * win[i]
    }
  }
  for (let i = 0; i < buf.length; i++) if (norm[i] > 1e-6) { hOut[i] /= norm[i]; pOut[i] /= norm[i] }

  const nCh = buf.numberOfChannels
  const harmonic   = new AudioBuf({ numberOfChannels: nCh, length: buf.length, sampleRate: sr })
  const percussive = new AudioBuf({ numberOfChannels: nCh, length: buf.length, sampleRate: sr })
  for (let c = 0; c < nCh; c++) { harmonic.getChannelData(c).set(hOut); percussive.getChannelData(c).set(pOut) }
  return { harmonic, percussive }
}

// ── Frequency band extraction ─────────────────────────────────────────────

export function extractBand(buf: AudioBuf, lo: number, hi: number): AudioBuf {
  const sr = buf.sampleRate, sr2 = sr / 2, safeHi = Math.min(hi, sr2 - 10)
  const out = new AudioBuf({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: sr })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    let data = new Float32Array(buf.getChannelData(ch))
    if (safeHi < sr2 - 10) data = new Float32Array(cascade2(data, lowpassCoeffs(safeHi, 0.707, sr)))
    if (lo > 20)            data = new Float32Array(cascade2(data, highpassCoeffs(lo, 0.707, sr)))
    out.getChannelData(ch).set(data)
  }
  return out
}

// ── Spectral envelope analysis ────────────────────────────────────────────

function spectralEnvelope(buf: AudioBuf, fftSize = 4096): Float32Array {
  const ch = buf.getChannelData(0), hop = fftSize >> 1, bins = fftSize >> 1
  const avg = new Float32Array(bins)
  let frames = 0
  for (let off = 0; off + fftSize <= ch.length; off += hop) {
    const re = new Float32Array(fftSize), im = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++) re[i] = ch[off + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / fftSize))
    fft(re, im)
    for (let i = 0; i < bins; i++) avg[i] += Math.sqrt(re[i] ** 2 + im[i] ** 2)
    frames++
  }
  if (frames > 0) for (let i = 0; i < bins; i++) avg[i] /= frames
  return avg
}

// ── Synth transformation (server-side biquad version) ─────────────────────

export interface SynthOpts {
  filterCutoff?: number
  pitchShift?: number
  harmProfile?: number[] | null
}

export function transformSynth(src: AudioBuf, curve: PitchFrame[], opts: SynthOpts = {}): AudioBuf {
  const sr = src.sampleRate
  const notes = extractNotes(curve)
  if (notes.length === 0) throw new Error('No pitched notes detected')

  const out = new AudioBuf({ numberOfChannels: src.numberOfChannels, length: src.length, sampleRate: sr })

  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    let data = new Float32Array(src.getChannelData(ch))

    // 1. Arctan saturation — same formula as WaveShaperNode in browser version
    const kSat = 8, pi = Math.PI
    for (let i = 0; i < data.length; i++) {
      data[i] = (pi + kSat) * data[i] / (pi + kSat * Math.abs(data[i]))
    }

    // 2. Per-harmonic peaking EQ (from harmProfile if reference was provided)
    if (opts.harmProfile && opts.harmProfile.length > 1) {
      const profile = opts.harmProfile
      const sorted = notes.slice().sort((a, b) => a.midi - b.midi)
      const medMidi = sorted[Math.floor(sorted.length / 2)].midi + (opts.pitchShift ?? 0)
      const f0 = midiToFreq(medMidi)
      const vMag = spectralEnvelope(src, 4096)
      const binHz = sr / 4096
      const peakVoice = Math.max(...Array.from(vMag)) + 1e-10

      for (let h = 1; h < profile.length; h++) {
        const freq = f0 * h
        if (freq >= sr / 2) break
        if (profile[h] < 0.01) continue
        const centerBin = Math.round(freq / binHz)
        let vSum = 0, vN = 0
        for (let d = -3; d <= 3; d++) {
          const b = centerBin + d
          if (b >= 0 && b < vMag.length) { vSum += vMag[b]; vN++ }
        }
        const voiceAmp = vN > 0 ? (vSum / vN) / peakVoice : 0.5
        const gDb = Math.max(-16, Math.min(16, 20 * Math.log10((profile[h] + 1e-6) / (voiceAmp + 1e-6))))
        if (Math.abs(gDb) < 0.5) continue
        data = new Float32Array(biquadPass(data, peakingCoeffs(freq, 2.5, gDb, sr), mkState()))
      }
    }

    // 3. Lowpass
    const medianNote = notes.slice().sort((a, b) => a.midi - b.midi)[Math.floor(notes.length / 2)]
    const baseCutoff = midiToFreq(medianNote.midi) * 4
    const cutoff = Math.min(opts.filterCutoff ?? baseCutoff, sr / 2 - 100)
    data = new Float32Array(biquadPass(data, lowpassCoeffs(cutoff, 2.5, sr), mkState()))

    // 4. Gain
    for (let i = 0; i < data.length; i++) data[i] *= 0.75

    out.getChannelData(ch).set(data)
  }
  return out
}

// ── Spectral match (server-side biquad version) ───────────────────────────

const BANDS_HZ = [40, 80, 160, 315, 630, 1250, 2500, 5000, 10000, 16000]

export function spectralMatch(converted: AudioBuf, voice: AudioBuf, ref: AudioBuf): AudioBuf {
  const sr = converted.sampleRate
  const fftSize = 2048
  const vMag = spectralEnvelope(voice, fftSize)
  const rMag = spectralEnvelope(ref, fftSize)
  const binHz = sr / fftSize

  const out = new AudioBuf({ numberOfChannels: converted.numberOfChannels, length: converted.length, sampleRate: sr })
  for (let ch = 0; ch < converted.numberOfChannels; ch++) {
    let data = new Float32Array(converted.getChannelData(ch))
    for (const hz of BANDS_HZ) {
      if (hz >= sr / 2) continue
      const bin = Math.round(hz / binHz)
      let vS = 0, rS = 0, n = 0
      for (let d = -3; d <= 3; d++) {
        const b = bin + d
        if (b >= 0 && b < vMag.length) { vS += vMag[b]; rS += rMag[b]; n++ }
      }
      if (!n) continue
      const gDb = Math.max(-14, Math.min(14, 20 * Math.log10((rS + 1e-9) / (vS + 1e-9))))
      if (Math.abs(gDb) < 0.5) continue
      data = new Float32Array(biquadPass(data, peakingCoeffs(hz, 1.2, gDb, sr), mkState()))
    }
    out.getChannelData(ch).set(data)
  }
  return out
}

// ── Spectral temporal smoothing ───────────────────────────────────────────

export function smoothSpectral(buf: AudioBuf, strength = 0.3): AudioBuf {
  const FFT_SIZE = 1024, HOP = 256
  const win = hann(FFT_SIZE), numBins = FFT_SIZE >> 1
  const w0 = 1 - strength, wN = strength / 2

  const outData: Float32Array[] = []
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const raw = buf.getChannelData(ch)
    const offsets: number[] = []
    for (let off = 0; off + FFT_SIZE <= raw.length; off += HOP) offsets.push(off)
    const T = offsets.length
    const specRe = Array.from({ length: T }, () => new Float32Array(FFT_SIZE))
    const specIm = Array.from({ length: T }, () => new Float32Array(FFT_SIZE))

    for (let t = 0; t < T; t++) {
      const re = specRe[t], im = specIm[t], off = offsets[t]
      for (let i = 0; i < FFT_SIZE; i++) { re[i] = (raw[off + i] ?? 0) * win[i]; im[i] = 0 }
      fft(re, im)
    }
    for (let t = 1; t < T - 1; t++) {
      for (let f = 0; f < numBins; f++) {
        const magPrev = Math.hypot(specRe[t-1][f], specIm[t-1][f])
        const magThis = Math.hypot(specRe[t][f],   specIm[t][f])
        const magNext = Math.hypot(specRe[t+1][f], specIm[t+1][f])
        const sm = magPrev * wN + magThis * w0 + magNext * wN
        if (magThis > 1e-10) {
          const scale = sm / magThis
          specRe[t][f] *= scale; specIm[t][f] *= scale
          const mirror = FFT_SIZE - f
          if (mirror !== f && mirror < FFT_SIZE) { specRe[t][mirror] *= scale; specIm[t][mirror] *= scale }
        }
      }
    }
    const out = new Float32Array(buf.length), norm = new Float32Array(buf.length)
    for (let t = 0; t < T; t++) {
      ifft(specRe[t], specIm[t])
      const off = offsets[t]
      for (let i = 0; i < FFT_SIZE; i++) {
        const s = off + i; if (s >= buf.length) break
        out[s] += specRe[t][i] * win[i]; norm[s] += win[i] * win[i]
      }
    }
    for (let i = 0; i < buf.length; i++) if (norm[i] > 1e-6) out[i] /= norm[i]
    outData.push(out)
  }

  return AudioBuf.fromChannels(outData, buf.sampleRate)
}

// ── Reference envelope shaping ────────────────────────────────────────────

function rmsEnv(buf: AudioBuf, hopMs = 5): number[] {
  const sr = buf.sampleRate, hop = Math.round(hopMs / 1000 * sr), ch = buf.getChannelData(0)
  const n = Math.ceil(ch.length / hop), env: number[] = []
  let peak = 0
  for (let i = 0; i < n; i++) {
    const s = i * hop, e = Math.min(s + hop, ch.length)
    let rms = 0; for (let j = s; j < e; j++) rms += ch[j] ** 2
    const v = Math.sqrt(rms / (e - s)); env.push(v); peak = Math.max(peak, v)
  }
  return peak > 1e-8 ? env.map(v => v / peak) : env
}

function analyzeAR(refBuf: AudioBuf): { attackMs: number; releaseMs: number } {
  const env = rmsEnv(refBuf)
  let attackFrames = 1
  for (let i = 0; i < env.length; i++) { if (env[i] >= 0.9) { attackFrames = i + 1; break }; attackFrames = i + 1 }
  let releaseFrames = 10
  for (let i = env.length - 1; i >= 0; i--) { if (env[i] >= 0.9) { releaseFrames = env.length - i; break } }
  return { attackMs: Math.max(5, Math.min(attackFrames * 5, 800)), releaseMs: Math.max(30, Math.min(releaseFrames * 5, 2000)) }
}

export function shapeEnvelope(buf: AudioBuf, refBuf: AudioBuf, notes: { start: number; end: number }[]): AudioBuf {
  if (notes.length === 0) return buf
  const sr = buf.sampleRate
  const { attackMs, releaseMs } = analyzeAR(refBuf)
  const attackSec = attackMs / 1000, releaseSec = releaseMs / 1000

  const gain = new Float32Array(buf.length).fill(1)

  for (let ni = 0; ni < notes.length; ni++) {
    const note = notes[ni], prev = notes[ni - 1], next = notes[ni + 1]
    const gapBefore = prev ? note.start - prev.end : note.start
    const gapAfter  = next ? next.start - note.end  : 1.0
    const noteStart = Math.max(0, Math.round(note.start * sr))
    const noteEnd   = Math.min(buf.length, Math.round(note.end * sr))
    const noteDur   = noteEnd - noteStart

    if (gapBefore > 0.02) {
      const attackSamples = Math.min(Math.round(attackSec * sr), Math.floor(noteDur * 0.4))
      for (let i = 0; i < attackSamples; i++) {
        const g = Math.sin((i / attackSamples) * Math.PI / 2) ** 2  // sinusoidal ramp (smooth)
        const pos = noteStart + i; if (pos < gain.length) gain[pos] = Math.min(gain[pos], g)
      }
    }
    if (gapAfter > 0.02) {
      const releaseSamples = Math.min(Math.round(releaseSec * 0.5 * sr), Math.floor(noteDur * 0.4))
      const rStart = Math.max(noteStart, noteEnd - releaseSamples)
      for (let i = 0; i < noteEnd - rStart; i++) {
        const g = Math.cos((i / (noteEnd - rStart)) * Math.PI / 2) ** 2
        const pos = rStart + i; if (pos < gain.length) gain[pos] = Math.min(gain[pos], g)
      }
    }
  }

  // Smooth the gain envelope (50-sample moving average) to prevent zipper noise
  const smoothGain = new Float32Array(gain.length)
  const W = 50
  let sum = 0
  for (let i = 0; i < Math.min(W, gain.length); i++) sum += gain[i]
  for (let i = 0; i < gain.length; i++) {
    smoothGain[i] = sum / Math.min(W, gain.length)
    if (i + W < gain.length) sum += gain[i + W]
    if (i >= W) sum -= gain[i - W]
  }

  const out = new AudioBuf({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: sr })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch), dst = out.getChannelData(ch)
    for (let i = 0; i < buf.length; i++) dst[i] = src[i] * smoothGain[i]
  }
  return out
}

// ── Mix helpers ───────────────────────────────────────────────────────────

export function sumBufs(bufs: AudioBuf[]): AudioBuf {
  const first = bufs[0]
  const out = new AudioBuf({ numberOfChannels: first.numberOfChannels, length: first.length, sampleRate: first.sampleRate })
  for (let ch = 0; ch < first.numberOfChannels; ch++) {
    const dst = out.getChannelData(ch)
    for (const b of bufs) {
      const s = b.getChannelData(Math.min(ch, b.numberOfChannels - 1))
      for (let i = 0; i < dst.length; i++) dst[i] += s[i]
    }
  }
  return out
}

export function mixBufs(a: AudioBuf, b: AudioBuf): AudioBuf {
  const out = new AudioBuf({ numberOfChannels: a.numberOfChannels, length: a.length, sampleRate: a.sampleRate })
  for (let ch = 0; ch < a.numberOfChannels; ch++) {
    const da = a.getChannelData(ch), db = b.getChannelData(Math.min(ch, b.numberOfChannels - 1)), do_ = out.getChannelData(ch)
    for (let i = 0; i < a.length; i++) do_[i] = da[i] + db[i]
  }
  return out
}

// ── Utility helpers ───────────────────────────────────────────────────────

function rmsOf(buf: AudioBuf): number {
  const ch = buf.getChannelData(0)
  let sum = 0
  for (let i = 0; i < ch.length; i++) sum += ch[i] ** 2
  return Math.sqrt(sum / Math.max(ch.length, 1))
}

function trimBuf(buf: AudioBuf, len: number): AudioBuf {
  const out = new AudioBuf({ numberOfChannels: buf.numberOfChannels, length: len, sampleRate: buf.sampleRate })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buf.getChannelData(ch).subarray(0, len))
  }
  return out
}

function scaleBuf(buf: AudioBuf, gain: number): AudioBuf {
  const out = new AudioBuf({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch), dst = out.getChannelData(ch)
    for (let i = 0; i < src.length; i++) dst[i] = src[i] * gain
  }
  return out
}

// ── Frequency band definitions (must match client-side FREQ_BANDS) ─────────

export const FREQ_BANDS = [
  { id: 'sub',      lo: 20,   hi: 80    },
  { id: 'bass',     lo: 80,   hi: 250   },
  { id: 'lowmid',   lo: 250,  hi: 500   },
  { id: 'mid',      lo: 500,  hi: 2000  },
  { id: 'himid',    lo: 2000, hi: 4000  },
  { id: 'presence', lo: 4000, hi: 8000  },
  { id: 'air',      lo: 8000, hi: 22050 },
]

// ── Full pipeline ─────────────────────────────────────────────────────────

export interface PipelineOpts {
  harmProfile?: number[] | null
  filterCutoff?: number
  pitchShift?: number
}

export function runPipeline(srcBuf: AudioBuf, refBuf: AudioBuf | null, opts: PipelineOpts): AudioBuf {
  // 1. Pitch detection + smoothing
  const rawCurve = detectPitch(srcBuf)
  const curve    = smoothPitch(rawCurve)
  const notes    = extractNotes(curve)

  // 2. HPSS
  const { harmonic, percussive } = hpss(srcBuf)

  // 3. Per-band synthesis
  const synthOpts: SynthOpts = { harmProfile: opts.harmProfile, filterCutoff: opts.filterCutoff, pitchShift: opts.pitchShift }
  const bands: AudioBuf[] = FREQ_BANDS.map(({ lo, hi }) => {
    const band = extractBand(harmonic, lo, hi)
    return transformSynth(band, curve, synthOpts)
  })

  // 4. Sum bands + spectral smoothing
  let converted = smoothSpectral(sumBufs(bands))

  // 5. Reference envelope shaping
  if (refBuf) {
    converted = shapeEnvelope(converted, refBuf, notes.map(n => ({ start: n.start, end: n.end })))
  }

  // 6. Spectral match to reference
  if (refBuf) {
    converted = spectralMatch(converted, harmonic, refBuf)
  }

  // 7. Mix with percussive layer
  return mixBufs(converted, percussive)
}

// ── Two-way match pipeline ────────────────────────────────────────────────
// Converts vocal toward the target's timbre, then fills in any frequency
// bands where the target has content the converted voice doesn't reach.
// strength: overall gain of the converted voice (0–1)
// gapFill:  how aggressively to blend target content into missing bands (0–1)

export interface MatchOpts { strength?: number; gapFill?: number }

export function runMatchPipeline(vocalBuf: AudioBuf, targetBuf: AudioBuf, opts: MatchOpts): AudioBuf {
  const strength = opts.strength ?? 0.8
  const gapFill  = opts.gapFill  ?? 0.4

  // Align to shortest length so every operation is sample-accurate
  const matchLen = Math.min(vocalBuf.length, targetBuf.length)
  const vocal    = matchLen < vocalBuf.length  ? trimBuf(vocalBuf,  matchLen) : vocalBuf
  const target   = matchLen < targetBuf.length ? trimBuf(targetBuf, matchLen) : targetBuf

  // Full synth conversion using target as timbral reference
  const converted = runPipeline(vocal, target, {})

  // Per-band gap fill: add target content in bands where converted voice falls short
  const bandOutputs: AudioBuf[] = [scaleBuf(converted, strength)]
  for (const { lo, hi } of FREQ_BANDS) {
    const convBand = extractBand(converted, lo, hi)
    const targBand = extractBand(target,    lo, hi)
    const targRms  = rmsOf(targBand)
    if (targRms < 1e-6) continue
    const gap      = Math.max(0, (targRms - rmsOf(convBand)) / targRms)
    const fillGain = gap * gapFill
    if (fillGain > 0.02) bandOutputs.push(scaleBuf(targBand, fillGain))
  }

  return sumBufs(bandOutputs)
}
