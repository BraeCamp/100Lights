// ── "Voice Test" — a song built to be talked at ─────────────────────────────
//
//   node scripts/song-voicetest.mjs   → ~/Desktop/100lights-songs/Voice Test.cfproj
//
// Not a piece of music. A fixture, and every choice in it serves a command Brae
// is about to try:
//
//   FIVE TRACKS, PLAINLY NAMED. Mute and solo are only testable if you can hear
//   which one went away, so each has a different register and a different job:
//   Drums, Bass 1, Bass 2, Pad, Chords.
//
//   TWO BASSES, ON PURPOSE. "mute bass 2" resolves to exactly one track and
//   runs locally. "mute the bass" resolves to two, which is the case the local
//   resolver is built to DECLINE — so it goes to the assistant and comes back
//   as a question. That is the clarifying-question path, and without an
//   ambiguous pair in the project there is no way to reach it.
//
//   "BASS 2" ALSO EXERCISES THE EAR. It is the name recognition gets wrong most
//   reliably — "base two" — so it is the one that proves the name repair in
//   hear-better.ts is doing something.
//
//   LANDMARKS ON THE EIGHTS. Drums enter at bar 9 and the song thickens at bar
//   17, so "go to bar 9" and "loop bars 9 to 17" can be checked BY EAR rather
//   than by reading the playhead. A position command you cannot hear is a
//   position command you cannot verify.
//
//   OSCILLATORS ONLY. No library presets: a fixture that depends on what is
//   installed fails for reasons that have nothing to do with what is being
//   tested. That lesson cost a whole debugging session on Drift.
//
// 32 bars at 120 — one minute, round numbers, easy to say. A minor, i–VI–III–VII.

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { uid, rng, feel, N, eq3, reverb, compressor, assemble } from './song-kit.mjs'

const BPM = 120
const BPB = 4
const OUT_DIR = join(homedir(), 'Desktop', '100lights-songs')
mkdirSync(OUT_DIR, { recursive: true })

const rand = rng(4242)
const F = feel(rand, BPM)

// A minor: Am – F – C – G. Chosen because it is instantly recognisable, so a
// wrong transpose or a wrong tempo is obvious without checking anything.
const ROOT = [33, 29, 24, 31]                    // A1, F1, C1, G1
const CH = [
  [57, 60, 64],   // Am
  [53, 57, 60],   // F
  [60, 64, 67],   // C
  [55, 59, 62],   // G
]

/** Held roots, one per bar — the low anchor. */
function bassLow(bars, vel) {
  const out = []
  for (let b = 0; b < bars; b++) out.push(N(ROOT[b % 4], b * BPB, BPB * 0.98, F.vary(vel, 4)))
  return out
}

/** The same roots an octave up and shorter, so the two basses are tellable
 *  apart the moment one of them is muted. */
function bassHigh(bars, vel) {
  const out = []
  for (let b = 0; b < bars; b++) {
    for (const beat of [0, 2]) {
      out.push(N(ROOT[b % 4] + 12, b * BPB + beat + F.jitter(6), 1.4, F.vary(vel, 5)))
    }
  }
  return out
}

/** Sustained triads. */
function pad(bars, vel) {
  const out = []
  for (let b = 0; b < bars; b++) {
    for (const p of CH[b % 4]) out.push(N(p - 12, b * BPB + F.jitter(8), BPB * 0.97, F.vary(vel, 5)))
  }
  return out
}

/** Off-beat stabs, so the top of the mix has something rhythmic to lose. */
function chords(bars, vel) {
  const out = []
  for (let b = 0; b < bars; b++) {
    for (const slot of [2, 3.5]) {
      for (const p of CH[b % 4]) out.push(N(p, b * BPB + slot + F.jitter(8), 0.45, F.vary(vel, 6)))
    }
  }
  return out
}

const LANE = { kick: 36, clap: 39, hat: 42 }
function drums(bars, busy) {
  const out = []
  for (let b = 0; b < bars; b++) {
    for (const s of [0, 8]) out.push(N(LANE.kick, b * BPB + s * 0.25, 0.5, F.vary(104, 5)))
    for (const s of [4, 12]) out.push(N(LANE.clap, b * BPB + s * 0.25, 0.4, F.vary(92, 5)))
    const hats = busy ? [0, 2, 4, 6, 8, 10, 12, 14] : [0, 4, 8, 12]
    for (const s of hats) out.push(N(LANE.hat, b * BPB + s * 0.25 + F.jitter(5), 0.14, F.vary(70, 6)))
  }
  return out
}

const tracks = [
  { key: 'drums', id: uid(), name: 'Drums', presetId: null, isDrum: true, volume: 0.5, color: '#f472b6',
    instrument: { type: 'drum', params: { pack: 'techno' } },
    effects: [eq3(1, -2, -2, 120, 600, 7000), compressor(-22, 4, 2)] },

  // The pair that makes "mute the bass" ambiguous on purpose.
  { key: 'bass1', id: uid(), name: 'Bass 1', presetId: null, volume: 0.5, color: '#38bdf8',
    instrument: { type: 'poly', params: {
      waveform: 'triangle', attack: 0.005, decay: 0, sustain: 1, release: 0.1,
      detune: 0, filterType: 'lowpass', filterCutoff: 500, filterResonance: 0.6,
      lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } },
    effects: [eq3(3, -4, -10, 100, 500, 4000), compressor(-20, 3, 1)] },

  { key: 'bass2', id: uid(), name: 'Bass 2', presetId: null, volume: 0.34, color: '#818cf8',
    instrument: { type: 'poly', params: {
      waveform: 'sawtooth', attack: 0.004, decay: 0.12, sustain: 0.4, release: 0.12,
      detune: 6, filterType: 'lowpass', filterCutoff: 1400, filterResonance: 2,
      lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } },
    effects: [eq3(-2, 0, -4, 150, 800, 5000)] },

  { key: 'pad', id: uid(), name: 'Pad', presetId: null, volume: 0.26, pan: 0.12, color: '#a78bfa',
    instrument: { type: 'poly', params: {
      waveform: 'sawtooth', attack: 0.9, decay: 0.8, sustain: 0.7, release: 2.2,
      detune: 12, filterType: 'lowpass', filterCutoff: 1600, filterResonance: 0.8,
      lfoEnabled: true, lfoRate: 0.12, lfoDepth: 0.2, lfoTarget: 'filter', lfoWaveform: 'sine' } },
    effects: [eq3(-8, -3, 0, 300, 900, 6000), reverb(0.35, 2.8, 0.03)] },

  { key: 'chords', id: uid(), name: 'Chords', presetId: null, volume: 0.3, pan: -0.14, color: '#fbbf24',
    instrument: { type: 'poly', params: {
      waveform: 'square', attack: 0.003, decay: 0.16, sustain: 0.2, release: 0.16,
      detune: 8, filterType: 'lowpass', filterCutoff: 2400, filterResonance: 2.4,
      lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } },
    effects: [eq3(-8, 0, -1, 300, 1000, 6000), reverb(0.2, 2.2, 0.02)] },
]

// Layers arrive on the eights so every position command is audible.
const sections = [
  { name: 'A — pad only',        bars: 8, parts: { pad: pad(8, 74) } },
  { name: 'B — drums + bass',    bars: 8, parts: {
    pad: pad(8, 74), drums: drums(8, false), bass1: bassLow(8, 96) } },
  { name: 'C — everything',      bars: 8, parts: {
    pad: pad(8, 78), drums: drums(8, true), bass1: bassLow(8, 100),
    bass2: bassHigh(8, 88), chords: chords(8, 82) } },
  { name: 'D — thinning out',    bars: 8, parts: {
    pad: pad(8, 70), bass1: bassLow(8, 88) } },
]

const out = assemble({
  name: 'Voice Test', bpm: BPM, bpb: BPB, key: 'A', scale: 'minor', swing: 0,
  tracks, sections, bars: [], masterVolume: 0.5,
})

const path = join(OUT_DIR, 'Voice Test.cfproj')
writeFileSync(path, JSON.stringify(out.project))

console.log(`▸ "Voice Test" · ${BPM} BPM · A minor · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(0)}s`)
for (const t of tracks) {
  const clips = out.project.dawProject.arrangementClips.filter(c => c.trackId === t.id)
  console.log(`  ${t.name.padEnd(7)} ${String(clips.length).padStart(2)} clips / ${clips.reduce((n, c) => n + c.notes.length, 0)} notes`)
}
console.log(`  → ${path}`)
console.log(`
  landmarks:  bar 1 pad alone · bar 9 drums enter · bar 17 full · bar 25 thins out
  try:        "go to bar 9"      you should hear the drums start
              "loop bars 9 to 17" the busy section repeats
              "mute bass 2"       one of the two basses drops out
              "mute the bass"     ambiguous — the assistant should ask which`)
