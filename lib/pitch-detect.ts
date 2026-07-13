// Real-time monophonic pitch detection for the piano roll's voice mapping.
// Normalized autocorrelation with parabolic peak refinement — the same
// approach used to verify the synthesized string presets (±0.5 cent there),
// constrained to the human vocal range so octave errors stay rare.

export interface PitchResult {
  hz: number
  midi: number      // fractional MIDI note (69 = A4 440Hz)
  clarity: number   // 0–1 normalized autocorrelation peak — how "pitched" the frame is
  rms: number
}

export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  minHz = 70,      // ~C#2 — below a low bass voice
  maxHz = 1050,    // ~C6 — above a high soprano
): PitchResult | null {
  const n = buf.length

  let sumSq = 0
  for (let i = 0; i < n; i++) sumSq += buf[i] * buf[i]
  const rms = Math.sqrt(sumSq / n)
  if (rms < 0.01) return null  // silence

  const minLag = Math.floor(sampleRate / maxHz)
  const maxLag = Math.min(Math.floor(sampleRate / minHz), n - 2)
  if (maxLag <= minLag) return null

  // Normalized ACF over the allowed lag range
  const r0 = sumSq
  const acf = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = 0; i < n - lag; i++) sum += buf[i] * buf[i + lag]
    acf[lag] = sum / r0
  }

  // Global max, then prefer the FIRST peak within 90% of it — picks the
  // fundamental over a subharmonic when both correlate strongly.
  let globalMax = 0
  for (let lag = minLag; lag <= maxLag; lag++) if (acf[lag] > globalMax) globalMax = acf[lag]
  if (globalMax < 0.5) return null  // unvoiced / noise

  let best = -1
  const threshold = globalMax * 0.9
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag] >= threshold && acf[lag] >= acf[lag - 1] && acf[lag] >= acf[lag + 1]) { best = lag; break }
  }
  if (best < 0) return null

  // Parabolic interpolation around the peak for sub-sample lag precision
  const a = acf[best - 1], b = acf[best], c = acf[best + 1]
  const denom = a - 2 * b + c
  const shift = denom !== 0 ? 0.5 * (a - c) / denom : 0
  const lag = best + Math.max(-0.5, Math.min(0.5, shift))

  const hz = sampleRate / lag
  if (hz < minHz || hz > maxHz) return null
  return { hz, midi: 69 + 12 * Math.log2(hz / 440), clarity: b, rms }
}
