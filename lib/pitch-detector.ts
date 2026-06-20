/**
 * Frame-by-frame pitch detection using normalized autocorrelation (MPM algorithm).
 * Used to:
 *   1. Extract accurate MIDI notes from sung/hummed melodic hits
 *   2. Build a pitch+dynamics curve for voice-to-instrument synthesis
 */

export interface PitchFrame {
  time:      number        // seconds from start
  freq:      number | null // Hz, null = unvoiced / silence
  amplitude: number        // RMS 0-1
  midi:      number | null // MIDI note (rounded), null = unvoiced
}

// ── Autocorrelation pitch detection (MPM / McLeod Pitch Method) ───────────────

function detectPitchInFrame(frame: Float32Array, sampleRate: number): number | null {
  const n    = frame.length
  const half = Math.floor(n / 2)

  // Compute autocorrelation r(lag) and square-mean function m(lag)
  const r = new Float32Array(half)
  const m = new Float32Array(half)
  for (let lag = 0; lag < half; lag++) {
    let sum = 0, sq1 = 0, sq2 = 0
    for (let i = 0; i < half; i++) {
      sum += frame[i] * frame[i + lag]
      sq1 += frame[i] ** 2
      sq2 += frame[i + lag] ** 2
    }
    r[lag] = sum
    m[lag] = (sq1 + sq2) * 0.5
  }

  // Normalized SDF: nsdf(lag) = 2*r(lag) / m(lag)
  const nsdf = new Float32Array(half)
  for (let i = 0; i < half; i++) {
    nsdf[i] = m[i] > 0 ? (2 * r[i]) / m[i] : 0
  }

  // Find all positive peaks above threshold
  const THRESHOLD = 0.45
  let d = 1
  // Skip past the initial peak at lag=0
  while (d < half - 1 && nsdf[d] > 0) d++

  let bestLag = -1
  let bestVal = -1
  let prevPos = nsdf[d] > 0

  for (let i = d + 1; i < half - 1; i++) {
    const cur  = nsdf[i]
    const next = nsdf[i + 1]
    const prev = nsdf[i - 1]
    // Local maximum crossing threshold
    if (cur > THRESHOLD && cur >= next && cur > prev && !prevPos) {
      if (cur > bestVal) { bestVal = cur; bestLag = i }
    }
    prevPos = cur > 0
  }

  if (bestLag < 2 || bestVal < THRESHOLD) return null

  // Parabolic interpolation for sub-sample accuracy
  const a = nsdf[bestLag - 1]
  const b = nsdf[bestLag]
  const c = nsdf[bestLag + 1]
  const denom = a - 2 * b + c
  const interpLag = denom !== 0 ? bestLag + 0.5 * (a - c) / denom : bestLag

  const freq = sampleRate / interpLag
  return freq >= 50 && freq <= 4000 ? freq : null
}

// ── Public: extract pitch curve from a full AudioBuffer ───────────────────────

export function detectPitchCurve(
  audioBuffer: AudioBuffer,
  frameSize = 2048,
  hopSize   = 512,
): PitchFrame[] {
  const raw = audioBuffer.getChannelData(0)
  const sr  = audioBuffer.sampleRate
  const out: PitchFrame[] = []

  for (let offset = 0; offset + frameSize <= raw.length; offset += hopSize) {
    const frame = raw.subarray(offset, offset + frameSize)

    // RMS amplitude
    let sumSq = 0
    for (let i = 0; i < frame.length; i++) sumSq += frame[i] ** 2
    const amplitude = Math.sqrt(sumSq / frame.length)

    const freq = amplitude > 0.008 ? detectPitchInFrame(frame as Float32Array, sr) : null
    out.push({
      time:      offset / sr,
      freq,
      amplitude: Math.min(1, amplitude * 4),   // normalize to 0-1 range
      midi:      freq ? freqToMidi(freq) : null,
    })
  }

  // Smooth out single-frame pitch glitches (median filter over 3 frames)
  for (let i = 1; i < out.length - 1; i++) {
    if (out[i].midi === null && out[i - 1].midi !== null && out[i + 1].midi !== null) {
      const med = Math.round(((out[i - 1].midi ?? 0) + (out[i + 1].midi ?? 0)) / 2)
      out[i] = { ...out[i], midi: med, freq: midiToFreq(med) }
    }
  }

  return out
}

// ── Public: synthesize voice pitch curve as instrument ────────────────────────
// Takes a pitch curve and a sample AudioBuffer, renders a new AudioBuffer
// where the sample plays at each detected pitch (pitch-shifted via playbackRate).

export async function synthesizeFromPitchCurve(
  pitchCurve:   PitchFrame[],
  sampleBuffer: AudioBuffer,
  rootNote:     number,
  totalDuration: number,
): Promise<AudioBuffer> {
  const sr  = sampleBuffer.sampleRate
  const len = Math.ceil(sr * totalDuration)
  const ctx = new OfflineAudioContext(1, len, sr)

  const hopSec = pitchCurve.length > 1 ? (pitchCurve[1].time - pitchCurve[0].time) : 0.05
  const grainLen = hopSec * 2.2  // slight overlap between grains

  for (const frame of pitchCurve) {
    if (frame.midi === null || frame.amplitude < 0.04) continue

    const rate = Math.pow(2, (frame.midi - rootNote) / 12)
    const src  = ctx.createBufferSource()
    src.buffer         = sampleBuffer
    src.playbackRate.value = rate
    src.loop           = true   // loop sample if shorter than grain
    src.loopEnd        = sampleBuffer.duration

    const gain = ctx.createGain()
    const v    = Math.min(1, frame.amplitude)
    // Short fade in/out per grain to avoid clicks
    gain.gain.setValueAtTime(0, frame.time)
    gain.gain.linearRampToValueAtTime(v, frame.time + 0.005)
    gain.gain.setValueAtTime(v, frame.time + grainLen - 0.01)
    gain.gain.linearRampToValueAtTime(0, frame.time + grainLen)

    src.connect(gain)
    gain.connect(ctx.destination)
    src.start(frame.time)
    src.stop(frame.time + grainLen)
  }

  return ctx.startRendering()
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function freqToMidi(freq: number): number {
  return Math.round(69 + 12 * Math.log2(freq / 440))
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

export function midiToName(midi: number): string {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  return `${names[midi % 12]}${Math.floor(midi / 12) - 1}`
}
