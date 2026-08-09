// Multi-signal transcription confidence + polyphony detection.
//
// The non-AI YIN detector (lib/voice-backfill) is confident AND correct on a solo melody line —
// even noisy — so those notes cost nothing. The cases that need a smarter/AI pass are POLYPHONY
// (chords: the mono detector reads one wrong note at high YIN clarity) and genuinely ambiguous
// pitch. This module scores each note from SEVERAL signals — not clarity alone — so the hybrid
// pipeline routes ONLY the low-confidence spans onward, and the credit meter bills only that
// fraction. Pure/deterministic, client-safe.
import type { BackfillNote, FeatureFrame } from './voice-backfill'

export interface NoteConfidence {
  confidence: number      // 0..1 — 1 = trust the non-AI note, low = route to the smarter pass
  polyphonic: boolean     // multiple simultaneous pitches detected in the note's window
  clarity: number         // mean YIN clarity over the note
  reasons: string[]       // why it's uncertain, for the UI ('polyphonic' | 'unclear' | 'unstable')
}

// ── Small iterative radix-2 FFT (in-place, magnitudes only used) ─────────────────────────────
function fftInPlace(re: Float32Array, im: Float32Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
}

const FFT_N = 4096

/**
 * Polyphony test: FFT a stable window inside the note; if the strong spectral peaks form ONE
 * harmonic series (integer multiples of a single f0) it's monophonic; if a strong peak sits at a
 * NON-harmonic ratio (a second fundamental — a chord tone like a third or fifth) it's polyphonic.
 * Octave-doublings can't be told from harmonics and are (correctly) not flagged.
 */
export function isPolyphonic(samples: Float32Array, sr: number, startSec: number, durSec: number): boolean {
  // Take a window from the note's body (skip the attack), centred, up to FFT_N samples.
  const bodyStart = startSec + Math.min(0.06, durSec * 0.25)
  const s0 = Math.floor(bodyStart * sr)
  const avail = Math.min(FFT_N, Math.max(0, Math.floor((startSec + durSec) * sr) - s0))
  if (avail < 1024) return false
  const re = new Float32Array(FFT_N), im = new Float32Array(FFT_N)
  for (let i = 0; i < avail; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (avail - 1)) // Hann
    re[i] = (samples[s0 + i] || 0) * w
  }
  fftInPlace(re, im)
  const half = FFT_N / 2
  const mag = new Float32Array(half)
  let maxMag = 1e-9
  for (let i = 0; i < half; i++) { const m = Math.hypot(re[i], im[i]); mag[i] = m; if (m > maxMag) maxMag = m }
  const binHz = sr / FFT_N
  const loBin = Math.max(2, Math.floor(60 / binHz)), hiBin = Math.min(half - 1, Math.floor(2200 / binHz))
  // Peak-pick: local maxima above a fraction of the spectral max, in the pitched range.
  const peaks: { hz: number; m: number }[] = []
  for (let i = loBin; i <= hiBin; i++) {
    if (mag[i] > 0.12 * maxMag && mag[i] >= mag[i - 1] && mag[i] >= mag[i + 1]) peaks.push({ hz: i * binHz, m: mag[i] })
  }
  if (peaks.length < 2) return false
  peaks.sort((a, b) => b.m - a.m)
  const strong = peaks.slice(0, 6).sort((a, b) => a.hz - b.hz)
  const f0 = strong[0].hz
  const topM = Math.max(...strong.map(p => p.m))
  // A strong peak whose freq is NOT near an integer multiple of f0 is a second fundamental.
  for (const p of strong) {
    if (p.m < 0.3 * topM) continue
    const ratio = p.hz / f0
    if (ratio < 1.4) continue                     // skip f0 itself + near-unison
    const nearest = Math.round(ratio)
    if (Math.abs(ratio - nearest) > 0.09 * ratio) return true  // non-harmonic partial → polyphonic
  }
  return false
}

/** Score one note from clarity (curve), pitch stability (curve), and polyphony (spectrum). */
export function scoreNote(note: BackfillNote, curve: FeatureFrame[], samples: Float32Array, sr: number): NoteConfidence {
  const end = note.startSec + note.durSec
  const frames = curve.filter(f => f.time >= note.startSec && f.time <= end && f.midi !== null)
  const clarity = frames.length ? frames.reduce((s, f) => s + (f.clarity || 0), 0) / frames.length : 0
  // Pitch instability: mean |pitchDelta| within the note (glide/wobble ⇒ less certain).
  const instability = frames.length ? frames.reduce((s, f) => s + (f.pitchDelta || 0), 0) / frames.length : 0
  const poly = isPolyphonic(samples, sr, note.startSec, note.durSec)

  const reasons: string[] = []
  let confidence = Math.max(0, Math.min(1, clarity))
  if (poly) { confidence *= 0.3; reasons.push('polyphonic') }
  if (clarity < 0.55) reasons.push('unclear')
  if (instability > 0.6) { confidence *= 0.8; reasons.push('unstable') }
  return { confidence: +confidence.toFixed(3), polyphonic: poly, clarity: +clarity.toFixed(3), reasons }
}

export function scoreNotes(notes: BackfillNote[], curve: FeatureFrame[], samples: Float32Array, sr: number): NoteConfidence[] {
  return notes.map(n => scoreNote(n, curve, samples, sr))
}

/** Fraction of notes below the confidence threshold — what the hybrid would route onward (and bill). */
export function lowConfidenceFraction(scores: NoteConfidence[], threshold = 0.55): number {
  if (!scores.length) return 0
  return scores.filter(s => s.confidence < threshold).length / scores.length
}
