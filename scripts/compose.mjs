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
import { analyzeSpec } from './analyze-arrangement.mjs'

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

// ── SHARED recipe pool — ~35 extra progressions MERGED into every song's bank on
// top of its genre recipes, for far more harmonic variety. Dark / emotional /
// modern, inspired by Artemas, ThxSoMuch, Mr. Kitty (moody minor-key alt-pop /
// darkwave / hyperpop). A few are adventurous 8-bar journeys — they don't have to
// sound "complete" alone, they just have to work under the melody + drums. ─────
const EXTRA = {
  minor: {
    ground: [
      R('i VI III VII', 7), R('i iv VI v', 9), R('i VII VI VII'), R('i v VI iv', 9),
      R('i VI iv VII'), R('i III VII VI'), R('i iv v VI', 9), R('i VI VII v'),
      R('i ii v i', 9), R('i iv i VII'), R('i v iv i'), R('i VII iv VI'),
      R('i VI iv v i VI III VII', 7), R('i v iv VII III VI ii v', 9),
      R('i VII VI v iv VI III i'), R('i iv VII III VI ii v i', 9),
      R('i III iv VI v VII i i'), R('i VI v iv VII III VI VII', 9),
    ],
    lift: [
      R('VI VII i i'), R('iv v VI VII'), R('VI iv i v', 9), R('iv VI III VII'),
      R('VI III iv i'), R('iv v i VI'), R('VI VII iv i'), R('iv i VII VI'),
      R('III VII i VI'), R('VI iv v i VI iv ii v', 9), R('iv VII III VI ii v i i', 9),
      R('VI VII i v iv VI III VII'),
    ],
    bridge: [
      R('iv v VI III'), R('VI ii v i', 9), R('III VI iv v'), R('ii v i VI', 9), R('iv III VI VII'),
    ],
    // more darkness / jazz / tension — added for vocabulary growth
    extra: [
      R('i VI ii v', 9), R('i iv VII VI'), R('i VII III VI'), R('VI v iv III'),
      R('i ii III VI v iv VII i', 9), R('iv VI v i VII III VI ii', 9),
      R('i i VII VI v v iv III'), R('VI VII v i iv v VI VII'),
    ],
  },
  major: {
    ground: [
      R('I V vi IV'), R('I iii vi IV'), R('vi V IV I'), R('I vi IV V'),
      R('I iii IV V I vi ii V'), R('I V vi iii IV I ii V'),
    ],
    lift: [
      R('vi IV I V'), R('IV I V vi'), R('vi iii IV V'), R('IV V vi iii'), R('I vi ii V vi IV I V'),
    ],
    bridge: [R('ii V I vi'), R('IV iii vi V'), R('vi ii V I')],
  },
  dorian: {
    ground: [R('i IV i VII'), R('i ii IV i'), R('i VII IV i'), R('i IV VII ii')],
    lift: [R('IV i VII i'), R('VII IV i i'), R('ii IV i VII')],
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

// ── Drum feel → a POOL of base patterns (16-step lanes); the seed picks one, and
// fillDrums thins/thickens it per section. Multiple variants per feel so songs
// of the same genre don't all share one groove. ───────────────────────────────
const FEELS = {
  'four-floor': [
    { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], oh: [2, 6, 10, 14], clap: [4, 12] },
    { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [6, 14], clap: [4, 12] },
    { kick: [0, 4, 8, 12], snare: [12], hat: [2, 6, 10, 14], oh: [2, 10], clap: [4, 12] },
  ],
  backbeat: [
    { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
    { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
    { kick: [0, 6, 10], snare: [4, 12], hat: [2, 6, 10, 14], oh: [], clap: [] },
  ],
  boombap: [
    { kick: [0, 6, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
    { kick: [0, 10, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [15], clap: [] },
    { kick: [0, 3, 8], snare: [4, 12], hat: [0, 4, 6, 8, 12, 14], oh: [7], clap: [] },
  ],
  trap: [
    { kick: [0, 7, 10], snare: [8], hat: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], oh: [], clap: [8] },
    { kick: [0, 6, 10, 11], snare: [12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [12] },
    { kick: [0, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 13, 14, 15], oh: [], clap: [8] },
  ],
  'half-time': [
    { kick: [0, 11], snare: [8], hat: [0, 4, 8, 12], oh: [], clap: [8] },
    { kick: [0, 6], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [8] },
    { kick: [0, 10, 11], snare: [8], hat: [0, 4, 8, 12], oh: [14], clap: [8] },
  ],
  breakbeat: [
    { kick: [0, 3, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7, 15], clap: [] },
    { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
    { kick: [0, 6, 10], snare: [4, 10, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [15], clap: [] },
  ],
  shuffle: [
    { kick: [0, 8], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14], oh: [], clap: [] },
    { kick: [0, 6, 8], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14], oh: [11], clap: [] },
  ],
  syncopated: [
    { kick: [0, 3, 6, 10], snare: [4, 12], hat: [2, 6, 10, 14], oh: [7], clap: [] },
    { kick: [0, 3, 6, 10, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
  ],
  dembow: [
    { kick: [0, 6, 8, 14], snare: [4, 12], hat: [2, 6, 10, 14], oh: [], clap: [4, 12] },
    { kick: [0, 6, 8, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [3, 4, 11, 12] },
  ],
  none: [{ kick: [], snare: [], hat: [], oh: [], clap: [] }],
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
// Alternate sounds per role/style — the seed varies the TIMBRE, drawing from the
// full 46-voice library (mallets, brass, strings, extra guitars, choir…) the
// composer used to ignore. Ids are builtin-N (see lib/midi-presets.ts).
const LEAD_ALTS = {
  // melodic leads: mallets, winds, strings, plucks — bright, singable voices
  melody: ['builtin-36', 'builtin-40', 'builtin-24', 'builtin-2', 'builtin-38', 'builtin-31', 'builtin-37', 'builtin-39', 'builtin-42', 'builtin-25', 'builtin-10', 'builtin-35', 'builtin-16'],
  arp:    ['builtin-3', 'builtin-8', 'builtin-12', 'builtin-39', 'builtin-38', 'builtin-36'],
  riff:   ['builtin-15', 'builtin-3', 'builtin-21', 'builtin-34', 'builtin-35', 'builtin-22'],
  stab:   ['builtin-3', 'builtin-1', 'builtin-8', 'builtin-21', 'builtin-45'],
  sustained: ['builtin-43', 'builtin-24', 'builtin-30', 'builtin-6', 'builtin-40', 'builtin-28', 'builtin-42'],
}
// Alternate keys / pad / bass timbres (role-appropriate), seed-picked so songs
// don't all use the one house voice per role.
const KEYS_ALTS = ['builtin-2', 'builtin-1', 'builtin-27', 'builtin-26', 'builtin-0', 'builtin-36', 'builtin-35', 'builtin-45', 'builtin-31']
const PAD_ALTS  = ['builtin-30', 'builtin-12', 'builtin-28', 'builtin-9', 'builtin-29', 'builtin-6', 'builtin-13', 'builtin-44']
const BASS_ALTS = ['builtin-4', 'builtin-18', 'builtin-19', 'builtin-17']

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
// Effect factories (shared).
function fxKit(rand, mkId) {
  return {
    rv: (wet, decay, pre = 0.02) => ({ id: mkId(), type: 'reverb', params: { enabled: true, wet, decay, preDelay: pre } }),
    dl: (wet, beats, fb = 0.35) => ({ id: mkId(), type: 'delay', params: { enabled: true, wet, time: 0.375, feedback: fb, syncToTempo: true, syncBeats: beats } }),
    eq: (lo, mid, hi) => ({ id: mkId(), type: 'eq3', params: { enabled: true, lowGain: lo, midGain: mid, highGain: hi, lowFreq: 200, midFreq: 1000, highFreq: 8000 } }),
    cp: (thr, ratio, mk) => ({ id: mkId(), type: 'compressor', params: { enabled: true, threshold: thr, ratio, attack: 0.003, release: 0.25, knee: 6, makeupGain: mk } }),
    mo: (mix, type) => ({ id: mkId(), type: 'chorus', params: { enabled: true, type: type || rand.pick(['chorus', 'chorus', 'flanger', 'phaser']), rate: 0.45, depth: 0.5, feedback: 0.3, mix, stages: 4 } }),
    sa: (drive) => ({ id: mkId(), type: 'saturator', params: { enabled: true, drive, color: 0.3, output: 0 } }),
    ap: (depth, rate = 0.5) => ({ id: mkId(), type: 'autopan', params: { enabled: true, rate, depth, waveform: 'sine', phase: 180 } }),
    lf: (rate, depth = 0.6) => ({ id: mkId(), type: 'lfo', params: { enabled: true, rate, depth, waveform: 'sine', target: 'filter', filterFreqMin: 500, filterFreqMax: 6500 } }),
    rx: (bits, sr) => ({ id: mkId(), type: 'redux', params: { enabled: true, bitDepth: bits, sampleRate: sr } }),
    ts: (attack) => ({ id: mkId(), type: 'transientshaper', params: { enabled: true, attack, sustain: 0, gain: 0 } }),
    de: (freq) => ({ id: mkId(), type: 'deesser', params: { enabled: true, frequency: freq, bandwidth: 1, threshold: -20, reduction: 10 } }),
    dq: (freq, range) => ({ id: mkId(), type: 'dyneq', params: { enabled: true, freq, q: 2, thresholdDb: -30, rangeDb: range, attack: 0.01, release: 0.15 } }),
    flt: (hz) => ({ id: mkId(), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: hz, q: 1 } }),
  }
}

// A LIBRARY of distinct effect chains per fx-role — the seed picks one, so racks
// vary in their CORE (EQ/comp voicing, ordering, effect choices), not just an
// optional tail. No forced filter here — the sweep adds its own to its target.
function trackFx(fxRole, pal, genreId, rand, mkId) {
  const { rv, dl, eq, cp, mo, sa, ap, lf, rx, ts, de, dq } = fxKit(rand, mkId)
  const heavy = pal.bassStyle === '808'
  const electronic = ['house', 'deep-house', 'techno', 'trance', 'dnb', 'dubstep', 'future-bass', 'synthwave', 'reggaeton'].includes(genreId)
  const lofiish = ['lofi', 'boombap', 'trap', 'rnb'].includes(genreId)
  const opt = (p, ...e) => rand.chance(p) ? e : []
  const CHAINS = {
    drums: [
      () => [cp(-18, 4, 1), eq(2, 0, 1.5), ...opt(0.4, ts(0.4))],
      () => [ts(0.5), cp(-16, 3, 1), eq(1, 0, 2)],
      () => [cp(-20, 4, 1), sa(0.2), eq(2, -1, 1)],
      () => [eq(3, -1, 2), cp(-14, 3, 2), ...opt(0.5, ts(0.35))],
      () => [ts(0.45), eq(2, 0, 1), dq(4000, -4)],
      () => [cp(-17, 4, 1), eq(1, -1, 2), ...opt(0.5, sa(0.16))],
    ],
    bass: [
      () => [eq(3, -1, 0), cp(-20, 3, 1), ...(heavy ? [sa(0.35)] : [])],
      () => [cp(-22, 4, 2), eq(2, -2, 0), ...(heavy ? [sa(0.4)] : [])],
      () => [sa(0.3), eq(4, 0, -1), cp(-18, 3, 1)],
      () => [eq(2, 1, -2), cp(-20, 3, 1.5), dq(120, 3)],
      () => [dq(90, 4), cp(-19, 3, 1), eq(3, -1, -1)],
    ],
    keys: [
      () => [rv(0.2, 1.8), dl(0.16, 0.5)],
      () => [eq(-1, 1, 2), rv(0.22, 2), ap(0.4)],
      () => [mo(0.35, 'chorus'), rv(0.2, 1.8)],
      () => [dl(0.2, 0.375, 0.4), rv(0.18, 1.6), ...(lofiish ? [rx(11, 13000)] : [])],
      () => [rv(0.25, 2.4), ap(0.5, 0.3), ...opt(0.4, dl(0.15, 0.75))],
      () => [mo(0.35, 'phaser'), dl(0.18, 0.5), rv(0.2, 1.8)],
    ],
    pad: [
      () => [rv(0.42, 3.2, 0.03), mo(0.4)],
      () => [rv(0.5, 3.6), ap(0.5, 0.3)],
      () => [rv(0.35, 2.8), mo(0.4, 'flanger'), ap(0.4, 0.25)],
      () => [rv(0.45, 3.4), ...(electronic ? [lf(0.2, 0.5)] : [mo(0.35, 'chorus')])],
      () => [mo(0.4, 'phaser'), rv(0.4, 3), ap(0.4, 0.2)],
      () => [eq(-2, 0, 1), rv(0.5, 4), ...opt(0.5, ap(0.4, 0.2))],
    ],
    lead: [
      () => [dl(0.22, 0.375, 0.38), rv(0.28, 2.2)],
      () => [mo(0.35), rv(0.3, 2.4), dl(0.15, 0.75)],
      () => [rv(0.25, 2), ap(0.4), dl(0.2, 0.375)],
      () => [mo(0.4, 'phaser'), dl(0.25, 0.375, 0.4), rv(0.28, 2.2)],
      () => [sa(0.2), dl(0.2, 0.5), rv(0.3, 2.4)],
      () => [dl(0.3, 0.375, 0.45), rv(0.22, 1.8), ...(electronic ? [lf(0.5, 0.5)] : []), ...opt(0.3, de(7500))],
    ],
  }
  const bank = CHAINS[fxRole] || CHAINS.keys
  return rand.pick(bank)()
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
      // HALF-TIME feel — kick on 1, snare pushed back to beat 3, sparser hats. A
      // dramatic switch-up (the drop suddenly feels twice as slow / heavy).
      if (sec.halfTime) hits = lane === 'kick' ? [0] : lane === 'snare' ? [8] : lane === 'hat' ? (feel.hat || []).filter((_, i) => i % 2 === 0) : lane === 'clap' ? [8] : []
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
// `strum` > 0 rolls a chord ASCENDING (lowest note first, each next one a hair
// later) for emphasis — a harp/guitar-strum feel. Only the DOWNBEAT hit of each
// bar rolls (so it stays an accent, not a constant effect), and the rolled chord
// gets a small velocity lift. `strum` is in beats per note (e.g. 0.04).
// Re-voice a chord (octave-shuffle its OWN tones — always in key/consonant) so
// different songs sit the harmony differently: inversions, open, drop-2.
function voiceChord(chord, style) {
  const c = [...chord]
  if (style === 'inv1' && c.length >= 2) { const r = c.shift(); return [...c, r + 12] }
  if (style === 'inv2' && c.length >= 3) { const r = c.shift(), t = c.shift(); return [...c, r + 12, t + 12] }
  if (style === 'open'  && c.length >= 3) return [c[0], c[2], c[1] + 12, ...c.slice(3)]
  if (style === 'drop2' && c.length >= 3) { const a = [...c]; a[a.length - 2] -= 12; return a.sort((x, y) => x - y) }
  return chord
}
function fillChords(clip, rand, bar0, chords, patStr, base, ring, spread, strum = 0, voicing = 'close') {
  const on = [...patStr].map((c, i) => (c === 'o' ? i : -1)).filter(i => i >= 0)
  chords.forEach((chord, b) => {
    for (let k = 0; k < on.length; k++) {
      const i = on[k]
      const nxt = k + 1 < on.length ? on[k + 1] : 16
      const len = (ring ?? (nxt - i)) * STEP
      const voiced = spread ? [chord[0] - 12, ...chord.slice(1)] : voiceChord(chord, voicing)
      const roll = strum > 0 && i === 0 && voiced.length > 1
      const seq = roll ? [...voiced].sort((a, b2) => a - b2) : voiced
      seq.forEach((p, vi) => {
        const off = roll ? vi * strum : 0
        clip.notes.push(note(p, (bar0 + b) * 4 + i * STEP + off, Math.max(0.1, len - off) * 0.97, hvel(rand, base + (roll ? 5 : 0), i)))
      })
    }
  })
}

// Nudge each note's start by a small random amount for a human, un-quantized
// feel — applied to melodic layers only (drums/bass stay tight to the grid).
function humanizeClip(clip, amt, rand) {
  if (!amt) return
  for (const nte of clip.notes) nte.startBeat = +Math.max(0, nte.startBeat + (rand() * 2 - 1) * amt).toFixed(4)
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

// ── Lead: a repeating HOOK — a real melodic phrase, not one figure per bar ────
// A hook is a 2- or 4-bar rhythmic phrase (statement bars busier, the LAST bar
// sparse so it breathes) plus a fixed STEPWISE contour (`move` = scale steps).
// fillLead applies it: strong beats anchor to a chord tone (outline the harmony),
// weak beats step through the scale — so the line is melodic AND consonant, and
// the same phrase recurs like a real hook instead of random notes.
function makeHook(rand) {
  const bars = rand.pick([2, 2, 4])
  const CALL = [[0, 4, 7, 10], [0, 3, 6, 10], [0, 4, 6, 12], [0, 6, 8, 12], [2, 4, 8, 10], [0, 2, 4, 8, 12]]
  const ANSW = [[0, 8], [0], [4, 12], [8], [0, 4]]
  const MOVES = [1, 1, -1, -1, 2, -2, 1, -1, 3, -2]   // mostly stepwise, occasional leap
  const events = []
  for (let bar = 0; bar < bars; bar++) {
    const last = bar === bars - 1
    const slots = last ? rand.pick(ANSW) : (rand.chance(0.72) ? rand.pick(CALL) : rand.pick(ANSW))
    for (let k = 0; k < slots.length; k++) {
      const slot = slots[k], next = k + 1 < slots.length ? slots[k + 1] : 16
      const strong = slot % 8 === 0
      events.push({ bar, slot, len: Math.min(next - slot, 4), strong, move: strong ? 0 : rand.pick(MOVES) })
    }
  }
  return { bars, events }
}
function chordToneAt(chord, idx) {
  const n = chord.length
  const oct = Math.floor(idx / n)
  return chord[((idx % n) + n) % n] + oct * 12 + 12 // an octave up = lead register
}
function fillLead(clip, rand, bar0, chords, hook, base, style, root, scale, arpDir = 'up', rate = 2) {
  const steps = SCALES[scale], N = steps.length
  // deg = position in the scale, in the lead register (root at octave 5).
  const degPitch = d => root + 72 + steps[((d % N) + N) % N] + 12 * Math.floor(d / N)

  if (style === 'arp') {
    chords.forEach((chord, b) => {
      const bt = (bar0 + b) * 4
      const nn = [...chord, chord[1] + 12, chord[2] + 12].map(p => p + 12)   // arp tones, lead register
      let ord = nn
      if (arpDir === 'down') ord = [...nn].reverse()
      else if (arpDir === 'updown') ord = [...nn, ...[...nn].reverse().slice(1, -1)]
      for (let i = 0, k = 0; i < 16; i += rate, k++) clip.notes.push(note(ord[k % ord.length], bt + i * STEP, rate * STEP * 0.9, hvel(rand, base - 6, i)))
    })
    return
  }
  if (style === 'sustained') {
    chords.forEach((chord, b) => clip.notes.push(note(chordToneAt(chord, 2), (bar0 + b) * 4, 4 * 0.98, hvel(rand, base - 10, 0))))
    return
  }

  // melody / riff / stab: walk the hook's contour, anchoring to chord tones on
  // strong beats so the line outlines the harmony and never wanders out of key.
  let cur = null
  chords.forEach((chord, b) => {
    const bt = (bar0 + b) * 4
    const cds = []   // chord-tone scale-degrees in the lead register
    for (let d = -2; d <= 14; d++) if (chord.some(p => ((p % 12) + 12) % 12 === ((degPitch(d) % 12) + 12) % 12)) cds.push(d)
    const snap = to => cds.reduce((a, c) => Math.abs(c - to) < Math.abs(a - to) ? c : a, cds[0])
    for (const ev of hook.events.filter(e => e.bar === (b % hook.bars))) {
      if (cur === null) cur = snap(3)                 // open near mid-register
      else if (ev.strong) cur = snap(cur)             // land on a chord tone
      else {
        cur += ev.move                                // step through the scale
        if (cur > 13) cur -= N; else if (cur < -2) cur += N
        if (rand.chance(0.28)) cur = snap(cur)        // don't drift too far off the chord
      }
      if (rand.chance(0.07)) continue                 // an occasional rest to breathe
      const len = (style === 'stab' ? 1 : ev.len) * STEP
      clip.notes.push(note(degPitch(cur), bt + ev.slot * STEP, len * 0.92, hvel(rand, base - (ev.strong ? 0 : 6), ev.slot)))
    }
  })
}

// ── Compose ───────────────────────────────────────────────────────────────────
// ── Artist-inspired STYLES ── each biases genre + tempo + a signature flavor, in
// the SPIRIT of the artist (not a clone). `sig`: 'space' = huge reverb wash;
// 'guitar' = electric-guitar lead; 'crush' = distorted / bit-crushed grit.
const STYLES = {
  darkwave: { genre: 'synthwave', bpm: 90,  key: 'C# minor', sig: 'space' },   // Mr. Kitty
  altpop:   { genre: 'synthwave', bpm: 118, key: 'F# minor', sig: 'guitar' },  // Artemas (dark alt-pop)
  hyperpop: { genre: 'trap',      bpm: 156, key: 'G minor',  sig: 'crush' },    // ThxSoMuch
  phonk:    { genre: 'trap',      bpm: 130, key: 'A minor',  sig: 'crush' },
  dreampop: { genre: 'synthwave', bpm: 104, key: 'D minor',  sig: 'space' },
}

function compose({ GENRES, DRUM_KITS }, genreId, keyStr, seed, opts = {}) {
  const genre = GENRES.find(g => g.id === genreId)
  if (!genre) throw new Error(`unknown genre "${genreId}" — try --list`)
  const rand = makeRand(seed)
  const pal = { ...DEF, ...(PAL[genreId] || {}) }
  const kit = DRUM_KITS.find(k => k.id === pal.kit) || DRUM_KITS[0]
  const feel = rand.pick(FEELS[genre.drums] || FEELS.backbeat)
  let { root, scale } = parseKey(keyStr, genre.scale)
  // MODAL COLOR — occasionally lift a minor genre to dorian (brighter 6th) or a
  // major one to mixolydian (bluesy ♭7), for genres where modes sit naturally.
  const MODAL_OK = ['lofi', 'house', 'deep-house', 'funk', 'disco', 'rnb', 'bossa-nova', 'afrobeat', 'reggaeton', 'ambient']
  let modeName = null
  if (MODAL_OK.includes(genreId) && rand.chance(0.2)) {
    if (scale === 'minor') { scale = 'dorian'; modeName = 'dorian' }
    else if (scale === 'major') { scale = 'mixolydian'; modeName = 'mixolydian' }
  }

  // Progression bank: prefer the genre's own curated recipes for this mode; fall
  // back to the scale-generic bank. Each role (ground/lift/bridge) is a list of
  // recipes (4- or 8-bar); we pick a DISTINCT one for verse/chorus/bridge.
  const gr = (PROG_RECIPES[genreId] || {})[scale]
  const fb = PROGS[scale] || PROGS.minor
  const ex = EXTRA[scale] || {}   // shared ~45-recipe pool, added to every song's options
  const groundBank = [...((gr && gr.ground) || fb.ground), ...(ex.ground || []), ...(ex.extra || [])].map(asRecipe)
  const liftBank   = [...((gr && gr.lift)   || fb.lift),   ...(ex.lift   || []), ...(ex.extra || [])].map(asRecipe)
  const bridgeBank = [...((gr && gr.bridge) || [...fb.ground, ...fb.lift]), ...(ex.bridge || []), ...(ex.extra || [])].map(asRecipe)

  const recA = rand.pick(groundBank)
  let recB = rand.pick(liftBank); if (recKey(recB) === recKey(recA)) recB = rand.pick(liftBank)
  const recC = rand.pick(bridgeBank.filter(r => recKey(r) !== recKey(recA) && recKey(r) !== recKey(recB))) || rand.pick(bridgeBank)
  const progs = { A: recA, B: recB, C: recC }
  const seen = { A: 0, B: 0, C: 0 }   // section-appearance counter → development

  const form = buildForm(FORM_FAMILY[genreId] || 'loop', rand)
  const hook = makeHook(rand)
  let leadPreset = rand.pick(LEAD_ALTS[pal.leadStyle] || [pal.lead])
  if (opts.sig === 'guitar') leadPreset = 'builtin-15'   // electric guitar lead (Artemas)
  const keyRhythm = KEY_RHYTHMS[pal.keyRhythm] || KEY_RHYTHMS.stab
  // Seed-vary the keys/pad/bass timbre too — mostly the genre default, sometimes
  // an alternate from the wider library, so songs draw on more of the 46 voices.
  const altTimbre = (def, arr) => rand.chance(0.5) ? def : rand.pick(arr)
  const keysPreset = altTimbre(pal.keys, KEYS_ALTS)
  const padPreset  = altTimbre(pal.pad, PAD_ALTS)
  const bassPreset = altTimbre(pal.bass, BASS_ALTS)

  // ── Technique palette — EVERY dynamic feature is OPTIONAL and seed-gated, so
  // each song draws a DIFFERENT subset. Two songs (even same genre) should share
  // few of these: same-y makeup is the enemy. Each song still evolves its mood
  // (via whichever techniques it drew) but no two sound built the same way.
  const useFilterArc = rand.chance(0.7)                              // per-section brightness arc
  const introStyle   = rand.pick(['layered', 'layered', 'soft', 'soft', 'plain'])  // how the song opens
  const fourFloor    = genre.drums === 'four-floor' || ['house', 'deep-house', 'techno', 'trance', 'disco', 'future-bass'].includes(genreId)
  const useSidechain = fourFloor && rand.chance(0.8)                 // kick pump on sustained layers
  const useSweeps    = rand.chance(0.7)                              // filter-sweep transitions into peaks
  const useClipFx    = rand.chance(0.7)                              // drawn effect BARS on the track FX lanes
  const useRolls     = rand.chance(0.45)                             // ascending chord strums on high-energy downbeats
  const voicing      = rand.pick(['close', 'close', 'inv1', 'inv2', 'open', 'drop2'])  // how chords sit
  const arpDir       = rand.pick(['up', 'up', 'down', 'updown'])     // arp shape
  const arpRate      = rand.pick([2, 2, 4])                          // 16ths vs 8ths
  const useSwap      = rand.chance(0.4)                              // swap the keys timbre in the bridge
  const swapPreset   = useSwap ? rand.pick(KEYS_ALTS.filter(p => p !== keysPreset)) : null
  const humanize     = rand.chance(0.6) ? rand.pick([0.006, 0.01, 0.015]) : 0  // melodic timing jitter (beats)
  // ── Toolbox moves ──
  const useRiser     = rand.chance(0.55)                             // ascending run into drops
  const useImpact    = rand.chance(0.55)                             // sub-boom on the drop downbeat
  const peakIdx      = form.map((s, i) => (/drop|chorus|hook/.test(s.role) ? i : -1)).filter(i => i >= 0)
  const halfTimeIdx  = (rand.chance(0.3) && peakIdx.length > 1) ? peakIdx[peakIdx.length - 1] : -1  // last peak flips half-time
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
  const NONE = { type: 'none', params: {} }

  // ── Ensemble: which tonal layers this song uses, so the track LINEUP varies —
  // not always drums/bass/keys/pad/lead. Some drop keys or pad, some add an arp
  // or a counter-melody. drums + bass are the backbone. ─────────────────────────
  const ENSEMBLES = [
    ['keys', 'pad', 'lead'], ['keys', 'pad', 'lead'],   // full (weighted)
    ['pad', 'lead'],                                     // minimal — no keys
    ['keys', 'lead'],                                    // band — no pad
    ['keys', 'pad', 'lead', 'arp'],                      // stacked
    ['keys', 'pad', 'lead', 'counter'],                 // + harmony line
    ['arp', 'pad', 'lead'],                              // arp-driven
    ['pad', 'lead', 'counter'],                          // dual melody, no keys
    ['keys', 'lead', 'arp'],                             // no pad, arp
    ['keys', 'pad', 'lead', 'arp', 'counter'],           // big stack
    ['keys', 'lead', 'counter'],                         // no pad, harmony
    ['keys', 'pad', 'arp'],                              // texture-led, no distinct lead
    ['pad', 'arp', 'lead'],                              // arp + pad wash
  ]
  const arpPreset = rand.pick(LEAD_ALTS.arp)
  const counterPreset = rand.pick(LEAD_ALTS.melody)
  const ROLE = {
    drums:   { name: 'Drums',   instr: kit.instrument, preset: null,          rf: null,             pan: 0,     vol: 0.6,  drum: true, fx: 'drums' },
    bass:    { name: 'Bass',    instr: NONE,           preset: bassPreset,    rf: RF.bass,          pan: 0,     vol: 0.58, fx: 'bass' },
    keys:    { name: 'Keys',    instr: NONE,           preset: keysPreset,    rf: RF.keys(pal.ext), pan: -0.12, vol: 0.46, fx: 'keys' },
    pad:     { name: 'Pad',     instr: NONE,           preset: padPreset,     rf: RF.pad,           pan: 0.14,  vol: 0.34, fx: 'pad' },
    lead:    { name: 'Lead',    instr: NONE,           preset: leadPreset,    rf: RF.lead,          pan: 0.08,  vol: 0.5,  fx: 'lead' },
    arp:     { name: 'Arp',     instr: NONE,           preset: arpPreset,     rf: RF.lead,          pan: -0.2,  vol: 0.4,  fx: 'keys' },
    counter: { name: 'Counter', instr: NONE,           preset: counterPreset, rf: RF.lead,          pan: -0.08, vol: 0.4,  fx: 'lead' },
  }
  const roleList = [...(genre.drums !== 'none' ? ['drums'] : []), 'bass', ...rand.pick(ENSEMBLES)]
  const TK = roleList.map(r => ({ key: r, ...ROLE[r] }))
  const tracks = TK.map(t => ({ id: uid('t'), name: t.name, instrument: t.instr, volume: t.vol, pan: t.pan, effects: trackFx(t.fx, pal, genreId, rand, () => uid('e')) }))
  // Style signature — stamp the artist flavor onto the racks.
  if (opts.sig === 'space') for (const t of tracks) if (/Pad|Lead/.test(t.name)) { const rv = t.effects.find(e => e.type === 'reverb'); if (rv) { rv.params.wet = Math.min(0.75, rv.params.wet + 0.22); rv.params.decay = Math.max(rv.params.decay, 3.6) } else t.effects.push({ id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.5, decay: 3.8, preDelay: 0.03 } }) }
  if (opts.sig === 'crush') for (const t of tracks) if (/Bass|Lead/.test(t.name)) { if (!t.effects.some(e => e.type === 'saturator')) t.effects.unshift({ id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.5, color: 0.4, output: 0 } }); if (!t.effects.some(e => e.type === 'redux')) t.effects.push({ id: uid('e'), type: 'redux', params: { enabled: true, bitDepth: 9, sampleRate: 14000 } }) }
  const tid = Object.fromEntries(TK.map((t, i) => [t.key, tracks[i].id]))
  const byKey = Object.fromEntries(TK.map(t => [t.key, t]))
  const has = k => byKey[k] != null
  const trackOf = k => tracks[TK.findIndex(t => t.key === k)]
  const hook2 = has('counter') ? makeHook(rand) : null
  const clips = []

  // ── Dynamic track FX ─────────────────────────────────────────────────────────
  // (1) SIDECHAIN PUMP: duck the sustained layers against the kick (house pump).
  if (useSidechain && has('drums')) {
    const bassComp = trackOf('bass')?.effects.find(e => e.type === 'compressor')
    if (bassComp) bassComp.params.sidechainTrackId = tid.drums
    const duck = has('pad') ? 'pad' : has('keys') ? 'keys' : null
    if (duck) trackOf(duck).effects.push({ id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -32, ratio: 6, attack: 0.004, release: 0.18, knee: 4, makeupGain: 0, sidechainTrackId: tid.drums } })
  }
  // (2) SWEEP TRANSITIONS — diversified: a RANDOM tonal track + a random PARAM
  // (filter cutoff / reverb swell / delay throw), not always the keys filter.
  const sweepCands = ['keys', 'arp', 'lead', 'pad'].filter(has)
  const sweepRole = sweepCands.length ? rand.pick(sweepCands) : null
  const sweepMode = rand.pick(['filter', 'filter', 'reverb', 'delay'])
  let sweepCfg = null
  if (useSweeps && sweepRole) {
    const tr = trackOf(sweepRole)
    if (sweepMode === 'filter') {
      let f = tr.effects.find(e => e.type === 'filter')
      if (!f) { f = { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 18000, q: 1 } }; tr.effects.unshift(f) }
      sweepCfg = { trackId: tid[sweepRole], effectId: f.id, param: 'frequency', min: 200, max: 18000, shape: 'closeOpen', label: 'Filter sweep' }
    } else if (sweepMode === 'reverb') {
      let r = tr.effects.find(e => e.type === 'reverb')
      if (!r) { r = { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.25, decay: 2.6, preDelay: 0.02 } }; tr.effects.push(r) }
      sweepCfg = { trackId: tid[sweepRole], effectId: r.id, param: 'wet', min: 0, max: 0.7, shape: 'swell', label: 'Reverb swell' }
    } else {
      let d = tr.effects.find(e => e.type === 'delay')
      if (!d) { d = { id: uid('e'), type: 'delay', params: { enabled: true, wet: 0.2, time: 0.375, feedback: 0.4, syncToTempo: true, syncBeats: 0.375 } }; tr.effects.push(d) }
      sweepCfg = { trackId: tid[sweepRole], effectId: d.id, param: 'wet', min: 0, max: 0.6, shape: 'throw', label: 'Delay throw' }
    }
  }
  const sweepTargets = []   // absolute start-beats of high-energy sections
  const secList = []        // {start, bars, role, energy} for building FX bars

  // Make a section-clip for a layer, stamping the tension-driven low-pass on it.
  const secClip = (key, startBeat, bars, energy, presetOverride) => {
    const tk = byKey[key]
    let rf = tk.rf ? { ...tk.rf } : null
    const cut = cutoffFor(energy, key === 'bass')
    if (rf && cut != null) rf.filterHz = cut
    return { id: uid('c'), trackId: tid[key], presetId: presetOverride ?? tk.preset, rollFx: rf, startBeat, durationBeats: bars * 4, notes: [], isDrumClip: !!tk.drum }
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
    secList.push({ start: secStart, bars: sec.bars, role: sec.role, energy: e })
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

    const peak = /chorus|hook|drop/.test(sec.role)
    // LAYERED INTRO — elements enter one at a time (whatever roles this ensemble
    // has): a sustained layer from the top, bass a quarter in, filtered hats
    // halfway, a chordy layer three-quarters in — then the section hits full.
    if (layered) {
      const q = Math.max(1, Math.floor(sec.bars / 4))
      const sus = has('pad') ? 'pad' : has('keys') ? 'keys' : has('arp') ? 'arp' : null
      if (sus) { const c = secClip(sus, secStart, sec.bars, e * 0.85); fillPadLong(c, rand, 0, padCh, 42); push(c) }
      if (has('bass') && sec.bars - q >= 1) { const c = secClip('bass', secStart + q * 4, sec.bars - q, 0.42); fillBass(c, rand, 0, roots.slice(q), 'pedal', 74, root, scale); push(c) }
      if (has('drums') && genre.drums !== 'none' && sec.bars - 2 * q >= 1) { const c = secClip('drums', secStart + 2 * q * 4, sec.bars - 2 * q, 0.55); fillDrums(c, rand, 0, sec.bars - 2 * q, { kick: [], snare: [], hat: feel.hat, oh: [], clap: [] }, { energy: 0.62, role: 'intro' }); push(c) }
      const ch = has('keys') ? 'keys' : has('arp') ? 'arp' : null
      if (ch && ch !== sus && sec.bars - 3 * q >= 1) { const c = secClip(ch, secStart + 3 * q * 4, sec.bars - 3 * q, 0.5); fillChords(c, rand, 0, chords.slice(3 * q), keyRhythm, 54, null, false); push(c) }
      bar += sec.bars
      continue
    }

    // Drums
    const halfTime = form.indexOf(sec) === halfTimeIdx
    if (has('drums') && genre.drums !== 'none') {
      if (L.drums) { const c = secClip('drums', secStart, sec.bars, e); fillDrums(c, rand, 0, sec.bars, feel, { ...sec, halfTime }); push(c) }
      else if (L.softDrums) { const c = secClip('drums', secStart, sec.bars, Math.min(e, 0.5)); fillDrums(c, rand, 0, sec.bars, feel, { ...sec, breakdown: true }); push(c) }
    }
    // Bass
    if (has('bass') && L.bass) { const c = secClip('bass', secStart, sec.bars, e); fillBass(c, rand, 0, roots, sparse ? 'pedal' : pal.bassStyle, 78, root, scale); push(c) }
    // Keys — rhythmic chords (voiced per the song's voicing; swaps timbre in the
    // bridge for a mid-song "development" when this song drew useSwap).
    if (has('keys') && e >= 0.45 && !sparse) { const c = secClip('keys', secStart, sec.bars, e, sec.role === 'bridge' ? swapPreset : null); fillChords(c, rand, 0, chords, keyRhythm, e > 0.8 ? 68 : 58, null, false, useRolls && e >= 0.85 ? rand.pick([0.035, 0.05, 0.065]) : 0, voicing); humanizeClip(c, humanize, rand); push(c) }
    // Arp — a rolling 16th layer, its own track when the ensemble has one
    if (has('arp') && e >= 0.5 && !sparse) { const c = secClip('arp', secStart, sec.bars, e); fillLead(c, rand, 0, chords, hook, 54, 'arp', root, scale, arpDir, arpRate); humanizeClip(c, humanize, rand); push(c) }
    // Pad — held long when sparse
    if (has('pad')) { const c = secClip('pad', secStart, sec.bars, sparse ? e * 0.85 : e)
      if (sparse) fillPadLong(c, rand, 0, padCh, 42)
      else fillChords(c, rand, 0, padCh, KEY_RHYTHMS.sustain, e > 0.5 ? 48 : 40, 16, true, 0, voicing)
      push(c) }
    // Lead — melody at peaks; falls back to an arp during builds only if there's
    // no dedicated arp track.
    if (has('lead') && !sparse) {
      if (peak && e >= 0.85) { const c = secClip('lead', secStart, sec.bars, e); fillLead(c, rand, 0, chords, hook, 66, pal.leadStyle, root, scale); humanizeClip(c, humanize, rand); push(c) }
      else if (!has('arp') && (sec.build || (/chorus|drop/.test(sec.role) && e >= 0.9))) { const c = secClip('lead', secStart, sec.bars, e); fillLead(c, rand, 0, chords, hook, 56, 'arp', root, scale, arpDir, arpRate); push(c) }
    }
    // Counter — a second melodic line at peaks (its own hook, lower register)
    if (has('counter') && peak && e >= 0.9 && !sparse) { const c = secClip('counter', secStart, sec.bars, e); fillLead(c, rand, 0, chords, hook2, 60, 'melody', root, scale); humanizeClip(c, humanize, rand); push(c) }
    bar += sec.bars
  }
  const totalBeats = bar * 4

  // ── Risers & impacts ── an accelerating ascending run up into a drop, and a
  // sub-boom on the downbeat for weight. Seed-gated.
  if (useRiser || useImpact) {
    const steps = SCALES[scale], NN = steps.length
    for (let i = 1; i < secList.length; i++) {
      const cur = secList[i], prev = secList[i - 1]
      if (!(/drop|chorus|hook/.test(cur.role) && cur.energy >= 0.9) || cur.energy - prev.energy < 0.15 || cur.start < 4) continue
      const S = cur.start
      if (useRiser) {
        const rRole = ['arp', 'lead', 'keys'].find(has)
        if (rRole) { const c = secClip(rRole, S - 4, 4, 0.75); for (let k = 0; k < 16; k++) { const d = k + 2; c.notes.push(note(root + 60 + steps[((d % NN) + NN) % NN] + 12 * Math.floor(d / NN), k * STEP, STEP * 0.9, Math.min(122, 48 + k * 5))) } push(c) }
      }
      if (useImpact && has('bass')) { const c = secClip('bass', S, 1, cur.energy); c.notes.push(note(root + 24, 0, 1.5 * 0.98, 116)); push(c) }
    }
  }

  // Build the transition automation lane on the chosen target, using the shape
  // that fits the param: a filter CLOSES then opens (baseline open); a reverb or
  // delay SWELLS from dry up into the downbeat then cuts. Different every song.
  const automationLanes = []
  if (sweepCfg && sweepTargets.length) {
    const base = sweepCfg.shape === 'closeOpen' ? 1 : 0    // filter idles open, sends idle dry
    const raw = [{ beat: 0, value: base }]
    for (const S of sweepTargets) {
      if (S < 8) continue
      if (sweepCfg.shape === 'closeOpen') raw.push({ beat: S - 16.5, value: 1 }, { beat: S - 16, value: 0.1 }, { beat: S - 0.1, value: 1 })
      else if (sweepCfg.shape === 'swell') raw.push({ beat: S - 16, value: 0 }, { beat: S - 0.5, value: 1 }, { beat: S, value: 0 })
      else /* throw */ raw.push({ beat: S - 8, value: 0 }, { beat: S - 0.2, value: 1 }, { beat: S + 2, value: 0 })
    }
    raw.push({ beat: totalBeats, value: base })
    raw.sort((a, b) => a.beat - b.beat)
    const pts = []
    for (const p of raw) {
      if (p.beat < 0) continue
      if (pts.length && Math.abs(pts[pts.length - 1].beat - p.beat) < 0.05) pts[pts.length - 1] = p
      else pts.push(p)
    }
    if (pts.length > 2) automationLanes.push({
      id: uid('a'), trackId: sweepCfg.trackId, parameter: `fx:${sweepCfg.effectId}:${sweepCfg.param}`,
      label: sweepCfg.label, min: sweepCfg.min, max: sweepCfg.max, defaultValue: base, expanded: false,
      points: pts.map(p => ({ id: uid('p'), beat: +p.beat.toFixed(3), value: p.value })),
    })
  }

  // ── Clip effect-BARS on the track FX lanes (the "trackhead FX" system). ──────
  // A bar = { trackId, startBeat, durationBeats, fx:{param:target}, graph:0..1 }.
  // Distinct from the rack: these are drawn, region-scoped moves you see on the
  // FX lane under a track. Seed-gated so only some songs/sections get them.
  const clipEffects = []
  if (useClipFx) {
    const ap = (t, v) => ({ id: uid('p'), t: +t.toFixed(3), v, smooth: false, h1: [0, 0], h2: [0, 0] })
    const graph = { full: d => [ap(0, 1), ap(d, 1)], in: d => [ap(0, 0), ap(d, 1)], out: d => [ap(0, 1), ap(d, 0)] }
    const bar = (key, start, durBeats, fx, shape) => clipEffects.push({ id: uid('x'), trackId: tid[key], startBeat: +start.toFixed(3), durationBeats: +durBeats.toFixed(3), fx, graph: graph[shape](durBeats) })
    // grit on the peaks — drive bar over drops/choruses
    const driveOn = rand.chance(0.6)
    // pulsing breakdowns — tremolo bar on the pad
    const tremOn = rand.chance(0.5)
    // delay throws leading INTO a peak — a 2-beat delay swell on the keys
    const throwOn = rand.chance(0.5)
    for (const s of secList) {
      const peak = /drop|chorus|hook/.test(s.role) && s.energy >= 0.9
      const quiet = /break|bridge/.test(s.role) && s.energy < 0.7
      if (peak && driveOn) bar('drums', s.start, s.bars * 4, { drive: rand.chance(0.5) ? 0.32 : 0.24 }, 'full')
      if (quiet && tremOn) bar('pad', s.start, s.bars * 4, { tremoloDepth: 0.55, tremoloRate: rand.pick([4, 6, 8]) }, 'full')
      if (peak && throwOn && s.start >= 2) bar('keys', s.start - 2, 2, { delayWet: 0.5 }, 'in')
    }
  }

  // ── PRESSURE & RELEASE ───────────────────────────────────────────────────────
  // The section ENERGIES are the map. A big jump up into a peak is a moment to
  // build tension then RELEASE it — so the drop lands harder than a straight cut.
  // Per real rise we seed-pick an emphasis move:
  //   · gap     — cut EVERYTHING for the last beat → silence → impact
  //   · dropout — kill the drums for the last bar; the beat slams back on the 1
  //   · solo    — strip to ONE exposed layer for the run-up (tension by reduction)
  //   · muffle  — filter a sustained layer DOWN over the run-up, released at the drop
  const dyn = []
  {
    const silence = (c, a, b) => {
      c.notes = c.notes.filter(nte => {
        const t = c.startBeat + nte.startBeat
        if (t < a && t + nte.durationBeats > a) nte.durationBeats = +Math.max(0.05, a - t).toFixed(4)  // truncate crossing notes
        return !(t >= a - 1e-6 && t < b - 1e-6)                                                        // drop notes inside the window
      })
    }
    const ap0 = (t, v) => ({ id: uid('p'), t: +t.toFixed(3), v, smooth: false, h1: [0, 0], h2: [0, 0] })
    for (let i = 1; i < secList.length; i++) {
      const cur = secList[i], prev = secList[i - 1]
      if (!(/drop|chorus|hook/.test(cur.role) && cur.energy >= 0.9)) continue
      if (cur.energy - prev.energy < 0.2 || cur.start < 8) continue
      const S = cur.start
      const move = rand.pick(['gap', 'gap', 'dropout', 'solo', 'muffle', 'straight', 'straight'])
      if (move === 'straight') continue
      dyn.push(move)
      if (move === 'gap') { const g = rand.pick([0.5, 1, 1]); for (const c of clips) silence(c, S - g, S) }
      else if (move === 'dropout') { if (has('drums')) for (const c of clips) if (c.trackId === tid.drums) silence(c, S - 4, S) }
      else if (move === 'solo') { const keep = tid[['lead', 'arp', 'keys'].find(has) || 'lead']; const back = rand.pick([1, 2]) * 4; for (const c of clips) if (c.trackId !== keep) silence(c, S - back, S) }
      else if (move === 'muffle') { const mR = ['pad', 'keys', 'arp'].find(has); if (mR) clipEffects.push({ id: uid('x'), trackId: tid[mR], startBeat: +(S - 8).toFixed(3), durationBeats: 8, fx: { filterHz: 400 }, graph: [ap0(0, 0), ap0(6.5, 1), ap0(8, 0)] }) }
    }
  }

  const keyLabel = modeName ? `${KEY_NAMES[root]} ${scale}` : (keyStr || `${KEY_NAMES[root]} ${scale}`)
  return {
    name: `${opts.styleName ? opts.styleName + ' · ' : ''}${genre.name} — ${keyLabel}`,
    genre: genre.id, tempo: opts.tempo || genre.bpm, timeSignatureNum: 4, timeSignatureDen: 4,
    swing: genre.swing, key: root, scale,
    masterVolume: 0.5, tracks, clips, automationLanes, clipEffects,
    _form: form.map(s => s.role).join(' · '),
    _tracks: roleList.join('+'),
    _features: `intro:${introStyle} filterArc:${useFilterArc ? 'on' : 'off'} sidechain:${useSidechain ? 'on' : 'off'} sweep:${automationLanes.length ? sweepRole + '/' + sweepMode : 'off'} clipFx:${clipEffects.length} rolls:${useRolls ? 'on' : 'off'} voicing:${voicing} arp:${arpDir}/${arpRate === 2 ? '16th' : '8th'} swap:${useSwap ? 'on' : 'off'} human:${humanize ? 'on' : 'off'}${modeName ? ' mode:' + modeName : ''} tension:[${dyn.join(',') || 'straight'}] riser:${useRiser ? 'on' : 'off'} impact:${useImpact ? 'on' : 'off'} halfTime:${halfTimeIdx >= 0 ? 'on' : 'off'}`,
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
  const styleArg = argv.find(a => a.startsWith('--style='))
  const seed = seedArg ? parseInt(seedArg.split('=')[1], 10) : 12345
  let genreId = pos[0], keyStr = pos[1] || '', opts = {}
  if (styleArg) {
    const st = STYLES[styleArg.split('=')[1]]
    if (!st) { console.error(`unknown style — try: ${Object.keys(STYLES).join(', ')}`); process.exit(1) }
    genreId = pos[0] || st.genre
    keyStr = pos[1] || st.key
    opts = { tempo: st.bpm, sig: st.sig, styleName: styleArg.split('=')[1] }
  }
  // SELF-SELECT: with --best=K, generate K candidates and keep the one whose
  // arrangement scores highest (score minus a penalty per flat-spot flag). The
  // composer critiquing its own output and picking the most dynamic take.
  const bestArg = argv.find(a => a.startsWith('--best='))
  const K = bestArg ? Math.max(1, Math.min(24, parseInt(bestArg.split('=')[1], 10) || 1)) : 1
  let spec, pick = null
  for (let i = 0; i < K; i++) {
    const s = compose(libs, genreId, keyStr, seed + i * 7919, opts)
    const r = analyzeSpec(s)
    const rank = r.score - r.flags.length * 10
    if (!pick || rank > pick.rank) pick = { spec: s, r, rank, seedUsed: seed + i * 7919 }
  }
  spec = pick.spec
  if (K > 1) console.log(`  self-select: best of ${K} — seed ${pick.seedUsed} · score ${pick.r.score}/100 · ${pick.r.flags.length} flag(s) · density ${pick.r.spark.density}`)
  const nNotes = spec.clips.reduce((a, c) => a + c.notes.length, 0)
  const end = Math.max(...spec.clips.map(c => c.startBeat + c.durationBeats), 0)
  const slug = `${styleArg ? styleArg.split('=')[1] + '-' : ''}${spec.genre}-${(keyStr || spec.scale).replace(/\s+/g, '')}`.toLowerCase()
  const out = outArg ? outArg.split('=')[1] : join(OUT_DIR, `${slug}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(spec))
  console.log(`${spec.name}`)
  console.log(`  ${spec.tempo} bpm · swing ${spec.swing} · form: ${spec._form}`)
  console.log(`  tracks: ${spec._tracks}`)
  console.log(`  fx: ${spec._features}`)
  console.log(`  ${spec.tracks.length} tracks · ${nNotes} notes · ${(end / spec.tempo * 60).toFixed(0)}s → ${out}`)
}
main().catch(e => { console.error(e.message || e); process.exit(1) })
