// ── Guitar-Sampler PROOF-OF-CONCEPT ───────────────────────────────────────────
// Turns an ElevenLabs "Guitar" stem (embedded as a data-URL MP3 inside a
// 100Lights .cfproj) into a playable multisample instrument, then renders test
// audio so a human can A/B whether the sampled tone resembles the original.
//
// Standalone — NO app integration. Reuses the analyzer DSP for onset/f0/env.
//   node scripts/guitar-sampler-poc.mjs
//
// Pipeline: extract stem → slice into pitched note samples → build one-sample-
// per-pitch map → resample-based sampler (with optional pitch-glide) → 3 renders.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectF0 } from './listen-analyzer.mjs'

const CFPROJ = '/Users/brae/Desktop/100lights-ai-renders/Concrete Pulse.cfproj'
const OUT_DIR = '/Users/brae/Desktop/100lights-ai-renders/guitar-poc'
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const midiName = m => `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`

mkdirSync(OUT_DIR, { recursive: true })

// ── 1. Extract the Guitar stem (data-URL MP3 → wav → mono Float32) ────────────
function extractStem() {
  const proj = JSON.parse(readFileSync(CFPROJ, 'utf8'))
  const dp = proj.dawProject
  const gt = dp.tracks.find(t => t.name === 'Guitar')
  if (!gt) throw new Error('no Guitar track')
  const clip = (dp.arrangementClips || []).find(c => c.trackId === gt.id && c.audioUrl)
  if (!clip) throw new Error('no Guitar clip with audioUrl')
  const m = /^data:audio\/[^;]+;base64,(.*)$/s.exec(clip.audioUrl)
  if (!m) throw new Error('audioUrl is not a base64 data URL')
  const mp3 = Buffer.from(m[1], 'base64')
  const mp3Path = join(tmpdir(), 'guitar-poc-stem.mp3')
  writeFileSync(mp3Path, mp3)
  // Decode to raw mono f32le at 44.1k via ffmpeg (same approach as loadMono).
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', mp3Path, '-f', 'f32le', '-ac', '1', '-ar', '44100', '-'],
    { maxBuffer: 1 << 30 })
  const data = new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2).slice()
  return { data, sr: 44100, mp3, mp3Path }
}

// ── small helpers ─────────────────────────────────────────────────────────────
const rms = s => { let q = 0; for (let i = 0; i < s.length; i++) q += s[i] * s[i]; return Math.sqrt(q / (s.length || 1)) }

// Fade in/out (linear) applied in-place-ish to a copy, to kill slice clicks.
function fade(slice, sr, fadeInMs = 5, fadeOutMs = 15) {
  const out = Float32Array.from(slice)
  const fi = Math.min(out.length, Math.round(fadeInMs / 1000 * sr))
  const fo = Math.min(out.length, Math.round(fadeOutMs / 1000 * sr))
  for (let i = 0; i < fi; i++) out[i] *= i / fi
  for (let i = 0; i < fo; i++) out[out.length - 1 - i] *= i / fo
  return out
}

// ── 2. Note extraction ────────────────────────────────────────────────────────
// This ElevenLabs guitar is a SUSTAINED post-punk part: pitches change WITHOUT
// amplitude dips, so the amplitude-hysteresis onset detector sees ~1 note over
// 40s (verified). Instead we segment by PITCH: run f0 on a fixed grid, snap to
// MIDI, median-filter out octave/spurious flickers, then merge consecutive
// same-pitch frames into note segments.
//
// fmax is capped at ~470Hz: a distorted guitar's 2nd harmonic often outweighs
// its fundamental, making a naive peak-pick jump an octave (D#4→D#5). Capping
// below the 5th octave forces the pick onto the true fundamental bin.
function extractNotes(sig, sr) {
  const HOP = Math.round(0.04 * sr), WIN = Math.round(0.12 * sr)
  const FMAX = 470
  const GATE_DB = -37       // frames quieter than this = rest (kills the noisy intro)
  const MIN_FRAMES = 3      // a note must persist ≥3 grid frames (~120ms+WIN) to count
  const MAX_DUR = 1.5, MIN_DUR = 0.08

  // per-frame pitch track
  const frames = []
  for (let s = 0; s + WIN <= sig.length; s += HOP) {
    const seg = sig.subarray(s, s + WIN)
    const db = 20 * Math.log10(rms(seg) + 1e-9)
    let midi = -1
    if (db > GATE_DB) {
      const f0 = detectF0(seg, sr, FMAX)
      if (f0 > 20) { const m = Math.round(69 + 12 * Math.log2(f0 / 440)); if (m >= 38 && m <= 79) midi = m }
    }
    frames.push({ s, midi })
  }
  // median filter (window 5) to remove single-frame octave/glitch flickers
  const filt = frames.map((f, i) => {
    const w = []
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < frames.length) w.push(frames[j].midi) }
    w.sort((a, b) => a - b)
    return w[w.length >> 1]
  })
  // merge consecutive equal-pitch runs → note segments
  const notes = []
  let i = 0
  while (i < filt.length) {
    const m = filt[i]
    if (m < 0) { i++; continue }
    let j = i
    while (j < filt.length && filt[j] === m) j++
    const runFrames = j - i
    if (runFrames >= MIN_FRAMES) {
      const a = frames[i].s
      const endS = Math.min(sig.length, frames[j - 1].s + WIN)
      let durSec = Math.min(MAX_DUR, (endS - a) / sr)
      if (durSec >= MIN_DUR) {
        const z = Math.min(sig.length, a + Math.floor(durSec * sr))
        const sample = fade(sig.subarray(a, z), sr)
        notes.push({ startSec: +(a / sr).toFixed(3), durSec: +durSec.toFixed(3), midi: m, sample })
      }
    }
    i = j
  }
  return notes
}

// ── 3. Multisample map: best (longest, loudest) sample per detected pitch ──────
function buildMap(notes) {
  const byPitch = new Map()
  for (const n of notes) {
    const prev = byPitch.get(n.midi)
    // "best" = longest; tie-break louder. Longer notes give a cleaner sustained
    // slice to resample and let ring.
    const score = n.sample.length * (0.7 + 0.3 * Math.min(1, rms(n.sample) * 8))
    if (!prev || score > prev._score) byPitch.set(n.midi, { ...n, _score: score })
  }
  return byPitch
}

// ── 4. Sampler ────────────────────────────────────────────────────────────────
// renderNote(targetMidi, durSec, { slideFromMidi }) → Float32 (mono @ sr)
function makeSampler(map, sr) {
  const pitches = [...map.keys()].sort((a, b) => a - b)
  const nearest = t => pitches.reduce((best, p) =>
    Math.abs(p - t) < Math.abs(best - t) ? p : best, pitches[0])

  function renderNote(targetMidi, durSec, opts = {}) {
    const srcMidi = nearest(targetMidi)
    const src = map.get(srcMidi).sample
    const outN = Math.max(1, Math.round(durSec * sr))
    const out = new Float32Array(outN)

    const slideFrom = opts.slideFromMidi
    const glideN = slideFrom != null ? Math.round(0.09 * sr) : 0 // ~90ms glide

    // Walk a fractional read-position through the source at a per-output-sample
    // ratio. During the glide the ratio moves from (slideFrom→target) so pitch
    // continuously bends; after that it holds at the target ratio.
    let pos = 0
    for (let i = 0; i < outN; i++) {
      let curTargetMidi = targetMidi
      if (glideN && i < glideN) {
        const g = i / glideN // 0→1
        curTargetMidi = slideFrom + (targetMidi - slideFrom) * g
      }
      const ratio = Math.pow(2, (curTargetMidi - srcMidi) / 12)
      const i0 = Math.floor(pos), frac = pos - i0
      const s0 = src[i0] || 0, s1 = src[i0 + 1] || 0
      out[i] = s0 + (s1 - s0) * frac
      pos += ratio
      if (pos >= src.length - 1) { /* ran past the slice: it just decays to 0 */ }
    }

    // Amplitude envelope: few-ms attack, smooth (cosine) release over last ~40ms.
    const atk = Math.min(outN, Math.round(0.004 * sr))
    const rel = Math.min(outN, Math.round(0.04 * sr))
    for (let i = 0; i < atk; i++) out[i] *= i / atk
    for (let i = 0; i < rel; i++) {
      const g = 0.5 - 0.5 * Math.cos(Math.PI * (i / rel)) // 1→0 smooth
      out[outN - 1 - i] *= g
    }
    return { out, srcMidi }
  }
  return { renderNote, pitches, nearest }
}

// ── phrase rendering ──────────────────────────────────────────────────────────
// phrase: [{ midi, durSec }]. gapSec between notes. slide=true → each note
// slides from the previous note's pitch.
function renderPhrase(sampler, phrase, sr, { slide = false, gapSec = 0.02 } = {}) {
  const noteBufs = []
  let totalN = 0
  const stride = Math.round((phrase[0]?.durSec || 0.4 + gapSec) * sr)
  // Lay notes back-to-back at their durSec (which already includes note spacing).
  const positions = []
  let cursor = 0
  let shiftSum = 0, shiftCount = 0
  for (let i = 0; i < phrase.length; i++) {
    const n = phrase[i]
    const opts = slide && i > 0 ? { slideFromMidi: phrase[i - 1].midi } : {}
    const { out, srcMidi } = sampler.renderNote(n.midi, n.durSec, opts)
    shiftSum += Math.abs(n.midi - srcMidi); shiftCount++
    noteBufs.push(out)
    positions.push(cursor)
    cursor += Math.round((n.durSec) * sr)
    totalN = Math.max(totalN, cursor + out.length)
  }
  const mix = new Float32Array(totalN + Math.round(0.5 * sr))
  for (let i = 0; i < noteBufs.length; i++) {
    const b = noteBufs[i], p = positions[i]
    for (let j = 0; j < b.length; j++) mix[p + j] += b[j]
  }
  return { mix, avgShift: shiftCount ? shiftSum / shiftCount : 0 }
}

// ── WAV writer (44.1k stereo 16-bit) + MP3 via ffmpeg ─────────────────────────
function normalize(sig, peakTarget = 0.9) {
  let pk = 0; for (let i = 0; i < sig.length; i++) { const a = Math.abs(sig[i]); if (a > pk) pk = a }
  if (pk < 1e-6) return sig
  const g = peakTarget / pk
  const out = new Float32Array(sig.length)
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] * g
  return out
}
function writeWavStereo(path, mono, sr) {
  const n = mono.length
  const bytesPerSample = 2, channels = 2
  const dataLen = n * channels * bytesPerSample
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(sr, 24)
  buf.writeUInt32LE(sr * channels * bytesPerSample, 28)
  buf.writeUInt16LE(channels * bytesPerSample, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40)
  let o = 44
  for (let i = 0; i < n; i++) {
    let s = Math.max(-1, Math.min(1, mono[i]))
    const v = s < 0 ? s * 32768 : s * 32767
    buf.writeInt16LE(v | 0, o); o += 2
    buf.writeInt16LE(v | 0, o); o += 2 // duplicate to R
  }
  writeFileSync(path, buf)
}
function toMp3(wavPath, mp3Path) {
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', wavPath, '-b:a', '192k', mp3Path])
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
const stem = extractStem()
console.log(`Extracted Guitar stem: ${(stem.data.length / stem.sr).toFixed(1)}s @ ${stem.sr}Hz, mean RMS ${(20 * Math.log10(rms(stem.data))).toFixed(1)} dBFS`)

const notes = extractNotes(stem.data, stem.sr)
const map = buildMap(notes)
const pitches = [...map.keys()].sort((a, b) => a - b)
console.log(`Notes extracted (usable, pitched, in-range): ${notes.length}`)
console.log(`Distinct pitches captured: ${pitches.length} → ${pitches.map(midiName).join(', ')}`)
console.log(`Pitch range: ${midiName(pitches[0])} (midi ${pitches[0]}) … ${midiName(pitches[pitches.length - 1])} (midi ${pitches[pitches.length - 1]})`)

const sampler = makeSampler(map, stem.sr)

// ── Test phrase: A# minor (root A#3 = midi 58). Scale: A# C C# D# F F# G#.
// Keep it inside the captured range to minimize pitch-shift artifacts. A#
// natural-minor riff, ~1 octave, 10 notes, moderate tempo (durSec each).
const Asharp_minor = [58, 60, 61, 63, 65, 66, 68, 70] // A#3 up the scale to A#4 region
// A recognizable descending/ascending post-punk-ish riff (10 notes):
const phraseMidi = [58, 61, 63, 61, 65, 63, 66, 68, 65, 58]
const D = 0.34 // seconds per note (moderate; ~140bpm eighth ≈ 0.214, use quarter-ish)
let phrase = phraseMidi.map(m => ({ midi: m, durSec: D }))

// Snap the phrase toward the captured range so shifts stay small: if a note is
// >5 semis from every captured pitch, octave-shift it toward the captured cloud.
const lo = pitches[0], hi = pitches[pitches.length - 1]
phrase = phrase.map(n => {
  let m = n.midi
  while (m < lo - 5) m += 12
  while (m > hi + 5) m -= 12
  return { midi: m, durSec: n.durSec }
})
console.log(`Test phrase (A# minor riff): ${phrase.map(n => midiName(n.midi)).join(' ')}`)

const plain = renderPhrase(sampler, phrase, stem.sr, { slide: false })
const slideR = renderPhrase(sampler, phrase, stem.sr, { slide: true })
console.log(`Average pitch-shift applied by sampler: ${plain.avgShift.toFixed(2)} semitones`)

// ── Render the 3 outputs ──────────────────────────────────────────────────────
const pOrig = join(OUT_DIR, 'original-stem.mp3')
const pPlain = join(OUT_DIR, 'sampled-plain.mp3')
const pSlide = join(OUT_DIR, 'sampled-slide.mp3')

// original stem: transcode the extracted mp3 straight through (reference tone)
writeFileSync(stem.mp3Path, stem.mp3)
execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', stem.mp3Path, '-b:a', '192k', pOrig])

const wPlain = join(tmpdir(), 'guitar-poc-plain.wav')
const wSlide = join(tmpdir(), 'guitar-poc-slide.wav')
writeWavStereo(wPlain, normalize(plain.mix), stem.sr)
writeWavStereo(wSlide, normalize(slideR.mix), stem.sr)
toMp3(wPlain, pPlain)
toMp3(wSlide, pSlide)

console.log('\n── SUMMARY ─────────────────────────────────────────')
console.log(`Distinct pitches captured : ${pitches.length}  (${midiName(lo)}–${midiName(hi)})`)
console.log(`Total notes extracted     : ${notes.length}`)
console.log(`Avg pitch-shift in phrase  : ${plain.avgShift.toFixed(2)} semitones`)
console.log('Outputs:')
console.log(`  ${pOrig}`)
console.log(`  ${pPlain}`)
console.log(`  ${pSlide}`)
