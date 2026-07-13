// Real-time monophonic pitch detection for the piano roll's voice mapping.
// Autocorrelation normalized per-lag (McLeod-style), parabolic peak refinement,
// and an optional continuity hint so consecutive frames prefer the candidate
// nearest the note already being sung — the main defense against octave flips.

export interface PitchResult {
  hz: number
  midi: number      // fractional MIDI note (69 = A4 440Hz)
  clarity: number   // 0–1 normalized correlation peak — how "pitched" the frame is
  rms: number
}

export function detectPitch(
  buf: Float32Array,
  sampleRate: number,
  minHz = 70,        // ~C#2 — below a low bass voice
  maxHz = 1050,      // ~C6 — above a high soprano
  prevMidi?: number, // continuity hint from the previous voiced frame
): PitchResult | null {
  const n = buf.length

  let sumSq = 0
  for (let i = 0; i < n; i++) sumSq += buf[i] * buf[i]
  const rms = Math.sqrt(sumSq / n)
  if (rms < 0.01) return null  // silence

  const minLag = Math.floor(sampleRate / maxHz)
  const maxLag = Math.min(Math.floor(sampleRate / minHz), n - 2)
  if (maxLag <= minLag) return null

  // Prefix energies so each lag can be normalized by the energy of the two
  // windows actually being correlated. Plain r/r0 decays with lag, which
  // systematically biases toward short lags (octave-up errors).
  const prefix = new Float64Array(n + 1)
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + buf[i] * buf[i]

  const nsdf = new Float32Array(maxLag + 1)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    const m = n - lag
    for (let i = 0; i < m; i++) sum += buf[i] * buf[i + lag]
    const e1 = prefix[m]                    // energy of x[0..m)
    const e2 = prefix[n] - prefix[lag]      // energy of x[lag..n)
    nsdf[lag] = e1 > 0 && e2 > 0 ? sum / Math.sqrt(e1 * e2) : 0
  }

  let globalMax = 0
  for (let lag = minLag; lag <= maxLag; lag++) if (nsdf[lag] > globalMax) globalMax = nsdf[lag]
  if (globalMax < 0.6) return null  // unvoiced / noise

  // Collect all strong local maxima as candidates
  const threshold = globalMax * 0.85
  const candidates: Array<{ lag: number; clarity: number; midi: number }> = []
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (nsdf[lag] < threshold || nsdf[lag] < nsdf[lag - 1] || nsdf[lag] < nsdf[lag + 1]) continue
    const a = nsdf[lag - 1], b = nsdf[lag], c = nsdf[lag + 1]
    const denom = a - 2 * b + c
    const shift = denom !== 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / denom)) : 0
    const refined = lag + shift
    const hz = sampleRate / refined
    if (hz < minHz || hz > maxHz) continue
    candidates.push({ lag: refined, clarity: b, midi: 69 + 12 * Math.log2(hz / 440) })
    if (candidates.length > 8) break
  }
  if (!candidates.length) return null

  // Selection: with a continuity hint, take the candidate nearest the running
  // pitch when it's competitive; otherwise the first (shortest-lag) strong
  // peak, which is the fundamental once normalization is unbiased.
  let pick = candidates[0]
  if (prevMidi !== undefined) {
    let bestDist = Math.abs(pick.midi - prevMidi)
    for (const c of candidates) {
      const d = Math.abs(c.midi - prevMidi)
      if (d < bestDist && c.clarity >= globalMax * 0.9) { pick = c; bestDist = d }
    }
  }

  return { hz: sampleRate / pick.lag, midi: pick.midi, clarity: pick.clarity, rms }
}
