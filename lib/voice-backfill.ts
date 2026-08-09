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
// Note-level HMM / Viterbi tracker — the alternative note SEGMENTER (A/B winner, default).
// PURE module (no DOM/audio/deps); we feed it mapped FeatureFrame→HmmFrame observations.
import { trackNotesHMM, type HmmFrame } from '@/lib/voice-hmm'
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
  /** True when this note was added by the post-decode recovery pass (a voiced region the
   *  tracker had left as silence / dropped). Surfaced for the debug overlay. */
  recovered?: boolean
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
   *  note. Default true. Pass false to A/B against the pure pitch-only segmentation.
   *  IGNORED when `segmenter` is 'hmm' (the HMM path has its own re-articulation model),
   *  but the flux/onset EVIDENCE is still detected & returned for the debug overlay. */
  useOnsets?:      boolean

  /** Which NOTE SEGMENTER turns the refined pitch/feature track into discrete notes:
   *   · 'onset' — the hand-tuned onset-aware segmenter (segmentWithOnsets): pitch-rule +
   *               flux/energy onsets + volume valleys/existence gate. The prior default.
   *   · 'hmm'   — the note-level Viterbi tracker (lib/voice-hmm trackNotesHMM) over the
   *               mapped FeatureFrame→HmmFrame observations: joint most-likely note
   *               sequence (bounded pitch emission smooths noisy/breathy frames, self-loop
   *               holds vibrato, onset-gated attack sub-state splits re-articulations,
   *               auto global-tuning). It decides each note's pitch itself, so the
   *               attack-scoop re-pitch pass is redundant on this path (see HMM_REPITCH).
   *  Default 'hmm' — the A/B winner (see scripts/verify-voice-segmenter-ab.mjs): equal or
   *  better on noisy/breathy pitch, re-articulation, adjacent steps, low scale, tail, held,
   *  scoop, and contour, with no regression on quick notes. */
  segmenter?:      'onset' | 'hmm'
  /** Onset peak-pick sensitivity, 0→1. Maps to the adaptive threshold k = mean + k·std
   *  over a local flux window: HIGHER sensitivity ⇒ lower k ⇒ more onsets detected (more
   *  splits); lower ⇒ stricter (fewer). Default 0.5. */
  onsetSensitivity?: number

  // ── Problem 1: tail coverage ────────────────────────────────────────────────
  /** Also analyze a FINAL window anchored at buf.length−win so the trailing <win
   *  samples the `off+win <= length` loop skips are covered. Without it the last
   *  ~one window of audio is never scanned and a note ending within ~a window of the
   *  buffer end is dropped. Default true. Pass false to A/B the drop. */
  scanTailWindow?: boolean

  // ── Problem 2: adaptive analysis window for low notes ───────────────────────
  /** Per-frame adaptive YIN window: the short `winSize` is kept for time resolution,
   *  but on frames whose spectral energy is dominated by LOW frequencies (a low sung
   *  note, where ~60ms is too few periods for YIN to lock) the pitch is measured from a
   *  longer window (up to `lowWinSec`). RMS/flux/onset features stay on the short window,
   *  so quick mid/high notes are untouched. Default true. Pass false to A/B. */
  adaptiveWindow?: boolean
  /** Longer window (seconds) used to re-detect a low frame. Capped at the YIN core's
   *  4096-sample ceiling. Default 0.12 (~120ms → ~13 periods of A2). */
  lowWinSec?: number
  /** Short-window pitch (Hz) at/below which a frame is re-detected on the longer window
   *  (a failed-but-energetic short read also triggers it). Higher = more frames take the
   *  2nd pass. Default 165 (~E3). */
  adaptiveLowHz?: number

  // ── Problem 3: volume-envelope cues ─────────────────────────────────────────
  /** Use the RMS volume envelope as extra note evidence: (1) split at volume VALLEYS
   *  (local RMS minima between swells) so a legato scale — pitch gliding but each note
   *  re-swelling — segments per swell; (2) an EXISTENCE gate that drops notes whose peak
   *  volume is negligible vs the take's loudest (phantom notes in near-silence); (3) fold
   *  volume into the clarity weighting when assigning a note's pitch (loud, clear frames
   *  dominate). Only active on the onset-aware path. Default true. Pass false to A/B. */
  useVolumeCues?: boolean
  /** Minimum relative depth of a volume valley (0→1) to treat it as a note boundary:
   *  (min(neighbourPeakL,R) − valley) ÷ peak must exceed this. Higher = only deep dips
   *  split. Default 0.22. */
  volumeValleyDepth?: number
  /** Existence gate: a note is dropped when its PEAK amplitude is below this fraction of
   *  the take's peak amplitude (near-silence phantom). Default sensitivity-scaled around
   *  ~0.05 (see DEFAULT_EXIST_FRAC / existFracFor). Set 0 to disable. When given explicitly
   *  it OVERRIDES the sensitivity scaling. */
  volumeExistFrac?: number

  // ── Recall / recover-missing-notes (bias toward not dropping) ────────────────
  /** The widget's 0→1 sensitivity slider, threaded into the offline pass so turning it up
   *  keeps MORE notes end-to-end: it lowers the offline voicing/clarity floor (more frames
   *  stay voiced), lowers the existence gate, drives the HMM's `keepBias` recall knob, and
   *  loosens the recovery pass. Default 0.5 (the widget's default) — already recovers the
   *  common "missing quiet note" case. Clamped 0→1. */
  sensitivity?: number
  /** Offline YIN-confidence floor below which a frame is unvoiced (passed to
   *  detectBufferPitch — offline only, never touches the live detector). Undefined ⇒
   *  derived from `sensitivity` (see voicingFloorFor). Lower ⇒ more breathy frames stay
   *  voiced ⇒ the HMM sees a note instead of silence. */
  clarityFloor?: number
  /** Run the post-decode RECOVERY pass: scan for voiced, stable-pitch, energetic regions the
   *  tracker left as silence (or dropped as sub-minDuration) and re-add them as notes. Biases
   *  toward not-missing. Default true. Pass false to A/B the drop. */
  recoverNotes?: boolean
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
// Adaptive-window defaults (Problem 2). The long window (~120ms ≈ 13 periods of A2)
// only engages on low-dominated frames; the YIN core caps the window at 4096 samples.
const DEFAULT_LOW_WIN_SEC      = 0.12
// A short-window pitch at/below this (Hz) triggers the longer-window re-detect. ~165Hz
// (~E3) covers the low male/female chest range where ~60ms is too few periods to lock.
const DEFAULT_ADAPTIVE_LOW_HZ  = 165
const YIN_MAX_WIN              = 4096   // detectBufferPitch's HANN_SIZE ceiling
// Volume-cue defaults (Problem 3).
const DEFAULT_VALLEY_DEPTH     = 0.22
// Existence-gate base fraction (was 0.12 — too aggressive; dropped soft real notes). Now the
// low-sensitivity end of the sensitivity-scaled gate (existFracFor); a soft note at ~8–11% of
// the take's peak now survives at the default sensitivity.
const DEFAULT_EXIST_FRAC       = 0.05
// The widget's default sensitivity, mirrored here so the offline pass scales its gates the
// same way even when a caller doesn't pass one (keeps notesFromBuffer sensible standalone).
const DEFAULT_SENSITIVITY      = 0.5
// Cap on the FFT size used for the per-window spectral-flux (perf; power of 2).
const FLUX_MAX_FFT             = 2048
// ── Note segmenter (Problem: onset-aware vs HMM) ────────────────────────────────
// Default note segmenter. 'hmm' won the A/B (scripts/verify-voice-segmenter-ab.mjs):
// equal-or-better on the noisy/breathy, re-articulation, adjacent, low-scale, tail,
// held, scoop, and contour cases with no quick-note regression.
const DEFAULT_SEGMENTER: 'onset' | 'hmm' = 'hmm'
// Flux → HMM onset normalization. The onset CHANNEL fed to trackNotesHMM carries the SAME
// energy-corroborated onset frames the onset-aware path detects (detectOnsetFrames + volume
// valleys): those frames get onset 1.0 (the HMM's re-articulation gate needs onset ≳ 0.93,
// so a corroborated attack fires a re-articulation split). NON-onset frames get a small flux-
// derived value CAPPED below that gate (HMM_ONSET_FLOOR) — enough to give a real note change a
// mild transition bonus, but never enough to re-articulate on raw flux alone. This is what
// keeps a wobble/pitch-jitter frame (which spikes flux WITHOUT an energy attack) from
// fragmenting a held note: only true, energy-backed re-hits split. HMM_ONSET_SAT sets the
// flux value that maps to the floor cap (attacks ≥ this fraction of peak flux reach the cap).
const HMM_ONSET_SAT = 0.5
// Cap on the onset value of a NON-corroborated (raw-flux-only) frame — kept below the HMM's
// re-articulation gate so wobble/jitter flux can't spawn spurious notes; corroborated onset
// frames still get a full 1.0. Also the ceiling for the note-change transition bonus off flux.
const HMM_ONSET_FLOOR = 0.5
// Re-pitch on the HMM path? The Viterbi tracker already assigns each note its own tuned
// pitch (auto global-tuning + bounded emission absorb the attack scoop), so the extra
// re-pitch-from-stable-portion pass is redundant here — verified on the scoop case (HMM
// nails 61→60 = 60 without it). Left false; the 'onset' path keeps re-pitch as before.
const HMM_REPITCH = false
// Spectral flux is summed into this many linear frequency BANDS before differencing.
// Band-summing averages out the per-bin leakage jitter a steady tone otherwise shows
// (which made a held note's raw per-bin flux spike erratically), so a sustained note
// reads as ~zero flux while a real attack — which moves every band — still spikes.
const FLUX_BANDS               = 32

// ── Sensitivity → recall scaling ────────────────────────────────────────────────
// A single 0→1 sensitivity (the widget's slider) scales every "keep vs drop" lever the
// SAME direction: higher sensitivity ⇒ keep more. Each helper maps sensitivity → one gate.
const sensOf = (opts: BackfillOptions) => clamp(opts.sensitivity ?? DEFAULT_SENSITIVITY, 0, 1)

// Existence-gate fraction. sens 0 → 0.09 (strict) … 0.5 → 0.06 … 1 → 0.03 (loose). An
// explicit volumeExistFrac overrides. A soft note at 8–11% of peak survives at the default.
function existFracFor(opts: BackfillOptions): number {
  if (opts.volumeExistFrac !== undefined) return Math.max(0, opts.volumeExistFrac)
  return clamp(0.09 - 0.06 * sensOf(opts), 0.02, 0.12)
}
// Offline YIN-confidence floor (passed to detectBufferPitch). sens 0 → 0.5 (historical-ish)
// … 0.5 → 0.375 … 1 → 0.25. Lower ⇒ more breathy frames stay voiced. Never below 0.2 so pure
// noise still reads unvoiced. An explicit clarityFloor overrides.
function voicingFloorFor(opts: BackfillOptions): number {
  if (opts.clarityFloor !== undefined) return clamp(opts.clarityFloor, 0.1, 0.9)
  return clamp(0.5 - 0.25 * sensOf(opts), 0.2, 0.55)
}
// HMM recall knob from sensitivity (0→1, passed straight through as keepBias).
const keepBiasFor = (opts: BackfillOptions) => sensOf(opts)
// Onset-path pitch-trust clarity gate, sensitivity-scaled around the old constant (0.5).
// sens 0 → 0.5 … 1 → 0.3. Lower ⇒ breathy frames can still steer the note's pitch.
const segClarityGateFor = (opts: BackfillOptions) => clamp(SEG_CLARITY_GATE - 0.2 * sensOf(opts), 0.28, 0.5)

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

interface ScanParams {
  win:           number
  rmsGate:       number
  sampleRate:    number
  // Adaptive-window (Problem 2): when `adaptive`, a frame whose short-window pitch reads
  // below `lowHz` (or fails) is re-detected on the longer `lowWin`.
  adaptive: boolean
  lowWin:   number
  lowHz:    number
  // Offline YIN-confidence floor (detectBufferPitch confFloor). Sensitivity-scaled so a
  // higher slider keeps more breathy/quiet frames voiced. Offline-only.
  confFloor: number
}

// Build the per-scan parameter block from options. Shared by scanBuffer and the async
// scan so both honour the same adaptive-window / gate config.
function scanParamsFrom(opts: BackfillOptions, sampleRate: number): ScanParams {
  const win    = opts.winSize ?? defaultWin(sampleRate)
  const lowWin = Math.min(YIN_MAX_WIN, Math.max(win, Math.round((opts.lowWinSec ?? DEFAULT_LOW_WIN_SEC) * sampleRate)))
  return {
    win,
    rmsGate:  opts.rmsGate ?? 0.006,
    sampleRate,
    adaptive: opts.adaptiveWindow !== false,
    lowWin,
    lowHz:    opts.adaptiveLowHz ?? DEFAULT_ADAPTIVE_LOW_HZ,
    confFloor: voicingFloorFor(opts),
  }
}

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

  // Spectral flux (onset strength) + a cheap low-band energy estimate for the adaptive
  // window. FFT this window (Hann), sum bin magnitudes into FLUX_BANDS linear bands, then
  // half-wave-rectify the per-BAND increase vs the previous window. Banding averages out
  // per-bin leakage jitter so a sustained note reads ~0 flux (only a real attack moves the
  // bands). The same magnitude pass accumulates the fraction of energy below
  // ADAPTIVE_LOW_HZ, which drives the per-frame window length below.
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

  // ── Pitch, with an adaptive window for low content (Problem 2) ──────────────
  // A short (~60ms) window gives few periods of a low fundamental, so YIN's CMND
  // minimum is shallow → low confidence → the note is gated out entirely. We first
  // detect on the short window (best time resolution, unchanged for mid/high notes);
  // only when that short read is LOW (< lowHz) or FAILS on an energetic frame do we
  // re-detect on the longer window — those extra periods deepen the minimum and lift
  // confidence, recovering the low note. Quick mid/high notes never pay the 2nd pass.
  let freq: number | null = null
  let midi: number | null = null
  let clarity = 0
  if (rms >= p.rmsGate) {
    let det = detectBufferPitch(seg as Float32Array, p.sampleRate, 0, p.confFloor)
    if (p.adaptive && p.lowWin > p.win && (det === null || det.hz < p.lowHz)) {
      // Anchor the long window to the buffer end near the tail so a low END note still
      // gets a full window; otherwise it starts at this frame's offset.
      let pStart = off, pEnd = off + p.lowWin
      if (pEnd > buf.length) { pEnd = buf.length; pStart = Math.max(0, pEnd - p.lowWin) }
      if (pEnd - pStart >= TAIL_MIN_SAMPLES) {
        const longDet = detectBufferPitch(buf.subarray(pStart, pEnd) as Float32Array, p.sampleRate, 0, p.confFloor)
        // Take the long read when the short one failed, or when it's at least as
        // confident (it usually is on low content) — keeps the fundamental, not an octave.
        if (longDet && (det === null || longDet.confidence >= det.confidence)) det = longDet
      }
    }
    if (det) { freq = det.hz; midi = det.midi; clarity = det.confidence }
  }

  const energyDelta = rms - st.prevRms
  st.prevRms = rms
  const pitchDelta = (midi !== null && st.prevMidi !== null) ? Math.abs(midi - st.prevMidi) : 0
  st.prevMidi = midi

  return { time: off / p.sampleRate, freq, amplitude, midi, flux, clarity, energyDelta, pitchDelta, rms }
}

// Analysis floor for a tail window: keep detectBufferPitch's ≥1024-sample requirement.
const TAIL_MIN_SAMPLES = 1024

// Emit the FINAL windows the main scan loop skipped (Problem 1). The loop's
// `off+win <= length` bound stops emitting frames once a FULL window no longer fits, so
// frame TIMES stop ~one window before the buffer end — a note living in that last window
// is measured ~win too short and, if short, drops below minDuration entirely. Here we
// continue at the same hop through the offsets where `off+win > length`, analyzing the
// samples that remain (scanFeatureFrame clamps the slice; the flux FFT zero-pads), while
// keeping ≥1024 samples so YIN can still lock. This restores the trailing note's real
// duration/onset instead of truncating it. No-op when the buffer end is already covered.
function appendTailFrames(frames: FeatureFrame[], buf: Float32Array, p: ScanParams, st: ScanState, hop: number, enabled: boolean): void {
  if (!enabled || buf.length < p.win) return
  const lastOff = frames.length ? Math.round(frames[frames.length - 1].time * p.sampleRate) : -hop
  for (let off = lastOff + hop; off + p.win > buf.length && off + TAIL_MIN_SAMPLES <= buf.length; off += hop) {
    frames.push(scanFeatureFrame(buf, off, p, st))
  }
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
  const hop     = Math.max(1, Math.round((opts.hopSec ?? DEFAULT_HOP_SEC) * sampleRate))

  const p   = scanParamsFrom(opts, sampleRate)
  const buf = applyGain(samples, gain)
  if (buf.length < p.win) return []

  const st = makeScanState(p.win)
  const frames: FeatureFrame[] = []
  for (let off = 0; off + p.win <= buf.length; off += hop) frames.push(scanFeatureFrame(buf, off, p, st))
  appendTailFrames(frames, buf, p, st, hop, opts.scanTailWindow !== false)
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
  /** Per-frame VOLUME envelope — RMS normalized 0–1 by the take's peak RMS, aligned with
   *  `curve`. The debug overlay's volume lane. Optional/back-compat. */
  rms?: number[]
  /** Per-frame PITCH-CHANGE rate — |Δsemitone| between consecutive voiced frames, normalized
   *  0–1 (saturated at ~2 semitones), aligned with `curve`. The debug overlay's pitch-change
   *  lane. Optional/back-compat. */
  pitchDelta?: number[]
  /** Onset times (seconds) of notes added by the RECOVERY pass (voiced regions the tracker
   *  dropped), so the debug overlay can mark them distinctly. Optional/back-compat. */
  recovered?: number[]
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

// ── Volume-valley detection (Problem 3) ────────────────────────────────────────
/**
 * Find note BOUNDARIES at volume VALLEYS — local minima of the (lightly smoothed) RMS
 * envelope that sit meaningfully below the swell peaks on both sides. On a LEGATO scale
 * the pitch glides continuously (no clean pitch-split) and there's no re-attack transient
 * (no flux onset), but each note still re-swells in volume, so the dip BETWEEN swells is
 * the only reliable boundary. Emits frame indices (ascending) to arm a split, exactly like
 * onsets. Shallow ripple (vibrato tremolo) is rejected by `depthFrac`; true silence gaps
 * (unvoiced frames) are left to the segmenter's own silence rule.
 */
function detectVolumeValleys(frames: FeatureFrame[], hopSec: number, minDurSec: number, depthFrac: number): number[] {
  const n = frames.length
  if (n < 5) return []
  // 3-frame moving-average of RMS to suppress single-frame jitter minima.
  const rms = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0
    for (let k = -1; k <= 1; k++) { const g = frames[i + k]; if (g) { s += g.rms; c++ } }
    rms[i] = c > 0 ? s / c : frames[i].rms
  }
  const V     = Math.max(1, Math.round(0.03 / hopSec))   // ±~30ms local-min neighbourhood
  const span  = Math.max(V, Math.round(0.12 / hopSec))   // ±~120ms to find the flanking peaks
  const refr  = Math.max(1, Math.round(Math.max(minDurSec, 0.05) / hopSec))
  const out: number[] = []
  let last = -1e9
  for (let i = V; i < n - V; i++) {
    if (frames[i].midi === null) continue                // only split WITHIN voiced audio
    let isMin = true
    for (let k = -V; k <= V; k++) if (rms[i + k] < rms[i] - 1e-9) { isMin = false; break }
    if (!isMin) continue
    let pl = 0; for (let k = Math.max(0, i - span); k < i; k++)              if (rms[k] > pl) pl = rms[k]
    let pr = 0; for (let k = i + 1; k <= Math.min(n - 1, i + span); k++)     if (rms[k] > pr) pr = rms[k]
    const peak = Math.min(pl, pr)
    if (peak <= 0 || (peak - rms[i]) / peak < depthFrac) continue            // dip too shallow
    if (i - last < refr) continue
    out.push(i); last = i
  }
  return out
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
// Base clarity below which a frame's pitch is untrusted for the pitch-change decision (it
// can still extend a note by amplitude), so YIN wobble on breathy frames won't split a note.
// segClarityGateFor scales DOWN from here with sensitivity (higher slider ⇒ trust more).
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
function segmentWithOnsets(
  curve: FeatureFrame[],
  splitIdx: number[],
  minDuration: number,
  useVolume: boolean,
  existFrac: number,
  clarityGate: number,
): NoteEvent[] {
  if (curve.length < 2) return []
  const onsetSet = new Set(splitIdx)
  const AMP_GATE = 0.025
  const hopSec = curve[1].time - curve[0].time || 0.012
  const maxSilence = Math.ceil(0.06 / hopSec)

  // Existence gate reference: the take's peak amplitude. A note whose own peak is a tiny
  // fraction of this is a near-silence phantom (Problem 3) and is dropped in flush().
  let globalPeakAmp = 0
  for (const f of curve) if (f.amplitude > globalPeakAmp) globalPeakAmp = f.amplitude
  const existGate = useVolume ? existFrac * globalPeakAmp : 0

  const events: NoteEvent[] = []
  let startIdx = -1, startTime = 0
  let vSum = 0, wSum = 0            // clarity-(and volume-)weighted fractional-MIDI accumulators
  let ampSum = 0, ampCount = 0, silence = 0, ampPeak = 0
  // A detected onset frequently lands on the UNVOICED attack transient (YIN can't lock
  // during the sharp re-hit), so we can't split on it in the voiced branch alone. Instead
  // we ARM a pending split at the onset and consume it at the next voiced frame — that's
  // where the re-articulated note truly (re)starts.
  let pendingOnset = false

  // Frame pitch-weight: clarity, optionally scaled by volume so the loud, settled body
  // of a swell outvotes its quiet, pitch-ambiguous edges (Problem 3, cue 3).
  const frameW = (f: FeatureFrame) =>
    Math.max(1e-3, f.clarity) * (useVolume ? Math.max(0.05, f.amplitude) : 1)

  const open = (i: number, f: FeatureFrame) => {
    const fm = fractionalMidi(f), w = frameW(f)
    startIdx = i; startTime = f.time
    vSum = fm * w; wSum = w; ampSum = f.amplitude; ampCount = 1; silence = 0; ampPeak = f.amplitude
  }
  const flush = (endTime: number) => {
    if (startIdx >= 0 && endTime - startTime >= minDuration && ampPeak >= existGate) {
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
      const pitchJump = f.clarity >= clarityGate && Math.abs(fm - curPitch) > PITCH_SPLIT_SEMI
      if (pitchJump || pendingOnset) {
        flush(f.time)         // close at the boundary …
        open(i, f)            // … and start the re-articulated/new note here
        pendingOnset = false
      } else {
        const w = frameW(f)
        vSum += fm * w; wSum += w; ampSum += f.amplitude; ampCount++; silence = 0
        if (f.amplitude > ampPeak) ampPeak = f.amplitude
      }
    } else if (startIdx >= 0) {
      silence++
      if (silence > maxSilence) { flush(f.time); pendingOnset = false }
    }
  }
  flush(curve[curve.length - 1].time + 0.02)
  return events
}

// ── HMM segmenter path (lib/voice-hmm) ─────────────────────────────────────────
/**
 * Map a refined FeatureFrame[] → HmmFrame[] for the note-level Viterbi tracker.
 *
 * Per the module author's integration note:
 *   time  → time (frames are evenly spaced at the hop)
 *   midi  → FRACTIONAL pitch 69+12·log2(freq/440) (not the semitone-rounded `midi`), null
 *           when unvoiced. We take it from the OCTAVE-CORRECTED curve's freq, so the
 *           harmonic octave jumps the refine already folded don't reach the decoder.
 *   conf  → clarity (YIN confidence, 0 when unvoiced)
 *   onset → flux normalized to 0–1, SATURATED at HMM_ONSET_SAT·peak so real attacks land
 *           ~1.0 (see HMM_ONSET_SAT) and the onset-gated re-articulation split fires
 *   energy→ rms normalized 0–1 by the take's peak rms (silence ⇒ ~0 ⇒ silence state wins)
 */
function curveToHmmFrames(curve: FeatureFrame[], onsetSet: Set<number>): HmmFrame[] {
  let fluxMax = 1e-9, rmsPeak = 1e-9
  for (const f of curve) {
    if (f.flux > fluxMax) fluxMax = f.flux
    if (f.rms  > rmsPeak) rmsPeak = f.rms
  }
  const fluxSat = Math.max(1e-9, HMM_ONSET_SAT * fluxMax)
  return curve.map((f, i) => ({
    time:   f.time,
    midi:   (f.freq !== null && f.freq > 0) ? 69 + 12 * Math.log2(f.freq / 440) : null,
    conf:   f.clarity,
    // Corroborated onset frame ⇒ full 1.0 (fires re-articulation); otherwise a small
    // flux-derived value capped below the re-artic gate (raw flux alone can't split).
    onset:  onsetSet.has(i) ? 1 : Math.min(HMM_ONSET_FLOOR, f.flux / fluxSat),
    energy: Math.min(1, f.rms / rmsPeak),
  }))
}

// Segment via the note-level HMM: map → trackNotesHMM → BackfillNote shape. `onsetSet` is
// the energy-corroborated onset/valley frame set from the onset-aware path, reused as the
// HMM's re-articulation trigger. minDuration is passed through as the HMM's minDurationSec
// so both paths honour the same floor.
function segmentWithHmm(curve: FeatureFrame[], minDuration: number, onsetSet: Set<number>, keepBias: number): BackfillNote[] {
  if (curve.length < 2) return []
  const notes = trackNotesHMM(curveToHmmFrames(curve, onsetSet), { minDurationSec: minDuration, keepBias })
  return notes.map(n => ({
    startSec: n.startSec,
    midi:     n.midi,
    durSec:   Math.max(minDuration, n.durSec),
    velocity: clamp(n.velocity, 0.3, 1),
  }))
}

// ── Recovery pass: recover VOICED regions the tracker left as silence / dropped ─────
/**
 * "More checks, slower is fine" recall pass. After the segmenter decodes notes, some real
 * notes are still missing — a breathy/quiet note the HMM scored as silence, or a short note
 * dropped below minDuration. This scans the refined curve for the regions the notes DON'T
 * cover, and re-adds any that look like a genuine sung note:
 *   · VOICED        — the frame has a pitch (midi != null),
 *   · CLEAR enough  — clarity ≥ a sensitivity-scaled recovery floor (looser than the scan),
 *   · LOUD enough   — amplitude ≥ existFrac · take-peak (the same existence idea as the gate),
 *   · STABLE pitch  — the run stays within ~0.7 semitone of its running median (a leap closes
 *                     the run and opens a new one; a wide-variance/gliding blob is rejected),
 *   · LONG enough   — run duration ≥ a recovery-min (BELOW minDuration, so a ~90–110ms note
 *                     the tracker dropped is caught).
 * Each surviving run becomes one note at its amplitude-weighted median pitch, flagged
 * `recovered`. Because runs are built only from frames NOT covered by an existing note, a
 * recovered note sits in a gap — it can't duplicate or overlap a tracked note. A genuinely
 * silent gap has no voiced frames, so nothing is recovered there (the false-positive guard).
 */
function recoverMissedNotes(
  notes: BackfillNote[],
  curve: FeatureFrame[],
  opts: BackfillOptions,
  minDuration: number,
  existFrac: number,
): BackfillNote[] {
  const n = curve.length
  if (n < 2) return notes
  const s = sensOf(opts)
  const hopSec = Math.max(1e-4, curve[1].time - curve[0].time)
  // Recovery gates — looser than the main scan, sensitivity-scaled (higher ⇒ recover more).
  const recovClarity = clamp(0.55 - 0.28 * s, 0.28, 0.6)          // 0.5→0.41
  const recovMinDur  = clamp(0.10 - 0.035 * s, 0.055, 0.11)       // 0.5→0.0825 (< minDuration)
  const STABLE_SEMI  = 0.7                                        // run pitch spread ceiling
  let peakAmp = 0
  for (const f of curve) if (f.amplitude > peakAmp) peakAmp = f.amplitude
  const ampFloor = Math.max(existFrac * peakAmp, 1e-4)

  // Mark frames already covered by a decoded note (a small ±half-hop pad on each side).
  const covered = new Uint8Array(n)
  const pad = hopSec * 0.5
  for (const note of notes) {
    const a = note.startSec - pad, b = note.startSec + note.durSec + pad
    for (let i = 0; i < n; i++) if (curve[i].time >= a && curve[i].time <= b) covered[i] = 1
  }

  // A frame is a recovery candidate when it's uncovered, voiced, clear and loud enough.
  const candidate = (i: number): boolean => {
    if (covered[i]) return false
    const f = curve[i]
    return f.midi !== null && f.clarity >= recovClarity && f.amplitude >= ampFloor
  }

  const recovered: BackfillNote[] = []
  let runStart = -1
  let runMed = 0                    // running median pitch of the open run
  const runVals: { v: number; w: number }[] = []
  let runLoV = Infinity, runHiV = -Infinity, runPeak = 0

  const closeRun = (endIdx: number) => {
    if (runStart < 0) { return }
    const startT = curve[runStart].time
    const endT   = curve[endIdx - 1].time + hopSec
    const dur    = endT - startT
    // Stable + long + loud enough → emit one note at the weighted-median pitch.
    if (dur >= recovMinDur && (runHiV - runLoV) <= STABLE_SEMI + 0.5 && runPeak >= ampFloor) {
      const center = Math.round(weightedMedian(runVals))
      recovered.push({
        startSec: startT,
        midi:     center,
        durSec:   Math.max(minDuration, dur),
        velocity: clamp(0.3 + runPeak, 0.3, 1),
        recovered: true,
      })
    }
    runStart = -1; runVals.length = 0; runLoV = Infinity; runHiV = -Infinity; runPeak = 0
  }

  for (let i = 0; i < n; i++) {
    if (!candidate(i)) { closeRun(i); continue }
    const f  = curve[i]
    const fm = fractionalMidi(f)
    if (runStart < 0) {
      runStart = i; runMed = fm; runVals.length = 0; runLoV = Infinity; runHiV = -Infinity; runPeak = 0
    } else if (Math.abs(fm - runMed) > STABLE_SEMI) {
      // Pitch stepped — close the stable run here, start a fresh one at this pitch.
      closeRun(i)
      runStart = i; runMed = fm
    }
    runVals.push({ v: fm, w: Math.max(1e-3, f.amplitude) })
    if (fm < runLoV) runLoV = fm
    if (fm > runHiV) runHiV = fm
    if (f.amplitude > runPeak) runPeak = f.amplitude
    // Track a robust running median so a single outlier frame doesn't drag the split test.
    runMed = weightedMedian(runVals)
  }
  closeRun(n)

  if (recovered.length === 0) return notes
  return [...notes, ...recovered].sort((a, b) => a.startSec - b.startSec)
}

// Shared tail of the offline pass: refine the raw feature track, detect onsets, segment
// (HMM / onset-aware / pitch-only baseline per opts.segmenter+opts.useOnsets), re-pitch,
// and package the analysis WITH the onset/flux/clarity evidence for the debug overlay.
// Both the sync and async entries build the rawCurve (differing only in yielding) then
// delegate here.
function finalizeAnalysis(
  rawCurve: FeatureFrame[],
  opts: BackfillOptions,
  minDuration: number,
  rMed: number,
  octR: number,
): BufferAnalysis {
  const curve = refinePitchTrack(rawCurve, rMed, octR)
  const segmenter = opts.segmenter ?? DEFAULT_SEGMENTER
  const useOnsets = opts.useOnsets !== false
  const useVolume = opts.useVolumeCues !== false
  // The HMM path reuses the SAME corroborated onset/valley evidence as its re-articulation
  // trigger, so detect onsets whenever EITHER path needs them.
  const wantOnsets = useOnsets || segmenter === 'hmm'
  const hopSec = curve.length > 1 ? Math.max(1e-4, curve[1].time - curve[0].time) : (opts.hopSec ?? DEFAULT_HOP_SEC)
  const sens = clamp(opts.onsetSensitivity ?? DEFAULT_ONSET_SENS, 0, 1)
  const onsetIdx = wantOnsets ? detectOnsetFrames(curve, hopSec, sens) : []
  // Volume-valley boundaries (Problem 3): merged with the flux onsets into one ascending
  // split set so a legato swell-scale segments per swell. Active on the onset-aware AND HMM
  // paths (both use it: the onset path to split, the HMM path as a re-articulation trigger).
  const valleyIdx = (wantOnsets && useVolume)
    ? detectVolumeValleys(curve, hopSec, minDuration, opts.volumeValleyDepth ?? DEFAULT_VALLEY_DEPTH)
    : []
  const splitIdx = wantOnsets
    ? Array.from(new Set([...onsetIdx, ...valleyIdx])).sort((a, b) => a - b)
    : []
  const existFrac = existFracFor(opts)     // sensitivity-scaled existence gate (~0.05 default)
  const keepBias  = keepBiasFor(opts)      // sensitivity-driven HMM recall knob
  let notes: BackfillNote[]
  if (segmenter === 'hmm') {
    // Note-level Viterbi: it decides each note's pitch itself (auto-tuning + bounded
    // emission absorb the attack scoop), so re-pitch is redundant here — default OFF
    // (HMM_REPITCH); pass repitch:true explicitly to force it on for A/B. The corroborated
    // onset/valley frames (splitIdx) are the HMM's re-articulation triggers. keepBias tilts
    // the silence-vs-note balance toward notes (sensitivity-driven).
    notes = segmentWithHmm(curve, minDuration, new Set(splitIdx), keepBias)
    if (opts.repitch === true || (opts.repitch !== false && HMM_REPITCH)) {
      notes = repitchNotes(notes, curve, opts)
    }
  } else {
    const events = useOnsets
      ? segmentWithOnsets(curve, splitIdx, minDuration, useVolume, existFrac, segClarityGateFor(opts))
      : extractNoteEvents(curve, minDuration)
    notes = eventsToNotes(events, minDuration)
    if (opts.repitch !== false) notes = repitchNotes(notes, curve, opts)
  }

  // ── Recovery pass: re-add voiced, stable, energetic regions the tracker dropped ──
  // Prioritizes not-missing over a few extras. Sensitivity-scaled (looser as it rises).
  if (opts.recoverNotes !== false) {
    notes = recoverMissedNotes(notes, curve, opts, minDuration, existFrac)
  }

  let fluxMax = 1e-9, rmsPeak = 1e-9
  for (const f of curve) { if (f.flux > fluxMax) fluxMax = f.flux; if (f.rms > rmsPeak) rmsPeak = f.rms }
  return {
    notes, curve, rawCurve,
    onsets:  onsetIdx.map(i => curve[i].time),
    flux:    curve.map(f => Math.min(1, f.flux / fluxMax)),
    clarity: curve.map(f => f.clarity),
    // Volume (RMS) + pitch-change envelopes for the debug overlay — normalized 0–1, aligned
    // to `curve`. pitchDelta saturates at ~2 semitones so a big leap reads as a full spike.
    rms:       curve.map(f => Math.min(1, f.rms / rmsPeak)),
    pitchDelta: curve.map(f => Math.min(1, f.pitchDelta / 2)),
    recovered: notes.filter(n => n.recovered).map(n => n.startSec),
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
  const hop     = Math.max(1, Math.round((opts.hopSec ?? DEFAULT_HOP_SEC) * rate))
  const p       = scanParamsFrom(opts, rate)
  const buf     = applyGain(ds, gain)

  if (buf.length < p.win) { onProgress?.(1); return { notes: [], curve: [], rawCurve: [], onsets: [], flux: [], clarity: [] } }

  const st = makeScanState(p.win)
  const rawCurve: FeatureFrame[] = []
  const end = buf.length - p.win
  let lastYield = nowMs()
  for (let off = 0; off + p.win <= buf.length; off += hop) {
    rawCurve.push(scanFeatureFrame(buf, off, p, st))
    if (nowMs() - lastYield >= 12) {          // ~12ms work budget between yields
      onProgress?.(Math.min(0.97, end > 0 ? off / end : 1))
      await new Promise<void>(r => setTimeout(r, 0))
      lastYield = nowMs()
    }
  }
  appendTailFrames(rawCurve, buf, p, st, hop, opts.scanTailWindow !== false)
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
