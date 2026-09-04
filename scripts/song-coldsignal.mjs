// "Cold Signal" — D minor, 128 BPM. Dub techno: a chord that arrives late and
// rings off into the distance, over a kick that never stops.
//
// The cold one. Nothing in the set is built on a DELAYED STAB — a minor chord
// played on the off-beat and left to decay under a long reverb, so that the
// chord you hear is mostly its own tail. That single device carries dub
// techno, and it is the opposite of Glass Floor's four-note arp (busy, bright,
// on the grid) and Paper Lanterns' warm comping (played, swung, in front).
//
// THE HARMONY. Two chords, a minor third apart, and one borrowed colour:
//   Dm9  ·  Dm9  ·  Fmaj7  ·  Gm9 (with the E♭ underneath: a Neapolitan lean)
// The stab plays only the 3rd, 7th and 9th so the chord stays hollow; the sub
// holds the roots long; a low pad sits a fifth under the stab and is the only
// thing that moves through the changes.
//
// THE ARC. Kick and a filtered stab from nothing; the sub and hats; a full
// section where the stab opens; a breakdown that is only the stab's reverb and
// the pad; a second full section with a rimshot answering the stab; a long way
// out where the kick leaves first and the tail is the last thing you hear.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, rng, feel, N, eq3, reverb, chorus, compressor, assemble, assertInRange, dipInto, lift, bar } from './song-kit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
mkdirSync(OUT_DIR, { recursive: true })
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 128, BPB = 4
const rand = rng(9128)
const { jitter, vary, chance } = feel(rand, BPM)

// ── Harmony ─────────────────────────────────────────────────────────────────
// stab: 3-7-9, hollow. sub: the root, low. pad: root + fifth an octave up.
const Dm9   = { name: 'Dm9',   stab: [65, 72, 76], sub: 38, pad: [50, 57], pulse: [62, 65] }   // F C E / D
const Fmaj7 = { name: 'Fmaj7', stab: [69, 76, 79], sub: 41, pad: [53, 60], pulse: [65, 69] }   // A E G / F
const Gm9   = { name: 'Gm9',   stab: [70, 77, 81], sub: 43, pad: [55, 62], pulse: [67, 70] }   // B♭ F A / G
const Neap  = { name: 'E♭/G',  stab: [70, 75, 79], sub: 43, pad: [55, 63], pulse: [67, 70] }   // B♭ E♭ G over G — the lean

// Eight bars: Dm9 ×4 · Fmaj7 ×2 · Gm9 · E♭/G
const LOOP = [Dm9, Dm9, Dm9, Dm9, Fmaj7, Fmaj7, Gm9, Neap]

// ── The stab ────────────────────────────────────────────────────────────────
// On the "and" of 2 and, some bars, the "and" of 4 — never on a beat. Short
// notes; the reverb on the trackhead is what makes them long.
const stabBar = (ch, { velocity = 74, second = true, open = false } = {}) => {
  const out = []
  const hit = (at, vel) => ch.stab.forEach((p, i) => out.push(N(p, at + jitter(5) + i * 0.008, open ? 0.6 : 0.32, vary(vel - i * 3, 5))))
  hit(1.5, velocity)
  if (second && chance(0.7)) hit(3.5, velocity - 10)
  return out
}

// ── The pulse: an off-beat eighth, two notes, almost a chord ────────────────
// The moving texture. Not an arp (it never climbs), not a phrase: the same two
// notes on every off-beat eighth, velocity breathing across the bar.
const pulseBar = (ch, { velocity = 44 } = {}) => {
  const out = []
  for (let i = 0; i < 8; i++) {
    if (i % 2 === 0) continue
    const v = velocity + (i === 3 || i === 7 ? 8 : 0) - (i === 1 ? 4 : 0)
    ch.pulse.forEach((p, k) => out.push(N(p, i * 0.5 + jitter(4) + k * 0.006, 0.22, vary(v - k * 4, 5))))
  }
  return out
}

// ── Steel: a library SAMPLE as the instrument ───────────────────────────────
// The piano roll's Samples tab lets a clip play any library sound across the
// keys; this is that, by hand. The seeded "Steel Pulse" pluck (Darkwave)
// becomes a preset rooted on its own G3, and the engine renders it at each
// written pitch. Two metallic ticks late in the bar — the "a" of 3 and the
// "e" of 4 — on the chord's 9th and 7th, an octave over the pulse, opposite
// side of the stereo from it. A texture: never a phrase.
const STEEL = {
  id: uid(), name: 'Steel Pulse', folder: 'Darkwave', loNote: 31, hiNote: 79, category: 'synth-pluck',
  group: 'Samples', builtIn: false, createdAt: new Date().toISOString(),
  sampleId: 'seed:Synth:Darkwave:Steel Pulse', rootNote: 55, tags: ['Lead', 'Hard', 'Crunchy'],
}
const steelBar = (ch, { velocity = 42 } = {}) => [
  N(ch.pulse[0] + 12, 2.75 + jitter(4), 0.2, vary(velocity, 5)),
  N(ch.pulse[1] + 7, 3.25 + jitter(4), 0.2, vary(velocity - 8, 5)),
]

const subBar = (ch, velocity = 86) => [N(ch.sub, 0 + jitter(3), BPB - 0.1, vary(velocity, 3))]
const padBar = (ch, velocity = 36) => ch.pad.map((p, i) => N(p, i * 0.05, BPB, vary(velocity, 3)))

// ── Drums: techno, minimal ──────────────────────────────────────────────────
const K = 36, RIM = 37, HH = 42, OH = 46, CLAP = 39
function drumBar({ kick = true, hats = true, open = false, rim = false, clap = false, fill = false, off = false } = {}) {
  const out = []
  if (kick) for (let b = 0; b < 4; b++) out.push(N(K, b + jitter(2), 0.4, vary(b === 0 ? 106 : 100, 3)))
  if (hats) for (let i = 0; i < 8; i++) {
    if (off && i % 2 === 0) continue
    out.push(N(HH, i * 0.5 + jitter(4), 0.12, vary(i % 2 ? 40 : 30, 8)))
  }
  if (open) for (const b of [0.5, 2.5]) out.push(N(OH, b + jitter(4), 0.3, vary(52, 6)))
  if (rim) for (const b of [1, 3]) out.push(N(RIM, b + jitter(4), 0.2, vary(72, 6)))
  if (clap) for (const b of [1, 3]) out.push(N(CLAP, b + 0.012 + jitter(4), 0.3, vary(80, 5)))
  if (fill) out.push(N(RIM, 3.75 + jitter(3), 0.15, vary(88, 6)))
  return out
}

function section(bars, layers) {
  const parts = { sub: [], stab: [], pulse: [], steel: [], pad: [], drums: [] }
  for (let i = 0; i < bars; i++) {
    const ch = LOOP[i % LOOP.length]
    const at = (notes, target) => notes.forEach(n => parts[target].push({ ...n, startBeat: i * BPB + n.startBeat }))
    const ctx = { i, ch, last: i === bars - 1, lean: ch === Neap }
    for (const key of Object.keys(parts)) if (layers[key]) at(layers[key](ctx), key)
  }
  return parts
}

export function build() {
  const tracks = [
    { key: 'sub',   id: uid(), name: 'Sub',   presetId: 'builtin-46', volume: 0.54, color: '#0e7490',
      rollFx: { sustain: 0.5 },
      effects: [eq3(4, -7, -14, 90, 500, 4000), compressor(-21, 4, 1)] },
    { key: 'stab',  id: uid(), name: 'Stab',  presetId: 'builtin-27', volume: 0.36, pan: 0.12, color: '#22d3ee',
      rollFx: { sustain: 2.2 },
      effects: [eq3(-9, -1, -2, 250, 1000, 5500), chorus(0.32, 0.22, 0.4), reverb(0.62, 5.5, 0.06)] },
    { key: 'pulse', id: uid(), name: 'Pulse', presetId: 'builtin-8', volume: 0.24, pan: -0.3, color: '#67e8f9',
      rollFx: { sustain: 0.15 },
      effects: [eq3(-10, -3, 0, 320, 1200, 7000), reverb(0.3, 2.0, 0.02)] },
    { key: 'steel', id: uid(), name: 'Steel', presetId: STEEL.id, volume: 0.34, pan: 0.38, color: '#a5f3fc',
      rollFx: { sustain: 0.3 },
      effects: [eq3(-12, -2, 0, 300, 1500, 6000), reverb(0.36, 3.0, 0.03)] },
    { key: 'pad',   id: uid(), name: 'Pad',   presetId: null, volume: 0.16, pan: -0.08, color: '#a5f3fc',
      instrument: { type: 'poly', params: { waveform: 'sawtooth', attack: 2.2, decay: 1.5, sustain: 0.7, release: 3.6,
        detune: 9, filterType: 'lowpass', filterCutoff: 700, filterResonance: 0.5,
        lfoEnabled: true, lfoRate: 0.07, lfoDepth: 0.22, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(-8, -5, -2, 280, 800, 5000), chorus(0.4, 0.2, 0.5), reverb(0.44, 4.0, 0.05)] },
    { key: 'drums', id: uid(), name: 'Drums', presetId: null, isDrum: true, volume: 0.44, color: '#155e75',
      instrument: { type: 'drum', params: { pack: 'techno' } },
      effects: [eq3(1.5, -3, -3, 120, 600, 7000), compressor(-23, 5, 2), reverb(0.05, 0.4, 0.01)] },
  ]

  const sections = [
    // 1. Signal — the kick from nothing, then a stab so filtered it is a pulse.
    { name: 'Signal', bars: 8, parts: section(8, {
        drums: ({ i }) => drumBar({ hats: i >= 4, off: true }),
        stab:  ({ ch, i }) => i >= 2 ? stabBar(ch, { velocity: 60, second: false }) : [],
      }) },
    // 2. Carrier — the sub and the pulse; the hats fill in.
    { name: 'Carrier', bars: 8, parts: section(8, {
        drums: ({ last }) => drumBar({ fill: last }),
        sub:   ({ ch }) => subBar(ch, 80),
        stab:  ({ ch }) => stabBar(ch, { velocity: 66 }),
        pulse: ({ ch, i }) => i >= 4 ? pulseBar(ch, { velocity: 40 }) : [],
      }) },
    // 3. Open — the stab's filter opens across it; open hats on the offs.
    { name: 'Open', bars: 16, parts: section(16, {
        drums: ({ i, last }) => drumBar({ open: i % 4 >= 2, fill: last || i === 7 }),
        sub:   ({ ch }) => subBar(ch),
        stab:  ({ ch, lean }) => stabBar(ch, { velocity: 72, open: lean }),
        pulse: ({ ch }) => pulseBar(ch, { velocity: 46 }),
        steel: ({ ch, i }) => i >= 8 && i % 2 === 1 ? steelBar(ch, { velocity: 52 }) : [],
        pad:   ({ ch, i }) => i >= 8 ? padBar(ch, 34) : [],
      }) },
    // 4. Static — the floor goes. Pad and the stab's tail; the sub half of it.
    { name: 'Static', bars: 8, parts: section(8, {
        pad:   ({ ch }) => padBar(ch, 44),
        stab:  ({ ch, i }) => i % 2 === 0 ? stabBar(ch, { velocity: 62, second: false, open: true }) : [],
        sub:   ({ ch, i }) => i < 4 ? subBar(ch, 68) : [],
        drums: ({ i }) => i >= 6 ? drumBar({ kick: false, hats: true, off: true }) : [],
      }) },
    // 5. Open B — back in, a rimshot answering the stab, the pulse louder.
    { name: 'Open B', bars: 16, parts: section(16, {
        drums: ({ i, last }) => drumBar({ open: i % 2 === 1, rim: i >= 4, clap: i >= 12, fill: last || i === 7 }),
        sub:   ({ ch }) => subBar(ch, 90),
        stab:  ({ ch, lean }) => stabBar(ch, { velocity: 76, open: lean }),
        pulse: ({ ch }) => pulseBar(ch, { velocity: 50 }),
        steel: ({ ch, i }) => i % 4 !== 3 || chance(0.5) ? steelBar(ch, { velocity: 56 }) : [],
        pad:   ({ ch }) => padBar(ch, 36),
      }) },
    // 6. Fade — the kick leaves first, then the sub; the tail is the last thing.
    { name: 'Fade', bars: 12, parts: section(12, {
        drums: ({ i }) => i < 4 ? drumBar({ open: false, hats: true }) : i < 6 ? drumBar({ kick: false, hats: true, off: true }) : [],
        sub:   ({ ch, i }) => i < 6 ? subBar(ch, Math.max(56, 84 - i * 5)) : [],
        stab:  ({ ch, i }) => i < 9 && i % 2 === 0 ? stabBar(ch, { velocity: Math.max(40, 66 - i * 3), second: false, open: true }) : [],
        pulse: ({ ch, i }) => i < 4 ? pulseBar(ch, { velocity: Math.max(28, 44 - i * 4) }) : [],
        steel: ({ ch, i }) => i < 6 && i % 2 === 0 ? steelBar(ch, { velocity: Math.max(34, 50 - i * 3) }) : [],
        pad:   ({ ch, i }) => padBar(ch, Math.max(14, 40 - i * 2)),
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  const fxBars = [
    dipInto('stab', at['Open'], 2), dipInto('pulse', at['Open'], 2),
    dipInto('stab', at['Open B'], 2), dipInto('pad', at['Open B'], 2), dipInto('drums', at['Open B'], 2),
    // Signal: the stab is a pulse behind a closed filter that opens a crack.
    bar('stab', at['Signal'], 8 * BPB, { filterHz: 380 }, [[0, 1], [8 * BPB, 0.75]], 1),
    // Carrier → Open: the filter opens across sixteen bars, which is the song's
    // whole first half arriving.
    bar('stab', at['Carrier'], 8 * BPB, { filterHz: 520 }, [[0, 0.75], [8 * BPB, 0.4]], 1),
    bar('stab', at['Open'], 16 * BPB, { filterHz: 700 }, [[0, 0.4], [16 * BPB * 0.6, 0.1], [16 * BPB, 0]], 1),
    // Static: only the tail; the pad breathes up.
    bar('pad', at['Static'], 8 * BPB, { filterHz: 600 }, [[0, 0.8], [10, 0.3], [8 * BPB - 4, 0.3], [8 * BPB, 0.7]], 1),
    bar('pulse', at['Static'], 8 * BPB, { gain: 0.5 }, [[0, 1], [8 * BPB, 1]], 1),
    // Open B is the peak.
    lift('stab', at['Open B'], 16 * BPB, { drive: 0.05, gain: 1.06 }),
    lift('drums', at['Open B'], 16 * BPB, { drive: 0.03, gain: 1.03 }),
    lift('sub', at['Open B'], 16 * BPB, { drive: 0.02, gain: 1.03 }),
    // Fade: everything closes down over twelve bars.
    bar('stab', at['Fade'], 12 * BPB, { filterHz: 480, gain: 0.6 }, [[0, 0], [12 * BPB * 0.5, 0.4], [12 * BPB, 1]], 1),
    bar('pad', at['Fade'], 12 * BPB, { filterHz: 420, gain: 0.55 }, [[0, 0], [12 * BPB, 1]], 1),
  ]

  const out = assemble({
    name: 'Cold Signal', bpm: BPM, bpb: BPB, key: 2, scale: 'minor', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.40,
  })

  const notesOf = key => out.project.dawProject.arrangementClips
    .filter(c => c.trackId === tracks.find(t => t.key === key).id).flatMap(c => c.notes)
  assertInRange('Sub (builtin-46 Sub Drone)', notesOf('sub'), 24, 60)
  assertInRange('Stab (builtin-27 Warm EP)', notesOf('stab'), 28, 103)
  assertInRange('Pulse (builtin-8 Metallic Pluck)', notesOf('pulse'), 36, 96)
  assertInRange('Steel (library sample, root G3)', notesOf('steel'), STEEL.loNote, STEEL.hiNote)
  // The sample preset travels IN the project, exactly as the piano roll's
  // Samples tab embeds it — the sound resolves through sampleId on any machine
  // whose library has seeded.
  out.project.dawProject.presets = [STEEL]
  return { out, tracks }
}

const { out, tracks } = build()
const label = 'Cold Signal'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))

console.log(`▸ "${label}" · ${BPM} BPM · D minor · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
for (const t of tracks) {
  const clips = out.project.dawProject.arrangementClips.filter(c => c.trackId === t.id)
  console.log(`  ${t.name}: ${clips.length} clips / ${clips.reduce((n, c) => n + c.notes.length, 0)} notes`)
}
console.log(`  ${out.project.dawProject.clipEffects.length} effect bars in the FX lane`)
console.log(`  → ${cfPath}`)
if (argv.includes('--dry')) process.exit(0)

const url = flagOf('url', 'http://localhost:3000')
console.log('▸ rendering through the studio engine…')
execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--url=${url}`, `--out=${join(OUT_DIR, label + '.mp3')}`, '--keep'],
  { cwd: ROOT, stdio: 'inherit' })

const masteredPath = join(OUT_DIR, `${label} (master).mp3`)
console.log('▸ mastering to -14 LUFS…')
try {
  execFileSync('ffmpeg', ['-y', '-i', join(OUT_DIR, label + '.wav'),
    '-af', 'loudnorm=I=-14:TP=-1.2:LRA=11', '-codec:a', 'libmp3lame', '-b:a', '256k', masteredPath],
    { stdio: ['ignore', 'ignore', 'pipe'] })
  console.log(`  → ${masteredPath}`)
} catch (e) {
  console.log('  (ffmpeg mastering pass failed — the raw bounce above is still valid)', e.message.slice(0, 120))
}
