// "Low Ceiling" — C♯ minor, 86 BPM, half-time. The heavy, slow one.
//
// Deliberately built to not resemble "Undertow". That track moves: 122 BPM,
// shuffled sixteenths, a bass riff that skips around the bar. This one hangs.
// Everything is long, the drums land twice a bar, and the harmony descends
// instead of leaping. If the set converges on one sound the whole exercise
// fails, so the differences are structural rather than cosmetic:
//
//   Undertow            Low Ceiling
//   122, two-step       86, half-time
//   rootless 9/11s in   a LAMENT BASS: the roots walk down C♯–B–A–G♯ and the
//   a fixed A3–A4 band  voicings above them descend in parallel, then reset
//   Rhodes stabs        Warm EP, sustained, never struck twice in a bar
//   house kit, 16ths    lo-fi kit, kick and rim only
//   —                   a church organ that appears once, at the climax
//
// THE HARMONY. i9 – ♭VII9 – ♭VImaj9 – V7♭9 in C♯ minor, two bars each. The
// point is the voice leading: every upper voice steps down one or two semitones
// per chord for the whole loop, so the eight bars are one long descent that
// snaps back up on the return to the tonic. The lament is in the top as much as
// in the bass. That descent is why a four-chord loop can hold two minutes
// without a melody over it.
//
// THE ARC. 48 bars, about 2:14. The climax is not the loudest thing that
// happens — it is the only place the church organ plays. Contrast is bought
// with the "Hollow" section immediately before it, where everything rhythmic
// leaves and the filter shuts down.

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

const BPM = 86, BPB = 4
const rand = rng(4471)
const { jitter, vary, chance } = feel(rand, BPM)

// ── Harmony: the lament ─────────────────────────────────────────────────────
// Upper voices descend in parallel through the whole loop:
//   [64,68,71,75] → [63,66,69,73] → [61,64,68,71] → [60,63,66,69] → back up.
// organ sits an octave under the EP; bass and sub carry the descending roots.
const Cm9   = { name: 'C#m9',   voicing: [64, 68, 71, 75], bass: 49, sub: 37 } // E G# B D#  / C#
const B9    = { name: 'B9',     voicing: [63, 66, 69, 73], bass: 47, sub: 35 } // D# F# A C# / B
const Amaj9 = { name: 'Amaj9',  voicing: [61, 64, 68, 71], bass: 45, sub: 33 } // C# E G# B  / A
const Gs7b9 = { name: 'G#7b9',  voicing: [60, 63, 66, 69], bass: 44, sub: 32 } // C D# F# A  / G#

// Two bars per chord — so the loop is eight bars and nothing hurries.
const LOOP = [Cm9, Cm9, B9, B9, Amaj9, Amaj9, Gs7b9, Gs7b9]

// ── Layers ──────────────────────────────────────────────────────────────────
// The sub holds one note for the chord's full two bars: the "low ceiling" the
// track is named for. Struck on the first bar only, left to ring through.
const subBar = (ch, secondBar, velocity = 84) =>
  secondBar ? [] : [N(ch.sub, 0 + jitter(5), BPB * 2 - 0.2, vary(velocity, 4))]

// The bass is sparse on purpose — three notes across two bars, all long. Where
// Undertow's bass is the hook, this one is just weight that moves.
const bassBar = (ch, secondBar) => secondBar
  ? [N(ch.bass + 7, 1.5 + jitter(9), 1.6, vary(66, 7))]                 // the fifth, late, once
  : [N(ch.bass, 0 + jitter(7), 2.4, vary(88, 6)),
     N(ch.bass, 3.25 + jitter(9), 0.6, vary(70, 8))]

// Sustained chords, struck once per chord and held. Voices are rolled apart by
// a few milliseconds so four notes don't arrive as one synthetic block.
const epBar = (ch, secondBar, velocity = 62) => secondBar ? [] :
  ch.voicing.map((p, i) => N(p, 0 + jitter(11) + i * 0.02, BPB * 2 - 0.3, vary(velocity - i * 3, 6)))

// A second, quieter strike halfway through the chord — used only in the later
// sections, so the same progression feels more active without getting faster.
const epEcho = (ch, secondBar) => secondBar
  ? ch.voicing.map((p, i) => N(p, 2 + jitter(11) + i * 0.02, 1.7, vary(42 - i * 3, 5))) : []

const padBar = (ch, velocity = 44, octave = 0) =>
  ch.voicing.map(p => N(p + octave, 0, BPB, vary(velocity, 4)))

// The organ appears exactly once in the track, an octave below the EP.
const organBar = (ch, secondBar, velocity = 54) => secondBar ? [] :
  ch.voicing.map((p, i) => N(p - 12, 0 + jitter(14) + i * 0.03, BPB * 2 - 0.2, vary(velocity - i * 4, 5)))

// ── Drums: half-time ────────────────────────────────────────────────────────
// Kick on 1, rim on 3, and almost nothing else. At 86 BPM a backbeat on 2 and 4
// would make it walk; putting it on 3 alone is what makes it sit down.
const K = 36, S = 38, RIM = 37, HH = 42, OH = 46
const LATE = 14 / 1000 * (BPM / 60)

function drumBar({ kick = true, back = true, hats = true, ghostKick = false, open = false, fill = false } = {}) {
  const out = []
  if (kick) {
    out.push(N(K, 0 + jitter(5), 0.6, vary(98, 5)))
    if (ghostKick) out.push(N(K, 2.75 + jitter(6), 0.5, vary(72, 8)))
  }
  if (back) {
    out.push(N(RIM, 2 + LATE + jitter(5), 0.4, vary(88, 5)))
    out.push(N(S, 2 + LATE + jitter(5), 0.35, vary(52, 6)))     // a little body under the rim
  }
  if (hats) {
    for (let i = 0; i < 8; i++) {                                 // 8ths, not 16ths — space
      if (i % 2 === 1 && !chance(0.45)) continue
      out.push(N(HH, i * 0.5 + (i % 2 ? 0.04 : 0) + jitter(8), 0.22, vary(i % 4 === 0 ? 50 : 34, 9)))
    }
  }
  if (open) out.push(N(OH, 3.5 + jitter(8), 0.5, vary(46, 6)))
  if (fill) {
    out.push(N(RIM, 3.0 + jitter(5), 0.25, vary(62, 8)))
    out.push(N(RIM, 3.5 + jitter(5), 0.25, vary(78, 8)))
  }
  return out
}

// ── Section builder (chords last two bars, so `secondBar` drives the layers) ─
function section(bars, layers) {
  const parts = { pad: [], sub: [], bass: [], ep: [], organ: [], drums: [] }
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
    { key: 'sub',   id: uid(), name: 'Sub',    presetId: 'builtin-46', volume: 0.58, color: '#6d28d9',
      rollFx: { sustain: 1.2 },
      effects: [eq3(4, -9, -14, 85, 500, 3500), compressor(-22, 4, 1)] },
    { key: 'bass',  id: uid(), name: 'Bass',   presetId: null, volume: 0.34, color: '#7c3aed',
      instrument: { type: 'poly', params: { waveform: 'triangle', attack: 0.02, decay: 0.5, sustain: 0.6, release: 0.5,
        detune: 0, filterType: 'lowpass', filterCutoff: 620, filterResonance: 1.1,
        lfoEnabled: false, lfoRate: 3, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(2, -4, -6, 100, 600, 4000), compressor(-24, 3, 1)] },
    { key: 'ep',    id: uid(), name: 'Warm EP', presetId: 'builtin-27', volume: 0.50, pan: -0.05, color: '#a78bfa',
      rollFx: { sustain: 1.6 },
      effects: [eq3(-7, -2, -1.5, 260, 900, 5000), reverb(0.34, 2.8, 0.03)] },
    { key: 'organ', id: uid(), name: 'Church Organ', presetId: 'builtin-44', volume: 0.26, pan: 0.07, color: '#c084fc',
      rollFx: { sustain: 0.9 },
      effects: [eq3(-5, -3, -4, 240, 800, 4500), reverb(0.42, 3.6, 0.04)] },
    { key: 'pad',   id: uid(), name: 'Pad',    presetId: null, volume: 0.18, pan: 0.05, color: '#c4b5fd',
      instrument: { type: 'poly', params: { waveform: 'sawtooth', attack: 1.6, decay: 1.2, sustain: 0.55, release: 3.2,
        detune: 16, filterType: 'lowpass', filterCutoff: 1200, filterResonance: 0.6,
        lfoEnabled: true, lfoRate: 0.09, lfoDepth: 0.22, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(-10, -5, 1, 320, 800, 6500), chorus(0.5, 0.25, 0.5), reverb(0.4, 4.0, 0.04)] },
    { key: 'drums', id: uid(), name: 'Drums',  presetId: null, isDrum: true, volume: 0.40, color: '#e879f9',
      instrument: { type: 'drum', params: { pack: 'lofi' } },
      effects: [eq3(1, -3, -5, 110, 550, 6500), compressor(-24, 5, 2), reverb(0.12, 0.7, 0.02)] },
  ]

  const sections = [
    // 1. Intro — pad alone, then the sub settles in underneath it.
    { name: 'Intro', bars: 8, parts: section(8, {
        pad: ({ ch, i }) => padBar(ch, i < 4 ? 32 : 42),
        sub: ({ ch, secondBar, i }) => i >= 4 ? subBar(ch, secondBar, 74) : [],
      }) },

    // 2. Sink — the EP states the harmony for the first time; bass underneath.
    { name: 'Sink', bars: 8, parts: section(8, {
        pad:  ({ ch }) => padBar(ch, 44),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar, 80),
        bass: ({ ch, secondBar }) => bassBar(ch, secondBar),
        ep:   ({ ch, secondBar }) => epBar(ch, secondBar, 58),
      }) },

    // 3. Half-Time — the drums arrive. Kick and rim, nothing more.
    { name: 'Half-Time', bars: 8, parts: section(8, {
        pad:  ({ ch }) => padBar(ch, 42),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        bass: ({ ch, secondBar }) => bassBar(ch, secondBar),
        ep:   ({ ch, secondBar }) => [...epBar(ch, secondBar, 64), ...epEcho(ch, secondBar)],
        drums: ({ i, last }) => drumBar({ ghostKick: i % 4 === 3, open: i % 4 === 1, fill: last }),
      }) },

    // 4. Hollow — everything rhythmic leaves and the filter shuts down. This is
    //    the whole reason the next section lands.
    { name: 'Hollow', bars: 8, parts: section(8, {
        pad: ({ ch }) => padBar(ch, 50),
        sub: ({ ch, secondBar, i }) => i < 6 ? subBar(ch, secondBar, 70) : [],
        ep:  ({ ch, secondBar, i }) => i >= 4 ? epBar(ch, secondBar, 44) : [],
      }) },

    // 5. Weight — the climax. The organ plays here and nowhere else in the track.
    { name: 'Weight', bars: 8, parts: section(8, {
        pad:   ({ ch }) => padBar(ch, 46),
        sub:   ({ ch, secondBar }) => subBar(ch, secondBar, 90),
        bass:  ({ ch, secondBar }) => bassBar(ch, secondBar),
        ep:    ({ ch, secondBar }) => [...epBar(ch, secondBar, 68), ...epEcho(ch, secondBar)],
        organ: ({ ch, secondBar }) => organBar(ch, secondBar, 56),
        drums: ({ i, last }) => drumBar({ ghostKick: true, open: i % 2 === 1, fill: last }),
      }) },

    // 6. Out — the organ holds on alone for a moment, then everything decays.
    { name: 'Out', bars: 8, parts: section(8, {
        pad:   ({ ch, i }) => padBar(ch, Math.max(18, 46 - i * 4)),
        sub:   ({ ch, secondBar, i }) => i < 4 ? subBar(ch, secondBar, 66) : [],
        organ: ({ ch, secondBar, i }) => i < 4 ? organBar(ch, secondBar, 44) : [],
        ep:    ({ ch, secondBar, i }) => i >= 4 && i < 6 ? epBar(ch, secondBar, 36) : [],
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  const fxBars = [
    // Dip into each arrival so the section change reads as a step, not a drift.
    dipInto('ep', at['Half-Time'], 2), dipInto('bass', at['Half-Time'], 2),
    dipInto('ep', at['Weight'], 3), dipInto('pad', at['Weight'], 3), dipInto('bass', at['Weight'], 3),

    // The EP opens up across "Sink" as the track wakes.
    bar('ep', at['Sink'], 8 * BPB, { filterHz: 700 },
        [[0, 1], [8 * BPB * 0.6, 0.4], [8 * BPB, 0]], 1),

    // "Hollow" closes right down and stays there — the low ceiling.
    bar('pad', at['Hollow'], 8 * BPB, { filterHz: 560, gain: 0.8 },
        [[0, 0], [5, 1], [8 * BPB - 6, 1], [8 * BPB, 0.15]], 1),
    bar('sub', at['Hollow'], 8 * BPB, { gain: 0.82 },
        [[0, 0], [4, 1], [8 * BPB - 4, 1], [8 * BPB, 0]], 1),

    // The climax: drive and a relative lift, with the organ underneath it.
    lift('ep', at['Weight'], 8 * BPB, { drive: 0.04, gain: 1.05 }),
    lift('organ', at['Weight'], 8 * BPB, { drive: 0.03, gain: 1.04 }),
    lift('drums', at['Weight'], 8 * BPB, { drive: 0.03, gain: 1.03 }),

    // And the long close.
    bar('pad', at['Out'], 8 * BPB, { filterHz: 520, gain: 0.6 },
        [[0, 0], [8 * BPB * 0.5, 0.55], [8 * BPB, 1]], 1),
  ]

  const out = assemble({
    name: 'Low Ceiling', bpm: BPM, bpb: BPB, key: 'C#', scale: 'minor', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.30,
  })

  const notesOf = key => out.project.dawProject.arrangementClips
    .filter(c => c.trackId === tracks.find(t => t.key === key).id).flatMap(c => c.notes)
  assertInRange('Sub (builtin-46 Sub Drone)', notesOf('sub'), 24, 60)
  assertInRange('Warm EP (builtin-27)', notesOf('ep'), 28, 103)
  assertInRange('Church Organ (builtin-44)', notesOf('organ'), 36, 96)
  return { out, tracks }
}

const { out, tracks } = build()
const label = 'Low Ceiling'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))

console.log(`▸ "${label}" · ${BPM} BPM · C# minor · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
for (const t of tracks) {
  const clips = out.project.dawProject.arrangementClips.filter(c => c.trackId === t.id)
  console.log(`  ${t.name}: ${clips.length} clips / ${clips.reduce((n, c) => n + c.notes.length, 0)} notes`)
}
console.log(`  ${out.project.dawProject.clipEffects.length} effect bars in the FX lane`)
console.log(`  → ${cfPath}`)
if (argv.includes('--dry')) process.exit(0)

const url = flagOf('url', 'http://localhost:4618')
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
