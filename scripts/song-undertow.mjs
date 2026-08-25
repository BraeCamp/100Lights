// "Undertow" — C minor, 88 BPM. Downtempo dub: half-time kick, rimshot on three,
// bass that lands late and leaves space, and a stereo field that MOVES.
//
// THE POINT OF IT is the pan. In this piece the stereo image is a structural
// device rather than a mixing decision: the electric piano starts hard left and
// the organ hard right, and across the two "Wide" sections they WALK PAST EACH
// OTHER — the EP ends up on the right and the organ on the left. The two voices
// answer each other in alternating bars, so as they cross you hear the
// conversation physically change sides around you. It is the same eight-bar loop
// underneath; what develops is where it is coming from.
//
// THE SECOND DEVICE is the filter, used as a tide. Nothing here has a melody, so
// the arc has to come from brightness and space. "Tide" opens a closed low-pass
// over eight bars; "Undertow" pulls everything back under one — the whole band
// ducks beneath 600Hz and rises out of it; "Ebb" closes it again for good. The
// filter is doing what a lead line would do in another piece.
//
// THE HARMONY. i – VI – III – VII in C minor (Cm9 – A♭maj9 – E♭maj9 – B♭9sus),
// two bars each. A descending stepwise bass with the last chord refusing to
// resolve, so the loop keeps folding back on itself. Ninths throughout keep it
// hazy rather than plain. No lead line anywhere, per the standing rule — and in
// dub that is the idiom anyway: the space between the parts is the music.
//
// Deliberately unlike the others in this set: the slowest, the only one in
// half-time, and the only one where the arrangement develops through movement in
// the stereo field instead of through added parts.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, rng, feel, N, assemble, bar } from './song-kit.mjs'
import { kick, snare, hatDual, subBass, bass as bassVoice, warmEp, organ, pad } from './apollo-voices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
mkdirSync(OUT_DIR, { recursive: true })
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 88, BPB = 4
const rand = rng(41190)
const { jitter, vary, chance } = feel(rand, BPM)

// ── Harmony ─────────────────────────────────────────────────────────────────
// Rootless upper voicings; the root lives in the bass and the sub an octave down.
const Cm9   = { name: 'Cm9',    voicing: [63, 67, 70, 74], bass: 48, sub: 36, tones: [48, 55, 51] }
const Ab9   = { name: 'A♭maj9', voicing: [60, 63, 67, 70], bass: 44, sub: 32, tones: [44, 51, 48] }
// E♭'s sub sits an octave UP from where the descending contour wants it. At MIDI
// 27 it is 38.9Hz, which no laptop speaker and few headphones reproduce at all —
// measured, the Sub track put 48% of its energy below 60Hz and NOTHING above
// 300Hz, so it was the loudest track in the mix and inaudible. Keeping the sub
// line inside one octave (52–78Hz) is standard practice for exactly this reason.
const Eb9   = { name: 'E♭maj9', voicing: [67, 70, 74, 77], bass: 39, sub: 39, tones: [39, 46, 43] }
const Bb9   = { name: 'B♭9sus', voicing: [62, 65, 70, 72], bass: 46, sub: 34, tones: [46, 53, 51] }

const LOOP = [Cm9, Cm9, Ab9, Ab9, Eb9, Eb9, Bb9, Bb9]

// ── Bass ────────────────────────────────────────────────────────────────────
// Dub bass is about what it leaves out. Root on the "and" of one rather than the
// downbeat, so the kick and the bass never land together — that gap is the genre.
const FIGURE = [
  [0, 0.50, 0.85, 100],
  [0, 1.75, 0.40,  78],
  [2, 2.50, 0.70,  88],
  [1, 3.50, 0.45,  74],
]
const FIGURE_BARE = [FIGURE[0], FIGURE[2]]

const bassBar = (ch, { pattern = FIGURE } = {}) =>
  pattern.map(([tone, b, d, v]) => N(ch.tones[tone], b + jitter(9), d, vary(v, 8)))

const subBar = (ch, secondBar, velocity = 92) =>
  secondBar ? [] : [N(ch.sub, 0.5 + jitter(5), BPB * 2 - 0.8, vary(velocity, 4))]

// ── The two voices that trade sides ─────────────────────────────────────────
// They alternate bars: the EP answers the organ, never together. That is what
// makes the pan walk audible — one side speaks, then the other, and over the
// piece the sides swap.
const EP_FIG   = [[1.5, 1.10, 68], [3.0, 0.70, 58]]
const ORGAN_FIG = [[0.5, 1.30, 60], [2.75, 0.85, 52]]

const chordBar = (ch, pattern, { spread = 0.010, drop = 3 } = {}) => {
  const out = []
  for (const [b, d, v] of pattern) {
    ch.voicing.forEach((p, i) => out.push(N(p, b + jitter(10) + i * spread, d, vary(v - i * drop, 7))))
  }
  return out
}

const padBar = (ch, velocity = 30) =>
  ch.voicing.map((p, i) => N(p - 12 + (i === 0 ? 0 : 0), 0 + jitter(6), BPB, vary(velocity - i * 2, 4)))

// ── Drums: half-time ────────────────────────────────────────────────────────
const KICK = 24, RIM = 48, HAT = 60
const LATE = 11 / 1000 * (BPM / 60)   // rimshot drags — dub sits behind the beat

const kickBar = ({ push = false } = {}) => {
  const out = [N(KICK, 0 + jitter(3), 0.5, vary(108, 4))]
  if (push) out.push(N(KICK, 2.75 + jitter(4), 0.45, vary(88, 5)))
  return out
}
/** Backbeat on THREE, not two and four — that is what makes it half-time. */
const rimBar = ({ fill = false } = {}) => {
  const out = [N(RIM, 2 + LATE + jitter(5), 0.28, vary(92, 5))]
  if (fill) out.push(N(RIM, 3.5 + jitter(5), 0.22, vary(66, 8)))
  return out
}
const hatBar = ({ sparse = false } = {}) => {
  const out = []
  for (let i = 0; i < 8; i++) {
    if (sparse && i % 2 === 0) continue
    if (!sparse && i % 2 === 0 && chance(0.25)) continue
    const open = i === 5
    out.push(N(HAT, i * 0.5 + jitter(6), open ? 0.30 : 0.06, vary(open ? 54 : 40, 9)))
  }
  return out
}

function section(bars, layers) {
  const parts = { kick: [], rim: [], hats: [], sub: [], bass: [], ep: [], organ: [], pad: [] }
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
  // Track pan stays CENTRED for the two trading voices: every bit of their
  // position comes from the pan graphs, so the walk is unambiguous and nothing
  // snaps back to a "home" side when a bar ends.
  const tracks = [
    { key: 'kick',  id: uid(), name: 'Kick',  presetId: null, volume: 0.52, color: '#38bdf8',
      instrument: { type: 'apollo', params: kick() } },
    { key: 'rim',   id: uid(), name: 'Rim',   presetId: null, volume: 0.22, pan: -0.10, color: '#7dd3fc',
      instrument: { type: 'apollo', params: snare() } },
    { key: 'hats',  id: uid(), name: 'Hats',  presetId: null, volume: 0.13, pan: 0.22, color: '#bae6fd',
      instrument: { type: 'apollo', params: hatDual() } },
    { key: 'sub',   id: uid(), name: 'Sub',   presetId: null, volume: 0.54, color: '#22d3ee',
      instrument: { type: 'apollo', params: subBass() } },
    { key: 'bass',  id: uid(), name: 'Bass',  presetId: null, volume: 0.38, color: '#2dd4bf',
      instrument: { type: 'apollo', params: bassVoice() } },
    // The two trading voices carry the piece, so they sit forward. The first
    // pass had them at 0.30/0.24 under a 0.15 pad, and the pan walk measured
    // barely 0.05 of stereo balance — the gesture was there and inaudible. A
    // device you cannot hear is not a device.
    { key: 'ep',    id: uid(), name: 'EP',    presetId: null, volume: 0.38, pan: 0, color: '#a5f3fc',
      instrument: { type: 'apollo', params: warmEp() } },
    { key: 'organ', id: uid(), name: 'Organ', presetId: null, volume: 0.36, pan: 0, color: '#67e8f9',
      instrument: { type: 'apollo', params: organ() } },
    // And the pad drops back: it is wide and centred, so every dB of it fills
    // the middle of the image and washes the trade out.
    { key: 'pad',   id: uid(), name: 'Pad',   presetId: null, volume: 0.11, color: '#cffafe',
      instrument: { type: 'apollo', params: pad() } },
  ]

  const sections = [
    // 1. Tide — sub and pad under a closed filter. The song arriving from under water.
    { name: 'Tide', bars: 8, parts: section(8, {
        sub: ({ ch, secondBar }) => subBar(ch, secondBar, 80),
        pad: ({ ch }) => padBar(ch, 26),
        hats: ({ i }) => i >= 5 ? hatBar({ sparse: true }) : [],
      }) },

    // 2. Drift — the half-time beat, and the EP alone on the left.
    { name: 'Drift', bars: 8, parts: section(8, {
        kick: () => kickBar(),
        rim:  () => rimBar(),
        hats: () => hatBar({ sparse: true }),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        bass: ({ ch, i }) => i >= 2 ? bassBar(ch, { pattern: i < 5 ? FIGURE_BARE : FIGURE }) : [],
        ep:   ({ ch, i }) => i % 2 === 0 ? chordBar(ch, EP_FIG) : [],
        pad:  ({ ch }) => padBar(ch, 28),
      }) },

    // 3. Wide A — the organ answers from the right, and the crossing begins.
    { name: 'Wide A', bars: 12, parts: section(12, {
        kick: ({ i }) => kickBar({ push: i % 4 === 3 }),
        rim:  ({ last }) => rimBar({ fill: last }),
        hats: () => hatBar(),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        bass: ({ ch }) => bassBar(ch),
        ep:   ({ ch, i }) => i % 2 === 0 ? chordBar(ch, EP_FIG) : [],
        organ:({ ch, i }) => i % 2 === 1 ? chordBar(ch, ORGAN_FIG) : [],
        pad:  ({ ch }) => padBar(ch, 32),
      }) },

    // 4. Undertow — the whole band pulled under one low-pass, and back out.
    { name: 'Undertow', bars: 8, parts: section(8, {
        kick: ({ i }) => i < 2 || i >= 6 ? kickBar() : [],
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar, 86),
        bass: ({ ch, i }) => i >= 4 ? bassBar(ch, { pattern: FIGURE_BARE }) : [],
        ep:   ({ ch, i }) => i % 2 === 0 ? chordBar(ch, [[1.5, 2.2, 60]]) : [],
        organ:({ ch, i }) => i % 2 === 1 ? chordBar(ch, [[0.5, 2.6, 54]]) : [],
        pad:  ({ ch }) => padBar(ch, 36),
      }) },

    // 5. Wide B — the same conversation, now coming from the opposite sides.
    { name: 'Wide B', bars: 12, parts: section(12, {
        kick: ({ i }) => kickBar({ push: i % 4 !== 0 }),
        rim:  ({ i, last }) => rimBar({ fill: last || i === 5 }),
        hats: () => hatBar(),
        sub:  ({ ch, secondBar }) => subBar(ch, secondBar),
        bass: ({ ch }) => bassBar(ch),
        ep:   ({ ch, i }) => i % 2 === 0 ? chordBar(ch, EP_FIG) : [],
        organ:({ ch, i }) => i % 2 === 1 ? chordBar(ch, ORGAN_FIG) : [],
        pad:  ({ ch }) => padBar(ch, 34),
      }) },

    // 6. Ebb — the filter closes for good and the tide goes back out.
    { name: 'Ebb', bars: 8, parts: section(8, {
        kick: ({ i }) => i < 4 ? kickBar() : [],
        rim:  ({ i }) => i < 3 ? rimBar() : [],
        hats: ({ i }) => i < 5 ? hatBar({ sparse: true }) : [],
        sub:  ({ ch, secondBar, i }) => i < 6 ? subBar(ch, secondBar, 74) : [],
        bass: ({ ch, i }) => i < 4 ? bassBar(ch, { pattern: FIGURE_BARE }) : [],
        ep:   ({ ch, i }) => i < 4 && i % 2 === 0 ? chordBar(ch, [[1.5, 1.8, 54]]) : [],
        pad:  ({ ch, i }) => padBar(ch, Math.max(12, 32 - i * 3)),
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  const W = n => n * BPB       // bars → beats
  const fxBars = [
    // ── THE PAN WALK ────────────────────────────────────────────────────────
    // Each voice is held on its side by a bar for every section it plays in, so
    // there is never a moment where the graph ends and the sound jumps back to
    // centre. Across Wide A they cross; in Wide B they stay swapped.
    // A graph runs 0 (neutral, which for pan is dead centre) to 1 (the bar's
    // target), and normToParam CLAMPS it there — so a single bar can only move a
    // voice between centre and one side. A crossing therefore takes two bars:
    // one walking off the old side into the middle, one walking out to the new.
    // Splitting it at the halfway point is also the honest description of the
    // gesture — the voices meet in the centre and keep going.
    bar('ep',    at['Drift'],    W(8),  { pan: -0.85 }, [[0, 0], [6, 1], [W(8), 1]], 0),
    bar('ep',    at['Wide A'],          W(6),  { pan: -0.85 }, [[0, 1], [W(6), 0]], 0),
    bar('ep',    at['Wide A'] + W(6),   W(6),  { pan:  0.82 }, [[0, 0], [W(6), 1]], 0),
    bar('ep',    at['Undertow'], W(8),  { pan:  0.82 }, [[0, 1], [W(8), 1]], 0),
    bar('ep',    at['Wide B'],   W(12), { pan:  0.82 }, [[0, 1], [W(12), 1]], 0),
    bar('ep',    at['Ebb'],      W(8),  { pan:  0.45 }, [[0, 1], [W(8), 0.2]], 0),

    bar('organ', at['Wide A'],          W(6),  { pan:  0.84 }, [[0, 1], [W(6), 0]], 0),
    bar('organ', at['Wide A'] + W(6),   W(6),  { pan: -0.84 }, [[0, 0], [W(6), 1]], 0),
    bar('organ', at['Undertow'], W(8),  { pan: -0.84 }, [[0, 1], [W(8), 1]], 0),
    bar('organ', at['Wide B'],   W(12), { pan: -0.84 }, [[0, 1], [W(12), 1]], 0),

    // ── THE FILTER TIDE ─────────────────────────────────────────────────────
    // Tide: the pad rises out of a closed low-pass over the whole section.
    bar('pad',  at['Tide'], W(8), { filterHz: 430 }, [[0, 1], [W(5), 0.55], [W(8), 0]], 1),
    // Tide starts genuinely far away. The first pass measured only 3.2 dB across
    // the whole piece, which is not an arc, it is a plateau — so the opening
    // pulls right back and the Wide sections are allowed to be the loud thing.
    bar('sub',  at['Tide'], W(8), { gain: 0.16 },    [[0, 1], [W(6), 0.35], [W(8), 0]], 1),
    bar('pad',  at['Tide'], W(8), { gain: 0.22 },    [[0, 1], [W(6), 0.3],  [W(8), 0]], 4),
    bar('hats', at['Tide'], W(8), { gain: 0.45 },    [[0, 1], [W(8), 0.2]], 4),

    // Undertow: the whole band ducks under one filter and rises back out of it.
    // Four tracks, one shape — that is what makes it read as a single gesture.
    bar('bass', at['Undertow'], W(8), { filterHz: 480 }, [[0, 0], [W(2), 1], [W(6), 1], [W(8), 0.1]], 1),
    bar('ep',   at['Undertow'], W(8), { filterHz: 620, gain: 0.88 }, [[0, 0], [W(2), 1], [W(6), 1], [W(8), 0.1]], 1),
    bar('organ',at['Undertow'], W(8), { filterHz: 640, gain: 0.88 }, [[0, 0], [W(2), 1], [W(6), 1], [W(8), 0.1]], 1),
    bar('pad',  at['Undertow'], W(8), { filterHz: 700 }, [[0, 0], [W(2), 1], [W(6), 1], [W(8), 0.05]], 1),

    // Wide sections breathe: a slow low-pass swell rather than a static tone.
    bar('pad',  at['Wide A'], W(12), { filterHz: 1400 }, [[0, 0.7], [W(6), 0], [W(12), 0.5]], 1),
    bar('pad',  at['Wide B'], W(12), { filterHz: 1600 }, [[0, 0.5], [W(5), 0], [W(12), 0.6]], 1),
    bar('hats', at['Wide B'], W(12), { highpassHz: 900 }, [[0, 1], [W(3), 0], [W(12), 0]], 1),

    // Ebb: everything closes down together, the tide going back out.
    bar('pad',   at['Ebb'], W(8), { filterHz: 520 }, [[0, 0], [W(4), 0.6], [W(8), 1]], 1),
    bar('bass',  at['Ebb'], W(8), { filterHz: 600 }, [[0, 0], [W(4), 0.7], [W(8), 1]], 1),
    bar('hats',  at['Ebb'], W(8), { filterHz: 3200, gain: 0.7 }, [[0, 0], [W(8), 1]], 1),
    // The tide goes all the way out rather than stopping at "quieter".
    bar('sub',   at['Ebb'], W(8), { gain: 0.20 }, [[0, 0], [W(5), 0.5], [W(8), 1]], 4),
    bar('pad',   at['Ebb'], W(8), { gain: 0.30 }, [[0, 0], [W(4), 0.4], [W(8), 1]], 4),
    bar('ep',    at['Ebb'], W(8), { gain: 0.40 }, [[0, 0], [W(4), 0.6], [W(8), 1]], 4),

    // ── The Wide sections are the loud thing ────────────────────────────────
    bar('ep',    at['Wide B'], W(12), { gain: 1.12 }, [[0, 0.4], [W(4), 1], [W(12), 1]], 4),
    bar('organ', at['Wide B'], W(12), { gain: 1.12 }, [[0, 0.4], [W(4), 1], [W(12), 1]], 4),
    bar('bass',  at['Wide B'], W(12), { gain: 1.10, drive: 0.05 }, [[0, 0.3], [W(4), 1], [W(12), 1]], 4),

    // ── MAKING THE SUB TRANSLATE ────────────────────────────────────────────
    // Drive across the whole song, because a pure low sine does not survive
    // small speakers. Measured, the Sub track had 48% of its energy under 60Hz
    // and none at all above 300Hz — loud on paper, silent on a laptop. Drive
    // adds harmonics at 2x and 3x the fundamental, which land at 100–230Hz where
    // even a phone speaker can reproduce them, and the ear infers the missing
    // fundamental from them. This is what "the sub isn't making sound" needed:
    // not more level (it was already the loudest track) but something audible.
    bar('sub', 0, W(56), { drive: 0.34 }, [[0, 1], [W(56), 1]], 5),

    // ── SPACE ───────────────────────────────────────────────────────────────
    // Dub throws: delay swells at the seams, never running through a section.
    bar('ep',    at['Wide A'] + W(11), W(1), { delayWet: 0.42 }, [[0, 0], [2, 1], [W(1), 0.2]], 2),
    bar('organ', at['Undertow'] + W(7), W(1), { delayWet: 0.46 }, [[0, 0], [2, 1], [W(1), 0.2]], 2),
    bar('ep',    at['Ebb'] + W(3), W(2), { delayWet: 0.50, reverbWet: 0.30 }, [[0, 0], [3, 1], [W(2), 0.3]], 2),

    // The pad opens wide for the Wide sections and narrows for the rest.
    bar('pad', at['Wide A'], W(12), { width: 1.45 }, [[0, 0], [W(3), 1], [W(12), 1]], 3),
    bar('pad', at['Wide B'], W(12), { width: 1.5 },  [[0, 1], [W(12), 1]], 3),
  ]

  return assemble({
    name: 'Undertow', bpm: BPM, bpb: BPB, key: 'C', scale: 'minor', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.42,
  })
}

const out = build()
const label = 'Undertow'
const cfPath = join(OUT_DIR, `${label}.cfproj`)

if (argv.includes('--dry')) {
  const dp = out.project.dawProject
  const totalBeats = Math.max(...dp.arrangementClips.map(c => c.startBeat + c.durationBeats))
  const secs = totalBeats / BPM * 60
  console.log(`▸ "${label}" · ${BPM} BPM · C minor · ${totalBeats / BPB} bars · ${secs.toFixed(1)}s (${Math.floor(secs / 60)}:${String(Math.round(secs % 60)).padStart(2, '0')})`)
  for (const t of dp.tracks) {
    const cl = dp.arrangementClips.filter(c => c.trackId === t.id)
    const n = cl.reduce((a, c) => a + (c.notes?.length ?? 0), 0)
    console.log(`  ${t.name.padEnd(9)} ${String(cl.length).padStart(2)} clips / ${String(n).padStart(4)} notes`)
  }
  const fx = dp.clipEffects ?? []
  const kinds = {}
  for (const e of fx) for (const k of Object.keys(e.fx ?? {})) kinds[k] = (kinds[k] ?? 0) + 1
  console.log(`  ${fx.length} effect bars in the FX lane`)
  console.log(`  automated: ${Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join(', ')}`)
  process.exit(0)
}

writeFileSync(cfPath, JSON.stringify(out.project))
console.log(`  → ${cfPath}   (upload this — separate tracks)`)

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
