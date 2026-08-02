#!/usr/bin/env node
// ── The composer (v2 — form + technique driven) ──────────────────────────────
// Genre-driven song generator that DRIVES FROM THE APP'S OWN LIBRARIES
// (lib/genres.ts, lib/drum-presets.ts). v1 was monotonous — every song was the
// same 5 layers over one 4-chord loop. v2 composes with real song-writing
// technique so songs (even same genre) differ meaningfully:
//   · SONG FORM — verse/chorus/bridge/drop/breakdown/outro, not "add layers".
//   · HARMONIC CONTRAST — a different progression for verse vs chorus vs bridge.
//   · DRUM VARIATION — per-section intensity, fills at section ends, builds
//     (snare rolls), drops (crash), breakdowns (drums out), genre hat styles.
//   · MELODIC TECHNIQUE — a recurring HOOK motif (not random notes), developed
//     across choruses; call-and-response phrasing; genre lead styles.
//   · BASS TECHNIQUE — genre idiom (walking / offbeat / 808 / octave-arp / …).
//   · SEED-DRIVEN VARIETY — form, progressions, motif, styles, kit/preset all
//     vary by seed, so re-running gives a different (still coherent) song.
//
//   node scripts/compose.mjs <genreId> [key] [bars] [--seed=N] [--out=path]
//   node scripts/compose.mjs --list
//   e.g.  node scripts/compose.mjs boombap "Eb minor" --seed=4

import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', '_songgen')
const STEP = 0.25 // a 16th in beats
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function loadAppLibs() {
  const tmp = join(mkdtempSync(join(tmpdir(), 'compose-')), 'music.mjs')
  execFileSync('npx', ['esbuild', 'scripts/_music_barrel.ts', '--bundle', '--format=esm', '--platform=node', '--outfile=' + tmp], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
  return import(pathToFileURL(tmp).href)
}

// ── Seeded RNG ────────────────────────────────────────────────────────────────
function makeRand(seed) {
  let s = (seed >>> 0) || 1
  const r = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
  r.pick = (arr) => arr[Math.floor(r() * arr.length)]
  r.chance = (p) => r() < p
  r.int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1))
  return r
}

// ── Music theory ──────────────────────────────────────────────────────────────
const NOTE = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 }
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10], lydian: [0, 2, 4, 6, 7, 9, 11],
}
const ROMAN = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 }

function parseKey(str, fallbackScale) {
  const m = String(str || '').trim().toLowerCase().match(/^([a-g][#b]?)\s*(major|minor|dorian|phrygian|mixolydian|lydian)?$/)
  if (!m) return { root: 9, scale: fallbackScale || 'minor' }
  return { root: NOTE[m[1]] ?? 9, scale: m[2] || fallbackScale || 'minor' }
}
// A diatonic chord (triad or 7th/9th) for a roman numeral in a key/octave.
function chordFor(numeral, root, scale, octave, ext = 0) {
  const steps = SCALES[scale]
  const deg = ROMAN[numeral.toLowerCase()] ?? 0
  const tones = ext >= 9 ? [0, 2, 4, 6, 8] : ext >= 7 ? [0, 2, 4, 6] : [0, 2, 4]
  return tones.map(off => {
    const idx = deg + off
    return root + steps[idx % 7] + (octave + Math.floor(idx / 7)) * 12
  })
}
function rootFor(numeral, root, scale, octave) {
  const deg = ROMAN[numeral.toLowerCase()] ?? 0
  return root + SCALES[scale][deg % 7] + octave * 12
}
// Snap any pitch to the nearest in-key note (keeps passing tones diatonic).
function snapToScale(pitch, root, scale) {
  const pc = ((pitch - root) % 12 + 12) % 12
  const steps = SCALES[scale]
  if (steps.includes(pc)) return pitch
  let best = steps[0], bd = 99
  for (const s of steps) { const d = Math.min((pc - s + 12) % 12, (s - pc + 12) % 12); if (d < bd) { bd = d; best = s } }
  return pitch + (best - pc)
}
const hvel = (rand, base, slot) => {
  let v = base + (rand() * 10 - 5)
  if (slot % 16 === 0) v += 7; else if (slot % 8 === 0) v += 3; else if (slot % 2 === 1) v -= 5
  return Math.max(30, Math.min(122, Math.round(v)))
}
const note = (pitch, startBeat, durationBeats, velocity) => ({ pitch, startBeat: +startBeat.toFixed(4), durationBeats: +Math.max(0.05, durationBeats).toFixed(4), velocity })

// ── Progression bank (roman numerals per scale) ───────────────────────────────
// Split into "grounded" (good for verses, sit on i/I) and "lift" (good for
// choruses, start off the tonic for a rise). Bridges pull a contrasting one.
const PROGS = {
  minor: {
    ground: [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'i', 'v'], ['i', 'VII', 'VI', 'VII'], ['i', 'i', 'iv', 'v']],
    lift: [['VI', 'VII', 'i', 'i'], ['iv', 'VII', 'III', 'VI'], ['VI', 'III', 'VII', 'i'], ['iv', 'v', 'VI', 'VII']],
  },
  major: {
    ground: [['I', 'V', 'vi', 'IV'], ['I', 'IV', 'I', 'V'], ['I', 'vi', 'ii', 'V'], ['I', 'iii', 'IV', 'V']],
    lift: [['vi', 'IV', 'I', 'V'], ['IV', 'V', 'iii', 'vi'], ['IV', 'I', 'V', 'vi'], ['ii', 'V', 'I', 'vi']],
  },
  dorian: { ground: [['i', 'IV', 'i', 'IV'], ['i', 'ii', 'IV', 'i']], lift: [['IV', 'i', 'ii', 'IV'], ['VII', 'IV', 'i', 'i']] },
  phrygian: { ground: [['i', 'II', 'i', 'VII'], ['i', 'VII', 'II', 'i']], lift: [['II', 'i', 'VII', 'i'], ['VII', 'II', 'i', 'i']] },
  mixolydian: { ground: [['I', 'VII', 'IV', 'I'], ['I', 'v', 'IV', 'I']], lift: [['IV', 'I', 'VII', 'I'], ['VII', 'IV', 'I', 'I']] },
  lydian: { ground: [['I', 'II', 'I', 'V'], ['I', 'II', 'vi', 'V']], lift: [['II', 'I', 'V', 'I'], ['V', 'II', 'I', 'I']] },
}

// ── Drum feel → base pattern; variants thin/thicken it per section ─────────────
const FEELS = {
  'four-floor': { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], oh: [2, 6, 10, 14], clap: [4, 12] },
  backbeat: { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
  boombap: { kick: [0, 6, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
  trap: { kick: [0, 7, 10], snare: [8], hat: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], oh: [], clap: [8] },
  'half-time': { kick: [0, 11], snare: [8], hat: [0, 4, 8, 12], oh: [], clap: [8] },
  breakbeat: { kick: [0, 3, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7, 15], clap: [] },
  shuffle: { kick: [0, 8], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14], oh: [], clap: [] },
  syncopated: { kick: [0, 3, 6, 10], snare: [4, 12], hat: [2, 6, 10, 14], oh: [7], clap: [] },
  dembow: { kick: [0, 6, 8, 14], snare: [4, 12], hat: [2, 6, 10, 14], oh: [], clap: [4, 12] },
  none: { kick: [], snare: [], hat: [], oh: [], clap: [] },
}

// ── Palette: per genre — kit, preset ids, and the STYLES that drive technique ──
const DEF = { keys: 'builtin-2', bass: 'builtin-4', pad: 'builtin-30', lead: 'builtin-3', kit: 'studio', ext: 7, bassStyle: 'root8', leadStyle: 'melody', keyRhythm: 'stab' }
const PAL = {
  lofi: { keys: 'builtin-2', bass: 'builtin-19', pad: 'builtin-30', lead: 'builtin-36', kit: 'lofi', ext: 9, bassStyle: 'walk', leadStyle: 'melody', keyRhythm: 'lofi' },
  boombap: { keys: 'builtin-2', bass: 'builtin-19', pad: 'builtin-28', lead: 'builtin-36', kit: 'boombap', ext: 9, bassStyle: 'walk', leadStyle: 'melody', keyRhythm: 'stab' },
  'deep-house': { keys: 'builtin-27', bass: 'builtin-4', pad: 'builtin-30', lead: 'builtin-3', kit: 'house', ext: 9, bassStyle: 'offbeat', leadStyle: 'stab', keyRhythm: 'offstab' },
  house: { keys: 'builtin-1', bass: 'builtin-4', pad: 'builtin-12', lead: 'builtin-3', kit: 'house', ext: 7, bassStyle: 'offbeat', leadStyle: 'stab', keyRhythm: 'offstab' },
  techno: { keys: 'builtin-7', bass: 'builtin-4', pad: 'builtin-13', lead: 'builtin-8', kit: 'techno', ext: 0, bassStyle: 'root8', leadStyle: 'arp', keyRhythm: 'sustain' },
  trance: { keys: 'builtin-12', bass: 'builtin-4', pad: 'builtin-9', lead: 'builtin-3', kit: 'house', ext: 7, bassStyle: 'octarp', leadStyle: 'arp', keyRhythm: 'sustain' },
  synthwave: { keys: 'builtin-1', bass: 'builtin-4', pad: 'builtin-12', lead: 'builtin-3', kit: 'pop', ext: 7, bassStyle: 'octarp', leadStyle: 'riff', keyRhythm: 'sustain' },
  'future-bass': { keys: 'builtin-12', bass: 'builtin-4', pad: 'builtin-29', lead: 'builtin-3', kit: 'trap808', ext: 9, bassStyle: '808', leadStyle: 'stab', keyRhythm: 'stab' },
  dnb: { keys: 'builtin-7', bass: 'builtin-4', pad: 'builtin-13', lead: 'builtin-8', kit: 'break', ext: 7, bassStyle: '808', leadStyle: 'arp', keyRhythm: 'sustain' },
  dubstep: { keys: 'builtin-7', bass: 'builtin-4', pad: 'builtin-13', lead: 'builtin-8', kit: 'traphard', ext: 0, bassStyle: '808', leadStyle: 'riff', keyRhythm: 'sustain' },
  trap: { keys: 'builtin-2', bass: 'builtin-4', pad: 'builtin-13', lead: 'builtin-8', kit: 'trap808', ext: 0, bassStyle: '808', leadStyle: 'riff', keyRhythm: 'sustain' },
  ambient: { keys: 'builtin-30', bass: 'builtin-13', pad: 'builtin-29', lead: 'builtin-43', kit: 'none', ext: 9, bassStyle: 'pedal', leadStyle: 'sustained', keyRhythm: 'sustain' },
  rnb: { keys: 'builtin-2', bass: 'builtin-18', pad: 'builtin-30', lead: 'builtin-36', kit: 'pop', ext: 9, bassStyle: 'walk', leadStyle: 'melody', keyRhythm: 'lofi' },
  funk: { keys: 'builtin-1', bass: 'builtin-18', pad: 'builtin-5', lead: 'builtin-15', kit: 'funk', ext: 9, bassStyle: 'walk', leadStyle: 'riff', keyRhythm: 'offstab' },
  disco: { keys: 'builtin-1', bass: 'builtin-18', pad: 'builtin-9', lead: 'builtin-15', kit: 'disco', ext: 7, bassStyle: 'octarp', leadStyle: 'riff', keyRhythm: 'offstab' },
  pop: { keys: 'builtin-26', bass: 'builtin-18', pad: 'builtin-28', lead: 'builtin-40', kit: 'pop', ext: 7, bassStyle: 'rootfifth', leadStyle: 'melody', keyRhythm: 'stab' },
  rock: { keys: 'builtin-26', bass: 'builtin-18', pad: 'builtin-28', lead: 'builtin-15', kit: 'rock', ext: 0, bassStyle: 'rootfifth', leadStyle: 'riff', keyRhythm: 'sustain' },
  'bossa-nova': { keys: 'builtin-2', bass: 'builtin-19', pad: 'builtin-16', lead: 'builtin-24', kit: 'studio', ext: 9, bassStyle: 'bossa', leadStyle: 'melody', keyRhythm: 'offstab' },
  afrobeat: { keys: 'builtin-1', bass: 'builtin-18', pad: 'builtin-5', lead: 'builtin-21', kit: 'disco', ext: 9, bassStyle: 'walk', leadStyle: 'riff', keyRhythm: 'offstab' },
  reggaeton: { keys: 'builtin-1', bass: 'builtin-4', pad: 'builtin-12', lead: 'builtin-3', kit: 'pop', ext: 7, bassStyle: '808', leadStyle: 'stab', keyRhythm: 'offstab' },
}
// Alternate lead sounds per lead-style, so the seed can vary the timbre too.
const LEAD_ALTS = {
  melody: ['builtin-36', 'builtin-40', 'builtin-24', 'builtin-2', 'builtin-38'],
  arp: ['builtin-3', 'builtin-8', 'builtin-12', 'builtin-39'],
  riff: ['builtin-15', 'builtin-3', 'builtin-21', 'builtin-34'],
  stab: ['builtin-3', 'builtin-1', 'builtin-8'],
  sustained: ['builtin-43', 'builtin-24', 'builtin-30', 'builtin-6'],
}

// ── Per-track sound shaping (rollFx) ──────────────────────────────────────────
const RF = {
  bass: { reverbWet: 0.05, filterHz: 2600, gain: 1.4 },
  keys: (ext) => ({ reverbWet: 0.2, reverbSize: 0.6, sustain: 0.5, gain: 1.4, ...(ext >= 9 ? { filterHz: 6500 } : {}) }),
  pad: { reverbWet: 0.5, reverbSize: 0.85, attack: 0.5, gain: 1.6, filterHz: 5200 },
  lead: { reverbWet: 0.3, reverbSize: 0.7, sustain: 0.35, gain: 1.7, vibratoDepth: 0.1 },
}

// ── Song forms — sequences of sections (role, bars, which progression) ─────────
// prog: 'A'=verse, 'B'=chorus, 'C'=bridge. flags drive drums + layers.
const FORMS = {
  edm: [
    { role: 'intro', bars: 8, prog: 'A', energy: 0.3 },
    { role: 'build', bars: 8, prog: 'A', energy: 0.6, build: true },
    { role: 'drop', bars: 8, prog: 'B', energy: 1.0, drop: true },
    { role: 'break', bars: 8, prog: 'C', energy: 0.4, breakdown: true },
    { role: 'build', bars: 8, prog: 'A', energy: 0.7, build: true },
    { role: 'drop', bars: 8, prog: 'B', energy: 1.0, drop: true },
    { role: 'outro', bars: 8, prog: 'A', energy: 0.35 },
  ],
  song: [
    { role: 'intro', bars: 4, prog: 'A', energy: 0.35 },
    { role: 'verse', bars: 8, prog: 'A', energy: 0.55 },
    { role: 'chorus', bars: 8, prog: 'B', energy: 0.95, fill: true },
    { role: 'verse', bars: 8, prog: 'A', energy: 0.6 },
    { role: 'chorus', bars: 8, prog: 'B', energy: 1.0, fill: true },
    { role: 'bridge', bars: 8, prog: 'C', energy: 0.65, breakdown: true },
    { role: 'chorus', bars: 8, prog: 'B', energy: 1.0, fill: true },
    { role: 'outro', bars: 4, prog: 'A', energy: 0.4 },
  ],
  loop: [
    { role: 'intro', bars: 4, prog: 'A', energy: 0.4 },
    { role: 'verse', bars: 8, prog: 'A', energy: 0.7 },
    { role: 'hook', bars: 8, prog: 'B', energy: 0.95, fill: true },
    { role: 'verse', bars: 8, prog: 'A', energy: 0.75, fill: true },
    { role: 'hook', bars: 8, prog: 'B', energy: 1.0, fill: true },
    { role: 'bridge', bars: 4, prog: 'C', energy: 0.55, breakdown: true },
    { role: 'hook', bars: 8, prog: 'B', energy: 1.0, fill: true },
    { role: 'outro', bars: 4, prog: 'A', energy: 0.4 },
  ],
}
const FORM_FAMILY = {
  house: 'edm', 'deep-house': 'edm', techno: 'edm', trance: 'edm', dnb: 'edm', dubstep: 'edm', 'future-bass': 'edm', ambient: 'edm',
  trap: 'loop', boombap: 'loop', lofi: 'loop', rnb: 'loop', reggaeton: 'loop',
  pop: 'song', rock: 'song', funk: 'song', disco: 'song', synthwave: 'song', 'bossa-nova': 'song', afrobeat: 'song',
}

// Which layers play in a section, from its role + energy.
function layersFor(sec) {
  const e = sec.energy
  const drums = e >= 0.45 && !sec.breakdown
  const bass = e >= 0.3
  const keys = e >= 0.45
  const pad = true
  const lead = /chorus|hook|drop/.test(sec.role) && e >= 0.85
  const arp = sec.build || (/chorus|drop/.test(sec.role) && e >= 0.9)
  return { drums, bass, keys, pad, lead, arp, softDrums: sec.breakdown }
}

// ── Drums: per-section pattern with variant + fills + builds + drops ──────────
function fillDrums(clip, rand, bar0, bars, feel, sec) {
  const e = sec.energy
  const lanes = [['kick', 36, 0.5, 102], ['snare', 38, 0.4, 92], ['hat', 42, 0.16, 58], ['oh', 46, 0.3, 62], ['clap', 39, 0.35, 86]]
  for (let b = 0; b < bars; b++) {
    const lastBar = b === bars - 1
    for (const [lane, pitch, dur, vel] of lanes) {
      let hits = feel[lane] ?? []
      // Intensity: thin hats/oh/clap when quiet; drop the clap unless energetic.
      if ((lane === 'hat') && e < 0.7) hits = hits.filter((_, i) => i % 2 === 0)
      if ((lane === 'oh' || lane === 'clap') && e < 0.8) hits = []
      // Breakdown = kick only (soft), or nothing.
      if (sec.breakdown && lane !== 'kick') hits = []
      if (sec.breakdown && lane === 'kick') hits = hits.filter((_, i) => i === 0)
      for (const i of hits) {
        let v = vel + (pitch === 42 && i % 4 === 0 ? 8 : 0) - (pitch === 42 && i % 2 === 1 ? 10 : 0)
        clip.notes.push(note(pitch, (bar0 + b) * 4 + i * STEP, dur, hvel(rand, v * (sec.breakdown ? 0.7 : 1), i)))
      }
    }
    // Build: a snare roll ramping up over the last 1–2 bars.
    if (sec.build && b >= bars - 2) {
      const from = (bars - 1 - b) === 1 ? 8 : 0, rate = (bars - 1 - b) === 1 ? 2 : 1
      for (let i = from; i < 16; i += rate) clip.notes.push(note(38, (bar0 + b) * 4 + i * STEP, 0.2, Math.min(120, 55 + i * 4)))
    }
    // Drop: a crash on the downbeat of the section.
    if (sec.drop && b === 0) clip.notes.push(note(49, bar0 * 4, 1.5, 110))
    // Fill: a tom/snare fill on the last bar of a section.
    if (sec.fill && lastBar && !sec.build) {
      const toms = [45, 47, 48]
      for (let i = 8; i < 16; i += 2) clip.notes.push(note(rand.pick(toms), (bar0 + b) * 4 + i * STEP, 0.24, hvel(rand, 86, i)))
    }
  }
}

// ── Bass: genre-idiom lines (all chord tones / diatonic) ─────────────────────
function fillBass(clip, rand, bar0, chordRoots, style, base, root, scale) {
  const oct = (p, o) => p + o * 12
  chordRoots.forEach((r, b) => {
    const bt = (bar0 + b) * 4
    // Every bass note snapped to the key — keeps walking approaches / fifths in-key.
    const put = (slot, dur, pitch, v = base) => clip.notes.push(note(snapToScale(pitch, root, scale), bt + slot * STEP, dur * STEP, hvel(rand, v, slot)))
    switch (style) {
      case 'offbeat': for (const s of [2, 6, 10, 14]) put(s, 1.8, r); break
      case 'root8': for (const s of [0, 2, 4, 6, 8, 10, 12, 14]) put(s, 1.6, r, base - (s % 4 ? 6 : 0)); break
      case 'octarp': { const seq = [r, r, oct(r, 1), r]; [0, 4, 8, 12].forEach((s, i) => put(s, 3.6, seq[i % seq.length])); break }
      case '808': put(0, 14, r); if (rand.chance(0.5)) put(10, 6, oct(r, rand.chance(0.5) ? 0 : -0)); break
      case 'pedal': put(0, 16, r); break
      case 'bossa': put(0, 2, r); put(3, 2, r + 7); put(8, 2, r); put(11, 2, r + 7); break
      case 'rootfifth': put(0, 4, r); put(4, 4, r + 7); put(8, 4, r); put(12, 4, r + 7); break
      case 'walk': default: {
        // Walk toward the NEXT chord's root: root, 3rd-ish, 5th, approach.
        const next = chordRoots[(b + 1) % chordRoots.length]
        const approach = next - 1 // chromatic-ish approach, snapped below to scale by caller if needed
        const seq = [r, r + 3, r + 7, approach]
        ;[0, 4, 8, 12].forEach((s, i) => put(s, 3.6, seq[i]))
        break
      }
    }
  })
}

// ── Chords (keys + pad) with section-appropriate rhythm/voicing ──────────────
const KEY_RHYTHMS = {
  stab: 'oxxxxxxxoxxxxxxx', offstab: 'xxoxxxoxxxoxxxox', lofi: 'oxxxxxxxxxxxoxxx', sustain: 'oxxxxxxxxxxxxxxx',
}
function fillChords(clip, rand, bar0, chords, patStr, base, ring, spread) {
  const on = [...patStr].map((c, i) => (c === 'o' ? i : -1)).filter(i => i >= 0)
  chords.forEach((chord, b) => {
    for (let k = 0; k < on.length; k++) {
      const i = on[k]
      const nxt = k + 1 < on.length ? on[k + 1] : 16
      const len = (ring ?? (nxt - i)) * STEP
      const voiced = spread ? [chord[0] - 12, ...chord.slice(1)] : chord
      for (const p of voiced) clip.notes.push(note(p, (bar0 + b) * 4 + i * STEP, len * 0.97, hvel(rand, base, i)))
    }
  })
}

// ── Lead: a recurring HOOK motif, developed across choruses ──────────────────
// motif = list of {slot, tone, len}; `tone` indexes into the chord's tones (with
// octave-up wraps) so it's always consonant, plus rests. Made once per song.
function makeMotif(rand) {
  const RHYTHMS = [
    [[0, 3], [4, 2], [7, 3], [12, 4]],
    [[0, 2], [2, 2], [6, 4], [10, 3], [13, 3]],
    [[0, 6], [8, 2], [11, 2], [14, 2]],
    [[2, 2], [4, 2], [8, 4], [12, 3]],
  ]
  const rhythm = rand.pick(RHYTHMS)
  const tones = rhythm.map((_, i) => rand.int(0, 4)) // chord-tone index (0..4, wraps octave)
  return rhythm.map(([slot, len], i) => ({ slot, len, tone: tones[i] }))
}
function chordToneAt(chord, idx) {
  const n = chord.length
  const oct = Math.floor(idx / n)
  return chord[((idx % n) + n) % n] + oct * 12 + 12 // an octave up = lead register
}
function fillLead(clip, rand, bar0, chords, motif, base, style, root, scale) {
  chords.forEach((chord, b) => {
    const bt = (bar0 + b) * 4
    if (style === 'arp') {
      // Fast up-arpeggio through chord tones over the bar.
      const seq = [...chord, chord[1] + 12, chord[2] + 12]
      for (let i = 0; i < 16; i += 2) clip.notes.push(note(seq[(i / 2) % seq.length] + 12, bt + i * STEP, 0.22, hvel(rand, base - 6, i)))
      return
    }
    if (style === 'sustained') {
      clip.notes.push(note(chordToneAt(chord, 2), bt, 4 * 0.98, hvel(rand, base - 10, 0)))
      return
    }
    // melody / riff / stab: play the recurring motif on this chord's tones, with
    // a call-and-response — even bars open (leave last note high), odd bars resolve.
    const resolve = b % 2 === 1
    for (let m = 0; m < motif.length; m++) {
      if (rand.chance(0.12)) continue // breathe
      const cell = motif[m]
      let idx = cell.tone
      if (m === motif.length - 1) idx = resolve ? 0 : 2 // land on root (answer) or 5th (question)
      let pitch = chordToneAt(chord, idx)
      // riff jumps octaves for bite; stab stays put and short.
      if (style === 'riff' && rand.chance(0.3)) pitch += 12
      const len = (style === 'stab' ? 1 : cell.len) * STEP
      clip.notes.push(note(pitch, bt + cell.slot * STEP, len * 0.9, hvel(rand, base, cell.slot)))
    }
  })
}

// ── Compose ───────────────────────────────────────────────────────────────────
function compose({ GENRES, DRUM_KITS }, genreId, keyStr, seed) {
  const genre = GENRES.find(g => g.id === genreId)
  if (!genre) throw new Error(`unknown genre "${genreId}" — try --list`)
  const rand = makeRand(seed)
  const pal = { ...DEF, ...(PAL[genreId] || {}) }
  const kit = DRUM_KITS.find(k => k.id === pal.kit) || DRUM_KITS[0]
  const feel = FEELS[genre.drums] || FEELS.backbeat
  const { root, scale } = parseKey(keyStr, genre.scale)
  const bank = PROGS[scale] || PROGS.minor

  // Distinct progressions for verse (A, grounded), chorus (B, lift), bridge (C).
  const progA = rand.pick(bank.ground)
  let progB = rand.pick(bank.lift); if (progB.join() === progA.join()) progB = rand.pick(bank.lift)
  const progC = rand.pick([...bank.ground, ...bank.lift].filter(p => p.join() !== progA.join() && p.join() !== progB.join())) || rand.pick(bank.ground)
  const progs = { A: progA, B: progB, C: progC }

  const form = FORMS[FORM_FAMILY[genreId] || 'loop']
  const motif = makeMotif(rand)
  const leadPreset = rand.pick(LEAD_ALTS[pal.leadStyle] || [pal.lead])
  const keyRhythm = KEY_RHYTHMS[pal.keyRhythm] || KEY_RHYTHMS.stab

  // Tracks (one clip per track spanning the whole song).
  let n = 0; const uid = p => `${p}${(n++).toString(36)}`
  const tracks = [], clips = []
  const mk = (name, instr, presetId, rollFx, pan, vol) => {
    const tid = uid('t'); tracks.push({ id: tid, name, instrument: instr, volume: vol, pan })
    const clip = { id: uid('c'), trackId: tid, presetId, rollFx, startBeat: 0, durationBeats: 0, notes: [], isDrumClip: instr.type === 'drum' }
    clips.push(clip); return clip
  }
  const cDr = mk('Drums', kit.instrument, null, null, 0, 0.6)
  const cBs = mk('Bass', { type: 'none', params: {} }, pal.bass, RF.bass, 0, 0.58)
  const cKy = mk('Keys', { type: 'none', params: {} }, pal.keys, RF.keys(pal.ext), -0.12, 0.46)
  const cPd = mk('Pad', { type: 'none', params: {} }, pal.pad, RF.pad, 0.14, 0.34)
  const cLd = mk('Lead', { type: 'none', params: {} }, leadPreset, RF.lead, 0.08, 0.5)

  let bar = 0
  for (const sec of form) {
    const prog = progs[sec.prog]
    const L = layersFor(sec)
    // chords for this section (repeat the 4-chord prog to fill the section)
    const reps = Math.ceil(sec.bars / prog.length)
    const seq = Array.from({ length: sec.bars }, (_, i) => prog[i % prog.length])
    const chords = seq.map(nu => chordFor(nu, root, scale, 4, pal.ext))
    const padCh = seq.map(nu => chordFor(nu, root, scale, 4, sec.energy > 0.8 ? pal.ext : 0))
    const roots = seq.map(nu => snapToScale(rootFor(nu, root, scale, 2), root, scale))

    if (L.drums && genre.drums !== 'none') fillDrums(cDr, rand, bar, sec.bars, feel, sec)
    else if (L.softDrums && genre.drums !== 'none') fillDrums(cDr, rand, bar, sec.bars, feel, { ...sec, breakdown: true })
    if (L.bass) fillBass(cBs, rand, bar, roots, pal.bassStyle, 78, root, scale)
    if (L.keys) fillChords(cKy, rand, bar, chords, keyRhythm, sec.energy > 0.8 ? 68 : 58, null, false)
    if (L.pad) fillChords(cPd, rand, bar, padCh, KEY_RHYTHMS.sustain, sec.energy > 0.5 ? 48 : 40, 16, true)
    if (L.lead) fillLead(cLd, rand, bar, chords, motif, 66, pal.leadStyle, root, scale)
    else if (L.arp) fillLead(cLd, rand, bar, chords, motif, 56, 'arp', root, scale)
    bar += sec.bars
  }
  const dur = bar * 4
  for (const c of clips) c.durationBeats = dur

  return {
    name: `${genre.name} — ${keyStr || (KEY_NAMES[root] + ' ' + scale)}`,
    genre: genre.id, tempo: genre.bpm, timeSignatureNum: 4, timeSignatureDen: 4,
    swing: genre.swing, key: root, scale,
    masterVolume: 0.55, tracks, clips,
    _form: form.map(s => s.role).join(' · '),
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2)
  const libs = await loadAppLibs()
  if (argv.includes('--list') || argv.length === 0) {
    console.log('Genres (id · bpm · feel):')
    for (const g of libs.GENRES) console.log(`  ${g.id.padEnd(13)} ${String(g.bpm).padStart(3)} bpm · ${g.drums}`)
    console.log('\nUsage: node scripts/compose.mjs <genreId> [key] [--seed=N] [--out=path]')
    return
  }
  const pos = argv.filter(a => !a.startsWith('--'))
  const seedArg = argv.find(a => a.startsWith('--seed='))
  const outArg = argv.find(a => a.startsWith('--out='))
  const seed = seedArg ? parseInt(seedArg.split('=')[1], 10) : 12345
  const spec = compose(libs, pos[0], pos[1] || '', seed)
  const nNotes = spec.clips.reduce((a, c) => a + c.notes.length, 0)
  const end = Math.max(...spec.clips.flatMap(c => c.notes.map(nn => nn.startBeat + nn.durationBeats)), 0)
  const slug = `${spec.genre}-${(pos[1] || spec.scale).replace(/\s+/g, '')}`.toLowerCase()
  const out = outArg ? outArg.split('=')[1] : join(OUT_DIR, `${slug}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(spec))
  console.log(`${spec.name}`)
  console.log(`  ${spec.tempo} bpm · swing ${spec.swing} · form: ${spec._form}`)
  console.log(`  ${spec.tracks.length} tracks · ${nNotes} notes · ${(end / spec.tempo * 60).toFixed(0)}s → ${out}`)
}
main().catch(e => { console.error(e.message || e); process.exit(1) })
