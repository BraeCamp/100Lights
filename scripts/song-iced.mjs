// "Iced" — A major, 104 BPM. Disco-pop: four on the floor, offbeat open hats,
// a bassline that never sits still.
//
// An original piece written in that character. The reference point is the feel —
// breezy, major-key, groove-first, mid-tempo — not any particular song's parts.
//
// THE POINT OF IT is the bass. In this idiom the bassline IS the hook: sixteenth
// syncopation, octave pops, and a filter that opens a little on every note, so
// it talks rather than holds. Everything above it stays out of the way — the
// keys play stabs strictly off the downbeat, the pad just breathes. Nothing
// plays a melody, which suits both the standing rule and the style: disco is
// carried by the rhythm section.
//
// THE HARMONY. Imaj9 – vi9 – ii7 – V9sus in A, two bars each, all four voiced
// with sevenths and ninths so the loop stays sweet rather than plain. The V9sus
// at the end refuses to resolve properly, which is what keeps it circling.
//
// Deliberately unlike the other pieces in this set: the only one in a major key
// with a straight four-on-the-floor, and the only one where the bass is the
// busiest thing in the arrangement.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, rng, feel, N, assemble, dipInto, lift, bar } from './song-kit.mjs'
import { kick, snare, hatDual, subBass, funkBass, warmEp, pad } from './apollo-voices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
mkdirSync(OUT_DIR, { recursive: true })
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 104, BPB = 4
const rand = rng(6620)
const { jitter, vary, chance } = feel(rand, BPM)

// ── Harmony ─────────────────────────────────────────────────────────────────
// riff: [root, fifth, colour] in the bass's register.
const Amaj9 = { name: 'Amaj9',  voicing: [61, 64, 68, 71], bass: 45, sub: 33, riff: [45, 52, 49] }
const F0m9  = { name: 'F#m9',   voicing: [57, 61, 64, 68], bass: 42, sub: 30, riff: [42, 49, 45] }
const Bm7   = { name: 'Bm7',    voicing: [62, 66, 69, 73], bass: 47, sub: 35, riff: [47, 54, 50] }
const E9sus = { name: 'E9sus',  voicing: [57, 59, 62, 66], bass: 40, sub: 28, riff: [40, 47, 45] }

const LOOP = [Amaj9, Amaj9, F0m9, F0m9, Bm7, Bm7, E9sus, E9sus]

// ── The bassline ────────────────────────────────────────────────────────────
// Sixteenth syncopation with octave pops. Written as [tone, beat, dur, vel];
// tone indexes the chord's riff tones, +12 marks a pop.
const RIFF = [
  [0, 0.00, 0.22, 104],
  [0, 0.50, 0.18, 78],
  [0, 0.75, 0.20, 88],
  [1, 1.50, 0.22, 92],
  [0, 2.00, 0.20, 98],
  [0, 2.50, 0.18, 76],
  [2, 2.75, 0.22, 86],
  [1, 3.50, 0.24, 90],
]
const RIFF_LEAN = [RIFF[0], RIFF[3], RIFF[4], RIFF[7]]

const bassBar = (ch, { pattern = RIFF, pops = false } = {}) =>
  pattern.map(([tone, b, d, v]) => {
    const pop = pops && (b === 0.75 || b === 2.75) ? 12 : 0
    return N(ch.riff[tone] + pop, b + jitter(6), d, vary(v, 7))
  })

const subBar = (ch, secondBar, velocity = 84) =>
  secondBar ? [] : [N(ch.sub, 0 + jitter(4), BPB * 2 - 0.2, vary(velocity, 4))]

// ── Keys and pad ────────────────────────────────────────────────────────────
// Stabs strictly off the downbeat: the kick owns beat one in this music.
const STAB = [[0.5, 0.26, 78], [1.75, 0.22, 66], [2.5, 0.3, 82], [3.25, 0.2, 62]]
const STAB_LEAN = [[0.5, 0.5, 70], [2.5, 0.55, 74]]
const keysBar = (ch, pattern = STAB) => {
  const out = []
  for (const [b, d, v] of pattern) {
    ch.voicing.forEach((p, i) => out.push(N(p, b + jitter(8) + i * 0.006, d, vary(v - i * 3, 6))))
  }
  return out
}
const padBar = (ch, velocity = 34, octave = 0) =>
  ch.voicing.map(p => N(p + octave, 0, BPB, vary(velocity, 4)))

// ── Drums: four on the floor ────────────────────────────────────────────────
const KICK = 24, CLAP = 48, HAT = 60
const LATE = 8 / 1000 * (BPM / 60)

const kickBar = ({ on = true } = {}) => on
  ? Array.from({ length: 4 }, (_, b) => N(KICK, b + jitter(3), 0.4, vary(b === 0 ? 108 : 100, 4)))
  : []
const clapBar = ({ fill = false } = {}) => {
  const out = [1, 3].map(b => N(CLAP, b + LATE + jitter(4), 0.3, vary(96, 4)))
  if (fill) for (const b of [3.5, 3.75]) out.push(N(CLAP, b + jitter(4), 0.2, vary(74 + (b - 3.5) * 60, 7)))
  return out
}
/** Closed on the beat, OPEN on every offbeat — the disco signature, and what
 *  stops a four-four kick from stamping. Note length decides which. */
const hatBar = ({ opens = true, sixteenths = false } = {}) => {
  const out = []
  for (let i = 0; i < 8; i++) {
    const b = i * 0.5
    const isOff = i % 2 === 1
    if (isOff && opens) out.push(N(HAT, b + jitter(5), 0.28, vary(62, 6)))
    else out.push(N(HAT, b + jitter(5), 0.06, vary(46, 8)))
  }
  if (sixteenths) for (let i = 0; i < 8; i++) if (chance(0.5)) out.push(N(HAT, i * 0.5 + 0.25 + jitter(5), 0.05, vary(30, 8)))
  return out
}

function section(bars, layers) {
  const parts = { kick: [], clap: [], hats: [], sub: [], bass: [], keys: [], pad: [] }
  for (let i = 0; i < bars; i++) {
    const ch = LOOP[i % LOOP.length]
    const secondBar = i % 2 === 1
    const at = (notes, target) => notes.forEach(n => parts[target].push({ ...n, startBeat: i * BPB + n.startBeat }))
    const ctx = { i, ch, secondBar, last: i === bars - 1 }
    for (const key of Object.keys(parts)) if (layers[key]) at(layers[key](ctx), key)
  }
  return parts
}

export function build() {
  const tracks = [
    { key: 'kick',  id: uid(), name: 'Kick',  presetId: null, volume: 0.50, color: '#f472b6',
      instrument: { type: 'apollo', params: kick() } },
    { key: 'clap',  id: uid(), name: 'Clap',  presetId: null, volume: 0.26, color: '#fb7185',
      instrument: { type: 'apollo', params: snare() } },
    { key: 'hats',  id: uid(), name: 'Hats',  presetId: null, volume: 0.17, pan: 0.16, color: '#fda4af',
      instrument: { type: 'apollo', params: hatDual() } },
    { key: 'sub',   id: uid(), name: 'Sub',   presetId: null, volume: 0.52, color: '#e879f9',
      instrument: { type: 'apollo', params: subBass() } },
    { key: 'bass',  id: uid(), name: 'Bass',  presetId: null, volume: 0.40, color: '#c084fc',
      instrument: { type: 'apollo', params: funkBass() } },
    { key: 'keys',  id: uid(), name: 'Keys',  presetId: null, volume: 0.32, pan: -0.16, color: '#f0abfc',
      instrument: { type: 'apollo', params: warmEp() } },
    { key: 'pad',   id: uid(), name: 'Pad',   presetId: null, volume: 0.16, pan: 0.08, color: '#fbcfe8',
      instrument: { type: 'apollo', params: pad() } },
  ]

  const sections = [
    // 1. Chilled — hats and the bass, nothing else. The groove before the beat.
    { name: 'Chilled', bars: 8, parts: section(8, {
        hats: () => hatBar({ opens: false }),
        bass: ({ ch, i }) => bassBar(ch, { pattern: i < 4 ? RIFF_LEAN : RIFF }),
      }) },

    // 2. Pour — four on the floor arrives, and the offbeat opens with it.
    { name: 'Pour', bars: 8, parts: section(8, {
        kick: () => kickBar(),
        hats: () => hatBar(),
        bass: ({ ch }) => bassBar(ch),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        keys: ({ ch, i }) => i >= 4 ? keysBar(ch, STAB_LEAN) : [],
      }) },

    // 3. Sweet A — the full thing.
    { name: 'Sweet A', bars: 12, parts: section(12, {
        kick: () => kickBar(),
        clap: ({ last }) => clapBar({ fill: last }),
        hats: () => hatBar(),
        bass: ({ ch, i }) => bassBar(ch, { pops: i % 4 === 3 }),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        keys: ({ ch, i }) => keysBar(ch, i % 4 === 3 ? STAB_LEAN : STAB),
        pad:  ({ ch }) => padBar(ch, 32),
      }) },

    // 4. Melt — the floor drops away. Keys and pad, and the bass leaning back.
    { name: 'Melt', bars: 8, parts: section(8, {
        keys: ({ ch, i }) => i % 2 === 0 ? keysBar(ch, [[0.5, 1.6, 62]]) : [],
        pad:  ({ ch }) => padBar(ch, 44),
        bass: ({ ch, i }) => i >= 4 ? bassBar(ch, { pattern: RIFF_LEAN }) : [],
        sub:  ({ ch, secondBar, i }) => i < 5 ? subBar(ch, secondBar, 70) : [],
      }) },

    // 5. Sweet B — back in, with the bass popping octaves every other bar.
    { name: 'Sweet B', bars: 12, parts: section(12, {
        kick: () => kickBar(),
        clap: ({ i, last }) => clapBar({ fill: last || i === 5 }),
        hats: ({ i }) => hatBar({ sixteenths: i % 4 >= 2 }),
        bass: ({ ch, i }) => bassBar(ch, { pops: i % 2 === 1 }),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        keys: ({ ch }) => keysBar(ch, STAB),
        pad:  ({ ch }) => padBar(ch, 32),
      }) },

    // 6. Out — strip it back to the groove it started with, then let it go.
    { name: 'Out', bars: 8, parts: section(8, {
        kick: ({ i }) => i < 3 ? kickBar() : [],
        hats: ({ i }) => i < 5 ? hatBar({ opens: i < 3 }) : [],
        bass: ({ ch, i }) => i < 5 ? bassBar(ch, { pattern: RIFF_LEAN }) : [],
        sub:  ({ ch, secondBar, i }) => i < 4 ? subBar(ch, secondBar, 72) : [],
        pad:  ({ ch, i }) => padBar(ch, Math.max(14, 36 - i * 4)),
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  const fxBars = [
    dipInto('bass', at['Sweet A'], 2), dipInto('keys', at['Sweet A'], 2),
    dipInto('bass', at['Sweet B'], 2), dipInto('hats', at['Sweet B'], 2), dipInto('keys', at['Sweet B'], 2),

    // The bass opens across the intro — the groove coming into focus.
    bar('bass', at['Chilled'], 8 * BPB, { filterHz: 520 },
        [[0, 1], [8 * BPB * 0.6, 0.3], [8 * BPB, 0]], 1),

    // Melt goes soft and dark, then lifts back out.
    bar('pad', at['Melt'], 8 * BPB, { filterHz: 700, gain: 0.86 },
        [[0, 0], [4, 1], [8 * BPB - 6, 1], [8 * BPB, 0.15]], 1),
    bar('keys', at['Melt'], 8 * BPB, { filterHz: 760 },
        [[0, 0.2], [6, 1], [8 * BPB, 0.4]], 1),

    lift('bass', at['Sweet B'], 12 * BPB, { drive: 0.04, gain: 1.05 }),
    lift('keys', at['Sweet B'], 12 * BPB, { drive: 0.03, gain: 1.03 }),

    bar('pad', at['Out'], 8 * BPB, { filterHz: 560, gain: 0.62 },
        [[0, 0], [8 * BPB * 0.5, 0.55], [8 * BPB, 1]], 1),
  ]

  return assemble({
    name: 'Iced', bpm: BPM, bpb: BPB, key: 'A', scale: 'major', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.40,
  })
}

const out = build()
const label = 'Iced'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))
console.log(`▸ "${label}" · ${BPM} BPM · A major · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
for (const t of out.project.dawProject.tracks) {
  const clips = out.project.dawProject.arrangementClips.filter(c => c.trackId === t.id)
  console.log(`  ${t.name.padEnd(8)} ${String(clips.length).padStart(2)} clips / ${String(clips.reduce((n, c) => n + c.notes.length, 0)).padStart(4)} notes`)
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
