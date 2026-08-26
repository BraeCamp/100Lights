// One definition of every audio measurement in this project.
//
// WHY THIS FILE IS THE POINT
// There were four analyzers here and they disagreed. On the same file,
// analyze-mix.py called Iced "dull/dark — 1% over 2 kHz, muddy, 64% under
// 120 Hz" while song-sections.mjs reported 24–46% air and a 2.7 kHz centroid.
// Both were "right": they used different band edges, different windowing and
// different weighting. The effect is worse than having no analyzer, because a
// mixing decision made against one of them is unreproducible against the other,
// and there was no way to tell which number to believe.
//
// So: the band edges, the loudness definition and the windowing live here, once,
// and every tool imports them. If a number needs to change it changes for
// everything at the same time, and old measurements become comparable to new
// ones by re-running rather than by argument.
//
// Loudness is real ITU-R BS.1770-4 (K-weighting, 400 ms blocks, -70 LUFS
// absolute gate, -10 LU relative gate), implemented here in plain JS because the
// system Python on this machine has no numpy and the venv that does is not what
// `python3` resolves to. Peak is TRUE peak (4x oversampled), not sample peak,
// because sample peak cannot see the inter-sample overs that a lossy encode
// turns into audible distortion.

import { readWav } from './offline-dsp.mjs'
export { readWav }

// ── Bands ───────────────────────────────────────────────────────────────────
// Eight bands, chosen to match how mix problems are actually described. `mud`
// and `boxy` overlap the low-mid deliberately: they are diagnoses, not a
// partition, and are reported separately from the eight that do sum to 1.
export const BANDS = [
  ['sub', 20, 60],
  ['bass', 60, 120],
  ['lowMid', 120, 400],
  ['mid', 400, 900],
  ['highMid', 900, 2500],
  ['presence', 2500, 5000],
  ['brilliance', 5000, 10000],
  ['air', 10000, 20000],
]
export const DIAGNOSTIC_BANDS = { mud: [200, 500], boxy: [300, 700] }

// ── FFT ─────────────────────────────────────────────────────────────────────
function fftInPlace(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len
    const wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k]
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr
        re[i + k] = ur + vr; im[i + k] = ui + vi
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi
        const ncr = cr * wr - ci * wi
        ci = cr * wi + ci * wr; cr = ncr
      }
    }
  }
}

const hann = n => { const w = new Float32Array(n); for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)); return w }

/**
 * Average power spectrum over the whole signal (Welch: Hann-windowed, 50%
 * overlap). Returns power per bin, already normalised so bins sum to the mean
 * power of the signal.
 */
export function spectrum(sig, sr, fftSize = 8192) {
  const win = hann(fftSize)
  const hop = fftSize >> 1
  const acc = new Float64Array(fftSize / 2)
  let blocks = 0
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize)
  for (let pos = 0; pos + fftSize <= sig.length; pos += hop) {
    for (let i = 0; i < fftSize; i++) { re[i] = sig[pos + i] * win[i]; im[i] = 0 }
    fftInPlace(re, im)
    for (let k = 0; k < fftSize / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k]
    blocks++
  }
  if (!blocks) return { power: acc, sr, fftSize, binHz: sr / fftSize }
  for (let k = 0; k < acc.length; k++) acc[k] /= blocks
  return { power: acc, sr, fftSize, binHz: sr / fftSize }
}

// Half-open [lo, hi): a bin belongs to exactly one band. Rounding both ends
// outward instead put the two bins either side of every boundary into BOTH
// bands, and since the sub/bass boundary sits where the energy is, that alone
// inflated the sub band by about 15% of the whole mix — enough to diagnose a
// perfectly balanced track as bass-heavy.
const bandPower = (spec, lo, hi) => {
  let p = 0
  const a = Math.max(1, Math.ceil(lo / spec.binHz))
  const b = Math.min(spec.power.length - 1, Math.ceil(hi / spec.binHz) - 1)
  for (let k = a; k <= b; k++) p += spec.power[k]
  return p
}

/** Band energies as a fraction of total, plus centroid and 85% rolloff. */
export function spectralProfile(sig, sr) {
  const spec = spectrum(sig, sr)
  // Normalise against the AUDIBLE range only. Dividing by all power up to
  // Nyquist made every band fraction depend on the sample rate — the same mix at
  // 48 kHz reads 17% quieter in every band than at 40 kHz, purely because of
  // content nobody can hear. Bands now sum to 1 and each one means "share of
  // what you can actually hear".
  const total = Math.max(1e-20, bandPower(spec, 20, 20000))
  const bands = {}
  for (const [name, lo, hi] of BANDS) bands[name] = +(bandPower(spec, lo, hi) / total).toFixed(4)
  const diag = {}
  for (const [name, [lo, hi]] of Object.entries(DIAGNOSTIC_BANDS)) diag[name] = +(bandPower(spec, lo, hi) / total).toFixed(4)
  let num = 0
  for (let k = 1; k < spec.power.length; k++) num += k * spec.binHz * spec.power[k]
  const centroid = num / total
  let run = 0, rolloff = 0
  for (let k = 1; k < spec.power.length; k++) { run += spec.power[k]; if (run >= 0.85 * total) { rolloff = k * spec.binHz; break } }
  return { bands, diag, centroidHz: Math.round(centroid), rolloffHz: Math.round(rolloff) }
}

// ── Loudness (ITU-R BS.1770-4) ──────────────────────────────────────────────
// The two K-weighting stages, as specified: a +4 dB high shelf around 1.5 kHz
// modelling the head, then a high-pass at ~38 Hz.
function kWeight(sig, sr) {
  const out = Float32Array.from(sig)
  // Stage 1 — high shelf. Coefficients are the spec's, referenced to 48 kHz and
  // re-derived for another rate by the same bilinear transform.
  const f0 = 1681.974450955533, G = 3.999843853973347, Q = 0.7071752369554196
  const K = Math.tan(Math.PI * f0 / sr)
  const Vh = Math.pow(10, G / 20), Vb = Math.pow(Vh, 0.4996667741545416)
  let a0 = 1 + K / Q + K * K
  const b = [(Vh + Vb * K / Q + K * K) / a0, 2 * (K * K - Vh) / a0, (Vh - Vb * K / Q + K * K) / a0]
  const a = [1, 2 * (K * K - 1) / a0, (1 - K / Q + K * K) / a0]
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  for (let i = 0; i < out.length; i++) {
    const x = out[i]
    const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    out[i] = y
  }
  // Stage 2 — high-pass.
  const f2 = 38.13547087602444, Q2 = 0.5003270373238773
  const K2 = Math.tan(Math.PI * f2 / sr)
  a0 = 1 + K2 / Q2 + K2 * K2
  const b2 = [1, -2, 1]
  const a2 = [1, 2 * (K2 * K2 - 1) / a0, (1 - K2 / Q2 + K2 * K2) / a0]
  x1 = 0; x2 = 0; y1 = 0; y2 = 0
  for (let i = 0; i < out.length; i++) {
    const x = out[i]
    const y = (b2[0] * x + b2[1] * x1 + b2[2] * x2) / a0 - a2[1] * y1 - a2[2] * y2
    x2 = x1; x1 = x; y2 = y1; y1 = y
    out[i] = y
  }
  return out
}

/** Integrated loudness in LUFS, plus short-term loudness range (LRA). */
export function loudness(l, r, sr) {
  const kl = kWeight(l, sr), kr = kWeight(r, sr)
  const blockSec = 0.4, stepSec = 0.1
  const block = Math.floor(blockSec * sr), step = Math.floor(stepSec * sr)
  const blocks = []
  for (let pos = 0; pos + block <= kl.length; pos += step) {
    let sl = 0, sr2 = 0
    for (let i = pos; i < pos + block; i++) { sl += kl[i] * kl[i]; sr2 += kr[i] * kr[i] }
    blocks.push((sl + sr2) / block)   // both channels weighted 1.0
  }
  if (!blocks.length) return { lufs: -70, lra: 0, shortTerm: [] }
  const lk = ms => -0.691 + 10 * Math.log10(Math.max(1e-20, ms))
  const absGated = blocks.filter(m => lk(m) > -70)
  if (!absGated.length) return { lufs: -70, lra: 0, shortTerm: [] }
  const meanAbs = absGated.reduce((a, b) => a + b, 0) / absGated.length
  const relThresh = lk(meanAbs) - 10
  const relGated = absGated.filter(m => lk(m) > relThresh)
  const mean = (relGated.length ? relGated : absGated).reduce((a, b) => a + b, 0) / (relGated.length || absGated.length)

  // Loudness range is a DIFFERENT measurement from integrated loudness and gets
  // its own blocks: 3-second short-term windows on a 1-second hop, and a
  // relative gate of -20 LU rather than -10. Computing it from the momentary
  // blocks and the integrated gate (the first version here) throws away exactly
  // the quiet passages LRA is meant to be measuring, so an intro-to-drop song
  // reported the same range as a steady tone.
  const stBlock = Math.floor(3 * sr), stStep = Math.floor(1 * sr)
  const stMs = []
  for (let pos = 0; pos + stBlock <= kl.length; pos += stStep) {
    let sl = 0, sr2 = 0
    for (let i = pos; i < pos + stBlock; i++) { sl += kl[i] * kl[i]; sr2 += kr[i] * kr[i] }
    stMs.push((sl + sr2) / stBlock)
  }
  let lra = 0
  const stAbs = stMs.filter(m => lk(m) > -70)
  if (stAbs.length > 1) {
    const stMean = stAbs.reduce((a, b) => a + b, 0) / stAbs.length
    const gate = lk(stMean) - 20
    const kept = stAbs.map(lk).filter(v => v > gate).sort((a, b) => a - b)
    if (kept.length > 1) {
      const pct = p => kept[Math.min(kept.length - 1, Math.floor(p * (kept.length - 1)))]
      lra = pct(0.95) - pct(0.10)
    }
  }

  // The arrangement's own dynamics: how far the song travels between its
  // quietest and loudest passages. LRA deliberately ignores quiet passages; for
  // judging whether a song breathes, they are the point.
  //
  // But the ENDS have to come off first, and this nearly produced a completely
  // wrong conclusion. Measured whole, the reference set appeared to move 26 dB
  // against our 13, which read as "our arrangements are flat". Trimming two
  // seconds from each end collapsed it: the one reference track of comparable
  // length to ours went from 22.6 dB to 6.9. The corpus is mostly 30-40 second
  // clips, and what was being measured was their fade-ins.
  //
  // So: drop leading and trailing blocks that sit far below the integrated
  // loudness. A genuinely quiet section in the MIDDLE still counts, because that
  // is the thing worth measuring.
  const stLk = stMs.map(lk)
  // 40 dB down, not 25. At 25 the trim also ate a genuinely quiet INTRO, which
  // is real dynamics and the opposite of what should be discarded. Only actual
  // silence and fades sit this far under.
  const floor = Math.max(lk(mean) - 40, -65)
  let a = 0, b = stLk.length - 1
  while (a < b && stLk[a] < floor) a++
  while (b > a && stLk[b] < floor) b--
  const stAll = stLk.slice(a, b + 1).filter(v => v > -70).sort((x, y) => x - y)
  const p = q => stAll[Math.min(stAll.length - 1, Math.floor(q * (stAll.length - 1)))]

  return {
    lufs: +lk(mean).toFixed(2),
    lra: +lra.toFixed(2),
    dynamicRangeDb: stAll.length > 1 ? +(p(0.95) - p(0.05)).toFixed(2) : 0,
    shortTerm: blocks.map(lk),
  }
}

/**
 * True peak, 4x oversampled with a windowed-sinc interpolator.
 *
 * Only near the loudest samples. Oversampling every sample of a two-minute
 * stereo file is about 1.6 billion multiply-adds and took longer than rendering
 * the song did — it was the single slowest thing in the whole loop. An
 * inter-sample peak cannot exceed its neighbouring samples by more than a couple
 * of dB, so anything more than 3 dB below the sample peak cannot become the true
 * peak, and there is no need to look there.
 */
export function truePeak(l, r, sr) {
  const OS = 4, TAPS = 32, HALF = TAPS / 2
  const filt = []
  for (let p = 0; p < OS; p++) {
    const h = new Float32Array(TAPS)
    for (let t = 0; t < TAPS; t++) {
      const x = t - HALF + 1 - p / OS
      const s = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      h[t] = s * (0.5 - 0.5 * Math.cos(2 * Math.PI * (t + 0.5) / TAPS))
    }
    filt.push(h)
  }
  let samplePeak = 0
  for (const ch of [l, r]) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > samplePeak) samplePeak = a }
  if (samplePeak === 0) return 0
  const gate = samplePeak * 0.708           // 3 dB down

  let peak = samplePeak
  for (const ch of [l, r]) {
    for (let i = HALF; i < ch.length - HALF; i++) {
      if (Math.abs(ch[i]) < gate) continue
      for (let p = 0; p < OS; p++) {
        let acc = 0
        const h = filt[p]
        for (let t = 0; t < TAPS; t++) acc += ch[i - HALF + t] * h[t]
        const a = Math.abs(acc)
        if (a > peak) peak = a
      }
    }
  }
  return peak
}

// ── Level / dynamics / stereo ───────────────────────────────────────────────

export const db = v => 20 * Math.log10(Math.max(1e-9, v))

export function levels(l, r) {
  let peak = 0, sum = 0, clipped = 0
  for (let i = 0; i < l.length; i++) {
    const a = Math.max(Math.abs(l[i]), Math.abs(r[i]))
    if (a > peak) peak = a
    if (a >= 0.9999) clipped++
    sum += l[i] * l[i] + r[i] * r[i]
  }
  const rms = Math.sqrt(sum / (l.length * 2))
  return { peak, peakDb: +db(peak).toFixed(2), rmsDb: +db(rms).toFixed(2), crestDb: +(db(peak) - db(rms)).toFixed(2), clipped }
}

/** Correlation and side energy — how wide the image really is. */
export function stereo(l, r) {
  let sll = 0, srr = 0, slr = 0, mid = 0, side = 0
  for (let i = 0; i < l.length; i++) {
    sll += l[i] * l[i]; srr += r[i] * r[i]; slr += l[i] * r[i]
    const m = (l[i] + r[i]) * 0.5, s = (l[i] - r[i]) * 0.5
    mid += m * m; side += s * s
  }
  const corr = slr / Math.max(1e-20, Math.sqrt(sll * srr))
  return {
    correlation: +corr.toFixed(3),
    sideDb: +(db(Math.sqrt(side / Math.max(1e-20, l.length))) - db(Math.sqrt(mid / Math.max(1e-20, l.length)))).toFixed(2),
  }
}

/** Per-band correlation: a mix can be wide on top and correctly mono in the sub. */
export function stereoByBand(l, r, sr) {
  const out = {}
  for (const [name, lo, hi] of BANDS) {
    const bl = bandpass(l, sr, lo, hi), br = bandpass(r, sr, lo, hi)
    let sll = 0, srr = 0, slr = 0
    for (let i = 0; i < bl.length; i++) { sll += bl[i] * bl[i]; srr += br[i] * br[i]; slr += bl[i] * br[i] }
    out[name] = +(slr / Math.max(1e-20, Math.sqrt(sll * srr))).toFixed(3)
  }
  return out
}

/** Cheap 2-pole band-pass, only used for band-wise correlation. */
function bandpass(sig, sr, lo, hi) {
  const out = Float32Array.from(sig)
  const rc = (f) => { const w = 2 * Math.PI * f / sr; return w / (w + 1) }
  const ah = rc(lo), al = rc(hi)
  let hp = 0, lp = 0, prev = 0
  for (let i = 0; i < out.length; i++) {
    lp += al * (out[i] - lp)
    hp = (1 - ah) * (hp + lp - prev)
    prev = lp
    out[i] = hp
  }
  return out
}

// ── Time structure ──────────────────────────────────────────────────────────

/** Short-window RMS envelope, in dB, at `hopSec` resolution. */
export function envelope(l, r, sr, hopSec = 0.25) {
  const hop = Math.max(1, Math.floor(hopSec * sr))
  const out = []
  for (let pos = 0; pos + hop <= l.length; pos += hop) {
    let s = 0
    for (let i = pos; i < pos + hop; i++) s += l[i] * l[i] + r[i] * r[i]
    out.push(+db(Math.sqrt(s / (hop * 2))).toFixed(1))
  }
  return out
}

/**
 * Onsets by hysteresis on the envelope — armed above `hi` of local peak,
 * re-armed below `lo`. Flux-based detection misses a note that starts at full
 * amplitude (the rise happens inside one window), which is most of a drum
 * machine, so this deliberately does not use flux.
 */
export function onsets(sig, sr, { hopSec = 0.005, hi = 0.18, lo = 0.10 } = {}) {
  const hop = Math.max(1, Math.floor(hopSec * sr))
  const env = []
  for (let pos = 0; pos + hop <= sig.length; pos += hop) {
    let s = 0
    for (let i = pos; i < pos + hop; i++) s += sig[i] * sig[i]
    env.push(Math.sqrt(s / hop))
  }
  const peak = Math.max(...env, 1e-9)
  const out = []
  let armed = true
  for (let i = 0; i < env.length; i++) {
    if (armed && env[i] > hi * peak) { out.push(i * hopSec); armed = false }
    else if (!armed && env[i] < lo * peak) armed = true
  }
  return out
}

/** Everything, for one stereo signal. */
export function analyze(l, r, sr, { withTruePeak = true, withBandStereo = true } = {}) {
  const mono = new Float32Array(l.length)
  for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) * 0.5
  const lv = levels(l, r)
  const ld = loudness(l, r, sr)
  const sp = spectralProfile(mono, sr)
  const st = stereo(l, r)
  return {
    seconds: +(l.length / sr).toFixed(2),
    lufs: ld.lufs, lra: ld.lra, dynamicRangeDb: ld.dynamicRangeDb,
    peakDb: lv.peakDb,
    truePeakDb: withTruePeak ? +db(truePeak(l, r, sr)).toFixed(2) : null,
    rmsDb: lv.rmsDb, crestDb: lv.crestDb, clipped: lv.clipped,
    centroidHz: sp.centroidHz, rolloffHz: sp.rolloffHz,
    bands: sp.bands, diag: sp.diag,
    correlation: st.correlation, sideDb: st.sideDb,
    bandCorrelation: withBandStereo ? stereoByBand(l, r, sr) : null,
    shortTerm: ld.shortTerm,
  }
}
