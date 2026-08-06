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
import { TEMPLATES, resolveTemplate } from './song-templates.mjs'
import { createSession } from '../lib/session-capture/index.mjs'

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
      // ── tripled: new dark / modern / adventurous minor grounds ──
      R('i VI iv VII i VI III VII', 7), R('i III VI iv i v VI VII', 7), R('i VII v VI iv III ii i'),
      R('i iv v i VII VI III VII', 7), R('i VI VII III iv v i i', 9), R('i v i VI iv VII III i'),
      R('i iv VI VII v VI iv i'), R('i III VII iv VI v i i'), R('i VII VI III iv VII v i'),
      R('i ii VII VI iv v III i', 9), R('i VI v VII iv III VII i'), R('i iv III VI v VII i i'),
      R('i VII iv v VI III ii i', 9), R('i VI III iv VII v VI VII', 9), R('i v VI VII i iv III VII'),
      R('i iv i v VI VII III i'), R('i VI VII v i iv III VII', 7), R('i III iv v VI VII i i'),
      R('i i iv iv VI VI VII VII'), R('i VII i VI i v i iv'), R('i iv VI i v VII III VI', 9),
      R('i VI ii III iv v VII i', 9), R('i III v VII VI iv ii i', 9), R('i v iv III VI VII i i'),
      R('i VI iv i III VII v i'), R('i VII III v iv VI ii i', 9), R('i ii iv VI v VII III i', 9),
      R('i VI VII i iv v III VII'), R('i iv v VI VII i III i'), R('i III VI VII iv v i i'),
      R('i v VI iv i VII III VI', 9), R('i VI i iv VII III v i'), R('i iv VII v VI III ii i', 9),
    ],
    lift: [
      R('VI VII i i'), R('iv v VI VII'), R('VI iv i v', 9), R('iv VI III VII'),
      R('VI III iv i'), R('iv v i VI'), R('VI VII iv i'), R('iv i VII VI'),
      R('III VII i VI'), R('VI iv v i VI iv ii v', 9), R('iv VII III VI ii v i i', 9),
      R('VI VII i v iv VI III VII'),
      // ── tripled ──
      R('VI VII i iii iv v VI VII'), R('iv VI VII i v VI III VII'), R('VI iv VII i III VI ii v', 9),
      R('iv v VI iv VII III VI VII'), R('VI III VII iv v VI i i'), R('iv VII VI v III VI ii v', 9),
      R('VI v iv III VII i VI VII'), R('iv VI i VII VI iv v i'), R('III iv v VI VII i VI VII'),
      R('VI VII iv v i VI III VII'), R('iv i v VI VII III VI VII'), R('VI iv iii v i VI ii v', 9),
      R('iv III VI VII v i VI VII'), R('VI VII v i iv v VI VII'), R('iv VI v VII i III VI VII'),
      R('III VI VII i iv v VI VII'), R('VI iv i v VI VII III i'), R('iv v i VI VII i III VII'),
      R('VI VII III iv v i VI VII'), R('iv VI VII v i VI III i'),
    ],
    bridge: [
      R('iv v VI III'), R('VI ii v i', 9), R('III VI iv v'), R('ii v i VI', 9), R('iv III VI VII'),
      // ── tripled ──
      R('iv III VI VII v i iv v'), R('VI ii v i iv v III VI', 9), R('III VII iv VI v i VI VII'),
      R('v iv III VI VII i ii v', 9), R('ii III iv v VI VII i i'), R('iv VI III VII v i VI VII'),
      R('III iv v VI ii v i i', 9), R('VI VII v iv III i ii v', 9), R('ii v VI III iv VII i i'),
      R('iv v III VI VII i VI VII'),
    ],
    extra: [
      R('i VI ii v', 9), R('i iv VII VI'), R('i VII III VI'), R('VI v iv III'),
      R('i ii III VI v iv VII i', 9), R('iv VI v i VII III VI ii', 9),
      R('i i VII VI v v iv III'), R('VI VII v i iv v VI VII'),
      // ── tripled: jazz / tension / uncommon color ──
      R('i ii III iv v VI VII i', 9), R('i VI ii v i iv VII III', 9), R('iv v i III VI ii v i', 9),
      R('i iii v VII VI iv ii i', 9), R('i VI III ii v iv VII i', 9), R('ii v i VI iv VII III i', 9),
      R('i iv ii v III VI VII i', 9), R('VI ii III v i iv VII i', 9), R('i v VII iv III VI ii i', 9),
      R('iv III ii v i VI VII i', 9), R('i VI iv ii v III VII i', 9), R('i ii v VI III iv VII i', 9),
    ],
  },
  major: {
    ground: [
      R('I V vi IV'), R('I iii vi IV'), R('vi V IV I'), R('I vi IV V'),
      R('I iii IV V I vi ii V'), R('I V vi iii IV I ii V'),
      // ── tripled ──
      R('I IV vi V'), R('I V IV vi'), R('I vi iii IV'), R('I IV V vi'), R('vi IV V I'),
      R('I iii IV vi V I ii V'), R('I V vi IV I iii ii V'), R('I ii iii IV V vi I I'),
      R('I vi V IV iii ii V I'), R('I IV I V vi iii ii V'), R('I V I vi IV V ii I'),
      R('I iii vi ii IV V I I'), R('I vi IV I iii IV V I'), R('vi ii V I IV V vi I'),
      R('I V vi iii IV V ii V'), R('I IV vi iii ii V I I'), R('I vi ii iii IV V I I'),
    ],
    lift: [
      R('vi IV I V'), R('IV I V vi'), R('vi iii IV V'), R('IV V vi iii'), R('I vi ii V vi IV I V'),
      // ── tripled ──
      R('vi V IV I'), R('IV V I vi'), R('ii V vi IV'), R('vi IV V iii'), R('IV vi I V'),
      R('vi IV I V vi IV ii V'), R('IV V I vi ii V I I'), R('vi ii V I IV V I I'),
      R('IV I vi V IV I ii V'), R('vi V I IV vi iii ii V'), R('ii IV V I vi IV I V'),
      R('IV vi V I ii V I I'), R('vi iii IV V I vi ii V'),
    ],
    bridge: [
      R('ii V I vi'), R('IV iii vi V'), R('vi ii V I'),
      // ── tripled ──
      R('ii iii IV V vi IV I I'), R('IV V iii vi ii V I I'), R('vi IV ii V I iii IV V'),
      R('ii V vi iii IV I V I'), R('iii vi IV V I ii V I'), R('IV ii V I vi iii IV V'),
      R('vi ii iii IV V I I I'),
    ],
  },
  dorian: {
    ground: [
      R('i IV i VII'), R('i ii IV i'), R('i VII IV i'), R('i IV VII ii'),
      // ── tripled ──
      R('i IV VII IV'), R('i v IV i'), R('i IV ii VII'), R('i VII v IV'), R('i IV i v'),
      R('i IV VII v i IV ii i'), R('i ii IV VII i v IV i'), R('i VII IV ii i IV VII i'),
      R('i IV v ii i VII IV i'),
    ],
    lift: [
      R('IV i VII i'), R('VII IV i i'), R('ii IV i VII'),
      // ── tripled ──
      R('IV VII i i'), R('v IV i VII'), R('IV ii i VII'), R('VII v IV i'), R('IV i v ii'),
      R('IV VII i v IV ii i i'), R('ii IV VII i v IV i i'),
    ],
  },
  // NEW modal pools (were fallback-only before) — extra vocabulary for modal songs.
  phrygian: {
    ground: [R('i II i VII'), R('i VII II i'), R('i II VII i'), R('i vii II i'), R('i II i v'), R('i II VII v II i vii i')],
    lift: [R('II i VII i'), R('VII II i i'), R('II VII i v'), R('v II i VII')],
  },
  mixolydian: {
    ground: [R('I VII IV I'), R('I v IV I'), R('I IV VII I'), R('I VII v IV'), R('I IV I VII'), R('I VII IV v I IV VII I')],
    lift: [R('IV I VII I'), R('VII IV I I'), R('IV VII I v'), R('v IV VII I')],
  },
  lydian: {
    ground: [R('I II I V'), R('I II vi V'), R('I V II I'), R('I II iii V'), R('I vi II V'), R('I II V vi iii II I I')],
    lift: [R('II I V I'), R('V II I I'), R('II vi I V'), R('vi II V I')],
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
    { kick: [0, 4, 8, 12], snare: [], hat: [2, 6, 10, 14], oh: [], clap: [4, 12] },              // stripped
    { kick: [0, 4, 8, 12], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 13, 14, 15], oh: [6, 14], clap: [4, 12] },  // busy hats
    { kick: [0, 4, 6, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], oh: [7, 15], clap: [4, 12] },  // extra kick
    { kick: [0, 4, 8, 12], snare: [12], hat: [0, 4, 8, 12], oh: [2, 6, 10, 14], clap: [4] },     // offbeat oh drive
  ],
  backbeat: [
    { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
    { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
    { kick: [0, 6, 10], snare: [4, 12], hat: [2, 6, 10, 14], oh: [], clap: [] },
    { kick: [0, 8], snare: [4, 12], hat: [0, 4, 8, 12], oh: [], clap: [] },                       // simple
    { kick: [0, 7, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },      // pushed kick
    { kick: [0, 10, 14], snare: [4, 12], hat: [2, 6, 10, 14], oh: [7], clap: [] },
    { kick: [0, 8, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [15], clap: [] },
  ],
  boombap: [
    { kick: [0, 6, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
    { kick: [0, 10, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [15], clap: [] },
    { kick: [0, 3, 8], snare: [4, 12], hat: [0, 4, 6, 8, 12, 14], oh: [7], clap: [] },
    { kick: [0, 10], snare: [4, 12], hat: [0, 3, 4, 6, 8, 11, 12, 14], oh: [15], clap: [] },      // swung hats
    { kick: [0, 6, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
    { kick: [0, 8, 10], snare: [4, 12], hat: [2, 6, 10, 14], oh: [7, 15], clap: [] },
    { kick: [0, 3, 6, 10], snare: [4, 12], hat: [0, 4, 8, 12], oh: [11], clap: [] },
  ],
  trap: [
    { kick: [0, 7, 10], snare: [8], hat: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14], oh: [], clap: [8] },
    { kick: [0, 6, 10, 11], snare: [12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [12] },
    { kick: [0, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 13, 14, 15], oh: [], clap: [8] },
    { kick: [0, 3, 10], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [8] },        // simpler
    { kick: [0, 10, 11, 12], snare: [8], hat: [0, 2, 4, 5, 6, 8, 10, 12, 13, 14], oh: [], clap: [8] },  // roll
    { kick: [0, 6, 10], snare: [12], hat: [0, 4, 8, 12], oh: [], clap: [12] },
    { kick: [0, 7, 8, 10], snare: [8], hat: [0, 2, 3, 4, 6, 8, 10, 11, 12, 14, 15], oh: [], clap: [8] },
  ],
  'half-time': [
    { kick: [0, 11], snare: [8], hat: [0, 4, 8, 12], oh: [], clap: [8] },
    { kick: [0, 6], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [8] },
    { kick: [0, 10, 11], snare: [8], hat: [0, 4, 8, 12], oh: [14], clap: [8] },
    { kick: [0], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [8] },               // minimal
    { kick: [0, 3, 8], snare: [8], hat: [2, 6, 10, 14], oh: [], clap: [8] },
    { kick: [0, 10], snare: [8], hat: [0, 4, 8, 12], oh: [14], clap: [8] },
    { kick: [0, 6, 11], snare: [8], hat: [0, 2, 4, 6, 8, 10, 12, 13, 14], oh: [], clap: [8] },
  ],
  breakbeat: [
    { kick: [0, 3, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7, 15], clap: [] },
    { kick: [0, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
    { kick: [0, 6, 10], snare: [4, 10, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [15], clap: [] },
    { kick: [0, 10], snare: [4, 12], hat: [2, 6, 10, 14], oh: [7], clap: [] },                    // spacious
    { kick: [0, 6, 10, 11], snare: [4, 10, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [15], clap: [] },
    { kick: [0, 3, 8, 10], snare: [4, 12, 14], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
    { kick: [0, 10, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [6, 15], clap: [] },
  ],
  shuffle: [
    { kick: [0, 8], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14], oh: [], clap: [] },
    { kick: [0, 6, 8], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14], oh: [11], clap: [] },
    { kick: [0, 8], snare: [4, 12], hat: [0, 3, 6, 9, 12, 15], oh: [], clap: [] },                // triplet-y
    { kick: [0, 3, 8, 11], snare: [4, 12], hat: [0, 3, 6, 9, 12, 15], oh: [], clap: [] },
    { kick: [0, 8], snare: [4, 12], hat: [3, 6, 11, 14], oh: [9], clap: [] },
    { kick: [0, 6, 8, 14], snare: [4, 12], hat: [0, 3, 6, 8, 11, 14], oh: [], clap: [] },
  ],
  syncopated: [
    { kick: [0, 3, 6, 10], snare: [4, 12], hat: [2, 6, 10, 14], oh: [7], clap: [] },
    { kick: [0, 3, 6, 10, 11], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
    { kick: [0, 6, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], clap: [] },
    { kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: [2, 6, 10, 14], oh: [], clap: [] },        // dense
    { kick: [0, 3, 10, 11], snare: [4, 12], hat: [0, 4, 8, 12], oh: [7, 15], clap: [] },
    { kick: [0, 6, 7, 10], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
  ],
  dembow: [
    { kick: [0, 6, 8, 14], snare: [4, 12], hat: [2, 6, 10, 14], oh: [], clap: [4, 12] },
    { kick: [0, 6, 8, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [3, 4, 11, 12] },
    { kick: [0, 6, 8, 14], snare: [3, 4, 11, 12], hat: [2, 6, 10, 14], oh: [], clap: [] },        // snare-led
    { kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [], clap: [] },
    { kick: [0, 6, 8, 14], snare: [4, 12], hat: [0, 4, 8, 12], oh: [7], clap: [3, 11] },
    { kick: [0, 6, 8, 10, 14], snare: [4, 12], hat: [2, 6, 10, 14], oh: [], clap: [3, 4, 11, 12] },
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
  'future-bass': { keys: 'builtin-12', bass: 'builtin-4', pad: 'builtin-30', lead: 'builtin-3', kit: 'trap808', ext: 9, bassStyle: '808', leadStyle: 'stab', keyRhythm: 'stab' },
  dnb: { keys: 'builtin-7', bass: 'builtin-4', pad: 'builtin-13', lead: 'builtin-8', kit: 'break', ext: 7, bassStyle: '808', leadStyle: 'arp', keyRhythm: 'sustain' },
  dubstep: { keys: 'builtin-7', bass: 'builtin-4', pad: 'builtin-13', lead: 'builtin-8', kit: 'traphard', ext: 0, bassStyle: '808', leadStyle: 'riff', keyRhythm: 'sustain' },
  trap: { keys: 'builtin-2', bass: 'builtin-4', pad: 'builtin-13', lead: 'builtin-8', kit: 'trap808', ext: 0, bassStyle: '808', leadStyle: 'riff', keyRhythm: 'sustain' },
  ambient: { keys: 'builtin-30', bass: 'builtin-13', pad: 'builtin-13', lead: 'builtin-43', kit: 'none', ext: 9, bassStyle: 'pedal', leadStyle: 'sustained', keyRhythm: 'sustain' },
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
  sustained: ['builtin-43', 'builtin-24', 'builtin-30', 'builtin-40', 'builtin-28', 'builtin-42'],
}
// Alternate keys / pad / bass timbres (role-appropriate), seed-picked so songs
// don't all use the one house voice per role.
const KEYS_ALTS = ['builtin-2', 'builtin-1', 'builtin-27', 'builtin-26', 'builtin-0', 'builtin-36', 'builtin-35', 'builtin-45', 'builtin-31']
// NOTE: Choir (builtin-6) and Choir Aahs (builtin-29) are intentionally NOT in the
// pad rotation — a choir sitting under a WHOLE song wears thin fast. Choir is
// instead reserved for the one-shot pre-drop SWELL (useChoirSwell) below.
const PAD_ALTS  = ['builtin-30', 'builtin-12', 'builtin-28', 'builtin-9', 'builtin-13', 'builtin-44']
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
      () => [eq(3, -1, 0), cp(-20, 3, 1), ...(heavy ? [sa(0.24)] : [])],
      () => [cp(-22, 4, 2), eq(2, -2, 0), ...(heavy ? [sa(0.28)] : [])],
      () => [sa(0.22), eq(4, 0, -1), cp(-18, 3, 1)],
      () => [eq(2, 1, -2), cp(-20, 3, 1.5), dq(120, 3)],
      () => [dq(90, 4), cp(-19, 3, 1), eq(3, -1, -1)],
    ],
    keys: [
      () => [rv(0.2, 1.8), dl(0.16, 0.5)],
      () => [eq(-1, 1, 2), rv(0.22, 2), ap(0.4)],
      () => [mo(0.35, 'chorus'), rv(0.2, 1.8)],
      () => [dl(0.2, 0.375, 0.4), rv(0.18, 1.6), ...(lofiish ? [rx(12, 15500)] : [])],
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

// ── Bass: a driving, syncopated BACKBONE — not a kick-follower ────────────────
// A motif is a 16-step rhythm template: {s:step, d:dur(steps), i:interval-from-
// root, dyad:interval to stack simultaneously|null, ghost:soft passing note}.
// The motif is the song's low-end IDENTITY (chosen once, persists across the
// track); each section only THINS or THICKENS it by energy — so the groove stays
// consistent while dynamics move, the way a real bassline anchors a song. Notes
// land off the kick (the &s, 16th pushes, ghosts) instead of on every beat, and
// dyads (root+5th / root+octave) let two notes sound at once for weight. `i:'ap'`
// = chromatic approach into the next chord's root. Everything snapped to key.
const BASS_MOTIFS = {
  // relentless 16th drive with octave weight and ghost pickups (the Artemas bed)
  drive:  [{ s: 0, d: 2, i: 0, dyad: 12 }, { s: 3, d: 1, i: 0, ghost: 1 }, { s: 4, d: 2, i: 0 }, { s: 7, d: 1, i: 0, ghost: 1 }, { s: 8, d: 2, i: 0 }, { s: 11, d: 1, i: 0, ghost: 1 }, { s: 12, d: 2, i: 0 }, { s: 14, d: 2, i: 7 }],
  // pure off-beat push — sits in the gaps between kicks, never on the 1's beat
  push:   [{ s: 2, d: 2, i: 0 }, { s: 6, d: 2, i: 7 }, { s: 9, d: 1, i: 0, ghost: 1 }, { s: 10, d: 2, i: 0 }, { s: 14, d: 2, i: 0, dyad: 12 }],
  // long root + a syncopated answer — space, breathes, dyad weight up front
  pulse:  [{ s: 0, d: 6, i: 0, dyad: 7 }, { s: 7, d: 1, i: 12, ghost: 1 }, { s: 8, d: 4, i: 0 }, { s: 13, d: 3, i: 7 }],
  // octave gallop — busy, bouncy, octave stabs land as dyads
  gallop: [{ s: 0, d: 1, i: 0, dyad: 12 }, { s: 1, d: 1, i: 12, ghost: 1 }, { s: 2, d: 2, i: 0 }, { s: 6, d: 2, i: 7 }, { s: 8, d: 1, i: 0, dyad: 12 }, { s: 9, d: 1, i: 12, ghost: 1 }, { s: 10, d: 2, i: 0 }, { s: 14, d: 2, i: 0 }],
  // walking approach into the next chord, root+5th weight on the anchors
  walk:   [{ s: 0, d: 3, i: 0, dyad: 7 }, { s: 4, d: 2, i: 3 }, { s: 8, d: 3, i: 7, dyad: 5 }, { s: 12, d: 1, i: 10, ghost: 1 }, { s: 14, d: 2, i: 'ap' }],
}
const BASS_MOTIF_FOR = { offbeat: 'push', root8: 'drive', octarp: 'gallop', walk: 'walk', rootfifth: 'pulse' }
function fillBass(clip, rand, bar0, chordRoots, style, base, root, scale, energy = 0.7, motifName = null) {
  const snap = p => snapToScale(p, root, scale)
  // Held identities keep their intentional long-note character (space layers).
  if (style === 'pedal') { chordRoots.forEach((r, b) => clip.notes.push(note(snap(r), (bar0 + b) * 4, 3.96, Math.round(base * (0.6 + 0.35 * energy))))); return }
  if (style === '808') {
    chordRoots.forEach((r, b) => { const bt = (bar0 + b) * 4; clip.notes.push(note(snap(r), bt, 3.6, Math.round(base * (0.62 + 0.4 * energy)))); if (energy >= 0.6 && rand.chance(0.5)) clip.notes.push(note(snap(r + 12), bt + 10 * STEP, 1.4, Math.round(base * 0.7))) })
    return
  }
  if (style === 'bossa') { chordRoots.forEach((r, b) => { const bt = (bar0 + b) * 4; const put = (s, d, p, v) => clip.notes.push(note(snap(p), bt + s * STEP, d * STEP, hvel(rand, v, s))); put(0, 2, r, base); put(3, 2, r + 7, base - 4); put(8, 2, r, base); put(11, 2, r + 7, base - 4) }); return }
  const M = BASS_MOTIFS[motifName || BASS_MOTIF_FOR[style] || 'drive'] || BASS_MOTIFS.drive
  const bv = Math.round(base * (0.62 + 0.42 * Math.max(0, Math.min(1, energy))))   // velocity tracks the energy arc
  chordRoots.forEach((r, b) => {
    const bt = (bar0 + b) * 4
    const nextR = chordRoots[(b + 1) % chordRoots.length]
    // Density follows energy: low sections keep only strong anchors (held), mid
    // drops the ghost pickups, peaks keep everything (+ an extra approach ghost).
    let evs = M
    if (energy < 0.4) evs = M.filter(e => !e.ghost && e.s % 8 === 0)
    else if (energy < 0.6) evs = M.filter(e => !e.ghost)
    for (const e of evs) {
      const iv = e.i === 'ap' ? (nextR - r - 1) : e.i
      const dur = energy < 0.4 ? Math.max(e.d, 4) : e.d
      const v = Math.max(26, Math.min(122, hvel(rand, bv, e.s) + (e.ghost ? -20 : 0)))
      clip.notes.push(note(snap(r + iv), bt + e.s * STEP, dur * STEP * 0.92, v))
      if (e.dyad != null && energy >= 0.5) clip.notes.push(note(snap(r + iv + e.dyad), bt + e.s * STEP, dur * STEP * 0.88, Math.max(22, v - 12)))
    }
    if (energy >= 0.85 && rand.chance(0.4)) clip.notes.push(note(snap(nextR - 2), bt + 15 * STEP, STEP * 0.8, Math.max(26, hvel(rand, bv, 15) - 24)))
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

// Truncate notes crossing `a` to end there, and drop notes starting in [a, b).
// Used by the silence/gap/false-drop moves (absolute beats).
function trimNotes(clip, a, b) {
  clip.notes = clip.notes.filter(nte => {
    const t = clip.startBeat + nte.startBeat
    if (t < a && t + nte.durationBeats > a) nte.durationBeats = +Math.max(0.05, a - t).toFixed(4)
    return !(t >= a - 1e-6 && t < b - 1e-6)
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

// ── Lead: a repeating HOOK — a real melodic phrase, not one figure per bar ────
// A hook is a 2- or 4-bar rhythmic phrase (statement bars busier, the LAST bar
// sparse so it breathes) plus a fixed STEPWISE contour (`move` = scale steps).
// fillLead applies it: strong beats anchor to a chord tone (outline the harmony),
// weak beats step through the scale — so the line is melodic AND consonant, and
// the same phrase recurs like a real hook instead of random notes.
function makeHook(rand) {
  const bars = rand.pick([2, 2, 4])
  // A MOTIF is a short contour: [slot (16th), step] where `step` is scale-degrees
  // ABOVE the bar's anchor tone. These are real melodic shapes (arch, rise-and-
  // resolve, plaintive dip) that RESOLVE near 0 — not a random walk. fillLead
  // repeats the motif each bar (re-anchored to the chord), so the line is a
  // recognizable, singable hook that develops via call/response.
  const SHAPES = [
    [[0, 0], [4, 2], [8, 1], [12, 0]],                 // gentle arch → resolve
    [[0, 0], [2, 1], [4, 2], [8, 0]],                  // quick rise → land
    [[0, 2], [4, 1], [8, 0], [10, -1]],                // fall, dips below the anchor
    [[0, 0], [3, 2], [6, 4], [10, 2], [12, 0]],        // wide arch up and back
    [[0, 0], [6, 3], [8, 2], [12, 0]],                 // leap up, step down
    [[0, 4], [4, 2], [8, 1], [12, 0]],                 // descending line
    [[0, 0], [2, -1], [6, 1], [10, 2], [12, 0]],       // dip then climb
    [[0, 1], [4, 0], [8, 2], [12, 1]],                 // syncopated, hangs on 2
    [[0, 0], [4, 0], [8, 1], [12, 0]],                 // call: repeated note, tiny lift
    [[0, 2], [3, 2], [6, 1], [8, 0], [12, -1]],        // sighing descent
  ]
  const motifA = rand.pick(SHAPES)
  let motifB = rand.pick(SHAPES)
  for (let g = 0; g < 4 && motifB === motifA; g++) motifB = rand.pick(SHAPES)
  // A per-bar DEVELOPMENT plan so the hook grows instead of looping one shape:
  //   A = statement · v = varied A (invert/transpose/retrograde/sequence) ·
  //   B = a contrasting motif · c = cadence (resolves down, thins out).
  // This is what turns "the same ascending run every bar" into a real phrase.
  const FORMS2 = [['A', 'c'], ['A', 'v'], ['A', 'B']]
  const FORMS4 = [
    ['A', 'v', 'B', 'c'],   // statement → develop → contrast → cadence (AABA-ish)
    ['A', 'A', 'B', 'c'],   // repeat, then a new idea
    ['A', 'B', 'A', 'c'],   // ABA
    ['A', 'v', 'B', 'v'],   // keep developing, no full stop
    ['A', 'B', 'v', 'c'],
  ]
  const form = bars <= 2 ? rand.pick(FORMS2) : rand.pick(FORMS4)
  const varKind = rand.pick(['invert', 'up1', 'down1', 'retro', 'seq', 'displace'])
  return { bars, motif: motifA, motifA, motifB, form, varKind, thin: rand.chance(0.3) }
}

// Develop a motif: the classic transforms (invert / transpose / retrograde /
// sequence) plus a rhythmic displace — so a repeated bar becomes a VARIATION of
// the idea, not a carbon copy. Preserves the [slot, step] shape; `step` is
// scale-degrees from the bar's anchor tone.
function varyMotif(motif, kind) {
  switch (kind) {
    case 'invert':   return motif.map(([s, st]) => [s, -st])
    case 'up1':      return motif.map(([s, st]) => [s, st + 1])
    case 'down1':    return motif.map(([s, st]) => [s, st - 1])
    case 'retro':    { const v = motif.map(m => m[1]); return motif.map(([s], i) => [s, v[motif.length - 1 - i]]) }
    case 'seq':      return motif.map(([s, st], i) => [s, st + (i >= motif.length / 2 ? 2 : 0)])
    case 'displace': return motif.map(([s, st]) => [Math.min(15, s + 2), st])
    default:         return motif
  }
}
function chordToneAt(chord, idx) {
  const n = chord.length
  const oct = Math.floor(idx / n)
  return chord[((idx % n) + n) % n] + oct * 12 + 12 // an octave up = lead register
}
// `reg` = mood register shift (semitones; darker moods sit LOWER). `motion` =
// 0..1 how busy the line is: low motion rests more, holds notes, takes smaller
// steps and stays in a tighter range — so dark/calm music isn't a constant
// high-register run. Base register lowered from +72 (≈octave 5) to +60 (≈octave
// 4), which was Brae's "always very high pitched".
function fillLead(clip, rand, bar0, chords, hook, base, style, root, scale, arpDir = 'up', rate = 2, reg = 0, motion = 0.7) {
  const steps = SCALES[scale], N = steps.length
  const degPitch = d => root + 60 + reg + steps[((d % N) + N) % N] + 12 * Math.floor(d / N)

  if (style === 'arp') {
    // Arp register follows the mood: the old fixed +12 push (on top of the +12
    // upper tones) is what read as "constantly ascending & high". Low motion
    // slows it to 8ths so it pulses rather than runs.
    const aReg = Math.max(-12, 6 + reg)
    const aRate = motion < 0.4 ? Math.max(rate, 4) : rate
    chords.forEach((chord, b) => {
      const bt = (bar0 + b) * 4
      const nn = [...chord, chord[1] + 12, chord[2] + 12].map(p => p + aReg)
      // Vary direction across bars so it isn't a wall of ascending notes: the
      // caller's arpDir seeds it, then we rotate through a small pattern (unless
      // the caller explicitly asked for updown).
      const dir = arpDir === 'updown' ? 'updown' : [arpDir, 'down', 'updown', arpDir][b % 4]
      let ord = nn
      if (dir === 'down') ord = [...nn].reverse()
      else if (dir === 'updown') ord = [...nn, ...[...nn].reverse().slice(1, -1)]
      for (let i = 0, k = 0; i < 16; i += aRate, k++) {
        // Breathe: an occasional rest so it pulses instead of running wall-to-
        // wall (more when calm), and a gentle octave lift on the bar's peak.
        if (k > 0 && rand.chance(0.1 + (1 - motion) * 0.18)) continue
        let p = ord[k % ord.length]
        if (dir !== 'down' && (k % ord.length) === ord.length - 1 && rand.chance(0.35)) p += 12
        clip.notes.push(note(p, bt + i * STEP, aRate * STEP * 0.9, hvel(rand, base - 6, i)))
      }
    })
    return
  }
  if (style === 'sustained') {
    chords.forEach((chord, b) => clip.notes.push(note(chordToneAt(chord, 2) - 12, (bar0 + b) * 4, 4 * 0.98, hvel(rand, base - 10, 0))))
    return
  }

  // melody / riff / stab: place the hook's MOTIF on each bar, re-anchored to that
  // bar's chord, so the SAME singable phrase recurs (with a call/response arc)
  // instead of a random walk. Strong beats snap to a chord tone → always in key.
  const restP = 0.04 + (1 - motion) * 0.4          // calm lines breathe more
  const lm = 1 + (1 - motion) * 0.9                // longer notes when calm
  const reach = 0.55 + motion * 0.6                // motion widens the motif's intervals
  const form = hook.form || ['A']
  chords.forEach((chord, b) => {
    const bt = (bar0 + b) * 4
    const cds = []   // chord-tone scale-degrees in the lead register
    for (let d = -2; d <= 14; d++) if (chord.some(p => ((p % 12) + 12) % 12 === ((degPitch(d) % 12) + 12) % 12)) cds.push(d)
    const snap = to => cds.reduce((a, c) => Math.abs(c - to) < Math.abs(a - to) ? c : a, cds[0])
    const barPos = b % hook.bars
    // Follow the development plan: each bar is a statement, a variation, a
    // contrasting idea, or a cadence — so the line keeps offering NEW ideas
    // instead of repeating one ascending shape.
    const op = form[barPos % form.length] || 'A'
    const last = op === 'c'
    const motif = op === 'B' ? hook.motifB
      : op === 'v' ? varyMotif(hook.motifA, hook.varKind)
      : op === 'c' ? hook.motifA.filter(([s]) => s % 4 === 0)
      : hook.motifA
    // Phrase arc: statement/contrast bars lift off a chord tone; a cadence bar
    // resolves down to the tonic-ish and thins out.
    const anchor = last ? snap(0) : snap(barPos % 2 === 0 ? 1 : 3)
    const events = [...motif].sort((a, c) => a[0] - c[0])   // variations can reorder slots
    for (let i = 0; i < events.length; i++) {
      const [slot, step] = events[i]
      const strong = slot % 8 === 0
      // Thin inner notes for space — more when calm, and on the answer/last bar.
      if (!strong && (hook.thin || last) && rand.chance(0.35 + (1 - motion) * 0.3)) continue
      if (!strong && rand.chance(restP)) continue
      let deg = anchor + Math.round(step * reach)
      if (strong || rand.chance(0.22)) deg = snap(deg)   // anchor the harmony on strong beats
      const nextSlot = i + 1 < events.length ? events[i + 1][0] : 16
      const len = (style === 'stab' ? 1 : Math.min(nextSlot - slot, 4)) * STEP * lm * 0.92
      clip.notes.push(note(degPitch(deg), bt + slot * STEP, len, hvel(rand, base - (strong ? 0 : 6), slot)))
    }
  })
}

// ── Compose ───────────────────────────────────────────────────────────────────
// ── Artist-inspired STYLES ── each biases genre + tempo + a signature flavor, in
// the SPIRIT of the artist (not a clone). `sig`: 'space' = huge reverb wash;
// 'guitar' = electric-guitar lead; 'crush' = distorted / bit-crushed grit.
const STYLES = {
  darkwave:   { genre: 'synthwave', bpm: 90,  key: 'C# minor', sig: 'space' },   // Mr. Kitty
  altpop:     { genre: 'synthwave', bpm: 118, key: 'F# minor', sig: 'guitar' },  // Artemas (dark alt-pop)
  hyperpop:   { genre: 'trap',      bpm: 156, key: 'G minor',  sig: 'crush' },    // ThxSoMuch
  phonk:      { genre: 'trap',      bpm: 130, key: 'A minor',  sig: 'crush' },
  dreampop:   { genre: 'synthwave', bpm: 104, key: 'D minor',  sig: 'space' },
  synthpop80s:{ genre: 'synthwave', bpm: 120, key: 'C minor',  sig: 'space' },   // The Weeknd — big saw lead + reverb, dorian tug
  frenchhouse:{ genre: 'disco',     bpm: 123, key: 'A minor',  sig: 'pump' },     // Daft Punk — filter disco + heavy sidechain
  futurebass: { genre: 'future-bass', bpm: 150, key: 'B minor', sig: 'space' },   // Flume — supersaw 9th chords, wide
  dubstepBig: { genre: 'dubstep',   bpm: 140, key: 'F minor',  sig: 'crush' },    // Skrillex — aggressive, distorted
  chillfuture:{ genre: 'future-bass', bpm: 100, key: 'E minor', sig: 'space' },   // ODESZA — lush, airy
}

// Score a progression's harmonic DARKNESS 0..1 from its roman numerals — high =
// sits on tonic / ♭II / ♭VI / ♭VII (dark), low = major IV / V / III lifts. Lets a
// MOOD prefer matching harmony ("darker sounds in dark music") without hand-
// tagging every recipe — the "feeling assigned to each recipe" is computed.
const DARK_W = { I: 0.3, II: 1, III: -0.8, IV: -0.7, V: -0.6, VI: 0.8, VII: 0.5 }
function recipeDarkness(rec) {
  const ch = (rec && rec.chords) || []
  let s = 0, n = 0
  for (const c of ch) { const t = c.toUpperCase().replace(/[^IV]/g, ''); if (t in DARK_W) { s += DARK_W[t]; n++ } }
  return n ? Math.max(0, Math.min(1, 0.5 + (s / n) * 0.5)) : 0.5
}
// Pick a recipe whose darkness is near `target` (mood), with some spread so it's
// not always the single closest. target null → plain random (non-template songs).
function pickByDarkness(bank, target, rand) {
  if (target == null || bank.length < 2) return rand.pick(bank)
  const scored = bank.map(r => ({ r, d: Math.abs(recipeDarkness(asRecipe(r)) - target) })).sort((a, b) => a.d - b.d)
  const top = scored.slice(0, Math.max(3, Math.ceil(scored.length * 0.4)))
  return rand.pick(top).r
}
const DEFAULT_MOOD = { leadRegister: 0, leadMotion: 0.7, leadPolicy: 'peak', bright: 1, drumEnergy: 0, darkness: null }

function compose({ GENRES, DRUM_KITS }, genreId, keyStr, seed, opts = {}) {
  const genre = GENRES.find(g => g.id === genreId)
  if (!genre) throw new Error(`unknown genre "${genreId}" — try --list`)
  const rand = makeRand(seed)
  // MOOD (from the template, else neutral) — reshapes lead register/motion/
  // presence, brightness, drum energy, and which harmony (darkness) is preferred.
  const mood = opts.mood || DEFAULT_MOOD
  const leadRegShift = mood.leadRegister || 0
  const leadMotion = mood.leadMotion ?? 0.7
  const leadPolicy = mood.leadPolicy || 'peak'
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

  // Harmony picked to match the mood's darkness (choruses lift a touch brighter).
  const darkT = mood.darkness
  const liftT = darkT == null ? null : Math.max(0, darkT - 0.15)
  const recA = pickByDarkness(groundBank, darkT, rand)
  let recB = pickByDarkness(liftBank, liftT, rand); if (recKey(recB) === recKey(recA)) recB = pickByDarkness(liftBank, liftT, rand)
  const recC = rand.pick(bridgeBank.filter(r => recKey(r) !== recKey(recA) && recKey(r) !== recKey(recB))) || rand.pick(bridgeBank)
  const progs = { A: recA, B: recB, C: recC }
  const seen = { A: 0, B: 0, C: 0 }   // section-appearance counter → development

  const form = buildForm(opts.formFamily || FORM_FAMILY[genreId] || 'loop', rand)
  // Template "lengthen": stretch each section so slow/spacious templates breathe.
  if (opts.lengthen && opts.lengthen !== 1) for (const s of form) s.bars = Math.max(2, Math.min(24, Math.round(s.bars * opts.lengthen)))
  const hook = makeHook(rand)
  let leadPreset = rand.pick(LEAD_ALTS[pal.leadStyle] || [pal.lead])
  if (opts.sig === 'guitar') leadPreset = 'builtin-15'   // electric guitar lead (Artemas)
  if (opts.presets?.lead) leadPreset = opts.presets.lead   // template variant forces a lead timbre
  const keyRhythm = KEY_RHYTHMS[pal.keyRhythm] || KEY_RHYTHMS.stab
  // Seed-vary the keys/pad/bass timbre too — mostly the genre default, sometimes
  // an alternate from the wider library, so songs draw on more of the 46 voices.
  const altTimbre = (def, arr) => rand.chance(0.5) ? def : rand.pick(arr)
  const keysPreset = opts.presets?.keys ?? altTimbre(pal.keys, KEYS_ALTS)
  const padPreset  = opts.presets?.pad  ?? altTimbre(pal.pad, PAD_ALTS)
  const bassPreset = opts.presets?.bass ?? altTimbre(pal.bass, BASS_ALTS)

  // ── Technique palette — EVERY dynamic feature is OPTIONAL and seed-gated, so
  // each song draws a DIFFERENT subset. Two songs (even same genre) should share
  // few of these: same-y makeup is the enemy. Each song still evolves its mood
  // (via whichever techniques it drew) but no two sound built the same way.
  // A TEMPLATE (opts.bias) can FORCE any of these switches to give a song-type
  // its character; `B.x ?? default` keeps the seed-driven default when unforced
  // (nullish, so a forced `false` or `0` still wins). See song-templates.mjs.
  const B = opts.bias || {}
  const useFilterArc = B.filterArc ?? rand.chance(0.7)               // per-section brightness arc
  const introStyle   = B.introStyle ?? rand.pick(['layered', 'layered', 'soft', 'soft', 'plain'])  // how the song opens
  const fourFloor    = genre.drums === 'four-floor' || ['house', 'deep-house', 'techno', 'trance', 'disco', 'future-bass'].includes(genreId)
  const useSidechain = B.sidechain ?? ((fourFloor && rand.chance(0.8)) || opts.sig === 'pump')  // kick pump on sustained layers
  const useSweeps    = B.sweeps ?? rand.chance(0.7)                  // filter-sweep transitions into peaks
  const useClipFx    = B.clipFx ?? rand.chance(0.7)                  // drawn effect BARS on the track FX lanes
  const useRolls     = B.rolls ?? rand.chance(0.45)                  // ascending chord strums on high-energy downbeats
  const voicing      = B.voicing ?? rand.pick(['close', 'close', 'inv1', 'inv2', 'open', 'drop2'])  // how chords sit
  const arpDir       = B.arpDir ?? rand.pick(['up', 'up', 'down', 'updown'])     // arp shape
  const arpRate      = B.arpRate ?? rand.pick([2, 2, 4])             // 16ths vs 8ths
  const bassMotif    = B.bassMotif !== undefined ? B.bassMotif
    : (rand.chance(0.5) ? null : rand.pick(['drive', 'drive', 'push', 'pulse', 'gallop', 'walk']))  // null → genre-idiom default; the song's low-end identity
  const useSwap      = rand.chance(0.4)                              // swap the keys timbre in the bridge
  const swapPreset   = useSwap ? rand.pick(KEYS_ALTS.filter(p => p !== keysPreset)) : null
  const humanize     = B.humanize ?? (rand.chance(0.6) ? rand.pick([0.006, 0.01, 0.015]) : 0)  // melodic timing jitter (beats)
  // ── Toolbox moves ──
  const useRiser     = B.riser ?? rand.chance(0.55)                  // ascending run into drops
  const useImpact    = B.impact ?? rand.chance(0.55)                 // sub-boom on the drop downbeat
  const useStutter   = B.stutter ?? rand.chance(0.4)                 // rapid note-repeat build in the last beat
  const useFalseDrop = B.falseDrop ?? rand.chance(0.25)              // first bar of a drop teases, full band at bar 2
  const useKeyChange = B.keyChange ?? rand.chance(0.16)              // final chorus modulates UP (a lift)
  const keyShift     = rand.pick([2, 2, 1])                          // whole step (mostly) or half step
  const peakIdx      = form.map((s, i) => (/drop|chorus|hook/.test(s.role) ? i : -1)).filter(i => i >= 0)
  // CHOIR SWELL — the ONE justified use of the choir: a single sustained "aahs"
  // chord that swells across the 2 bars before a big drop, then releases into it.
  // Reserved & seed-gated (not a whole-song pad — that wore thin). Needs a real peak.
  const useChoirSwell = rand.chance(0.4) && form.some(s => /drop|chorus|hook/.test(s.role) && s.energy >= 0.9)
  const halfTimeIdx  = ((B.halfTime ?? rand.chance(0.3)) && peakIdx.length > 1) ? peakIdx[peakIdx.length - 1] : -1  // last peak flips half-time
  const keyChangeIdx = (useKeyChange && peakIdx.length > 1) ? peakIdx[peakIdx.length - 1] : -1        // final peak lifts
  // Energy → low-pass cutoff (Hz). Steep curve: quiet parts are clearly dark,
  // peaks fully open. Bass keeps some body so it never disappears.
  const bright = mood.bright ?? 1   // dark moods keep the whole song darker
  const cutoffFor = (energy, isBass) => {
    if (!useFilterArc) return null
    const hz = Math.round(500 + Math.pow(Math.max(0, Math.min(1, energy)), 2.2) * 17500 * bright)
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
  const arpPreset = opts.presets?.arp ?? rand.pick(LEAD_ALTS.arp)
  const counterPreset = opts.presets?.counter ?? rand.pick(LEAD_ALTS.melody)
  const ROLE = {
    drums:   { name: 'Drums',   instr: kit.instrument, preset: null,          rf: null,             pan: 0,     vol: 0.6,  drum: true, fx: 'drums' },
    bass:    { name: 'Bass',    instr: NONE,           preset: bassPreset,    rf: RF.bass,          pan: 0,     vol: 0.58, fx: 'bass' },
    keys:    { name: 'Keys',    instr: NONE,           preset: keysPreset,    rf: RF.keys(pal.ext), pan: -0.12, vol: 0.46, fx: 'keys' },
    pad:     { name: 'Pad',     instr: NONE,           preset: padPreset,     rf: RF.pad,           pan: 0.14,  vol: 0.34, fx: 'pad' },
    lead:    { name: 'Lead',    instr: NONE,           preset: leadPreset,    rf: RF.lead,          pan: 0.08,  vol: 0.5,  fx: 'lead' },
    arp:     { name: 'Arp',     instr: NONE,           preset: arpPreset,     rf: RF.lead,          pan: -0.2,  vol: 0.4,  fx: 'keys' },
    counter: { name: 'Counter', instr: NONE,           preset: counterPreset, rf: RF.lead,          pan: -0.08, vol: 0.4,  fx: 'lead' },
    swell:   { name: 'Choir Swell', instr: NONE,       preset: 'builtin-29',  rf: { attack: 0.7, gain: 1.2, filterHz: 6500 }, pan: 0, vol: 0.32, fx: 'pad' },
  }
  // A TEMPLATE can supply its OWN ensemble pool (the song-type's lineup) — else
  // the seed picks from the global set.
  let ens = rand.pick(opts.roster?.ensembles || ENSEMBLES)
  // Cap voices sharing the lead register (lead/arp/counter) at TWO. The 3-voice
  // stacks were the main source of clashing, over-dense melodies in one octave.
  const leadReg = ens.filter(r => r === 'lead' || r === 'arp' || r === 'counter')
  if (leadReg.length > 2) { const drop = new Set(leadReg.slice(2)); ens = ens.filter(r => !drop.has(r)) }
  // Drums present unless the genre has none OR the template forbids them (ambient).
  const useDrums = genre.drums !== 'none' && opts.roster?.drums !== 'none'
  const roleList = [...(useDrums ? ['drums'] : []), 'bass', ...ens, ...(useChoirSwell ? ['swell'] : [])]
  const TK = roleList.map(r => ({ key: r, ...ROLE[r] }))
  const tracks = TK.map(t => ({ id: uid('t'), name: t.name, instrument: t.instr, volume: t.vol, pan: t.pan, effects: trackFx(t.fx, pal, genreId, rand, () => uid('e')) }))
  // Style signature — stamp the artist flavor onto the racks.
  if (opts.sig === 'space') for (const t of tracks) if (/Pad|Lead/.test(t.name)) { const rv = t.effects.find(e => e.type === 'reverb'); if (rv) { rv.params.wet = Math.min(0.75, rv.params.wet + 0.22); rv.params.decay = Math.max(rv.params.decay, 3.6) } else t.effects.push({ id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.5, decay: 3.8, preDelay: 0.03 } }) }
  if (opts.sig === 'crush') for (const t of tracks) if (/Bass|Lead/.test(t.name)) { if (!t.effects.some(e => e.type === 'saturator')) t.effects.unshift({ id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.32, color: 0.35, output: 0 } }); if (!t.effects.some(e => e.type === 'redux')) t.effects.push({ id: uid('e'), type: 'redux', params: { enabled: true, bitDepth: 11, sampleRate: 16000 } }) }
  if (opts.sig === 'pump') for (const t of tracks) if (/Keys|Pad/.test(t.name)) { if (!t.effects.some(e => e.type === 'chorus')) t.effects.push({ id: uid('e'), type: 'chorus', params: { enabled: true, type: 'phaser', rate: 0.4, depth: 0.5, feedback: 0.3, mix: 0.35, stages: 4 } }) }
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
  let swellDone = false   // the choir swell fires once, into the first big drop
  for (const sec of form) {
    const recipe = progs[sec.prog]
    const appearance = seen[sec.prog]++        // 0 = first time this section plays
    const e = sec.energy
    const L = layersFor(sec)
    const sparse = introStyle === 'soft' && e < 0.42        // slow, long-note treatment
    const layered = introStyle === 'layered' && sec.role === 'intro'  // staggered build-up
    const secStart = bar * 4
    // KEY-CHANGE LIFT — from the final chorus onward, shift the whole section up.
    const secRoot = (keyChangeIdx >= 0 && form.indexOf(sec) >= keyChangeIdx) ? root + keyShift : root
    if (/drop|chorus|hook/.test(sec.role) && e >= 0.9) sweepTargets.push(secStart)
    secList.push({ start: secStart, bars: sec.bars, role: sec.role, energy: e })
    // Lay the recipe across the whole section (8-bar recipe → no loop; 4-bar →
    // A + turnaround A′). Development: 2nd+ chorus gets richer extensions.
    let ext = recipe.ext ?? pal.ext
    if (sec.prog === 'B' && appearance > 0) ext = Math.max(ext, 9)
    let seq = sectionNumerals(recipe, sec.bars, appearance, scale)
    // Sparse sections hold long: reduce to the first two chords, doubled.
    if (sparse) { const a = seq[0], b = seq[Math.min(2, seq.length - 1)]; seq = Array.from({ length: sec.bars }, (_, i) => [a, b][Math.floor(i / 2) % 2]) }
    const chords = seq.map(nu => chordFor(nu, secRoot, scale, 4, ext))
    const padCh = seq.map(nu => chordFor(nu, secRoot, scale, 4, e > 0.8 ? ext : 0))
    const roots = seq.map(nu => snapToScale(rootFor(nu, secRoot, scale, 2), secRoot, scale))

    const peak = /chorus|hook|drop/.test(sec.role)
    // LAYERED INTRO — elements enter one at a time (whatever roles this ensemble
    // has): a sustained layer from the top, bass a quarter in, filtered hats
    // halfway, a chordy layer three-quarters in — then the section hits full.
    if (layered) {
      // ENTRY-ORDER SYSTEM — instead of the same pad→bass→drums→keys stack every
      // song, shuffle which layer FOUNDS the intro and stagger the rest at
      // randomized bars (sometimes two enter together). Once a layer is in, it
      // runs to the end of the intro, so the groove stays consistent as it builds.
      const renderEntry = (role, sb) => {
        const remBars = sec.bars - sb
        if (remBars < 1) return
        const st = secStart + sb * 4
        if (role === 'pad') { const c = secClip('pad', st, remBars, e * 0.85); fillPadLong(c, rand, 0, padCh.slice(sb), 42); push(c) }
        else if (role === 'keys') { const c = secClip('keys', st, remBars, Math.min(e, 0.6)); fillChords(c, rand, 0, chords.slice(sb), keyRhythm, 52, null, false, 0, voicing); push(c) }
        else if (role === 'arp') { const c = secClip('arp', st, remBars, Math.min(e, 0.6)); fillLead(c, rand, 0, chords.slice(sb), hook, 50, 'arp', secRoot, scale, arpDir, arpRate, leadRegShift, leadMotion); push(c) }
        else if (role === 'bass') { const c = secClip('bass', st, remBars, 0.5); fillBass(c, rand, 0, roots.slice(sb), pal.bassStyle, 68, secRoot, scale, 0.5, bassMotif); push(c) }
        else if (role === 'drums') { const c = secClip('drums', st, remBars, 0.55); fillDrums(c, rand, 0, remBars, { kick: [], snare: [], hat: feel.hat, oh: [], clap: [] }, { energy: 0.6, role: 'intro' }); push(c) }
      }
      const tonal = ['pad', 'keys', 'arp'].filter(has)
      const foundation = tonal.length ? rand.pick(tonal) : (has('bass') ? 'bass' : null)
      const rest = ['pad', 'keys', 'arp', 'bass'].filter(r => has(r) && r !== foundation)
      if (has('drums') && genre.drums !== 'none') rest.push('drums')
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]] }   // shuffle
      const maxBar = Math.max(1, sec.bars - 1)
      const slots = []; let cursor = 1
      for (let i = 0; i < rest.length; i++) {
        let bStart = Math.min(maxBar, cursor)
        if (i > 0 && rand.chance(0.25)) bStart = slots[i - 1]   // two layers arrive together
        slots.push(bStart)
        cursor = Math.min(maxBar, bStart + rand.pick([1, 2, 2]))
      }
      if (foundation) renderEntry(foundation, 0)
      rest.forEach((r, i) => renderEntry(r, slots[i]))
      bar += sec.bars
      continue
    }

    // Drums
    const halfTime = form.indexOf(sec) === halfTimeIdx
    const de = Math.max(0, Math.min(1, e + (mood.drumEnergy || 0)))   // mood calms/energizes the kit
    if (has('drums') && genre.drums !== 'none') {
      if (L.drums) { const c = secClip('drums', secStart, sec.bars, de); fillDrums(c, rand, 0, sec.bars, feel, { ...sec, energy: de, halfTime }); push(c) }
      else if (L.softDrums) { const c = secClip('drums', secStart, sec.bars, Math.min(de, 0.5)); fillDrums(c, rand, 0, sec.bars, feel, { ...sec, energy: Math.min(de, 0.5), breakdown: true }); push(c) }
    }
    // Bass
    if (has('bass') && L.bass) { const c = secClip('bass', secStart, sec.bars, e); fillBass(c, rand, 0, roots, sparse ? 'pedal' : pal.bassStyle, 78, secRoot, scale, e, bassMotif); push(c) }
    // Keys — rhythmic chords (voiced per the song's voicing; swaps timbre in the
    // bridge for a mid-song "development" when this song drew useSwap).
    if (has('keys') && e >= 0.45 && !sparse) { const c = secClip('keys', secStart, sec.bars, e, sec.role === 'bridge' ? swapPreset : null); fillChords(c, rand, 0, chords, keyRhythm, Math.round(44 + e * 30), null, false, useRolls && e >= 0.85 ? rand.pick([0.035, 0.05, 0.065]) : 0, voicing); humanizeClip(c, humanize, rand); push(c) }
    // Arp — a rolling 16th layer, its own track when the ensemble has one. Mood
    // register/motion keep it from being a constant high ascending run.
    if (has('arp') && e >= 0.5 && !sparse && leadPolicy !== 'none') { const c = secClip('arp', secStart, sec.bars, e); fillLead(c, rand, 0, chords, hook, 54, 'arp', secRoot, scale, arpDir, arpRate, leadRegShift, leadMotion); humanizeClip(c, humanize, rand); push(c) }
    // Pad — held long when sparse
    if (has('pad')) { const c = secClip('pad', secStart, sec.bars, sparse ? e * 0.85 : e)
      if (sparse) fillPadLong(c, rand, 0, padCh, 42)
      else fillChords(c, rand, 0, padCh, KEY_RHYTHMS.sustain, e > 0.5 ? 48 : 40, 16, true, 0, voicing)
      push(c) }
    // Choir SWELL — one held "aahs" chord across the 2 bars BEFORE this drop,
    // releasing into the downbeat. Fires once, into the first real peak, on its
    // own track (the choir's slow attack does the crescendo). Tension → release.
    if (has('swell') && !swellDone && peak && e >= 0.9 && secStart >= 8) {
      const c = secClip('swell', secStart - 8, 2, 0.75)
      for (const p of voiceChord(chords[0], 'close').slice(0, 4)) c.notes.push(note(p, 0, 8 * 0.97, 72))
      push(c)
      swellDone = true
    }
    // Lead — melody at peaks, register/motion set by the mood. leadPolicy governs
    // presence: 'none' = no lead at all; 'sparse' = peaks only (calm); 'peak' =
    // peaks; 'featured' = peaks + an arp fallback during builds. (Brae: many songs
    // are better with little or no lead — dark/chill moods default to sparse/none.)
    if (has('lead') && !sparse && leadPolicy !== 'none') {
      if (peak && e >= 0.85) { const c = secClip('lead', secStart, sec.bars, e); fillLead(c, rand, 0, chords, hook, 66, pal.leadStyle, secRoot, scale, arpDir, arpRate, leadRegShift, leadMotion); humanizeClip(c, humanize, rand); push(c) }
      else if (leadPolicy === 'featured' && !has('arp') && (sec.build || (/chorus|drop/.test(sec.role) && e >= 0.9))) { const c = secClip('lead', secStart, sec.bars, e); fillLead(c, rand, 0, chords, hook, 56, 'arp', secRoot, scale, arpDir, arpRate, leadRegShift, leadMotion); push(c) }
    }
    // Counter — a second melodic line at peaks (its own hook, lower register)
    if (has('counter') && peak && e >= 0.9 && !sparse && leadPolicy !== 'none') { const c = secClip('counter', secStart, sec.bars, e); fillLead(c, rand, 0, chords, hook2, 48, 'melody', secRoot, scale, 'up', 2, leadRegShift - 5, leadMotion * 0.8); humanizeClip(c, humanize, rand); push(c) }
    bar += sec.bars
  }
  const totalBeats = bar * 4

  // ── Toolbox transitions into drops ── seed-gated: an ascending RISER run, a
  // sub-boom IMPACT, a rapid-repeat STUTTER in the last beat, and a FALSE-DROP
  // (bar 1 teases with one layer, full band on bar 2).
  if (useRiser || useImpact || useStutter || useFalseDrop) {
    const steps = SCALES[scale], NN = steps.length
    for (let i = 1; i < secList.length; i++) {
      const cur = secList[i], prev = secList[i - 1]
      if (!(/drop|chorus|hook/.test(cur.role) && cur.energy >= 0.9) || cur.energy - prev.energy < 0.15 || cur.start < 4) continue
      const S = cur.start
      // A riser is a build-into-drop device — out of place (and too high) in calm
      // or dark music, so only fire it when the mood actually moves. Lowered base +
      // capped octave so it doesn't scream up to the top of the register.
      if (useRiser && leadMotion >= 0.45) {
        const rRole = ['arp', 'lead', 'keys'].find(has)
        if (rRole) { const c = secClip(rRole, S - 4, 4, 0.75); for (let k = 0; k < 16; k++) { const d = k + 2; c.notes.push(note(root + 48 + leadRegShift + steps[((d % NN) + NN) % NN] + 12 * Math.min(1, Math.floor(d / NN)), k * STEP, STEP * 0.9, Math.min(122, 48 + k * 5))) } push(c) }
      }
      if (useStutter) {
        const stRole = ['keys', 'arp', 'lead'].find(has)
        if (stRole) { const c = secClip(stRole, S - 1, 1, 0.7); const reps = rand.pick([6, 8, 8, 12]); const p = root + 60 + leadRegShift + steps[0]; for (let k = 0; k < reps; k++) c.notes.push(note(p, k * (1 / reps), (1 / reps) * 0.9, Math.min(120, 55 + Math.round(k * 55 / reps)))); push(c) }
      }
      if (useImpact && has('bass')) { const c = secClip('bass', S, 1, cur.energy); c.notes.push(note(root + 24, 0, 1.5 * 0.98, 116)); push(c) }
      if (useFalseDrop && cur.bars >= 2) { const keep = tid[['lead', 'keys', 'arp'].find(has) || 'lead']; for (const c of clips) if (c.trackId !== keep) trimNotes(c, S, S + 4) }
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

  // ── INVARIANT: no two clips overlap on the same track ────────────────────────
  // Toolbox/pressure moves can drop a short clip (impact, riser, stutter) onto a
  // track that already carries a section clip there. Rather than leave two
  // stacked arrangement items, merge the later clip's notes into the earlier one
  // (as a dyad/overlay) and keep a single clip per region. Also drop emptied clips.
  {
    const byTrack = {}
    for (const c of clips) (byTrack[c.trackId] ||= []).push(c)
    const kept = []
    for (const tId in byTrack) {
      const cs = byTrack[tId].sort((a, b) => a.startBeat - b.startBeat)
      let cur = null
      for (const c of cs) {
        if (cur && c.startBeat < cur.startBeat + cur.durationBeats - 1e-6) {
          const off = c.startBeat - cur.startBeat
          for (const nte of c.notes) cur.notes.push({ ...nte, startBeat: +(nte.startBeat + off).toFixed(4) })
          cur.durationBeats = +Math.max(cur.durationBeats, c.startBeat + c.durationBeats - cur.startBeat).toFixed(4)
        } else { cur = c; kept.push(c) }
      }
    }
    clips.length = 0
    for (const c of kept) if (c.notes.length) clips.push(c)
    clips.sort((a, b) => a.startBeat - b.startBeat || a.trackId.localeCompare(b.trackId))
  }

  const keyLabel = modeName ? `${KEY_NAMES[root]} ${scale}` : (keyStr || `${KEY_NAMES[root]} ${scale}`)
  const label = opts.templateName
    ? `${opts.templateName}${opts.variantName ? ` (${opts.variantName})` : ''} · ${genre.name} — ${keyLabel}`
    : `${opts.styleName ? opts.styleName + ' · ' : ''}${genre.name} — ${keyLabel}`
  const moodTag = opts.moodName ? ` mood:${opts.moodName}(lead:${leadPolicy}/reg${leadRegShift}/mo${leadMotion})` : ''
  return {
    name: label,
    genre: genre.id, tempo: opts.tempo || genre.bpm, timeSignatureNum: 4, timeSignatureDen: 4,
    swing: genre.swing, key: root, scale,
    masterVolume: 0.5, tracks, clips, automationLanes, clipEffects,
    _form: form.map(s => s.role).join(' · '),
    _tracks: roleList.join('+'),
    _features: `intro:${introStyle} filterArc:${useFilterArc ? 'on' : 'off'} sidechain:${useSidechain ? 'on' : 'off'} sweep:${automationLanes.length ? sweepRole + '/' + sweepMode : 'off'} clipFx:${clipEffects.length} rolls:${useRolls ? 'on' : 'off'} voicing:${voicing} arp:${arpDir}/${arpRate === 2 ? '16th' : '8th'} bass:${bassMotif || BASS_MOTIF_FOR[pal.bassStyle] || 'drive'} swap:${useSwap ? 'on' : 'off'} human:${humanize ? 'on' : 'off'}${modeName ? ' mode:' + modeName : ''} tension:[${dyn.join(',') || 'straight'}] riser:${useRiser ? 'on' : 'off'} impact:${useImpact ? 'on' : 'off'} stutter:${useStutter ? 'on' : 'off'} falseDrop:${useFalseDrop ? 'on' : 'off'} halfTime:${halfTimeIdx >= 0 ? 'on' : 'off'} keyChange:${keyChangeIdx >= 0 ? '+' + keyShift : 'off'} choirSwell:${useChoirSwell ? 'on' : 'off'}${moodTag}`,
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2)
  const libs = await loadAppLibs()
  if (argv.includes('--templates')) {
    console.log('Song templates (id — character · variants):')
    for (const [id, t] of Object.entries(TEMPLATES)) {
      console.log(`  ${id.padEnd(14)} ${t.desc}`)
      console.log(`  ${''.padEnd(14)} variants: ${Object.keys(t.variants || {}).join(', ')}  ·  genres: ${t.genres.join(', ')}`)
    }
    console.log('\nUsage: node scripts/compose.mjs --template=<id> [--tvariant=<name>] [--genre=<id>] [key] [--seed=N] [--out=path]')
    return
  }
  if (argv.includes('--list') || argv.length === 0) {
    console.log('Genres (id · bpm · feel):')
    for (const g of libs.GENRES) console.log(`  ${g.id.padEnd(13)} ${String(g.bpm).padStart(3)} bpm · ${g.drums}`)
    console.log('\nUsage: node scripts/compose.mjs <genreId> [key] [--seed=N] [--out=path]')
    console.log('       node scripts/compose.mjs --templates          (song-type templates)')
    return
  }
  const pos = argv.filter(a => !a.startsWith('--'))
  const seedArg = argv.find(a => a.startsWith('--seed='))
  const outArg = argv.find(a => a.startsWith('--out='))
  const styleArg = argv.find(a => a.startsWith('--style='))
  const templateArg = argv.find(a => a.startsWith('--template='))
  const tvariantArg = argv.find(a => a.startsWith('--tvariant='))
  const tgenreArg   = argv.find(a => a.startsWith('--genre='))
  const seed = seedArg ? parseInt(seedArg.split('=')[1], 10) : 12345
  let genreId = pos[0], keyStr = pos[1] || '', opts = {}

  // TEMPLATE mode: a song-type reshapes structure/roster/dynamics/mix, then
  // draws a genre from its pool. Resolved PER-SEED so --best=K explores variants
  // and genres too (a fresh rand off each candidate's seed). See song-templates.mjs.
  const tplId = templateArg ? templateArg.split('=')[1] : null
  if (tplId && !TEMPLATES[tplId]) { console.error(`unknown template "${tplId}" — try: ${Object.keys(TEMPLATES).join(', ')} (or --templates)`); process.exit(1) }
  const tvariant = tvariantArg ? tvariantArg.split('=')[1] : undefined
  const tgenre   = tgenreArg ? tgenreArg.split('=')[1] : undefined   // genre pinned ONLY via --genre
  // In --template mode the first positional is the KEY (there is no genre
  // positional); the genre comes from --genre or the template's own pool.
  if (tplId) keyStr = pos[0] || ''
  const resolveForSeed = (seedUsed) => {
    if (tplId) {
      const res = resolveTemplate(tplId, makeRand(seedUsed), { variant: tvariant, genre: tgenre })
      return { genreId: res.genreId, opts: res.opts }
    }
    return { genreId, opts }
  }

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

  // Session capture (opt-in via --capture[=root]): emit a self-contained artifact
  // directory for this generation run. Each candidate is a "take"; the self-select
  // rejections carry a real natural-language reason + what the next take changed.
  const captureArg = argv.find(a => a.startsWith('--capture'))
  const cap = createSession({
    enabled: !!captureArg,
    root: captureArg && captureArg.includes('=') ? captureArg.split('=')[1] : undefined,
    sessionId: `compose-${tplId || genreId}-${seed}`,
  })

  let spec, pick = null
  const cands = []
  try {
    for (let i = 0; i < K; i++) {
      const seedUsed = seed + i * 7919
      if (i > 0) cap.event('retry', {
        reason: `best take so far scores ${pick.r.score}/100 with ${pick.r.flags.length} arrangement flag(s) — searching for a more dynamic take`,
        changed: `re-rolled with seed ${cands[i - 1].seedUsed} → ${seedUsed}: new form / progressions / hook motif / timbres (seed-driven variety)`,
        attempt: i,
      })
      cap.event('take_started', { index: i, seed: seedUsed })
      const r0 = resolveForSeed(seedUsed)
      const s = compose(libs, r0.genreId, keyStr, seedUsed, r0.opts)
      const r = analyzeSpec(s)
      const rank = r.score - r.flags.length * 10
      const c = { i, seedUsed, spec: s, r, rank }
      cands.push(c)
      cap.event('arrangement_change', { index: i, seed: seedUsed, score: r.score, bars: r.bars, densityCV: r.cv, sparkline: r.spark.density })
      if (!pick || rank > pick.rank) pick = { spec: s, r, rank, seedUsed, i }
    }
    spec = pick.spec

    // Emit the accept/reject decisions, each with a concrete reason.
    for (const c of cands) {
      if (c.i === pick.i) continue
      const gap = pick.r.score - c.r.score
      const nextC = cands.find(x => x.i === c.i + 1)
      cap.event('take_rejected', {
        index: c.i, seed: c.seedUsed, score: c.r.score, flags: c.r.flags,
        reason: (c.r.flags.length ? `${c.r.flags.length} arrangement flag(s): ${c.r.flags.slice(0, 2).join(' · ')}. ` : 'clean, but ')
          + `dynamic score ${c.r.score}/100 vs kept ${pick.r.score}/100${gap > 0 ? ` (−${gap})` : ''}`,
        changed: nextC
          ? `next take re-rolled seed ${c.seedUsed} → ${nextC.seedUsed} (new form/progression/motif)`
          : `kept take ${pick.i} (seed ${pick.seedUsed}) — highest dynamic score`,
      })
    }
    cap.event('take_completed', { index: pick.i, seed: pick.seedUsed, score: pick.r.score, flags: pick.r.flags, sparkline: pick.r.spark.density })
  } catch (err) {
    cap.fail(err)
    throw err
  }
  if (K > 1) console.log(`  self-select: best of ${K} — seed ${pick.seedUsed} · score ${pick.r.score}/100 · ${pick.r.flags.length} flag(s) · density ${pick.r.spark.density}`)
  const nNotes = spec.clips.reduce((a, c) => a + c.notes.length, 0)
  const end = Math.max(...spec.clips.map(c => c.startBeat + c.durationBeats), 0)
  const slug = `${tplId ? tplId + '-' : ''}${styleArg ? styleArg.split('=')[1] + '-' : ''}${spec.genre}-${(keyStr || spec.scale).replace(/\s+/g, '')}`.toLowerCase()
  const out = outArg ? outArg.split('=')[1] : join(OUT_DIR, `${slug}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(spec))
  const durationSec = +(end / spec.tempo * 60).toFixed(2)

  // Finalize the capture session (no-op unless --capture was passed). The
  // composer is headless — no video, no bounce — so capture/audio stay null;
  // the event log + reasons + musical/generation metadata are the payload.
  cap.event('render', { out: out.replace(ROOT + '/', ''), notes: nNotes, durationSec })
  cap.setMusical({
    bpm: spec.tempo,
    key: keyStr || spec.scale || null,
    time_signature: '4/4',
    genre_tags: [spec.genre, ...(styleArg ? [styleArg.split('=')[1]] : [])],
    instrument_list: spec.tracks.map(t => t.name),
  })
  cap.setGeneration({ model: 'compose.mjs', prompt_or_seed: seed, total_takes: K, rejected_takes: K - 1 })
  cap.writeArtifact('spec.json', JSON.stringify(spec))
  const sessDir = cap.end('completed')

  console.log(`${spec.name}`)
  console.log(`  ${spec.tempo} bpm · swing ${spec.swing} · form: ${spec._form}`)
  console.log(`  tracks: ${spec._tracks}`)
  console.log(`  fx: ${spec._features}`)
  console.log(`  ${spec.tracks.length} tracks · ${nNotes} notes · ${(end / spec.tempo * 60).toFixed(0)}s → ${out}`)
  if (sessDir) console.log(`  session → ${sessDir}`)
}
main().catch(e => { console.error(e.message || e); process.exit(1) })
