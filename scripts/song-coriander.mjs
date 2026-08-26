// "Coriander" — G minor, 84 BPM, swung. Neo-soul leaning on trip-hop.
//
// Written to be the first song built on the craft layer rather than by hand, and
// deliberately aimed at the four faults the analysis kept finding in the others:
//
//   · every part sat within 1.5 ms of the grid, so nothing leaned. Here the
//     snare is behind the beat, the bass pushes ahead of it, the hats are the
//     loosest thing in the bar, and the sixteenths swing at 58%. Every one of
//     the eight songs before this had swing exactly zero.
//   · two parts shared one octave and masked each other. Every part here is
//     assigned a register slot and folded into it, so a collision cannot be
//     written by accident.
//   · three layers arrived at one seam. The layer schedule goes through
//     stagger(), which moves an entrance earlier rather than dropping it.
//   · every section had the same density. The quiet sections here are genuinely
//     quiet — "Hollow" is two layers holding whole notes.
//
// THE SOUND is the other half. The palette audit showed no pitched voice reached
// above 900 Hz, so the harmony carries on `tine` (an electric piano with a real
// bell tine and a hammer transient) with `glass` for accents, rather than on the
// dark pad-and-keys pair everything else used.
//
// THE HARMONY is a four-bar neo-soul turn: Gm9 – Cm11 – Ebmaj7#11 – F9sus. The
// ninths and elevenths are what keep it from sounding like a minor loop, the
// #11 on the Eb stops the fourth degree clashing with the third, and the F9sus
// at the end refuses to resolve, which is what makes it circle rather than stop.
// Chords are voiced ROOTLESS: the bass has the root, and doubling it in the
// keys is what fills a mix at the bottom while leaving the middle empty.
//
// There is no lead line, by standing rule. The pluck plays a two-note
// oscillating figure — texture, not a phrase.

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'
import { uid, N, assemble, dipInto, lift, bar } from './song-kit.mjs'
import { groove, play, voice, intoSlot, checkSlots, stagger, densityArc, thin, motif, rng } from './lib/craft.mjs'
import { kick, snare, hatDual, subBass, funkBass, tine, pluck, glass } from './apollo-voices.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(homedir(), 'Desktop', '100lights-ai-renders')
const argv = process.argv.slice(2)
const flagOf = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }

const BPM = 84, BPB = 4
const g = groove({ bpm: BPM, feel: 'laidback', swing: 0.58, seed: 3141 })
const rand = rng(3141)

// ── Harmony ─────────────────────────────────────────────────────────────────
const LOOP = ['Gm9', 'Cm11', 'Ebmaj7#11', 'F9sus']
const ROOTS = { Gm9: 43, Cm11: 48, 'Ebmaj7#11': 51, F9sus: 41 }   // in the bass slot

// Voiced once, in order, each chord led from the one before so the inner voices
// move as little as possible. Done here rather than per bar so the whole loop
// shares one set of voicings and the progression does not re-invert every pass.
const VOICED = []
let prev = null
for (const sym of LOOP) {
  // Three sounding voices, not four: the comp overlaps its own hits, and voice
  // cost multiplies by the number of notes held. Three is also the better
  // voicing — guide tones plus one colour, with the bass supplying the root.
  const v = voice(sym, { style: 'rootless', centre: 63, spread: 11, near: prev }).slice(0, 3)
  VOICED.push(v)
  prev = v
}

// ── Register ────────────────────────────────────────────────────────────────
const SLOT = { sub: 'sub', bass: 'bass', tine: 'chord', pluck: 'upper', glass: 'air' }
const collisions = checkSlots(SLOT)
if (collisions.length) throw new Error('register collision: ' + collisions.join('; '))

// ── Parts ───────────────────────────────────────────────────────────────────
// Each returns notes for ONE bar, with beats relative to that bar. The groove is
// applied at the end, in one place, so the feel is consistent across the song.

const KICK = 24, SNARE = 48, HAT = 60

const kickBar = ({ busy = false } = {}) => {
  const hits = busy ? [0, 1.5, 2.5, 3.25] : [0, 2.5]
  return hits.map(b => ({ pitch: KICK, beat: b, durationBeats: 0.4, velocity: b === 0 ? 104 : 94 }))
}
const snareBar = ({ fill = false } = {}) => {
  const out = [1, 3].map(b => ({ pitch: SNARE, beat: b, durationBeats: 0.3, velocity: 96 }))
  // A ghost note between the backbeats — quiet enough to feel rather than hear.
  if (!fill) out.push({ pitch: SNARE, beat: 2.75, durationBeats: 0.2, velocity: 34 })
  if (fill) for (const b of [3.25, 3.5, 3.75]) out.push({ pitch: SNARE, beat: b, durationBeats: 0.18, velocity: 60 + (b - 3.25) * 60 })
  return out
}
const hatBar = ({ sixteenths = false } = {}) => {
  const out = []
  const step = sixteenths ? 0.25 : 0.5
  for (let b = 0; b < BPB; b += step) {
    if (sixteenths && b % 0.5 !== 0 && rand() < 0.35) continue      // holes, not a machine gun
    out.push({ pitch: HAT, beat: b, durationBeats: b % 1 === 0.5 ? 0.22 : 0.07, velocity: 58 })
  }
  return out
}

const subBar = (i, { held = true } = {}) => {
  const root = intoSlot(ROOTS[LOOP[i % 4]], 'sub')
  return held
    ? [{ pitch: root, beat: 0, durationBeats: BPB - 0.15, velocity: 84 }]
    : [{ pitch: root, beat: 0, durationBeats: 1.4, velocity: 86 }, { pitch: root, beat: 2.5, durationBeats: 1.2, velocity: 78 }]
}

const bassBar = (i, { walk = false } = {}) => {
  const c = LOOP[i % 4]
  const root = intoSlot(ROOTS[c], 'bass')
  const fifth = root + 7, seventh = root + (c.startsWith('Eb') ? 11 : 10)
  const line = walk
    ? [[root, 0, 0.5, 100], [root, 0.75, 0.35, 78], [fifth, 1.5, 0.45, 88], [root + 12, 2.5, 0.4, 84], [seventh - 12, 3.25, 0.5, 80]]
    : [[root, 0, 1.2, 100], [fifth, 2.5, 0.8, 84]]
  return line.map(([p, b, d, v]) => ({ pitch: intoSlot(p, 'bass'), beat: b, durationBeats: d, velocity: v }))
}

/** Comping: the chord on the offbeats, which is where a Rhodes player puts it. */
const tineBar = (i, { sparse = false } = {}) => {
  const v = VOICED[i % 4]
  const hits = sparse ? [[0, BPB - 0.3, 62]] : [[0.5, 0.9, 72], [2.25, 0.7, 66], [3.5, 0.55, 58]]
  const out = []
  for (const [b, d, vel] of hits) {
    // Roll the chord very slightly, low to high — a hand, not a trigger.
    v.forEach((p, k) => out.push({ pitch: p, beat: b + k * 0.005, durationBeats: d, velocity: vel - k * 3 }))
  }
  return out
}

/** Texture, not a phrase: two chord tones oscillating in the upper slot. */
const pluckBar = (i) => {
  const v = VOICED[i % 4]
  const a = intoSlot(v[v.length - 1], 'upper'), b = intoSlot(v[0], 'upper')
  return [[a, 0.25], [b, 1.25], [a, 2.25], [b, 3.25]]
    .map(([p, beat]) => ({ pitch: p, beat, durationBeats: 0.45, velocity: 54 }))
}

/** One struck accent per two bars, high up, for air. */
const glassBar = (i) => (i % 2 === 0
  ? [{ pitch: intoSlot(VOICED[i % 4][0], 'air'), beat: 0, durationBeats: 2.6, velocity: 42 }]
  : [])

// ── Form ────────────────────────────────────────────────────────────────────
// energy drives density; want[] is the intended roster and stagger() makes the
// seams legal without dropping anything.
const FORM = [
  { name: 'Steep',  bars: 6,  energy: 0.15, want: ['sub', 'tine'] },
  { name: 'Settle', bars: 6,  energy: 0.35, want: ['sub', 'tine', 'bass', 'glass', 'hats'] },
  { name: 'Body A', bars: 10, energy: 0.85, want: ['sub', 'tine', 'bass', 'glass', 'kick', 'hats'] },
  { name: 'Hollow', bars: 6,  energy: 0.10, want: ['sub', 'tine', 'glass'] },
  { name: 'Body B', bars: 10, energy: 1.00, want: ['sub', 'tine', 'bass', 'glass', 'kick', 'hats', 'pluck'] },
  { name: 'Out',    bars: 10, energy: 0.30, want: ['sub', 'tine', 'glass'] },
]
const { sections: staggered, unresolved } = stagger(FORM, { maxChurn: 2 })
if (unresolved.length) console.warn('arrangement could not be fully staggered:\n  ' + unresolved.join('\n  '))
const DENSITY = densityArc(FORM.map(s => s.energy))

export function build() {
  const tracks = [
    { key: 'kick',  id: uid(), name: 'Kick',  presetId: null, volume: 0.60, color: '#f0abfc', instrument: { type: 'apollo', params: kick() } },
    { key: 'snare', id: uid(), name: 'Snare', presetId: null, volume: 0.46, color: '#f472b6', instrument: { type: 'apollo', params: snare() } },
    { key: 'hats',  id: uid(), name: 'Hats',  presetId: null, volume: 0.26, pan: 0.18, color: '#fda4af', instrument: { type: 'apollo', params: hatDual() } },
    { key: 'sub',   id: uid(), name: 'Sub',   presetId: null, volume: 0.34, color: '#c084fc', instrument: { type: 'apollo', params: subBass() } },
    { key: 'bass',  id: uid(), name: 'Bass',  presetId: null, volume: 0.50, color: '#a78bfa', instrument: { type: 'apollo', params: funkBass() } },
    { key: 'tine',  id: uid(), name: 'Tine',  presetId: null, volume: 0.60, pan: -0.14, color: '#7dd3fc', instrument: { type: 'apollo', params: tine() } },
    { key: 'pluck', id: uid(), name: 'Pluck', presetId: null, volume: 0.30, pan: 0.22, color: '#6ee7b7', instrument: { type: 'apollo', params: pluck() } },
    { key: 'glass', id: uid(), name: 'Glass', presetId: null, volume: 0.055, pan: -0.24, color: '#fde68a', instrument: { type: 'apollo', params: glass() } },
  ]

  const sections = staggered.map((sec, si) => {
    const on = new Set(sec.layers)
    const density = DENSITY[si]
    const parts = {}
    const push = (key, notes) => { (parts[key] ??= []).push(...notes) }

    for (let i = 0; i < sec.bars; i++) {
      const at = i * BPB
      const last = i === sec.bars - 1
      const busy = density > 0.7
      const shift = ns => ns.map(n => ({ ...n, beat: n.beat + at }))

      if (on.has('sub')) push('sub', shift(subBar(i, { held: density < 0.6 })))
      if (on.has('bass')) push('bass', shift(bassBar(i, { walk: busy })))
      if (on.has('tine')) push('tine', shift(tineBar(i, { sparse: density < 0.4 })))
      if (on.has('kick')) push('kick', shift(kickBar({ busy })))
      if (on.has('kick')) push('snare', shift(snareBar({ fill: last && busy })))
      if (on.has('hats')) push('hats', shift(hatBar({ sixteenths: busy })))
      if (on.has('pluck')) push('pluck', shift(pluckBar(i)))
      if (on.has('glass')) push('glass', shift(glassBar(i)))
    }

    // The second half of Body B answers the first: same rhythm, moved onto the
    // chord underneath it, so the section develops instead of repeating.
    if (sec.name === 'Body B' && parts.pluck) {
      const half = sec.bars * BPB / 2
      const front = parts.pluck.filter(n => n.beat < half)
      const tones = VOICED[2]
      parts.pluck = [...front, ...motif.answer(front, tones).map(n => ({ ...n, beat: n.beat + half }))]
    }

    // Thin the quiet sections for real. A section that is only quieter is still
    // the same loop; a section that is genuinely sparser is a different place.
    if (density < 0.5) {
      for (const k of ['tine', 'pluck', 'hats']) if (parts[k]) parts[k] = thin(parts[k], 0.35 + density, { bpb: BPB })
    }

    // One place where the feel is applied, so every part leans consistently.
    // A quiet section is not just fewer layers — the parts still playing are
    // played SOFTER. Without this the arrangement changes while the LEVEL does
    // not, which is exactly what "the song only moves 7 dB" was measuring: the
    // two loudest layers never left, so the strip-back was inaudible as a drop.
    const dyn = 0.40 + 0.60 * DENSITY[si]

    const played = {}
    const ROLE = { kick: 'kick', snare: 'snare', hats: 'hats', sub: 'sub', bass: 'bass', tine: 'keys', pluck: 'pluck', glass: 'pad' }
    for (const [k, ns] of Object.entries(parts)) {
      played[k] = play(ns, ROLE[k] ?? 'default', g, { bpb: BPB })
        .map(n => N(n.pitch, n.beat, n.durationBeats, Math.max(1, Math.round(n.velocity * dyn))))
    }
    return { name: sec.name, bars: sec.bars, parts: played }
  })

  // ── Dynamics, as bars in the FX lane where they can be seen and edited ────
  const at = {}
  let acc = 0
  for (const s of staggered) { at[s.name] = acc; acc += s.bars * BPB }
  const bars = [
    // Pull the filter down and duck slightly before each arrival, so the arrival lands.
    dipInto('tine', at['Body A'], 3),
    dipInto('tine', at['Body B'], 3),
    dipInto('bass', at['Body B'], 2),
    // Lift across the peaks: a little drive and a relative volume ride.
    lift('bass', at['Body A'], 10 * BPB, { drive: 0.04, gain: 1.1 }),
    lift('tine', at['Body B'], 10 * BPB, { drive: 0.03, gain: 1.08 }),
    // The hollow section sits behind a closed filter and opens on the way out.
    bar('tine', at['Hollow'], 6 * BPB, { filterHz: 900 }, [[0, 1], [4 * BPB, 1], [6 * BPB, 0.15]], 1),
    bar('glass', at['Hollow'], 6 * BPB, { reverbWet: 0.42 }, [[0, 0], [2 * BPB, 1], [6 * BPB, 1]], 0),
    // The outro fades on the instruments rather than the master, so the reverb
    // tails keep ringing while the parts leave.
    bar('tine', at['Out'] + 6 * BPB, 4 * BPB, { gain: 0.2, filterHz: 700 }, [[0, 0], [4 * BPB, 1]], 2),
    bar('sub', at['Out'] + 6 * BPB, 4 * BPB, { gain: 0.25 }, [[0, 0], [4 * BPB, 1]], 0),
  ]

  return assemble({
    name: 'Coriander', bpm: BPM, bpb: BPB, key: 'G', scale: 'minor',
    swing: 0, tracks, sections, bars, masterVolume: 0.34,
  })
}

// ── Run ─────────────────────────────────────────────────────────────────────
const built = build()
mkdirSync(OUT_DIR, { recursive: true })
const label = flagOf('label', 'Coriander')
const outFile = join(flagOf('out', OUT_DIR), `${label}.cfproj`)
writeFileSync(outFile, JSON.stringify(built.project))

const clips = built.project.dawProject.arrangementClips
console.log(`${label} — ${BPM} BPM, ${built.seconds.toFixed(0)}s, ${clips.length} clips, ` +
  `${clips.reduce((a, c) => a + c.notes.length, 0)} notes, ${built.project.dawProject.clipEffects.length} fx bars`)
for (const s of staggered) console.log(`  ${s.name.padEnd(8)} ${String(s.bars).padStart(2)} bars  ${s.layers.join(' ')}`)
console.log(`→ ${outFile}`)

if (argv.includes('--listen')) {
  execFileSync('node', ['--experimental-strip-types', join(ROOT, 'scripts/listen.mjs'), outFile, '--target=general'],
    { cwd: ROOT, stdio: 'inherit' })
}
