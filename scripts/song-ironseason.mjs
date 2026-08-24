// "Iron Season" — E minor, 138 BPM. Also built only from Apollo patches.
//
// The counterweight to "Filament", and deliberately its opposite in every
// dimension that matters: 138 against 92, minor against major, drums driving it
// rather than arriving late, an eighth-note bass pulse rather than long held
// tones. It opens on the bass riff alone — none of the other tracks I have made
// start that way (two open on a pad, one on drums).
//
// Every sound is a Helios patch: the kick is a sine with a 55ms pitch envelope
// dropping sixteen semitones, the snare is a tuned body plus a metallic
// wavetable through a highpass, the hats are that same wavetable where NOTE
// LENGTH decides open or closed. No samples anywhere.
//
// THE HARMONY. i9 – ♭VImaj7♯11 – iv11 – V7♭9 in E minor. The first move is the
// trick: Em9 to Cmaj7♯11 changes exactly ONE note (F♯ to E), so the ♭VI arrives
// as a colour shift rather than a chord change, and the loop only really turns
// when the dominant shows up at the end of it.
//
// THE ARC. 64 bars, about 1:51. Layers stack for the first sixteen bars,
// everything percussive drops at "Rust", and "Anvil" is the only place the bass
// plays its octave figure and the hats run sixteenths.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, rng, feel, N, assemble, dipInto, lift, bar } from './song-kit.mjs'
import { kick, snare, hatDual, subBass, bass, organ, keys, pad } from './apollo-voices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
mkdirSync(OUT_DIR, { recursive: true })
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 138, BPB = 4
const rand = rng(8802)
const { jitter, vary, chance } = feel(rand, BPM)

// ── Harmony ─────────────────────────────────────────────────────────────────
// riff: the bass register's [root, fifth, colour] for this chord.
const Em9   = { name: 'Em9',       voicing: [55, 59, 62, 66], bass: 40, sub: 28, riff: [40, 47, 43] } // G B D F# / E
const Cmaj11= { name: 'Cmaj7#11',  voicing: [55, 59, 62, 64], bass: 48, sub: 36, riff: [48, 43, 52] } // G B D E  / C
const Am11  = { name: 'Am11',      voicing: [60, 62, 64, 67], bass: 45, sub: 33, riff: [45, 52, 48] } // C D E G  / A
const B7b9  = { name: 'B7b9',      voicing: [60, 63, 66, 69], bass: 47, sub: 35, riff: [47, 42, 51] } // C D# F# A/ B

// Two bars per chord — an eight-bar loop.
const LOOP = [Em9, Em9, Cmaj11, Cmaj11, Am11, Am11, B7b9, B7b9]

// ── Bass: an eighth-note pulse, not a syncopated riff ───────────────────────
// Undertow's bass leaves most of the bar empty. This one does the opposite: it
// never stops, and the interest comes from where it jumps an octave.
const bassBar = (ch, { octaves = false, lean = false } = {}) => {
  const out = []
  for (let e = 0; e < 8; e++) {
    if (lean && (e === 3 || e === 6)) continue
    const b = e * 0.5
    let pitch = ch.riff[0]
    if (e === 3) pitch = ch.riff[1]                      // the fifth, mid-bar
    if (e === 7) pitch = ch.riff[2]                      // colour tone, leading out
    if (octaves && (e === 2 || e === 5)) pitch += 12      // the figure that only Anvil gets
    out.push(N(pitch, b + jitter(6), 0.42, vary(e === 0 ? 96 : e % 2 ? 74 : 84, 7)))
  }
  return out
}

const subBar = (ch, secondBar, velocity = 88) =>
  secondBar ? [] : [N(ch.sub, 0 + jitter(4), BPB * 2 - 0.2, vary(velocity, 4))]

// ── Drums ───────────────────────────────────────────────────────────────────
// Broken beat: the kick avoids beat 3, the snare lands on 4 alone rather than
// on 2 and 4, so the bar leans forward instead of marching.
const KICK = 24, SNARE = 48, HAT = 60

const kickBar = ({ extra = false } = {}) => {
  const out = [N(KICK, 0 + jitter(4), 0.4, vary(112, 4)),
               N(KICK, 1.5 + jitter(5), 0.4, vary(96, 7))]
  if (extra) out.push(N(KICK, 2.75 + jitter(5), 0.4, vary(88, 8)))
  return out
}
const snareBar = ({ ghost = true, fill = false } = {}) => {
  const late = 9 / 1000 * (BPM / 60)
  const out = [N(SNARE, 3 + late + jitter(4), 0.3, vary(104, 4))]
  if (ghost && chance(0.5)) out.push(N(SNARE, 1.75 + jitter(6), 0.2, vary(52, 8)))
  if (fill) for (const b of [3.25, 3.5, 3.75]) out.push(N(SNARE, b + jitter(4), 0.18, vary(70 + (b - 3.25) * 60, 7)))
  return out
}
/** Note length decides open vs closed on the hat patch. */
const hatBar = ({ sixteenths = false, opens = true } = {}) => {
  const out = []
  const n = sixteenths ? 16 : 8
  for (let i = 0; i < n; i++) {
    if (sixteenths && i % 2 === 1 && !chance(0.6)) continue
    const b = i * (4 / n)
    const isOpen = opens && (b === 1.5 || b === 3.5)
    out.push(N(HAT, b + jitter(5), isOpen ? 0.3 : 0.06, vary(isOpen ? 62 : (i % (n / 4) === 0 ? 68 : 44), 9)))
  }
  return out
}

// ── Harmony parts ───────────────────────────────────────────────────────────
// Organ stabs, off the downbeat — the kick owns beat one.
const STAB = [[0.5, 0.3, 78], [1.75, 0.25, 66], [2.5, 0.4, 82], [3.25, 0.22, 62]]
const STAB_LEAN = [[0.5, 0.5, 70], [2.5, 0.6, 74]]
const organBar = (ch, pattern = STAB) => {
  const out = []
  for (const [b, d, v] of pattern) {
    ch.voicing.forEach((p, i) => out.push(N(p, b + jitter(8) + i * 0.006, d, vary(v - i * 3, 6))))
  }
  return out
}
const padBar = (ch, velocity = 40, octave = 0) =>
  ch.voicing.map(p => N(p + octave, 0, BPB, vary(velocity, 4)))
// A fixed broken-chord contour — texture, not a phrase.
const FIGURE = [0, 2, 1, 3]
const keysBar = (ch, { velocity = 50, octave = 12 } = {}) =>
  Array.from({ length: 8 }, (_, i) =>
    N(ch.voicing[FIGURE[i % 4]] + octave, i * 0.5 + jitter(7), 0.42, vary(velocity + (i % 4 === 0 ? 8 : 0), 7)))

function section(bars, layers) {
  const parts = { kick: [], snare: [], hats: [], sub: [], bass: [], organ: [], keys: [], pad: [] }
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
    { key: 'kick',  id: uid(), name: 'Kick',  presetId: null, volume: 0.52, color: '#f97316',
      instrument: { type: 'apollo', params: kick() } },
    { key: 'snare', id: uid(), name: 'Snare', presetId: null, volume: 0.30, color: '#fb923c',
      instrument: { type: 'apollo', params: snare() } },
    { key: 'hats',  id: uid(), name: 'Hats',  presetId: null, volume: 0.20, pan: 0.18, color: '#fdba74',
      instrument: { type: 'apollo', params: hatDual() } },
    { key: 'sub',   id: uid(), name: 'Sub',   presetId: null, volume: 0.58, color: '#ea580c',
      instrument: { type: 'apollo', params: subBass() } },
    { key: 'bass',  id: uid(), name: 'Bass',  presetId: null, volume: 0.36, color: '#f59e0b',
      instrument: { type: 'apollo', params: bass() } },
    { key: 'organ', id: uid(), name: 'Organ', presetId: null, volume: 0.34, pan: -0.14, color: '#fbbf24',
      instrument: { type: 'apollo', params: organ() } },
    { key: 'keys',  id: uid(), name: 'Keys',  presetId: null, volume: 0.24, pan: 0.20, color: '#fcd34d',
      instrument: { type: 'apollo', params: keys() } },
    { key: 'pad',   id: uid(), name: 'Pad',   presetId: null, volume: 0.26, pan: -0.06, color: '#fef3c7',
      instrument: { type: 'apollo', params: pad() } },
  ]

  const sections = [
    // 1. Iron — the riff, alone. No drums, no harmony above it.
    { name: 'Iron', bars: 8, parts: section(8, {
        bass: ({ i }) => bassBar(LOOP[i % 8], { lean: i < 4 }),
        sub:  ({ ch, secondBar, i }) => i >= 4 ? subBar(ch, secondBar, 78) : [],
      }) },

    // 2. Season — the kick arrives, then hats. Still no chords.
    { name: 'Season', bars: 8, parts: section(8, {
        bass: ({ ch }) => bassBar(ch),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        kick: () => kickBar(),
        hats: ({ i }) => i >= 4 ? hatBar({ opens: false }) : [],
      }) },

    // 3. Forge A — the harmony finally lands, and the beat completes.
    { name: 'Forge A', bars: 12, parts: section(12, {
        bass:  ({ ch }) => bassBar(ch),
        sub:   ({ ch, secondBar }) => subBar(ch, secondBar),
        kick:  ({ i }) => kickBar({ extra: i % 4 === 3 }),
        snare: ({ last }) => snareBar({ fill: last }),
        hats:  () => hatBar(),
        organ: ({ ch, i }) => organBar(ch, i % 4 === 3 ? STAB_LEAN : STAB),
        pad:   ({ ch }) => padBar(ch, 38),
      }) },

    // 4. Rust — everything percussive leaves. Held chords only.
    { name: 'Rust', bars: 8, parts: section(8, {
        pad:   ({ ch }) => padBar(ch, 48),
        organ: ({ ch, i }) => i % 2 === 0 ? organBar(ch, [[0.5, 2.4, 58]]) : [],
        sub:   ({ ch, secondBar, i }) => i < 5 ? subBar(ch, secondBar, 70) : [],
      }) },

    // 5. Forge B — back in, with the broken-chord figure over the top.
    { name: 'Forge B', bars: 12, parts: section(12, {
        bass:  ({ ch }) => bassBar(ch),
        sub:   ({ ch, secondBar }) => subBar(ch, secondBar),
        kick:  ({ i }) => kickBar({ extra: i % 2 === 1 }),
        snare: ({ i, last }) => snareBar({ fill: last || i === 5 }),
        hats:  () => hatBar(),
        organ: ({ ch }) => organBar(ch, STAB),
        keys:  ({ ch, i }) => i >= 4 ? keysBar(ch, { velocity: 48 }) : [],
        pad:   ({ ch }) => padBar(ch, 38),
      }) },

    // 6. Anvil — the peak: octave bass figure, sixteenth hats, everything up.
    { name: 'Anvil', bars: 8, parts: section(8, {
        bass:  ({ ch }) => bassBar(ch, { octaves: true }),
        sub:   ({ ch, secondBar }) => subBar(ch, secondBar, 96),
        kick:  () => kickBar({ extra: true }),
        snare: ({ last }) => snareBar({ fill: last }),
        hats:  () => hatBar({ sixteenths: true }),
        organ: ({ ch }) => organBar(ch, STAB),
        keys:  ({ ch }) => keysBar(ch, { velocity: 54 }),
        pad:   ({ ch }) => padBar(ch, 42),
      }) },

    // 7. Ash — strip it back to where it started, and let it go cold.
    { name: 'Ash', bars: 8, parts: section(8, {
        bass:  ({ ch, i }) => i < 4 ? bassBar(ch, { lean: true }) : [],
        sub:   ({ ch, secondBar, i }) => i < 5 ? subBar(ch, secondBar, Math.max(56, 84 - i * 6)) : [],
        pad:   ({ ch, i }) => padBar(ch, Math.max(16, 42 - i * 4)),
        organ: ({ ch, i }) => i < 3 ? organBar(ch, STAB_LEAN) : [],
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  const fxBars = [
    dipInto('bass', at['Forge A'], 2), dipInto('organ', at['Forge A'], 2),
    dipInto('bass', at['Forge B'], 2), dipInto('pad', at['Forge B'], 2),
    dipInto('bass', at['Anvil'], 2), dipInto('hats', at['Anvil'], 2), dipInto('organ', at['Anvil'], 2),

    // The bass starts closed and opens across the opening section.
    bar('bass', at['Iron'], 8 * BPB, { filterHz: 480 },
        [[0, 1], [8 * BPB * 0.6, 0.3], [8 * BPB, 0]], 1),

    // Rust: dark and ducked, opening again on the way out.
    bar('pad', at['Rust'], 8 * BPB, { filterHz: 620, gain: 0.84 },
        [[0, 0], [4, 1], [8 * BPB - 6, 1], [8 * BPB, 0.15]], 1),
    bar('organ', at['Rust'], 8 * BPB, { filterHz: 700 },
        [[0, 0.2], [6, 1], [8 * BPB, 0.4]], 1),

    // The peak.
    lift('bass', at['Anvil'], 8 * BPB, { drive: 0.05, gain: 1.06 }),
    lift('organ', at['Anvil'], 8 * BPB, { drive: 0.04, gain: 1.04 }),
    lift('kick', at['Anvil'], 8 * BPB, { drive: 0.03, gain: 1.03 }),

    bar('pad', at['Ash'], 8 * BPB, { filterHz: 560, gain: 0.62 },
        [[0, 0], [8 * BPB * 0.5, 0.55], [8 * BPB, 1]], 1),
  ]

  return assemble({
    name: 'Iron Season', bpm: BPM, bpb: BPB, key: 'E', scale: 'minor', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.62,
  })
}

const out = build()
const label = 'Iron Season'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))
console.log(`▸ "${label}" · ${BPM} BPM · E minor · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
console.log(`  every voice is an Apollo patch — no samples, no presets, no drum pack`)
for (const t of out.project.dawProject.tracks) {
  const clips = out.project.dawProject.arrangementClips.filter(c => c.trackId === t.id)
  console.log(`  ${t.name.padEnd(6)} ${String(clips.length).padStart(2)} clips / ${String(clips.reduce((n, c) => n + c.notes.length, 0)).padStart(4)} notes`)
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
} catch (e) { console.log('  (mastering pass failed — raw bounce still valid)', e.message.slice(0, 100)) }
