// ── Music Learning Corpus ─────────────────────────────────────────────────────
// ElevenLabs is a CLOSED API: we only ever see prompt-in / audio-out. So ALL
// "learning" here is REVERSE-ENGINEERED from the audio it returns — especially
// the per-instrument stems produced by its stem-separation. This module:
//   1. reads the stem/mix WAVs (16-bit PCM RIFF, mono downmix) in pure Node,
//   2. reconstructs the musical decisions (tempo, key/mode, chords, per-stem
//      role features, song structure, mix balance) using the DSP primitives in
//      scripts/listen-analyzer.mjs, and
//   3. records each generation as a self-contained entry in a growing corpus at
//      ~/100lights-ml-corpus/ — the seed dataset for a future in-house model and
//      for data-driven "recipes".
//
// HONESTY: audio transcription is approximate. Tempo, key, and especially chords
// are estimates with per-field confidence — never treat a guessed chord as fact.
// What we CANNOT capture (ElevenLabs internals: its model, seed, latent params)
// is explicitly excluded; the corpus README says so.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, appendFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import {
  fft, spectrum, envelope, detectOnsets, detectF0, roleOf, analyzeMix,
} from '../scripts/listen-analyzer.mjs'

export const CORPUS_ROOT = join(homedir(), '100lights-ml-corpus')
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// ── WAV I/O ───────────────────────────────────────────────────────────────────
// Minimal RIFF/WAVE reader for PCM (16-bit primary; 8/24/32-int + 32f handled)
// → { sampleRate, channels, data: Float32Array } downmixed to mono by averaging.
// Chunks are walked (fmt + data) so LIST/fact/etc. between them are skipped.
export function readWav(path) {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE')
    throw new Error(`not a RIFF/WAVE file: ${path}`)
  let fmt = null, dataOff = -1, dataLen = 0
  let off = 12
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4)
    const size = buf.readUInt32LE(off + 4)
    const body = off + 8
    if (id === 'fmt ') {
      fmt = {
        audioFormat: buf.readUInt16LE(body),        // 1 = PCM int, 3 = IEEE float
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      }
    } else if (id === 'data') {
      dataOff = body
      dataLen = Math.min(size, buf.length - body)
    }
    off = body + size + (size & 1) // chunks are word-aligned
  }
  if (!fmt || dataOff < 0) throw new Error(`WAV missing fmt/data chunk: ${path}`)
  const { channels, sampleRate, bitsPerSample, audioFormat } = fmt
  const bytesPerSample = bitsPerSample >> 3
  const frameSize = bytesPerSample * channels
  const frames = Math.floor(dataLen / frameSize)
  const mono = new Float32Array(frames)
  const readSample = (o) => {
    if (audioFormat === 3) return bitsPerSample === 64 ? buf.readDoubleLE(o) : buf.readFloatLE(o)
    switch (bitsPerSample) {
      case 8: return (buf.readUInt8(o) - 128) / 128            // 8-bit is unsigned
      case 16: return buf.readInt16LE(o) / 32768
      case 24: { const v = buf.readIntLE(o, 3); return v / 8388608 }
      case 32: return buf.readInt32LE(o) / 2147483648
      default: throw new Error(`unsupported bitsPerSample ${bitsPerSample}`)
    }
  }
  for (let f = 0; f < frames; f++) {
    let acc = 0
    const base = dataOff + f * frameSize
    for (let c = 0; c < channels; c++) acc += readSample(base + c * bytesPerSample)
    mono[f] = acc / channels
  }
  return { sampleRate, channels, data: mono }
}

// Load ANY audio file to mono Float32 at its native sample rate. .wav is parsed
// directly (fast, no subprocess); everything else (mp3/flac/…) is decoded via
// ffmpeg to raw f32le. targetSr, if given, resamples (linear) for consistency.
export function loadMono(path, { targetSr = null } = {}) {
  let sampleRate, data
  if (/\.wav$/i.test(path)) {
    const w = readWav(path); sampleRate = w.sampleRate; data = w.data
  } else {
    const sr = targetSr || 44100
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', String(sr), '-'],
      { maxBuffer: 1 << 30 })
    sampleRate = sr
    data = new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2).slice()
  }
  if (targetSr && targetSr !== sampleRate) { data = resampleLinear(data, sampleRate, targetSr); sampleRate = targetSr }
  return { sampleRate, data }
}

function resampleLinear(sig, from, to) {
  if (from === to) return sig
  const ratio = to / from, n = Math.floor(sig.length * ratio), out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = i / ratio, i0 = Math.floor(x), frac = x - i0
    out[i] = (sig[i0] || 0) * (1 - frac) + (sig[i0 + 1] || 0) * frac
  }
  return out
}

// ── small stats helpers ───────────────────────────────────────────────────────
const rms = s => { let q = 0; for (let i = 0; i < s.length; i++) q += s[i] * s[i]; return Math.sqrt(q / (s.length || 1)) }
const dbfs = r => r > 0 ? +(20 * Math.log10(r)).toFixed(1) : -99
const median = a => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[b.length >> 1] }
const round = (v, d = 3) => +v.toFixed(d)

// ── Chroma (12-bin pitch-class energy) ────────────────────────────────────────
// Windowed FFT; every bin in [fmin,fmax] is folded onto its pitch class by
// magnitude. Larger fftSize buys low-frequency (bass) resolution. Returns a
// length-12 array (index 0 = C), L1-normalized.
export function chroma(signal, sr, { fmin = 55, fmax = 2093, fftSize = 8192, hop = 4096 } = {}) {
  const half = fftSize >> 1
  const hann = new Float32Array(fftSize)
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1))
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize)
  const binHz = sr / fftSize
  const pc = new Float64Array(12)
  let frames = 0
  for (let start = 0; start + fftSize <= signal.length; start += hop) {
    for (let i = 0; i < fftSize; i++) { re[i] = signal[start + i] * hann[i]; im[i] = 0 }
    fft(re, im)
    for (let i = 1; i < half; i++) {
      const f = i * binHz
      if (f < fmin || f > fmax) continue
      const mag = Math.sqrt(re[i] * re[i] + im[i] * im[i])
      const midi = 69 + 12 * Math.log2(f / 440)
      const cls = ((Math.round(midi) % 12) + 12) % 12
      pc[cls] += mag
    }
    frames++
  }
  const sum = pc.reduce((a, b) => a + b, 0)
  const out = new Array(12)
  for (let i = 0; i < 12; i++) out[i] = sum > 0 ? pc[i] / sum : 0
  return out
}

// ── Key + mode (Krumhansl–Schmuckler) ─────────────────────────────────────────
const KS_MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const KS_MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
function pearson(a, b) {
  const n = a.length
  let ma = 0, mb = 0; for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i] } ma /= n; mb /= n
  let num = 0, da = 0, db = 0
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y }
  return (da > 0 && db > 0) ? num / Math.sqrt(da * db) : 0
}
export function estimateKey(chromaVec) {
  const cand = []
  for (let t = 0; t < 12; t++) {
    const maj = new Array(12), min = new Array(12)
    for (let i = 0; i < 12; i++) { maj[i] = KS_MAJOR[(i - t + 12) % 12]; min[i] = KS_MINOR[(i - t + 12) % 12] }
    cand.push({ root: t, mode: 'major', corr: pearson(chromaVec, maj) })
    cand.push({ root: t, mode: 'minor', corr: pearson(chromaVec, min) })
  }
  cand.sort((a, b) => b.corr - a.corr)
  const best = cand[0], second = cand[1]
  return {
    root: best.root, rootName: NOTE_NAMES[best.root], mode: best.mode,
    // confidence: correlation scaled to 0-1 plus how decisively it beats runner-up
    confidence: round(Math.max(0, best.corr), 3),
    margin: round(best.corr - second.corr, 3),
  }
}

// ── Chord (triad) estimate from a chroma vector, as a roman numeral in-key ─────
const MAJ_DEGREES = { 0: 'I', 2: 'ii', 4: 'iii', 5: 'IV', 7: 'V', 9: 'vi', 11: 'vii°' }
const MIN_DEGREES = { 0: 'i', 2: 'ii°', 3: 'III', 5: 'iv', 7: 'v', 8: 'VI', 10: 'VII' }
const CHROMATIC_ROMAN = ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII']
function romanFor(chordRoot, quality, keyRoot, keyMode) {
  const iv = ((chordRoot - keyRoot) % 12 + 12) % 12
  const table = keyMode === 'minor' ? MIN_DEGREES : MAJ_DEGREES
  let base = table[iv]
  if (base) {
    // adjust case to the DETECTED quality if it disagrees with the diatonic one
    const isMinorNumeral = /^[iv]+°?$/.test(base)
    if (quality === 'major' && isMinorNumeral) base = base.replace('°', '').toUpperCase()
    else if (quality === 'minor' && !isMinorNumeral) base = base.toLowerCase()
    return base
  }
  // non-diatonic: chromatic numeral, cased by quality
  const chrom = CHROMATIC_ROMAN[iv]
  return quality === 'minor' ? chrom.toLowerCase() : chrom
}
export function estimateChord(chromaVec, keyRoot, keyMode) {
  let best = null
  for (let r = 0; r < 12; r++) {
    for (const [quality, third] of [['major', 4], ['minor', 3]]) {
      const tones = [r, (r + third) % 12, (r + 7) % 12]
      let inChord = 0; for (const t of tones) inChord += chromaVec[t]
      let out = 0; for (let i = 0; i < 12; i++) if (!tones.includes(i)) out += chromaVec[i]
      const score = inChord - 0.5 * out
      if (!best || score > best.score) best = { root: r, quality, score, inChord }
    }
  }
  return {
    root: best.root, rootName: NOTE_NAMES[best.root], quality: best.quality,
    roman: romanFor(best.root, best.quality, keyRoot, keyMode),
    confidence: round(Math.max(0, Math.min(1, best.inChord)), 3), // share of energy in the triad
  }
}

// ── Tempo (BPM) — onset-strength autocorrelation on the drum/mix envelope ──────
export function estimateTempo(signal, sr, { min = 60, max = 180 } = {}) {
  const hop = 256, win = 1024
  const { e } = envelope(signal, sr, win, hop)
  const fps = sr / hop
  // onset strength = half-wave-rectified first difference of the envelope
  const flux = new Float64Array(e.length)
  for (let i = 1; i < e.length; i++) { const d = e[i] - e[i - 1]; flux[i] = d > 0 ? d : 0 }
  // mean-remove for autocorrelation
  let mean = 0; for (let i = 0; i < flux.length; i++) mean += flux[i]; mean /= (flux.length || 1)
  for (let i = 0; i < flux.length; i++) flux[i] -= mean
  const lagMin = Math.floor(60 / max * fps), lagMax = Math.ceil(60 / min * fps)
  let best = { lag: 0, val: -Infinity }
  const ac = {}
  for (let lag = lagMin; lag <= lagMax; lag++) {
    let s = 0; for (let i = lag; i < flux.length; i++) s += flux[i] * flux[i - lag]
    ac[lag] = s
    if (s > best.val) best = { lag, val: s }
  }
  let bpm = 60 * fps / best.lag
  // octave sanity: if a slow pick has a strong half-period peak, prefer the double
  const dbl = Math.round(best.lag / 2)
  if (bpm < 100 && ac[dbl] != null && ac[dbl] > best.val * 0.6 && 60 * fps / dbl <= max) bpm = 60 * fps / dbl
  // confidence: strength of the winning peak vs the mean of the searched lags
  const vals = Object.values(ac); const avg = vals.reduce((a, b) => a + b, 0) / (vals.length || 1)
  const conf = avg > 0 ? Math.max(0, Math.min(1, (best.val - avg) / (best.val + Math.abs(avg) + 1e-9))) : 0
  return { bpm: Math.round(bpm), confidence: round(conf, 3), lag: best.lag }
}

// ── Structure — section count + normalized density/energy arc ──────────────────
export function analyzeStructure(signal, sr, { buckets = 8, hopSec = 0.5 } = {}) {
  const win = Math.round(hopSec * sr)
  const coarse = []
  for (let s = 0; s + win <= signal.length; s += win) coarse.push(rms(signal.subarray(s, s + win)))
  if (!coarse.length) coarse.push(rms(signal))
  const mx = Math.max(1e-9, ...coarse)
  // Novelty segmentation: boundary where smoothed energy jumps > threshold of peak
  const smooth = coarse.map((_, i) => {
    let a = 0, n = 0; for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < coarse.length) { a += coarse[j]; n++ } } return a / n
  })
  const boundaries = [0]
  const thresh = 0.18 * mx
  let lastLevel = smooth[0]
  for (let i = 1; i < smooth.length; i++) {
    if (Math.abs(smooth[i] - lastLevel) > thresh && (i - boundaries[boundaries.length - 1]) * hopSec > 3) {
      boundaries.push(i); lastLevel = smooth[i]
    } else lastLevel = 0.7 * lastLevel + 0.3 * smooth[i]
  }
  const durSec = signal.length / sr
  // density/energy arc: `buckets` evenly-spaced RMS samples, normalized to peak
  const arc = new Array(buckets)
  for (let b = 0; b < buckets; b++) {
    const i0 = Math.floor(b * coarse.length / buckets), i1 = Math.max(i0 + 1, Math.floor((b + 1) * coarse.length / buckets))
    let a = 0; for (let i = i0; i < i1; i++) a += coarse[i]
    arc[b] = round((a / (i1 - i0)) / mx, 3)
  }
  return {
    sections: boundaries.length,
    boundariesSec: boundaries.map(b => round(b * hopSec, 1)),
    durationSec: round(durSec, 1),
    densityArc: arc,
  }
}

// ── Per-stem role features ─────────────────────────────────────────────────────
const SILENCE_DB = -55 // below this a "stem" is effectively empty (nothing was there)

function stemFeatures(name, signal, sr, ctx) {
  const role = roleOf(name)
  const loudnessDb = dbfs(rms(signal))
  const durSec = signal.length / sr
  const active = loudnessDb > SILENCE_DB
  // A near-silent stem = the source had no such part. Onset/pitch detection on
  // its noise floor is meaningless, so report it as inactive and stop.
  if (!active) {
    return {
      name, role, active: false, loudnessDb,
      centroid: 0, rolloff: 0, bandPct: {},
      onsets: { count: 0, densityPerSec: 0, medianIOI: 0 },
      note: 'stem effectively silent — no such part in the source',
    }
  }
  const spec = spectrum(signal, sr)
  const on = detectOnsets(signal, sr)
  const feat = {
    name, role, active: true,
    loudnessDb,
    centroid: spec.centroid,
    rolloff: spec.rolloff,
    bandPct: spec.bandPct,
    onsets: {
      count: on.count,
      densityPerSec: round(on.count / durSec, 3),
      medianIOI: round(median(on.iois), 3),
    },
  }

  if (role === 'bass') {
    // Onset-aligned note transcription: f0 per onset window → MIDI pitch list.
    const notes = []
    const bounds = [...on.times, durSec]
    for (let k = 0; k < on.times.length && k < 64; k++) {
      const a = Math.floor(bounds[k] * sr), z = Math.floor(bounds[k + 1] * sr)
      if (z - a < 2048) continue
      const f0 = detectF0(signal.subarray(a, z), sr, 400)
      if (f0 >= 30 && f0 <= 400) {
        const midi = Math.round(69 + 12 * Math.log2(f0 / 440))
        notes.push({ t: round(bounds[k], 2), f0, midi, note: NOTE_NAMES[((midi % 12) + 12) % 12] })
      }
    }
    feat.notes = notes
    feat.noteSequence = notes.map(n => n.note)
  } else if (role === 'drums') {
    // Quantize onsets to a 16th grid → per-step hit histogram + 4-on-floor test.
    const bpm = ctx.bpm || 120
    const sixteenth = 60 / bpm / 4
    const hist = new Array(16).fill(0)
    let bars = 0
    for (const t of on.times) {
      const step = Math.round(t / sixteenth) % 16
      hist[step]++
    }
    bars = Math.max(1, Math.round(durSec / (sixteenth * 16)))
    const grid = hist.map(h => round(h / bars, 2))
    // 4-on-floor: the hits sit on the downbeats (steps 0/4/8/12) with little
    // off-grid activity — true even for a sparse/half-time kick.
    const beatHits = grid[0] + grid[4] + grid[8] + grid[12]
    const total = grid.reduce((a, b) => a + b, 0)
    const offHits = total - beatHits
    feat.grid = grid
    feat.fourOnFloor = total > 0 && beatHits / total > 0.8 && beatHits >= 1.6
  } else if (role !== 'bass') {
    // Harmonic voice (piano/guitar/other/stab/lead/pad): per ~2-bar chord track.
    const bpm = ctx.bpm || 120
    const winSec = (60 / bpm) * ctx.chordWindowBeats
    const winN = Math.floor(winSec * sr)
    const chords = []
    if (winN > 4096) {
      for (let s = 0, i = 0; s + winN <= signal.length && i < 64; s += winN, i++) {
        const seg = signal.subarray(s, s + winN)
        if (rms(seg) < 1e-4) continue // silent window, skip
        const c = chroma(seg, sr)
        const ch = estimateChord(c, ctx.keyRoot, ctx.keyMode)
        chords.push({ t: round(s / sr, 1), ...ch })
      }
    }
    feat.chords = chords
  }
  return feat
}

// Collapse a chord list into a compact roman-numeral progression (dedup repeats).
function progressionOf(chords) {
  const romans = []
  for (const c of chords) { if (!romans.length || romans[romans.length - 1] !== c.roman) romans.push(c.roman) }
  // trim to a representative loop (first up-to-8 distinct-ish)
  return romans.slice(0, 8)
}

// ── The main reverse-engineer ──────────────────────────────────────────────────
// stems: [{ name, wavPath }]   mixPath?: string   opts?: { genre, chordWindowBeats }
export function analyzeSong({ stems, mixPath, opts = {} } = {}) {
  if (!stems || !stems.length) throw new Error('analyzeSong: stems required')
  const chordWindowBeats = opts.chordWindowBeats || 8 // ~2 bars in 4/4
  const genre = opts.genre || 'default'

  // Load every stem to mono at a canonical sample rate (first stem's SR).
  const loaded = stems.map(s => ({ name: s.name, ...loadMono(s.wavPath) }))
  const sr = loaded[0].sampleRate
  for (const l of loaded) if (l.sampleRate !== sr) { const r = resampleLinear(l.data, l.sampleRate, sr); l.data = r; l.sampleRate = sr }

  // Master: use the provided mix; else sum the stems.
  let master
  if (mixPath) master = loadMono(mixPath, { targetSr: sr }).data
  const maxLen = Math.max(...loaded.map(l => l.data.length), master ? master.length : 0)
  if (!master) {
    master = new Float32Array(maxLen)
    for (const l of loaded) for (let i = 0; i < l.data.length; i++) master[i] += l.data[i]
  }

  const byRole = name => loaded.find(l => roleOf(l.name) === name)

  // ── Tempo — from Drums if present, else the master.
  const drum = byRole('drums')
  const tempo = estimateTempo(drum ? drum.data : master, sr)

  // ── Key/mode — chroma summed over the HARMONIC stems that actually have
  // content (exclude drums, and exclude effectively-silent stems whose noise
  // floor would only add spurious pitch classes).
  const harmonicStems = loaded.filter(l => roleOf(l.name) !== 'drums' && dbfs(rms(l.data)) > SILENCE_DB)
  const combinedChroma = new Array(12).fill(0)
  for (const l of harmonicStems) { const c = chroma(l.data, sr); for (let i = 0; i < 12; i++) combinedChroma[i] += c[i] }
  const cSum = combinedChroma.reduce((a, b) => a + b, 0) || 1
  for (let i = 0; i < 12; i++) combinedChroma[i] /= cSum
  const key = estimateKey(combinedChroma)

  const ctx = { bpm: tempo.bpm, keyRoot: key.root, keyMode: key.mode, chordWindowBeats }

  // ── Per-stem features.
  const stemFeats = loaded.map(l => stemFeatures(l.name, l.data, sr, ctx))

  // ── Song-level chord progression from the COMBINED harmonic content per window.
  const progChords = []
  {
    const winSec = (60 / tempo.bpm) * chordWindowBeats
    const winN = Math.floor(winSec * sr)
    const harmSum = new Float32Array(maxLen)
    for (const l of harmonicStems) for (let i = 0; i < l.data.length; i++) harmSum[i] += l.data[i]
    if (winN > 4096) for (let s = 0, i = 0; s + winN <= harmSum.length && i < 64; s += winN, i++) {
      const seg = harmSum.subarray(s, s + winN)
      if (rms(seg) < 1e-4) continue
      const ch = estimateChord(chroma(seg, sr), key.root, key.mode)
      progChords.push({ t: round(s / sr, 1), ...ch })
    }
  }
  const progression = progressionOf(progChords)
  const progConfidence = progChords.length ? round(median(progChords.map(c => c.confidence)), 3) : 0

  // ── Structure from the master.
  const structure = analyzeStructure(master, sr)

  // ── Mix balance (reuse the ear).
  const mixStems = {}
  for (const l of loaded) mixStems[l.name] = l.data
  const mixFull = analyzeMix({ sampleRate: sr, master, stems: mixStems }, { genre })
  const mix = {
    loudnessDb: mixFull.mix.dBFS, peak: mixFull.mix.peak, crestDb: mixFull.mix.crestDb,
    clip: mixFull.mix.clip, centroid: mixFull.mix.centroid, melodicCentroid: mixFull.melodicCentroid,
    bandPct: mixFull.mix.bandPct, presencePct: mixFull.mix.presencePct, weightPct: mixFull.mix.weightPct,
    score: mixFull.score, balance: mixFull.balance,
    verdicts: mixFull.verdicts.slice(0, 6),
  }

  // ── Human-readable summary.
  const drumFeat = stemFeats.find(s => s.role === 'drums')
  const grooveTag = drumFeat ? (drumFeat.fourOnFloor ? '4-on-floor kick' : `${drumFeat.onsets.densityPerSec}/s drum groove`) : 'no drums'
  const brightTag = mix.melodicCentroid != null
    ? (mix.melodicCentroid < 1000 ? 'dark spectral balance' : mix.melodicCentroid > 2600 ? 'bright spectral balance' : 'balanced spectral tone')
    : ''
  const progTag = progression.length ? progression.join('–') : '—'
  const summary = [
    `${tempo.bpm} BPM`,
    `${key.rootName} ${key.mode}`,
    progTag,
    grooveTag,
    brightTag,
    `builds over ${structure.sections} section${structure.sections === 1 ? '' : 's'}`,
  ].filter(Boolean).join(' · ')

  return {
    schemaVersion: 1,
    engine: 'reverse-engineered-from-audio (ElevenLabs internals NOT captured)',
    sampleRate: sr,
    durationSec: structure.durationSec,
    tempo,
    key,
    chroma: combinedChroma.map(v => round(v, 3)),
    progression: { romans: progression, confidence: progConfidence, windowBeats: chordWindowBeats, chords: progChords },
    stems: stemFeats,
    structure,
    mix,
    summary,
    confidenceNotes: {
      tempo: tempo.confidence >= 0.5 ? 'reliable' : 'low — verify',
      key: key.confidence >= 0.6 ? 'reliable' : 'approximate',
      progression: 'APPROXIMATE — triad estimates from chroma, not a transcription',
      bassNotes: 'APPROXIMATE — f0 per onset window',
      structure: 'heuristic energy-novelty segmentation',
    },
  }
}

// ── Corpus recording ───────────────────────────────────────────────────────────
function slugify(s) {
  return (s || 'song').toLowerCase().replace(/[^\w]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'song'
}

const README = `# 100Lights Music Learning Corpus

Every ElevenLabs generation is recorded here as a self-contained entry. This is
the seed dataset for a future in-house music model and for data-driven "recipes".

## IMPORTANT — what is and isn't captured
ElevenLabs is a CLOSED API: we send a text prompt + params and receive audio.
We do NOT (and cannot) capture its model weights, seed, or any latent/internal
parameters. Everything under \`analysis\` is **reverse-engineered from the returned
audio**, primarily the per-instrument stems from ElevenLabs' own stem separation.
Audio transcription is approximate — tempo, key, and especially chords carry
per-field confidence and must never be treated as ground truth.

## Layout
- \`corpus.jsonl\` — one compact line per song (the learnable summary; see schema).
- \`songs/<timestamp>-<slug>/\`
  - \`input.json\`    — title, prompt, params, model, timestamp, request info.
  - \`analysis.json\` — the full reverse-engineered analysis.
  - \`mix.*\`         — a copy of the full-mix render.
  - \`stems/*.wav\`   — copies of the separated stems (self-contained corpus).

## corpus.jsonl line schema
\`{ id, ts, prompt, params, bpm, key, mode, progression, stems:[{role,loudnessDb,onsetDensity}], sections, densityArc, spectralBalance, summary }\`

## analysis.json (per entry)
- \`tempo\`        \`{ bpm, confidence }\` — drum-onset autocorrelation.
- \`key\`          \`{ rootName, mode, confidence, margin }\` — Krumhansl–Schmuckler.
- \`progression\`  roman numerals relative to the key (APPROXIMATE), + per-window chords.
- \`stems[]\`      per-stem: role, loudnessDb, centroid, 8-band balance, onset density,
                 median IOI; bass → note sequence, drums → 16-step grid, harmonic → chords.
- \`structure\`    section count + normalized 8-bucket density/energy arc.
- \`mix\`          loudness/crest/spectral balance/masking (from the "ear").
`

// { title, prompt, params, analysis, mixPath, stemPaths, model?, requestInfo? } → corpusDir
export function recordToCorpus({ title, prompt, params = {}, analysis, mixPath, stemPaths = [], model = 'music_v2', requestInfo = null } = {}) {
  mkdirSync(CORPUS_ROOT, { recursive: true })
  const readmePath = join(CORPUS_ROOT, 'README.md')
  if (!existsSync(readmePath)) writeFileSync(readmePath, README)

  const now = new Date()
  const ts = now.toISOString().replace(/[:.]/g, '-')
  const id = `${ts}-${slugify(title)}`
  const dir = join(CORPUS_ROOT, 'songs', id)
  const stemsDir = join(dir, 'stems')
  mkdirSync(stemsDir, { recursive: true })

  // input.json
  writeFileSync(join(dir, 'input.json'), JSON.stringify({
    id, title, prompt, params, model, timestamp: now.toISOString(),
    requestInfo, note: 'ElevenLabs internals (model weights, seed, latents) are NOT captured — only reverse-engineered audio features.',
  }, null, 2))

  // analysis.json
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify(analysis, null, 2))

  // copy media (self-contained corpus)
  let mixRel = null
  if (mixPath && existsSync(mixPath)) {
    mixRel = `mix${mixPath.match(/\.[a-z0-9]+$/i)?.[0] || '.wav'}`
    copyFileSync(mixPath, join(dir, mixRel))
  }
  // stemPaths entries may be a plain path string OR { name, wavPath|path } so
  // the copies can be named by their PART (Bass.wav) instead of an opaque UUID.
  const stemRels = []
  const seen = {}
  for (const entry of stemPaths) {
    const p = typeof entry === 'string' ? entry : (entry.wavPath || entry.path)
    if (!p || !existsSync(p)) continue
    const label = typeof entry === 'object' && entry.name ? slugify(entry.name) : basename(p, '.wav')
    let fname = `${label}.wav`
    if (seen[fname]) fname = `${label}-${seen[fname]}.wav`
    seen[label + '.wav'] = (seen[label + '.wav'] || 0) + 1
    copyFileSync(p, join(stemsDir, fname)); stemRels.push(`stems/${fname}`)
  }

  // compact jsonl line
  const line = {
    id, ts: now.toISOString(), prompt, params,
    bpm: analysis.tempo.bpm, bpmConfidence: analysis.tempo.confidence,
    key: analysis.key.rootName, mode: analysis.key.mode, keyConfidence: analysis.key.confidence,
    progression: analysis.progression.romans, progressionConfidence: analysis.progression.confidence,
    stems: analysis.stems.map(s => ({ role: s.role, loudnessDb: s.loudnessDb, onsetDensity: s.onsets.densityPerSec })),
    sections: analysis.structure.sections,
    densityArc: analysis.structure.densityArc,
    spectralBalance: analysis.mix.bandPct,
    mixScore: analysis.mix.score,
    summary: analysis.summary,
  }
  appendFileSync(join(CORPUS_ROOT, 'corpus.jsonl'), JSON.stringify(line) + '\n')

  return { corpusDir: dir, id, jsonlLine: line, mixRel, stemRels }
}
