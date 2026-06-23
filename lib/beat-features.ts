/**
 * Perceptual audio feature extraction — one call per detected hit.
 * All features are computed from a sample window around the hit onset using
 * a single FFT pass (no OfflineAudioContext renders needed).
 *
 * Implements every dimension listed in the beat-analyzer.ts roadmap note:
 * spectral shape, MFCCs, temporal envelope, pitch/harmonics, dynamics,
 * and psychoacoustic approximations.
 */

// ── Constants ─────────────────────────────────────────────────────────────────

const FFT_N      = 2048  // ~46 ms window @ 44.1 kHz; frequency resolution ≈ 21.5 Hz/bin
const MEL_BANDS  = 26    // mel filterbank bands
const MFCC_N     = 13    // cepstral coefficients (0 = log-energy, 1–12 = timbre shape)

// ── Full perceptual fingerprint stored per hit ────────────────────────────────

export interface HitSpectral {
  // ── 5-band energy ratios (normalized 0–1) — core classification features ──
  sub:    number   // 0–150 Hz
  lowMid: number   // 150–600 Hz  (beatbox kicks peak here)
  mid:    number   // 600–3 kHz   (snares, claps)
  hiMid:  number   // 3–8 kHz     (hi-hats, snare crack)
  hi:     number   // 8 kHz+      (hi-hats, sibilants)

  // ── Spectral shape (from FFT magnitude spectrum) ──────────────────────────
  centroid: number   // Hz — spectral center of mass; perceived brightness
  spread:   number   // Hz — std-dev of energy around centroid; tonal focus
  rolloff:  number   // Hz — frequency below which 85 % of energy sits
  flatness: number   // 0 = pure sine, 1 = white noise (geo/arith mean ratio)
  flux:     number   // 0–1 — normalized change vs previous hit's spectrum

  // ── MFCCs — 13 mel-frequency cepstral coefficients ───────────────────────
  // Gold standard for timbre fingerprinting. Coefficient 0 = log energy;
  // 1–12 encode timbral shape compactly. Used for instrument recognition.
  mfcc: readonly number[]

  // ── Temporal envelope (ADSR-style) ───────────────────────────────────────
  attackTime:       number   // seconds from onset to peak amplitude
  decayTime:        number   // seconds from peak to 1/3 of peak
  sustainLevel:     number   // 0–1 amplitude ratio at 60 ms post-onset
  releaseTime:      number   // seconds from sustain point to < 5 % peak
  zeroCrossingRate: number   // sign changes per second (noisiness indicator)

  // ── Pitch and harmonic structure ──────────────────────────────────────────
  f0:              number   // Hz — fundamental frequency (0 if unpitched)
  pitchConfidence: number   // 0–1 — clarity of pitch; low = noise-like
  harmonicRatio:   number   // 0 = pure noise, 1 = pure harmonic tone

  // ── Dynamics ──────────────────────────────────────────────────────────────
  peakAmplitude: number   // 0–1 peak sample magnitude in the hit window
  rmsAmplitude:  number   // 0–1 RMS over the hit window
  dynamicRange:  number   // dB — 20·log10(peak/rms); measures transient sharpness

  // ── Psychoacoustic approximations ────────────────────────────────────────
  brightness: number   // 0–1 energy above 3 kHz / total (perceived airiness)
  warmth:     number   // 0–1 energy below 300 Hz / total (low-end body)
  presence:   number   // 0–1 energy 2–5 kHz / total (forward, punchy quality)
  roughness:  number   // 0–1 amplitude modulation rate (buzz, wire noise, etc.)
}

// ── Mel-scale helpers ─────────────────────────────────────────────────────────

function hzToMel(hz: number) { return 2595 * Math.log10(1 + hz / 700) }
function melToHz(mel: number) { return 700 * (10 ** (mel / 2595) - 1) }

// ── Mel filterbank (cached per sample-rate) ───────────────────────────────────

let fbCache: { sr: number; filters: Float32Array[] } | null = null

function getMelFilterbank(sr: number): Float32Array[] {
  if (fbCache?.sr === sr) return fbCache.filters

  const nyquist  = sr / 2
  const melLow   = hzToMel(80)
  const melHigh  = hzToMel(Math.min(nyquist, 16000))
  const nPts     = MEL_BANDS + 2
  const melPts   = Array.from({ length: nPts }, (_, i) =>
    melLow + (melHigh - melLow) * i / (nPts - 1)
  )
  const hzPts  = melPts.map(melToHz)
  const binPts = hzPts.map(hz => Math.round(hz * FFT_N / sr))
  const half   = FFT_N / 2

  const filters = Array.from({ length: MEL_BANDS }, (_, m) => {
    const f = new Float32Array(half)
    for (let k = 0; k < half; k++) {
      if (k > binPts[m] && k <= binPts[m + 1]) {
        f[k] = (k - binPts[m]) / Math.max(1, binPts[m + 1] - binPts[m])
      } else if (k > binPts[m + 1] && k < binPts[m + 2]) {
        f[k] = (binPts[m + 2] - k) / Math.max(1, binPts[m + 2] - binPts[m + 1])
      }
    }
    return f
  })

  fbCache = { sr, filters }
  return filters
}

// ── Radix-2 Cooley-Tukey FFT (in-place, real input via zero imaginary) ────────

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
    const wRe = Math.cos(ang), wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cRe = 1, cIm = 0
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = i + k + (len >> 1)
        const vRe = re[b] * cRe - im[b] * cIm
        const vIm = re[b] * cIm + im[b] * cRe
        re[b] = re[a] - vRe; im[b] = im[a] - vIm
        re[a] += vRe;        im[a] += vIm
        const nr = cRe * wRe - cIm * wIm
        cIm     = cRe * wIm + cIm * wRe
        cRe     = nr
      }
    }
  }
}

// ── Extract Hann-windowed magnitude spectrum from a sample offset ─────────────

export function getSpectrum(raw: Float32Array, startSample: number): Float32Array {
  const re = new Float32Array(FFT_N)
  const im = new Float32Array(FFT_N)
  for (let i = 0; i < FFT_N; i++) {
    const si = startSample + i
    const s  = (si >= 0 && si < raw.length) ? raw[si] : 0
    const w  = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_N - 1)))
    re[i]    = s * w
  }
  fft(re, im)
  const mag = new Float32Array(FFT_N / 2)
  for (let i = 0; i < FFT_N / 2; i++) {
    mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i])
  }
  return mag
}

// ── DCT-II (standard for MFCCs) ───────────────────────────────────────────────

function dctII(x: Float32Array): number[] {
  const n = x.length
  return Array.from({ length: MFCC_N }, (_, k) => {
    const norm = k === 0 ? Math.sqrt(1 / n) : Math.sqrt(2 / n)
    let sum = 0
    for (let i = 0; i < n; i++) {
      sum += x[i] * Math.cos((Math.PI * k * (2 * i + 1)) / (2 * n))
    }
    return sum * norm
  })
}

// ── Spectral features ─────────────────────────────────────────────────────────

interface SpectralFeats {
  sub: number; lowMid: number; mid: number; hiMid: number; hi: number
  centroid: number; spread: number; rolloff: number; flatness: number
  mfcc: number[]
  brightness: number; warmth: number; presence: number
}

function spectralFeatures(mag: Float32Array, sr: number): SpectralFeats {
  const half   = mag.length           // = FFT_N/2
  const binHz  = sr / FFT_N           // Hz per bin

  let totalE = 0, weightedF = 0, totalPow = 0
  for (let k = 0; k < half; k++) {
    totalE    += mag[k]
    weightedF += k * binHz * mag[k]
    totalPow  += mag[k] * mag[k]
  }
  const centroid = totalE > 0 ? weightedF / totalE : 0

  let spreadNum = 0
  for (let k = 0; k < half; k++) {
    spreadNum += (k * binHz - centroid) ** 2 * mag[k]
  }
  const spread = totalE > 0 ? Math.sqrt(spreadNum / totalE) : 0

  // 85 % cumulative power rolloff
  const rollTarget = totalPow * 0.85
  let cumPow = 0, rolloffBin = half - 1
  for (let k = 0; k < half; k++) {
    cumPow += mag[k] * mag[k]
    if (cumPow >= rollTarget) { rolloffBin = k; break }
  }
  const rolloff = rolloffBin * binHz

  // Spectral flatness: geometric mean / arithmetic mean
  let logSum = 0, logCount = 0
  for (let k = 1; k < half; k++) {
    if (mag[k] > 1e-10) { logSum += Math.log(mag[k]); logCount++ }
  }
  const geoMean  = logCount > 0 ? Math.exp(logSum / logCount) : 0
  const arithMean = totalE / half
  const flatness  = arithMean > 1e-10 ? Math.min(1, geoMean / arithMean) : 0

  // MFCCs via mel filterbank → log → DCT
  const filters    = getMelFilterbank(sr)
  const melLog     = new Float32Array(MEL_BANDS)
  for (let m = 0; m < MEL_BANDS; m++) {
    let e = 0
    for (let k = 0; k < half; k++) e += mag[k] * filters[m][k]
    melLog[m] = Math.log(Math.max(1e-10, e))
  }
  const mfcc = dctII(melLog)

  // 5-band energy ratios directly from FFT bins
  const subLim    = Math.floor(150  / binHz)
  const loMidLim  = Math.floor(600  / binHz)
  const midLim    = Math.floor(3000 / binHz)
  const hiMidLim  = Math.floor(8000 / binHz)
  let subE = 0, loMidE = 0, midE = 0, hiMidE = 0, hiE = 0
  for (let k = 0; k < half; k++) {
    if      (k < subLim)   subE   += mag[k]
    else if (k < loMidLim) loMidE += mag[k]
    else if (k < midLim)   midE   += mag[k]
    else if (k < hiMidLim) hiMidE += mag[k]
    else                   hiE    += mag[k]
  }
  const bandTotal = subE + loMidE + midE + hiMidE + hiE || 1

  // Psychoacoustic band slices
  const warmLim  = Math.floor(300  / binHz)
  const presLo   = Math.floor(2000 / binHz)
  const presHi   = Math.floor(5000 / binHz)
  const briLim   = Math.floor(3000 / binHz)
  let warmE = 0, presE = 0, briE = 0
  for (let k = 0; k < half; k++) {
    if (k < warmLim)               warmE += mag[k]
    if (k >= presLo && k < presHi) presE += mag[k]
    if (k >= briLim)               briE  += mag[k]
  }

  return {
    sub:    subE   / bandTotal, lowMid: loMidE / bandTotal,
    mid:    midE   / bandTotal, hiMid:  hiMidE / bandTotal, hi: hiE / bandTotal,
    centroid, spread, rolloff, flatness, mfcc,
    brightness: totalE > 0 ? briE  / totalE : 0,
    warmth:     totalE > 0 ? warmE / totalE : 0,
    presence:   totalE > 0 ? presE / totalE : 0,
  }
}

// ── Temporal envelope (ADSR + ZCR + dynamics + roughness) ────────────────────

interface TemporalFeats {
  attackTime: number; decayTime: number; sustainLevel: number; releaseTime: number
  zeroCrossingRate: number
  peakAmplitude: number; rmsAmplitude: number; dynamicRange: number
  roughness: number
}

function temporalFeatures(raw: Float32Array, startSample: number, sr: number, maxSamples?: number): TemporalFeats {
  // Analyse up to the next onset (or 500 ms, whichever is shorter).
  // Without this cap, a 500 ms window bleeds into the next hit and makes identical
  // sounds look spectrally different based on what follows them — "bum pss" vs "pss bum".
  const capSamples = maxSamples != null ? Math.min(maxSamples, Math.floor(sr * 0.5)) : Math.floor(sr * 0.5)
  const winLen = Math.min(capSamples, raw.length - startSample)
  if (winLen <= 0) {
    return { attackTime: 0, decayTime: 0, sustainLevel: 0, releaseTime: 0,
             zeroCrossingRate: 0, peakAmplitude: 0, rmsAmplitude: 0,
             dynamicRange: 0, roughness: 0 }
  }

  // 2 ms envelope frames
  const frameSmp  = Math.max(1, Math.floor(sr * 0.002))
  const nFrames   = Math.floor(winLen / frameSmp)
  const envelope  = new Float32Array(nFrames)

  let peakAmp = 0, sumSq = 0, zcr = 0, prevSign = 0
  for (let f = 0; f < nFrames; f++) {
    let fMax = 0
    for (let i = 0; i < frameSmp; i++) {
      const si  = startSample + f * frameSmp + i
      if (si >= raw.length) break
      const s   = raw[si]
      const abs = Math.abs(s)
      if (abs > fMax)   fMax  = abs
      if (abs > peakAmp) peakAmp = abs
      sumSq += s * s
      const sign = s >= 0 ? 1 : -1
      if (prevSign !== 0 && sign !== prevSign) zcr++
      prevSign = sign
    }
    envelope[f] = fMax
  }
  const rmsAmplitude   = Math.sqrt(sumSq / winLen)
  const dynamicRange   = peakAmp > 1e-10 && rmsAmplitude > 1e-10
    ? 20 * Math.log10(peakAmp / rmsAmplitude)
    : 0
  const zeroCrossingRate = zcr / (winLen / sr)

  // Attack: time to peak within first 100 ms
  const atkLimit  = Math.min(nFrames, Math.floor(0.1 / 0.002))
  let peakFrame   = 0, peakVal = 0
  for (let f = 0; f < atkLimit; f++) {
    if (envelope[f] > peakVal) { peakVal = envelope[f]; peakFrame = f }
  }
  const attackTime = peakFrame * 0.002

  // Decay: time from peak to 1/3 of peak
  const decayTarget = peakVal / 3
  let decayFrame    = peakFrame
  for (let f = peakFrame; f < nFrames; f++) {
    if (envelope[f] <= decayTarget) { decayFrame = f; break }
  }
  const decayTime = Math.max(0, decayFrame - peakFrame) * 0.002

  // Sustain level: normalized amplitude at 60 ms post-onset
  const sustainFrame  = Math.min(nFrames - 1, Math.floor(0.06 / 0.002))
  const sustainLevel  = peakVal > 1e-10 ? envelope[sustainFrame] / peakVal : 0

  // Release: from sustain frame until < 5 % of peak
  const relTarget  = peakVal * 0.05
  let releaseFrame = sustainFrame
  for (let f = sustainFrame; f < nFrames; f++) {
    if (envelope[f] <= relTarget) { releaseFrame = f; break }
  }
  const releaseTime = (releaseFrame - sustainFrame) * 0.002

  // Roughness: coefficient of variation of envelope in first 100 ms
  // High roughness = fast amplitude modulation (snare wire buzz, clap layers, etc.)
  const roughFrames = Math.min(nFrames, atkLimit * 2)
  let roughMean = 0
  for (let f = 0; f < roughFrames; f++) roughMean += envelope[f]
  roughMean /= roughFrames || 1
  let roughVar = 0
  for (let f = 0; f < roughFrames; f++) roughVar += (envelope[f] - roughMean) ** 2
  roughVar /= roughFrames || 1
  const roughness = roughMean > 1e-10 ? Math.min(1, Math.sqrt(roughVar) / roughMean) : 0

  return { attackTime, decayTime, sustainLevel, releaseTime,
           zeroCrossingRate, peakAmplitude: peakAmp, rmsAmplitude, dynamicRange, roughness }
}

// ── Pitch via normalized autocorrelation + harmonic ratio from FFT ────────────

interface PitchFeats {
  f0: number; pitchConfidence: number; harmonicRatio: number
}

function pitchFeatures(raw: Float32Array, startSample: number, sr: number, mag: Float32Array): PitchFeats {
  // 20 ms pitch window — good resolution, fast enough for per-hit use
  const winLen = Math.min(Math.floor(sr * 0.02), raw.length - startSample)
  if (winLen < 64) return { f0: 0, pitchConfidence: 0, harmonicRatio: 0 }

  const minLag = Math.floor(sr / 1000)  // ≤ 1000 Hz
  const maxLag = Math.min(Math.floor(sr / 60), winLen - 1)  // ≥ 60 Hz

  // Normalized cross-correlation (NSDF-style)
  let bestCorr = 0, bestLag = 0
  for (let lag = minLag; lag <= maxLag; lag += 2) {
    const frames = winLen - lag
    let num = 0, e1 = 0, e2 = 0
    for (let i = 0; i < frames; i++) {
      const a = raw[startSample + i], b = raw[startSample + i + lag]
      num += a * b; e1 += a * a; e2 += b * b
    }
    const corr = e1 > 0 && e2 > 0 ? num / Math.sqrt(e1 * e2) : 0
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag }
  }

  if (bestLag === 0 || bestCorr < 0.35) return { f0: 0, pitchConfidence: 0, harmonicRatio: 0 }

  const f0              = sr / bestLag
  const pitchConfidence = Math.min(1, bestCorr)

  // Harmonic ratio: energy at first 8 harmonics vs total spectral energy
  const binHz = sr / FFT_N
  const half  = mag.length
  let totalE = 0, harmE = 0
  for (let k = 0; k < half; k++) totalE += mag[k]
  for (let h = 1; h <= 8; h++) {
    const hFreq  = f0 * h
    if (hFreq >= sr / 2) break
    const center = Math.round(hFreq / binHz)
    const width  = Math.max(1, Math.round(center * 0.08))
    for (let k = Math.max(0, center - width); k <= Math.min(half - 1, center + width); k++) {
      harmE += mag[k]
    }
  }
  const harmonicRatio = totalE > 1e-10 ? Math.min(1, harmE / totalE) : 0

  return { f0, pitchConfidence, harmonicRatio }
}

// ── Spectral flux vs previous hit ────────────────────────────────────────────

function spectralFlux(mag: Float32Array, prev: Float32Array | null): number {
  if (!prev) return 0
  const n = mag.length
  let sumA = 0, sumB = 0
  for (let k = 0; k < n; k++) { sumA += mag[k]; sumB += prev[k] }
  if (sumA < 1e-10) return 0
  let flux = 0
  for (let k = 0; k < n; k++) {
    const a = mag[k] / sumA
    const b = sumB > 1e-10 ? prev[k] / sumB : 0
    flux += (a - b) ** 2
  }
  // Scale to roughly 0–1 (most pairs land in 0–0.01 range pre-scale)
  return Math.min(1, Math.sqrt(flux / n) * 100)
}

// ── Hi-hat / crash sustain detection (replaces rmsWindow on highBand) ────────
// Returns true when high-frequency energy at 60 ms is still a significant
// fraction of the attack energy — characteristic of open hats and cymbals.

function isHighSustained(raw: Float32Array, sampleIdx: number, sr: number): boolean {
  const sustainSample = Math.min(raw.length - FFT_N, sampleIdx + Math.floor(sr * 0.06))
  const atkMag  = getSpectrum(raw, Math.max(0, sampleIdx))
  const susMag  = getSpectrum(raw, Math.max(0, sustainSample))
  const hiBin   = Math.floor(8000 / (sr / FFT_N))
  const half    = atkMag.length

  let atkHi = 0, atkTot = 0, susHi = 0, susTot = 0
  for (let k = 0; k < half; k++) {
    atkTot += atkMag[k]; susTot += susMag[k]
    if (k >= hiBin) { atkHi += atkMag[k]; susHi += susMag[k] }
  }
  const atkNorm = atkTot > 0 ? atkHi / atkTot : 0
  const susNorm = susTot > 0 ? susHi / susTot : 0
  return atkNorm > 0.05 && susNorm > atkNorm * 0.28
}

// ── Main entry point ──────────────────────────────────────────────────────────

export interface HitFeaturesResult {
  spectral:     HitSpectral
  spectrum:     Float32Array   // raw magnitude spectrum — pass as prevSpectrum for next hit's flux
  highSustained: boolean       // used by classification to distinguish open-hat / crash from hihat
}

export function computeHitFeatures(
  raw:             Float32Array,
  sampleIdx:       number,
  sr:              number,
  prevSpectrum:    Float32Array | null = null,
  nextOnsetSample: number | null = null,  // distance cap: prevents feature bleed from adjacent hits
): HitFeaturesResult {
  // Begin the window 5 ms before onset to capture the leading transient edge
  const startSample = Math.max(0, sampleIdx - Math.floor(sr * 0.005))
  // Cap temporal analysis at the next onset so features don't capture the following sound
  const maxSamples = nextOnsetSample != null ? nextOnsetSample - startSample : undefined

  const spectrum = getSpectrum(raw, startSample)
  const sf = spectralFeatures(spectrum, sr)
  const tf = temporalFeatures(raw, startSample, sr, maxSamples)
  const pf = pitchFeatures(raw, startSample, sr, spectrum)
  const flux = spectralFlux(spectrum, prevSpectrum)
  const highSustained = isHighSustained(raw, sampleIdx, sr)

  const spectral: HitSpectral = {
    sub: sf.sub, lowMid: sf.lowMid, mid: sf.mid, hiMid: sf.hiMid, hi: sf.hi,
    centroid: sf.centroid, spread: sf.spread, rolloff: sf.rolloff,
    flatness: sf.flatness, flux,
    mfcc: sf.mfcc,
    attackTime: tf.attackTime, decayTime: tf.decayTime,
    sustainLevel: tf.sustainLevel, releaseTime: tf.releaseTime,
    zeroCrossingRate: tf.zeroCrossingRate,
    f0: pf.f0, pitchConfidence: pf.pitchConfidence, harmonicRatio: pf.harmonicRatio,
    peakAmplitude: tf.peakAmplitude, rmsAmplitude: tf.rmsAmplitude,
    dynamicRange: tf.dynamicRange,
    brightness: sf.brightness, warmth: sf.warmth, presence: sf.presence,
    roughness: tf.roughness,
  }

  return { spectral, spectrum, highSustained }
}
