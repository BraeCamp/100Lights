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
  type NoteEvent,
} from '@/lib/pitch-detector'
// Reuse the existing radix-2 FFT (no new dep) for per-window spectral flux.
import { fft } from '@/scripts/listen-analyzer.mjs'

/**
 * A PitchFrame plus the per-frame ACOUSTIC evidence the onset-aware segmenter uses
 * to decide note boundaries beyond pitch alone. It's a strict SUPERSET of PitchFrame
 * (time/freq/amplitude/midi), so a FeatureFrame[] flows unchanged into extractNoteEvents
 * and the existing curve consumers — the extra fields are simply ignored there.
 *
 *  · flux         spectral flux / onset strength: half-wave-rectified sum of the
 *                 per-bin magnitude INCREASE vs the previous window's FFT. Spikes at
 *                 an attack (even when the pitch doesn't change) — the re-articulation cue.
 *  · clarity      the YIN confidence for this frame (0 when unvoiced). Higher = the
 *                 detected pitch is more trustworthy; used to weight/ignore pitch.
 *  · energyDelta  RMS(frame) − RMS(prevFrame): a fast attack detector that complements
 *                 flux (loudness jump on a re-hit).
 *  · pitchDelta   |midi − prevMidi| in semitones across consecutive voiced frames
 *                 (glide vs held) — 0 when either frame is unvoiced.
 *  · rms          the raw (pre-scaling) RMS of the window.
 */
export interface FeatureFrame extends PitchFrame {
  flux:        number
  clarity:     number
  energyDelta: number
  pitchDelta:  number
  rms:         number
}

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
  /** Use the ONSET-AWARE segmenter (combine spectral-flux/energy onsets WITH the pitch
   *  rule) instead of the pitch-only baseline. This is what recovers RE-ARTICULATIONS —
   *  the same/adjacent pitch sung again with no gap, which pitch-alone merges into one
   *  note. Default true. Pass false to A/B against the pure pitch-only segmentation. */
  useOnsets?:      boolean
  /** Onset peak-pick sensitivity, 0→1. Maps to the adaptive threshold k = mean + k·std
   *  over a local flux window: HIGHER sensitivity ⇒ lower k ⇒ more onsets detected (more
   *  splits); lower ⇒ stricter (fewer). Default 0.5. */
  onsetSensitivity?: number
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
// Onset peak-pick sensitivity default (0→1; higher = more onsets). See BackfillOptions.
const DEFAULT_ONSET_SENS       = 0.5
// Cap on the FFT size used for the per-window spectral-flux (perf; power of 2).
const FLUX_MAX_FFT             = 2048
// Spectral flux is summed into this many linear frequency BANDS before differencing.
// Band-summing averages out the per-bin leakage jitter a steady tone otherwise shows
// (which made a held note's raw per-bin flux spike erratically), so a sustained note
// reads as ~zero flux while a real attack — which moves every band — still spikes.
const FLUX_BANDS               = 32

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

// Largest power of two ≤ n (≥1). Used to size the flux FFT to fit inside the
// analysis window while satisfying the radix-2 FFT's power-of-2 length requirement.
function pow2Down(n: number): number { let p = 1; while (p * 2 <= n) p *= 2; return p }

// Rolling state for the feature scan: the flux FFT is comparative (this window's
// magnitude spectrum vs the previous window's), so we carry prevMag/prevRms/prevMidi
// across frames. Scratch FFT buffers (re/im) are reused to avoid per-frame allocation.
interface ScanState {
  fftSize: number
  hann:    Float64Array
  re:      Float64Array
  im:      Float64Array
  band:    Float64Array   // scratch: this window's per-band magnitude sums
  prevBand: Float64Array  // previous window's per-band sums (for the flux difference)
  prevRms: number
  prevMidi: number | null
  first:   boolean
}

function makeScanState(win: number): ScanState {
  const fftSize = Math.min(FLUX_MAX_FFT, Math.max(256, pow2Down(win)))
  const hann = new Float64Array(fftSize)
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1))
  return {
    fftSize, hann,
    re: new Float64Array(fftSize), im: new Float64Array(fftSize),
    band: new Float64Array(FLUX_BANDS), prevBand: new Float64Array(FLUX_BANDS),
    prevRms: 0, prevMidi: null, first: true,
  }
}

// One analysis window → one FeatureFrame: the YIN pitch (RMS-gated, via
// detectBufferPitch, now also exposing its confidence as `clarity`) PLUS the acoustic
// evidence — spectral flux (onset strength), energyDelta (attack), pitchDelta (glide vs
// held). `st` MUST be advanced frame-by-frame in time order (flux/energyDelta are deltas).
function scanFeatureFrame(buf: Float32Array, off: number, p: ScanParams, st: ScanState): FeatureFrame {
  const seg = buf.subarray(off, off + p.win)
  let sq = 0
  for (let i = 0; i < seg.length; i++) sq += seg[i] * seg[i]
  const rms = Math.sqrt(sq / seg.length)
  const amplitude = Math.min(1, rms * 4)   // scaling extractNoteEvents' 0.025 gate assumes

  let freq: number | null = null
  let midi: number | null = null
  let clarity = 0
  if (rms >= p.rmsGate) {
    const det = detectBufferPitch(seg as Float32Array, p.sampleRate, 0)
    if (det) { freq = det.hz; midi = det.midi; clarity = det.confidence }
  }

  // Spectral flux: FFT this window (Hann), sum bin magnitudes into FLUX_BANDS linear
  // bands, then half-wave-rectify the per-BAND increase vs the previous window. Banding
  // averages out per-bin leakage jitter so a sustained note reads ~0 flux (only a real
  // attack moves the bands). Zero-padded if the window runs past the buffer end (only
  // possible for a tiny custom winSize; the default win ≥ fftSize).
  const { fftSize, hann, re, im, band, prevBand } = st
  const half = fftSize >> 1
  for (let i = 0; i < fftSize; i++) { re[i] = (off + i < buf.length ? buf[off + i] : 0) * hann[i]; im[i] = 0 }
  fft(re, im)
  const nb = band.length
  band.fill(0)
  const binsPerBand = (half - 1) / nb
  for (let i = 1; i < half; i++) {
    const b = Math.min(nb - 1, Math.floor((i - 1) / binsPerBand))
    band[b] += Math.sqrt(re[i] * re[i] + im[i] * im[i])
  }
  let flux = 0
  for (let b = 0; b < nb; b++) {
    const d = band[b] - prevBand[b]
    if (d > 0) flux += d
    prevBand[b] = band[b]
  }
  // The first frame has no predecessor — its "flux" would be the whole spectrum; zero it
  // so it can't dominate the adaptive threshold (the note still opens on the first voiced frame).
  if (st.first) { flux = 0; st.first = false }

  const energyDelta = rms - st.prevRms
  st.prevRms = rms
  const pitchDelta = (midi !== null && st.prevMidi !== null) ? Math.abs(midi - st.prevMidi) : 0
  st.prevMidi = midi

  return { time: off / p.sampleRate, freq, amplitude, midi, flux, clarity, energyDelta, pitchDelta, rms }
}

// Median filter over the MIDI track (ignoring unvoiced neighbors). Offline we can
// afford this stricter smoothing to kill single-frame octave flickers the
// real-time detector's IIR would pass through.
function medianFilterMidi<T extends PitchFrame>(frames: T[], rMed: number): T[] {
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
    return med === f.midi ? f : { ...f, midi: med, freq: midiToFreq(med) } as T
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
function correctOctaves<T extends PitchFrame>(frames: T[], radius: number): T[] {
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
      return { ...f, midi: snapped, freq: midiToFreq(snapped) } as T
    }
    return f
  })
}

// Offline refine pipeline over the raw MIDI track: median (kill single-frame
// flickers) → octave fold (kill multi-frame harmonic jumps) → median again
// (smooth any residual at the fold boundaries). Order matters: the octave pass
// wants an already-de-flickered track so its neighbour medians are clean.
function refinePitchTrack<T extends PitchFrame>(frames: T[], rMed: number, octaveRadius: number): T[] {
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
): FeatureFrame[] {
  const gain    = opts.gain ?? 1
  const rmsGate = opts.rmsGate ?? 0.006
  const win     = opts.winSize ?? defaultWin(sampleRate)
  const hop     = Math.max(1, Math.round((opts.hopSec ?? DEFAULT_HOP_SEC) * sampleRate))

  const buf = applyGain(samples, gain)
  if (buf.length < win) return []

  const p: ScanParams = { win, rmsGate, sampleRate }
  const st = makeScanState(win)
  const frames: FeatureFrame[] = []
  for (let off = 0; off + win <= buf.length; off += hop) frames.push(scanFeatureFrame(buf, off, p, st))
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
  /** Detected onset times (seconds, same time base as the curves/notes) — where the
   *  onset-aware segmenter decided a note (re)starts. Empty when useOnsets is off.
   *  Optional so older callers keep type-checking. */
  onsets?:  number[]
  /** Per-frame onset-strength (spectral flux), NORMALIZED to 0–1, aligned index-for-index
   *  with `curve` — the evidence lane the debug overlay draws. Optional/back-compat. */
  flux?:    number[]
  /** Per-frame YIN clarity/confidence (0–1), aligned index-for-index with `curve`. Lets
   *  the overlay fade low-confidence frames. Optional/back-compat. */
  clarity?: number[]
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

// ── Onset detection (backfill-local) ──────────────────────────────────────────
/**
 * Adaptive peak-pick over spectral flux, CORROBORATED by an energy attack, to find note
 * (re)starts.
 *
 * Two evidence layers combine (a flux spike ALONE isn't enough):
 *   1. FLUX peak — a local max of the (max-normalized) spectral flux that also clears a
 *      moving threshold (mean + k·std over a ±~100ms window), a small absolute floor, and
 *      a local-baseline ratio, at least a refractory gap (~70ms) after the last onset.
 *   2. ENERGY corroboration — a real note (re)start carries a fresh ATTACK: the short-term
 *      RMS RISES across the frame, or there's a brief RMS DIP right at it (the note
 *      momentarily lets go before the re-hit). A SUSTAINED tone has neither, so its
 *      periodic flux-leakage ripple (which banding alone can't fully suppress) is rejected
 *      — this is what prevents a held note from over-splitting.
 *
 * Returns FRAME INDICES (into `frames`), ascending. k is derived from `sensitivity`
 * (higher sensitivity ⇒ lower k ⇒ more onsets).
 */
function detectOnsetFrames(frames: FeatureFrame[], hopSec: number, sensitivity: number): number[] {
  const n = frames.length
  if (n < 3) return []

  // Max-normalize the flux → the onset-strength signal `os`.
  let fluxMax = 1e-9, peakRms = 1e-9
  for (const f of frames) {
    if (f.flux > fluxMax) fluxMax = f.flux
    if (f.rms > peakRms) peakRms = f.rms
  }
  const os = new Float64Array(n)
  for (let i = 0; i < n; i++) os[i] = frames[i].flux / fluxMax

  const W          = Math.max(3, Math.round(0.10 / hopSec))   // ±~100ms threshold window
  const k          = 2.2 - 2.0 * clamp(sensitivity, 0, 1)     // 0→2.2 strict … 1→0.2 loose
  const refractory = Math.max(1, Math.round(0.07 / hopSec))   // ~70ms: one attack = one onset
  const FLOOR      = 0.06                                     // ignore near-silence wiggle
  // A peak must also exceed the LOCAL baseline by this factor (normalization-by-max alone
  // inflates a quiet track's ripple; a real attack is many× the local baseline).
  const MIN_RATIO  = 1.8
  const RISE_THR   = 0.05 * peakRms                           // energy-rise significance
  const ER         = Math.max(1, Math.round(0.04 / hopSec))   // ±~40ms energy compare span

  const meanRms = (lo: number, hi: number) => {
    let s = 0, c = 0
    for (let j = lo; j <= hi; j++) { s += frames[j].rms; c++ }
    return c > 0 ? s / c : 0
  }

  const onsets: number[] = []
  let last = -1e9
  for (let i = 1; i < n - 1; i++) {
    const v = os[i]
    if (v < FLOOR || v < os[i - 1] || v <= os[i + 1]) continue   // must be a local peak
    if (i - last < refractory) continue
    // (1) Local moving mean+std over [i-W, i+W].
    const lo = Math.max(0, i - W), hi = Math.min(n - 1, i + W)
    let sum = 0, sum2 = 0, cnt = 0
    for (let j = lo; j <= hi; j++) { sum += os[j]; sum2 += os[j] * os[j]; cnt++ }
    const mean = sum / cnt
    const std  = Math.sqrt(Math.max(0, sum2 / cnt - mean * mean))
    if (!(v > mean + k * std && v > mean * MIN_RATIO)) continue
    // (2) Energy corroboration: a rise across the frame OR a local RMS dip (a re-hit).
    const rmsBefore = meanRms(Math.max(0, i - ER), i - 1)
    const rmsAfter  = meanRms(i + 1, Math.min(n - 1, i + ER))
    let mn = Infinity
    for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) if (frames[j].rms < mn) mn = frames[j].rms
    const rise = (rmsAfter - rmsBefore) > RISE_THR
    const dip  = mn < 0.82 * Math.min(rmsBefore, rmsAfter)
    if (rise || dip) { onsets.push(i); last = i }
  }
  return onsets
}

// ── Onset-aware combined segmenter (backfill-local; NOT extractNoteEvents) ─────
// Threshold above which a clarity-weighted running-mean pitch move opens a new note
// (semitones). Kept > a semitone-and-a-half of typical vibrato so a held/vibrato note
// doesn't over-split, while a real melodic step still fires. The onset path is what
// catches SAME-pitch and adjacent re-articulations that this pitch rule can't see.
const PITCH_SPLIT_SEMI = 0.7
// A note younger than this can't be split by an onset — prevents the note's OWN attack
// (which is an onset) from immediately closing it, and suppresses double-triggers.
const MIN_ONSET_SPLIT_SEC = 0.05
// Below this clarity a frame's pitch is untrusted for the pitch-change decision (it can
// still extend a note by amplitude), so YIN wobble on breathy frames won't split a note.
const SEG_CLARITY_GATE = 0.5

/**
 * Segment a refined FeatureFrame[] into notes by COMBINING the pitch rule with onsets.
 * A new note starts on EITHER a confident pitch change (> PITCH_SPLIT_SEMI, clarity-gated)
 * OR a detected onset (even at ~unchanged pitch — the re-articulation case). A note closes
 * on sustained silence/unvoiced or at the next onset. Pitch is accumulated clarity-weighted
 * so low-confidence frames don't drag the running estimate.
 *
 * Returns NoteEvent[] in the SAME shape extractNoteEvents produces, so the existing
 * eventsToNotes → repitchNotes path (and thus re-pitch-from-stable-portion) is unchanged.
 * Does NOT touch extractNoteEvents — this is the additive onset-aware path.
 */
function segmentWithOnsets(curve: FeatureFrame[], onsetIdx: number[], minDuration: number): NoteEvent[] {
  if (curve.length < 2) return []
  const onsetSet = new Set(onsetIdx)
  const AMP_GATE = 0.025
  const hopSec = curve[1].time - curve[0].time || 0.012
  const maxSilence = Math.ceil(0.06 / hopSec)

  const events: NoteEvent[] = []
  let startIdx = -1, startTime = 0
  let vSum = 0, wSum = 0            // clarity-weighted fractional-MIDI accumulators
  let ampSum = 0, ampCount = 0, silence = 0
  // A detected onset frequently lands on the UNVOICED attack transient (YIN can't lock
  // during the sharp re-hit), so we can't split on it in the voiced branch alone. Instead
  // we ARM a pending split at the onset and consume it at the next voiced frame — that's
  // where the re-articulated note truly (re)starts.
  let pendingOnset = false

  const open = (i: number, f: FeatureFrame) => {
    const fm = fractionalMidi(f), w = Math.max(1e-3, f.clarity)
    startIdx = i; startTime = f.time
    vSum = fm * w; wSum = w; ampSum = f.amplitude; ampCount = 1; silence = 0
  }
  const flush = (endTime: number) => {
    if (startIdx >= 0 && endTime - startTime >= minDuration) {
      events.push({
        start: startTime, end: endTime,
        midi: Math.round(vSum / wSum),
        amplitude: Math.min(0.9, (ampSum / ampCount) * 0.9),
      })
    }
    startIdx = -1
  }

  for (let i = 0; i < curve.length; i++) {
    const f = curve[i]
    const voiced = f.midi !== null && f.amplitude > AMP_GATE
    // Arm a pending split for any onset that's far enough into the current note (so the
    // note's OWN attack onset can't immediately close it). Held whether voiced or not.
    if (onsetSet.has(i) && startIdx >= 0 && (f.time - startTime) >= MIN_ONSET_SPLIT_SEC) pendingOnset = true

    if (voiced) {
      const fm = fractionalMidi(f)
      if (startIdx < 0) { open(i, f); pendingOnset = false; continue }
      const curPitch  = vSum / wSum
      const pitchJump = f.clarity >= SEG_CLARITY_GATE && Math.abs(fm - curPitch) > PITCH_SPLIT_SEMI
      if (pitchJump || pendingOnset) {
        flush(f.time)         // close at the boundary …
        open(i, f)            // … and start the re-articulated/new note here
        pendingOnset = false
      } else {
        const w = Math.max(1e-3, f.clarity)
        vSum += fm * w; wSum += w; ampSum += f.amplitude; ampCount++; silence = 0
      }
    } else if (startIdx >= 0) {
      silence++
      if (silence > maxSilence) { flush(f.time); pendingOnset = false }
    }
  }
  flush(curve[curve.length - 1].time + 0.02)
  return events
}

// Shared tail of the offline pass: refine the raw feature track, detect onsets, segment
// (onset-aware or pitch-only baseline per opts.useOnsets), re-pitch, and package the
// analysis WITH the onset/flux/clarity evidence for the debug overlay. Both the sync and
// async entries build the rawCurve (differing only in yielding) then delegate here.
function finalizeAnalysis(
  rawCurve: FeatureFrame[],
  opts: BackfillOptions,
  minDuration: number,
  rMed: number,
  octR: number,
): BufferAnalysis {
  const curve = refinePitchTrack(rawCurve, rMed, octR)
  const useOnsets = opts.useOnsets !== false
  const hopSec = curve.length > 1 ? Math.max(1e-4, curve[1].time - curve[0].time) : (opts.hopSec ?? DEFAULT_HOP_SEC)
  const sens = clamp(opts.onsetSensitivity ?? DEFAULT_ONSET_SENS, 0, 1)
  const onsetIdx = useOnsets ? detectOnsetFrames(curve, hopSec, sens) : []
  const events = useOnsets
    ? segmentWithOnsets(curve, onsetIdx, minDuration)
    : extractNoteEvents(curve, minDuration)
  let notes = eventsToNotes(events, minDuration)
  if (opts.repitch !== false) notes = repitchNotes(notes, curve, opts)

  let fluxMax = 1e-9
  for (const f of curve) if (f.flux > fluxMax) fluxMax = f.flux
  return {
    notes, curve, rawCurve,
    onsets:  onsetIdx.map(i => curve[i].time),
    flux:    curve.map(f => Math.min(1, f.flux / fluxMax)),
    clarity: curve.map(f => f.clarity),
  }
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
  // Refine → onset-aware segment → re-pitch, and package with the onset/flux/clarity
  // evidence. Re-pitch changes the NOTES only — the curve/rawCurve stay as-detected.
  return finalizeAnalysis(rawCurve, opts, minDuration, rMed, octR)
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

  if (buf.length < win) { onProgress?.(1); return { notes: [], curve: [], rawCurve: [], onsets: [], flux: [], clarity: [] } }

  const p: ScanParams = { win, rmsGate, sampleRate: rate }
  const st = makeScanState(win)
  const rawCurve: FeatureFrame[] = []
  const end = buf.length - win
  let lastYield = nowMs()
  for (let off = 0; off + win <= buf.length; off += hop) {
    rawCurve.push(scanFeatureFrame(buf, off, p, st))
    if (nowMs() - lastYield >= 12) {          // ~12ms work budget between yields
      onProgress?.(Math.min(0.97, end > 0 ? off / end : 1))
      await new Promise<void>(r => setTimeout(r, 0))
      lastYield = nowMs()
    }
  }
  const analysis = finalizeAnalysis(rawCurve, opts, minDuration, rMed, octR)
  onProgress?.(1)
  return analysis
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

/**
 * Grid-conditional refinement of an offline take.
 *
 * Grid-snapping is only meaningful when the singer actually recorded to a click:
 * then the true onsets lie on the phase-anchored beat grid they HEARD, and
 * alignToGrid confirms/corrects toward it. Without a metronome the grid phase/BPM
 * are arbitrary (default 0 / the tempo field), so snapping would drag onsets onto
 * meaningless beat lines — producing notes where nothing was sung. So:
 *
 *   • metronome was ON  → align to the grid; expose the un-aligned notes as `rawRefined`.
 *   • metronome was OFF → keep the offline notes' REAL onsets (no snap); `rawRefined` is
 *     null (the "Refined" view IS already the accurate, un-snapped take). The manual
 *     Quantize button still lets the user snap deliberately.
 *
 * Pure/deterministic — never throws (falls back to the un-aligned notes on any grid
 * failure), so a take is never made worse.
 */
export function conditionalGridAlign(
  offlineNotes: BackfillNote[],
  metroWasOn: boolean,
  grid: GridOptions,
): { refined: BackfillNote[]; rawRefined: BackfillNote[] | null; aligned: boolean } {
  if (!metroWasOn || offlineNotes.length === 0) {
    return { refined: offlineNotes, rawRefined: null, aligned: false }
  }
  try {
    const aligned = alignToGrid(offlineNotes, grid)
    if (aligned.length > 0) return { refined: aligned, rawRefined: offlineNotes, aligned: true }
  } catch { /* fall through to un-aligned */ }
  return { refined: offlineNotes, rawRefined: null, aligned: false }
}
