/**
 * Tempo and key estimation from decoded audio.
 *
 * Both are estimates — good enough to give a producer a strong starting point,
 * not a guarantee. Tempo uses an onset-novelty autocorrelation; key uses a
 * chroma vector correlated against the Krumhansl-Kessler profiles. Kept as
 * pure functions so they can be unit-tested with synthetic signals.
 */

// ── Radix-2 FFT (in place) ────────────────────────────────────
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]];[im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cwr - im[i + k + len / 2] * cwi
        const vi = re[i + k + len / 2] * cwi + im[i + k + len / 2] * cwr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const ncwr = cwr * wr - cwi * wi
        cwi = cwr * wi + cwi * wr; cwr = ncwr
      }
    }
  }
}

// ── Tempo ─────────────────────────────────────────────────────
export function estimateTempo(x: Float32Array, sr: number): number {
  const hop = Math.max(1, Math.floor(sr * 0.01)) // ~10 ms
  const frames = Math.floor(x.length / hop)
  if (frames < 8) return 0
  const env = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    let e = 0
    for (let j = 0; j < hop; j++) { const s = x[i * hop + j] || 0; e += s * s }
    env[i] = Math.sqrt(e / hop)
  }
  // Positive-difference novelty (spectral-flux-lite on energy).
  const nov = new Float32Array(frames)
  for (let i = 1; i < frames; i++) nov[i] = Math.max(0, env[i] - env[i - 1])

  const envSr = sr / hop
  const minLag = Math.max(2, Math.floor(envSr * 60 / 200)) // up to 200 BPM
  const maxLag = Math.floor(envSr * 60 / 50)                // down to 50 BPM
  let bestLag = minLag, best = -1
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0
    for (let i = 0; i + lag < frames; i++) s += nov[i] * nov[i + lag]
    if (s > best) { best = s; bestLag = lag }
  }
  let bpm = 60 * envSr / bestLag
  // Fold octave errors into the range most music lives in.
  while (bpm < 70) bpm *= 2
  while (bpm > 180) bpm /= 2
  return Math.round(bpm)
}

// ── Key (Krumhansl-Kessler) ───────────────────────────────────
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

function pearson(a: number[], b: number[]): number {
  const n = a.length
  const ma = a.reduce((s, v) => s + v, 0) / n
  const mb = b.reduce((s, v) => s + v, 0) / n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y }
  return da && db ? num / Math.sqrt(da * db) : 0
}

/** 12-bin chroma from the magnitude spectrum, averaged over frames. */
export function chroma(x: Float32Array, sr: number): number[] {
  const N = 4096
  const hop = 2048
  const chroma = new Array(12).fill(0)
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)) // Hann
  const re = new Float32Array(N), im = new Float32Array(N)
  // Precompute bin → pitch class (only bins in a musical range).
  const binPc = new Int8Array(N / 2)
  for (let b = 0; b < N / 2; b++) {
    const f = b * sr / N
    binPc[b] = f >= 55 && f <= 2000 ? ((Math.round(69 + 12 * Math.log2(f / 440)) % 12) + 12) % 12 : -1
  }
  let frames = 0
  for (let start = 0; start + N <= x.length; start += hop) {
    for (let i = 0; i < N; i++) { re[i] = x[start + i] * win[i]; im[i] = 0 }
    fft(re, im)
    for (let b = 1; b < N / 2; b++) {
      const pc = binPc[b]
      if (pc >= 0) chroma[pc] += Math.sqrt(re[b] * re[b] + im[b] * im[b])
    }
    frames++
  }
  if (frames) for (let i = 0; i < 12; i++) chroma[i] /= frames
  return chroma
}

export function estimateKey(x: Float32Array, sr: number): { key: string; mode: 'major' | 'minor'; confidence: number } | null {
  const c = chroma(x, sr)
  if (c.every(v => v === 0)) return null
  let best = { key: 'C', mode: 'major' as 'major' | 'minor', score: -Infinity }
  let second = -Infinity
  for (let rot = 0; rot < 12; rot++) {
    const rotated = c.map((_, i) => c[(i + rot) % 12])
    for (const [profile, mode] of [[MAJOR, 'major'], [MINOR, 'minor']] as const) {
      const score = pearson(rotated, profile)
      if (score > best.score) { second = best.score; best = { key: NOTE_NAMES[rot], mode, score } }
      else if (score > second) second = score
    }
  }
  // Gap between the top two as a rough confidence signal.
  return { key: best.key, mode: best.mode, confidence: Math.max(0, Math.min(1, (best.score - second) * 4)) }
}
