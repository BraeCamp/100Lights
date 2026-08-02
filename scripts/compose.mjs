#!/usr/bin/env node
// ── The composer (v2 — form + technique driven) ──────────────────────────────
// Genre-driven song generator that DRIVES FROM THE APP'S OWN LIBRARIES
// (lib/genres.ts, lib/drum-presets.ts). v1 was monotonous — every song was the
// same 5 layers over one 4-chord loop. v2 composes with real song-writing
// technique so songs (even same genre) differ meaningfully:
//   · SONG FORM — verse/chorus/bridge/drop/breakdown/outro, not "add layers".
//   · HARMONIC CONTRAST — per-GENRE progression RECIPES (PROG_RECIPES), mostly
//     8-bar so a section moves through 8 bars instead of looping 4; a 4-bar
//     recipe filling 8 bars gets a turnaround (A + A′), and 2nd+ choruses
//     develop (richer extensions). Different recipe for verse/chorus/bridge.
//   · DRUM VARIATION — per-section intensity, fills at section ends, builds
//     (snare rolls), drops (crash), breakdowns (drums out), genre hat styles.
//   · MELODIC TECHNIQUE — a recurring HOOK motif (not random notes), developed
//     across choruses; call-and-response phrasing; genre lead styles.
//   · BASS TECHNIQUE — genre idiom (walking / offbeat / 808 / octave-arp / …).
//   · DYNAMIC TRACK FX — real, automated mixer FX for movement (not static):
//     a SIDECHAIN pump (bass+pad ducked by the kick) on four-on-the-floor
//     genres, and a FILTER SWEEP automation on the keys that closes then opens
//     across the 4 bars into every drop/chorus — a rising transition, not an
//     instant switch. Emitted as automationLanes (fx:{id}:frequency) + a
//     sidechained compressor; both render in the real-time bounce.
//   · FORM VARIETY — buildForm() varies intro length (4–16 bars, sometimes a
//     two-part intro) and outro length by seed, so songs don't share one makeup.
//   · DYNAMIC ARC — one CLIP PER SECTION, each with its own sound: a tension-
//     driven low-pass (dark/quiet parts, bright peaks) + a sparse long-note
//     "soft intro" so songs start slow and open up. These are SEED-GATED — a
//     palette of options for variety, NOT a checklist every song must satisfy.
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
// Entries may be 4-bar OR 8-bar arrays; a 4-bar entry that has to fill 8 bars is
// NOT looped verbatim — the repeat gets a turnaround (see sectionNumerals). This
// scale-generic bank is the FALLBACK; per-genre recipes below take priority.
// (Case in a numeral is cosmetic — chordFor stacks diatonic thirds either way.)
const PROGS = {
  minor: {
    ground: [['i', 'VI', 'III', 'VII'], ['i', 'iv', 'i', 'v'], ['i', 'VII', 'VI', 'VII'], ['i', 'i', 'iv', 'v'],
      ['i', 'VII', 'VI', 'v', 'iv', 'VII', 'III', 'i'], ['i', 'v', 'VI', 'iv', 'III', 'VI', 'ii', 'v']],
    lift: [['VI', 'VII', 'i', 'i'], ['iv', 'VII', 'III', 'VI'], ['VI', 'III', 'VII', 'i'], ['iv', 'v', 'VI', 'VII'],
      ['VI', 'iv', 'i', 'v', 'VI', 'iv', 'ii', 'v'], ['iv', 'v', 'VI', 'VII', 'III', 'VI', 'ii', 'v']],
  },
  major: {
    ground: [['I', 'V', 'vi', 'IV'], ['I', 'IV', 'I', 'V'], ['I', 'vi', 'ii', 'V'], ['I', 'iii', 'IV', 'V'],
      ['I', 'V', 'vi', 'IV', 'I', 'V', 'ii', 'IV'], ['I', 'vi', 'ii', 'V', 'I', 'vi', 'IV', 'V']],
    lift: [['vi', 'IV', 'I', 'V'], ['IV', 'V', 'iii', 'vi'], ['IV', 'I', 'V', 'vi'], ['ii', 'V', 'I', 'vi'],
      ['vi', 'IV', 'I', 'V', 'vi', 'IV', 'ii', 'V'], ['IV', 'V', 'I', 'vi', 'ii', 'V', 'I', 'I']],
  },
  dorian: { ground: [['i', 'IV', 'i', 'IV'], ['i', 'ii', 'IV', 'i']], lift: [['IV', 'i', 'ii', 'IV'], ['VII', 'IV', 'i', 'i']] },
  phrygian: { ground: [['i', 'II', 'i', 'VII'], ['i', 'VII', 'II', 'i']], lift: [['II', 'i', 'VII', 'i'], ['VII', 'II', 'i', 'i']] },
  mixolydian: { ground: [['I', 'VII', 'IV', 'I'], ['I', 'v', 'IV', 'I']], lift: [['IV', 'I', 'VII', 'I'], ['VII', 'IV', 'I', 'I']] },
  lydian: { ground: [['I', 'II', 'I', 'V'], ['I', 'II', 'vi', 'V']], lift: [['II', 'I', 'V', 'I'], ['V', 'II', 'I', 'I']] },
}

// ── Per-genre progression RECIPES (curated, mostly 8-bar, idiomatic) ──────────
// A recipe = { chords:[…], bars, ext?, turn? }. `R('i iv VII III …', ext, turn)`
// is a shorthand. Keyed by genre → mode (minor/major) → role. These take
// PRIORITY over the scale-generic PROGS; genres/modes with no entry fall back.
// This is where the "progression setting" lives — edit here to shape a genre.
const R = (str, ext, turn) => { const chords = str.trim().split(/\s+/); return { chords, bars: chords.length, ...(ext ? { ext } : {}), ...(turn ? { turn } : {}) } }
const PROG_RECIPES = {
  lofi: { minor: {
    ground: [R('i iv VII III VI ii v i', 9), R('i v VI iv III VI ii v', 9)],
    lift:   [R('VI iv i v VI iv ii v', 9), R('iv VII III VI ii v i i', 9)],
    bridge: [R('iv v VI VII III VI ii v', 9)],
  } },
  rnb: { minor: {
    ground: [R('i ii v i iv VII III VI', 9), R('i iv i v VI ii v i', 9)],
    lift:   [R('VI VII i iii VI iv ii v', 9), R('iv v i VI iv v III VI', 9)],
    bridge: [R('iv ii v i VI VII iv v', 9)],
  } },
  boombap: { minor: {
    ground: [R('i i VI VII i i iv v', 7), R('i VII VI VII i VII iv v', 7)],
    lift:   [R('VI VII i v VI VII iv i', 9), R('iv v i VI iv v VI VII', 7)],
  } },
  trap: { minor: {
    ground: [R('i VI i VII i VI iv v'), R('i i VII VI i i iv VII')],
    lift:   [R('VI VII i i iv v VI VII'), R('iv v VI VII i VI iv v')],
  } },
  'deep-house': { minor: {
    ground: [R('i VI iv v i VI ii v', 9), R('i iv VII III VI iv v i', 9)],
    lift:   [R('iv v i VI iv v III VI', 9), R('VI iv v i VI iv ii v', 9)],
  } },
  house: { minor: {
    ground: [R('i VI iv v i VI iv VII', 7), R('i iv v VI i iv ii v', 9)],
    lift:   [R('iv v i VI iv v VI VII', 7), R('VI VII i v iv v i i', 7)],
  } },
  techno: { minor: {
    ground: [R('i i VII VI i i iv v'), R('i VII i VI i VII iv v')],
    lift:   [R('VI VII i i VI VII v i'), R('iv v i i iv v VI VII')],
  } },
  trance: { minor: {
    ground: [R('i VI III VII iv VI v i', 7), R('i iv VI VII III VI v i', 7)],
    lift:   [R('VI VII i iii iv v VI VII', 7), R('iv VI i v VI VII III i', 7)],
  } },
  dnb: { minor: {
    ground: [R('i VII VI VII i VII iv v'), R('i VI iv v i VI VII i')],
    lift:   [R('VI iv i v VI iv VII i'), R('iv v VI VII i VI iv v')],
  } },
  dubstep: { minor: {
    ground: [R('i VI i VII i VI iv v'), R('i VII VI v i VII iv v')],
    lift:   [R('VI VII i i iv v VI VII'), R('iv v i VI VII i iv v')],
  } },
  'future-bass': { minor: {
    ground: [R('i VI III VII VI iv ii v', 9), R('i iv VI III VI iv v i', 9)],
    lift:   [R('VI VII i iii iv v VI VII', 9), R('iv v VI III VI iv ii v', 9)],
  } },
  ambient: { minor: {
    ground: [R('i iv i VI iv VII III i', 9), R('i VI iv III VI iv v i', 9)],
    lift:   [R('VI iv i v VI III ii v', 9), R('iv VII III VI ii v i i', 9)],
  } },
  reggaeton: { minor: {
    ground: [R('i VI VII v i VI iv v'), R('i VII VI v i VII iv v')],
    lift:   [R('VI VII i v VI VII iv i'), R('iv v i VI VII i iv v')],
  } },
  synthwave: { minor: {
    ground: [R('i VI VII v i VI iv VII'), R('i VII VI VII i VI III VII')],
    lift:   [R('VI VII i i VI VII v i'), R('iv v VI VII i VI VII i')],
    bridge: [R('iv v VI III VI iv v VII')],
  } },
  'bossa-nova': { minor: {
    ground: [R('i ii v i iv VII III VI', 9), R('i iv ii v i VI ii v', 9)],
    lift:   [R('iv VII III VI ii v i i', 9), R('VI ii v i iv ii v i', 9)],
    bridge: [R('VI ii v i iv VII III VI', 9)],
  } },
  pop: { major: {
    ground: [R('I V vi IV I V ii IV'), R('I vi ii V I vi IV V')],
    lift:   [R('vi IV I V vi IV ii V'), R('IV I V vi IV I ii V')],
    bridge: [R('IV V iii vi ii V I I')],
  } },
  disco: { major: {
    ground: [R('I vi ii V I vi IV V', 7), R('I IV V IV I ii V V', 7)],
    lift:   [R('IV V I vi IV V iii vi', 7), R('vi IV I V vi ii V I', 7)],
  } },
  funk: { major: {
    ground: [R('I IV I IV I IV ii V', 9), R('I ii IV V I IV I V', 9)],
    lift:   [R('IV V I vi ii V I I', 9), R('IV I V IV ii V I I', 9)],
  } },
  afrobeat: { major: {
    ground: [R('I IV V IV I ii IV V'), R('I V IV I ii IV V I')],
    lift:   [R('IV I V vi IV I ii V'), R('V IV I vi ii V I I')],
  } },
  rock: {
    major: { ground: [R('I V vi IV I V IV IV'), R('I IV V IV I V vi IV')], lift: [R('vi IV I V vi IV V V'), R('IV I V vi IV V I I')] },
    minor: { ground: [R('i VII VI VII i VII iv v'), R('i VI III VII i VI iv v')], lift: [R('VI VII i i VI VII v i'), R('iv v VI VII i VII VI i')] },
  },
}

// Lay a recipe across `bars`. An 8-bar recipe fills 8 bars with no internal loop;
// a 4-bar recipe filling 8 bars gets a TURNAROUND on the repeat (last chord →
// dominant) so it never sounds like the same 4 chords twice. Later appearances
// of the SAME section also get the turnaround, so verse 2 differs from verse 1.
function sectionNumerals(recipe, bars, appearance, scale) {
  const base = recipe.chords
  const cadence = recipe.turn || (scale === 'major' ? 'V' : 'VII')
  const out = []
  let pass = 0
  while (out.length < bars) {
    let block = base.slice(0, Math.min(base.length, bars - out.length))
    if ((pass > 0 || appearance > 0) && block.length === base.length && block.length > 1) {
      block = block.slice(); block[block.length - 1] = cadence
    }
    out.push(...block); pass++
  }
  return out.slice(0, bars)
}
// Normalize a bank entry (array OR recipe) to a recipe; key it for de-duping.
const asRecipe = e => Array.isArray(e) ? { chords: e, bars: e.length } : e
const recKey = r => r.chords.join('-')

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
// NOTE: reverb/delay/chorus now live in the VISIBLE track effect rack (see
// trackFx below), not here — so the user can see and tweak them in the mixer.
// rollFx keeps only note-level shaping + the per-section filter ARC (filterHz is
// overwritten per section by cutoffFor to move brightness with tension).
const RF = {
  bass: { filterHz: 2600, gain: 1.4 },
  keys: (ext) => ({ sustain: 0.5, gain: 1.4, ...(ext >= 9 ? { filterHz: 6500 } : {}) }),
  pad: { attack: 0.5, gain: 1.6, filterHz: 5200 },
  lead: { sustain: 0.35, gain: 1.7, vibratoDepth: 0.1 },
}

// ── Visible track effect racks — real, editable mixer effects per layer ───────
// Genre/role-appropriate and seed-varied. Beyond the core mix chain (EQ / comp /
// reverb / delay) each layer can also draw CHARACTER + MOVEMENT effects from the
// app's full palette — autopan (stereo motion), an LFO wobbling a filter,
// bitcrush grit, transient-shaper punch, phaser/flanger — all seed-gated, so
// songs get different textures instead of one house sound.
function trackFx(key, pal, genreId, rand, mkId) {
  const rv = (wet, decay, pre = 0.02) => ({ id: mkId(), type: 'reverb', params: { enabled: true, wet, decay, preDelay: pre } })
  const dl = (wet, beats, fb = 0.35) => ({ id: mkId(), type: 'delay', params: { enabled: true, wet, time: 0.375, feedback: fb, syncToTempo: true, syncBeats: beats } })
  const eq = (lo, mid, hi) => ({ id: mkId(), type: 'eq3', params: { enabled: true, lowGain: lo, midGain: mid, highGain: hi, lowFreq: 200, midFreq: 1000, highFreq: 8000 } })
  const cp = (thr, ratio, mk) => ({ id: mkId(), type: 'compressor', params: { enabled: true, threshold: thr, ratio, attack: 0.003, release: 0.25, knee: 6, makeupGain: mk } })
  // Modulation — randomly chorus / flanger / phaser for timbral variety.
  const mo = (mix, type) => ({ id: mkId(), type: 'chorus', params: { enabled: true, type: type || rand.pick(['chorus', 'chorus', 'flanger', 'phaser']), rate: 0.45, depth: 0.5, feedback: 0.3, mix, stages: 4 } })
  const sa = (drive) => ({ id: mkId(), type: 'saturator', params: { enabled: true, drive, color: 0.3, output: 0 } })
  const ap = (depth, rate = 0.5) => ({ id: mkId(), type: 'autopan', params: { enabled: true, rate, depth, waveform: 'sine', phase: 180 } })      // stereo motion
  const lf = (rate, depth = 0.6) => ({ id: mkId(), type: 'lfo', params: { enabled: true, rate, depth, waveform: 'sine', target: 'filter', filterFreqMin: 500, filterFreqMax: 6500 } })  // filter wobble
  const rx = (bits, sr) => ({ id: mkId(), type: 'redux', params: { enabled: true, bitDepth: bits, sampleRate: sr } })                             // bitcrush grit
  const ts = (attack) => ({ id: mkId(), type: 'transientshaper', params: { enabled: true, attack, sustain: 0, gain: 0 } })                        // punch
  // Open low-pass at the FRONT of the keys chain — neutral at 18k, but its
  // `frequency` is the target for the automated build/transition sweeps. Keys
  // (bright chord stabs, present through builds) sweep audibly; a dark pad
  // wouldn't, and filtering the drums would muddy the kick.
  const flt = (hz) => ({ id: mkId(), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: hz, q: 1 } })
  const heavy = pal.bassStyle === '808'
  const electronic = ['house', 'deep-house', 'techno', 'trance', 'dnb', 'dubstep', 'future-bass', 'synthwave', 'reggaeton'].includes(genreId)
  const lofiish = ['lofi', 'boombap', 'trap', 'rnb'].includes(genreId)
  switch (key) {
    case 'drums': return [cp(-18, 4, 1), eq(2, 0, 1.5), ...(rand.chance(0.5) ? [sa(0.18)] : []), ...(rand.chance(0.4) ? [ts(0.4)] : [])]
    case 'bass':  return [eq(3, -1, 0), cp(-20, 3, 1), ...(heavy ? [sa(0.35)] : [])]
    case 'keys':  return [flt(18000), rv(0.2, 1.8), ...(rand.chance(0.5) ? [dl(0.16, 0.5)] : []), ...(lofiish && rand.chance(0.5) ? [rx(11, 13000)] : []), ...(rand.chance(0.3) ? [ap(0.5)] : [])]
    case 'pad':   return [rv(0.42, 3.2, 0.03), ...(rand.chance(0.55) ? [mo(0.4)] : []), ...(rand.chance(0.4) ? [ap(0.55, 0.3)] : []), ...(electronic && rand.chance(0.35) ? [lf(0.2, 0.5)] : [])]
    case 'lead':  return [rand.chance(0.6) ? dl(0.22, 0.375, 0.38) : mo(0.35), rv(0.28, 2.2), ...(electronic && rand.chance(0.3) ? [lf(0.5, 0.5)] : [])]
    default: return []
  }
}

// Build a form with seed-driven variety so songs don't all share one makeup.
// Intros breathe (4–16 bars, not a token 4) and the outro length varies too.
function buildForm(family, rand) {
  const base = FORMS[family].map(s => ({ ...s }))
  base[0].bars = family === 'edm' ? rand.pick([8, 8, 16]) : rand.pick([4, 8, 8])
  base[base.length - 1].bars = rand.pick([4, 8])
  // Song/loop: occasionally hold the first verse longer, or double the intro
  // into a two-part intro (adds structural variety between songs).
  if (family !== 'edm' && rand.chance(0.4)) base.splice(1, 0, { role: 'intro', bars: rand.pick([4, 8]), prog: 'A', energy: 0.45 })
  return base
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

// Long, held pad — merges runs of the same chord into one sustained note. Used
// for sparse/low-tension sections so the music can "breathe" and open slowly.
function fillPadLong(clip, rand, bar0, chords, base) {
  let i = 0
  while (i < chords.length) {
    let j = i + 1
    while (j < chords.length && chords[j].join() === chords[i].join()) j++
    const spanBeats = (j - i) * 4
    const voiced = [chords[i][0] - 12, ...chords[i].slice(1)]
    for (const p of voiced) clip.notes.push(note(p, (bar0 + i) * 4, spanBeats * 0.99, hvel(rand, base, 0)))
    i = j
  }
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

  // Progression bank: prefer the genre's own curated recipes for this mode; fall
  // back to the scale-generic bank. Each role (ground/lift/bridge) is a list of
  // recipes (4- or 8-bar); we pick a DISTINCT one for verse/chorus/bridge.
  const gr = (PROG_RECIPES[genreId] || {})[scale]
  const fb = PROGS[scale] || PROGS.minor
  const groundBank = (gr && gr.ground || fb.ground).map(asRecipe)
  const liftBank   = (gr && gr.lift   || fb.lift).map(asRecipe)
  const bridgeBank = ((gr && gr.bridge) || [...fb.ground, ...fb.lift]).map(asRecipe)

  const recA = rand.pick(groundBank)
  let recB = rand.pick(liftBank); if (recKey(recB) === recKey(recA)) recB = rand.pick(liftBank)
  const recC = rand.pick(bridgeBank.filter(r => recKey(r) !== recKey(recA) && recKey(r) !== recKey(recB))) || rand.pick(bridgeBank)
  const progs = { A: recA, B: recB, C: recC }
  const seen = { A: 0, B: 0, C: 0 }   // section-appearance counter → development

  const form = buildForm(FORM_FAMILY[genreId] || 'loop', rand)
  const motif = makeMotif(rand)
  const leadPreset = rand.pick(LEAD_ALTS[pal.leadStyle] || [pal.lead])
  const keyRhythm = KEY_RHYTHMS[pal.keyRhythm] || KEY_RHYTHMS.stab

  // ── Technique palette — EVERY dynamic feature is OPTIONAL and seed-gated, so
  // each song draws a DIFFERENT subset. Two songs (even same genre) should share
  // few of these: same-y makeup is the enemy. Each song still evolves its mood
  // (via whichever techniques it drew) but no two sound built the same way.
  const useFilterArc = rand.chance(0.7)                              // per-section brightness arc
  const introStyle   = rand.pick(['layered', 'layered', 'soft', 'soft', 'plain'])  // how the song opens
  const fourFloor    = genre.drums === 'four-floor' || ['house', 'deep-house', 'techno', 'trance', 'disco', 'future-bass'].includes(genreId)
  const useSidechain = fourFloor && rand.chance(0.8)                 // kick pump on sustained layers
  const useSweeps    = rand.chance(0.7)                              // filter-sweep transitions into peaks
  // Energy → low-pass cutoff (Hz). Steep curve: quiet parts are clearly dark,
  // peaks fully open. Bass keeps some body so it never disappears.
  const cutoffFor = (energy, isBass) => {
    if (!useFilterArc) return null
    const hz = Math.round(500 + Math.pow(Math.max(0, Math.min(1, energy)), 2.2) * 17500)
    return isBass ? Math.max(900, hz) : hz
  }

  // Track definitions — one TRACK per layer, but one CLIP PER SECTION so each
  // part of the song carries its own sound (filter brightness, density). This is
  // how a producer builds it: the intro clip is dull + sparse, the drop clip is
  // bright + full, and the timbre steps with the tension as the song moves.
  let n = 0; const uid = p => `${p}${(n++).toString(36)}`
  const TK = [
    { key: 'drums', name: 'Drums', instr: kit.instrument,        preset: null,       rf: null,               pan: 0,     vol: 0.6,  drum: true },
    { key: 'bass',  name: 'Bass',  instr: { type: 'none', params: {} }, preset: pal.bass,   rf: RF.bass,            pan: 0,     vol: 0.58 },
    { key: 'keys',  name: 'Keys',  instr: { type: 'none', params: {} }, preset: pal.keys,   rf: RF.keys(pal.ext),   pan: -0.12, vol: 0.46 },
    { key: 'pad',   name: 'Pad',   instr: { type: 'none', params: {} }, preset: pal.pad,    rf: RF.pad,             pan: 0.14,  vol: 0.34 },
    { key: 'lead',  name: 'Lead',  instr: { type: 'none', params: {} }, preset: leadPreset, rf: RF.lead,            pan: 0.08,  vol: 0.5 },
  ]
  const tracks = TK.map(t => ({ id: uid('t'), name: t.name, instrument: t.instr, volume: t.vol, pan: t.pan, effects: trackFx(t.key, pal, genreId, rand, () => uid('e')) }))
  const tid = Object.fromEntries(TK.map((t, i) => [t.key, tracks[i].id]))
  const byKey = Object.fromEntries(TK.map(t => [t.key, t]))
  const clips = []

  // ── Dynamic track FX ─────────────────────────────────────────────────────────
  // (1) SIDECHAIN PUMP: on four-on-the-floor genres, duck the sustained layers
  // against the kick so the whole track breathes with the beat — the signature
  // house/techno movement. We point their compressors' key input at the drums.
  if (useSidechain) {
    const bassComp = tracks[1].effects.find(e => e.type === 'compressor')
    if (bassComp) bassComp.params.sidechainTrackId = tid.drums
    // give the pad a ducking compressor too, so pads pump with the kick
    tracks[3].effects.push({ id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -32, ratio: 6, attack: 0.004, release: 0.18, knee: 4, makeupGain: 0, sidechainTrackId: tid.drums } })
  }
  // (2) FILTER-SWEEP TRANSITIONS: the keys' front filter is automated to close
  // then sweep wide open across the 4 bars leading INTO every drop/chorus/hook,
  // so sections arrive with a rising build instead of switching on instantly.
  const sweepFilterId = tracks[2].effects.find(e => e.type === 'filter')?.id
  const sweepTargets = []   // absolute start-beats of high-energy sections

  // Make a section-clip for a layer, stamping the tension-driven low-pass on it.
  const secClip = (key, startBeat, bars, energy) => {
    const tk = byKey[key]
    let rf = tk.rf ? { ...tk.rf } : null
    const cut = cutoffFor(energy, key === 'bass')
    if (rf && cut != null) rf.filterHz = cut
    return { id: uid('c'), trackId: tid[key], presetId: tk.preset, rollFx: rf, startBeat, durationBeats: bars * 4, notes: [], isDrumClip: !!tk.drum }
  }
  const push = c => { if (c.notes.length) clips.push(c) }

  let bar = 0
  for (const sec of form) {
    const recipe = progs[sec.prog]
    const appearance = seen[sec.prog]++        // 0 = first time this section plays
    const e = sec.energy
    const L = layersFor(sec)
    const sparse = introStyle === 'soft' && e < 0.42        // slow, long-note treatment
    const layered = introStyle === 'layered' && sec.role === 'intro'  // staggered build-up
    const secStart = bar * 4
    if (/drop|chorus|hook/.test(sec.role) && e >= 0.9) sweepTargets.push(secStart)
    // Lay the recipe across the whole section (8-bar recipe → no loop; 4-bar →
    // A + turnaround A′). Development: 2nd+ chorus gets richer extensions.
    let ext = recipe.ext ?? pal.ext
    if (sec.prog === 'B' && appearance > 0) ext = Math.max(ext, 9)
    let seq = sectionNumerals(recipe, sec.bars, appearance, scale)
    // Sparse sections hold long: reduce to the first two chords, doubled.
    if (sparse) { const a = seq[0], b = seq[Math.min(2, seq.length - 1)]; seq = Array.from({ length: sec.bars }, (_, i) => [a, b][Math.floor(i / 2) % 2]) }
    const chords = seq.map(nu => chordFor(nu, root, scale, 4, ext))
    const padCh = seq.map(nu => chordFor(nu, root, scale, 4, e > 0.8 ? ext : 0))
    const roots = seq.map(nu => snapToScale(rootFor(nu, root, scale, 2), root, scale))

    // LAYERED INTRO — elements enter one at a time so the opening actively builds:
    // pad from the top, bass a quarter in, filtered hats halfway, keys three-
    // quarters in — then the first section hits with the full kit.
    if (layered) {
      const q = Math.max(1, Math.floor(sec.bars / 4))
      { const c = secClip('pad', secStart, sec.bars, e * 0.85); fillPadLong(c, rand, 0, padCh, 42); push(c) }
      if (sec.bars - q >= 1) { const c = secClip('bass', secStart + q * 4, sec.bars - q, 0.42); fillBass(c, rand, 0, roots.slice(q), 'pedal', 74, root, scale); push(c) }
      if (genre.drums !== 'none' && sec.bars - 2 * q >= 1) { const c = secClip('drums', secStart + 2 * q * 4, sec.bars - 2 * q, 0.55); fillDrums(c, rand, 0, sec.bars - 2 * q, { kick: [], snare: [], hat: feel.hat, oh: [], clap: [] }, { energy: 0.62, role: 'intro' }); push(c) }
      if (sec.bars - 3 * q >= 1) { const c = secClip('keys', secStart + 3 * q * 4, sec.bars - 3 * q, 0.5); fillChords(c, rand, 0, chords.slice(3 * q), keyRhythm, 54, null, false); push(c) }
      bar += sec.bars
      continue
    }

    // Drums
    if (genre.drums !== 'none') {
      if (L.drums) { const c = secClip('drums', secStart, sec.bars, e); fillDrums(c, rand, 0, sec.bars, feel, sec); push(c) }
      else if (L.softDrums) { const c = secClip('drums', secStart, sec.bars, Math.min(e, 0.5)); fillDrums(c, rand, 0, sec.bars, feel, { ...sec, breakdown: true }); push(c) }
    }
    // Bass — long pedal roots when sparse, genre idiom otherwise
    if (L.bass) { const c = secClip('bass', secStart, sec.bars, e); fillBass(c, rand, 0, roots, sparse ? 'pedal' : pal.bassStyle, 78, root, scale); push(c) }
    // Keys — sit out the sparse intro so it stays open
    if (L.keys && !sparse) { const c = secClip('keys', secStart, sec.bars, e); fillChords(c, rand, 0, chords, keyRhythm, e > 0.8 ? 68 : 58, null, false); push(c) }
    // Pad — always present; held long when sparse
    { const c = secClip('pad', secStart, sec.bars, sparse ? e * 0.85 : e)
      if (sparse) fillPadLong(c, rand, 0, padCh, 42)
      else fillChords(c, rand, 0, padCh, KEY_RHYTHMS.sustain, e > 0.5 ? 48 : 40, 16, true)
      push(c) }
    // Lead — never in a sparse section
    if (L.lead && !sparse) { const c = secClip('lead', secStart, sec.bars, e); fillLead(c, rand, 0, chords, motif, 66, pal.leadStyle, root, scale); push(c) }
    else if (L.arp && !sparse) { const c = secClip('lead', secStart, sec.bars, e); fillLead(c, rand, 0, chords, motif, 56, 'arp', root, scale); push(c) }
    bar += sec.bars
  }
  const totalBeats = bar * 4

  // Build the pad filter-sweep automation lane from the collected targets. The
  // filter sits open (1.0) by default, dips at 4 bars out, and ramps back open
  // right on the downbeat — a rising transition into each drop/chorus.
  const automationLanes = []
  if (useSweeps && sweepFilterId && sweepTargets.length) {
    const raw = [{ beat: 0, value: 1 }]
    for (const S of sweepTargets) {
      if (S < 8) continue                         // no room to sweep into the very first section
      raw.push({ beat: S - 16.5, value: 1 }, { beat: S - 16, value: 0.1 }, { beat: S - 0.1, value: 1 })
    }
    raw.push({ beat: totalBeats, value: 1 })
    raw.sort((a, b) => a.beat - b.beat)
    const pts = []
    for (const p of raw) {
      if (p.beat < 0) continue
      if (pts.length && Math.abs(pts[pts.length - 1].beat - p.beat) < 0.05) pts[pts.length - 1] = p
      else pts.push(p)
    }
    if (pts.length > 2) automationLanes.push({
      id: uid('a'), trackId: tid.keys, parameter: `fx:${sweepFilterId}:frequency`,
      label: 'Filter sweep', min: 200, max: 18000, defaultValue: 1, expanded: false,
      points: pts.map(p => ({ id: uid('p'), beat: +p.beat.toFixed(3), value: p.value })),
    })
  }

  return {
    name: `${genre.name} — ${keyStr || (KEY_NAMES[root] + ' ' + scale)}`,
    genre: genre.id, tempo: genre.bpm, timeSignatureNum: 4, timeSignatureDen: 4,
    swing: genre.swing, key: root, scale,
    masterVolume: 0.5, tracks, clips, automationLanes,
    _form: form.map(s => s.role).join(' · '),
    _features: `intro:${introStyle} filterArc:${useFilterArc ? 'on' : 'off'} sidechain:${useSidechain ? 'on' : 'off'} sweeps:${useSweeps && automationLanes.length ? 'on' : 'off'}`,
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
  const end = Math.max(...spec.clips.map(c => c.startBeat + c.durationBeats), 0)
  const slug = `${spec.genre}-${(pos[1] || spec.scale).replace(/\s+/g, '')}`.toLowerCase()
  const out = outArg ? outArg.split('=')[1] : join(OUT_DIR, `${slug}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(spec))
  console.log(`${spec.name}`)
  console.log(`  ${spec.tempo} bpm · swing ${spec.swing} · form: ${spec._form}`)
  console.log(`  fx: ${spec._features}`)
  console.log(`  ${spec.tracks.length} tracks · ${nNotes} notes · ${(end / spec.tempo * 60).toFixed(0)}s → ${out}`)
}
main().catch(e => { console.error(e.message || e); process.exit(1) })
