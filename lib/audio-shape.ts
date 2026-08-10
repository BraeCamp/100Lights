// Detect the SHAPING of a mono, single-instrument (stem) signal — the FX + articulation that change
// how notes SOUND, beyond which notes are played. This is the gap in the ElevenLabs learning corpus:
// music-learn.mjs captures notes/chords/structure but nothing time-varying. Every generation can be
// analysed into notes (the audio→MIDI hybrid) + this shaping descriptor, mapped to the app's roll-fx /
// articulation vocabulary so captures are reproducible through the program.
//
// Pure DSP, node-runnable (no DOM). Reuses fftInPlace from transcribe-confidence.
import { fftInPlace } from './transcribe-confidence'

export interface ShapeDescriptor {
  brightnessHz: number                                   // mean spectral centroid → roll-fx filterHz
  filterMotion: number                                   // 0..1 — how much brightness sweeps over time
  vibrato: { rateHz: number; depthCents: number } | null // pitch oscillation → vibratoRate / vibratoDepth
  tremolo: { rateHz: number; depth: number } | null      // amplitude oscillation → tremolo
  drive: number                                          // 0..1 harmonic richness / distortion → drive
  reverb: number                                         // 0..1 decay-tail energy → reverbWet
  slide: number                                          // 0..1 how gliding the pitch transitions are → articulation slide
}

const N = 2048, HOP = 512

// ── per-frame features: rms envelope, spectral centroid, autocorrelation pitch ────────────────────
interface Frames { rms: number[]; centroid: number[]; pitch: number[]; frameRate: number; sr: number; samples: Float32Array }
function analyzeFrames(samples: Float32Array, sr: number): Frames {
  const half = N / 2, binHz = sr / N
  const win = new Float32Array(N)
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  const re = new Float32Array(N), im = new Float32Array(N)
  const rms: number[] = [], centroid: number[] = [], pitch: number[] = []
  const minLag = Math.max(2, Math.floor(sr / 1000)), maxLag = Math.min(N - 1, Math.floor(sr / 55))
  for (let s = 0; s + N <= samples.length; s += HOP) {
    let e = 0
    for (let i = 0; i < N; i++) { const v = samples[s + i]; e += v * v }
    rms.push(Math.sqrt(e / N))
    // autocorrelation pitch (55–1000 Hz); 0 = unvoiced/silent
    let f0 = 0
    if (e > 1e-6) {
      let bestLag = 0, best = 0
      for (let lag = minLag; lag <= maxLag; lag++) {
        let ac = 0
        for (let i = 0; i < N - lag; i++) ac += samples[s + i] * samples[s + i + lag]
        const norm = ac / e
        if (norm > best) { best = norm; bestLag = lag }
      }
      if (best > 0.3 && bestLag > 0) f0 = sr / bestLag
    }
    pitch.push(f0)
    // spectral centroid
    re.fill(0); im.fill(0)
    for (let i = 0; i < N; i++) re[i] = samples[s + i] * win[i]
    fftInPlace(re, im)
    let num = 0, den = 0
    for (let i = 1; i < half; i++) { const m = Math.hypot(re[i], im[i]); num += i * binHz * m; den += m }
    centroid.push(den > 1e-9 ? num / den : 0)
  }
  return { rms, centroid, pitch, frameRate: sr / HOP, sr, samples }
}

const median = (a: number[]): number => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2 }
const pct = (a: number[], p: number): number => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))] }

// Dominant oscillation of a contour within [loHz,hiHz]: returns rate + amplitude(=depth), or null when
// the contour isn't clearly periodic there. Detrends (removes the slow note-level trend) first.
function oscillation(contour: number[], frameRate: number, loHz: number, hiHz: number): { rateHz: number; depth: number } | null {
  if (contour.length < 8) return null
  // detrend with a moving average ~ 1.5 / loHz seconds (long enough to keep the oscillation)
  const w = Math.max(3, Math.round(frameRate / loHz * 1.5))
  const de = contour.map((_, i) => {
    let sum = 0, n = 0
    for (let j = Math.max(0, i - w); j <= Math.min(contour.length - 1, i + w); j++) { sum += contour[j]; n++ }
    return contour[i] - sum / n
  })
  const minLag = Math.max(1, Math.floor(frameRate / hiHz)), maxLag = Math.floor(frameRate / loHz)
  let e0 = 0; for (const v of de) e0 += v * v
  if (e0 < 1e-12) return null
  let bestLag = 0, best = 0
  for (let lag = minLag; lag <= maxLag && lag < de.length; lag++) {
    let ac = 0; for (let i = 0; i < de.length - lag; i++) ac += de[i] * de[i + lag]
    const norm = ac / e0
    if (norm > best) { best = norm; bestLag = lag }
  }
  if (best < 0.3 || !bestLag) return null                 // not periodic in-band
  const rms = Math.sqrt(e0 / de.length)
  return { rateHz: frameRate / bestLag, depth: rms * Math.SQRT2 } // amplitude ≈ rms*√2 for a sinusoid
}

export function analyzeShaping(samples: Float32Array, sr: number): ShapeDescriptor {
  const f = analyzeFrames(samples, sr)
  const peak = Math.max(1e-9, ...f.rms)
  const loudIdx = f.rms.map((r, i) => (r > 0.25 * peak ? i : -1)).filter(i => i >= 0)

  // brightness + filter motion, over loud frames only
  const brights = loudIdx.map(i => f.centroid[i]).filter(c => c > 0)
  const brightnessHz = median(brights)
  const filterMotion = brightnessHz > 0 ? Math.min(1, (pct(brights, 0.9) - pct(brights, 0.1)) / brightnessHz) : 0

  // vibrato: measure oscillation WITHIN each stable-pitch run (a single sustained note), so note-to-note
  // jumps don't masquerade as vibrato. Split runs where the frame-to-frame pitch step exceeds ~60 cents.
  let vibrato: ShapeDescriptor['vibrato'] = null
  {
    const runs: number[][] = []
    let cur: number[] = []
    for (let k = 0; k < f.pitch.length; k++) {
      const p = f.pitch[k]
      if (p > 0 && f.rms[k] > 0.2 * peak) {
        if (cur.length) {
          const step = Math.abs(1200 * Math.log2(p / f.pitch[cur[cur.length - 1]]))
          if (step > 60) { runs.push(cur); cur = [] }        // note change → new run
        }
        cur.push(k)
      } else if (cur.length) { runs.push(cur); cur = [] }
    }
    if (cur.length) runs.push(cur)
    const minLen = Math.round(f.frameRate * 0.2)             // need ~0.2 s of sustained note
    let best: { rateHz: number; depth: number } | null = null
    for (const run of runs) {
      if (run.length < minLen) continue
      const ref = median(run.map(k => f.pitch[k]))
      const cents = run.map(k => 1200 * Math.log2(f.pitch[k] / ref))
      const osc = oscillation(cents, f.frameRate, 3.5, 9)
      if (osc && osc.depth > 12 && (!best || osc.depth > best.depth)) best = osc
    }
    if (best) vibrato = { rateHz: +best.rateHz.toFixed(1), depthCents: Math.round(best.depth) }
  }

  // tremolo: oscillation of the loudness envelope, 3–9 Hz, depth as fraction of mean
  let tremolo: ShapeDescriptor['tremolo'] = null
  const env = loudIdx.map(i => f.rms[i])
  if (env.length >= 8) {
    const meanEnv = env.reduce((s, v) => s + v, 0) / env.length
    const osc = oscillation(env, f.frameRate, 3, 9)
    if (osc && meanEnv > 1e-6 && osc.depth / meanEnv > 0.12) tremolo = { rateHz: +osc.rateHz.toFixed(1), depth: +(Math.min(1, osc.depth / meanEnv)).toFixed(2) }
  }

  // drive: harmonic richness at the loudest voiced frame — energy in high harmonics (5–12) vs low (1–4)
  const drive = estimateDrive(f, loudIdx, peak)

  // reverb: low-level energy that lingers in the quiet tail relative to the peak (a decay tail)
  const reverb = estimateReverb(f.rms, peak)

  // slide: fraction of pitch transitions that GLIDE continuously rather than jump
  const slide = estimateSlide(f.pitch, f.rms, peak, f.frameRate)

  return { brightnessHz: Math.round(brightnessHz), filterMotion: +filterMotion.toFixed(2), vibrato, tremolo, drive: +drive.toFixed(2), reverb: +reverb.toFixed(2), slide: +slide.toFixed(2) }
}

function estimateDrive(f: Frames, loudIdx: number[], peak: number): number {
  if (!loudIdx.length) return 0
  // loudest voiced frame
  let bi = -1, bv = 0
  for (const i of loudIdx) if (f.pitch[i] > 0 && f.rms[i] > bv) { bv = f.rms[i]; bi = i }
  if (bi < 0) return 0
  const s = Math.min(bi * HOP, f.samples.length - N)
  if (s < 0) return 0
  const re = new Float32Array(N), im = new Float32Array(N)
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))
  for (let i = 0; i < N; i++) re[i] = f.samples[s + i] * win[i]
  fftInPlace(re, im)
  const half = N / 2, binHz = f.sr / N, f0 = f.pitch[bi]
  const magAt = (hz: number) => { const b = Math.round(hz / binHz); let m = 0; for (let k = b - 1; k <= b + 1; k++) if (k > 0 && k < half) m = Math.max(m, Math.hypot(re[k], im[k])); return m }
  let low = 0, high = 0
  for (let h = 1; h <= 4; h++) low += magAt(h * f0)
  for (let h = 5; h <= 12; h++) high += magAt(h * f0)
  return low + high < 1e-9 ? 0 : Math.min(1, high / (low + high) * 1.6)
}

function estimateReverb(rms: number[], peak: number): number {
  if (rms.length < 6) return 0
  // energy that lingers in low-level "tail/gap" frames (between/after notes) vs the peak.
  let tail = 0, n = 0
  for (const r of rms) { const rel = r / peak; if (rel > 0.03 && rel < 0.3) { tail += rel; n++ } }
  return n ? Math.min(1, (tail / rms.length) * 4) : 0
}

function estimateSlide(pitch: number[], rms: number[], peak: number, frameRate: number): number {
  // A slide/glide is a MONOTONIC pitch ramp spread across frames (each per-frame step small); a discrete
  // jump changes pitch in a single frame. slide = glides / (glides + jumps).
  const minRun = Math.max(2, Math.round(frameRate * 0.04))    // ≥40 ms
  let glides = 0, jumps = 0, i = 1
  while (i < pitch.length) {
    if (pitch[i] <= 0 || pitch[i - 1] <= 0 || rms[i] < 0.2 * peak) { i++; continue }
    const step = 1200 * Math.log2(pitch[i] / pitch[i - 1])
    if (Math.abs(step) > 250) { jumps++; i++; continue }       // big single-frame change → discrete jump
    if (Math.abs(step) > 15) {                                  // start of a possible ramp
      const up = step > 0; let total = step, run = 1, j = i
      while (j + 1 < pitch.length && pitch[j + 1] > 0) {
        const s2 = 1200 * Math.log2(pitch[j + 1] / pitch[j])
        if ((s2 > 0) === up && Math.abs(s2) > 2 && Math.abs(s2) < 250) { total += s2; run++; j++ } else break
      }
      if (run >= minRun && Math.abs(total) > 120) { glides++; i = j + 1; continue }  // sustained monotonic ramp → glide
    }
    i++
  }
  return glides + jumps ? glides / (glides + jumps) : 0
}

// ── Map the physical descriptor to the app's roll-fx params (approximate, for reproduction) ───────
export interface RollFxGuess { filterHz?: number; vibratoDepth?: number; vibratoRate?: number; tremolo?: number; drive?: number; reverbWet?: number }
export function shapeToRollFx(d: ShapeDescriptor): { rollFx: RollFxGuess; articulation?: 'slide' | 'legato' } {
  const rollFx: RollFxGuess = {}
  if (d.filterMotion > 0.25 || d.brightnessHz < 3000) rollFx.filterHz = Math.round(d.brightnessHz)   // a moving/dark timbre implies a low-pass
  if (d.vibrato) { rollFx.vibratoDepth = Math.min(1, d.vibrato.depthCents / 100); rollFx.vibratoRate = d.vibrato.rateHz }
  if (d.tremolo) rollFx.tremolo = d.tremolo.depth
  if (d.drive > 0.15) rollFx.drive = d.drive
  if (d.reverb > 0.2) rollFx.reverbWet = d.reverb
  return { rollFx, articulation: d.slide > 0.3 ? 'slide' : undefined }
}
