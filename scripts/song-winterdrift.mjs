// "Winter Drift" — D minor, 140 BPM. Baroque harmony over a drift/phonk beat.
//
// An original piece written in that character, not a version of anything: the
// harmony is a device rather than a tune, and every note here is mine.
//
// THE DEVICE. Baroque music leans on the descending circle of fifths, and this
// is one: i – iv – ♭VII – ♭III – ♭VI – ii° – V – i in D minor, a bar each. Every
// chord falls a fifth to the next, so the whole eight bars are one long descent
// that lands back home — the same engine under a great deal of 18th-century
// music, and it carries a loop without anything playing a melody over it. The
// diminished ii° in bar six is the moment it tilts.
//
// The other half of the idea is the collision: close-position string writing and
// a harpsichord figure over a half-time beat with a cowbell on it. The strings
// play chords, the harpsichord plays a fixed broken-chord contour — texture, not
// a phrase — so this stays inside the no-lead rule.
//
// THE ARC. 64 bars, about 1:50. Strings alone, then the low end, then the beat;
// everything percussive leaves at "Hollow"; the cowbell only shows up once the
// groove is established, and the last eight bars are strings again.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, rng, feel, N, assemble, dipInto, lift, bar } from './song-kit.mjs'
import { strings, harpsi, subBass, cowbell, kick, snare, hatDual } from './apollo-voices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
mkdirSync(OUT_DIR, { recursive: true })
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 140, BPB = 4
const rand = rng(3391)
const { jitter, vary, chance } = feel(rand, BPM)

// ── The circle of fifths, one bar per chord ─────────────────────────────────
// Close-position triads, the way strings would actually voice them.
const Dm   = { name: 'Dm',   voicing: [62, 65, 69], bass: 38, sub: 38, arp: [62, 65, 69, 74] }
const Gm   = { name: 'Gm',   voicing: [62, 67, 70], bass: 43, sub: 31, arp: [62, 67, 70, 74] }
const C    = { name: 'C',    voicing: [60, 64, 67], bass: 36, sub: 36, arp: [60, 64, 67, 72] }
const F    = { name: 'F',    voicing: [60, 65, 69], bass: 41, sub: 29, arp: [60, 65, 69, 72] }
const Bb   = { name: 'Bb',   voicing: [58, 62, 65], bass: 34, sub: 34, arp: [58, 62, 65, 70] }
const Edim = { name: 'Edim', voicing: [64, 67, 70], bass: 40, sub: 28, arp: [64, 67, 70, 76] }
const A7   = { name: 'A7',   voicing: [61, 64, 67], bass: 33, sub: 33, arp: [61, 64, 67, 73] }
const Dm2  = { name: 'Dm',   voicing: [62, 65, 69], bass: 38, sub: 26, arp: [62, 65, 69, 74] }

const LOOP = [Dm, Gm, C, F, Bb, Edim, A7, Dm2]

// ── Parts ───────────────────────────────────────────────────────────────────
// Bowed and held: one chord per bar, struck on the downbeat.
const stringBar = (ch, velocity = 54, octave = 0) =>
  ch.voicing.map((p, i) => N(p + octave, 0 + jitter(16) + i * 0.02, BPB - 0.15, vary(velocity - i * 3, 5)))

// A fixed broken-chord contour: texture, not a phrase. Nothing here leans.
const FIGURE = [0, 1, 2, 3, 2, 1, 0, 1]
const harpsiBar = (ch, { velocity = 58, sixteenths = false, octave = 0 } = {}) => {
  const steps = sixteenths ? 16 : 8
  return Array.from({ length: steps }, (_, i) => {
    const tone = ch.arp[FIGURE[i % FIGURE.length] % ch.arp.length]
    return N(tone + octave, i * (BPB / steps) + jitter(7), (BPB / steps) * 0.85,
      vary(velocity + (i % (steps / 4) === 0 ? 10 : 0), 8))
  })
}

const subBar = (ch, velocity = 92) => [N(ch.sub, 0 + jitter(5), BPB - 0.2, vary(velocity, 4))]

// ── Drums: half-time drift ──────────────────────────────────────────────────
const KICK = 24, SNARE = 48, HAT = 60, BELL = 72
const LATE = 12 / 1000 * (BPM / 60)

const kickBar = ({ extra = false } = {}) => {
  const out = [N(KICK, 0 + jitter(4), 0.5, vary(112, 4))]
  if (extra) out.push(N(KICK, 2.75 + jitter(5), 0.45, vary(92, 8)))
  return out
}
// Half-time: the backbeat lands on 3, once a bar. At 140 that is what makes it
// drift rather than run.
const snareBar = ({ fill = false } = {}) => {
  const out = [N(SNARE, 2 + LATE + jitter(4), 0.35, vary(106, 4))]
  if (fill) for (const b of [3.25, 3.5, 3.75]) out.push(N(SNARE, b + jitter(4), 0.2, vary(72 + (b - 3.25) * 70, 7)))
  return out
}
const hatBar = ({ rolls = false } = {}) => {
  const out = []
  for (let i = 0; i < 16; i++) {
    if (i % 2 === 1 && !chance(0.5)) continue
    out.push(N(HAT, i * 0.25 + jitter(5), 0.07, vary(i % 4 === 0 ? 60 : 40, 9)))
  }
  if (rolls && chance(0.6)) for (let i = 0; i < 6; i++) out.push(N(HAT, 3 + i * 0.125 + jitter(3), 0.05, vary(34 + i * 5, 6)))
  return out
}
/** The cowbell figure — syncopated, never on the downbeat. */
const bellBar = (ch, { velocity = 66 } = {}) => [
  N(BELL, 0.75 + jitter(6), 0.1, vary(velocity, 7)),
  N(BELL, 1.5 + jitter(6), 0.1, vary(velocity - 12, 7)),
  N(BELL, 3.25 + jitter(6), 0.1, vary(velocity - 6, 7)),
]

function section(bars, layers) {
  const parts = { strings: [], harpsi: [], sub: [], kick: [], snare: [], hats: [], bell: [] }
  for (let i = 0; i < bars; i++) {
    const ch = LOOP[i % LOOP.length]
    const at = (notes, target) => notes.forEach(n => parts[target].push({ ...n, startBeat: i * BPB + n.startBeat }))
    const ctx = { i, ch, last: i === bars - 1 }
    for (const key of Object.keys(parts)) if (layers[key]) at(layers[key](ctx), key)
  }
  return parts
}

export function build() {
  const tracks = [
    { key: 'sub',     id: uid(), name: 'Sub',     presetId: null, volume: 0.60, color: '#64748b',
      instrument: { type: 'apollo', params: subBass() } },
    { key: 'strings', id: uid(), name: 'Strings', presetId: null, volume: 0.40, pan: -0.08, color: '#94a3b8',
      instrument: { type: 'apollo', params: strings() } },
    { key: 'harpsi',  id: uid(), name: 'Harpsichord', presetId: null, volume: 0.30, pan: 0.14, color: '#cbd5e1',
      instrument: { type: 'apollo', params: harpsi() } },
    { key: 'kick',    id: uid(), name: 'Kick',    presetId: null, volume: 0.54, color: '#475569',
      instrument: { type: 'apollo', params: kick() } },
    { key: 'snare',   id: uid(), name: 'Snare',   presetId: null, volume: 0.30, color: '#52525b',
      instrument: { type: 'apollo', params: snare() } },
    { key: 'hats',    id: uid(), name: 'Hats',    presetId: null, volume: 0.18, pan: 0.2, color: '#a1a1aa',
      instrument: { type: 'apollo', params: hatDual() } },
    { key: 'bell',    id: uid(), name: 'Cowbell', presetId: null, volume: 0.22, pan: -0.2, color: '#e4e4e7',
      instrument: { type: 'apollo', params: cowbell() } },
  ]

  const sections = [
    // 1. Adagio — the sequence stated by the strings alone.
    { name: 'Adagio', bars: 8, parts: section(8, {
        strings: ({ ch, i }) => stringBar(ch, i < 4 ? 44 : 54),
      }) },

    // 2. Enter — the low end arrives, then the kick. Still no backbeat.
    { name: 'Enter', bars: 8, parts: section(8, {
        strings: ({ ch }) => stringBar(ch, 54),
        sub:     ({ ch }) => subBar(ch, 86),
        kick:    ({ i }) => i >= 4 ? kickBar() : [],
        harpsi:  ({ ch, i }) => i >= 6 ? harpsiBar(ch, { velocity: 46 }) : [],
      }) },

    // 3. Drift A — half-time beat, harpsichord running underneath.
    { name: 'Drift A', bars: 12, parts: section(12, {
        strings: ({ ch }) => stringBar(ch, 50),
        harpsi:  ({ ch }) => harpsiBar(ch, { velocity: 56 }),
        sub:     ({ ch }) => subBar(ch),
        kick:    ({ i }) => kickBar({ extra: i % 4 === 3 }),
        snare:   ({ last }) => snareBar({ fill: last }),
        hats:    () => hatBar(),
      }) },

    // 4. Hollow — the beat drops out entirely. Strings and harpsichord, bare.
    { name: 'Hollow', bars: 8, parts: section(8, {
        strings: ({ ch }) => stringBar(ch, 58),
        harpsi:  ({ ch, i }) => i >= 2 ? harpsiBar(ch, { velocity: 44 }) : [],
        sub:     ({ ch, i }) => i < 5 ? subBar(ch, 74) : [],
      }) },

    // 5. Drift B — back in, and the cowbell finally appears.
    { name: 'Drift B', bars: 12, parts: section(12, {
        strings: ({ ch }) => stringBar(ch, 52),
        harpsi:  ({ ch }) => harpsiBar(ch, { velocity: 58 }),
        sub:     ({ ch }) => subBar(ch),
        kick:    ({ i }) => kickBar({ extra: i % 2 === 1 }),
        snare:   ({ i, last }) => snareBar({ fill: last || i === 5 }),
        hats:    () => hatBar({ rolls: true }),
        bell:    ({ i }) => i >= 2 ? bellBar(LOOP[i % 8]) : [],
      }) },

    // 6. Peak — the only place the harpsichord runs sixteenths and the strings
    //    double an octave up.
    { name: 'Peak', bars: 8, parts: section(8, {
        strings: ({ ch, i }) => [...stringBar(ch, 56), ...stringBar(ch, i < 2 ? 30 : 38, 12)],
        harpsi:  ({ ch }) => harpsiBar(ch, { velocity: 60, sixteenths: true }),
        sub:     ({ ch }) => subBar(ch, 98),
        kick:    () => kickBar({ extra: true }),
        snare:   ({ last }) => snareBar({ fill: last }),
        hats:    () => hatBar({ rolls: true }),
        bell:    (c) => bellBar(c.ch, { velocity: 72 }),
      }) },

    // 7. Out — back to where it started and let the sequence finish alone.
    { name: 'Out', bars: 8, parts: section(8, {
        strings: ({ ch, i }) => stringBar(ch, Math.max(22, 54 - i * 4)),
        harpsi:  ({ ch, i }) => i < 3 ? harpsiBar(ch, { velocity: 38 }) : [],
        sub:     ({ ch, i }) => i < 4 ? subBar(ch, Math.max(56, 84 - i * 8)) : [],
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  const fxBars = [
    dipInto('harpsi', at['Drift A'], 2), dipInto('strings', at['Drift A'], 2),
    dipInto('harpsi', at['Drift B'], 2), dipInto('sub', at['Drift B'], 2),
    dipInto('strings', at['Peak'], 3), dipInto('harpsi', at['Peak'], 3), dipInto('hats', at['Peak'], 3),

    // The strings open across the opening statement.
    bar('strings', at['Adagio'], 8 * BPB, { filterHz: 560 },
        [[0, 1], [8 * BPB * 0.65, 0.3], [8 * BPB, 0]], 1),

    // Hollow: dark and ducked, opening again on the way out.
    bar('strings', at['Hollow'], 8 * BPB, { filterHz: 620, gain: 0.84 },
        [[0, 0], [5, 1], [8 * BPB - 6, 1], [8 * BPB, 0.12]], 1),
    bar('harpsi', at['Hollow'], 8 * BPB, { filterHz: 700 },
        [[0, 0.2], [6, 1], [8 * BPB, 0.4]], 1),

    lift('harpsi', at['Peak'], 8 * BPB, { drive: 0.04, gain: 1.06 }),
    lift('sub', at['Peak'], 8 * BPB, { drive: 0.05, gain: 1.04 }),
    lift('kick', at['Peak'], 8 * BPB, { drive: 0.03, gain: 1.03 }),

    bar('strings', at['Out'], 8 * BPB, { filterHz: 540, gain: 0.6 },
        [[0, 0], [8 * BPB * 0.5, 0.55], [8 * BPB, 1]], 1),
  ]

  return assemble({
    name: 'Winter Drift', bpm: BPM, bpb: BPB, key: 'D', scale: 'minor', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.34,
  })
}

const out = build()
const label = 'Winter Drift'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))
console.log(`▸ "${label}" · ${BPM} BPM · D minor · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
for (const t of out.project.dawProject.tracks) {
  const clips = out.project.dawProject.arrangementClips.filter(c => c.trackId === t.id)
  console.log(`  ${t.name.padEnd(12)} ${String(clips.length).padStart(2)} clips / ${String(clips.reduce((n, c) => n + c.notes.length, 0)).padStart(4)} notes`)
}
console.log(`  ${out.project.dawProject.clipEffects.length} effect bars in the FX lane`)
if (argv.includes('--dry')) process.exit(0)

const url = flagOf('url', 'http://localhost:4618')
console.log('▸ rendering through the studio engine…')
execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--url=${url}`,
  `--out=${join(OUT_DIR, label + '.mp3')}`, '--keep'], { cwd: ROOT, stdio: 'inherit' })
console.log('▸ mastering to -14 LUFS…')
try {
  execFileSync('ffmpeg', ['-y', '-i', join(OUT_DIR, label + '.wav'),
    '-af', 'loudnorm=I=-14:TP=-1.2:LRA=11', '-codec:a', 'libmp3lame', '-b:a', '256k',
    join(OUT_DIR, `${label} (master).mp3`)], { stdio: ['ignore', 'ignore', 'pipe'] })
  console.log(`  → ${join(OUT_DIR, label + ' (master).mp3')}`)
} catch (e) { console.log('  (mastering failed — raw bounce still valid)', e.message.slice(0, 90)) }
