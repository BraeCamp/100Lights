#!/usr/bin/env node
// Study a finished record and extract what actually transfers to writing one.
//
// `listen.mjs` judges our own songs against a target. This is its mirror: point
// it at somebody else's record and it reports the things a producer would take
// away — tempo, key, how the sections are laid out, how far the arrangement
// travels, where the low end sits, and how far off the grid the drums are
// played. It is the only kind of listening available to me, and for this purpose
// it is better than an impression would be: an impression cannot tell you the
// snare is eleven milliseconds late.
//
//   node scripts/study.mjs <track.wav> [--stems=<demucs dir>] [--json]
//
// With `--stems` (a demucs output folder holding drums/bass/other/vocals) it
// does considerably more, and the reason matters: these references have VOCALS
// and our music does not. A vocal sits exactly in the midrange band our mixes
// have been short of, so comparing a full mix against our instrumental would
// blame the arrangement for a missing singer. With stems it compares the
// INSTRUMENTAL, and reads groove from isolated drums where onset detection is
// actually reliable.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { readWav, analyze, levels, spectralProfile, loudness, onsets, envelope, db } from './lib/audio-features.mjs'

const argv = process.argv.slice(2)
const file = argv.find(a => !a.startsWith('--'))
const flag = (n, d = null) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d }
const asJson = argv.includes('--json')
if (!file) { console.error('usage: study.mjs <track.wav> [--stems=dir] [--json]'); process.exit(2) }

const ML = await import('../lib/music-learn.mjs')

function load(path) {
  let p = path
  if (!/\.wav$/i.test(p)) {
    p = join(tmpdir(), `study-${Date.now()}.wav`)
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', path, '-ar', '48000', '-ac', '2', p])
  }
  const w = readWav(readFileSync(p))
  const mono = new Float32Array(w.l.length)
  for (let i = 0; i < mono.length; i++) mono[i] = (w.l[i] + w.r[i]) * 0.5
  return { ...w, mono }
}

const mix = load(file)
const NOTE = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']

// ── Stems ───────────────────────────────────────────────────────────────────
const stemDir = flag('stems')
const stems = {}
if (stemDir && existsSync(stemDir)) {
  for (const f of readdirSync(stemDir)) {
    const m = /^(drums|bass|other|vocals)\.wav$/.exec(f)
    if (m) stems[m[1]] = load(join(stemDir, f))
  }
}
const hasStems = Object.keys(stems).length >= 3

/** Drums + bass + other, without the voice — what we are actually competing with. */
function instrumental() {
  if (!hasStems) return null
  const n = Math.min(...['drums', 'bass', 'other'].map(k => stems[k]?.l.length ?? Infinity))
  const l = new Float32Array(n), r = new Float32Array(n)
  for (const k of ['drums', 'bass', 'other']) {
    const s = stems[k]; if (!s) continue
    for (let i = 0; i < n; i++) { l[i] += s.l[i]; r[i] += s.r[i] }
  }
  return { l, r, sr: mix.sr, frames: n }
}

// ── Musical facts ───────────────────────────────────────────────────────────
const tempo = ML.estimateTempo(mix.mono, mix.sr)
const ch = ML.chroma(mix.mono, mix.sr)
const key = ML.estimateKey(ch)

// ── Groove, from isolated drums where onsets are actually trustworthy ────────
function groove(sig, sr, bpm) {
  const beat = 60 / bpm
  const on = onsets(sig, sr, { hopSec: 0.002, hi: 0.16, lo: 0.08 })
  if (on.length < 8) return null
  // Find the grid phase that best explains the onsets, then measure the residual.
  const sixteenth = beat / 4
  let bestPhase = 0, bestScore = Infinity
  for (let p = 0; p < 40; p++) {
    const phase = (p / 40) * sixteenth
    let s = 0
    for (const t of on) { const d = ((t - phase) % sixteenth + sixteenth) % sixteenth; s += Math.min(d, sixteenth - d) ** 2 }
    if (s < bestScore) { bestScore = s; bestPhase = phase }
  }
  const devs = [], eighthOff = []
  for (const t of on) {
    const rel = (t - bestPhase) / sixteenth
    const nearest = Math.round(rel)
    const devMs = (rel - nearest) * sixteenth * 1000
    if (Math.abs(devMs) > sixteenth * 500) continue
    devs.push(devMs)
    if (((nearest % 2) + 2) % 2 === 1) eighthOff.push(devMs)
  }
  if (!devs.length) return null
  const mean = devs.reduce((a, b) => a + b, 0) / devs.length
  const sd = Math.sqrt(devs.reduce((a, b) => a + (b - mean) ** 2, 0) / devs.length)
  const swingMean = eighthOff.length ? eighthOff.reduce((a, b) => a + b, 0) / eighthOff.length : 0
  return {
    onsets: on.length,
    perSec: +(on.length / (sig.length / sr)).toFixed(2),
    meanDeviationMs: +mean.toFixed(1),
    spreadMs: +sd.toFixed(1),
    swingPct: +(50 + (swingMean / (sixteenth * 1000)) * 50).toFixed(1),
  }
}

// ── Arrangement: how far the record travels, section by section ─────────────
function arc(l, r, sr) {
  const env = envelope(l, r, sr, 1.0)          // one point per second
  const sorted = [...env].filter(v => v > -70).sort((a, b) => a - b)
  const p = q => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]
  // Where the level steps by more than 3 dB against a smoothed baseline.
  const smooth = env.map((_, i) => {
    const a = Math.max(0, i - 2), b = Math.min(env.length, i + 3)
    return env.slice(a, b).reduce((x, y) => x + y, 0) / (b - a)
  })
  const bounds = []
  for (let i = 4; i < smooth.length - 4; i++) {
    const before = smooth.slice(i - 4, i).reduce((a, b) => a + b, 0) / 4
    const after = smooth.slice(i, i + 4).reduce((a, b) => a + b, 0) / 4
    if (Math.abs(after - before) > 3 && (!bounds.length || i - bounds[bounds.length - 1] > 6)) bounds.push(i)
  }
  return { env, sections: bounds.length + 1, boundariesSec: bounds, quietDb: +p(0.05).toFixed(1), loudDb: +p(0.95).toFixed(1) }
}

const inst = instrumental()
const full = analyze(mix.l, mix.r, mix.sr, { withTruePeak: true, withBandStereo: true })
const instA = inst ? analyze(inst.l, inst.r, inst.sr, { withTruePeak: false, withBandStereo: false }) : null
const g = hasStems ? groove(Float32Array.from(stems.drums.mono), mix.sr, tempo.bpm) : groove(mix.mono, mix.sr, tempo.bpm)
const shape = arc(mix.l, mix.r, mix.sr)

// Per-stem balance, relative to the sum — how loud each element sits.
const balance = {}
if (hasStems) {
  let sum = 0
  const rms = {}
  for (const [k, s] of Object.entries(stems)) { const v = levels(s.l, s.r); rms[k] = v.rmsDb; sum += Math.pow(10, v.rmsDb / 10) }
  const sumDb = 10 * Math.log10(sum)
  for (const [k, v] of Object.entries(rms)) balance[k] = +(v - sumDb).toFixed(1)
}

const out = {
  file: basename(file),
  seconds: +(mix.frames / mix.sr).toFixed(1),
  tempo: tempo.bpm, tempoConfidence: tempo.confidence,
  key: `${NOTE[key.root]} ${key.mode}`, keyConfidence: +(key.confidence ?? 0).toFixed(2),
  mix: full, instrumental: instA, groove: g, arrangement: shape, balance,
}

if (asJson) { console.log(JSON.stringify(out, null, 2)); process.exit(0) }

console.log(`\n${out.file}`)
console.log(`  ${out.seconds}s · ${out.tempo} BPM (conf ${out.tempoConfidence}) · ${out.key} (conf ${out.keyConfidence})`)
console.log(`\nMIX      ${full.lufs} LUFS · true peak ${full.truePeakDb} dBTP · crest ${full.crestDb} · ` +
  `range ${full.dynamicRangeDb} dB · correlation ${full.correlation}`)
const band = (label, b) => console.log(`  ${label.padEnd(13)}` +
  Object.entries(b).map(([k, v]) => `${k.slice(0, 4)} ${(v * 100).toFixed(1)}%`).join('  '))
band('full mix', full.bands)
if (instA) band('instrumental', instA.bands)
console.log(`  centroid ${full.centroidHz} Hz` + (instA ? ` · instrumental ${instA.centroidHz} Hz` : ''))

if (Object.keys(balance).length) {
  console.log(`\nBALANCE  (dB relative to the summed stems)`)
  for (const [k, v] of Object.entries(balance).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(8)}${String(v).padStart(7)} dB`)
}
if (g) {
  console.log(`\nGROOVE   ${g.onsets} drum onsets, ${g.perSec}/sec`)
  console.log(`  mean deviation from the grid ${g.meanDeviationMs} ms · spread ±${g.spreadMs} ms · swing ${g.swingPct}%`)
}
console.log(`\nARRANGEMENT  ~${shape.sections} sections · quietest passage ${shape.quietDb} dB · loudest ${shape.loudDb} dB · ` +
  `travels ${(shape.loudDb - shape.quietDb).toFixed(1)} dB`)
console.log(`  boundaries at ${shape.boundariesSec.map(s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`).join(' ') || '—'}`)
console.log('')
