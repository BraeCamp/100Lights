/**
 * Client-side beat analysis: onset detection, frequency classification, BPM estimation.
 * Runs entirely in the browser via OfflineAudioContext — no server calls needed.
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

export interface BeatHit {
  id: string
  time: number      // seconds from start of recording
  type: BeatType
  velocity: number  // 0–1
  note: number      // MIDI note — always set
}

export interface BeatAnalysis {
  hits: BeatHit[]
  bpm: number | null
  duration: number
}

// ── Filtered energy bands ─────────────────────────────────────────────────────

async function renderFiltered(
  buf: AudioBuffer,
  filterType: BiquadFilterType,
  frequency: number,
  q = 0.7,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, buf.length, buf.sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = buf
  const filt = ctx.createBiquadFilter()
  filt.type = filterType
  filt.frequency.value = frequency
  filt.Q.value = q
  src.connect(filt)
  filt.connect(ctx.destination)
  src.start()
  return (await ctx.startRendering()).getChannelData(0)
}

// ── RMS energy around a sample index ─────────────────────────────────────────

function rmsWindow(data: Float32Array, center: number, sr: number, windowSec: number): number {
  const half = Math.floor((windowSec * sr) / 2)
  const start = Math.max(0, center - half)
  const end = Math.min(data.length, center + half)
  let sum = 0
  for (let i = start; i < end; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, end - start))
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

// ── Pitch detection via normalized autocorrelation ───────────────────────────

function detectPitch(buffer: AudioBuffer, startSample: number, sr: number): number | null {
  const windowLen = Math.min(Math.floor(0.05 * sr), buffer.length - startSample)
  if (windowLen < 128) return null
  const frame = buffer.getChannelData(0).subarray(startSample, startSample + windowLen)

  let energy = 0
  for (let i = 0; i < windowLen; i++) energy += frame[i] * frame[i]
  if (energy / windowLen < 2e-4) return null

  const minLag = Math.ceil(sr / 1100)
  const maxLag = Math.floor(sr / 70)
  let bestLag = minLag, bestNsdf = -1

  for (let tau = minLag; tau <= Math.min(maxLag, windowLen - 1); tau += 2) {
    let num = 0, den = 0
    for (let i = 0; i + tau < windowLen; i++) {
      num += frame[i] * frame[i + tau]
      den += frame[i] * frame[i] + frame[i + tau] * frame[i + tau]
    }
    const nsdf = den > 0 ? (2 * num) / den : 0
    if (nsdf > bestNsdf) { bestNsdf = nsdf; bestLag = tau }
  }

  if (bestNsdf < 0.45) return null
  return sr / bestLag
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
    // Five-band frequency classification, tuned for beatbox mouth sounds.
    // Key insight: the human mouth cannot produce true sub-bass (<100 Hz),
    // so beatbox kicks peak in the 150–500 Hz range (lowMid band), not sub.
    const [subBand, lowMidBand, midBand, hiMidBand, highBand] = await Promise.all([
      renderFiltered(audioBuffer, 'lowpass',  150, 0.7),
      renderFiltered(audioBuffer, 'bandpass', 400, 1.2),
      renderFiltered(audioBuffer, 'bandpass', 1400, 1.0),
      renderFiltered(audioBuffer, 'bandpass', 5000, 1.0),
      renderFiltered(audioBuffer, 'highpass', 9000, 0.7),
    ])

    const classWindow  = 0.06
    const sustainOffset = Math.floor(0.06 * sr)

    hits = pickedSamples.map((sampleIdx) => {
      const t = sampleIdx / sr
      const subE    = rmsWindow(subBand,    sampleIdx, sr, classWindow)
      const lowMidE = rmsWindow(lowMidBand, sampleIdx, sr, classWindow)
      const midE    = rmsWindow(midBand,    sampleIdx, sr, classWindow)
      const hiMidE  = rmsWindow(hiMidBand,  sampleIdx, sr, classWindow)
      const highE   = rmsWindow(highBand,   sampleIdx, sr, classWindow)
      const total   = subE + lowMidE + midE + hiMidE + highE || 1

      const subR    = subE / total
      const lowMidR = lowMidE / total
      const midR    = midE / total
      const hiR     = (hiMidE + highE) / total

      // Sustained high-frequency check for open/crash (long vs short decay)
      const attackHigh  = rmsWindow(highBand, sampleIdx, sr, 0.025)
      const sustainHigh = rmsWindow(
        highBand,
        Math.min(audioBuffer.length - 1, sampleIdx + sustainOffset),
        sr, 0.08,
      )
      const highSustained = attackHigh > 0.002 && sustainHigh > attackHigh * 0.28

      let natural: BeatType

      // 1. High-frequency dominant → hihat family
      if (hiR > 0.48) {
        natural = highSustained ? 'crash' : 'hihat'

      // 2. Moderate-high with sustain → open hihat or crash
      } else if (hiR > 0.38 && highSustained) {
        natural = hiR > 0.50 ? 'crash' : 'open-hihat'

      // 3. High-mid without sustain → closed hihat
      } else if (hiR > 0.38) {
        natural = 'hihat'

      // 4. Low-end dominant → kick or tom
      // Beatbox kicks have: high lowMid, moderate sub, low hiR
      // Toms have: more mid-range body than kicks
      } else if (subR > 0.30 || (lowMidR > 0.26 && hiR < 0.30 && subR + lowMidR > 0.36)) {
        // Tom has more mid energy riding on top of the bass thump
        natural = midR > 0.30 ? 'tom' : 'kick'

      // 5. Mid-range sharp attack, minimal bass → rim shot
      } else if (midR > 0.48 && subR < 0.12) {
        natural = 'rim'

      // 6. Mid-range with some body → snare
      } else if (midR > 0.28 && subR < 0.25) {
        natural = 'snare'

      // 7. Everything else → clap (broadband noise, moderate everything)
      } else {
        natural = 'clap'
      }

      let type: BeatType = natural
      if (allowed && !allowed.has(natural)) {
        type = TYPE_FALLBACKS[natural].find(t => allowed.has(t)) ?? Array.from(allowed)[0] ?? 'other'
      }

      return {
        id: crypto.randomUUID(),
        time: t,
        type,
        velocity: toVelocity(Math.floor(sampleIdx / hopSize)),
        note: DEFAULT_NOTES[type],
      }
    })
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

  // ── Step 9: Pitch detection — refine note for melodic/voiced hits ─────────
  for (const hit of dedupedHits) {
    const freq = detectPitch(audioBuffer, Math.floor(hit.time * sr), sr)
    if (freq !== null) {
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
