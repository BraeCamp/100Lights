/**
 * Client-side beat analysis: onset detection, frequency classification, BPM estimation.
 * Runs entirely in the browser via OfflineAudioContext — no server calls needed.
 */

/*
 * ══════════════════════════════════════════════════════════════════════════════
 * ROADMAP: DUAL-SIDED MACHINE LEARNING FOR BEATBOX-TO-MUSIC RECONSTRUCTION
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * VISION:
 * The machine should be able to hear someone sing or sloppily beatbox a song
 * and reconstruct what that song would sound like if produced from scratch —
 * separating it into clean individual instrument tracks automatically.
 *
 * This is achieved by teaching from two sides simultaneously:
 *
 * ── SIDE A: Music → Stems → Reference Library ────────────────────────────────
 *   Feed real songs into a stem separation model (e.g. Demucs, running server-side).
 *   This isolates: kick, snare, hi-hat, bass, melody, harmony, etc.
 *   Each stem is analyzed across every perceptual dimension (see below) to build
 *   a ground-truth dictionary of what each instrument "looks like" to a computer.
 *   The machine learns the ideal form of every sound from real recordings.
 *
 * ── SIDE B: Sloppy Beatbox → Intended Sound Mapping ─────────────────────────
 *   Feed beatbox recordings of the same songs. The machine already knows what
 *   the song should sound like from Side A, so it can map each imprecise mouth
 *   sound to the instrument it was intending to represent — even when acoustically
 *   ambiguous, off-tempo, or poorly executed.
 *   Over time it builds a model of "beatbox intention" that transcends spectral
 *   heuristics entirely.
 *
 * ── ALIGNMENT (the hard part) ────────────────────────────────────────────────
 *   Connecting a moment in the beatbox to the corresponding moment in the song
 *   requires rhythm alignment. Approach: Dynamic Time Warping (DTW) on the onset
 *   envelope. If beatbox tempo drifts, DTW warps the timeline to find the best
 *   match. Badly out-of-tempo beatbox is the main failure case — needs a minimum
 *   alignment confidence threshold before corrections are applied.
 *
 * ── IMPLEMENTATION PHASES ────────────────────────────────────────────────────
 *   1. Stem separation server route (Demucs or similar) — independently useful now
 *   2. Reference library: store per-stem perceptual fingerprints in the database
 *   3. DTW alignment layer: match beatbox onset envelope to song onset envelope
 *   4. Classifier retraining: use aligned beatbox+stem pairs to improve hit labels
 *   5. Full reconstruction: given beatbox input, output a multi-track MIDI/audio project
 *
 * ── PERCEPTUAL DIMENSIONS TO CAPTURE ─────────────────────────────────────────
 *   The current HitSpectral type captures 5 frequency bands. Future versions
 *   should expand to include all of the following so the machine has richer data:
 *
 *   SPECTRAL (what frequencies are present):
 *     - 5-band energy ratios (current: sub / lowMid / mid / hiMid / hi)
 *     - Spectral centroid — perceived "brightness" (weighted mean frequency)
 *     - Spectral spread — how wide the energy is distributed
 *     - Spectral flux — how fast the spectrum is changing frame-to-frame
 *     - Spectral rolloff — frequency below which 85% of energy sits
 *     - Spectral flatness — tonal vs. noise-like (0=pure tone, 1=white noise)
 *     - MFCCs (Mel-frequency cepstral coefficients) — 13–20 coefficients that
 *       compactly describe timbre; the gold standard for instrument recognition
 *
 *   TEMPORAL (how the sound evolves over time):
 *     - Attack time — how fast the hit reaches peak amplitude
 *     - Decay time — how fast it falls from peak to sustain level
 *     - Sustain level — steady-state amplitude after decay
 *     - Release time — how long the tail fades out
 *     - Onset sharpness — impulsive (drum) vs. soft (pad)
 *     - Zero-crossing rate — relates to noisiness and pitch
 *
 *   PITCH / HARMONIC:
 *     - Fundamental frequency (F0) — detected via autocorrelation or YIN algorithm
 *     - Pitch confidence — how clearly pitched the sound is (0=unpitched noise)
 *     - Harmonic-to-noise ratio (HNR) — voiced vs. unvoiced
 *     - Inharmonicity — deviation of partials from ideal harmonic series
 *     - Chord / key detection for sustained sections
 *
 *   RHYTHMIC / STRUCTURAL:
 *     - Inter-onset interval (IOI) — time between consecutive hits
 *     - Beat position — where in the bar this hit falls (quantized to 16th notes)
 *     - Swing ratio — ratio of long to short IOIs in a pair
 *     - Tempo stability — variance in IOIs over the recording
 *     - Groove vector — systematic timing deviations relative to the grid
 *
 *   DYNAMIC / LOUDNESS:
 *     - Peak amplitude
 *     - RMS amplitude over the hit window
 *     - Dynamic range (peak / RMS ratio)
 *     - Perceptual loudness (LUFS / A-weighted)
 *
 *   PSYCHOACOUSTIC (how humans perceive the sound):
 *     - Roughness — fast amplitude modulation creates dissonance/buzz
 *     - Sharpness — high-frequency dominance (Zwicker model)
 *     - Warmth — low-frequency body relative to mid
 *     - Presence — upper-mid prominence (2–5 kHz region)
 *
 *   These dimensions together give the machine enough data to distinguish sounds
 *   that look identical in a simple 5-band analysis — e.g. a snare and a clap
 *   may have similar frequency distributions but differ sharply in attack time,
 *   spectral flux, and MFCCs.
 *
 * ── NOTE ON DEPLOYMENT ────────────────────────────────────────────────────────
 *   Once the classifier is trained sufficiently via the admin teaching interface,
 *   users should be able to beatbox uncalibrated with no pattern declaration.
 *   See also: app/api/classify-beats/route.ts for the AI correction layer and
 *   its roadmap note on moving the teaching UI to admin-only.
 * ══════════════════════════════════════════════════════════════════════════════
 */

export type BeatType =
  // Drums
  'kick' | 'snare' | 'hihat' | 'open-hihat' | 'clap' | 'tom' | 'crash' | 'rim' |
  // Guitar
  'guitar-acoustic' | 'guitar-electric' | 'guitar-nylon' |
  // Piano
  'piano-grand' | 'piano-electric' | 'piano-rhodes' |
  // EDM synth
  'synth-lead' | 'synth-pad' | 'synth-bass' | 'synth-arp' |
  // Fallback
  'other'

export const DRUM_BEAT_TYPES: BeatType[] = [
  'kick', 'snare', 'hihat', 'open-hihat', 'clap', 'tom', 'crash', 'rim',
]

export const DEFAULT_NOTES: Record<BeatType, number> = {
  kick:              40,
  snare:             57,
  hihat:             67,
  'open-hihat':      67,
  clap:              55,
  tom:               50,
  crash:             65,
  rim:               62,
  'guitar-acoustic': 64,
  'guitar-electric': 64,
  'guitar-nylon':    64,
  'piano-grand':     60,
  'piano-electric':  60,
  'piano-rhodes':    60,
  'synth-lead':      60,
  'synth-pad':       60,
  'synth-bass':      48,
  'synth-arp':       72,
  other:             60,
}

export type { HitSpectral } from './beat-features'
import type { HitSpectral } from './beat-features'
import { computeHitFeatures } from './beat-features'

export interface BeatHit {
  id: string
  time: number      // seconds from start of recording
  type: BeatType
  velocity: number  // 0–1
  note: number      // MIDI note — always set
  spectral?: HitSpectral // stored during drum classification for AI review
}

export interface BeatAnalysis {
  hits: BeatHit[]
  bpm: number | null
  duration: number
}

// ── BPM from inter-onset intervals (most reliable for short recordings) ───────

function estimateBPMFromIOI(times: number[]): number | null {
  if (times.length < 4) return null
  const iois: number[] = []
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1]
    if (d >= 0.08 && d <= 2.0) iois.push(d)
  }
  if (iois.length < 2) return null
  const sorted = [...iois].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  let bpm = 60 / median
  while (bpm < 60) bpm *= 2
  while (bpm > 220) bpm /= 2
  return Math.round(bpm)
}

// ── BPM from energy-envelope autocorrelation (good for longer recordings) ────

function findTempoFromEnvelope(energy: Float32Array, sr: number, hopSize: number): number | null {
  const envSr = sr / hopSize
  const minPeriod = Math.floor(envSr * 60 / 220)
  const maxPeriod = Math.floor(envSr * 60 / 55)
  if (energy.length < maxPeriod * 2) return null

  // Normalize energy before autocorrelation
  const mean = energy.reduce((s, v) => s + v, 0) / energy.length
  const centered = energy.map(v => v - mean)

  let bestPeriod = minPeriod, bestCorr = -Infinity
  for (let lag = minPeriod; lag <= Math.min(maxPeriod, Math.floor(energy.length / 2)); lag++) {
    let corr = 0
    for (let i = 0; i + lag < centered.length; i++) corr += centered[i] * centered[i + lag]
    if (corr > bestCorr) { bestCorr = corr; bestPeriod = lag }
  }

  let bpm = 60 / (bestPeriod / envSr)
  while (bpm < 60)  bpm *= 2
  while (bpm > 220) bpm /= 2
  return Math.round(bpm)
}

const TYPE_FALLBACKS: Record<BeatType, BeatType[]> = {
  'kick':            ['tom', 'snare', 'clap', 'rim', 'hihat', 'open-hihat', 'crash', 'other'],
  'tom':             ['kick', 'snare', 'clap', 'rim', 'hihat', 'open-hihat', 'crash', 'other'],
  'snare':           ['clap', 'rim', 'tom', 'kick', 'hihat', 'open-hihat', 'crash', 'other'],
  'clap':            ['snare', 'rim', 'tom', 'kick', 'hihat', 'open-hihat', 'crash', 'other'],
  'rim':             ['clap', 'snare', 'hihat', 'tom', 'kick', 'open-hihat', 'crash', 'other'],
  'hihat':           ['open-hihat', 'rim', 'clap', 'crash', 'snare', 'tom', 'kick', 'other'],
  'open-hihat':      ['crash', 'hihat', 'rim', 'clap', 'snare', 'tom', 'kick', 'other'],
  'crash':           ['open-hihat', 'hihat', 'rim', 'clap', 'snare', 'tom', 'kick', 'other'],
  'guitar-acoustic': ['guitar-electric', 'guitar-nylon', 'piano-grand', 'synth-lead', 'other'],
  'guitar-electric': ['guitar-acoustic', 'guitar-nylon', 'piano-grand', 'synth-lead', 'other'],
  'guitar-nylon':    ['guitar-acoustic', 'guitar-electric', 'piano-grand', 'synth-lead', 'other'],
  'piano-grand':     ['piano-electric', 'piano-rhodes', 'guitar-acoustic', 'synth-pad', 'other'],
  'piano-electric':  ['piano-grand', 'piano-rhodes', 'guitar-acoustic', 'synth-lead', 'other'],
  'piano-rhodes':    ['piano-electric', 'piano-grand', 'guitar-acoustic', 'synth-pad', 'other'],
  'synth-lead':      ['synth-arp', 'synth-pad', 'synth-bass', 'guitar-electric', 'other'],
  'synth-pad':       ['synth-lead', 'synth-arp', 'piano-grand', 'guitar-nylon', 'other'],
  'synth-bass':      ['synth-lead', 'kick', 'tom', 'other'],
  'synth-arp':       ['synth-lead', 'guitar-electric', 'piano-electric', 'other'],
  'other':           ['snare', 'clap', 'kick', 'tom', 'hihat', 'rim', 'open-hihat', 'crash'],
}

// ── Main analysis entry point ─────────────────────────────────────────────────

// ── Main analysis entry point ─────────────────────────────────────────────────

export async function analyzeBeats(
  audioBuffer: AudioBuffer,
  options?: {
    allowedTypes?: BeatType[]
    melodicType?: BeatType
  },
): Promise<BeatAnalysis> {
  const allowed = options?.allowedTypes?.length ? new Set(options.allowedTypes) : null
  const melodicType = options?.melodicType ?? null
  const sr = audioBuffer.sampleRate
  const raw = audioBuffer.getChannelData(0)

  // ── Step 1: Smoothed RMS energy envelope ─────────────────────────────────
  // Using a weighted 3-frame average removes single-sample noise spikes
  // while preserving transient shape.
  const frameSize = 512
  const hopSize = 256
  const nFrames = Math.floor((raw.length - frameSize) / hopSize)
  const rawEnergy = new Float32Array(nFrames)
  for (let i = 0; i < nFrames; i++) {
    let s = 0
    const base = i * hopSize
    for (let j = 0; j < frameSize; j++) { const x = raw[base + j]; s += x * x }
    rawEnergy[i] = Math.sqrt(s / frameSize)
  }
  const energy = new Float32Array(nFrames)
  for (let i = 0; i < nFrames; i++) {
    const a = i > 0   ? rawEnergy[i - 1] : rawEnergy[i]
    const b = rawEnergy[i]
    const c = i < nFrames - 1 ? rawEnergy[i + 1] : rawEnergy[i]
    energy[i] = (a + 2 * b + c) / 4
  }

  // ── Step 2: Onset strength (2-frame energy rise, rectified) ──────────────
  // Skipping one frame reduces jitter from the smoothing above while still
  // catching sharp transients.
  const onset = new Float32Array(nFrames)
  for (let i = 2; i < nFrames; i++) {
    onset[i] = Math.max(0, energy[i] - energy[i - 2])
  }

  // ── Step 3: Peak picking with adaptive threshold ──────────────────────────
  // Threshold = 80th-percentile of local onset window * 1.5 + noise floor.
  // This adapts to the recording's dynamic range far better than 2.5×median,
  // and the noise floor (0.003) prevents random mic noise from triggering hits.
  const smoothHalf = Math.max(1, Math.floor((0.35 * sr) / hopSize))
  const minGapFrames = Math.max(2, Math.floor((0.09 * sr) / hopSize))
  const pickedSamples: number[] = []

  for (let i = 2; i < nFrames - 1; i++) {
    if (onset[i] <= onset[i - 1] || onset[i] < onset[i + 1]) continue

    const lo = Math.max(0, i - smoothHalf)
    const hi = Math.min(nFrames, i + smoothHalf + 1)
    const local = Array.from(onset.subarray(lo, hi)).sort((a, b) => a - b)
    const p80 = local[Math.floor(local.length * 0.8)]
    const thresh = Math.max(0.003, p80 * 1.5)

    if (onset[i] > thresh) {
      const sampleIdx = i * hopSize
      const lastSample = pickedSamples[pickedSamples.length - 1] ?? -Infinity
      if (sampleIdx - lastSample >= minGapFrames * hopSize) {
        pickedSamples.push(sampleIdx)
      }
    }
  }

  if (pickedSamples.length === 0) {
    return { hits: [], bpm: null, duration: audioBuffer.duration }
  }

  // ── Step 4: Velocity — normalized to recording's dynamic range ────────────
  // Scaling by onset * 40 (previous approach) clips immediately for any
  // reasonable microphone level. Instead, normalize against the peak onset
  // in this recording so the loudest hit = 0.92 and softest scales down.
  const pickedOnsets = pickedSamples.map(s => onset[Math.floor(s / hopSize)])
  const peakOnset = Math.max(...pickedOnsets, 0.001)
  function toVelocity(frameIdx: number) {
    return Math.min(0.92, Math.max(0.18, (onset[frameIdx] / peakOnset) * 0.90))
  }

  // ── Step 5: Classify hits ─────────────────────────────────────────────────
  let hits: BeatHit[]

  if (melodicType) {
    hits = pickedSamples.map((sampleIdx) => ({
      id: crypto.randomUUID(),
      time: sampleIdx / sr,
      type: melodicType,
      velocity: toVelocity(Math.floor(sampleIdx / hopSize)),
      note: DEFAULT_NOTES[melodicType],
    }))
  } else {
    // Full perceptual feature extraction via FFT (no OfflineAudioContext renders needed).
    // computeHitFeatures returns all 30+ dimensions defined in lib/beat-features.ts.
    hits = []
    let prevSpectrum: Float32Array | null = null
    for (const sampleIdx of pickedSamples) {
      const { spectral, spectrum, highSustained } = computeHitFeatures(raw, sampleIdx, sr, prevSpectrum)
      prevSpectrum = spectrum

      const subR    = spectral.sub
      const lowMidR = spectral.lowMid
      const midR    = spectral.mid
      const hiR     = spectral.hiMid + spectral.hi

      let natural: BeatType
      if (hiR > 0.48) {
        natural = highSustained ? 'crash' : 'hihat'
      } else if (hiR > 0.38 && highSustained) {
        natural = hiR > 0.50 ? 'crash' : 'open-hihat'
      } else if (hiR > 0.38) {
        natural = 'hihat'
      } else if (subR > 0.30 || (lowMidR > 0.26 && hiR < 0.30 && subR + lowMidR > 0.36)) {
        natural = midR > 0.30 ? 'tom' : 'kick'
      } else if (midR > 0.48 && subR < 0.12) {
        natural = 'rim'
      } else if (midR > 0.28 && subR < 0.25) {
        natural = 'snare'
      } else {
        natural = 'clap'
      }

      let type: BeatType = natural
      if (allowed && !allowed.has(natural)) {
        type = TYPE_FALLBACKS[natural].find(t => allowed.has(t)) ?? Array.from(allowed)[0] ?? 'other'
      }

      hits.push({
        id: crypto.randomUUID(),
        time: sampleIdx / sr,
        type,
        velocity: toVelocity(Math.floor(sampleIdx / hopSize)),
        note: DEFAULT_NOTES[type],
        spectral,
      })
    }
  }

  // ── Step 6: BPM estimation ────────────────────────────────────────────────
  // IOI (inter-onset interval) median is the most reliable estimate for short
  // recordings (< 10s). Envelope autocorrelation works better for long loops
  // with fewer distinct hits. Use IOI when we have enough data points.
  const hitTimes = hits.map(h => h.time)
  const ioiBpm  = estimateBPMFromIOI(hitTimes)
  const envBpm  = findTempoFromEnvelope(energy, sr, hopSize)
  // Prefer IOI if we have ≥ 4 hits (enough intervals), otherwise envelope
  const bpmEstimate = (hits.length >= 4 ? ioiBpm : null) ?? envBpm

  // ── Step 7: Dedup (per-type minimum gap) ─────────────────────────────────
  const subdivSec = bpmEstimate ? (60 / bpmEstimate / 4) : 0.10
  const dedupGaps: Record<BeatType, number> = {
    kick:              Math.max(0.15, subdivSec),
    snare:             Math.max(0.09, subdivSec),
    hihat:             Math.max(0.04, subdivSec / 2),
    'open-hihat':      Math.max(0.09, subdivSec),
    clap:              Math.max(0.09, subdivSec),
    tom:               Math.max(0.13, subdivSec),
    crash:             Math.max(0.35, subdivSec * 4),
    rim:               Math.max(0.06, subdivSec / 2),
    'guitar-acoustic': Math.max(0.06, subdivSec / 2),
    'guitar-electric': Math.max(0.06, subdivSec / 2),
    'guitar-nylon':    Math.max(0.06, subdivSec / 2),
    'piano-grand':     Math.max(0.05, subdivSec / 2),
    'piano-electric':  Math.max(0.05, subdivSec / 2),
    'piano-rhodes':    Math.max(0.05, subdivSec / 2),
    'synth-lead':      Math.max(0.05, subdivSec / 2),
    'synth-pad':       Math.max(0.09, subdivSec),
    'synth-bass':      Math.max(0.07, subdivSec / 2),
    'synth-arp':       Math.max(0.04, subdivSec / 4),
    other:             Math.max(0.07, subdivSec),
  }
  const lastByType: Partial<Record<BeatType, number>> = {}
  let dedupedHits = hits.filter(hit => {
    const gap = dedupGaps[hit.type]
    const last = lastByType[hit.type] ?? -Infinity
    if (hit.time - last < gap) return false
    lastByType[hit.type] = hit.time
    return true
  })

  // ── Step 8: Grid snap — with tolerance ───────────────────────────────────
  // Only snap a hit if it's within 30% of the nearest grid slot. A hit that
  // falls between two slots is either a genuine off-grid beat (swing, rush)
  // or indicates a bad BPM estimate — either way, don't move it far.
  if (bpmEstimate) {
    const gridSec = 60 / bpmEstimate / 4
    const snapTolerance = 0.30  // fraction of one grid cell
    const slotMap = new Map<string, BeatHit>()
    for (const hit of dedupedHits) {
      const slot = Math.round(hit.time / gridSec)
      const snapped = slot * gridSec
      const dist = Math.abs(hit.time - snapped) / gridSec
      const snappedTime = dist <= snapTolerance ? snapped : hit.time
      const key = `${hit.type}:${slot}`
      const existing = slotMap.get(key)
      if (!existing || hit.velocity > existing.velocity) {
        slotMap.set(key, { ...hit, time: snappedTime })
      }
    }
    dedupedHits = Array.from(slotMap.values()).sort((a, b) => a.time - b.time)
  }

  // ── Step 9: Pitch refinement — use f0 already detected per-hit in spectral ──
  for (const hit of dedupedHits) {
    const freq = hit.spectral?.f0
    if (freq && freq > 0 && (hit.spectral?.pitchConfidence ?? 0) >= 0.5) {
      const midi = Math.round(69 + 12 * Math.log2(freq / 440))
      if (midi >= 24 && midi <= 96) hit.note = midi
    }
  }

  const bpm = bpmEstimate ?? estimateBPMFromIOI(dedupedHits.map(h => h.time))

  // Debug output — open browser DevTools console to see this after recording
  const byType: Record<string, number> = {}
  for (const h of dedupedHits) byType[h.type] = (byType[h.type] ?? 0) + 1
  console.log('[BeatLab] Analysis:', {
    duration: audioBuffer.duration.toFixed(2) + 's',
    rawOnsets: pickedSamples.length,
    afterDedup: dedupedHits.length,
    bpm,
    bpmSource: (hits.length >= 4 ? ioiBpm : null) != null ? 'IOI' : 'envelope',
    byType,
    hits: dedupedHits.map(h => ({ t: h.time.toFixed(3), type: h.type, vel: h.velocity.toFixed(2) })),
  })

  return { hits: dedupedHits, bpm, duration: audioBuffer.duration }
}

