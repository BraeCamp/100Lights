#!/usr/bin/env node
// ── The composer ─────────────────────────────────────────────────────────────
// A genre-driven song generator that DRIVES FROM THE APP'S OWN LIBRARIES
// (lib/genres.ts, lib/drum-presets.ts) instead of hand-coding each song. Pick a
// genre + key and it assembles drums (a real kit + a feel pattern, tagged
// isDrumClip), bass (chord tones), chord keys/pad, and a lead across arrangement
// sections, with breathing-rhythm patterns and humanised velocities — then emits
// a BUILD-SPEC (the format the __dawDispatch build → render → analyze loop uses;
// see MUSIC.md §0).
//
//   node scripts/compose.mjs <genreId> [key] [bars] [--seed N] [--out path]
//   node scripts/compose.mjs --list                # list available genres
//   e.g.  node scripts/compose.mjs lofi "F minor" 48
//
// Output: public/_songgen/<genre>-<key>.json  (a build-spec: meta + tracks + clips + notes)

import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'public', '_songgen')

// ── Load the app's music libraries (bundle the barrel, then import) ───────────
function loadAppLibs() {
  const tmp = join(mkdtempSync(join(tmpdir(), 'compose-')), 'music.mjs')
  execFileSync('npx', ['esbuild', 'scripts/_music_barrel.ts', '--bundle', '--format=esm', '--platform=node', '--outfile=' + tmp], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
  return import(pathToFileURL(tmp).href)
}

// ── Deterministic RNG (seeded, so a song is reproducible) ─────────────────────
function rng(seed) {
  let s = (seed >>> 0) || 1
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
}

// ── Music theory ──────────────────────────────────────────────────────────────
const NOTE = { c: 0, 'c#': 1, db: 1, d: 2, 'd#': 3, eb: 3, e: 4, f: 5, 'f#': 6, gb: 6, g: 7, 'g#': 8, ab: 8, a: 9, 'a#': 10, bb: 10, b: 11 }
// Scale steps (semitones from the tonic).
const SCALES = {
  major:      [0, 2, 4, 5, 7, 9, 11],
  minor:      [0, 2, 3, 5, 7, 8, 10],
  dorian:     [0, 2, 3, 5, 7, 9, 10],
  phrygian:   [0, 1, 3, 5, 7, 8, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian:     [0, 2, 4, 6, 7, 9, 11],
}
// Roman numeral → scale-degree index (0-based) + chord quality is derived from the scale.
const ROMAN = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 }

/** Parse "F minor" / "A" / "Bb dorian" → { root: pitchClass, scale }. */
function parseKey(str, fallbackScale) {
  const m = String(str || '').trim().toLowerCase().match(/^([a-g][#b]?)\s*(major|minor|dorian|phrygian|mixolydian|lydian)?$/)
  if (!m) return { root: 9, scale: fallbackScale || 'minor' } // default A
  return { root: NOTE[m[1]] ?? 9, scale: m[2] || fallbackScale || 'minor' }
}

/** A diatonic triad (or 7th) for a roman numeral, voiced around a target octave. */
function chordFor(numeral, root, scale, octave, seventh) {
  const steps = SCALES[scale]
  const deg = ROMAN[numeral.toLowerCase()] ?? 0
  const notes = [0, 2, 4].map(off => {
    const idx = deg + off
    const oct = octave + Math.floor(idx / 7)
    return root + steps[idx % 7] + oct * 12
  })
  if (seventh) {
    const idx = deg + 6
    notes.push(root + steps[idx % 7] + (octave + Math.floor(idx / 7)) * 12)
  }
  return notes
}
/** The scale-degree ROOT pitch for a numeral (for the bassline), in a low octave. */
function rootFor(numeral, root, scale, octave) {
  const deg = ROMAN[numeral.toLowerCase()] ?? 0
  return root + SCALES[scale][deg % 7] + octave * 12
}

// ── Progression bank (roman numerals per scale/mood, transposable) ────────────
const PROGRESSIONS = {
  minor:      [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'v', 'i'], ['i', 'VII', 'VI', 'VII'], ['i', 'v', 'VI', 'iv'], ['i', 'III', 'VII', 'VI']],
  major:      [['I', 'V', 'vi', 'IV'], ['I', 'vi', 'IV', 'V'], ['vi', 'IV', 'I', 'V'], ['I', 'IV', 'V', 'IV']],
  dorian:     [['i', 'IV', 'i', 'IV'], ['i', 'ii', 'IV', 'i'], ['i', 'VII', 'IV', 'i']],
  phrygian:   [['i', 'II', 'i', 'VII'], ['i', 'II', 'VII', 'i']],
  mixolydian: [['I', 'VII', 'IV', 'I'], ['I', 'v', 'IV', 'I']],
  lydian:     [['I', 'II', 'I', 'V'], ['I', 'II', 'vi', 'V']],
}

// ── Feel → 16-step drum pattern (kick/snare/hat/openhat/clap step indices) ────
const FEELS = {
  'four-floor': { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], oh: [2, 6, 10, 14], clap: [] },
  'backbeat':   { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
  'boombap':    { kick: [0, 6, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
  'trap':       { kick: [0, 7, 10], snare: [8], hat: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], oh: [], clap: [8] },
  'half-time':  { kick: [0, 11], snare: [8], hat: [0, 4, 8, 12], oh: [], clap: [] },
  'breakbeat':  { kick: [0, 3, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
  'shuffle':    { kick: [0, 8], snare: [4, 12], hat: [0, 3, 4, 7, 8, 11, 12, 15], oh: [], clap: [] },
  'syncopated': { kick: [0, 3, 6, 10], snare: [4, 12], hat: [2, 6, 10, 14], oh: [], clap: [] },
  'dembow':     { kick: [0, 6, 8, 14], snare: [4, 12], hat: [2, 6, 10, 14], oh: [], clap: [] },
  'none':       { kick: [], snare: [], hat: [], oh: [], clap: [] },
}

// ── Palette (genre → preset ids + which layers + sound tweaks) ────────────────
// Preset ids are the seeded builtin-N (see midi-presets.ts). Fallback derives a
// palette from the genre's mood so unmapped genres still compose.
const DEFAULT_PALETTE = { keys: 'builtin-2', bass: 'builtin-4', pad: 'builtin-30', lead: 'builtin-3', kit: 'studio', seventh: false }
const PALETTE = {
  lofi:         { keys: 'builtin-2',  bass: 'builtin-19', pad: 'builtin-30', lead: 'builtin-36', kit: 'lofi',     seventh: true },
  boombap:      { keys: 'builtin-2',  bass: 'builtin-19', pad: 'builtin-28', lead: 'builtin-36', kit: 'boombap',  seventh: true },
  'deep-house': { keys: 'builtin-27', bass: 'builtin-4',  pad: 'builtin-30', lead: 'builtin-3',  kit: 'house',    seventh: true },
  house:        { keys: 'builtin-1',  bass: 'builtin-4',  pad: 'builtin-12', lead: 'builtin-3',  kit: 'house',    seventh: false },
  techno:       { keys: 'builtin-7',  bass: 'builtin-4',  pad: 'builtin-13', lead: 'builtin-8',  kit: 'techno',   seventh: false },
  synthwave:    { keys: 'builtin-1',  bass: 'builtin-4',  pad: 'builtin-12', lead: 'builtin-3',  kit: 'pop',      seventh: false },
  ambient:      { keys: 'builtin-30', bass: 'builtin-13', pad: 'builtin-29', lead: 'builtin-43', kit: 'none',     seventh: true },
  rnb:          { keys: 'builtin-2',  bass: 'builtin-18', pad: 'builtin-30', lead: 'builtin-36', kit: 'pop',      seventh: true },
  funk:         { keys: 'builtin-1',  bass: 'builtin-18', pad: 'builtin-5',  lead: 'builtin-15', kit: 'disco',    seventh: true },
  disco:        { keys: 'builtin-1',  bass: 'builtin-18', pad: 'builtin-9',  lead: 'builtin-15', kit: 'disco',    seventh: true },
  pop:          { keys: 'builtin-26', bass: 'builtin-18', pad: 'builtin-28', lead: 'builtin-40', kit: 'pop',      seventh: false },
  rock:         { keys: 'builtin-26', bass: 'builtin-18', pad: 'builtin-28', lead: 'builtin-15', kit: 'rock',     seventh: false },
  trap:         { keys: 'builtin-2',  bass: 'builtin-4',  pad: 'builtin-13', lead: 'builtin-8',  kit: 'trap808',  seventh: false },
  'bossa-nova': { keys: 'builtin-2',  bass: 'builtin-19', pad: 'builtin-16', lead: 'builtin-24', kit: 'studio',   seventh: true },
  afrobeat:     { keys: 'builtin-1',  bass: 'builtin-18', pad: 'builtin-5',  lead: 'builtin-21', kit: 'disco',    seventh: true },
  reggaeton:    { keys: 'builtin-1',  bass: 'builtin-4',  pad: 'builtin-12', lead: 'builtin-3',  kit: 'pop',      seventh: false },
  'future-bass':{ keys: 'builtin-12', bass: 'builtin-4',  pad: 'builtin-29', lead: 'builtin-3',  kit: 'trap808',  seventh: true },
  trance:       { keys: 'builtin-12', bass: 'builtin-4',  pad: 'builtin-9',  lead: 'builtin-3',  kit: 'house',    seventh: false },
  dnb:          { keys: 'builtin-7',  bass: 'builtin-4',  pad: 'builtin-13', lead: 'builtin-8',  kit: 'techno',   seventh: false },
  dubstep:      { keys: 'builtin-7',  bass: 'builtin-4',  pad: 'builtin-13', lead: 'builtin-8',  kit: 'traphard', seventh: false },
}

// ── Per-genre sound shaping on the clip (rollFx) ──────────────────────────────
const ROLLFX = {
  bass: { reverbWet: 0.05, filterHz: 2600, gain: 1.4 },
  keys: (seventh) => ({ reverbWet: 0.2, reverbSize: 0.6, sustain: 0.5, gain: 1.4, ...(seventh ? { filterHz: 6000 } : {}) }),
  pad:  { reverbWet: 0.5, reverbSize: 0.8, attack: 0.5, gain: 1.6, filterHz: 5000 },
  lead: { reverbWet: 0.32, reverbSize: 0.7, sustain: 0.4, gain: 1.7, vibratoDepth: 0.1 },
}

const STEP = 0.25 // a 16th in beats

// ── Composition helpers (ported + improved from gen_rhythm_songs.py) ──────────
function humanize(rand, base, step) {
  let v = base + (rand() * 8 - 4)
  if (step % 16 === 0) v += 6
  else if (step % 8 === 0) v += 3
  else if (step % 2 === 1) v -= 4
  return Math.max(28, Math.min(120, Math.round(v)))
}
const noteOf = (pitch, startBeat, durationBeats, velocity) => ({ pitch, startBeat: +startBeat.toFixed(4), durationBeats: +durationBeats.toFixed(4), velocity })

// A "breathing" onset pattern: a 16-slot string of hits(o)/rests(x) → step indices.
const onsets = (pat) => [...pat].map((c, i) => (c === 'o' ? i : -1)).filter(i => i >= 0)

function fillChords(clip, rand, bar0, chords, patStr, base, ring, seventh, spread) {
  const on = onsets(patStr)
  chords.forEach((chord, b) => {
    for (let k = 0; k < on.length; k++) {
      const i = on[k]
      const nxt = k + 1 < on.length ? on[k + 1] : 16
      const len = (ring ?? (nxt - i)) * STEP
      const pos = (bar0 + b) * 4 + i * STEP
      const voiced = spread ? [chord[0] - 12, ...chord.slice(1)] : chord
      for (const p of voiced) clip.notes.push(noteOf(p, pos, len * 0.98, humanize(rand, base, i)))
    }
  })
}
function fillBass(clip, rand, bar0, roots, patStr, base) {
  const on = onsets(patStr)
  roots.forEach((r, b) => {
    for (let k = 0; k < on.length; k++) {
      const i = on[k]
      const nxt = k + 1 < on.length ? on[k + 1] : 16
      clip.notes.push(noteOf(r, (bar0 + b) * 4 + i * STEP, (nxt - i) * STEP * 0.95, humanize(rand, base, i)))
    }
  })
}
function fillDrums(clip, rand, bar0, bars, feel, kitPitches, density) {
  const lanes = [['kick', 36, 0.5, 100], ['snare', 38, 0.4, 90], ['hat', 42, 0.18, 60], ['oh', 46, 0.3, 62], ['clap', 39, 0.35, 84]]
  for (let b = 0; b < bars; b++) {
    for (const [lane, pitch, dur, vel] of lanes) {
      for (const i of feel[lane] ?? []) {
        // Density thins the hats/oh in sparser sections.
        if ((lane === 'hat' || lane === 'oh') && density < 1 && rand() > density) continue
        let v = vel + (pitch === 42 && i % 4 === 0 ? 8 : 0) - (pitch === 42 && i % 2 === 1 ? 10 : 0)
        clip.notes.push(noteOf(pitch, (bar0 + b) * 4 + i * STEP, dur, humanize(rand, v, i)))
      }
    }
  }
}
function fillLead(clip, rand, bar0, chords, base) {
  // A simple motif on CHORD TONES only (always diatonic — no chromatic slips),
  // an octave up, with rests to breathe and octave variety for shape.
  chords.forEach((chord, b) => {
    const slots = [0, 3, 6, 10, 14]
    for (let s = 0; s < slots.length; s++) {
      if (rand() < 0.35) continue // breathe
      const i = slots[s]
      const oct = rand() < 0.2 ? 24 : 12                     // occasional higher octave
      const pitch = chord[Math.floor(rand() * chord.length)] + oct
      const nxt = slots[s + 1] ?? 16
      clip.notes.push(noteOf(pitch, (bar0 + b) * 4 + i * STEP, (nxt - i) * STEP * 0.9, humanize(rand, base, i)))
    }
  })
}

// ── The composer ──────────────────────────────────────────────────────────────
function compose({ GENRES, DRUM_KITS }, genreId, keyStr, bars, seed) {
  const genre = GENRES.find(g => g.id === genreId)
  if (!genre) throw new Error(`unknown genre "${genreId}" — try --list`)
  const pal = PALETTE[genreId] || DEFAULT_PALETTE
  const kit = DRUM_KITS.find(k => k.id === pal.kit) || DRUM_KITS[0]
  const feel = FEELS[genre.drums] || FEELS['backbeat']
  const rand = rng(seed)
  const { root, scale } = parseKey(keyStr, genre.scale)
  const progs = PROGRESSIONS[scale] || PROGRESSIONS.minor
  const prog = progs[Math.floor(rand() * progs.length)]
  const chords = prog.map(n => chordFor(n, root, scale, 4, pal.seventh))     // keys register
  const padChords = prog.map(n => chordFor(n, root, scale, 4, pal.seventh))
  const roots = prog.map(n => rootFor(n, root, scale, 2))                     // bass register

  // ── Arrangement: 4-bar sections, layers fade in then out ──────────────────
  const SECBARS = 4
  const nSec = Math.max(4, Math.round(bars / SECBARS))
  // layer activity per section (drums, bass, keys, pad, lead) + drum density
  const plan = []
  for (let s = 0; s < nSec; s++) {
    const t = s / (nSec - 1)                    // 0..1 through the song
    plan.push({
      drums: genre.drums !== 'none' && s > 0,
      bass: s > 0,
      keys: s >= 1 && s < nSec - 1,
      pad: true,
      lead: s >= 2 && s <= nSec - 2,
      density: s === 0 ? 0.4 : s >= nSec - 1 ? 0.5 : Math.min(1, 0.6 + t * 0.6),
    })
  }

  // ── Tracks + clips (one clip per track spanning the whole song) ───────────
  const totalBars = nSec * SECBARS
  const dur = totalBars * 4
  const tracks = []
  const clips = []
  let n = 0
  const uid = (p) => `${p}${(n++).toString(36)}`
  const mel = (id, name, instrument, presetId, rollFx, pan, vol) => {
    const tid = uid('t')
    tracks.push({ id: tid, name, instrument, volume: vol, pan })
    const clip = { id: uid('c'), trackId: tid, presetId, rollFx, startBeat: 0, durationBeats: dur, notes: [], isDrumClip: instrument.type === 'drum' }
    clips.push(clip)
    return clip
  }
  // Gain-staged for headroom: five full-range layers sum hot, so each sits lower
  // and the master (0.55) leaves room. Kept the balance (drums/bass forward,
  // pad back). Verified: peak stays under 0 dBFS on a busy section.
  const cDr = mel('dr', 'Drums', kit.instrument, null, null, 0, 0.6)
  const cBs = mel('bs', 'Bass', { type: 'none', params: {} }, pal.bass, ROLLFX.bass, 0, 0.58)
  const cKy = mel('ky', 'Keys', { type: 'none', params: {} }, pal.keys, ROLLFX.keys(pal.seventh), -0.12, 0.46)
  const cPd = mel('pd', 'Pad', { type: 'none', params: {} }, pal.pad, ROLLFX.pad, 0.14, 0.36)
  const cLd = mel('ld', 'Lead', { type: 'none', params: {} }, pal.lead, ROLLFX.lead, 0.08, 0.48)

  // Bass & keys breathing patterns (feel-aware).
  const bassPat = genre.drums === 'four-floor' ? 'oxxxoxxxoxxxoxxx' : 'oxxxxxxoxxxoxxxx'
  const keysPat = 'oxxxxxxxoxxxxxxx'

  for (let s = 0; s < nSec; s++) {
    const bar0 = s * SECBARS
    const p = plan[s]
    // repeat the 4-chord progression once per 4-bar section
    if (p.drums) fillDrums(cDr, rand, bar0, SECBARS, feel, kit, p.density)
    if (p.bass)  fillBass(cBs, rand, bar0, roots, bassPat, 76)
    if (p.keys)  fillChords(cKy, rand, bar0, chords, keysPat, 66, null, pal.seventh, false)
    if (p.pad)   fillChords(cPd, rand, bar0, padChords, 'oxxxxxxxxxxxxxxx', 46, 16, pal.seventh, true)
    if (p.lead)  fillLead(cLd, rand, bar0, chords, 62)
  }

  return {
    name: `${genre.name} — ${keyStr || (['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][root] + ' ' + scale)}`,
    genre: genre.id,
    tempo: genre.bpm,
    timeSignatureNum: 4, timeSignatureDen: 4,
    swing: genre.swing,
    key: root, scale,
    // Headroom: five full-range layers sum hot, so the master sits low to keep
    // peaks under 0 dBFS. (Absolute level doesn't matter; not clipping does.)
    masterVolume: 0.55,
    tracks, clips,
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2)
  const libs = await loadAppLibs()
  if (argv.includes('--list') || argv.length === 0) {
    console.log('Genres (id · bpm · feel):')
    for (const g of libs.GENRES) console.log(`  ${g.id.padEnd(13)} ${String(g.bpm).padStart(3)} bpm · ${g.drums}`)
    console.log('\nUsage: node scripts/compose.mjs <genreId> [key] [bars] [--seed N] [--out path]')
    return
  }
  const positional = argv.filter(a => !a.startsWith('--'))
  const genreId = positional[0]
  const keyStr = positional[1] || ''
  const bars = parseInt(positional[2] || '48', 10)
  const seedArg = argv.find(a => a.startsWith('--seed='))
  const seed = seedArg ? parseInt(seedArg.split('=')[1], 10) : 12345
  const outArg = argv.find(a => a.startsWith('--out='))

  const spec = compose(libs, genreId, keyStr, bars, seed)
  const nNotes = spec.clips.reduce((a, c) => a + c.notes.length, 0)
  const end = Math.max(...spec.clips.flatMap(c => c.notes.map(nn => nn.startBeat + nn.durationBeats)), 0)
  const slug = `${spec.genre}-${(keyStr || spec.scale).replace(/\s+/g, '')}`.toLowerCase()
  const out = outArg ? outArg.split('=')[1] : join(OUT_DIR, `${slug}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(spec))
  console.log(`${spec.name}`)
  console.log(`  ${spec.tempo} bpm · swing ${spec.swing} · ${spec.tracks.length} tracks · ${spec.clips.length} clips · ${nNotes} notes · ${(end / spec.tempo * 60).toFixed(0)}s`)
  console.log(`  → ${out}`)
}
main().catch(e => { console.error(e.message || e); process.exit(1) })
