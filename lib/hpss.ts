/**
 * Harmonic/Percussive Source Separation (Fitzgerald 2010, Driedger et al. 2014)
 *
 * Algorithm:
 *   1. STFT → magnitude spectrogram
 *   2. Horizontal median filter (along time, per bin)  → harmonic magnitudes
 *   3. Vertical median filter (along frequency, per frame) → percussive magnitudes
 *   4. Wiener soft masking: M_H = H²/(H²+P²), M_P = P²/(H²+P²)
 *   5. Apply masks to original complex spectrogram → ISTFT + OLA
 *
 * Harmonic output: tonal, pitched content — ideal for synth transformation
 * Percussive output: transients, plosives, consonants — pass through unchanged
 */

const FFT_SIZE  = 2048
const HOP       = 512
const H_HALF    = 12   // time-axis median filter half-width (frames, ~140ms at hop=512/44100)
const P_HALF    = 25   // freq-axis median filter half-width (bins, ~540Hz at 44100/2048)

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

function medianFilter1d(col: Float32Array, halfWin: number): Float32Array {
  const out = new Float32Array(col.length)
  const buf: number[] = []
  for (let i = 0; i < col.length; i++) {
    const lo = Math.max(0, i - halfWin)
    const hi = Math.min(col.length - 1, i + halfWin)
    buf.length = 0
    for (let k = lo; k <= hi; k++) buf.push(col[k])
    buf.sort((a, b) => a - b)
    const m = buf.length >> 1
    out[i] = buf.length & 1 ? buf[m] : (buf[m-1] + buf[m]) * 0.5
  }
  return out
}

export interface HPSSResult {
  harmonic:   AudioBuffer
  percussive: AudioBuffer
}

export async function separateHarmonicPercussive(buf: AudioBuffer): Promise<HPSSResult> {
  const ch  = buf.getChannelData(0)
  const sr  = buf.sampleRate
  const win = hann(FFT_SIZE)
  const numBins = FFT_SIZE >> 1

  // Compute STFT frames
  const offsets: number[] = []
  for (let off = 0; off + FFT_SIZE <= ch.length; off += HOP) offsets.push(off)
  const T = offsets.length

  const specRe  = Array.from({ length: T }, () => new Float32Array(FFT_SIZE))
  const specIm  = Array.from({ length: T }, () => new Float32Array(FFT_SIZE))
  const specMag = Array.from({ length: T }, () => new Float32Array(numBins))

  for (let t = 0; t < T; t++) {
    const re = specRe[t], im = specIm[t], off = offsets[t]
    for (let i = 0; i < FFT_SIZE; i++) { re[i] = (ch[off + i] ?? 0) * win[i]; im[i] = 0 }
    fft(re, im)
    const mag = specMag[t]
    for (let f = 0; f < numBins; f++) mag[f] = Math.sqrt(re[f] ** 2 + im[f] ** 2)
  }

  // Horizontal median filter per bin (time axis) → harmonic estimate
  const hMag = Array.from({ length: T }, () => new Float32Array(numBins))
  const colBuf = new Float32Array(T)
  for (let f = 0; f < numBins; f++) {
    for (let t = 0; t < T; t++) colBuf[t] = specMag[t][f]
    const filt = medianFilter1d(colBuf, H_HALF)
    for (let t = 0; t < T; t++) hMag[t][f] = filt[t]
  }

  // Vertical median filter per frame (freq axis) → percussive estimate
  const pMag = Array.from({ length: T }, () => new Float32Array(numBins))
  for (let t = 0; t < T; t++) { const f = medianFilter1d(specMag[t], P_HALF); for (let i = 0; i < numBins; i++) pMag[t][i] = f[i] }

  // OLA reconstruction with Wiener masks
  const hOut   = new Float32Array(buf.length)
  const pOut   = new Float32Array(buf.length)
  const norm   = new Float32Array(buf.length)

  for (let t = 0; t < T; t++) {
    const hRe = new Float32Array(FFT_SIZE), hIm = new Float32Array(FFT_SIZE)
    const pRe = new Float32Array(FFT_SIZE), pIm = new Float32Array(FFT_SIZE)
    const re = specRe[t], im = specIm[t]

    for (let f = 0; f < numBins; f++) {
      const h2 = hMag[t][f] ** 2, p2 = pMag[t][f] ** 2
      const d = h2 + p2 + 1e-14
      const mH = h2 / d, mP = p2 / d
      hRe[f] = re[f] * mH; hIm[f] = im[f] * mH
      pRe[f] = re[f] * mP; pIm[f] = im[f] * mP
      if (f > 0) {
        const mirror = FFT_SIZE - f
        hRe[mirror] = re[mirror] * mH; hIm[mirror] = im[mirror] * mH
        pRe[mirror] = re[mirror] * mP; pIm[mirror] = im[mirror] * mP
      }
    }

    ifft(hRe, hIm)
    ifft(pRe, pIm)

    const off = offsets[t]
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = off + i
      if (s >= buf.length) break
      const w = win[i]
      hOut[s] += hRe[i] * w
      pOut[s] += pRe[i] * w
      norm[s] += w * w
    }
  }

  // Normalize OLA
  for (let i = 0; i < buf.length; i++) {
    if (norm[i] > 1e-6) { hOut[i] /= norm[i]; pOut[i] /= norm[i] }
  }

  // Copy to AudioBuffers (replicate to all channels)
  const nCh = buf.numberOfChannels
  const harmonic   = new AudioBuffer({ numberOfChannels: nCh, length: buf.length, sampleRate: sr })
  const percussive = new AudioBuffer({ numberOfChannels: nCh, length: buf.length, sampleRate: sr })
  for (let ch = 0; ch < nCh; ch++) { harmonic.getChannelData(ch).set(hOut); percussive.getChannelData(ch).set(pOut) }

  return { harmonic, percussive }
}

/** Mix two same-length AudioBuffers together at equal gain */
export function mixBuffers(a: AudioBuffer, b: AudioBuffer): AudioBuffer {
  const out = new AudioBuffer({ numberOfChannels: a.numberOfChannels, length: a.length, sampleRate: a.sampleRate })
  for (let ch = 0; ch < a.numberOfChannels; ch++) {
    const da = a.getChannelData(ch), db = b.getChannelData(Math.min(ch, b.numberOfChannels - 1))
    const do_ = out.getChannelData(ch)
    for (let i = 0; i < a.length; i++) do_[i] = da[i] + db[i]
  }
  return out
}
