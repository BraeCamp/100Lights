/**
 * Offline "backfill" accuracy pass for VoiceMidi.
 *
 * The real-time LivePitchDetector (YIN, ~60fps) gives instant feedback but drops
 * frames and smooths aggressively. After a take, we re-analyze the RECORDED audio
 * offline — slower, but with a finer hop, a median filter over the pitch track,
 * and stricter gating — for a cleaner transcription.
 *
 * This module is deliberately PURE (no Web Audio, no DOM): it takes a mono
 * Float32 buffer + sample rate and returns notes. That keeps it unit-testable in
 * a headless page (synthesize a melody → decode → call notesFromBuffer) without a
 * live microphone. The blob→AudioBuffer decode + downmix lives in the component.
 *
 * It reuses the SAME YIN core the live detector uses (via detectBufferPitch) so
 * the pitch/tone stays consistent, and feeds a PitchFrame[] into the existing
 * extractNoteEvents() note-segmenter.
 */

import {
  detectBufferPitch,
  extractNoteEvents,
  midiToFreq,
  type PitchFrame,
} from '@/lib/pitch-detector'

export interface BackfillNote {
  startSec:  number
  midi:      number
  durSec:    number
  velocity:  number
  /** Set by alignToGrid: true when the onset was too far from any grid line to
   *  confirm, so it was LEFT where it is (a flag, not a blind snap). Absent on
   *  the raw offline pass. */
  offGrid?:  boolean
}

export interface BackfillOptions {
  /** Input gain applied before analysis (mirrors the live GainNode; MediaRecorder
   *  records the RAW pre-gain mic stream, so we re-apply it here). Default 1. */
  gain?:         number
  /** RMS floor (on the post-gain signal) below which a frame is unvoiced. Default 0.006. */
  rmsGate?:      number
  /** Minimum note length in seconds. Default 0.08. */
  minDuration?:  number
  /** Analysis hop in seconds (time resolution of the pitch curve). Default 0.015 (15ms). */
  hopSec?:       number
  /** Analysis window size in samples. Default scales to the (downsampled) rate,
   *  ~64ms and ≥1024, YIN-safe down to ~70 Hz. */
  winSize?:      number
  /** Half-width of the median filter over the MIDI track (kills octave flickers). Default 2 → 5-frame median. */
  medianRadius?: number
  /** Downsample target rate (Hz) applied before the pitch scan. Voice pitch is well
   *  under 1 kHz, so ~16 kHz keeps YIN accurate while shrinking the window ~2.75× and
   *  YIN's per-window cost ~7×. Pass 0 / >= source rate to skip. Default 16000. */
  targetSampleRate?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

const DEFAULT_TARGET_SR = 16000

// Window that spans ~64ms and is at least 1024 samples (detectBufferPitch's
// minimum). ~64ms covers 4+ periods of 70Hz, so YIN stays accurate at the low end.
const defaultWin = (sr: number) => Math.max(1024, Math.round(sr * 0.064))

/**
 * Box-average decimation to a lower sample rate. The averaging is a cheap
 * anti-alias low-pass — fine for pitch, which lives well below 1kHz. No-op when
 * the source is already at/below the target. Never mutates the caller's buffer.
 */
export function resampleMono(
  samples: Float32Array,
  srcRate: number,
  dstRate: number,
): { buf: Float32Array; rate: number } {
  if (!(dstRate > 0) || dstRate >= srcRate || samples.length === 0) {
    return { buf: samples, rate: srcRate }
  }
  const ratio  = srcRate / dstRate
  const outLen = Math.floor(samples.length / ratio)
  const out    = new Float32Array(outLen)
  for (let i = 0; i < outLen; i++) {
    const s0 = Math.floor(i * ratio)
    const s1 = Math.min(samples.length, Math.floor((i + 1) * ratio))
    let sum = 0, cnt = 0
    for (let j = s0; j < s1; j++) { sum += samples[j]; cnt++ }
    out[i] = cnt > 0 ? sum / cnt : (samples[s0] ?? 0)
  }
  return { buf: out, rate: dstRate }
}

interface ScanParams { win: number; rmsGate: number; sampleRate: number }

// One analysis window → one PitchFrame (RMS gate + YIN core via detectBufferPitch).
function scanFrame(buf: Float32Array, off: number, p: ScanParams): PitchFrame {
  const seg = buf.subarray(off, off + p.win)
  let sq = 0
  for (let i = 0; i < seg.length; i++) sq += seg[i] * seg[i]
  const rms = Math.sqrt(sq / seg.length)
  const amplitude = Math.min(1, rms * 4)   // scaling extractNoteEvents' 0.025 gate assumes

  let freq: number | null = null
  let midi: number | null = null
  if (rms >= p.rmsGate) {
    const det = detectBufferPitch(seg as Float32Array, p.sampleRate, 0)
    if (det) { freq = det.hz; midi = det.midi }
  }
  return { time: off / p.sampleRate, freq, amplitude, midi }
}

// Median filter over the MIDI track (ignoring unvoiced neighbors). Offline we can
// afford this stricter smoothing to kill single-frame octave flickers the
// real-time detector's IIR would pass through.
function medianFilterMidi(frames: PitchFrame[], rMed: number): PitchFrame[] {
  if (rMed === 0) return frames
  return frames.map((f, i) => {
    if (f.midi === null) return f
    const vals: number[] = []
    for (let k = -rMed; k <= rMed; k++) {
      const g = frames[i + k]
      if (g && g.midi !== null) vals.push(g.midi)
    }
    if (vals.length === 0) return f
    vals.sort((a, b) => a - b)
    const med = vals[Math.floor(vals.length / 2)]
    return med === f.midi ? f : { ...f, midi: med, freq: midiToFreq(med) }
  })
}

// Apply gain into a working copy (soft-clamped so an extreme boost can't produce
// out-of-range samples). Never mutates the caller's buffer.
const applyGain = (samples: Float32Array, gain: number): Float32Array =>
  gain === 1 ? samples : Float32Array.from(samples, v => clamp(v * gain, -1, 1))

/**
 * Scan a mono buffer at a fine hop, running the YIN core (detectBufferPitch) per
 * window, and build a PitchFrame[] in exactly the shape extractNoteEvents expects:
 *   { time, freq, amplitude(0-1, = min(1, rms*4)), midi }
 * A median filter over the MIDI track removes single-frame octave/semitone jumps.
 *
 * NOTE: this scans at `sampleRate` as-is — the downsample lives in notesFromBuffer.
 */
export function buildPitchCurve(
  samples: Float32Array,
  sampleRate: number,
  opts: BackfillOptions = {},
): PitchFrame[] {
  const gain    = opts.gain ?? 1
  const rmsGate = opts.rmsGate ?? 0.006
  const win     = opts.winSize ?? defaultWin(sampleRate)
  const hop     = Math.max(1, Math.round((opts.hopSec ?? 0.015) * sampleRate))
  const rMed    = Math.max(0, opts.medianRadius ?? 2)

  const buf = applyGain(samples, gain)
  if (buf.length < win) return []

  const p: ScanParams = { win, rmsGate, sampleRate }
  const frames: PitchFrame[] = []
  for (let off = 0; off + win <= buf.length; off += hop) frames.push(scanFrame(buf, off, p))
  return medianFilterMidi(frames, rMed)
}

function eventsToNotes(
  events: ReturnType<typeof extractNoteEvents>,
  minDuration: number,
): BackfillNote[] {
  return events.map(e => ({
    startSec: e.start,
    midi:     e.midi,
    durSec:   Math.max(minDuration, e.end - e.start),
    // e.amplitude is capped at 0.9 by extractNoteEvents; map to a 0.3–1 velocity.
    velocity: clamp(0.3 + e.amplitude, 0.3, 1),
  }))
}

/**
 * Full offline pass: mono Float32 buffer → discrete notes in the widget's shape
 * ({ startSec, midi, durSec, velocity }). Velocity is derived from the note's
 * average amplitude, clamped to a musical range.
 *
 * The buffer is downsampled to ~16kHz first (voice pitch << 1kHz), which shrinks
 * the YIN analysis window ~2.75× and its per-window cost ~7×.
 *
 * Pure + deterministic — safe to unit-test headlessly on synthesized audio.
 */
export function notesFromBuffer(
  samples: Float32Array,
  sampleRate: number,
  opts: BackfillOptions = {},
): BackfillNote[] {
  const minDuration = opts.minDuration ?? 0.08
  const { buf, rate } = resampleMono(samples, sampleRate, opts.targetSampleRate ?? DEFAULT_TARGET_SR)
  const curve = buildPitchCurve(buf, rate, opts)
  return eventsToNotes(extractNoteEvents(curve, minDuration), minDuration)
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Non-blocking variant of notesFromBuffer. Identical analysis (same downsample →
 * YIN scan → median → segment), but the per-window loop yields to the event loop
 * on a time budget so the UI stays responsive, and reports fractional progress
 * (0→1) via onProgress. Use this from the browser; notesFromBuffer stays as the
 * pure, synchronous unit-test entry point.
 */
export async function notesFromBufferAsync(
  samples: Float32Array,
  sampleRate: number,
  opts: BackfillOptions = {},
  onProgress?: (frac: number) => void,
): Promise<BackfillNote[]> {
  const minDuration = opts.minDuration ?? 0.08
  const rMed        = Math.max(0, opts.medianRadius ?? 2)
  const { buf: ds, rate } = resampleMono(samples, sampleRate, opts.targetSampleRate ?? DEFAULT_TARGET_SR)

  const gain    = opts.gain ?? 1
  const rmsGate = opts.rmsGate ?? 0.006
  const win     = opts.winSize ?? defaultWin(rate)
  const hop     = Math.max(1, Math.round((opts.hopSec ?? 0.015) * rate))
  const buf     = applyGain(ds, gain)

  if (buf.length < win) { onProgress?.(1); return [] }

  const p: ScanParams = { win, rmsGate, sampleRate: rate }
  const frames: PitchFrame[] = []
  const end = buf.length - win
  let lastYield = nowMs()
  for (let off = 0; off + win <= buf.length; off += hop) {
    frames.push(scanFrame(buf, off, p))
    if (nowMs() - lastYield >= 12) {          // ~12ms work budget between yields
      onProgress?.(Math.min(0.97, end > 0 ? off / end : 1))
      await new Promise<void>(r => setTimeout(r, 0))
      lastYield = nowMs()
    }
  }
  const curve = medianFilterMidi(frames, rMed)
  const notes = eventsToNotes(extractNoteEvents(curve, minDuration), minDuration)
  onProgress?.(1)
  return notes
}

export interface GridOptions {
  /** Take tempo in BPM. */
  bpm:         number
  /** Seconds from the recording start to the first downbeat the user HEARD.
   *  The grid is phase-anchored: a grid line sits at phaseSec + k*step for every
   *  integer k (k may be negative, so the grid extends back before phaseSec).
   *  Default 0 → treat record-start as beat 0. */
  phaseSec?:   number
  /** Grid subdivision: 1 = quarter, 2 = eighth, 4 = sixteenth. Default 2. */
  division?:   number
  /** Snap radius as a FRACTION of one grid step. A note whose onset is farther
   *  than tolerance*step from its nearest grid line is left where it is (and
   *  flagged offGrid) instead of being yanked to the wrong beat. Default 0.6. */
  tolerance?:  number
}

/**
 * Confirm-and-correct a take against the metronome's beat grid.
 *
 * Because the take was sung to a click at a known BPM, the true onsets lie on a
 * phase-anchored grid the singer actually heard. This pass snaps each detected
 * onset to its nearest grid line — but ONLY when it's already close (within
 * tolerance*step). A note that sits far from every grid line is NOT dragged to a
 * beat it was never near; it's left in place and flagged `offGrid`, so a genuine
 * syncopation or a mis-detection can't be silently mangled.
 *
 * Durations are snapped to a whole number of steps (min one step). Pitch and
 * velocity are preserved. Notes stay sorted by onset; if two notes land on the
 * same grid line with the same pitch after snapping, they're merged (the louder
 * velocity and longer duration win) so the correction can't spawn duplicates.
 *
 * Pure, deterministic, side-effect-free — safe to unit-test headlessly.
 */
export function alignToGrid(
  notes: BackfillNote[],
  { bpm, phaseSec = 0, division = 2, tolerance = 0.4 }: GridOptions,
): BackfillNote[] {
  const step = 60 / bpm / division
  // Guard: unusable tempo/grid → return an untouched copy, never throw.
  if (!Number.isFinite(step) || step <= 0 || notes.length === 0) {
    return notes.map(n => ({ ...n }))
  }
  const phase = Number.isFinite(phaseSec) ? phaseSec : 0
  const tol   = Math.max(0, tolerance) * step

  // 1) Confirm/correct each onset against the nearest phase-anchored grid line.
  const corrected: BackfillNote[] = notes.map(n => {
    const k        = Math.round((n.startSec - phase) / step)
    const gridLine = phase + k * step
    const onGrid   = Math.abs(n.startSec - gridLine) <= tol
    const durSec   = Math.max(step, Math.round(n.durSec / step) * step)
    return {
      startSec: onGrid ? gridLine : n.startSec,
      midi:     n.midi,
      durSec,
      velocity: n.velocity,
      offGrid:  !onGrid,
    }
  })

  // 2) Deterministic order: by onset, then pitch (so same grid-line + pitch are adjacent).
  corrected.sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)

  // 3) Merge collisions on the same grid line + pitch: keep louder + longer.
  const eps = step * 1e-6
  const out: BackfillNote[] = []
  for (const n of corrected) {
    const prev = out[out.length - 1]
    if (prev && prev.midi === n.midi && Math.abs(prev.startSec - n.startSec) <= eps) {
      prev.velocity = Math.max(prev.velocity, n.velocity)
      prev.durSec   = Math.max(prev.durSec, n.durSec)
      prev.offGrid  = prev.offGrid && n.offGrid   // only "offGrid" if neither was confirmed
      continue
    }
    out.push({ ...n })
  }
  return out
}
