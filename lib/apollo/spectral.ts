// Apollo spectral oscillator pre-analysis: STFT the sample into magnitude
// frames (+ phases for transient reset, onset flags via spectral flux).
// Runs on the main thread in yielded chunks to stay responsive.

const FFT_SIZE = 2048
const HOP = 512
const BINS = FFT_SIZE / 2 + 1

export interface SpectralAnalysis {
  frames: number
  bins: number
  hop: number
  sr: number
  mags: Float32Array   // frames * bins
  phases: Float32Array // frames * bins
  onsets: Uint8Array   // frames
}

function fftInPlace(re: Float32Array, im: Float32Array, inverse: boolean): void {
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

const yieldToUI = () => new Promise<void>(r => setTimeout(r, 0))

export async function analyzeSpectral(
  samples: Float32Array,
  sr: number,
  onProgress?: (p: number) => void,
): Promise<SpectralAnalysis> {
  // cap analysis length at ~20s to bound memory
  const maxLen = sr * 20
  const src = samples.length > maxLen ? samples.subarray(0, maxLen) : samples
  const frames = Math.max(1, Math.floor((src.length - FFT_SIZE) / HOP) + 1)
  const mags = new Float32Array(frames * BINS)
  const phases = new Float32Array(frames * BINS)
  const onsets = new Uint8Array(frames)
  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)
  const hann = new Float32Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE)
  let prevFlux = 0
  const fluxes = new Float32Array(frames)
  for (let f = 0; f < frames; f++) {
    const off = f * HOP
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = off + i < src.length ? src[off + i] : 0
      re[i] = s * hann[i]
      im[i] = 0
    }
    fftInPlace(re, im, false)
    let flux = 0
    const base = f * BINS
    const prevBase = (f - 1) * BINS
    for (let b = 0; b < BINS; b++) {
      const m = Math.hypot(re[b], im[b])
      mags[base + b] = m
      phases[base + b] = Math.atan2(im[b], re[b])
      if (f > 0) {
        const d = m - mags[prevBase + b]
        if (d > 0) flux += d
      }
    }
    fluxes[f] = flux
    if (f > 1 && flux > prevFlux * 1.6 && flux > 0.5) onsets[f] = 1
    prevFlux = flux * 0.6 + prevFlux * 0.4
    if (f % 32 === 31) {
      onProgress?.(f / frames)
      await yieldToUI()
    }
  }
  // mark frame 0 as onset so first transient plays
  onsets[0] = 1
  onProgress?.(1)
  return { frames, bins: BINS, hop: HOP, sr, mags, phases, onsets }
}
