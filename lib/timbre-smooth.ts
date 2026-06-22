import type { PitchFrame } from './pitch-detector'

// ── Internal helpers ───────────────────────────────────────────────────────

function freqToCents(hz: number) { return 1200 * Math.log2(hz / 440) }
function centsToFreq(c: number)  { return 440 * Math.pow(2, c / 1200) }

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

// ── 1. Pitch curve smoothing ───────────────────────────────────────────────
// Gaussian moving average in log-frequency (cents) space. Removes
// frame-to-frame pitch jitter so EQ targets don't jump between windows.

export function smoothPitchCurve(curve: PitchFrame[], windowMs = 35): PitchFrame[] {
  if (curve.length < 2) return curve
  const hop = (curve[curve.length - 1].time - curve[0].time) / (curve.length - 1) * 1000
  const halfWin = Math.max(1, Math.round(windowMs / 2 / Math.max(hop, 1)))
  const sigma = halfWin / 2.5

  return curve.map((f, i) => {
    if (f.freq == null || f.freq <= 0) return f
    let sumC = 0, sumW = 0
    for (let d = -halfWin; d <= halfWin; d++) {
      const o = curve[i + d]
      if (!o || o.freq == null || o.freq <= 0) continue
      const w = Math.exp(-0.5 * (d / sigma) ** 2)
      sumC += freqToCents(o.freq) * w
      sumW += w
    }
    return sumW > 0 ? { ...f, freq: centsToFreq(sumC / sumW) } : f
  })
}

// ── 2. Spectral transition smoothing ──────────────────────────────────────
// STFT → blend each frame's magnitude spectrum with its neighbors → ISTFT.
// Phase is left intact so transient timing is preserved. This smooths the
// "grainy" character caused by abrupt spectral character changes between frames.
// strength: 0 = none, 1 = maximum (default 0.3 keeps clarity while smoothing)

export function smoothSpectralTransitions(buf: AudioBuffer, strength = 0.3): AudioBuffer {
  const FFT_SIZE = 1024, HOP = 256
  const win = hann(FFT_SIZE)
  const numBins = FFT_SIZE >> 1
  const w0 = 1 - strength, wN = strength / 2  // center weight, neighbor weight

  const outData: Float32Array[] = []

  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const raw = buf.getChannelData(ch)

    const offsets: number[] = []
    for (let off = 0; off + FFT_SIZE <= raw.length; off += HOP) offsets.push(off)
    const T = offsets.length

    const specRe = Array.from({ length: T }, () => new Float32Array(FFT_SIZE))
    const specIm = Array.from({ length: T }, () => new Float32Array(FFT_SIZE))

    // Forward STFT
    for (let t = 0; t < T; t++) {
      const re = specRe[t], im = specIm[t], off = offsets[t]
      for (let i = 0; i < FFT_SIZE; i++) { re[i] = (raw[off + i] ?? 0) * win[i]; im[i] = 0 }
      fft(re, im)
    }

    // Temporal magnitude blending (phase unchanged — preserves transient timing)
    for (let t = 1; t < T - 1; t++) {
      for (let f = 0; f < numBins; f++) {
        const magPrev = Math.hypot(specRe[t-1][f], specIm[t-1][f])
        const magThis = Math.hypot(specRe[t][f],   specIm[t][f])
        const magNext = Math.hypot(specRe[t+1][f], specIm[t+1][f])
        const smoothMag = magPrev * wN + magThis * w0 + magNext * wN
        if (magThis > 1e-10) {
          const scale = smoothMag / magThis
          specRe[t][f] *= scale; specIm[t][f] *= scale
          const mirror = FFT_SIZE - f
          if (mirror !== f && mirror < FFT_SIZE) {
            specRe[t][mirror] *= scale; specIm[t][mirror] *= scale
          }
        }
      }
    }

    // Inverse STFT with overlap-add
    const out  = new Float32Array(buf.length)
    const norm = new Float32Array(buf.length)
    for (let t = 0; t < T; t++) {
      ifft(specRe[t], specIm[t])
      const off = offsets[t]
      for (let i = 0; i < FFT_SIZE; i++) {
        const s = off + i
        if (s >= buf.length) break
        out[s]  += specRe[t][i] * win[i]
        norm[s] += win[i] * win[i]
      }
    }
    for (let i = 0; i < buf.length; i++) if (norm[i] > 1e-6) out[i] /= norm[i]
    outData.push(out)
  }

  const result = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: buf.length, sampleRate: buf.sampleRate })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) result.getChannelData(ch).set(outData[ch])
  return result
}

// ── 3. Reference envelope morphing ────────────────────────────────────────
// Analyzes the reference sample's amplitude envelope to extract its
// characteristic attack (acceleration) and release (deceleration) timing,
// then applies those shapes at each note boundary in the converted output.
//
// This is what makes a converted "lead" clip snap on with a fast attack, or
// a converted "pad" clip swell in slowly — the dynamics follow the instrument.

function analyzeEnvelope(refBuf: AudioBuffer): { attackMs: number; releaseMs: number } {
  const sr  = refBuf.sampleRate
  const hop = Math.round(0.005 * sr)  // 5ms hops
  const ch  = refBuf.getChannelData(0)
  const n   = Math.ceil(ch.length / hop)

  let peak = 0
  const env: number[] = []
  for (let i = 0; i < n; i++) {
    const s = i * hop, e = Math.min(s + hop, ch.length)
    let rms = 0
    for (let j = s; j < e; j++) rms += ch[j] ** 2
    const v = Math.sqrt(rms / (e - s))
    env.push(v)
    peak = Math.max(peak, v)
  }
  if (peak < 1e-8) return { attackMs: 10, releaseMs: 80 }
  const norm = env.map(v => v / peak)

  // Attack: how many 5ms frames until we first hit 90% of peak
  let attackFrames = 1
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] >= 0.9) { attackFrames = i + 1; break }
    attackFrames = i + 1
  }

  // Release: how many 5ms frames the tail occupies (frames after last 90% point)
  let releaseFrames = 10
  for (let i = norm.length - 1; i >= 0; i--) {
    if (norm[i] >= 0.9) { releaseFrames = norm.length - i; break }
  }

  return {
    attackMs:  Math.max(5,  Math.min(attackFrames  * 5, 800)),
    releaseMs: Math.max(30, Math.min(releaseFrames * 5, 2000)),
  }
}

export interface NoteSpan { start: number; end: number }

// Shape each note's amplitude to match the reference sample's attack and
// release character. Uses Web Audio gain automation for perfectly smooth ramps
// (no zipper noise). Notes separated by > 20ms get their own attack/release;
// legato notes (gap ≤ 20ms) only get attack shaping, no release between them.
export async function applyReferenceEnvelope(
  buf: AudioBuffer,
  refBuf: AudioBuffer,
  notes: NoteSpan[],
): Promise<AudioBuffer> {
  if (notes.length === 0) return buf
  const { attackMs, releaseMs } = analyzeEnvelope(refBuf)
  const attackSec  = attackMs  / 1000
  const releaseSec = releaseMs / 1000

  const ctx = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const g = ctx.createGain()
  g.gain.setValueAtTime(1, 0)

  for (let ni = 0; ni < notes.length; ni++) {
    const note = notes[ni]
    const prev = notes[ni - 1]
    const next = notes[ni + 1]

    const gapBefore = prev ? note.start - prev.end : note.start
    const gapAfter  = next ? next.start - note.end  : 1.0

    // Attack shaping — only when there's an audible gap before this note
    if (gapBefore > 0.02) {
      const t0 = Math.max(0, note.start - 0.003)
      g.gain.setValueAtTime(0.0001, t0)
      g.gain.exponentialRampToValueAtTime(1.0, note.start + attackSec)
    }

    // Release shaping — only when there's a gap after this note
    if (gapAfter > 0.02) {
      const sustained = note.start + attackSec
      const releaseStart = Math.max(sustained + 0.001, note.end - releaseSec * 0.5)
      g.gain.setValueAtTime(1.0, releaseStart)
      g.gain.exponentialRampToValueAtTime(0.0001, note.end + releaseSec * 0.25)
    }
  }

  src.connect(g)
  g.connect(ctx.destination)
  src.start(0)
  return ctx.startRendering()
}
