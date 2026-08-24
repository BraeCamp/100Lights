// "Undertow" — dark 2-step / garage in G minor, 122 BPM.
//
// Rewritten from scratch. The first version was a lead melody over an eight-bar
// chord loop played twice: about sixty seconds, one clip per track, constant
// density, no dynamics. This one is built the way the track Brae actually liked
// was built — slowly, one instrument at a time, with the arrangement doing the
// work.
//
// THE IDEA. Two-step garage is one of the few idioms where having no lead line
// is not a restriction but the actual style: the hook is the bassline and the
// drum groove, and the space between hits matters as much as the hits. So the
// standing no-lead rule and this genre want the same thing. Nothing here plays a
// tune. The movement comes from a five-note bass riff that gets transposed
// through the harmony, chord stabs that never land on the downbeat, and a kick
// that keeps stepping off the grid.
//
// THE HARMONY. i9 – iv11 – ♭VImaj9 – V7♭9 in G minor, voiced rootless so the
// bass owns the roots: guide tones and extensions live in a narrow A3–A4 band
// and voice-lead by a semitone or a common tone, which is why the loop can
// repeat without becoming wallpaper. Halfway through, the V7♭9 is swapped for a
// backdoor ♭VII9 — one note different, F♯ to G — so the second half of the song
// resolves more softly than the first. That single note is the development.
//
// THE ARC. 64 bars, about 2:06. Layers enter one at a time over the first
// sixteen bars, everything drops out at the breakdown, and the peak is the only
// place the top octave of the pad appears. The transitions are effect BARS in
// the FX lane — a filter dip and duck over the last two beats before each
// arrival, and a drive/volume lift across the peak — so they are visible and
// editable rather than buried in the clips.

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { uid, rng, feel, N, eq3, reverb, chorus, compressor, assemble, assertInRange, dipInto, lift, bar } from './song-kit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
mkdirSync(OUT_DIR, { recursive: true })
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 122, BPB = 4
const rand = rng(9137)
const { jitter, vary, chance } = feel(rand, BPM)

// ── Harmony ─────────────────────────────────────────────────────────────────
// voicing: rootless upper structure, A3–A4. bass/sub: the roots underneath.
// riff:    [root, fifth, colour] in the bass's own octave — the motif's pitches
//          for this chord, so transposing the motif stays inside the harmony.
const Gm9    = { name: 'Gm9',    voicing: [58, 62, 65, 69], bass: 43, sub: 31, riff: [43, 50, 46] } // Bb D F A  / G
const Cm11   = { name: 'Cm11',   voicing: [58, 63, 65, 67], bass: 48, sub: 36, riff: [48, 55, 51] } // Bb Eb F G / C
const Ebmaj9 = { name: 'Ebmaj9', voicing: [58, 62, 65, 67], bass: 51, sub: 39, riff: [51, 46, 55] } // Bb D F G  / Eb
const D7b9   = { name: 'D7b9',   voicing: [57, 60, 63, 66], bass: 50, sub: 38, riff: [50, 45, 54] } // A C Eb F# / D
const F9     = { name: 'F9',     voicing: [57, 60, 63, 67], bass: 53, sub: 41, riff: [53, 48, 57] } // A C Eb G  / F

// Loop A ends on the dominant (tense, pulls home). Loop B ends on the backdoor
// ♭VII (softer). One note of difference between them.
const LOOP_A = [Gm9, Cm11, Ebmaj9, D7b9]
const LOOP_B = [Gm9, Cm11, Ebmaj9, F9]

// ── The motif ───────────────────────────────────────────────────────────────
// Five notes, most of the bar empty. Offsets index into a chord's `riff` array.
// The "a of 1" push and the syncopated return on 2.25 are what make it walk
// instead of march.
const RIFF = [
  // [riffTone, beat, dur, velocity]
  [0, 0.00, 0.45, 102],
  [0, 0.75, 0.30, 84],
  [1, 1.50, 0.30, 90],
  [0, 2.25, 0.55, 94],
  [2, 3.50, 0.40, 88],
]
// A sparser variant for the first time the bass appears — same shape, fewer notes.
const RIFF_LEAN = [RIFF[0], RIFF[2], RIFF[3]]

const bassBar = (ch, pattern = RIFF, octavePop = false) => pattern.map(([tone, b, d, v]) => {
  const pop = octavePop && tone === 0 && b > 2 ? 12 : 0   // garage octave jump, late in the bar
  return N(ch.riff[tone] + pop, b + jitter(7), d, vary(v, 7))
})

// The sub is one held note per chord — what the Sub Drone preset was built for.
const subBar = (ch, velocity = 86) => [N(ch.sub, 0 + jitter(4), BPB - 0.1, vary(velocity, 4))]

// ── Chord stabs ─────────────────────────────────────────────────────────────
// Never on the downbeat: the kick owns beat one. Voices are rolled a few
// milliseconds apart and taper in velocity, which is what stops a four-note
// chord sounding like one synthetic block.
const STAB = [[0.50, 0.35, 80], [1.75, 0.30, 72], [2.50, 0.45, 84], [3.25, 0.25, 68]]
const STAB_SPARSE = [[0.50, 0.60, 72], [2.50, 0.70, 76]]

const stabBar = (ch, pattern = STAB) => {
  const out = []
  for (const [b, d, v] of pattern) {
    ch.voicing.forEach((p, i) => out.push(N(p, b + jitter(9) + i * 0.007, d, vary(v - i * 3, 6))))
  }
  return out
}

// The pad holds the same voicing rather than dropping an octave: below C3 a
// stacked 3rd or 9th just turns into mud, and the sub is already down there.
const padBar = (ch, velocity = 46, octave = 0) =>
  ch.voicing.map(p => N(p + octave, 0, BPB, vary(velocity, 4)))

// ── Drums ───────────────────────────────────────────────────────────────────
// Two-step: kick on 1 and the "a of 3", claps on 2 and 4 pushed late, shuffled
// hats. The kick deliberately avoids beat 3 — that hole is the groove.
const K = 36, S = 38, CLAP = 39, HH = 42, OH = 46
const LATE = 11 / 1000 * (BPM / 60)      // claps ~11ms behind the grid

function drumBar({ kick = true, backbeat = true, hats = true, open = true, extraKick = false, fill = false, ghost = 0.3 } = {}) {
  const out = []
  if (kick) {
    out.push(N(K, 0 + jitter(4), 0.5, vary(96, 5)))
    out.push(N(K, 2.75 + jitter(4), 0.5, vary(86, 7)))          // the "a of 3"
    if (extraKick) out.push(N(K, 1.75 + jitter(4), 0.4, vary(84, 8)))
  }
  if (backbeat) {
    for (const b of [1, 3]) {
      out.push(N(CLAP, b + LATE + jitter(4), 0.4, vary(92, 4)))
      out.push(N(S, b + LATE + jitter(4), 0.35, vary(76, 6)))   // snare under the clap for body
    }
  }
  if (hats) {
    for (let i = 0; i < 16; i++) {
      const swing = i % 2 ? 0.055 : 0                            // shuffle the off-16ths
      const b = i * 0.25 + swing + jitter(6)
      const accent = i % 4 === 0 ? 58 : i % 2 === 0 ? 44 : 32
      if (i % 2 === 1 && !chance(0.55)) continue                 // leave gaps — not a 16th machine
      out.push(N(HH, b, 0.2, vary(accent, 10)))
    }
    if (chance(ghost)) out.push(N(HH, 3.875 + jitter(5), 0.15, vary(28, 8)))
  }
  if (open) {
    out.push(N(OH, 1.5 + jitter(6), 0.40, vary(54, 6)))
    out.push(N(OH, 3.5 + jitter(6), 0.40, vary(50, 6)))
  }
  if (fill) {
    // A four-step snare run into the next section.
    out.push(N(S, 3.0 + jitter(4), 0.22, vary(72, 8)))
    out.push(N(S, 3.25 + jitter(4), 0.22, vary(84, 8)))
    out.push(N(S, 3.5 + jitter(4), 0.22, vary(96, 8)))
    out.push(N(S, 3.75 + jitter(4), 0.22, vary(108, 6)))
  }
  return out
}

// ── Section builder ─────────────────────────────────────────────────────────
/** Build `bars` bars of a section, cycling `loop`, calling per-layer builders.
 *  Beats returned are relative to the section start. */
function section(bars, loop, layers) {
  const parts = { pad: [], sub: [], bass: [], keys: [], drums: [] }
  for (let i = 0; i < bars; i++) {
    const ch = loop[i % loop.length]
    const at = (notes, target) => notes.forEach(n => parts[target].push({ ...n, startBeat: i * BPB + n.startBeat }))
    const ctx = { i, bars, ch, last: i === bars - 1, first: i === 0 }
    if (layers.pad)   at(layers.pad(ctx), 'pad')
    if (layers.sub)   at(layers.sub(ctx), 'sub')
    if (layers.bass)  at(layers.bass(ctx), 'bass')
    if (layers.keys)  at(layers.keys(ctx), 'keys')
    if (layers.drums) at(layers.drums(ctx), 'drums')
  }
  return parts
}

export function build() {
  const tracks = [
    { key: 'sub',   id: uid(), name: 'Sub',    presetId: 'builtin-46', volume: 0.62, color: '#7c3aed',
      rollFx: { sustain: 0.5 },
      effects: [eq3(4.5, -8, -12, 90, 500, 4000), compressor(-20, 4, 1)] },
    { key: 'bass',  id: uid(), name: 'Bass',   presetId: null, volume: 0.46, color: '#8b5cf6',
      instrument: { type: 'poly', params: { waveform: 'sawtooth', attack: 0.006, decay: 0.22, sustain: 0.5, release: 0.14,
        detune: 4, filterType: 'lowpass', filterCutoff: 900, filterResonance: 2.1,
        lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(2.5, -3.5, -2, 110, 700, 5000), compressor(-22, 3.5, 1)] },
    { key: 'keys',  id: uid(), name: 'Rhodes',  presetId: 'builtin-2', volume: 0.54, pan: 0.08, color: '#a78bfa',
      rollFx: { sustain: 0.18 },
      effects: [eq3(-6, -1.5, -1, 250, 900, 5500), reverb(0.26, 1.7, 0.02)] },
    { key: 'pad',   id: uid(), name: 'Pad',     presetId: null, volume: 0.20, pan: -0.06, color: '#c4b5fd',
      instrument: { type: 'poly', params: { waveform: 'sawtooth', attack: 1.1, decay: 0.9, sustain: 0.62, release: 2.4,
        detune: 13, filterType: 'lowpass', filterCutoff: 1700, filterResonance: 0.7,
        lfoEnabled: true, lfoRate: 0.14, lfoDepth: 0.18, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(-9, -4, 2.5, 300, 800, 7000), chorus(0.45, 0.35, 0.45), reverb(0.36, 3.2, 0.03)] },
    { key: 'drums', id: uid(), name: 'Drums',   presetId: null, isDrum: true, volume: 0.44, color: '#f0abfc',
      instrument: { type: 'drum', params: { pack: 'house' } },
      effects: [eq3(1.5, -2.5, -3.5, 120, 600, 7000), compressor(-24, 6, 2.5), reverb(0.07, 0.4, 0.01)] },
  ]

  // ── The arc ───────────────────────────────────────────────────────────────
  const sections = [
    // 1. Intro — pad alone in the dark; the sub arrives halfway through.
    { name: 'Intro', bars: 8, parts: section(8, LOOP_A, {
        pad: ({ i }) => padBar(LOOP_A[i % 4], i < 4 ? 38 : 46),
        sub: ({ i, ch }) => i >= 4 ? subBar(ch, 78) : [],
      }) },

    // 2. Bass In — the riff enters lean, hats join for the last four bars.
    { name: 'Bass In', bars: 8, parts: section(8, LOOP_A, {
        pad:  ({ ch }) => padBar(ch, 48),
        sub:  ({ ch }) => subBar(ch, 84),
        bass: ({ ch, i }) => bassBar(ch, i < 4 ? RIFF_LEAN : RIFF),
        drums: ({ i }) => i >= 4 ? drumBar({ kick: false, backbeat: false, open: i >= 6 }) : [],
      }) },

    // 3. Groove A — the full two-step statement.
    { name: 'Groove A', bars: 12, parts: section(12, LOOP_A, {
        pad:  ({ ch }) => padBar(ch, 46),
        sub:  ({ ch }) => subBar(ch),
        bass: ({ ch, i }) => bassBar(ch, RIFF, i % 4 === 3),
        keys: ({ ch, i }) => stabBar(ch, i % 4 === 3 ? STAB_SPARSE : STAB),
        drums: ({ last }) => drumBar({ fill: last }),
      }) },

    // 4. Breakdown — everything rhythmic leaves. Held chords and the sub only.
    //    This is the contrast the whole peak is borrowed against.
    { name: 'Breakdown', bars: 8, parts: section(8, LOOP_A, {
        pad:  ({ ch }) => padBar(ch, 52),
        sub:  ({ ch }) => subBar(ch, 74),
        keys: ({ ch, i }) => i % 2 === 0 ? stabBar(ch, [[0.5, 1.8, 60]]) : [],
      }) },

    // 5. Groove B — same groove, backdoor ♭VII instead of the dominant.
    { name: 'Groove B', bars: 12, parts: section(12, LOOP_B, {
        pad:  ({ ch }) => padBar(ch, 48),
        sub:  ({ ch }) => subBar(ch),
        bass: ({ ch, i }) => bassBar(ch, RIFF, i % 2 === 1),
        keys: ({ ch }) => stabBar(ch, STAB),
        drums: ({ i, last }) => drumBar({ extraKick: i % 4 === 2, fill: last }),
      }) },

    // 6. Peak — the only place the pad's top octave appears, and the only place
    //    the drums push every bar. Drive and level ride up underneath it.
    { name: 'Peak', bars: 8, parts: section(8, LOOP_B, {
        pad:  ({ ch, i }) => [...padBar(ch, 50), ...padBar(ch, i < 2 ? 30 : 38, 12)],
        sub:  ({ ch }) => subBar(ch, 92),
        bass: ({ ch }) => bassBar(ch, RIFF, true),
        keys: ({ ch }) => stabBar(ch, STAB),
        drums: ({ last }) => drumBar({ extraKick: true, fill: last, ghost: 0.6 }),
      }) },

    // 7. Outro — strip back to where it started and let the tail ring.
    { name: 'Outro', bars: 8, parts: section(8, LOOP_A, {
        pad:  ({ ch, i }) => padBar(ch, Math.max(20, 46 - i * 4)),
        sub:  ({ ch, i }) => i < 6 ? subBar(ch, Math.max(50, 80 - i * 6)) : [],
        keys: ({ ch, i }) => i < 4 ? stabBar(ch, STAB_SPARSE) : [],
      }) },
  ]

  // Section start beats, for placing the FX bars.
  const at = {}
  let b = 0
  for (const s of sections) { at[s.name] = b; b += s.bars * BPB }

  // ── Dynamics, as bars in the FX lane ──────────────────────────────────────
  const fxBars = [
    // Pull the filter down and duck just before each arrival, so the section
    // change lands as a jump rather than a continuation.
    dipInto('bass', at['Groove A'], 2), dipInto('keys', at['Groove A'], 2),
    dipInto('bass', at['Groove B'], 2), dipInto('pad', at['Groove B'], 2),
    dipInto('bass', at['Peak'], 2), dipInto('keys', at['Peak'], 2), dipInto('drums', at['Peak'], 2),

    // The build: start the bass closed and open it across the section.
    bar('bass', at['Bass In'], 8 * BPB, { filterHz: 520 },
        [[0, 1], [8 * BPB * 0.7, 0.35], [8 * BPB, 0]], 1),

    // The breakdown goes dark and quiet, then opens again on the way out.
    bar('pad', at['Breakdown'], 8 * BPB, { filterHz: 900, gain: 0.86 },
        [[0, 0], [4, 1], [8 * BPB - 8, 1], [8 * BPB, 0.2]], 1),
    bar('keys', at['Breakdown'], 8 * BPB, { filterHz: 700 },
        [[0, 0.2], [6, 1], [8 * BPB, 0.6]], 1),

    // The peak: a little drive and a relative lift across the whole section.
    lift('bass', at['Peak'], 8 * BPB, { drive: 0.05, gain: 1.05 }),
    lift('keys', at['Peak'], 8 * BPB, { drive: 0.03, gain: 1.03 }),
    lift('drums', at['Peak'], 8 * BPB, { drive: 0.04, gain: 1.03 }),

    // The outro closes down.
    bar('pad', at['Outro'], 8 * BPB, { filterHz: 640, gain: 0.7 },
        [[0, 0], [8 * BPB * 0.5, 0.5], [8 * BPB, 1]], 1),
  ]

  const out = assemble({
    name: 'Undertow', bpm: BPM, bpb: BPB, key: 'G', scale: 'minor', swing: 0,
    tracks, sections, bars: fxBars, masterVolume: 0.30,
  })

  // Guard rails: sampled presets only sound right inside their sampled range.
  const notesOf = key => out.project.dawProject.arrangementClips
    .filter(c => c.trackId === tracks.find(t => t.key === key).id).flatMap(c => c.notes)
  assertInRange('Sub (builtin-46 Sub Drone)', notesOf('sub'), 24, 60)
  assertInRange('Rhodes (builtin-2)', notesOf('keys'), 36, 84)
  return { out, tracks }
}

const { out, tracks } = build()
const label = 'Undertow'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))

const perTrack = tracks.map(t => {
  const clips = out.project.dawProject.arrangementClips.filter(c => c.trackId === t.id)
  return `${t.name}: ${clips.length} clips / ${clips.reduce((n, c) => n + c.notes.length, 0)} notes`
})
console.log(`▸ "${label}" · ${BPM} BPM · G minor · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
console.log(`  ${perTrack.join('\n  ')}`)
console.log(`  ${out.project.dawProject.clipEffects.length} effect bars in the FX lane`)
console.log(`  → ${cfPath}`)

if (argv.includes('--dry')) process.exit(0)
const url = flagOf('url', 'http://localhost:4618')
console.log('▸ rendering through the studio engine…')
execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--url=${url}`, `--out=${join(OUT_DIR, label + '.mp3')}`, '--keep'],
  { cwd: ROOT, stdio: 'inherit' })

// The bounce is deliberately conservative so nothing clips; loudness belongs in
// a mastering pass, not in the arrangement. -14 LUFS with a -1.2 dBTP ceiling is
// the streaming-normal target, and it leaves the section-to-section contrast
// alone (LRA 11 is generous on purpose — the arc is the point of the track).
const wavPath = join(OUT_DIR, label + '.wav')
const masteredPath = join(OUT_DIR, label + ' (master).mp3')
console.log('\u25b8 mastering to -14 LUFS…')
try {
  execFileSync('ffmpeg', ['-y', '-i', wavPath,
    '-af', 'loudnorm=I=-14:TP=-1.2:LRA=11', '-codec:a', 'libmp3lame', '-b:a', '256k', masteredPath],
    { stdio: ['ignore', 'ignore', 'pipe'] })
  console.log(`  \u2192 ${masteredPath}`)
} catch (e) {
  console.log('  (ffmpeg mastering pass failed \u2014 the raw bounce above is still valid)', e.message.slice(0, 120))
}
