// Cooley-Tukey in-place FFT (power-of-2 length, real+imag arrays)
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
        const aR = re[i + j], aI = im[i + j]
        const bR = re[i + j + half] * wr - im[i + j + half] * wi
        const bI = re[i + j + half] * wi + im[i + j + half] * wr
        re[i + j] = aR + bR; im[i + j] = aI + bI
        re[i + j + half] = aR - bR; im[i + j + half] = aI - bI
        const nWr = wr * cosA - wi * sinA
        wi = wr * sinA + wi * cosA
        wr = nWr
      }
    }
  }
}

// Average Hann-windowed magnitude spectrum across all overlapping frames in buf
export function analyzeSpectralEnvelope(buf: AudioBuffer, fftSize = 2048): Float32Array {
  const ch = buf.getChannelData(0)
  const hop = fftSize >> 1
  const bins = fftSize >> 1
  const avg = new Float32Array(bins)
  let frames = 0
  for (let off = 0; off + fftSize <= ch.length; off += hop) {
    const re = new Float32Array(fftSize)
    const im = new Float32Array(fftSize)
    for (let i = 0; i < fftSize; i++)
      re[i] = ch[off + i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / fftSize))
    fft(re, im)
    for (let i = 0; i < bins; i++) avg[i] += Math.sqrt(re[i] ** 2 + im[i] ** 2)
    frames++
  }
  if (frames > 0) for (let i = 0; i < bins; i++) avg[i] /= frames
  return avg
}

// 10 logarithmically-spaced bands from 40 Hz to 16 kHz
const BANDS_HZ = [40, 80, 160, 315, 630, 1250, 2500, 5000, 10000, 16000]

// Insert a peaking EQ chain after `source` that shifts voiceBuf's spectrum toward refBuf's.
// Returns the last node in the chain — connect it to whatever comes next.
export function applySpectralMatch(
  ctx: OfflineAudioContext,
  source: AudioNode,
  voiceBuf: AudioBuffer,
  refBuf: AudioBuffer,
): AudioNode {
  const fftSize = 2048
  const vMag = analyzeSpectralEnvelope(voiceBuf, fftSize)
  const rMag = analyzeSpectralEnvelope(refBuf, fftSize)
  const binHz = ctx.sampleRate / fftSize
  let last: AudioNode = source
  for (const hz of BANDS_HZ) {
    if (hz >= ctx.sampleRate / 2) continue
    const bin = Math.round(hz / binHz)
    let vS = 0, rS = 0, n = 0
    for (let d = -3; d <= 3; d++) {
      const b = bin + d
      if (b >= 0 && b < vMag.length) { vS += vMag[b]; rS += rMag[b]; n++ }
    }
    if (!n) continue
    const gDb = Math.max(-14, Math.min(14, 20 * Math.log10((rS + 1e-9) / (vS + 1e-9))))
    if (Math.abs(gDb) < 0.5) continue
    const f = ctx.createBiquadFilter()
    f.type = 'peaking'; f.frequency.value = hz; f.Q.value = 1.2; f.gain.value = gDb
    last.connect(f); last = f
  }
  return last
}

// Apply spectral matching as a standalone buffer-in → buffer-out operation.
// voiceBuf is the reference baseline (the original voice recording's character).
// refBuf is the target spectral character (the sample the user picked).
export async function matchBuffer(
  inputBuf: AudioBuffer,
  voiceBuf: AudioBuffer,
  refBuf: AudioBuffer,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(
    inputBuf.numberOfChannels,
    inputBuf.length,
    inputBuf.sampleRate,
  )
  const src = ctx.createBufferSource()
  src.buffer = inputBuf
  const lastNode = applySpectralMatch(ctx, src, voiceBuf, refBuf)
  const out = ctx.createGain(); out.gain.value = 1
  lastNode.connect(out); out.connect(ctx.destination)
  src.start(0)
  return ctx.startRendering()
}
