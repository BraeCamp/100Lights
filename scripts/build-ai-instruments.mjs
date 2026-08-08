// ── AI-Instrument multisample BUILDER ─────────────────────────────────────────
// Turns ElevenLabs solo-instrument clips (~/Desktop/100lights-ai-renders/
// instrument-samples/<slug>__mix.mp3) into sparse-root "soundfont" packs the app
// can bake into playable multisample presets.
//
//   node scripts/build-ai-instruments.mjs
//
// Each source clip is one SOLO instrument played as two passes separated by a
// long (~2s) silence: PASS 1 = discrete ascending notes (what we sample),
// PASS 2 = slides (ignored). Pipeline per clip:
//   1. decode mp3 → mono f32 @44.1k
//   2. isolate PASS 1 (audio before the first long silence)
//   3. pitch-grid f0 scan → snap to MIDI → median-filter octave flickers →
//      merge equal-pitch runs into note segments (reuses guitar-sampler-poc DSP)
//   4. keep the BEST (longest·loudest) clean ~1s sample per detected pitch
//   5. encode each root → small mono MP3 → base64 data URL
//   6. emit public/ai-instruments/<slug>.js in the midi-js-soundfont text format
//      importSoundfontToLibrary() parses (flat note-name → data:audio/mp3;base64)
//
// The app's importSoundfontToLibrary() bakes EVERY semitone across [minRoot,
// maxRoot] from these sparse roots, so the emitted loNote/hiNote is exactly the
// captured pitch span (every in-range note gets an exact baked sample; nothing
// is left to a silent on-demand path).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fft } from './listen-analyzer.mjs'

const SRC_DIR = '/Users/brae/Desktop/100lights-ai-renders/instrument-samples'
const OUT_DIR = '/Users/brae/100lights/public/ai-instruments'
const SR = 44100

// midi-js-soundfont keys use FLAT note names (matches lib/default-samples.ts
// SF_NOTE_NAMES + sfKeyToMidi). C4 = midi 60 (scientific/MIDI-standard octave).
const SF_FLATS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
const SHARPS   = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const sfKey    = m => `${SF_FLATS[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`
const sharpName = m => `${SHARPS[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`

// ── per-instrument extraction config ──────────────────────────────────────────
// fmax caps the f0 pick below where a bright harmonic could outweigh the
// fundamental (octave error); gateDb is the rest/silence threshold; midiLo/Hi
// bound plausible detections for this instrument's register.
const INSTRUMENTS = [
  { slug: 'grand-piano',    name: 'Grand Piano',    group: 'Piano', fmax: 2200, gateDb: -40, midiLo: 24, midiHi: 100 },
  { slug: 'electric-guitar', name: 'Electric Guitar', group: 'Guitar', fmax: 620, gateDb: -38, midiLo: 38, midiHi: 88 },
  { slug: 'electric-bass',  name: 'Electric Bass',  group: 'Bass', fmax: 320, gateDb: -38, midiLo: 24, midiHi: 60 },
  { slug: 'fretless-bass',  name: 'Fretless Bass',  group: 'Bass', fmax: 320, gateDb: -38, midiLo: 24, midiHi: 60 },
  { slug: 'synth-bass',     name: 'Synth Bass',     group: 'Bass', fmax: 320, gateDb: -40, midiLo: 24, midiHi: 60 },
]

// ── small helpers ─────────────────────────────────────────────────────────────
const rms = s => { let q = 0; for (let i = 0; i < s.length; i++) q += s[i] * s[i]; return Math.sqrt(q / (s.length || 1)) }
const db  = r => 20 * Math.log10(r + 1e-9)
const mtof = m => 440 * Math.pow(2, (m - 69) / 12)

// Harmonic-sum f0 (HPS-style). detectF0() just picks the single strongest bin,
// which for low piano/bass notes is often the 2nd/3rd harmonic → octave errors
// that collapse distinct notes onto one wrong pitch. Scoring each candidate
// fundamental by the sum of its harmonics (weighted 1/k) rewards the true
// fundamental (it alone captures the ODD harmonics) and resists the octave jump.
function f0Harmonic(sig, sr, fmin, fmax, fftSize = 8192) {
  const half = fftSize / 2
  const hann = new Float32Array(fftSize)
  for (let i = 0; i < fftSize; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftSize - 1))
  const re = new Float64Array(fftSize), im = new Float64Array(fftSize)
  const start = Math.max(0, Math.floor(sig.length / 2) - fftSize / 2)   // mid, past attack
  for (let i = 0; i < fftSize; i++) { re[i] = (sig[start + i] || 0) * hann[i]; im[i] = 0 }
  fft(re, im)
  const mag = new Float64Array(half)
  for (let i = 1; i < half; i++) mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i])
  const binHz = sr / fftSize
  const loBin = Math.max(1, Math.floor(fmin / binHz)), hiBin = Math.min(half - 1, Math.ceil(fmax / binHz))
  let best = -1, bf = 0
  for (let b = loBin; b <= hiBin; b++) {
    let score = 0
    for (let k = 1; k <= 6; k++) {
      const fb = b * k
      if (fb >= half) break
      let m = 0
      for (let j = fb - 1; j <= fb + 1; j++) if (j > 0 && j < half && mag[j] > m) m = mag[j]
      score += m / k
    }
    if (score > best) { best = score; bf = b * binHz }
  }
  return bf
}

function fade(slice, sr, fadeInMs = 6, fadeOutMs = 40) {
  const out = Float32Array.from(slice)
  const fi = Math.min(out.length, Math.round(fadeInMs / 1000 * sr))
  const fo = Math.min(out.length, Math.round(fadeOutMs / 1000 * sr))
  for (let i = 0; i < fi; i++) out[i] *= i / fi
  for (let i = 0; i < fo; i++) out[out.length - 1 - i] *= i / fo
  return out
}

function decodeMono(mp3Path) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', mp3Path, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'],
    { maxBuffer: 1 << 30 })
  return new Float32Array(raw.buffer, raw.byteOffset, raw.length >> 2).slice()
}

// Isolate PASS 1: split at the LONGEST silence (the ~2s pass separator) rather
// than the first gap, so a sustained note decaying below gate mid-pass can't cut
// the pass short. Only splits if the longest silence is genuinely long (>=1.4s);
// inter-note gaps within a pass are far shorter.
function isolatePass1(sig, sr, gateDb) {
  const HOP = Math.round(0.03 * sr), WIN = Math.round(0.06 * sr), dt = HOP / sr
  const loud = []
  for (let s = 0; s + WIN <= sig.length; s += HOP) loud.push(db(rms(sig.subarray(s, s + WIN))) > gateDb)
  // find first loud + longest silent run that starts after signal begins
  let firstLoud = loud.indexOf(true)
  if (firstLoud < 0) return sig
  let bestLen = 0, bestStart = -1, run = 0, runStart = 0
  for (let i = firstLoud; i < loud.length; i++) {
    if (!loud[i]) { if (run === 0) runStart = i; run++ }
    else { if (run > bestLen) { bestLen = run; bestStart = runStart }; run = 0 }
  }
  if (bestLen * dt >= 1.4 && bestStart > 0) return sig.subarray(0, bestStart * HOP)
  return sig
}

// Pitch-grid note extraction (adapted from scripts/guitar-sampler-poc.mjs).
function extractNotes(sig, sr, cfg) {
  const HOP = Math.round(0.04 * sr), WIN = Math.round(0.12 * sr)
  const MIN_FRAMES = 3, MAX_DUR = 1.4, MIN_DUR = 0.12
  const frames = []
  for (let s = 0; s + WIN <= sig.length; s += HOP) {
    const seg = sig.subarray(s, s + WIN)
    let midi = -1
    if (db(rms(seg)) > cfg.gateDb) {
      const f0 = f0Harmonic(seg, sr, mtof(cfg.midiLo) * 0.97, mtof(cfg.midiHi) * 1.03)
      if (f0 > 20) { const m = Math.round(69 + 12 * Math.log2(f0 / 440)); if (m >= cfg.midiLo && m <= cfg.midiHi) midi = m }
    }
    frames.push({ s, midi })
  }
  // median filter (window 5) to kill single-frame octave/glitch flickers
  const filt = frames.map((f, i) => {
    const w = []
    for (let k = -2; k <= 2; k++) { const j = i + k; if (j >= 0 && j < frames.length) w.push(frames[j].midi) }
    w.sort((a, b) => a - b)
    return w[w.length >> 1]
  })
  const notes = []
  let i = 0
  while (i < filt.length) {
    const m = filt[i]
    if (m < 0) { i++; continue }
    let j = i
    while (j < filt.length && filt[j] === m) j++
    if (j - i >= MIN_FRAMES) {
      const a = frames[i].s
      const endS = Math.min(sig.length, frames[j - 1].s + WIN)
      const durSec = Math.min(MAX_DUR, (endS - a) / sr)
      if (durSec >= MIN_DUR) {
        const z = Math.min(sig.length, a + Math.floor(durSec * sr))
        notes.push({ startSec: +(a / sr).toFixed(3), durSec: +durSec.toFixed(3), midi: m, sample: fade(sig.subarray(a, z), sr) })
      }
    }
    i = j
  }
  return notes
}

// Reject octave-error outliers. f0 octave errors land HIGH (a bright harmonic
// outweighing the fundamental), so they always inflate the top of the range —
// sometimes consistently enough (same wrong pitch twice) to defeat a count rule.
// Trim the top segment-percentile: real notes dominate the mass, the sparse
// octave-doubled tail above p93 gets cut. Low side is kept intact (errors don't
// land there). Skipped for very short phrases where a tail can't be estimated.
function rejectOutliers(notes) {
  if (notes.length < 10) return notes
  const mids = notes.map(n => n.midi).sort((a, b) => a - b)
  const hiCap = mids[Math.floor((mids.length - 1) * 0.93)]
  return notes.filter(n => n.midi <= hiCap)
}

// best (longest·loudest) sample per detected pitch
function buildMap(notes) {
  const byPitch = new Map()
  for (const n of notes) {
    const score = n.sample.length * (0.7 + 0.3 * Math.min(1, rms(n.sample) * 8))
    const prev = byPitch.get(n.midi)
    if (!prev || score > prev._score) byPitch.set(n.midi, { ...n, _score: score })
  }
  return byPitch
}

// mono 16-bit WAV (for ffmpeg → mp3)
function writeWavMono(path, sig, sr) {
  const n = sig.length, dataLen = n * 2
  const buf = Buffer.alloc(44 + dataLen)
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataLen, 4); buf.write('WAVE', 8)
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28)
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write('data', 36); buf.writeUInt32LE(dataLen, 40)
  let o = 44
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, sig[i]))
    buf.writeInt16LE(Math.round(s < 0 ? s * 32768 : s * 32767), o); o += 2
  }
  writeFileSync(path, buf)
}

// peak-normalize a root sample to a consistent reference before encoding, so
// every baked note sits at a comparable level regardless of where it fell in
// the source clip's own dynamics.
function normalize(sig, target = 0.9) {
  let pk = 0; for (let i = 0; i < sig.length; i++) { const a = Math.abs(sig[i]); if (a > pk) pk = a }
  if (pk < 1e-5) return sig
  const g = Math.min(8, target / pk), out = new Float32Array(sig.length)
  for (let i = 0; i < sig.length; i++) out[i] = sig[i] * g
  return out
}

function rootToMp3B64(sample, sr) {
  // cap to ~1.1s for a compact, clean sustained root
  const cap = Math.min(sample.length, Math.round(1.1 * sr))
  const sig = normalize(fade(sample.subarray(0, cap), sr, 6, 60))
  const wav = join(tmpdir(), `airoot-${Math.random().toString(36).slice(2)}.wav`)
  const mp3 = wav.replace('.wav', '.mp3')
  writeWavMono(wav, sig, sr)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-ac', '1', '-b:a', '96k', mp3])
  const b64 = readFileSync(mp3).toString('base64')
  return `data:audio/mp3;base64,${b64}`
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true })
const summary = []

for (const cfg of INSTRUMENTS) {
  const src = join(SRC_DIR, `${cfg.slug}__mix.mp3`)
  const full = decodeMono(src)
  const pass1 = isolatePass1(full, SR, cfg.gateDb)
  const notes = rejectOutliers(extractNotes(pass1, SR, cfg))
  if (process.env.DEBUG) {
    console.log(`\n[DEBUG ${cfg.slug}] full ${(full.length/SR).toFixed(1)}s → pass1 ${(pass1.length/SR).toFixed(1)}s; ${notes.length} note segments:`)
    console.log('  ' + notes.map(n => `${n.startSec}s:${sharpName(n.midi)}`).join('  '))
  }
  const map = buildMap(notes)
  const pitches = [...map.keys()].sort((a, b) => a - b)
  if (pitches.length === 0) { console.log(`!! ${cfg.slug}: no pitches captured — skipped`); continue }

  // build the sparse-root map (flat note-name → data URL)
  const roots = {}
  for (const m of pitches) roots[sfKey(m)] = rootToMp3B64(map.get(m).sample, SR)

  const lo = pitches[0], hi = pitches[pitches.length - 1]
  const bodyLines = pitches.map(m => `  "${sfKey(m)}": "${roots[sfKey(m)]}"`).join(',\n')
  const js = `/* AI-generated multisample roots for "${cfg.name}".\n` +
    `   Sparse roots (${pitches.length}) → importSoundfontToLibrary() bakes every semitone in ${sharpName(lo)}..${sharpName(hi)}.\n` +
    `   Auto-built by scripts/build-ai-instruments.mjs — do not edit by hand. */\n` +
    `window.__aiInstrument = {\n${bodyLines}\n}\n`
  const outPath = join(OUT_DIR, `${cfg.slug}.js`)
  writeFileSync(outPath, js)

  const bytes = Buffer.byteLength(js)
  summary.push({ ...cfg, count: pitches.length, lo, hi, loName: sharpName(lo), hiName: sharpName(hi),
                 pitches: pitches.map(sharpName), notes: notes.length, kb: (bytes / 1024) })
  console.log(`${cfg.slug.padEnd(16)} pass1 ${ (pass1.length/SR).toFixed(1)}s | notes ${String(notes.length).padStart(3)} | pitches ${String(pitches.length).padStart(2)} ${sharpName(lo)}–${sharpName(hi)} | ${(bytes/1024).toFixed(0)} KB`)
  console.log(`   captured: ${pitches.map(sharpName).join(' ')}`)
}

console.log('\n── SUMMARY (for preset wiring) ─────────────────────────')
let totKb = 0
for (const s of summary) {
  totKb += s.kb
  console.log(`${s.name.padEnd(16)} folder "${s.name} (AI) – All Notes"  loNote:${s.lo} (${s.loName})  hiNote:${s.hi} (${s.hiName})  roots:${s.count}  group:${s.group}`)
}
console.log(`Total pack size: ${totKb.toFixed(0)} KB across ${summary.length} files in ${OUT_DIR}`)
