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
  /** Analysis hop in seconds (time resolution of the pitch curve). Default 0.010 (10ms) —
   *  a fine hop so onset/offset boundaries land within ~one frame. */
  hopSec?:       number
  /** Analysis window size in samples. Default scales to the (downsampled) rate,
   *  ~60ms and ≥1024, YIN-safe down to ~90 Hz (6 periods at typical voice f0). This
   *  is the main time-resolution lever: a SHORTER window (down from ~90ms) lets a
   *  quick note be pitched from its own samples instead of being averaged with its
   *  neighbours, at a small cost to stability on the lowest sustains (< ~A2 / ~110Hz). */
  winSize?:      number
  /** Half-width of the median filter over the MIDI track (kills single-frame octave
   *  flickers). Default 1 → 3-frame median — small enough that a genuine quick note
   *  change survives, big enough to drop lone flickers. */
  medianRadius?: number
  /** Half-width (in frames) of the neighbourhood used by the octave-consistency
   *  pass. A voiced frame that sits ~12 semitones (±1) off its neighbours' median
   *  is snapped back to their octave (voice harmonics make YIN octave-jump). Kept
   *  LOCAL so a genuinely quick note isn't "corrected" toward its neighbours — only
   *  true ~±12 harmonic jumps (which persist across a note's body, so a tight
   *  neighbourhood still sees them) get folded. Pass 0 to disable. Default 2
   *  (~±20ms at the default 10ms hop). */
  octaveRadius?: number
  /** Downsample target rate (Hz) applied before the pitch scan. Voice pitch is well
   *  under 1 kHz, so ~22 kHz keeps full YIN resolution across the vocal range while
   *  still being cheaper than 44.1k. Pass 0 / >= source rate to skip. Default 22050. */
  targetSampleRate?: number
  /** Re-pitch each segmented note from its STABLE (post-attack) portion instead of
   *  trusting the onset frame. A sung note's attack scoops — it starts sharp/flat and
   *  slides into the true pitch over the first tens of ms — and extractNoteEvents locks
   *  the note pitch to that first frame, so short notes (mostly attack) come out ~1
   *  semitone off. This post-pass ignores the attack transient and recomputes a robust
   *  center pitch. Default true. Pass false to get the raw onset-locked pitch. */
  repitch?:        boolean
  /** Seconds of the note ONSET to skip when re-pitching (the scoop lives here). Capped
   *  at maxSkipFrac of the note's duration so short notes keep their majority. Default 0.04. */
  attackSkipSec?:  number
  /** Cap on the attack (and release) skip as a FRACTION of the note's duration, so a
   *  very short note still keeps a stable majority to pitch from. Default 0.35. */
  maxSkipFrac?:    number
  /** Seconds of the note RELEASE (tail) to also drop when re-pitching (pitch often sags
   *  as a note dies). Capped at maxSkipFrac of the duration. Default 0.01. */
  releaseSkipSec?: number
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// 22.05 kHz keeps full pitch resolution across the vocal range (voice f0 << 1 kHz)
// while halving the sample count vs 44.1k. Higher fidelity than the old 16 kHz.
const DEFAULT_TARGET_SR = 22050
// Fine hop (10ms) so onset/offset boundaries land within ~one frame.
const DEFAULT_HOP_SEC = 0.010
// Neighbourhood (frames) for the octave-consistency correction — kept small/LOCAL
// (~±20ms) so a real quick note isn't dragged toward its neighbours; a true octave
// harmonic jump persists across a note's body, so this tight window still catches it.
const DEFAULT_OCTAVE_RADIUS = 2
// Onset window to ignore when re-pitching a note (the sung attack scoops here).
const DEFAULT_ATTACK_SKIP_SEC  = 0.04
// Never skip more than this fraction of a note's duration (keeps short notes usable).
const DEFAULT_MAX_SKIP_FRAC    = 0.35
// Release tail to also drop when re-pitching (pitch tends to sag as a note dies).
const DEFAULT_RELEASE_SKIP_SEC = 0.01
// Minimum stable frames needed before we trust the post-attack window; below this we
// fall back to the median of ALL the note's voiced frames.
const MIN_STABLE_FRAMES        = 3

// Window that spans ~60ms and is at least 1024 samples (detectBufferPitch's
// minimum). ~60ms still covers 6 periods of ~100Hz (typical voice f0) so YIN locks
// the fundamental, but is short enough that a quick (~90–120ms) note is pitched from
// mostly its OWN samples instead of being smeared with its neighbours — the main
// time-resolution lever (was ~90ms, which averaged short notes with their neighbours).
// 60ms was picked over 55ms in verification: 55ms recovered no more quick notes but
// dropped solidly-in-range low SUSTAINED notes (A2/G2/F2, ~87–110Hz) below YIN's
// lock, whereas 60ms keeps every quick-note gain AND those low sustains.
const defaultWin = (sr: number) => Math.max(1024, Math.round(sr * 0.06))

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

/**
 * Octave-consistency correction — the single biggest real-voice accuracy win.
 *
 * A sung vowel is harmonic-rich, so YIN (and any autocorrelation method) will
 * occasionally lock onto the 2nd harmonic and report a pitch an octave HIGH (or,
 * on a strong sub-fundamental, an octave LOW) for a stretch of frames. A small
 * median filter can't fix a jump that persists across several frames.
 *
 * For each voiced frame we take the median MIDI of its voiced neighbours and, if
 * this frame sits ~12 semitones (±1, to tolerate detection wobble) — or ~24 — off
 * that median, we fold it back by whole octaves toward the neighbourhood. Frames
 * genuinely a different note (not an octave multiple away) are left untouched, so
 * real melodic leaps survive; only octave doublings are collapsed.
 *
 * Offline-only: it needs the whole track's context, so it never runs in the live
 * detector (which must stay causal/real-time).
 */
function correctOctaves(frames: PitchFrame[], radius: number): PitchFrame[] {
  if (radius <= 0) return frames
  // Snapshot the pre-correction MIDIs so each decision uses the ORIGINAL
  // neighbourhood (not one already being rewritten left-to-right).
  const orig = frames.map(f => f.midi)
  return frames.map((f, i) => {
    if (f.midi === null) return f
    const vals: number[] = []
    for (let k = -radius; k <= radius; k++) {
      if (k === 0) continue
      const m = orig[i + k]
      if (m !== null && m !== undefined) vals.push(m)
    }
    if (vals.length < 2) return f                       // not enough context to trust
    vals.sort((a, b) => a - b)
    const med     = vals[Math.floor(vals.length / 2)]
    const diff    = f.midi - med
    const octaves = Math.round(diff / 12)
    // Fold only when the offset is (near) a whole number of octaves — leave true
    // melodic intervals (3rds, 5ths, …) alone.
    if (octaves !== 0 && Math.abs(diff - octaves * 12) <= 1) {
      const snapped = f.midi - octaves * 12
      return { ...f, midi: snapped, freq: midiToFreq(snapped) }
    }
    return f
  })
}

// Offline refine pipeline over the raw MIDI track: median (kill single-frame
// flickers) → octave fold (kill multi-frame harmonic jumps) → median again
// (smooth any residual at the fold boundaries). Order matters: the octave pass
// wants an already-de-flickered track so its neighbour medians are clean.
function refinePitchTrack(frames: PitchFrame[], rMed: number, octaveRadius: number): PitchFrame[] {
  let out = medianFilterMidi(frames, rMed)
  out = correctOctaves(out, octaveRadius)
  out = medianFilterMidi(out, rMed)
  return out
}

// Apply gain into a working copy (soft-clamped so an extreme boost can't produce
// out-of-range samples). Never mutates the caller's buffer.
const applyGain = (samples: Float32Array, gain: number): Float32Array =>
  gain === 1 ? samples : Float32Array.from(samples, v => clamp(v * gain, -1, 1))

// RAW per-frame pitch scan (pre-refine): apply gain, then one PitchFrame per
// analysis window at the fine hop. This is the "what the detector actually heard"
// track — before the median/octave-fold correction — so octave jumps and flicker
// are still present. Shared by buildPitchCurve, analyzeBuffer, and the async pass.
//
// NOTE: scans at `sampleRate` as-is — the downsample lives in the callers.
function scanBuffer(
  samples: Float32Array,
  sampleRate: number,
  opts: BackfillOptions,
): PitchFrame[] {
  const gain    = opts.gain ?? 1
  const rmsGate = opts.rmsGate ?? 0.006
  const win     = opts.winSize ?? defaultWin(sampleRate)
  const hop     = Math.max(1, Math.round((opts.hopSec ?? DEFAULT_HOP_SEC) * sampleRate))

  const buf = applyGain(samples, gain)
  if (buf.length < win) return []

  const p: ScanParams = { win, rmsGate, sampleRate }
  const frames: PitchFrame[] = []
  for (let off = 0; off + win <= buf.length; off += hop) frames.push(scanFrame(buf, off, p))
  return frames
}

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
  const rMed = Math.max(0, opts.medianRadius ?? 1)
  const octR = Math.max(0, opts.octaveRadius ?? DEFAULT_OCTAVE_RADIUS)
  return refinePitchTrack(scanBuffer(samples, sampleRate, opts), rMed, octR)
}

/**
 * Result of a full offline analysis pass — both the notes AND the pitch curves the
 * segmentation was built from, so a debug view can overlay "what it heard" against
 * "what it wrote".
 *
 * TIME BASE: every PitchFrame.time is seconds from the take start (it's off/rate
 * after the downsample), identical to how each BackfillNote.startSec is measured —
 * so the curves align 1:1 on a shared time axis with the notes without any rescale.
 */
export interface BufferAnalysis {
  /** Discrete notes (the offline transcription) — same as notesFromBuffer. */
  notes:    BackfillNote[]
  /** POST-refine pitch track (median → octave-fold → median) — the exact curve
   *  that fed segmentation. Its `freq`/`midi` are semitone-snapped by the refine. */
  curve:    PitchFrame[]
  /** PRE-refine per-frame pitch (raw YIN output) — octave jumps/flicker intact, so
   *  divergence from `curve` shows what the correction fixed. `freq` is exact Hz. */
  rawCurve: PitchFrame[]
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

// Fractional (un-rounded) MIDI for a voiced frame. The refine pipeline snaps
// PitchFrame.midi to whole semitones, but for a robust CENTER we want the finer
// pitch: derive it from the frame's exact Hz when present, else the integer midi.
function fractionalMidi(f: PitchFrame): number {
  if (f.freq !== null && f.freq > 0) return 69 + 12 * Math.log2(f.freq / 440)
  return f.midi ?? 0
}

// Amplitude-weighted median of {value, weight} pairs. The median is robust to the
// scoop/outlier frames a mean would be dragged by; weighting by amplitude lets the
// loud, settled body of the note outvote quiet edge frames.
function weightedMedian(pairs: { v: number; w: number }[]): number {
  if (pairs.length === 0) return 0
  const sorted = pairs.slice().sort((a, b) => a.v - b.v)
  const total  = sorted.reduce((s, x) => s + x.w, 0)
  if (!(total > 0)) return sorted[Math.floor(sorted.length / 2)].v   // all-zero weights → plain median
  const half = total / 2
  let cum = 0
  for (const x of sorted) {
    cum += x.w
    if (cum >= half) return x.v
  }
  return sorted[sorted.length - 1].v
}

/**
 * Re-pitch each note from its STABLE (settled) portion, ignoring the attack scoop.
 *
 * WHY: a sung note's onset scoops — it starts sharp/flat and slides into the true
 * pitch over the first tens of ms (worst on a high→low jump). extractNoteEvents locks
 * a note's pitch to its FIRST voiced frame, which lands squarely in that transient, so
 * short notes (mostly attack) come out ~1 semitone off. Instead of trusting the onset,
 * we look at the note's body.
 *
 * For each note we:
 *   1. gather the voiced curve frames inside [startSec, startSec+durSec],
 *   2. drop the first `attackSkipSec` (the scoop) — but never more than `maxSkipFrac`
 *      of the note's duration, so a short note keeps its majority — and optionally the
 *      last `releaseSkipSec` (the dying tail),
 *   3. from the remaining "stable" frames take an amplitude-weighted median of the
 *      fractional MIDI (robust to any residual scoop) and round to the nearest semitone.
 * If too few stable frames survive (very short note), we fall back to the median of ALL
 * the note's voiced frames — still better than the single onset frame.
 *
 * Operates on the OCTAVE-CORRECTED curve. Pure/deterministic. Only the notes' `midi`
 * changes; start/dur/velocity — and the displayed curves — are untouched, so the debug
 * view keeps showing the scoop while the notes now sit on the settled pitch.
 */
export function repitchNotes(
  notes: BackfillNote[],
  curve: PitchFrame[],
  opts: BackfillOptions = {},
): BackfillNote[] {
  const attackSkipSec  = Math.max(0, opts.attackSkipSec  ?? DEFAULT_ATTACK_SKIP_SEC)
  const maxSkipFrac    = clamp(opts.maxSkipFrac ?? DEFAULT_MAX_SKIP_FRAC, 0, 0.49)
  const releaseSkipSec = Math.max(0, opts.releaseSkipSec ?? DEFAULT_RELEASE_SKIP_SEC)
  if (curve.length === 0) return notes.map(n => ({ ...n }))

  const EPS = 1e-9
  return notes.map(n => {
    const start = n.startSec
    const end   = n.startSec + n.durSec
    const dur   = Math.max(0, n.durSec)
    const cap   = maxSkipFrac * dur
    const skip  = Math.min(attackSkipSec,  cap)
    const rel   = Math.min(releaseSkipSec, cap)
    const stableStart = start + skip
    const stableEnd   = end   - rel

    // All voiced frames inside the note span (the fallback pool).
    const inSpan = curve.filter(f => f.midi !== null && f.time >= start - EPS && f.time <= end + EPS)
    if (inSpan.length === 0) return { ...n }

    // Post-attack, pre-release "stable" frames; fall back to the whole span if too few.
    let stable = inSpan.filter(f => f.time >= stableStart - EPS && f.time <= stableEnd + EPS)
    if (stable.length < MIN_STABLE_FRAMES) stable = inSpan

    const center = weightedMedian(stable.map(f => ({ v: fractionalMidi(f), w: Math.max(1e-6, f.amplitude) })))
    return { ...n, midi: Math.round(center) }
  })
}

/**
 * Full offline pass returning BOTH the notes and the pitch curves they came from:
 * mono Float32 buffer → { notes, curve (post-refine), rawCurve (pre-refine) }.
 *
 * The buffer is downsampled to ~22kHz first (voice pitch << 1kHz), scanned into a
 * raw PitchFrame[] (rawCurve), refined (median → octave-fold → median → curve),
 * then segmented into notes. Because the scan runs on the DOWNSAMPLED buffer, every
 * frame time is already in seconds and shares the notes' time base (see BufferAnalysis).
 *
 * This is the single analysis core: notesFromBuffer delegates to it for its notes,
 * and the debug pitch-curve view reads its curve/rawCurve. Pure + deterministic —
 * safe to unit-test headlessly on synthesized audio.
 */
export function analyzeBuffer(
  samples: Float32Array,
  sampleRate: number,
  opts: BackfillOptions = {},
): BufferAnalysis {
  const minDuration = opts.minDuration ?? 0.08
  const rMed = Math.max(0, opts.medianRadius ?? 1)
  const octR = Math.max(0, opts.octaveRadius ?? DEFAULT_OCTAVE_RADIUS)
  const { buf, rate } = resampleMono(samples, sampleRate, opts.targetSampleRate ?? DEFAULT_TARGET_SR)
  const rawCurve = scanBuffer(buf, rate, opts)
  const curve    = refinePitchTrack(rawCurve, rMed, octR)
  let   notes    = eventsToNotes(extractNoteEvents(curve, minDuration), minDuration)
  // Re-pitch from each note's settled portion (ignore the onset scoop). Changes the
  // NOTES only — the curve/rawCurve stay as-detected so the debug view still shows it.
  if (opts.repitch !== false) notes = repitchNotes(notes, curve, opts)
  return { notes, curve, rawCurve }
}

/**
 * Full offline pass: mono Float32 buffer → discrete notes in the widget's shape
 * ({ startSec, midi, durSec, velocity }). Velocity is derived from the note's
 * average amplitude, clamped to a musical range.
 *
 * The buffer is downsampled to ~22kHz first (voice pitch << 1kHz), then scanned
 * with a long stability window + fine hop, a median filter, and an octave-fold
 * pass. Higher fidelity than the old 16kHz/64ms setup — slower, but more accurate.
 *
 * Pure + deterministic — safe to unit-test headlessly on synthesized audio.
 * Delegates to analyzeBuffer (which also exposes the pitch curves).
 */
export function notesFromBuffer(
  samples: Float32Array,
  sampleRate: number,
  opts: BackfillOptions = {},
): BackfillNote[] {
  return analyzeBuffer(samples, sampleRate, opts).notes
}

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Non-blocking variant of analyzeBuffer. Identical analysis (same downsample → YIN
 * scan → median → octave-fold → segment) returning notes + both pitch curves, but
 * the per-window scan loop yields to the event loop on a time budget so the UI stays
 * responsive, and reports fractional progress (0→1) via onProgress. Use this from
 * the browser; analyzeBuffer/notesFromBuffer stay as the pure, synchronous entries.
 */
export async function analyzeBufferAsync(
  samples: Float32Array,
  sampleRate: number,
  opts: BackfillOptions = {},
  onProgress?: (frac: number) => void,
): Promise<BufferAnalysis> {
  const minDuration = opts.minDuration ?? 0.08
  const rMed        = Math.max(0, opts.medianRadius ?? 1)
  const octR        = Math.max(0, opts.octaveRadius ?? DEFAULT_OCTAVE_RADIUS)
  const { buf: ds, rate } = resampleMono(samples, sampleRate, opts.targetSampleRate ?? DEFAULT_TARGET_SR)

  const gain    = opts.gain ?? 1
  const rmsGate = opts.rmsGate ?? 0.006
  const win     = opts.winSize ?? defaultWin(rate)
  const hop     = Math.max(1, Math.round((opts.hopSec ?? DEFAULT_HOP_SEC) * rate))
  const buf     = applyGain(ds, gain)

  if (buf.length < win) { onProgress?.(1); return { notes: [], curve: [], rawCurve: [] } }

  const p: ScanParams = { win, rmsGate, sampleRate: rate }
  const rawCurve: PitchFrame[] = []
  const end = buf.length - win
  let lastYield = nowMs()
  for (let off = 0; off + win <= buf.length; off += hop) {
    rawCurve.push(scanFrame(buf, off, p))
    if (nowMs() - lastYield >= 12) {          // ~12ms work budget between yields
      onProgress?.(Math.min(0.97, end > 0 ? off / end : 1))
      await new Promise<void>(r => setTimeout(r, 0))
      lastYield = nowMs()
    }
  }
  const curve = refinePitchTrack(rawCurve, rMed, octR)
  let   notes = eventsToNotes(extractNoteEvents(curve, minDuration), minDuration)
  if (opts.repitch !== false) notes = repitchNotes(notes, curve, opts)
  onProgress?.(1)
  return { notes, curve, rawCurve }
}

/**
 * Non-blocking variant of notesFromBuffer — the notes-only projection of
 * analyzeBufferAsync (kept for callers that don't need the pitch curves).
 */
export async function notesFromBufferAsync(
  samples: Float32Array,
  sampleRate: number,
  opts: BackfillOptions = {},
  onProgress?: (frac: number) => void,
): Promise<BackfillNote[]> {
  return (await analyzeBufferAsync(samples, sampleRate, opts, onProgress)).notes
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
