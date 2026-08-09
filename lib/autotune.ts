/**
 * Offline autotune / pitch-correction (v1).
 *
 * Pipeline (all client-side, pure array math + Web Audio AudioBuffer):
 *   1. Frame-wise pitch detection over the recorded mono PCM (YIN, reusing
 *      lib/pitch-detector.ts detectBufferPitch on a centered ~46ms window at a
 *      ~10ms hop).
 *   2. For each voiced frame, the correction TARGET = the nearest in-scale note
 *      (lib/scale-constants snapToScale for the chosen key + scale).
 *   3. Segment the pitch track into stable-pitch regions (maximal runs of frames
 *      that snap to the SAME target note; short unvoiced gaps are absorbed).
 *   4. Each segment is pitch-shifted by ONE constant ratio so its (median) pitch
 *      lands on its snapped note — a global ratio would be wrong, per-segment is
 *      the v1 sweet spot. Unvoiced regions pass through untouched. The segments
 *      are concatenated back in order, reconstructing the full take.
 *   5. A `strength` amount (0..1) shifts each segment only `strength` of the way
 *      to its target (0 = original, 1 = fully snapped) — the classic autotune
 *      "amount" knob, enabling subtle vs hard-tune.
 *
 * A continuous phase-vocoder (per-frame ratio, no segment seams) and real-time
 * monitoring are v2 — see the notes in components/apps/Autotune.tsx.
 */

import { detectBufferPitch } from './pitch-detector'
import { snapToScale, ROOT_NOTES, type RootNote, type ScaleType } from './scale-constants'

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)
const midiToHz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
const rootFromKey = (key: number): RootNote => ROOT_NOTES[((key % 12) + 12) % 12]

// Detection window: ~46ms at 44.1k → ≥4 periods down to ~90Hz, tight enough for
// clean segment boundaries. detectBufferPitch still applies a Hann window over it.
const DETECT_WIN = 2048

export interface AutotuneOptions {
  key: number          // 0..11 (C..B)
  scale: ScaleType
  strength: number     // 0..1 — fraction of the way to the snapped target
  hopSec?: number      // detection hop, default 0.01 (10ms)
  confFloor?: number   // YIN confidence floor, default 0.5
  minSegSec?: number   // segments shorter than this pass through uncorrected (default 0.05)
}

export interface AutotuneFrame {
  time: number         // seconds
  hz: number | null    // detected pitch (null = unvoiced)
  targetHz: number | null  // nearest in-scale note for this frame (display)
}

export interface AutotuneSegment {
  startSec: number
  endSec: number
  detectedHz: number   // segment representative (median) pitch
  targetMidi: number
  targetHz: number
  appliedCents: number // actual shift applied (already scaled by strength)
}

export interface AutotuneResult {
  samples: Float32Array
  sampleRate: number
  frames: AutotuneFrame[]
  segments: AutotuneSegment[]
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * Frame-wise pitch track over a mono buffer at a fixed hop. Each frame's pitch
 * is measured on a DETECT_WIN window centered on the hop position.
 */
export function detectPitchTrack(
  samples: Float32Array,
  sampleRate: number,
  hopSec = 0.01,
  confFloor = 0.5,
): Array<{ centerSample: number; time: number; hz: number | null }> {
  const hop = Math.max(1, Math.round(sampleRate * hopSec))
  const n = samples.length
  const out: Array<{ centerSample: number; time: number; hz: number | null }> = []
  for (let p = 0; p < n; p += hop) {
    let start = p - (DETECT_WIN >> 1)
    if (n >= DETECT_WIN) start = Math.max(0, Math.min(start, n - DETECT_WIN))
    else start = 0
    const end = Math.min(n, start + DETECT_WIN)
    // Fresh buffer (not a subarray view) so the type is Float32Array<ArrayBuffer>.
    const frame: Float32Array<ArrayBuffer> = new Float32Array(end - start)
    frame.set(samples.subarray(start, end))
    const r = frame.length >= 1024 ? detectBufferPitch(frame, sampleRate, 0, confFloor) : null
    out.push({ centerSample: p, time: p / sampleRate, hz: r ? r.hz : null })
  }
  return out
}

/**
 * Accurate representative pitch (Hz) for a segment: probe the steady middle at a
 * few offsets with the full YIN window and take the median. Returns null if the
 * segment is too short or unvoiced.
 */
function refineSegmentPitch(input: Float32Array, sampleRate: number, s0: number, s1: number): number | null {
  const segLen = s1 - s0
  const win = Math.min(4096, segLen)
  if (win < 1024) return null
  const usable = segLen - win
  const probes: number[] = []
  for (const frac of [0.2, 0.5, 0.8]) {
    const start = s0 + Math.round(usable * frac)
    const frame: Float32Array<ArrayBuffer> = new Float32Array(win)
    frame.set(input.subarray(start, start + win))
    const r = detectBufferPitch(frame, sampleRate, 0, 0.4)
    if (r) probes.push(r.hz)
  }
  return probes.length ? median(probes) : null
}

/** Nearest in-scale note (as MIDI) for a detected pitch, given key + scale. */
export function targetMidiFor(hz: number, key: number, scale: ScaleType): number {
  const sourceMidi = Math.round(hzToMidi(hz))
  return snapToScale(sourceMidi, rootFromKey(key), scale)
}

// ── Pitch shift (self-contained WSOLA, correct in BOTH directions) ─────────────
// NB: lib/wsola.ts pitchShiftBuffer preserves pitch only when time-STRETCHING
// (upshift); its compression path (downshift) does NOT hold pitch, which is the
// common autotune case (a sharp note corrected DOWN). This standard WSOLA — fixed
// synthesis hop Hs, analysis hop Ha = Hs/factor, overlap-add correlated against the
// running output — is verified accurate up/down (≤~8¢ on tones). A phase-vocoder
// (fewer transient smears, cleaner on big shifts) is the v2 upgrade.

function resampleLinear(x: Float32Array, rate: number): Float32Array {
  // rate > 1 → shorter / pitch up; rate < 1 → longer / pitch down.
  const outLen = Math.max(1, Math.round(x.length / rate))
  const out = new Float32Array(outLen)
  const last = x.length - 1
  for (let i = 0; i < outLen; i++) {
    const pos = i * rate
    const i0 = Math.min(last, Math.floor(pos))
    const i1 = Math.min(last, i0 + 1)
    out[i] = x[i0] + (x[i1] - x[i0]) * (pos - i0)
  }
  return out
}

function wsolaStretch(x: Float32Array, factor: number): Float32Array {
  // factor > 1 → longer; factor < 1 → shorter. Pitch preserved either way.
  if (Math.abs(factor - 1) < 1e-3) return x.slice()
  const win = 1024
  if (x.length <= win) return x.slice()
  const hann = new Float32Array(win)
  for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (win - 1))
  const Hs = win >> 1                              // synthesis hop (fixed)
  const Ha = Math.max(1, Math.round(Hs / factor))  // analysis hop
  const search = Math.round(Hs / 2)
  const outLen = Math.max(win, Math.round(x.length * factor))
  const out = new Float32Array(outLen)
  const norm = new Float32Array(outLen)
  let outPos = 0
  let ana = 0
  let first = true
  while (outPos + win <= outLen && Math.round(ana) + win <= x.length) {
    let best = Math.max(0, Math.min(x.length - win, Math.round(ana)))
    if (!first && search > 0) {
      const lo = Math.max(0, best - search)
      const hi = Math.min(x.length - win, best + search)
      let bestCorr = -Infinity
      const L = 256
      for (let s = lo; s <= hi; s++) {
        let c = 0
        for (let k = 0; k < L; k++) c += out[outPos + k] * x[s + k]
        if (c > bestCorr) { bestCorr = c; best = s }
      }
    }
    first = false
    for (let i = 0; i < win; i++) { out[outPos + i] += x[best + i] * hann[i]; norm[outPos + i] += hann[i] }
    outPos += Hs
    ana += Ha
  }
  for (let i = 0; i < outLen; i++) if (norm[i] > 1e-4) out[i] /= norm[i]
  return out
}

/** Pitch-shift mono PCM by a fixed cents amount, preserving duration. */
function pitchShiftMono(x: Float32Array, cents: number): Float32Array {
  if (Math.abs(cents) < 1) return x.slice()
  const rate = Math.pow(2, cents / 1200)
  // resample (pitch × rate, dur / rate) then WSOLA-stretch by `rate` back to dur.
  return wsolaStretch(resampleLinear(x, rate), rate)
}

/**
 * Core offline correction. Pure: takes mono PCM, returns corrected mono PCM plus
 * the detected/target pitch tracks and the segment decisions (for a curve view
 * and for headless verification).
 */
export function correctPitch(
  input: Float32Array,
  sampleRate: number,
  opts: AutotuneOptions,
): AutotuneResult {
  const hopSec = opts.hopSec ?? 0.01
  const confFloor = opts.confFloor ?? 0.5
  const strength = Math.max(0, Math.min(1, opts.strength))
  const minSegSamples = Math.round((opts.minSegSec ?? 0.05) * sampleRate)
  const { key, scale } = opts

  const track = detectPitchTrack(input, sampleRate, hopSec, confFloor)
  const nF = track.length

  // Per-frame snapped target MIDI (null = unvoiced). Also the display frames.
  const targets: Array<number | null> = new Array(nF).fill(null)
  const frames: AutotuneFrame[] = new Array(nF)
  for (let i = 0; i < nF; i++) {
    const hz = track[i].hz
    if (hz && hz > 0) {
      const tm = targetMidiFor(hz, key, scale)
      targets[i] = tm
      frames[i] = { time: track[i].time, hz, targetHz: midiToHz(tm) }
    } else {
      frames[i] = { time: track[i].time, hz: null, targetHz: null }
    }
  }

  // Absorb short unvoiced gaps (≤50ms) between two voiced frames snapping to the
  // SAME target, so vibrato/breath dropouts don't shatter one note into slivers.
  const gapFrames = Math.max(1, Math.round(0.05 / hopSec))
  for (let i = 0; i < nF; i++) {
    if (targets[i] !== null) continue
    let j = i
    while (j < nF && targets[j] === null) j++
    const before = i > 0 ? targets[i - 1] : null
    const after = j < nF ? targets[j] : null
    if (before !== null && before === after && j - i <= gapFrames) {
      for (let k = i; k < j; k++) targets[k] = before
    }
    i = j - 1
  }

  // Sample boundaries between frames tile the whole buffer with no gaps, so
  // concatenating the per-segment audio reconstructs the full take.
  const bound: number[] = new Array(nF + 1)
  bound[0] = 0
  bound[nF] = input.length
  for (let i = 1; i < nF; i++) {
    bound[i] = Math.round((track[i - 1].centerSample + track[i].centerSample) / 2)
  }

  const outChunks: Float32Array[] = []
  const segments: AutotuneSegment[] = []

  let i = 0
  while (i < nF) {
    const t = targets[i]
    let j = i
    while (j + 1 < nF && targets[j + 1] === t) j++
    const s0 = bound[i]
    const s1 = bound[j + 1]

    if (t === null || s1 - s0 < minSegSamples || strength === 0) {
      // Unvoiced, too-short (correction artifacts / length drift not worth it),
      // or strength 0 → pass the original audio straight through.
      outChunks.push(input.subarray(s0, s1) as Float32Array)
    } else {
      const hzVals: number[] = []
      for (let k = i; k <= j; k++) { const h = track[k].hz; if (h && h > 0) hzVals.push(h) }
      // Representative pitch for the shift ratio. The coarse segmentation track uses
      // a short (2048) window; refine with the accurate full-length YIN probe over
      // the steady middle of the segment so the applied shift lands within a couple
      // cents (not bounded by the segmentation window's ~±10¢ jitter).
      const refined = refineSegmentPitch(input, sampleRate, s0, s1)
      const medHz = refined ?? median(hzVals)
      // Re-snap from the segment's representative pitch (robust to per-frame jitter).
      const targetMidi = medHz > 0 ? snapToScale(Math.round(hzToMidi(medHz)), rootFromKey(key), scale) : t
      const targetHz = midiToHz(targetMidi)
      const fullCents = medHz > 0 ? 1200 * Math.log2(targetHz / medHz) : 0
      const appliedCents = strength * fullCents

      if (Math.abs(appliedCents) < 1) {
        outChunks.push(input.subarray(s0, s1) as Float32Array)
      } else {
        const seg = new Float32Array(s1 - s0)
        seg.set(input.subarray(s0, s1))
        outChunks.push(pitchShiftMono(seg, appliedCents))
      }
      segments.push({
        startSec: s0 / sampleRate,
        endSec: s1 / sampleRate,
        detectedHz: medHz,
        targetMidi,
        targetHz,
        appliedCents,
      })
    }
    i = j + 1
  }

  let total = 0
  for (const c of outChunks) total += c.length
  const samples = new Float32Array(total)
  let off = 0
  for (const c of outChunks) { samples.set(c, off); off += c.length }

  return { samples, sampleRate, frames, segments }
}

/** Test helper: pitch-shift a mono buffer by a fixed cents amount and return PCM. */
export function shiftSamples(samples: Float32Array, _sampleRate: number, cents: number): Float32Array {
  return pitchShiftMono(samples, cents)
}

/** Median detected pitch (Hz) over a whole buffer — used by tests / quick checks. */
export function measureMedianPitch(samples: Float32Array, sampleRate: number, confFloor = 0.5): number | null {
  const track = detectPitchTrack(samples, sampleRate, 0.02, confFloor)
  const hz = track.map(f => f.hz).filter((h): h is number => h != null && h > 0)
  return hz.length ? median(hz) : null
}
