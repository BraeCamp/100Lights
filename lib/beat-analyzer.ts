/**
 * Client-side beat analysis: onset detection, frequency classification, BPM estimation.
 * Runs entirely in the browser via OfflineAudioContext — no server calls needed.
 */

export type BeatType = 'kick' | 'snare' | 'hihat' | 'clap' | 'other'

export interface BeatHit {
  id: string
  time: number       // seconds from start of recording
  type: BeatType
  velocity: number   // 0–1 (derived from onset strength)
  note?: number      // MIDI note number (set by pitch detector in future phase)
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

  // NSDF (normalized square difference) — more reliable than raw autocorrelation
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
// More robust than IOI-from-peaks because it doesn't depend on correct
// onset detection — it listens to the rhythm in the raw energy signal.

function findTempoFromEnvelope(energy: Float32Array, sr: number, hopSize: number): number | null {
  const envSr = sr / hopSize
  const minPeriod = Math.floor(envSr * 60 / 220)  // max 220 BPM
  const maxPeriod = Math.floor(envSr * 60 / 55)   // min 55 BPM
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

// ── Main analysis entry point ─────────────────────────────────────────────────

export async function analyzeBeats(audioBuffer: AudioBuffer): Promise<BeatAnalysis> {
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

  // Step 2: onset strength = positive first-derivative of energy
  const onset = new Float32Array(nFrames)
  for (let i = 1; i < nFrames; i++) onset[i] = Math.max(0, energy[i] - energy[i - 1])

  // Step 3: adaptive threshold + peak picking
  const smoothHalf = Math.max(1, Math.floor((0.4 * sr) / hopSize))
  const minGap = Math.max(2, Math.floor((0.09 * sr) / hopSize))  // 90 ms
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

  // Step 4: filter the entire buffer into three frequency bands for classification
  const [kickBand, snareBand, hihatBand] = await Promise.all([
    renderFiltered(audioBuffer, 'lowpass',  200, 0.7),   // 0–200 Hz → kick
    renderFiltered(audioBuffer, 'bandpass', 900, 1.0),   // ~400–2k Hz → snare/clap
    renderFiltered(audioBuffer, 'highpass', 5000, 0.7),  // 5 kHz+ → hi-hat
  ])

  // Step 5: classify each onset
  const classWindow = 0.06  // 60 ms window around each onset
  const hits: BeatHit[] = pickedSamples.map((sampleIdx) => {
    const t = sampleIdx / sr
    const kickE  = rmsWindow(kickBand,  sampleIdx, sr, classWindow)
    const snareE = rmsWindow(snareBand, sampleIdx, sr, classWindow)
    const hihatE = rmsWindow(hihatBand, sampleIdx, sr, classWindow)
    const total  = kickE + snareE + hihatE

    let type: BeatType = 'other'
    if (total > 0) {
      const kR = kickE / total
      const hR = hihatE / total
      if      (kR > 0.45)  type = 'kick'
      else if (hR > 0.38)  type = 'hihat'
      else                  type = 'snare'
    }

    // Clap heuristic: snare with very high energy spike
    if (type === 'snare') {
      const frameIdx = Math.floor(sampleIdx / hopSize)
      if (frameIdx < energy.length && energy[frameIdx] > 0.15) type = 'clap'
    }

    const vel = Math.min(1, Math.max(0.15,
      onset[Math.floor(sampleIdx / hopSize)] * 40,
    ))

    return { id: crypto.randomUUID(), time: t, type, velocity: vel }
  })

  // Estimate tempo from the raw energy envelope (independent of onset picks)
  const envBpm = findTempoFromEnvelope(energy, sr, hopSize)
  // 16th-note duration at detected tempo; fall back to 100 ms if tempo unknown
  const subdivSec = envBpm ? (60 / envBpm / 4) : 0.10

  // Post-classification dedup: gaps are the larger of a physical minimum or
  // one 16th note, so no single instrument fires faster than the musical grid.
  const dedupGaps: Record<BeatType, number> = {
    kick:  Math.max(0.18, subdivSec),
    snare: Math.max(0.10, subdivSec),
    hihat: Math.max(0.04, subdivSec / 2),  // hihats can subdivide further
    clap:  Math.max(0.10, subdivSec),
    other: Math.max(0.08, subdivSec),
  }
  const lastByType: Partial<Record<BeatType, number>> = {}
  const dedupedHits = hits.filter(hit => {
    const gap = dedupGaps[hit.type]
    const last = lastByType[hit.type] ?? -Infinity
    if (hit.time - last < gap) return false
    lastByType[hit.type] = hit.time
    return true
  })

  // Pitch detection — sets note on hits where a clear fundamental is detected
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

// ── Web Audio drum synthesis (no external samples needed for Phase 1) ────────

export function synthKick(ctx: AudioContext, when: number, velocity = 1, maxDur = 0.45) {
  const dur = Math.max(0.12, Math.min(0.45, maxDur))
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.setValueAtTime(160, when)
  osc.frequency.exponentialRampToValueAtTime(50, when + 0.12)
  gain.gain.setValueAtTime(velocity * 0.9, when)
  gain.gain.exponentialRampToValueAtTime(0.001, when + dur)
  osc.start(when)
  osc.stop(when + dur + 0.05)
}

export function synthSnare(ctx: AudioContext, when: number, velocity = 1) {
  const len = Math.floor(ctx.sampleRate * 0.18)
  const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource()
  noise.buffer = nBuf
  const nFilt = ctx.createBiquadFilter()
  nFilt.type = 'bandpass'
  nFilt.frequency.value = 1800
  nFilt.Q.value = 0.6
  const nGain = ctx.createGain()
  noise.connect(nFilt)
  nFilt.connect(nGain)
  nGain.connect(ctx.destination)
  nGain.gain.setValueAtTime(velocity * 0.6, when)
  nGain.gain.exponentialRampToValueAtTime(0.001, when + 0.18)
  noise.start(when)
  // Tone pop
  const osc = ctx.createOscillator()
  const tg = ctx.createGain()
  osc.connect(tg)
  tg.connect(ctx.destination)
  osc.frequency.value = 185
  tg.gain.setValueAtTime(velocity * 0.35, when)
  tg.gain.exponentialRampToValueAtTime(0.001, when + 0.07)
  osc.start(when)
  osc.stop(when + 0.1)
}

export function synthHihat(ctx: AudioContext, when: number, velocity = 1, open = false) {
  const dur = open ? 0.35 : 0.045
  const len = Math.floor(ctx.sampleRate * dur)
  const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
  const nd = nBuf.getChannelData(0)
  for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1
  const noise = ctx.createBufferSource()
  noise.buffer = nBuf
  const filt = ctx.createBiquadFilter()
  filt.type = 'highpass'
  filt.frequency.value = 8000
  const gain = ctx.createGain()
  noise.connect(filt)
  filt.connect(gain)
  gain.connect(ctx.destination)
  gain.gain.setValueAtTime(velocity * 0.3, when)
  gain.gain.exponentialRampToValueAtTime(0.001, when + dur)
  noise.start(when)
}

export function synthClap(ctx: AudioContext, when: number, velocity = 1) {
  // Three slightly offset noise bursts
  for (const offset of [0, 0.01, 0.022]) {
    const t = when + offset
    const len = Math.floor(ctx.sampleRate * 0.06)
    const nBuf = ctx.createBuffer(1, len, ctx.sampleRate)
    const nd = nBuf.getChannelData(0)
    for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1
    const noise = ctx.createBufferSource()
    noise.buffer = nBuf
    const filt = ctx.createBiquadFilter()
    filt.type = 'bandpass'
    filt.frequency.value = 1200
    filt.Q.value = 0.8
    const gain = ctx.createGain()
    noise.connect(filt)
    filt.connect(gain)
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(velocity * 0.5, t)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
    noise.start(t)
  }
}

export function synthOther(ctx: AudioContext, when: number, velocity = 1) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = 'triangle'
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.value = 440
  gain.gain.setValueAtTime(velocity * 0.3, when)
  gain.gain.exponentialRampToValueAtTime(0.001, when + 0.1)
  osc.start(when)
  osc.stop(when + 0.12)
}

export function triggerHit(ctx: AudioContext, hit: BeatHit, when: number) {
  const v = hit.velocity
  switch (hit.type) {
    case 'kick':  return synthKick(ctx, when, v)
    case 'snare': return synthSnare(ctx, when, v)
    case 'hihat': return synthHihat(ctx, when, v)
    case 'clap':  return synthClap(ctx, when, v)
    default:      return synthOther(ctx, when, v)
  }
}
