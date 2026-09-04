// "Paper Lanterns" — E♭ major with a Lydian lean, 94 BPM. Neo-soul, lit low.
//
// The warm one. Nothing in the set so far sits in a MAJOR key at a walking
// tempo with a swung hip-hop kit, so this is where it goes: Rhodes in rootless
// voicings (the 3rd, 7th and 9th, never the root — the bass owns the root),
// a vibraphone that answers rather than leads, a round synth bass that plays
// the roots late and short, and a boom-bap kit with brushed hats.
//
// THE HARMONY. A four-bar loop that never resolves the way you expect:
//   E♭maj9  ·  A♭maj7♯11  ·  Gm7  ·  Cm9 → F9
// The ♯11 on the A♭ is the Lydian colour — one raised note that opens the
// window — and the F9 at the end of the loop is a secondary dominant that
// leans toward B♭ and then falls back to E♭ instead. That lean is the hook.
// There is no lead line; the vibraphone fills the gaps the Rhodes leaves.
//
// THE ARC. Rhodes alone at the door; bass and brushed hats join; the full kit
// and the vibes for the street; a window with only pad and Rhodes; back out
// onto the street with the vibes doubled an octave up; and it leaves the way
// it came, one layer at a time.

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

const BPM = 94, BPB = 4
const rand = rng(4114)
const { jitter, vary, chance, swing16 } = feel(rand, BPM)

// ── Harmony ─────────────────────────────────────────────────────────────────
// Rootless voicings for the Rhodes: 3-7-9 shapes around middle C. The bass
// plays the root; `alt` is the vibraphone's answer, two chord tones up high.
// E♭ = 63, A♭ = 68, G = 67, C = 72, F = 65 (an octave down for the bass).
const Ebmaj9 = { name: 'E♭maj9',    rhodes: [55, 58, 62, 65], bass: 39, alt: [70, 74], colour: 'home' }      // G B♭ D F / E♭
const Abmaj7 = { name: 'A♭maj7♯11', rhodes: [55, 60, 62, 67], bass: 44, alt: [72, 74], colour: 'window' }    // G C D(♯11) G / A♭ — the raised 11th
const Gm7    = { name: 'Gm7',       rhodes: [53, 58, 62, 65], bass: 43, alt: [70, 74], colour: 'shade' }     // F B♭ D F / G
const Cm9    = { name: 'Cm9',       rhodes: [55, 58, 62, 63], bass: 36, alt: [67, 70], colour: 'shade' }     // G B♭ D E♭ / C
const F9     = { name: 'F9',        rhodes: [57, 60, 63, 67], bass: 41, alt: [69, 72], colour: 'lean' }      // A C E♭ G / F — leans to B♭, falls home

// The loop: E♭ | A♭ | Gm | Cm→F9 — the last bar splits between two chords.
const LOOP = [[Ebmaj9], [Abmaj7], [Gm7], [Cm9, F9]]

// ── Rhodes: rootless comping ────────────────────────────────────────────────
// Two hits per bar at most: the downbeat and the "and of two", with the third
// hit on the "and of four" only as an anticipation of the next chord. Held
// long, played soft, the top note a hair after the rest so it does not sound
// like a single key press.
const rhodesBar = (chords, { velocity = 62, anticipate = false, sparse = false } = {}) => {
  const out = []
  const hit = (ch, at, len, vel) => ch.rhodes.forEach((p, i) => out.push(N(p, at + jitter(10) + i * 0.012, len, vary(vel - i * 2, 5))))
  if (chords.length === 1) {
    hit(chords[0], 0, sparse ? 2.6 : 1.7, velocity)
    if (!sparse) hit(chords[0], 1.5 + swing16(1, 0.08), 1.1, velocity - 10)
  } else {
    hit(chords[0], 0, 1.7, velocity)
    hit(chords[1], 2, 1.6, velocity - 4)
  }
  if (anticipate && chords.length === 1) hit(chords[0], 3.5 + swing16(1, 0.08), 0.5, velocity - 14)
  return out
}

// ── Vibraphone: the answer ──────────────────────────────────────────────────
// Two notes in the second half of the bar, where the Rhodes is quiet. A
// texture in the register the Rhodes never uses — never a phrase: the same
// two chord tones, in the same place, every time the chord comes round.
const vibesBar = (chords, { velocity = 58, octave = 0, both = false } = {}) => {
  const ch = chords[chords.length - 1]
  const out = []
  out.push(N(ch.alt[0] + octave, 2.5 + swing16(1, 0.07) + jitter(8), 1.2, vary(velocity, 6)))
  out.push(N(ch.alt[1] + octave, 3 + jitter(8), 0.9, vary(velocity - 8, 6)))
  if (both) out.push(N(ch.alt[0] + octave + 12, 3.5 + swing16(1, 0.07) + jitter(8), 0.5, vary(velocity - 16, 6)))
  return out
}

// ── Woodblock: a library SAMPLE as the instrument ───────────────────────────
// The piano roll's Samples tab lets a clip play any library sound across the
// keys; this is that, done by hand. The seeded "Woodblock" (one 150 ms hit)
// becomes a preset with a root of C4, and the engine repitches the hit to
// whatever note is written — a tuned woodblock. Two ticks in the first half
// of the bar, on chord tones, where the vibes are not. A texture: the same
// two ticks every bar the chord comes round, never a phrase.
const WOOD = {
  id: uid(), name: 'Woodblock', folder: 'Percussion', loNote: 36, hiNote: 84, category: 'rim',
  group: 'Samples', builtIn: false, createdAt: new Date().toISOString(),
  sampleId: 'seed:Drums:Percussion:Woodblock', rootNote: 60, tags: ['Percussion'],
}
const woodBar = (chords, { velocity = 48 } = {}) => {
  const ch = chords[0]
  return [
    N(ch.alt[1] - 12, 0.5 + swing16(1, 0.1) + jitter(8), 0.2, vary(velocity, 6)),
    N(ch.alt[0] - 12, 1.25 + swing16(1, 0.1) + jitter(8), 0.2, vary(velocity - 10, 6)),
  ]
}

// ── Bass: late roots ────────────────────────────────────────────────────────
// Root on the one, played a touch late; the fifth or octave on the "and of
// three" some of the time; a slide up into the next chord on the last eighth.
const bassBar = (chords, { velocity = 90, busy = false } = {}) => {
  const out = []
  const late = 14 / 1000 * (BPM / 60)
  const ch = chords[0]
  out.push(N(ch.bass, 0 + late + jitter(6), chords.length === 1 ? 1.6 : 1.4, vary(velocity, 5)))
  if (chords.length === 2) out.push(N(chords[1].bass, 2 + late + jitter(6), 1.3, vary(velocity - 4, 5)))
  else if (busy || chance(0.5)) out.push(N(ch.bass + (chance(0.5) ? 7 : 12), 2.5 + swing16(1, 0.08) + jitter(6), 0.6, vary(velocity - 16, 6)))
  if (busy && chance(0.6)) out.push(N(ch.bass + 3, 3.75 + jitter(6), 0.22, vary(velocity - 22, 6)))
  return out
}

// ── Pad: the window ─────────────────────────────────────────────────────────
const padBar = (chords, velocity = 40) => chords[0].rhodes.map((p, i) => N(p + 12, i * 0.03, chords.length === 1 ? BPB : 2, vary(velocity, 4)))

// ── Drums: boom bap, brushed ────────────────────────────────────────────────
const K = 36, S = 38, RIM = 37, HH = 42, OH = 46
const LATE = 10 / 1000 * (BPM / 60)
function drumBar({ kick = true, snare = true, rim = false, hats = true, brushed = false, open = false, fill = false, ghost = true } = {}) {
  const out = []
  if (kick) {
    out.push(N(K, 0 + jitter(3), 0.4, vary(104, 4)))
    out.push(N(K, 2.5 + swing16(1, 0.09) + jitter(4), 0.35, vary(92, 6)))
    if (chance(0.35)) out.push(N(K, 3.75 + jitter(4), 0.25, vary(78, 6)))
  }
  if (snare) for (const b of [1, 3]) out.push(N(S, b + LATE + jitter(4), 0.3, vary(94, 5)))
  if (rim) for (const b of [1, 3]) out.push(N(RIM, b + LATE + jitter(4), 0.25, vary(70, 6)))
  if (ghost && snare && chance(0.5)) out.push(N(S, 2.25 + jitter(5), 0.15, vary(38, 8)))
  if (hats) {
    for (let i = 0; i < 8; i++) {
      if (brushed && i % 2 === 1 && !chance(0.55)) continue
      out.push(N(HH, i * 0.5 + swing16(i, 0.11) + jitter(6), 0.14, vary(i % 2 === 0 ? 52 : 34, 9)))
    }
  }
  if (open) out.push(N(OH, 3.5 + swing16(1, 0.09) + jitter(5), 0.4, vary(56, 6)))
  if (fill) { out.push(N(S, 3.5 + jitter(4), 0.15, vary(66, 8))); out.push(N(S, 3.75 + jitter(4), 0.2, vary(84, 8))) }
  return out
}

function section(bars, layers) {
  const parts = { rhodes: [], vibes: [], wood: [], bass: [], pad: [], drums: [] }
  for (let i = 0; i < bars; i++) {
    const chords = LOOP[i % LOOP.length]
    const at = (notes, target) => notes.forEach(n => parts[target].push({ ...n, startBeat: i * BPB + n.startBeat }))
    const ctx = { i, chords, last: i === bars - 1, loopEnd: i % 4 === 3 }
    for (const key of Object.keys(parts)) if (layers[key]) at(layers[key](ctx), key)
  }
  return parts
}

export function build() {
  const tracks = [
    { key: 'rhodes', id: uid(), name: 'Rhodes', presetId: 'builtin-2', volume: 0.50, pan: -0.08, color: '#f59e0b',
      rollFx: { sustain: 0.9 },
      effects: [eq3(-4, 1, -2, 200, 900, 5000), chorus(0.22, 0.35, 0.3), compressor(-24, 3, 2), reverb(0.22, 1.6, 0.03)] },
    { key: 'vibes',  id: uid(), name: 'Vibes',  presetId: 'builtin-36', volume: 0.30, pan: 0.28, color: '#fbbf24',
      rollFx: { sustain: 1.4 },
      effects: [eq3(-10, -2, 1, 300, 1200, 6000), reverb(0.34, 2.4, 0.04)] },
    { key: 'wood',   id: uid(), name: 'Woodblock', presetId: WOOD.id, volume: 0.5, pan: -0.36, color: '#d97706',
      effects: [eq3(-8, 0, 2, 300, 1500, 6000), reverb(0.2, 1.2, 0.02)] },
    { key: 'bass',   id: uid(), name: 'Bass',   presetId: null, volume: 0.44, color: '#b45309',
      instrument: { type: 'poly', params: { waveform: 'triangle', attack: 0.012, decay: 0.3, sustain: 0.55, release: 0.18,
        detune: 0, filterType: 'lowpass', filterCutoff: 520, filterResonance: 1.2,
        lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(3, -2, -6, 100, 700, 4000), compressor(-20, 4, 2)] },
    { key: 'pad',    id: uid(), name: 'Pad',    presetId: null, volume: 0.15, pan: 0.1, color: '#fde68a',
      instrument: { type: 'poly', params: { waveform: 'sawtooth', attack: 1.4, decay: 1.2, sustain: 0.7, release: 3.0,
        detune: 12, filterType: 'lowpass', filterCutoff: 1100, filterResonance: 0.6,
        lfoEnabled: true, lfoRate: 0.09, lfoDepth: 0.25, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(-12, -4, 0, 300, 900, 6000), chorus(0.5, 0.25, 0.5), reverb(0.4, 3.4, 0.04)] },
    { key: 'drums',  id: uid(), name: 'Drums',  presetId: null, isDrum: true, volume: 0.46, color: '#78350f',
      instrument: { type: 'drum', params: { pack: 'boombap' } },
      effects: [eq3(2, -2.5, -4, 110, 700, 6000), compressor(-22, 4, 2), reverb(0.05, 0.5, 0.01)] },
  ]

  const sections = [
    // 1. Door — Rhodes alone, sparse, one anticipation at the end of the loop.
    { name: 'Door', bars: 8, parts: section(8, {
        rhodes: ({ chords, loopEnd }) => rhodesBar(chords, { velocity: 56, sparse: true, anticipate: loopEnd }),
      }) },
    // 2. Lantern — the bass and brushed hats come in; a rim instead of a snare.
    { name: 'Lantern', bars: 8, parts: section(8, {
        rhodes: ({ chords, loopEnd }) => rhodesBar(chords, { velocity: 60, anticipate: loopEnd }),
        bass:   ({ chords }) => bassBar(chords, { velocity: 84 }),
        drums:  ({ i, last }) => drumBar({ snare: false, rim: true, brushed: true, ghost: false, kick: i >= 2, fill: last }),
      }) },
    // 3. Street — the full kit, the vibes answering.
    { name: 'Street', bars: 12, parts: section(12, {
        rhodes: ({ chords, loopEnd }) => rhodesBar(chords, { velocity: 64, anticipate: loopEnd }),
        vibes:  ({ chords, i }) => i >= 2 ? vibesBar(chords, { velocity: 56 }) : [],
        wood:   ({ chords, i }) => i >= 4 && i % 2 === 1 ? woodBar(chords, { velocity: 72 }) : [],
        bass:   ({ chords, i }) => bassBar(chords, { velocity: 90, busy: i >= 6 }),
        drums:  ({ i, last }) => drumBar({ open: i % 4 === 3, fill: last }),
      }) },
    // 4. Window — the beat leaves; pad under the Rhodes; the bass holds on for
    //    half of it and then goes too.
    { name: 'Window', bars: 8, parts: section(8, {
        rhodes: ({ chords }) => rhodesBar(chords, { velocity: 58, sparse: true }),
        pad:    ({ chords }) => padBar(chords, 42),
        bass:   ({ chords, i }) => i < 4 ? bassBar(chords, { velocity: 78 }) : [],
        vibes:  ({ chords, i }) => i >= 5 ? vibesBar(chords, { velocity: 48, octave: 12 }) : [],
      }) },
    // 5. Street B — back out; the vibes doubled an octave up; the bass busier.
    { name: 'Street B', bars: 12, parts: section(12, {
        rhodes: ({ chords, loopEnd }) => rhodesBar(chords, { velocity: 66, anticipate: loopEnd }),
        vibes:  ({ chords, i }) => vibesBar(chords, { velocity: 60, both: i >= 4 }),
        wood:   ({ chords, i }) => i % 4 !== 3 || chance(0.5) ? woodBar(chords, { velocity: 76 }) : [],
        bass:   ({ chords }) => bassBar(chords, { velocity: 92, busy: true }),
        pad:    ({ chords, i }) => i >= 8 ? padBar(chords, 30) : [],
        drums:  ({ i, last }) => drumBar({ open: i % 2 === 1, fill: last || i === 5 }),
      }) },
    // 6. Lantern Out — one layer at a time, the way it came: kit to brushes,
    //    then the bass, then the Rhodes alone on the loop's last chord.
    { name: 'Lantern Out', bars: 8, parts: section(8, {
        rhodes: ({ chords, i }) => rhodesBar(chords, { velocity: Math.max(44, 60 - i * 2), sparse: i >= 4 }),
        vibes:  ({ chords, i }) => i < 3 ? vibesBar(chords, { velocity: 50 }) : [],
        wood:   ({ chords, i }) => i < 4 ? woodBar(chords, { velocity: Math.max(48, 70 - i * 5) }) : [],
        bass:   ({ chords, i }) => i < 6 ? bassBar(chords, { velocity: Math.max(60, 84 - i * 4) }) : [],
        drums:  ({ i }) => i < 4 ? drumBar({ snare: false, rim: true, brushed: true, ghost: false, kick: i < 2 }) : [],
        pad:    ({ chords, i }) => i >= 4 ? padBar(chords, Math.max(16, 38 - i * 3)) : [],
      }) },
  ]

  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  const fxBars = [
    dipInto('rhodes', at['Street'], 2), dipInto('bass', at['Street'], 2),
    dipInto('rhodes', at['Street B'], 2), dipInto('pad', at['Street B'], 2),
    // Lantern: the Rhodes opens across it, the way a room does when a lamp comes on.
    bar('rhodes', at['Lantern'], 8 * BPB, { filterHz: 900 }, [[0, 0.8], [8 * BPB * 0.6, 0.3], [8 * BPB, 0]], 1),
    // The window: pad breathes up then settles; the Rhodes gets a little space.
    bar('pad', at['Window'], 8 * BPB, { filterHz: 700 }, [[0, 0.9], [8, 0.35], [8 * BPB - 4, 0.35], [8 * BPB, 0.8]], 1),
    bar('rhodes', at['Window'], 8 * BPB, { gain: 1.06 }, [[0, 0], [8, 1], [8 * BPB, 0.4]], 1),
    // Street B is the peak: a little drive on the bass and kit, a lift on the vibes.
    lift('bass', at['Street B'], 12 * BPB, { drive: 0.05, gain: 1.05 }),
    lift('drums', at['Street B'], 12 * BPB, { drive: 0.03, gain: 1.03 }),
    lift('vibes', at['Street B'], 12 * BPB, { drive: 0.0, gain: 1.08 }),
    // The way out: everything closes down together.
    bar('rhodes', at['Lantern Out'], 8 * BPB, { filterHz: 640, gain: 0.7 }, [[0, 0], [8 * BPB * 0.5, 0.45], [8 * BPB, 1]], 1),
    bar('pad', at['Lantern Out'], 8 * BPB, { filterHz: 520, gain: 0.6 }, [[0, 0], [8 * BPB, 1]], 1),
  ]

  const out = assemble({
    name: 'Paper Lanterns', bpm: BPM, bpb: BPB, key: 3, scale: 'major', swing: 0.12,
    tracks, sections, bars: fxBars, masterVolume: 0.40,
  })

  const notesOf = key => out.project.dawProject.arrangementClips
    .filter(c => c.trackId === tracks.find(t => t.key === key).id).flatMap(c => c.notes)
  assertInRange('Rhodes (builtin-2 Rhodes)', notesOf('rhodes'), 36, 84)
  assertInRange('Vibes (builtin-36 Vibraphone)', notesOf('vibes'), 53, 89)
  assertInRange('Woodblock (library sample, root C4)', notesOf('wood'), WOOD.loNote, WOOD.hiNote)
  // The sample preset travels IN the project, exactly as the piano roll's
  // Samples tab embeds it — the sound resolves through sampleId on any machine
  // whose library has seeded.
  out.project.dawProject.presets = [WOOD]
  return { out, tracks }
}

const { out, tracks } = build()
const label = 'Paper Lanterns'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))

console.log(`▸ "${label}" · ${BPM} BPM · E♭ major · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
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
