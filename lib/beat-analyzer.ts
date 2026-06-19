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
  kick:            40,
  snare:           57,
  hihat:           67,
  'open-hihat':    67,
  clap:            55,
  tom:             50,
  crash:           65,
  rim:             62,
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
  other:           60,
}

export interface BeatHit {
  id: string
  time: number       // seconds from start of recording
  type: BeatType
  velocity: number   // 0–1
  note: number       // MIDI note — always set (defaults to DEFAULT_NOTES[type])
}

export interface BeatAnalysis {
  hits: BeatHit[]
  bpm: number | null
  duration: number
}

// ── Utility: render audio through a biquad filter ────────────────────────────

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

// ── RMS energy in a window around a sample index ─────────────────────────────

function rmsWindow(data: Float32Array, center: number, sr: number, windowSec: number): number {
  const half = Math.floor((windowSec * sr) / 2)
  const start = Math.max(0, center - half)
  const end = Math.min(data.length, center + half)
  let sum = 0
  for (let i = start; i < end; i++) sum += data[i] * data[i]
  return Math.sqrt(sum / Math.max(1, end - start))
}

// ── BPM from inter-onset intervals ───────────────────────────────────────────

function estimateBPM(times: number[]): number | null {
  if (times.length < 4) return null
  const iois: number[] = []
  for (let i = 1; i < times.length; i++) {
    const d = times[i] - times[i - 1]
    if (d >= 0.1 && d <= 2.0) iois.push(d)
  }
  if (iois.length < 2) return null
  const sorted = [...iois].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]
  let bpm = 60 / median
  while (bpm < 60) bpm *= 2
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

// ── Tempo from energy-envelope autocorrelation ───────────────────────────────

function findTempoFromEnvelope(energy: Float32Array, sr: number, hopSize: number): number | null {
  const envSr = sr / hopSize
  const minPeriod = Math.floor(envSr * 60 / 220)
  const maxPeriod = Math.floor(envSr * 60 / 55)
  if (energy.length < maxPeriod * 2) return null

  let bestPeriod = minPeriod, bestCorr = -1
  for (let lag = minPeriod; lag <= Math.min(maxPeriod, Math.floor(energy.length / 2)); lag++) {
    let sum = 0
    for (let i = 0; i + lag < energy.length; i++) sum += energy[i] * energy[i + lag]
    if (sum > bestCorr) { bestCorr = sum; bestPeriod = lag }
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

export async function analyzeBeats(
  audioBuffer: AudioBuffer,
  options?: {
    allowedTypes?: BeatType[]   // drum mode: which types to classify into
    melodicType?: BeatType       // melodic mode: all hits = this type, skip drum classification
  },
): Promise<BeatAnalysis> {
  const allowed = options?.allowedTypes?.length ? new Set(options.allowedTypes) : null
  const melodicType = options?.melodicType ?? null
  const sr = audioBuffer.sampleRate
  const raw = audioBuffer.getChannelData(0)

  // Step 1: energy envelope (RMS per frame)
  const frameSize = 512
  const hopSize = 256
  const nFrames = Math.floor((raw.length - frameSize) / hopSize)
  const energy = new Float32Array(nFrames)
  for (let i = 0; i < nFrames; i++) {
    let s = 0
    const base = i * hopSize
    for (let j = 0; j < frameSize; j++) { const x = raw[base + j]; s += x * x }
    energy[i] = Math.sqrt(s / frameSize)
  }

  // Step 2: onset strength
  const onset = new Float32Array(nFrames)
  for (let i = 1; i < nFrames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1])

  // Step 3: adaptive threshold + peak picking
  const smoothHalf = Math.max(1, Math.floor((0.4 * sr) / hopSize))
  const minGap = Math.max(2, Math.floor((0.09 * sr) / hopSize))
  const pickedSamples: number[] = []

  for (let i = 1; i < nFrames - 1; i++) {
    const lo = Math.max(0, i - smoothHalf)
    const hi = Math.min(nFrames, i + smoothHalf + 1)
    const window = Array.from(onset.subarray(lo, hi)).sort((a, b) => a - b)
    const med = window[Math.floor(window.length / 2)]
    const thresh = Math.max(0.002, 2.5 * med)

    if (
      onset[i] > thresh &&
      onset[i] > onset[i - 1] &&
      onset[i] >= onset[i + 1]
    ) {
      const sampleIdx = i * hopSize
      const last = pickedSamples[pickedSamples.length - 1] ?? -Infinity
      if (sampleIdx - last >= minGap * hopSize) {
        pickedSamples.push(sampleIdx)
      }
    }
  }

  if (pickedSamples.length === 0) {
    return { hits: [], bpm: null, duration: audioBuffer.duration }
  }

  // Step 4: classify hits
  let hits: BeatHit[]

  if (melodicType) {
    // Melodic mode: all onsets get the selected instrument type; pitch detection fills note
    hits = pickedSamples.map((sampleIdx) => {
      const t = sampleIdx / sr
      const vel = Math.min(1, Math.max(0.15, onset[Math.floor(sampleIdx / hopSize)] * 40))
      return { id: crypto.randomUUID(), time: t, type: melodicType, velocity: vel, note: DEFAULT_NOTES[melodicType] }
    })
  } else {
    // Drum mode: five-band classification
    const [subBand, lowMidBand, midBand, hiMidBand, highBand] = await Promise.all([
      renderFiltered(audioBuffer, 'lowpass',  150, 0.7),
      renderFiltered(audioBuffer, 'bandpass', 400, 1.2),
      renderFiltered(audioBuffer, 'bandpass', 1400, 1.0),
      renderFiltered(audioBuffer, 'bandpass', 5000, 1.0),
      renderFiltered(audioBuffer, 'highpass', 9000, 0.7),
    ])

    const classWindow = 0.06
    const sustainOffset = Math.floor(0.06 * sr)

    hits = pickedSamples.map((sampleIdx) => {
      const t = sampleIdx / sr
      const subE    = rmsWindow(subBand,    sampleIdx, sr, classWindow)
      const lowMidE = rmsWindow(lowMidBand, sampleIdx, sr, classWindow)
      const midE    = rmsWindow(midBand,    sampleIdx, sr, classWindow)
      const hiMidE  = rmsWindow(hiMidBand,  sampleIdx, sr, classWindow)
      const highE   = rmsWindow(highBand,   sampleIdx, sr, classWindow)
      const total   = subE + lowMidE + midE + hiMidE + highE || 1

      const subR  = subE / total
      const lowMidR = lowMidE / total
      const midR  = midE / total
      const hiR   = (hiMidE + highE) / total

      const sustainHigh = rmsWindow(
        highBand,
        Math.min(audioBuffer.length - 1, sampleIdx + sustainOffset),
        sr, 0.08,
      )
      const attackHigh = rmsWindow(highBand, sampleIdx, sr, 0.025)
      const highSustained = attackHigh > 0.003 && sustainHigh > attackHigh * 0.30

      let natural: BeatType
      if      (subR > 0.42)                                 natural = 'kick'
      else if ((subR + lowMidR) > 0.50 && subR > 0.15)     natural = 'tom'
      else if (hiR > 0.42 && highSustained)                 natural = 'crash'
      else if (hiR > 0.42)                                  natural = 'hihat'
      else if (hiR > 0.32 && highSustained)                 natural = 'open-hihat'
      else if (midR > 0.45 && subR < 0.18)                  natural = 'rim'
      else if (midR > 0.30 && subR < 0.28)                  natural = 'snare'
      else                                                   natural = 'clap'

      if (natural === 'snare') {
        const frameIdx = Math.floor(sampleIdx / hopSize)
        if (frameIdx < energy.length && energy[frameIdx] > 0.15) natural = 'clap'
      }

      let type: BeatType = natural
      if (allowed && !allowed.has(natural)) {
        type = TYPE_FALLBACKS[natural].find(t => allowed.has(t)) ?? Array.from(allowed)[0] ?? 'other'
      }

      const vel = Math.min(1, Math.max(0.15, onset[Math.floor(sampleIdx / hopSize)] * 40))
      return { id: crypto.randomUUID(), time: t, type, velocity: vel, note: DEFAULT_NOTES[type] }
    })
  }

  // Estimate tempo
  const envBpm = findTempoFromEnvelope(energy, sr, hopSize)
  const subdivSec = envBpm ? (60 / envBpm / 4) : 0.10

  // Dedup
  const dedupGaps: Record<BeatType, number> = {
    kick:              Math.max(0.18, subdivSec),
    snare:             Math.max(0.10, subdivSec),
    hihat:             Math.max(0.04, subdivSec / 2),
    'open-hihat':      Math.max(0.10, subdivSec),
    clap:              Math.max(0.10, subdivSec),
    tom:               Math.max(0.15, subdivSec),
    crash:             Math.max(0.40, subdivSec * 4),
    rim:               Math.max(0.06, subdivSec / 2),
    'guitar-acoustic': Math.max(0.06, subdivSec / 2),
    'guitar-electric': Math.max(0.06, subdivSec / 2),
    'guitar-nylon':    Math.max(0.06, subdivSec / 2),
    'piano-grand':     Math.max(0.05, subdivSec / 2),
    'piano-electric':  Math.max(0.05, subdivSec / 2),
    'piano-rhodes':    Math.max(0.05, subdivSec / 2),
    'synth-lead':      Math.max(0.05, subdivSec / 2),
    'synth-pad':       Math.max(0.10, subdivSec),
    'synth-bass':      Math.max(0.08, subdivSec / 2),
    'synth-arp':       Math.max(0.04, subdivSec / 4),
    other:             Math.max(0.08, subdivSec),
  }
  const lastByType: Partial<Record<BeatType, number>> = {}
  let dedupedHits = hits.filter(hit => {
    const gap = dedupGaps[hit.type]
    const last = lastByType[hit.type] ?? -Infinity
    if (hit.time - last < gap) return false
    lastByType[hit.type] = hit.time
    return true
  })

  // Grid-snap to 16th notes
  if (envBpm) {
    const gridSec = 60 / envBpm / 4
    const slotMap = new Map<string, BeatHit>()
    for (const hit of dedupedHits) {
      const slot = Math.round(hit.time / gridSec)
      const key = `${hit.type}:${slot}`
      const existing = slotMap.get(key)
      if (!existing || hit.velocity > existing.velocity) {
        slotMap.set(key, { ...hit, time: slot * gridSec })
      }
    }
    dedupedHits = Array.from(slotMap.values()).sort((a, b) => a.time - b.time)
  }

  // Pitch detection — refine note from default when a clear pitch is found
  for (const hit of dedupedHits) {
    const freq = detectPitch(audioBuffer, Math.floor(hit.time * sr), sr)
    if (freq !== null) {
      const midi = Math.round(69 + 12 * Math.log2(freq / 440))
      if (midi >= 24 && midi <= 96) hit.note = midi
    }
  }

  const bpm = envBpm ?? estimateBPM(dedupedHits.map(h => h.time))
  return { hits: dedupedHits, bpm, duration: audioBuffer.duration }
}
