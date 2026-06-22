import type { PitchFrame } from './pitch-detector'

export type VowelType = 'aaa' | 'ooo' | 'eee' | 'iii' | 'consonant' | 'silence'

export interface AudioSegment {
  id: string
  startSec: number
  endSec: number
  vowel: VowelType
}

export const VOWEL_COLORS: Record<VowelType, string> = {
  aaa: '#f59e0b',
  ooo: '#8b5cf6',
  eee: '#10b981',
  iii: '#3b82f6',
  consonant: '#64748b',
  silence: '#1a1a2e',
}

export const VOWEL_LABELS: Record<VowelType, string> = {
  aaa: 'AAA', ooo: 'OOO', eee: 'EEE', iii: 'III',
  consonant: 'Cons', silence: 'Silence',
}

// Cooley-Tukey in-place FFT (power-of-2)
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

// Find the peak bin in a frequency range
function peakBin(mag: Float32Array, loHz: number, hiHz: number, binHz: number): number {
  const lo = Math.max(1, Math.floor(loHz / binHz))
  const hi = Math.min(mag.length - 1, Math.ceil(hiHz / binHz))
  let best = lo, bestVal = 0
  for (let b = lo; b <= hi; b++) {
    if (mag[b] > bestVal) { bestVal = mag[b]; best = b }
  }
  return best * binHz
}

// Peterson & Barney vowel space — simplified but covers the 4 target sounds
function classifyFormants(f1: number, f2: number): VowelType {
  // /iː/ "eee": low F1, very high F2
  if (f1 < 480 && f2 > 2000) return 'eee'
  // /ɪ/ "iii": low-mid F1, high F2
  if (f1 < 550 && f2 > 1500) return 'iii'
  // /uː/ "ooo": low F1, low F2
  if (f1 < 550 && f2 < 1200) return 'ooo'
  // /ɑː/ "aaa": high F1
  if (f1 > 550) return 'aaa'
  return 'consonant'
}

const FFT_SIZE = 2048
const HOP = 512
const SILENCE_RMS = 0.018
const MIN_SEG_SEC = 0.08   // merge segments shorter than this
const SMOOTH_WINDOW = 5    // frames to vote-smooth the classification

export function detectSegments(buf: AudioBuffer, pitchCurve: PitchFrame[]): AudioSegment[] {
  const ch = buf.getChannelData(0)
  const sr = buf.sampleRate
  const binHz = sr / FFT_SIZE
  const re = new Float32Array(FFT_SIZE)
  const im = new Float32Array(FFT_SIZE)

  // Build a set of seconds where pitch was detected
  const pitchedSec = new Set<number>()
  for (const f of pitchCurve) {
    if (f.freq != null) {
      // mark any 50ms bucket near this frame as pitched
      const bucket = Math.floor(f.time * 20)
      for (let d = -1; d <= 1; d++) pitchedSec.add(bucket + d)
    }
  }
  function hasPitch(tSec: number) { return pitchedSec.has(Math.floor(tSec * 20)) }

  // Per-hop classification
  type Frame = { t: number; vowel: VowelType }
  const frames: Frame[] = []

  for (let off = 0; off + FFT_SIZE <= ch.length; off += HOP) {
    const t = (off + FFT_SIZE / 2) / sr

    // RMS
    let rms = 0
    for (let i = off; i < off + FFT_SIZE; i++) rms += ch[i] * ch[i]
    rms = Math.sqrt(rms / FFT_SIZE)

    if (rms < SILENCE_RMS) { frames.push({ t, vowel: 'silence' }); continue }
    if (!hasPitch(t))       { frames.push({ t, vowel: 'consonant' }); continue }

    // Hann-windowed FFT
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = ch[off + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / FFT_SIZE))
      im[i] = 0
    }
    fft(re, im)

    // Magnitude
    const mag = new Float32Array(FFT_SIZE >> 1)
    for (let i = 0; i < mag.length; i++) mag[i] = Math.sqrt(re[i] ** 2 + im[i] ** 2)

    // Smooth spectrum (7-bin moving average) to suppress harmonics and reveal formant envelope
    const smooth = new Float32Array(mag.length)
    for (let i = 0; i < mag.length; i++) {
      let s = 0, n = 0
      for (let d = -7; d <= 7; d++) {
        const b = i + d
        if (b >= 0 && b < mag.length) { s += mag[b]; n++ }
      }
      smooth[i] = s / n
    }

    // Find F1 (150–1000 Hz) and F2 (700–3500 Hz, must be at least 300 Hz above F1)
    const f1 = peakBin(smooth, 150, 1000, binHz)
    const f2 = peakBin(smooth, Math.max(700, f1 + 300), 3500, binHz)
    frames.push({ t, vowel: classifyFormants(f1, f2) })
  }

  // Vote-smooth each frame over ±SMOOTH_WINDOW neighbours
  const smoothed: VowelType[] = frames.map((_, i) => {
    const counts: Partial<Record<VowelType, number>> = {}
    for (let d = -SMOOTH_WINDOW; d <= SMOOTH_WINDOW; d++) {
      const v = frames[i + d]?.vowel
      if (v) counts[v] = (counts[v] ?? 0) + 1
    }
    return (Object.entries(counts).sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0] ?? 'consonant') as VowelType
  })

  // Build runs of same-vowel consecutive frames
  const segments: AudioSegment[] = []
  let runStart = 0
  for (let i = 1; i <= smoothed.length; i++) {
    if (i === smoothed.length || smoothed[i] !== smoothed[runStart]) {
      segments.push({
        id: crypto.randomUUID(),
        startSec: frames[runStart].t - (HOP / 2) / sr,
        endSec: (i < frames.length ? frames[i].t : buf.duration) - (HOP / 2) / sr,
        vowel: smoothed[runStart],
      })
      runStart = i
    }
  }

  // Clamp to buffer boundaries
  for (const seg of segments) {
    seg.startSec = Math.max(0, seg.startSec)
    seg.endSec   = Math.min(buf.duration, seg.endSec)
  }

  // Merge very short segments into their neighbours
  const merged: AudioSegment[] = []
  for (const seg of segments) {
    const dur = seg.endSec - seg.startSec
    const last = merged[merged.length - 1]
    if (dur < MIN_SEG_SEC && last) {
      last.endSec = seg.endSec  // absorb into previous
    } else {
      merged.push({ ...seg })
    }
  }

  return merged.filter(s => s.endSec > s.startSec)
}

// Extract a contiguous slice from an AudioBuffer
export function extractSubBuffer(buf: AudioBuffer, startSec: number, endSec: number): AudioBuffer {
  const sr = buf.sampleRate
  const s0 = Math.max(0, Math.floor(startSec * sr))
  const s1 = Math.min(buf.length, Math.ceil(endSec * sr))
  const len = Math.max(1, s1 - s0)
  const out = new AudioBuffer({ numberOfChannels: buf.numberOfChannels, length: len, sampleRate: sr })
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    out.getChannelData(ch).set(buf.getChannelData(ch).subarray(s0, s1))
  }
  return out
}

// Extract pitch frames for a segment, time-normalized to start at 0
export function extractSubCurve(pitchCurve: PitchFrame[], startSec: number, endSec: number): PitchFrame[] {
  return pitchCurve
    .filter(f => f.time >= startSec - 0.01 && f.time <= endSec + 0.01)
    .map(f => ({ ...f, time: Math.max(0, f.time - startSec) }))
}

// Stitch a processed segment back into a full-length buffer at the right byte offset
export function spliceSegmentBack(
  fullBuf: AudioBuffer,
  segBuf: AudioBuffer,
  startSec: number,
): AudioBuffer {
  const sr = fullBuf.sampleRate
  const offset = Math.floor(startSec * sr)
  const out = new AudioBuffer({ numberOfChannels: fullBuf.numberOfChannels, length: fullBuf.length, sampleRate: sr })
  for (let ch = 0; ch < fullBuf.numberOfChannels; ch++) {
    const src = fullBuf.getChannelData(ch)
    const dst = out.getChannelData(ch)
    dst.set(src)  // copy full original
    const seg = segBuf.getChannelData(Math.min(ch, segBuf.numberOfChannels - 1))
    const end = Math.min(offset + seg.length, dst.length)
    for (let i = offset; i < end; i++) dst[i] = seg[i - offset]
  }
  return out
}

// Concatenate an ordered list of AudioBuffers into one
export function concatenateBuffers(bufs: AudioBuffer[]): AudioBuffer {
  if (bufs.length === 0) throw new Error('No buffers to concatenate')
  const sr = bufs[0].sampleRate
  const channels = Math.max(...bufs.map(b => b.numberOfChannels))
  const total = bufs.reduce((s, b) => s + b.length, 0)
  const out = new AudioBuffer({ numberOfChannels: channels, length: total, sampleRate: sr })
  let offset = 0
  for (const b of bufs) {
    for (let ch = 0; ch < channels; ch++) {
      const src = b.getChannelData(Math.min(ch, b.numberOfChannels - 1))
      out.getChannelData(ch).set(src, offset)
    }
    offset += b.length
  }
  return out
}
