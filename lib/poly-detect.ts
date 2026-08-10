// Local multi-f0 (polyphonic) estimation — the FREE "escalation pass" of the hybrid transcription
// pipeline. When lib/transcribe-confidence flags a note's window as polyphonic (the mono YIN detector
// can only report ONE — usually wrong — pitch for a chord), this re-estimates the SIMULTANEOUS pitches
// locally, so chords are resolved at $0 with no paid AI. Deterministic + client-safe.
//
// Method: windowed FFT → magnitude spectrum → iterative harmonic-sum salience over a semitone grid,
// with spectral peeling (subtract each detected note's harmonic bins before finding the next). A
// fundamental-presence gate rejects phantom sub-octaves whose "fundamental" carries no real energy.
// Standard multi-pitch estimation; note-accurate for small chords and octave-robust via the gate+peel.
import { fftInPlace, FFT_N } from './transcribe-confidence'

const A4 = 440
const midiToHz = (m: number) => A4 * Math.pow(2, (m - 69) / 12)

export interface PolyOptions {
  maxNotes?: number       // cap on simultaneous pitches (default 4)
  minMidi?: number        // low bound of the search grid (default 36 = C2)
  maxMidi?: number        // high bound (default 88 = E6)
  salienceFloor?: number  // stop when a residual note is weaker than this × the strongest (default 0.22)
}

/**
 * Estimate the simultaneous MIDI pitches sounding in a note's window.
 * Returns [] when it can't get a stable window, a single-element array for a monophonic span, or
 * 2..maxNotes pitches (ascending) for a chord.
 */
export function detectPolyphony(
  samples: Float32Array, sr: number, startSec: number, durSec: number, opts: PolyOptions = {},
): number[] {
  const maxNotes = opts.maxNotes ?? 4
  const minMidi = opts.minMidi ?? 36
  const maxMidi = opts.maxMidi ?? 88
  const floor = opts.salienceFloor ?? 0.22

  // Window from the note body (skip the attack), centred, up to FFT_N samples — same basis as isPolyphonic.
  const bodyStart = startSec + Math.min(0.06, durSec * 0.25)
  const s0 = Math.floor(bodyStart * sr)
  const avail = Math.min(FFT_N, Math.max(0, Math.floor((startSec + durSec) * sr) - s0))
  if (avail < 1024) return []
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N)
  for (let i = 0; i < avail; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (avail - 1)) // Hann
    re[i] = (samples[s0 + i] || 0) * w
  }
  fftInPlace(re, im)
  const half = FFT_N / 2
  const mag = new Float32Array(half)
  let globalMax = 1e-9
  for (let i = 0; i < half; i++) { const m = Math.hypot(re[i], im[i]); mag[i] = m; if (m > globalMax) globalMax = m }

  const binOf = (hz: number) => Math.round((hz * FFT_N) / sr)
  const nHarm = 8
  const peakNear = (spec: Float32Array, bin: number): number => {
    let v = 0
    for (let b = bin - 1; b <= bin + 1; b++) if (b > 0 && b < half) v = Math.max(v, spec[b])
    return v
  }
  // Harmonic-sum salience of a candidate MIDI pitch on the (possibly peeled) working spectrum.
  // Gated on real energy at the fundamental so a sub-octave phantom (harmonics present, fundamental
  // absent) scores 0 instead of stealing the pick.
  const salience = (spec: Float32Array, m: number): number => {
    const f = midiToHz(m)
    const fund = peakNear(spec, binOf(f))
    if (fund < 0.06 * globalMax) return 0
    let s = fund * 1.5   // fundamental weighted heaviest
    for (let h = 2; h <= nHarm; h++) {
      const bin = binOf(h * f)
      if (bin >= half) break
      s += peakNear(spec, bin) / Math.sqrt(h)
    }
    return s
  }

  const work = mag.slice()
  const found: number[] = []
  let firstSal = 0
  for (let iter = 0; iter < maxNotes; iter++) {
    let bestM = -1, bestS = 0
    for (let m = minMidi; m <= maxMidi; m++) {
      const s = salience(work, m)
      if (s > bestS) { bestS = s; bestM = m }
    }
    if (bestM < 0 || bestS <= 0) break
    if (iter === 0) firstSal = bestS
    else if (bestS < floor * firstSal) break
    if (!found.includes(bestM)) found.push(bestM)
    // Peel: suppress this note's harmonic bins so the next iteration locks a DIFFERENT fundamental.
    const f = midiToHz(bestM)
    for (let h = 1; h <= nHarm; h++) {
      const bin = binOf(h * f)
      for (let b = bin - 1; b <= bin + 1; b++) if (b > 0 && b < half) work[b] *= 0.12
    }
  }
  return found.sort((a, b) => a - b)
}

export interface ChordSpan { startSec: number; durSec: number; midis: number[] }

/**
 * Recover CHORD regions the MONOPHONIC pass dropped. The mono YIN/HMM tracker discards polyphonic
 * spans (unstable pitch + low clarity across a chord's beating partials), so they never reach the
 * note-level polyphony resolver. This finds audio that is SOUNDING but covered by no mono note, and
 * runs the local multi-f0 detector on each such gap — so a chord is transcribed even when the mono
 * pass gave up on it entirely. Returns one span per recovered chord (2+ simultaneous pitches).
 */
export function findUncoveredChords(
  samples: Float32Array, sr: number,
  monoNotes: { startSec: number; durSec: number }[],
  curve: { time: number; rms: number }[],
  opts: { minDuration?: number } = {},
): ChordSpan[] {
  const minDur = opts.minDuration ?? 0.12
  const frames = curve.filter(f => Number.isFinite(f.time))
  if (frames.length < 3) return []
  let rmsMax = 1e-9
  for (const f of frames) if ((f.rms || 0) > rmsMax) rmsMax = f.rms
  const soundFloor = 0.15 * rmsMax
  const pad = 0.04                                   // don't re-detect right at a mono note's edges
  const covered = (t: number) => monoNotes.some(n => t >= n.startSec - pad && t <= n.startSec + n.durSec + pad)
  // Maximal runs of frames that are sounding yet covered by no mono note.
  const spans: Array<[number, number]> = []
  let start = -1, prev = frames[0].time
  for (const f of frames) {
    const uncovered = (f.rms || 0) > soundFloor && !covered(f.time)
    if (uncovered && start < 0) start = f.time
    else if (!uncovered && start >= 0) { spans.push([start, prev]); start = -1 }
    prev = f.time
  }
  if (start >= 0) spans.push([start, prev])
  const out: ChordSpan[] = []
  for (const [s, e] of spans) {
    if (e - s < minDur) continue
    const midis = detectPolyphony(samples, sr, s, e - s)
    if (midis.length >= 2) out.push({ startSec: s, durSec: e - s, midis })
  }
  return out
}
