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
  time: number       // seconds from start of recording — set to the quiet valley before the attack
  type: BeatType
  clusterId?: string // anonymous cluster letter ("A"–"F") — set when the user hasn't named sounds yet
  velocity: number   // 0–1
  note: number       // MIDI note — always set
  duration?: number  // seconds; undefined = short attack hit (~50ms default display)
  spectral?: HitSpectral // stored during drum classification for AI review
  // ── Enriched by detectLoopPeriod / annotatePitchDeltas before clustering ──
  loopPhase?: number  // 0–1, position within the detected repeating loop period
  pitchDelta?: number // 0–1, normalized absolute pitch change from the previous hit
}

export interface BeatAnalysis {
  hits: BeatHit[]
  bpm: number | null
  duration: number
}

export interface BeatTrackEntry {
  id: string
  name: string
  hits: BeatHit[]
  bpm: number | null
  duration: number
  typeOverrides: Record<string, { label: string; color: string }>
  createdAt: string
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

// ── Spectral distance for two-sided learning ─────────────────────────────────
// Weighted L2 distance on normalized features. Used by the nearest-neighbor
// classifier that runs before the hardcoded threshold rules.

export function spectralDistance(a: HitSpectral, b: HitSpectral): number {
  // Band ratios already 0–1 — most discriminative features get highest weight
  const bands =
    2.0 * (a.sub    - b.sub)    ** 2 +
    2.5 * (a.lowMid - b.lowMid) ** 2 +  // kick indicator
    2.5 * (a.mid    - b.mid)    ** 2 +  // snare/clap indicator
    2.0 * (a.hiMid  - b.hiMid)  ** 2 +  // hi-hat indicator
    2.0 * (a.hi     - b.hi)     ** 2

  // Temporal / psychoacoustic features (normalized to 0–1 range)
  const temporal =
    1.5 * (( a.attackTime    - b.attackTime   ) / 0.12) ** 2 +
    1.2 * (  a.sustainLevel  - b.sustainLevel )         ** 2 +
    1.0 * (( a.releaseTime   - b.releaseTime  ) / 0.30) ** 2 +
    1.3 * (  a.harmonicRatio - b.harmonicRatio)         ** 2 +
    1.3 * (  a.roughness     - b.roughness    )         ** 2 +
    1.0 * (  a.brightness    - b.brightness   )         ** 2 +
    1.0 * (  a.warmth        - b.warmth       )         ** 2

  // MFCCs 1–4 (highly discriminative for timbre)
  const mfccW = [1.5, 1.0, 0.8, 0.8]
  let mfccSum = 0
  for (let i = 0; i < 4; i++) {
    mfccSum += mfccW[i] * (((a.mfcc[i + 1] ?? 0) - (b.mfcc[i + 1] ?? 0)) / 10) ** 2
  }

  const totalWeight = 11.0 + 8.3 + 4.1  // sum of all weights above
  return Math.sqrt((bands + temporal + mfccSum) / totalWeight)
}

export const NN_MAX_DIST = 0.38  // beyond this threshold, don't trust the nearest neighbour

// ── Standalone hit classifier ─────────────────────────────────────────────────
// Classifies a single hit's spectral fingerprint against a set of reference sounds.
// Returns { type, confidence } where confidence is 0–1 (1 = perfect match).
// If no reference is within NN_MAX_DIST, type is null (caller should use Claude).
export function classifyHitLocally(
  spectral: HitSpectral,
  references: ReferenceSound[],
  allowed: Set<BeatType>,
): { type: BeatType | null; confidence: number; dist: number } {
  if (references.length === 0) return { type: null, confidence: 0, dist: Infinity }
  let bestDist = Infinity
  let bestType: BeatType | null = null
  for (const ref of references) {
    if (!ref.spectral || !TYPE_FALLBACKS[ref.category]) continue
    const d = spectralDistance(spectral, ref.spectral)
    if (d < bestDist) { bestDist = d; bestType = ref.category }
  }
  if (!bestType || bestDist >= NN_MAX_DIST) return { type: null, confidence: 0, dist: bestDist }
  // If the best match isn't in the allowed set, fall back to the closest allowed type
  if (!allowed.has(bestType)) {
    const fallback = (TYPE_FALLBACKS[bestType] ?? TYPE_FALLBACKS['other']).find(t => allowed.has(t))
    bestType = fallback ?? null
    if (!bestType) return { type: null, confidence: 0, dist: bestDist }
  }
  const confidence = Math.max(0, 1 - bestDist / NN_MAX_DIST)
  return { type: bestType, confidence, dist: bestDist }
}

// ── Main analysis entry point ─────────────────────────────────────────────────

export interface ReferenceSound {
  category: BeatType
  spectral:  HitSpectral
}

// ── Anonymous clustering ──────────────────────────────────────────────────────
// Groups hits by spectral similarity without assuming any drum type names.
// Returns a map of hit.id → cluster index (0, 1, 2…).

export const CLUSTER_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const
export const CLUSTER_COLORS: Record<string, string> = {
  A: '#3b82f6', B: '#ef4444', C: '#22c55e',
  D: '#f97316', E: '#a855f7', F: '#06b6d4',
}

// Exported so callers can recompute vectors from saved HitSpectral objects
// (e.g. turning stored correction fingerprints into seed vectors for clustering).
export function hitToVec(s: HitSpectral): number[] {
  // All dimensions are normalized to roughly 0–1 so k-means treats them equally.
  return [
    // ── 5-band energies (already 0–1) ──────────────────────────────────────────
    s.sub, s.lowMid, s.mid, s.hiMid, s.hi,

    // ── Spectral shape ──────────────────────────────────────────────────────────
    Math.min(1, (s.centroid ?? 0) / 8000),          // spectral brightness center
    Math.min(1, (s.spread   ?? 0) / 4000),          // tonal focus vs. noise
    Math.min(1, (s.rolloff  ?? 0) / 10000),         // energy roll-off point
    s.flatness ?? 0,                                 // tonal (0) vs. noisy (1)
    s.flux     ?? 0,                                 // change vs. previous hit

    // ── MFCCs 1–8 (timbral shape, gold standard for sound ID) ─────────────────
    // Coefficients roughly range −30…+30; shift and scale to 0–1.
    ...Array.from({ length: 8 }, (_, i) =>
      Math.max(0, Math.min(1, ((s.mfcc?.[i + 1] ?? 0) + 30) / 60))
    ),

    // ── Temporal envelope ───────────────────────────────────────────────────────
    Math.min(1, (s.attackTime       ?? 0) / 0.12),  // sharp (0) vs. soft (1) hit
    Math.min(1, (s.decayTime        ?? 0) / 0.4),
    s.sustainLevel     ?? 0,                         // ongoing body after attack
    Math.min(1, (s.releaseTime      ?? 0) / 0.8),
    Math.min(1, (s.zeroCrossingRate ?? 0) / 5000),  // noisiness proxy

    // ── Pitch / harmonic structure ──────────────────────────────────────────────
    Math.min(1, (s.f0  ?? 0) / 1000),               // fundamental frequency
    s.pitchConfidence  ?? 0,                         // how tonal the sound is
    s.harmonicRatio    ?? 0,                         // harmonic vs. noise energy

    // ── Dynamics ────────────────────────────────────────────────────────────────
    s.peakAmplitude    ?? 0,
    s.rmsAmplitude     ?? 0,
    Math.min(1, (s.dynamicRange ?? 0) / 40),        // transient sharpness in dB

    // ── Psychoacoustic ──────────────────────────────────────────────────────────
    s.brightness ?? 0,  // air / high-end energy
    s.warmth     ?? 0,  // low-end body
    s.presence   ?? 0,  // punchy 2–5 kHz midrange
    s.roughness  ?? 0,  // buzz / wire noise
  ]
}

function vecDist(a: number[], b: number[]): number {
  let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return Math.sqrt(s)
}

// seedVecs: optional pre-computed feature vectors to use as initial centroids
// (from saved user corrections). Any remaining slots are filled with k-means++.
// Build a full cluster-space vector from a spectral fingerprint (same dimensions as vectors
// used inside clusterHits). Gap context is set to neutral (0.5); pitchDelta to 0.
export function spectralToClusterVec(s: HitSpectral): number[] {
  const base = hitToVec(s)
  const f0Norm    = Math.min(1, (s.f0 ?? 0) / 800)
  const pitchConf = s.pitchConfidence ?? 0
  base.push(0.5)                                          // gapBefore — neutral
  base.push(0.5)                                          // gapAfter  — neutral
  base.push(f0Norm * Math.min(1, pitchConf * 5) * 3.0)  // enhanced pitch
  base.push(0)                                            // pitchDelta — unknown
  return base
}

// Returns true if any split pair rule is violated: a cluster contains hits matching
// BOTH the distinct-spectral AND the confused-with-spectral from the same pair.
export function checkSplitViolations(
  assignments: Record<string, number>,
  hits: BeatHit[],
  pairs: Array<{ distinctSpectral: HitSpectral; confusedWithSpectral: HitSpectral }>,
  matchDist = 0.4,
): boolean {
  if (pairs.length === 0) return false
  const byCluster = new Map<number, BeatHit[]>()
  for (const h of hits) {
    const c = assignments[h.id] ?? 0
    if (!byCluster.has(c)) byCluster.set(c, [])
    byCluster.get(c)!.push(h)
  }
  for (const pair of pairs) {
    for (const members of byCluster.values()) {
      const hasDistinct  = members.some(h => h.spectral && spectralDistance(h.spectral, pair.distinctSpectral)   < matchDist)
      const hasConfused  = members.some(h => h.spectral && spectralDistance(h.spectral, pair.confusedWithSpectral) < matchDist)
      if (hasDistinct && hasConfused) return true
    }
  }
  return false
}

export function clusterHits(hits: BeatHit[], k: number, seedVecs?: number[][]): Record<string, number> {
  const actualK = Math.max(1, Math.min(CLUSTER_LETTERS.length, k))

  // ── Pre-compute temporal gap context ──────────────────────────────────────
  // For each hit, measure the gap to its immediate neighbors. Hits preceded or
  // followed by a long silence are "temporally isolated" — this is a strong
  // signal that they may be contextually distinct from dense groups.
  // Normalized so 1 second = full weight; capped at 1.
  const sortedByTime = [...hits].sort((a, b) => a.time - b.time)
  const hitTimeIdx   = new Map(sortedByTime.map((h, i) => [h.id, i]))
  function gapBeforeSec(h: BeatHit): number {
    const i = hitTimeIdx.get(h.id) ?? 0
    return i > 0 ? h.time - sortedByTime[i - 1].time : 5.0
  }
  function gapAfterSec(h: BeatHit): number {
    const i = hitTimeIdx.get(h.id) ?? 0
    return i < sortedByTime.length - 1 ? sortedByTime[i + 1].time - h.time : 5.0
  }

  // Build extended feature vectors from spectral + temporal context + loop phase + pitch.
  // Loop phase is encoded as sin/cos so phase 0.0 and 1.0 are adjacent (circular).
  const vecs = hits.map(h => {
    if (!h.spectral) return { id: h.id, v: null }
    const base = hitToVec(h.spectral)

    // Temporal gap features (2.5× weight each):
    // A hit after silence gets a very different value from a hit in a dense run.
    // This causes isolated hits (sounds in rests) and dense hits (runs) to naturally
    // pull toward different clusters without any user correction needed.
    base.push(Math.min(1, gapBeforeSec(h) / 1.0) * 2.5)
    base.push(Math.min(1, gapAfterSec(h)  / 1.0) * 2.5)

    // Enhanced pitch: f0 weighted by confidence so tonal sounds cluster by note.
    // pitchConfidence threshold lowered to 0.18 to capture semi-tonal beatbox.
    // Weight of 3× makes note changes as important as a full spectral band shift.
    const pitchConf = h.spectral.pitchConfidence ?? 0
    const f0Norm    = Math.min(1, (h.spectral.f0 ?? 0) / 800)
    base.push(f0Norm * Math.min(1, pitchConf * 5) * 3.0)

    // Pitch delta (2× weight): consecutive tonal sounds at different notes → separate
    base.push((h.pitchDelta ?? 0) * 2.0)

    return { id: h.id, v: base }
  })

  const valid = vecs.filter((x): x is { id: string; v: number[] } => x.v !== null)

  const finalAssign: Record<string, number> = {}
  if (valid.length === 0) { hits.forEach(h => { finalAssign[h.id] = 0 }); return finalAssign }

  const kk = Math.min(actualK, valid.length)
  const dim = valid[0].v.length

  // Run k-means++ multiple times and pick the best result (lowest WCSS).
  // Single runs frequently get trapped in local optima — for small datasets (boom+tss)
  // a single unlucky initialization puts both centroids near the overall mean, collapsing
  // two distinct sounds into one cluster. 8 attempts gives near-deterministic results.
  const ATTEMPTS = valid.length <= 30 ? 8 : 3
  let bestWCSS = Infinity

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const centroids: number[][] = []
    // First attempt uses seed vecs (from corrections) if provided; rest are random k-means++
    if (attempt === 0 && seedVecs?.length) {
      for (const sv of seedVecs) {
        if (centroids.length >= kk) break
        if (sv.length === dim) centroids.push([...sv])
      }
    }
    if (centroids.length === 0) {
      centroids.push([...valid[Math.floor(Math.random() * valid.length)].v])
    }
    while (centroids.length < kk) {
      const dists = valid.map(x => Math.min(...centroids.map(c => vecDist(x.v, c))) ** 2)
      const total = dists.reduce((a, b) => a + b, 0)
      let r = Math.random() * total
      for (let i = 0; i < valid.length; i++) {
        r -= dists[i]
        if (r <= 0) { centroids.push([...valid[i].v]); break }
      }
      if (centroids.length < kk) centroids.push([...valid[valid.length - 1].v])
    }

    const tryAssign: Record<string, number> = {}
    for (let iter = 0; iter < 60; iter++) {
      let changed = false
      for (const x of valid) {
        let best = 0, bd = Infinity
        for (let c = 0; c < kk; c++) { const d = vecDist(x.v, centroids[c]); if (d < bd) { bd = d; best = c } }
        if (tryAssign[x.id] !== best) { tryAssign[x.id] = best; changed = true }
      }
      if (!changed) break
      for (let c = 0; c < kk; c++) {
        const members = valid.filter(x => tryAssign[x.id] === c)
        if (!members.length) continue
        for (let d = 0; d < dim; d++) centroids[c][d] = members.reduce((s, x) => s + x.v[d], 0) / members.length
      }
    }

    // WCSS (within-cluster sum of squares) — lower = tighter, better clusters
    let wcss = 0
    for (const x of valid) {
      const c = centroids[tryAssign[x.id] ?? 0]
      wcss += vecDist(x.v, c) ** 2
    }
    if (wcss < bestWCSS) {
      bestWCSS = wcss
      Object.assign(finalAssign, tryAssign)
    }
  }

  // Hits with no spectral data → cluster 0
  for (const x of vecs) if (x.v === null) finalAssign[x.id] = 0

  return finalAssign
}

// ── Loop period detection ─────────────────────────────────────────────────────
//
// Finds the most likely repeating pattern period by scoring candidate periods
// against all inter-onset intervals (IOIs). A period P scores +1 for each IOI
// that falls within 10% of any integer multiple of P (e.g. P, 2P, 3P, …).
// This handles rests, tied notes, and multi-hit patterns.
//
// Returns the period in seconds, or null if no convincing period is found.
// Used to annotate each hit with its phase (0–1) within the loop, which
// becomes a very strong clustering feature: same phase = same position in
// the pattern = almost certainly the same sound.
export function detectLoopPeriod(hits: BeatHit[]): number | null {
  if (hits.length < 4) return null
  const times = hits.map(h => h.time)
  const totalDur = times[times.length - 1] - times[0]
  if (totalDur < 0.15) return null

  const iois: number[] = []
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1]
    if (d > 0.03 && d < totalDur * 0.8) iois.push(d)
  }
  if (iois.length < 2) return null

  const minP = Math.min(...iois) * 0.5
  const maxP = Math.min(4.0, totalDur * 0.65)

  // Coarse pass: 5 ms steps
  let bestP = 0, bestScore = -1
  for (let p = Math.max(0.06, minP); p <= maxP; p += 0.005) {
    let score = 0
    for (const ioi of iois) {
      const nearest = Math.round(ioi / p)
      if (nearest < 1) continue
      if (Math.abs(ioi / p - nearest) / nearest < 0.10) score++
    }
    if (score > bestScore) { bestScore = score; bestP = p }
  }

  if (bestScore < Math.max(2, iois.length * 0.25)) return null

  // Fine pass: 0.5 ms steps around the best candidate
  for (let p = Math.max(0.06, bestP - 0.012); p <= bestP + 0.012; p += 0.0005) {
    let score = 0
    for (const ioi of iois) {
      const nearest = Math.round(ioi / p)
      if (nearest < 1) continue
      if (Math.abs(ioi / p - nearest) / nearest < 0.08) score++
    }
    if (score > bestScore) { bestScore = score; bestP = p }
  }

  return bestP > 0 ? bestP : null
}

// ── Pitch delta annotation ────────────────────────────────────────────────────
//
// For each consecutive pair of tonal hits (pitchConfidence > 0.3), computes how
// much f0 changed and stores it as pitchDelta (0–1) on the later hit.
// A ratio of 2× (one octave) gives pitchDelta = 1.0.
// This gives the clustering algorithm explicit evidence of tonal changes:
// two hits with very different pitches should never be in the same group.
export function annotatePitchDeltas(hits: BeatHit[]): void {
  for (let i = 1; i < hits.length; i++) {
    const prev = hits[i - 1], curr = hits[i]
    const prevConf = prev.spectral?.pitchConfidence ?? 0
    const currConf = curr.spectral?.pitchConfidence ?? 0
    const prevF0   = prevConf > 0.18 ? (prev.spectral?.f0 ?? 0) : 0
    const currF0   = currConf > 0.18 ? (curr.spectral?.f0 ?? 0) : 0
    if (prevF0 > 20 && currF0 > 20) {
      const ratio = Math.max(prevF0, currF0) / Math.min(prevF0, currF0)
      curr.pitchDelta = Math.min(1.0, (ratio - 1.0) / 2.0)  // octave = 1.0
    }
  }
}

export async function analyzeBeats(
  audioBuffer: AudioBuffer,
  options?: {
    allowedTypes?:          BeatType[]
    melodicType?:           BeatType
    referenceSounds?:       ReferenceSound[]
    learnedCorrections?:    ReferenceSound[]
    stemMode?:              boolean
    sensitivityMultiplier?: number  // scales peak-pick threshold; <1 = more detections, >1 = fewer
  },
): Promise<BeatAnalysis> {
  const allowed      = options?.allowedTypes?.length ? new Set(options.allowedTypes) : null
  const melodicType  = options?.melodicType ?? null
  const references   = [...(options?.referenceSounds ?? []), ...(options?.learnedCorrections ?? [])]
  const stemMode     = options?.stemMode ?? false
  const sr           = audioBuffer.sampleRate
  const raw          = audioBuffer.getChannelData(0)

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

  // ── Step 1b: Dynamic noise floor ─────────────────────────────────────────
  // Use the 20th-percentile RMS across all frames as the ambient noise floor.
  // Multiplying by 4× gives ~12 dB of headroom — enough to suppress room noise
  // and breathing while keeping soft drum hits. Clamps to 0.003 minimum so a
  // dead-silent room doesn't set the gate to zero.
  const sortedForFloor = Array.from(rawEnergy).sort((a, b) => a - b)
  const p20Floor       = sortedForFloor[Math.floor(sortedForFloor.length * 0.20)] ?? 0
  // Stem mode: signal is already source-separated so the noise floor is much lower.
  // Use a tighter multiplier (2.0 vs 4.0) to catch softer hits that a mic recording
  // would otherwise swamp with bleed from other instruments.
  const dynamicFloor   = Math.max(stemMode ? 0.001 : 0.003, p20Floor * (stemMode ? 2.0 : 4.0))

  // ── Step 2: Onset strength (2-frame energy rise, rectified) ──────────────
  // Skipping one frame reduces jitter from the smoothing above while still
  // catching sharp transients.
  const onset = new Float32Array(nFrames)
  for (let i = 2; i < nFrames; i++) {
    onset[i] = Math.max(0, energy[i] - energy[i - 2])
  }

  // ── Step 2b: Spectral novelty — two complementary detectors ─────────────────
  //
  // Energy-only onset detection misses sounds that change TONE without changing
  // VOLUME. Two different human sounds need two different detectors:
  //
  //  Signal 1 — Spectral tilt (tiltRatio):
  //    Ratio of high-freq to total energy per frame. Captures shifts between
  //    bass-heavy and treble-heavy sounds (boom→tss, voiced→fricative).
  //    Uses a 1-tap finite-difference high-pass filter (O(N), no FFT needed).
  //
  //  Signal 2 — Zero-crossing rate (zcr):
  //    How fast the waveform changes sign per frame. Tracks the DOMINANT
  //    OSCILLATION FREQUENCY, not just the hi-vs-lo split. Critical for vowel
  //    transitions like "ooooo→eeeee" that stay mid-frequency but shift formants:
  //      "oooo" F2 ≈ 800 Hz → ZCR ≈ 0.036 crossings/sample
  //      "eeee" F2 ≈ 2500 Hz → ZCR ≈ 0.113 crossings/sample
  //    The jump (3×) is far larger than any within-vowel drift and fires
  //    immediately at the transition. No FFT needed — just sign comparisons.
  //
  // Both are hoisted to outer scope so Step 3b (tail suppression) can use them
  // as overrides: a different sound is kept even if energy didn't fully decay.
  //
  // Gate   = 20% of peak energy → relative to this recording, ignores mic noise.
  // Thresh = 85th percentile of loud-frame deltas → self-calibrates to the
  //          user's own tonal variety; gradual drift stays below, hard cuts fire.
  // Signal = (delta / thresh) * energy → proportional to how far above threshold.

  // Loud gate: 20% of peak RMS energy across the recording
  let _noveltyPeakEnergy = 0
  for (let i = 0; i < nFrames; i++) {
    if (energy[i] > _noveltyPeakEnergy) _noveltyPeakEnergy = energy[i]
  }
  const noveltyLoudGate = _noveltyPeakEnergy * 0.20

  // ── Signal 1: Spectral tilt (hi-freq / total energy ratio per frame) ────────
  const hiFrameE = new Float32Array(nFrames)
  for (let i = 0; i < nFrames; i++) {
    const base = i * hopSize
    let hiE = 0
    let prevS = raw[Math.max(0, base - 1)]
    for (let j = 0; j < frameSize; j++) {
      const s = raw[base + j] ?? 0
      const hf = (s - prevS) * 0.5  // 1-tap high-pass via finite difference
      hiE += hf * hf
      prevS = s
    }
    hiFrameE[i] = Math.sqrt(hiE / frameSize)
  }

  const tiltRatio = new Float32Array(nFrames)
  for (let i = 0; i < nFrames; i++) {
    const totE = energy[i] + hiFrameE[i]
    tiltRatio[i] = totE > 0 ? hiFrameE[i] / totE : 0
  }

  const _tiltDeltas: number[] = []
  for (let i = 1; i < nFrames; i++) {
    if (energy[i] >= noveltyLoudGate) _tiltDeltas.push(Math.abs(tiltRatio[i] - tiltRatio[i - 1]))
  }
  let noveltyAdaptThresh = 0.15
  if (_tiltDeltas.length >= 5) {
    const sorted = [..._tiltDeltas].sort((a, b) => a - b)
    noveltyAdaptThresh = Math.max(0.04, sorted[Math.floor(sorted.length * 0.85)] ?? 0.15)
  }

  // ── Signal 2: Zero-crossing rate (dominant oscillation frequency proxy) ─────
  const zcr = new Float32Array(nFrames)
  for (let i = 0; i < nFrames; i++) {
    const base = i * hopSize
    let crosses = 0
    for (let j = 1; j < frameSize; j++) {
      if (raw[base + j - 1] * raw[base + j] < 0) crosses++
    }
    zcr[i] = crosses / frameSize
  }

  const _zcrDeltas: number[] = []
  for (let i = 1; i < nFrames; i++) {
    if (energy[i] >= noveltyLoudGate) _zcrDeltas.push(Math.abs(zcr[i] - zcr[i - 1]))
  }
  let zcrAdaptThresh = 0.01
  if (_zcrDeltas.length >= 5) {
    const sorted = [..._zcrDeltas].sort((a, b) => a - b)
    zcrAdaptThresh = Math.max(0.002, sorted[Math.floor(sorted.length * 0.85)] ?? 0.01)
  }

  // Inject both signals into the onset array; the Step 3 peak-picker handles all three.
  for (let i = 2; i < nFrames; i++) {
    if (energy[i] < noveltyLoudGate) continue
    const tiltDelta = Math.abs(tiltRatio[i] - tiltRatio[i - 1])
    const zcrDelta  = Math.abs(zcr[i] - zcr[i - 1])
    const tiltNovelty = tiltDelta > noveltyAdaptThresh ? (tiltDelta / noveltyAdaptThresh) * energy[i] * 3.0 : 0
    const zcrNovelty  = zcrDelta  > zcrAdaptThresh     ? (zcrDelta  / zcrAdaptThresh)    * energy[i] * 3.0 : 0
    const novelty = Math.max(tiltNovelty, zcrNovelty)
    if (novelty > 0) onset[i] = Math.max(onset[i], novelty)
  }

  // ── Step 3: Peak picking with adaptive threshold ──────────────────────────
  // Threshold = 80th-percentile of local onset window * 1.5 + noise floor.
  // dynamicFloor replaces the old hardcoded 0.003 minimum.
  //
  // minGapFrames reduced from 90ms to 40ms: fast beatbox patterns (boom+tss)
  // can be as close as 40-60ms apart; 90ms was silently dropping the second sound
  // before it ever reached type classification or clustering. Per-type dedup in
  // Step 7 enforces sound-class-specific minimum gaps, so the global gate here
  // only needs to prevent double-triggering of a single transient (< 20ms).
  const smoothHalf = Math.max(1, Math.floor((0.35 * sr) / hopSize))
  const minGapFrames = Math.max(2, Math.floor((0.04 * sr) / hopSize))  // was 0.09 (87ms)
  const pickedSamples: number[] = []

  for (let i = 2; i < nFrames - 1; i++) {
    if (onset[i] <= onset[i - 1] || onset[i] < onset[i + 1]) continue

    const lo = Math.max(0, i - smoothHalf)
    const hi = Math.min(nFrames, i + smoothHalf + 1)
    const local = Array.from(onset.subarray(lo, hi)).sort((a, b) => a - b)
    const p80 = local[Math.floor(local.length * 0.8)]
    const thresh = Math.max(dynamicFloor, p80 * (options?.sensitivityMultiplier ?? 1.5))

    if (onset[i] > thresh) {
      const sampleIdx = i * hopSize
      const lastSample = pickedSamples[pickedSamples.length - 1] ?? -Infinity
      if (sampleIdx - lastSample >= minGapFrames * hopSize) {
        pickedSamples.push(sampleIdx)
      }
    }
  }

  // ── Step 3b: Tail suppression ─────────────────────────────────────────────
  // A sustained sound (bass note, open vowel) can ring long enough that the
  // energy never drops below the onset threshold before the next legitimate hit.
  // This causes the tail to be detected as a second hit. Fix: between any two
  // consecutive candidates, check whether the energy dipped below 35% of the
  // first candidate's peak. If it never did, the second pick is still inside
  // the first sound's body and gets dropped.
  const filteredSamples: number[] = []
  for (let p = 0; p < pickedSamples.length; p++) {
    if (filteredSamples.length === 0) {
      filteredSamples.push(pickedSamples[p])
      continue
    }
    const prevSample = filteredSamples[filteredSamples.length - 1]
    const currSample = pickedSamples[p]
    const prevFrame  = Math.floor(prevSample / hopSize)
    const currFrame  = Math.floor(currSample  / hopSize)
    const peakE      = energy[prevFrame]
    const decayThreshold = peakE * 0.35
    let decayed = false
    for (let f = prevFrame + 1; f < currFrame; f++) {
      if (energy[f] < decayThreshold) { decayed = true; break }
    }
    // Spectral-change override: if the tonal character shifted substantially
    // between the two candidates, they are different sounds even if energy
    // didn't fully decay. Two independent signals:
    //   tiltRatio: boom→tss (hi-freq shift), fricative transitions
    //   zcr:       vowel→vowel (oooo→eeee), pitch note changes
    // Threshold is 2× each detector's own adaptive value so gradual drift
    // inside one sustained sound doesn't trigger this.
    if (!decayed) {
      const tiltShift = Math.abs(tiltRatio[currFrame] - tiltRatio[prevFrame])
      const zcrShift  = Math.abs(zcr[currFrame]       - zcr[prevFrame])
      if (tiltShift > noveltyAdaptThresh * 2 || zcrShift > zcrAdaptThresh * 2) decayed = true
    }
    if (decayed) filteredSamples.push(currSample)
    // else: energy never dipped AND tone didn't change → same sound's tail, drop it
  }

  if (filteredSamples.length === 0) {
    return { hits: [], bpm: null, duration: audioBuffer.duration }
  }

  // ── Step 3c: Refine onsets to the quiet valley before each attack ──────────
  // The peak-picker lands at the frame of maximum energy RISE, which is slightly
  // into the sound body. The true natural splice point is the quietest moment
  // just before the attack begins — where one sound has fully decayed and the
  // next hasn't started. We scan back up to 35 ms from each rough onset and
  // snap to the minimum-energy frame in that window.
  //
  // Feature extraction in Step 5 still uses the rough onset (to see the full
  // attack transient), but hit.time is set to the valley so clips start at the
  // cleanest possible cut point.
  const lookbackFrames = Math.max(1, Math.floor((0.035 * sr) / hopSize))
  const refinedSamples = filteredSamples.map(roughSample => {
    const roughFrame = Math.floor(roughSample / hopSize)
    let valleyFrame = roughFrame, minE = energy[roughFrame] ?? Infinity
    for (let f = Math.max(0, roughFrame - lookbackFrames); f < roughFrame; f++) {
      if ((energy[f] ?? Infinity) < minE) { minE = energy[f]; valleyFrame = f }
    }
    return valleyFrame * hopSize
  })

  // ── Step 4: Velocity — normalized to recording's dynamic range ────────────
  // Scaling by onset * 40 (previous approach) clips immediately for any
  // reasonable microphone level. Instead, normalize against the peak onset
  // in this recording so the loudest hit = 0.92 and softest scales down.
  const pickedOnsets = filteredSamples.map(s => onset[Math.floor(s / hopSize)])
  const peakOnset = Math.max(...pickedOnsets, 0.001)
  function toVelocity(frameIdx: number) {
    return Math.min(0.92, Math.max(0.18, (onset[frameIdx] / peakOnset) * 0.90))
  }

  // ── Step 5: Classify hits ─────────────────────────────────────────────────
  let hits: BeatHit[]

  if (melodicType) {
    hits = filteredSamples.map((roughIdx, si) => ({
      id: crypto.randomUUID(),
      time: refinedSamples[si] / sr,  // splice at valley, not at energy peak
      type: melodicType,
      velocity: toVelocity(Math.floor(roughIdx / hopSize)),
      note: DEFAULT_NOTES[melodicType],
    }))
  } else {
    // Full perceptual feature extraction via FFT (no OfflineAudioContext renders needed).
    // Feature extraction uses the ROUGH onset (sees the full transient); hit.time uses
    // the REFINED valley (clean splice point in the silence before the attack).
    hits = []
    let prevSpectrum: Float32Array | null = null
    for (let si = 0; si < filteredSamples.length; si++) {
      const sampleIdx       = filteredSamples[si]   // rough — for feature window
      const refinedSampleIdx = refinedSamples[si]   // valley — for hit.time
      const nextOnsetSample  = filteredSamples[si + 1] ?? null
      const { spectral, spectrum, highSustained } = computeHitFeatures(raw, sampleIdx, sr, prevSpectrum, nextOnsetSample)
      prevSpectrum = spectrum

      const subR    = spectral.sub
      const lowMidR = spectral.lowMid
      const midR    = spectral.mid
      const hiR     = spectral.hiMid + spectral.hi

      // Perceptual booleans derived from the full feature set.
      // These give the hardcoded rules the same richness the AI classifier uses.
      const isPitched      = spectral.harmonicRatio > 0.40   // clear harmonic structure → tom, rim
      const isSharp        = spectral.attackTime < 0.008     // impulsive transient → rim, clap, kick
      const isBuzzy        = spectral.roughness > 0.30       // rapid AM → snare wire, clap layers
      const hasLongTail    = spectral.releaseTime > 0.12     // still ringing 60 ms+ later → crash
      const hasSustainBody = spectral.sustainLevel > 0.22    // energy at 60 ms post-onset → open-hat

      // ── Nearest-neighbour classifier (two-sided learning) ──────────────────
      // When Sound Library or accepted corrections are available, find the
      // closest reference sound by weighted spectral distance. If confidence
      // is high enough, skip the hardcoded rules entirely.
      let nnOverride: BeatType | null = null
      if (references.length > 0) {
        let bestDist = Infinity
        let bestType: BeatType | null = null
        for (const ref of references) {
          if (!ref.spectral || !TYPE_FALLBACKS[ref.category]) continue
          const d = spectralDistance(spectral, ref.spectral)
          if (d < bestDist) { bestDist = d; bestType = ref.category }
        }
        // Stem mode: the signal is clean so spectral fingerprints are more reliable —
        // trust the nearest neighbour at a slightly wider distance threshold.
        const nnThreshold = stemMode ? NN_MAX_DIST * 1.35 : NN_MAX_DIST
        if (bestType && bestDist < nnThreshold) nnOverride = bestType
      }

      let natural: BeatType
      if (nnOverride) {
        natural = nnOverride
      } else if (hiR > 0.48) {
        // Strong high-frequency content — cymbal/hihat family
        if (highSustained || hasSustainBody) {
          natural = hasLongTail ? 'crash' : 'open-hihat'
        } else {
          natural = 'hihat'
        }
      } else if (hiR > 0.38 && highSustained) {
        natural = (hasLongTail || hiR > 0.50) ? 'crash' : 'open-hihat'
      } else if (hiR > 0.38) {
        natural = 'hihat'
      } else if (subR > 0.30 || (lowMidR > 0.26 && hiR < 0.30 && subR + lowMidR > 0.36)) {
        // Low-frequency dominant — kick vs tom.
        // Tom is more pitched and carries more mid body than a beatbox kick.
        natural = (isPitched && midR > 0.25) ? 'tom' : 'kick'
      } else if (midR > 0.48 && subR < 0.12) {
        // Strong mid dominant with minimal sub — rim if pitched/sharp, else snare
        natural = (isPitched || isSharp) ? 'rim' : 'snare'
      } else if (midR > 0.28 && subR < 0.25) {
        // Snare vs clap: snare has lowMid body from head resonance + buzzy wire decay;
        // clap is brighter and purer noise with minimal low-end
        natural = (lowMidR > 0.12 || isBuzzy) ? 'snare' : 'clap'
      } else {
        natural = 'clap'
      }

      let type: BeatType = natural
      if (allowed && !allowed.has(natural)) {
        const fallbacks = TYPE_FALLBACKS[natural] ?? TYPE_FALLBACKS['other']
        type = (fallbacks.find(t => allowed.has(t)) ?? Array.from(allowed)[0] ?? 'other') as BeatType
      }

      hits.push({
        id: crypto.randomUUID(),
        time: refinedSampleIdx / sr,  // valley before attack = natural splice point
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
    rawOnsets: filteredSamples.length,
    afterDedup: dedupedHits.length,
    onsetRefinedMs: filteredSamples.map((r, i) =>
      ((filteredSamples[i] - refinedSamples[i]) / sr * 1000).toFixed(1) + 'ms'
    ).join(' '),
    bpm,
    bpmSource: (hits.length >= 4 ? ioiBpm : null) != null ? 'IOI' : 'envelope',
    byType,
    hits: dedupedHits.map(h => ({ t: h.time.toFixed(3), type: h.type, vel: h.velocity.toFixed(2) })),
  })

  return { hits: dedupedHits, bpm, duration: audioBuffer.duration }
}

// ── Amplitude-threshold segmentation ─────────────────────────────────────────
//
// Detects note boundaries by watching the RMS envelope:
//   - When envelope crosses ABOVE (onsetPct × peak)  → start of a note
//   - When envelope crosses BELOW (offsetPct × peak) → end of a note
//
// Each segment is then analyzed for spectral features so notes can be
// compared and grouped by tonal similarity (same timbre = same cluster).
export function segmentByAmplitude(
  audioBuffer: AudioBuffer,
  onsetPct  = 0.15,  // 15% of peak RMS triggers a note start
  offsetPct = 0.10,  // 10% of peak RMS triggers a note end
): BeatAnalysis {
  const sr  = audioBuffer.sampleRate
  const raw = audioBuffer.getChannelData(0)
  const n   = raw.length

  // ── 1. RMS envelope (5 ms hop, 10 ms window) ──────────────────────────────
  const HOP      = Math.max(1, Math.round(0.005 * sr))
  const WIN_HALF = HOP
  const nFrames  = Math.floor(n / HOP)
  const rmsEnv   = new Float32Array(nFrames)

  for (let f = 0; f < nFrames; f++) {
    const lo = Math.max(0, f * HOP - WIN_HALF)
    const hi = Math.min(n, f * HOP + WIN_HALF)
    let sum = 0
    for (let s = lo; s < hi; s++) sum += raw[s] ** 2
    rmsEnv[f] = Math.sqrt(sum / (hi - lo))
  }

  // ── 2. Peak and thresholds ────────────────────────────────────────────────
  let peakRms = 0
  for (let f = 0; f < nFrames; f++) if (rmsEnv[f] > peakRms) peakRms = rmsEnv[f]
  if (peakRms < 1e-7) return { hits: [], bpm: null, duration: audioBuffer.duration }

  const onsetThresh  = peakRms * onsetPct
  const offsetThresh = peakRms * offsetPct

  // ── 3. Threshold-crossing segmentation ────────────────────────────────────
  // 20 ms minimum note length prevents noise blips from becoming hits.
  // 10 ms minimum silence before a new note can start prevents double-triggers
  // on the same transient.
  const minNoteFr    = Math.ceil(0.020 * sr / HOP)
  const minSilenceFr = Math.ceil(0.010 * sr / HOP)

  const segments: Array<{ start: number; end: number }> = []
  let inNote       = false
  let onsetFrame   = 0
  let silenceCount = 0

  for (let f = 0; f < nFrames; f++) {
    if (!inNote) {
      if (rmsEnv[f] >= onsetThresh) {
        onsetFrame   = f
        inNote       = true
        silenceCount = 0
      }
    } else {
      if (rmsEnv[f] < offsetThresh) {
        silenceCount++
        if (silenceCount >= minSilenceFr) {
          const endFrame = f - silenceCount + 1
          if (endFrame - onsetFrame >= minNoteFr) {
            segments.push({ start: onsetFrame * HOP, end: endFrame * HOP })
          }
          inNote       = false
          silenceCount = 0
        }
      } else {
        silenceCount = 0
      }
    }
  }
  // Note still active at buffer end
  if (inNote && nFrames - onsetFrame >= minNoteFr) {
    segments.push({ start: onsetFrame * HOP, end: n })
  }

  if (segments.length === 0) {
    return { hits: [], bpm: null, duration: audioBuffer.duration }
  }

  // ── 4. Spectral feature extraction per segment ────────────────────────────
  const hits: BeatHit[] = []
  let prevSpectrum: Float32Array | null = null

  for (let i = 0; i < segments.length; i++) {
    const seg       = segments[i]
    const nextStart = segments[i + 1]?.start ?? null
    const { spectral, spectrum } = computeHitFeatures(raw, seg.start, sr, prevSpectrum, nextStart)
    prevSpectrum = spectrum

    hits.push({
      id:       crypto.randomUUID(),
      time:     seg.start / sr,
      duration: (seg.end - seg.start) / sr,
      type:     'kick',
      velocity: Math.min(0.92, Math.max(0.18, spectral.peakAmplitude * 0.9)),
      note:     DEFAULT_NOTES.kick,
      spectral,
    })
  }

  // ── 5. BPM from median inter-onset interval ────────────────────────────────
  let bpm: number | null = null
  if (hits.length >= 2) {
    const iois = hits.slice(1).map((h, i) => h.time - hits[i].time).sort((a, b) => a - b)
    const med  = iois[Math.floor(iois.length / 2)]
    if (med > 0) {
      let candidate = 60 / med
      while (candidate < 60)  candidate *= 2
      while (candidate > 220) candidate /= 2
      bpm = Math.round(candidate)
    }
  }

  return { hits, bpm, duration: audioBuffer.duration }
}

