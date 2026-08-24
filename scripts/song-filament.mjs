// "Filament" — D major, 92 BPM. Every sound in it is an Apollo patch.
//
// No sampled preset, no drum pack, nothing from the sound library: the pad is
// two detuned wavetables, the sub is a sine plus Apollo's own sub oscillator,
// and the only percussion is a metallic wavetable through a highpass with a
// 35ms decay. See scripts/apollo-voices.mjs — each voice was rendered through
// the engine and measured before being used here.
//
// It is also deliberately BRIGHT. The last three tracks I made were all dark
// minor pieces and Brae's standing note is that my defaults drift that way, so
// this one is major, slow, and opens with no drums at all — the first percussion
// arrives a third of the way in and never becomes a backbeat.
//
// THE HARMONY. Imaj9 – vi11 – IVmaj7♯11 – V9sus4 in D, two bars each, voiced
// rootless in a narrow A3–G4 band so the four chords are nearly the same four
// notes: across the whole loop no voice moves more than two semitones. That is
// what lets it hang without a melody over it — the chords change colour rather
// than location. The ♯11 on the IV is the one moment of real strangeness.
//
// THE ARC. 48 bars, about 2:05. Layers arrive one at a time, everything except
// the pad and choir leaves at "Dim", and "Bloom" is the only place the top
// octave and the hats appear.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, rng, feel, N, assemble, dipInto, lift, bar } from './song-kit.mjs'
import { pad, choirish, keys, subBass, bass, tick, hatDual } from './apollo-voices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
mkdirSync(OUT_DIR, { recursive: true })
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 92, BPB = 4
const rand = rng(5521)
const { jitter, vary, chance } = feel(rand, BPM)

// ── Harmony ─────────────────────────────────────────────────────────────────
// Rootless upper structures, all inside A3–G4. bass/sub carry the roots.
const Dmaj9  = { name: 'Dmaj9',     voicing: [57, 61, 64, 66], bass: 38, sub: 38 } // A C# E F#
const Bm11   = { name: 'Bm11',      voicing: [57, 62, 64, 66], bass: 35, sub: 35 } // A D E F#
const Gmaj11 = { name: 'Gmaj7#11',  voicing: [59, 61, 62, 66], bass: 31, sub: 31 } // B C# D F#
const A9sus  = { name: 'A9sus4',    voicing: [59, 62, 64, 67], bass: 33, sub: 33 } // B D E G

// Two bars per chord — an eight-bar loop that never hurries.
const LOOP = [Dmaj9, Dmaj9, Bm11, Bm11, Gmaj11, Gmaj11, A9sus, A9sus]

// ── Parts ───────────────────────────────────────────────────────────────────
const padBar = (ch, velocity = 44, octave = 0) =>
  ch.voicing.map(p => N(p + octave, 0, BPB, vary(velocity, 4)))

// The choir is struck once per chord and left to ring across both bars.
const choirBar = (ch, secondBar, velocity = 50, octave = 0) => secondBar ? [] :
  ch.voicing.map((p, i) => N(p + octave, 0 + jitter(14) + i * 0.03, BPB * 2 - 0.3, vary(velocity - i * 3, 5)))

// A broken chord, not a tune: the same fixed contour every bar, so it reads as
// texture. Nothing here phrases, leans or resolves.
const FIGURE = [0, 1, 2, 3, 2, 1]
const keysBar = (ch, { velocity = 52, octave = 0, half = false } = {}) => {
  const out = []
  const step = half ? 0.5 : 0.6667
  for (let i = 0; i < (half ? 8 : 6); i++) {
    const tone = ch.voicing[FIGURE[i % FIGURE.length] % ch.voicing.length]
    out.push(N(tone + octave, i * step + jitter(9), step * 0.9, vary(velocity + (i % 3 === 0 ? 8 : 0), 7)))
  }
  return out
}

const subBar = (ch, secondBar, velocity = 86) =>
  secondBar ? [] : [N(ch.sub, 0 + jitter(5), BPB * 2 - 0.2, vary(velocity, 4))]

// Sparse and long — the bass moves, it does not drive.
const bassBar = (ch, secondBar) => secondBar
  ? [N(ch.bass + 7, 2 + jitter(10), 1.6, vary(64, 7))]
  : [N(ch.bass, 0 + jitter(8), 2.6, vary(84, 6)), N(ch.bass, 3.5 + jitter(10), 0.45, vary(66, 8))]

// Percussion, such as it is: a click on the offbeat, never a backbeat.
const tickBar = ({ velocity = 58, busy = false } = {}) => {
  const out = [N(60, 2.5 + jitter(9), 0.1, vary(velocity, 8))]
  if (busy) out.push(N(60, 3.75 + jitter(9), 0.1, vary(velocity - 14, 8)))
  if (chance(0.3)) out.push(N(60, 1.25 + jitter(9), 0.1, vary(velocity - 22, 8)))
  return out
}
// Note LENGTH decides open vs closed on this patch.
const hatBar = ({ velocity = 48 } = {}) => [
  N(60, 1.5 + jitter(8), 0.34, vary(velocity, 7)),
  N(60, 3.5 + jitter(8), 0.34, vary(velocity - 6, 7)),
]

function section(bars, layers) {
  const parts = { pad: [], choir: [], keys: [], sub: [], bass: [], tick: [], hats: [] }
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
    { key: 'sub',   id: uid(), name: 'Sub',    presetId: null, volume: 0.62, color: '#38bdf8',
      instrument: { type: 'apollo', params: subBass() } },
    { key: 'bass',  id: uid(), name: 'Bass',   presetId: null, volume: 0.34, color: '#0ea5e9',
      instrument: { type: 'apollo', params: bass() } },
    { key: 'pad',   id: uid(), name: 'Pad',    presetId: null, volume: 0.40, pan: -0.08, color: '#7dd3fc',
      instrument: { type: 'apollo', params: pad() } },
    { key: 'choir', id: uid(), name: 'Choir',  presetId: null, volume: 0.52, pan: 0.10, color: '#bae6fd',
      instrument: { type: 'apollo', params: choirish() } },
    { key: 'keys',  id: uid(), name: 'Keys',   presetId: null, volume: 0.30, pan: 0.16, color: '#a5f3fc',
      instrument: { type: 'apollo', params: keys() } },
    { key: 'tick',  id: uid(), name: 'Tick',   presetId: null, volume: 0.26, pan: -0.22, color: '#e0f2fe',
      instrument: { type: 'apollo', params: tick() } },
    { key: 'hats',  id: uid(), name: 'Hats',   presetId: null, volume: 0.22, pan: 0.24, color: '#f0f9ff',
      instrument: { type: 'apollo', params: hatDual() } },
  ]

  const sections = [
    // 1. Filament — one sound, alone, opening up.
    { name: 'Filament', bars: 8, parts: section(8, {
        pad: ({ i }) => padBar(LOOP[i % 8], i < 4 ? 34 : 44),
      }) },

    // 2. Glow — the choir states the harmony; the sub settles underneath.
    { name: 'Glow', bars: 8, parts: section(8, {
        pad:   ({ ch }) => padBar(ch, 46),
        choir: ({ ch, secondBar }) => choirBar(ch, secondBar, 48),
        sub:   ({ ch, secondBar, i }) => i >= 2 ? subBar(ch, secondBar, 80) : [],
      }) },

    // 3. Current — motion arrives: broken chords, a moving bass, one click a bar.
    { name: 'Current', bars: 8, parts: section(8, {
        pad:   ({ ch }) => padBar(ch, 44),
        choir: ({ ch, secondBar }) => choirBar(ch, secondBar, 44),
        keys:  ({ ch }) => keysBar(ch, { velocity: 50 }),
        sub:   ({ ch, secondBar }) => subBar(ch, secondBar),
        bass:  ({ ch, secondBar }) => bassBar(ch, secondBar),
        tick:  ({ i }) => i >= 2 ? tickBar({ velocity: 54 }) : [],
      }) },

    // 4. Dim — everything with a pulse leaves. This is what Bloom is bought with.
    { name: 'Dim', bars: 8, parts: section(8, {
        pad:   ({ ch }) => padBar(ch, 50),
        choir: ({ ch, secondBar, i }) => i >= 2 ? choirBar(ch, secondBar, 42) : [],
        sub:   ({ ch, secondBar, i }) => i < 5 ? subBar(ch, secondBar, 70) : [],
      }) },

    // 5. Bloom — the peak. The only place the top octave and the hats appear.
    { name: 'Bloom', bars: 8, parts: section(8, {
        pad:   ({ ch }) => padBar(ch, 48),
        choir: ({ ch, secondBar, i }) => [...choirBar(ch, secondBar, 52),
                                          ...choirBar(ch, secondBar, i < 2 ? 30 : 38, 12)],
        keys:  ({ ch }) => keysBar(ch, { velocity: 56, half: true }),
        sub:   ({ ch, secondBar }) => subBar(ch, secondBar, 92),
        bass:  ({ ch, secondBar }) => bassBar(ch, secondBar),
        tick:  () => tickBar({ velocity: 60, busy: true }),
        hats:  () => hatBar({ velocity: 50 }),
      }) },

    // 6. Cool — back to one sound, and let the tail run out.
    { name: 'Cool', bars: 8, parts: section(8, {
        pad:   ({ ch, i }) => padBar(ch, Math.max(18, 46 - i * 4)),
        choir: ({ ch, secondBar, i }) => i < 4 ? choirBar(ch, secondBar, Math.max(24, 44 - i * 6)) : [],
        sub:   ({ ch, secondBar, i }) => i < 4 ? subBar(ch, secondBar, 66) : [],
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  const fxBars = [
    // Step into each arrival rather than drifting into it.
    dipInto('keys', at['Current'], 2), dipInto('bass', at['Current'], 2),
    dipInto('choir', at['Bloom'], 3), dipInto('keys', at['Bloom'], 3), dipInto('pad', at['Bloom'], 3),

    // The pad opens across the opening section — the filament warming up.
    bar('pad', at['Filament'], 8 * BPB, { filterHz: 520 },
        [[0, 1], [8 * BPB * 0.7, 0.35], [8 * BPB, 0]], 1),
    // …and the keys open across Current.
    bar('keys', at['Current'], 8 * BPB, { filterHz: 700 },
        [[0, 1], [8 * BPB * 0.55, 0.3], [8 * BPB, 0]], 1),

    // Dim goes dark and quiet, then lifts on the way out.
    bar('pad', at['Dim'], 8 * BPB, { filterHz: 600, gain: 0.82 },
        [[0, 0], [5, 1], [8 * BPB - 6, 1], [8 * BPB, 0.12]], 1),
    bar('choir', at['Dim'], 8 * BPB, { filterHz: 720 },
        [[0, 0.2], [6, 1], [8 * BPB, 0.5]], 1),

    // Bloom rides up.
    lift('choir', at['Bloom'], 8 * BPB, { drive: 0.03, gain: 1.05 }),
    lift('keys', at['Bloom'], 8 * BPB, { drive: 0.04, gain: 1.05 }),
    lift('bass', at['Bloom'], 8 * BPB, { drive: 0.04, gain: 1.04 }),

    // And the long close.
    bar('pad', at['Cool'], 8 * BPB, { filterHz: 540, gain: 0.6 },
        [[0, 0], [8 * BPB * 0.5, 0.55], [8 * BPB, 1]], 1),
  ]

  return assemble({
    name: 'Filament', bpm: BPM, bpb: BPB, key: 'D', scale: 'major', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.80,
  })
}

const out = build()
const label = 'Filament'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))
console.log(`▸ "${label}" · ${BPM} BPM · D major · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
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
