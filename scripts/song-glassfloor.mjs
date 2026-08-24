// "Glass Floor" — A Dorian, 124 BPM, four-on-the-floor. The bright, hypnotic one.
//
// Third of the set, and the one with the hardest constraint: it has to differ
// from BOTH of the others, not just from the last one. The three now separate
// on mode, form, texture, kit and even how they open:
//
//                Undertow          Low Ceiling        Glass Floor
//   tempo/feel   122 two-step      86 half-time       124 four-on-floor
//   mode         G natural minor   C♯ natural minor   A DORIAN (raised 6th)
//   harmony      4 chords, a       lament: voicings   a two-chord vamp that
//                backdoor swap     descend in parallel turns dark once a loop
//   texture      Rhodes stabs      sustained Warm EP  a 16th ARP
//   kit          house             lo-fi kick+rim     techno
//   opens with   a pad             a pad              DRUMS
//
// THE MODE. Dorian is the reason this one is not simply a third minor track:
// the raised 6th turns the IV into a major chord, so Am9 → D13 is bright and
// hypnotic where the other two are heavy. Then once per eight-bar loop it drops
// to Fmaj7♯11 — borrowed from plain A minor, the one note Dorian doesn't own —
// and the floor goes out from under it. That alternation is the whole idea, and
// it is why a two-chord vamp can carry two minutes.
//
// THE TEXTURE. The arp is the moving part. Arps are rhythmic texture rather
// than melody — it cycles chord tones on a fixed contour and never shapes a
// phrase — so this stays inside the no-lead rule while still having something
// that travels. Its filter opens and closes with the arc; in the break it is
// almost entirely shut.

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

const BPM = 124, BPB = 4
const rand = rng(2286)
const { jitter, vary, chance } = feel(rand, BPM)

// ── Harmony ─────────────────────────────────────────────────────────────────
// Am9 and D13 are both Dorian (the F♯ in D13 is the raised 6th). Fmaj7♯11 is
// borrowed from natural A minor — the moment the brightness drops away.
// arp: the cycle of chord tones the arpeggio runs, low to high.
const Am9    = { name: 'Am9',       voicing: [60, 64, 67, 71], bass: 45, sub: 33, arp: [64, 67, 71, 76] } // C E G B / A
const D13    = { name: 'D13',       voicing: [57, 60, 64, 66], bass: 50, sub: 38, arp: [64, 66, 69, 72] } // A C E F# / D
const Fmaj11 = { name: 'Fmaj7#11',  voicing: [57, 60, 64, 71], bass: 41, sub: 29, arp: [60, 64, 67, 71] } // A C E B / F

// Two bars each: Am9 – D13 – Am9 – Fmaj7♯11 over eight bars. The vamp sits on
// the first three and the last two bars are the turn.
const LOOP = [Am9, Am9, D13, D13, Am9, Am9, Fmaj11, Fmaj11]

// ── The arp ─────────────────────────────────────────────────────────────────
// Straight sixteenths, up-down over four chord tones. Fixed contour on purpose:
// it is a texture, not a phrase. Velocity accents the downbeat of each group so
// it breathes instead of buzzing.
const ARP_ORDER = [0, 1, 2, 3, 2, 1, 0, 1]     // up and back, eight steps per bar (8ths)
const arpBar = (ch, { sixteenths = false, velocity = 66, octave = 0 } = {}) => {
  const steps = sixteenths ? 16 : 8
  const out = []
  for (let s = 0; s < steps; s++) {
    const tone = ch.arp[ARP_ORDER[s % ARP_ORDER.length] % ch.arp.length]
    const beat = s * (BPB / steps)
    const accent = s % (steps / 4) === 0 ? 14 : 0
    out.push(N(tone + octave, beat + jitter(6), (BPB / steps) * 0.85, vary(velocity + accent, 8)))
  }
  return out
}

// ── Bass: rolling offbeats ──────────────────────────────────────────────────
// House bass answers the kick — root on every "and", short, never on the beat
// itself. Completely unlike Undertow's syncopated riff or Low Ceiling's long tones.
const bassBar = (ch, { octaveLift = false } = {}) => {
  const out = []
  for (let b = 0; b < 4; b++) {
    const pop = octaveLift && b === 3 ? 12 : 0
    out.push(N(ch.bass + pop, b + 0.5 + jitter(6), 0.42, vary(b === 0 ? 92 : 82, 7)))
  }
  return out
}

const subBar = (ch, velocity = 84) => [N(ch.sub, 0 + jitter(4), BPB - 0.15, vary(velocity, 4))]
const padBar = (ch, velocity = 42, octave = 0) => ch.voicing.map(p => N(p + octave, 0, BPB, vary(velocity, 4)))

// A chord swell held across the two bars of a chord, used only late on.
const chordBar = (ch, secondBar, velocity = 54) => secondBar ? [] :
  ch.voicing.map((p, i) => N(p, 0 + jitter(12) + i * 0.02, BPB * 2 - 0.3, vary(velocity - i * 3, 5)))

// ── Drums: four-on-the-floor ────────────────────────────────────────────────
// Kick every beat, clap on 2 and 4, open hat on every offbeat — the offbeat hat
// is what makes a four-four kick feel like it is moving rather than stamping.
const K = 36, S = 38, CLAP = 39, HH = 42, OH = 46
const LATE = 8 / 1000 * (BPM / 60)

function drumBar({ kick = true, clap = true, offHat = true, hats = true, fill = false, ride = false } = {}) {
  const out = []
  if (kick) for (let b = 0; b < 4; b++) out.push(N(K, b + jitter(3), 0.45, vary(b === 0 ? 104 : 98, 4)))
  if (clap) for (const b of [1, 3]) out.push(N(CLAP, b + LATE + jitter(4), 0.35, vary(88, 5)))
  if (offHat) for (let b = 0; b < 4; b++) out.push(N(OH, b + 0.5 + jitter(5), 0.3, vary(58, 6)))
  if (hats) {
    for (let i = 0; i < 16; i++) {
      if (i % 4 === 2) continue                       // leave room for the open hat
      if (i % 2 === 1 && !chance(ride ? 0.7 : 0.35)) continue
      out.push(N(HH, i * 0.25 + jitter(5), 0.16, vary(i % 4 === 0 ? 48 : 32, 9)))
    }
  }
  if (fill) {
    out.push(N(CLAP, 3.5 + jitter(4), 0.2, vary(74, 8)))
    out.push(N(S, 3.75 + jitter(4), 0.2, vary(92, 8)))
  }
  return out
}

function section(bars, layers) {
  const parts = { pad: [], sub: [], bass: [], arp: [], chord: [], drums: [] }
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
    { key: 'sub',   id: uid(), name: 'Sub',    presetId: 'builtin-46', volume: 0.56, color: '#0891b2',
      rollFx: { sustain: 0.4 },
      effects: [eq3(4, -8, -13, 90, 500, 4000), compressor(-21, 4, 1)] },
    { key: 'bass',  id: uid(), name: 'Bass',   presetId: null, volume: 0.40, color: '#06b6d4',
      instrument: { type: 'poly', params: { waveform: 'square', attack: 0.004, decay: 0.16, sustain: 0.3, release: 0.1,
        detune: 3, filterType: 'lowpass', filterCutoff: 780, filterResonance: 2.4,
        lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(2, -3, -3, 110, 650, 4500), compressor(-22, 4, 1)] },
    { key: 'arp',   id: uid(), name: 'Arp',    presetId: 'builtin-8', volume: 0.30, pan: 0.24, color: '#22d3ee',
      rollFx: { sustain: 0.1 },
      effects: [eq3(-9, -2, -1, 300, 1100, 6000), reverb(0.24, 1.4, 0.02)] },
    { key: 'chord', id: uid(), name: 'Chords', presetId: 'builtin-27', volume: 0.34, pan: -0.22, color: '#67e8f9',
      rollFx: { sustain: 1.1 },
      effects: [eq3(-8, -2, -2, 280, 900, 5000), reverb(0.36, 2.6, 0.03)] },
    { key: 'pad',   id: uid(), name: 'Pad',    presetId: null, volume: 0.17, pan: -0.1, color: '#a5f3fc',
      instrument: { type: 'poly', params: { waveform: 'sawtooth', attack: 1.0, decay: 1.0, sustain: 0.6, release: 2.6,
        detune: 15, filterType: 'lowpass', filterCutoff: 1600, filterResonance: 0.7,
        lfoEnabled: true, lfoRate: 0.12, lfoDepth: 0.2, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(-10, -4, 1.5, 320, 850, 7000), chorus(0.45, 0.3, 0.45), reverb(0.34, 3.0, 0.03)] },
    { key: 'drums', id: uid(), name: 'Drums',  presetId: null, isDrum: true, volume: 0.42, color: '#f0abfc',
      instrument: { type: 'drum', params: { pack: 'techno' } },
      effects: [eq3(1.5, -3, -3, 120, 600, 7000), compressor(-23, 5, 2), reverb(0.06, 0.35, 0.01)] },
  ]

  const sections = [
    // 1. Floor — this one opens with the drums, not a pad. Kick and hats only;
    //    no harmony has been stated yet at all.
    { name: 'Floor', bars: 8, parts: section(8, {
        drums: ({ i }) => drumBar({ clap: i >= 4, offHat: i >= 4, hats: true }),
        sub:   ({ ch, i }) => i >= 6 ? subBar(ch, 72) : [],
      }) },

    // 2. Lift — the arp states the harmony for the first time, filtered down.
    { name: 'Lift', bars: 8, parts: section(8, {
        drums: ({ last }) => drumBar({ fill: last }),
        sub:  ({ ch }) => subBar(ch, 80),
        bass: ({ ch, i }) => i >= 4 ? bassBar(ch) : [],
        arp:  ({ ch }) => arpBar(ch, { velocity: 58 }),
        pad:  ({ ch, i }) => i >= 4 ? padBar(ch, 34) : [],
      }) },

    // 3. Floor A — everything, arp doubled to sixteenths.
    { name: 'Floor A', bars: 12, parts: section(12, {
        drums: ({ i, last }) => drumBar({ ride: i % 4 >= 2, fill: last }),
        sub:  ({ ch }) => subBar(ch),
        bass: ({ ch, i }) => bassBar(ch, { octaveLift: i % 4 === 3 }),
        arp:  ({ ch }) => arpBar(ch, { sixteenths: true, velocity: 64 }),
        pad:  ({ ch }) => padBar(ch, 40),
      }) },

    // 4. Break — the floor goes. Pad and a nearly-shut arp; the sub drops out
    //    halfway so the return has somewhere to arrive from.
    { name: 'Break', bars: 8, parts: section(8, {
        pad:   ({ ch }) => padBar(ch, 50),
        arp:   ({ ch }) => arpBar(ch, { velocity: 44 }),
        chord: ({ ch, secondBar, i }) => i >= 2 ? chordBar(ch, secondBar, 50) : [],
        sub:   ({ ch, i }) => i < 4 ? subBar(ch, 66) : [],
      }) },

    // 5. Floor B — back in, with the sustained chords now under the arp.
    { name: 'Floor B', bars: 12, parts: section(12, {
        drums: ({ i, last }) => drumBar({ ride: true, fill: last || i === 5 }),
        sub:  ({ ch }) => subBar(ch),
        bass: ({ ch, i }) => bassBar(ch, { octaveLift: i % 2 === 1 }),
        arp:  ({ ch }) => arpBar(ch, { sixteenths: true, velocity: 60 }),
        chord: ({ ch, secondBar, i }) => i >= 6 ? chordBar(ch, secondBar, 50) : [],
        pad:  ({ ch }) => padBar(ch, 40),
      }) },

    // 6. Ceiling — the peak. The arp jumps an octave, which is the only new
    //    register in the track, and everything rides up underneath it.
    { name: 'Ceiling', bars: 8, parts: section(8, {
        drums: ({ last }) => drumBar({ ride: true, fill: last }),
        sub:  ({ ch }) => subBar(ch, 92),
        bass: ({ ch }) => bassBar(ch, { octaveLift: true }),
        arp:  ({ ch, i }) => [...arpBar(ch, { sixteenths: true, velocity: 66 }),
                              ...arpBar(ch, { velocity: i < 2 ? 46 : 58, octave: 12 })],
        chord: ({ ch, secondBar }) => chordBar(ch, secondBar, 56),
        pad:  ({ ch }) => padBar(ch, 44),
      }) },

    // 7. Out — the drums leave first, then everything else decays.
    { name: 'Out', bars: 8, parts: section(8, {
        drums: ({ i }) => i < 2 ? drumBar({ clap: false, ride: false }) : [],
        sub:   ({ ch, i }) => i < 4 ? subBar(ch, Math.max(52, 78 - i * 8)) : [],
        arp:   ({ ch, i }) => i < 5 ? arpBar(ch, { velocity: Math.max(28, 54 - i * 6) }) : [],
        pad:   ({ ch, i }) => padBar(ch, Math.max(18, 46 - i * 4)),
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  const fxBars = [
    dipInto('arp', at['Floor A'], 2), dipInto('bass', at['Floor A'], 2),
    dipInto('arp', at['Floor B'], 2), dipInto('pad', at['Floor B'], 2),
    dipInto('arp', at['Ceiling'], 2), dipInto('drums', at['Ceiling'], 2), dipInto('chord', at['Ceiling'], 2),

    // The arp opens across "Lift" — the track waking up.
    bar('arp', at['Lift'], 8 * BPB, { filterHz: 480 },
        [[0, 1], [8 * BPB * 0.65, 0.35], [8 * BPB, 0]], 1),

    // In the break the arp is almost shut, then re-opens on the way out.
    bar('arp', at['Break'], 8 * BPB, { filterHz: 420, gain: 0.85 },
        [[0, 0], [4, 1], [8 * BPB - 6, 1], [8 * BPB, 0.1]], 1),
    bar('pad', at['Break'], 8 * BPB, { filterHz: 780 },
        [[0, 0], [6, 0.9], [8 * BPB, 0.3]], 1),

    // The peak.
    lift('arp', at['Ceiling'], 8 * BPB, { drive: 0.04, gain: 1.08 }),
    lift('bass', at['Ceiling'], 8 * BPB, { drive: 0.05, gain: 1.05 }),
    lift('drums', at['Ceiling'], 8 * BPB, { drive: 0.03, gain: 1.03 }),

    bar('pad', at['Out'], 8 * BPB, { filterHz: 560, gain: 0.65 },
        [[0, 0], [8 * BPB * 0.5, 0.55], [8 * BPB, 1]], 1),
  ]

  const out = assemble({
    name: 'Glass Floor', bpm: BPM, bpb: BPB, key: 'A', scale: 'dorian', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.40,
  })

  const notesOf = key => out.project.dawProject.arrangementClips
    .filter(c => c.trackId === tracks.find(t => t.key === key).id).flatMap(c => c.notes)
  assertInRange('Sub (builtin-46 Sub Drone)', notesOf('sub'), 24, 60)
  assertInRange('Arp (builtin-8 Metallic Pluck)', notesOf('arp'), 36, 96)
  assertInRange('Chords (builtin-27 Warm EP)', notesOf('chord'), 28, 103)
  return { out, tracks }
}

const { out, tracks } = build()
const label = 'Glass Floor'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))

console.log(`▸ "${label}" · ${BPM} BPM · A dorian · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
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
