// "the quiet part" — Artemas, and the first song whose drums are recordings.
//
// WHAT THE PROFILE SAID, and what I did with it (styles/artemas.json, 5 records):
//
//   tempo   median 98, range 95-152.   "i'd ruin it again" sat at 148, the very
//                                      top. 98 is the middle of what he does and
//                                      a different record: slow, heavy, patient.
//   keys    all five minor, all flat.  E-flat minor here (B-flat minor last).
//   length  median 136s.               137s.
//   travel  median 7.5 dB.             the arc is built to land near that, not
//                                      to maximise — our songs have been moving
//                                      more than any of the references.
//   swing   49.8%, spread 43.7 ms.     straight, but loosely played.
//
// THE SOUNDS ARE SAMPLES NOW. Brae: "your drums don't sound much like drums,
// just cut sawtooth oscillators." Kick, clap and hats are recordings; so are the
// bass and the piano. Each one is still an Apollo patch — the sample is the
// source and Apollo's filter, envelope and drive are the shaping — and each is
// chosen by measurement, not by name:
//
//   kick    techno    0.44s, 58 Hz, and 8% of its energy in 80-250 Hz, which is
//                     the punch that lets it read THROUGH the sub instead of
//                     underneath it. trap808's is deeper (32 Hz) and longer, and
//                     would have fought the sub for the same octave.
//   clap    boombap   the most body of the eight (8% in 250-1200) and the
//                     darkest — a slow backbeat needs something to carry.
//   hats    boombap   140ms and 6.5 kHz, dustier than techno's 70ms. At 98 the
//                     tight one leaves holes.
//   bass    electric-bass, real, and the three roots it has are all in tune.
//   piano   grand-piano — usable C3..A4; its low roots are mislabelled and
//                     dropped, so nothing here is written below C3 for it.
//
// The sub stays synthesised, because a continuous glide between notes is a thing
// a one-shot cannot do — see the glide line below.

import { uid, N, rng, feel, assemble, bar, dipInto, lift } from './song-kit.mjs'
import { groove, play, voice, intoSlot, stagger, densityArc, deMud } from './lib/craft.mjs'
import { glideSub, fogPad } from './apollo-voices.mjs'
import { sKick, sClap, sHat, sBass, sPiano } from './sampled-voices.mjs'

const BPM = 98, BPB = 4, KEY = 'Eb', SCALE = 'minor'
const rand = rng(20260827)
const f = feel(rand, BPM)
const g = groove({ bpm: BPM, spreadMs: 12, seed: 20260827 })

// ── Harmony ─────────────────────────────────────────────────────────────────
// i - bVI - iv - bII.  The last one is the borrow CRAFT §5 argues for: the
// Neapolitan, a major chord a semitone above the tonic. It leans onto E-flat
// minor and the loop restarts there, so it resolves without ever settling.
const LOOP = ['Ebm9', 'Bmaj7', 'Abm11', 'Emaj7']
const ROOTS = { Ebm9: 39, Bmaj7: 35, Abm11: 44, Emaj7: 40 }
const chordAt = i => LOOP[i % 4]

// ── Sub ─────────────────────────────────────────────────────────────────────
// One note for the whole song, moved by a drawn pitch curve — one attack in
// 137 seconds. `anchor: 'center'` straddles the bar line so the downbeat is in
// tune; at this tempo a departing glide would leave the bar sitting on the
// previous chord's root long enough to hear it as a wrong note.
const subStep = i => ({ pitch: intoSlot(ROOTS[chordAt(i)] - 12, 'sub'), beat: 0, durationBeats: BPB, velocity: 84 })

// ── Bass ────────────────────────────────────────────────────────────────────
// It STAYS or it FALLS. Brae, on the last song: the figure went "2 low and 1
// high", and taking the high note out made it stronger — "just like how people
// tone down for statements and up for questions."  So the shape here answers
// downward, and the tone never changes: one sample, one filter setting, and only
// the volume moves.
const bassBar = (i, sparse = false) => {
  const root = intoSlot(ROOTS[chordAt(i)], 'bass')
  const out = [
    { pitch: root, beat: 0, durationBeats: 1.1, velocity: 104 },
    { pitch: root, beat: 1.5, durationBeats: 0.7, velocity: 88 },
  ]
  // Falls to the chord's own FIFTH, an octave down (root - 5). Falling by a
  // whole tone was the obvious thing and it was wrong: from B it lands on A and
  // from E on D, neither of which is in E-flat minor. The fifth is in the chord
  // by definition, so the answer is always both a fall and in key.
  if (!sparse) out.push({ pitch: root - 5, beat: 2.75, durationBeats: 1.0, velocity: 92 })
  return out
}

// ── Piano ───────────────────────────────────────────────────────────────────
// Rootless, so the bass owns the bottom and the middle stays open. Voice-led:
// each chord moves to the one nearest the last, which is what stops a four-chord
// loop sounding like four separate chords.
let lastVoicing = null
const pianoBar = (i, { held = false } = {}) => {
  const v = voice(chordAt(i), { style: 'rootless', centre: 64, spread: 12, near: lastVoicing })
  lastVoicing = v
  const dur = held ? BPB : 2.4
  return v.map((p, k) => ({
    pitch: p, beat: k * 0.035, durationBeats: dur - k * 0.035,
    velocity: 74 - k * 4,
  }))
}

// ── Pad ─────────────────────────────────────────────────────────────────────
// Three notes, and stopping just short of the bar line. A four-note open voicing
// held for a full bar put 28 voices on this track at once against Apollo's 16 —
// the pad's own unison multiplies every note, and bars that touch end to end
// overlap for one block at the seam.
const padBar = i => {
  const v = deMud(voice(chordAt(i), { style: 'open', centre: 55, spread: 12 })).slice(0, 3)
  return v.map(p => ({ pitch: p, beat: 0, durationBeats: BPB - 0.15, velocity: 58 }))
}

// ── Drums ───────────────────────────────────────────────────────────────────
// Kick leaves the second half of beat 2 alone so the bass answer has room.
const kickBar = () => [
  { pitch: 36, beat: 0, durationBeats: 0.5, velocity: 118 },
  { pitch: 36, beat: 2.5, durationBeats: 0.5, velocity: 104 },
]
const clapBar = () => [
  { pitch: 39, beat: 1, durationBeats: 0.5, velocity: 108 },
  { pitch: 39, beat: 3, durationBeats: 0.5, velocity: 112 },
]
// Consistent all the way through, or gone. Brae on "cross my heart": the hat
// holds, and when it changes it LEAVES — it does not get decorated.
const hatBar = () => Array.from({ length: 8 }, (_, k) => ({
  pitch: 42, beat: k * 0.5, durationBeats: 0.25, velocity: k % 2 ? 96 : 70,
}))

// ── Arrangement ─────────────────────────────────────────────────────────────
const SECTIONS = [
  { name: 'Alone',   bars: 8,  energy: 0.22, want: ['sub', 'pad'] },
  { name: 'Verse',   bars: 12, energy: 0.48, want: ['sub', 'pad', 'bass', 'piano'] },
  { name: 'Lift',    bars: 4,  energy: 0.62, want: ['sub', 'pad', 'bass', 'piano', 'hats'] },
  { name: 'Chorus',  bars: 12, energy: 1.00, want: ['sub', 'pad', 'bass', 'piano', 'hats', 'kick', 'clap'] },
  { name: 'Gone',    bars: 8,  energy: 0.30, want: ['sub', 'pad', 'piano'] },
  { name: 'Chorus 2', bars: 12, energy: 0.96, want: ['sub', 'pad', 'bass', 'piano', 'hats', 'kick', 'clap'] },
]

const TRACKS = [
  { key: 'sub',   id: uid(), name: 'Sub',   presetId: null, volume: 0.52, color: '#a78bfa',
    glide: true, glideOpts: { glide: 0.28, accel: 0.15, decel: 0.8, anchor: 'center' },
    instrument: { type: 'apollo', params: glideSub() } },
  { key: 'bass',  id: uid(), name: 'Bass',  presetId: null, volume: 0.62, color: '#f472b6',
    instrument: { type: 'apollo', params: sBass('electric-bass', { cutoff: 0.68 }) } },
  { key: 'piano', id: uid(), name: 'Piano', presetId: null, volume: 0.46, pan: -0.10, color: '#fcd34d',
    instrument: { type: 'apollo', params: sPiano({ cutoff: 0.88 }) } },
  { key: 'pad',   id: uid(), name: 'Pad',   presetId: null, volume: 0.17, pan: 0.12, color: '#67e8f9',
    instrument: { type: 'apollo', params: fogPad() } },
  { key: 'kick',  id: uid(), name: 'Kick',  presetId: null, volume: 0.72, color: '#fb923c',
    instrument: { type: 'apollo', params: sKick('techno') } },
  { key: 'clap',  id: uid(), name: 'Clap',  presetId: null, volume: 0.88, pan: 0.16, color: '#a3e635',
    instrument: { type: 'apollo', params: sClap('boombap') } },
  { key: 'hats',  id: uid(), name: 'Hats',  presetId: null, volume: 0.82, pan: 0.20, color: '#fda4af',
    instrument: { type: 'apollo', params: sHat('boombap') } },
]

const density = densityArc(SECTIONS.map(s => s.energy))
const staged = stagger(SECTIONS)
// stagger() pulls an entrance back a section when too many layers would arrive
// together, and says so when it cannot. Printed rather than swallowed: "several
// layers arrive at once" is a loop being switched on, which is the thing the
// arrangement rules exist to prevent.
for (const u of staged.unresolved) console.log(`  ! ${u}`)

let barIndex = 0
const sections = staged.sections.map((sec, si) => {
  const parts = {}
  const push = (k, ns) => { (parts[k] ??= []).push(...ns) }
  const on = new Set(sec.layers)
  // The eight bars before the last chorus lose the hats entirely — the gesture
  // Brae described, and the reason the chorus lands when they come back.
  for (let b = 0; b < sec.bars; b++) {
    const i = barIndex + b
    const shift = ns => ns.map(n => ({ ...n, beat: n.beat + b * BPB }))
    if (on.has('sub')) push('sub', shift([subStep(i)]))
    if (on.has('pad')) push('pad', shift(padBar(i)))
    if (on.has('piano')) push('piano', shift(pianoBar(i, { held: sec.name === 'Gone' })))
    if (on.has('bass')) push('bass', shift(bassBar(i, sec.name === 'Verse' && b < 4)))
    if (on.has('kick')) push('kick', shift(kickBar()))
    if (on.has('clap')) push('clap', shift(clapBar()))
    if (on.has('hats')) push('hats', shift(hatBar()))
  }
  barIndex += sec.bars

  const dyn = 0.74 + 0.26 * density[si]
  const ROLE = { kick: 'kick', clap: 'clap', hats: 'hats', sub: 'sub', bass: 'bass', piano: 'keys', pad: 'pad' }
  const played = {}
  for (const [k, ns] of Object.entries(parts)) {
    if (k === 'sub') {
      // A glide track's notes are pitch TARGETS, not notes — song-kit turns them
      // into one note and a curve. Grooving them would micro-time an attack that
      // does not exist.
      played[k] = ns.map(n => N(n.pitch, n.beat, n.durationBeats, 84))
      continue
    }
    played[k] = play(ns, ROLE[k] ?? 'default', g, { bpb: BPB })
      .map(n => N(n.pitch, n.beat, n.durationBeats, Math.max(1, Math.round(n.velocity * dyn))))
  }
  return { name: sec.name, bars: sec.bars, parts: played }
})

// ── Dynamics, in the FX lane where they can be edited ───────────────────────
const at = {}
{
  let b = 0
  for (const s of SECTIONS) { at[s.name] = b; b += s.bars * BPB }
}
const W = n => n * BPB
const bars = [
  bar('sub', 0, W(8), { gain: 0.62 }, [[0, 1], [W(6), 0.45], [W(8), 0]], 0),
  bar('pad', 0, W(8), { filterHz: 900, gain: 0.8 }, [[0, 1], [W(8), 0]], 0),
  dipInto('piano', at['Chorus'], 3),
  dipInto('bass', at['Chorus'], 2),
  lift('bass', at['Chorus'], W(12), { drive: 0.05, gain: 1.06 }, 1),
  lift('piano', at['Chorus'], W(12), { drive: 0.03, gain: 1.05 }, 1),
  bar('pad', at['Gone'], W(8), { filterHz: 700, gain: 0.9 }, [[0, 0], [W(2), 1], [W(6), 1], [W(8), 0.2]], 0),
  dipInto('hats', at['Chorus 2'], 4),
  lift('bass', at['Chorus 2'], W(12), { drive: 0.06, gain: 1.08 }, 1),
  bar('sub', at['Chorus 2'] + W(9), W(3), { gain: 0.4 }, [[0, 0], [W(3), 1]], 0),
]

const built = assemble({
  name: 'the quiet part',
  bpm: BPM, bpb: BPB, key: KEY, scale: SCALE,
  swing: 0, tracks: TRACKS, sections, bars, masterVolume: 0.84,
})

import { writeFileSync } from 'node:fs'
const OUT = process.env.SONG_OUT ?? '/Users/brae/Desktop/100lights-ai-renders/the quiet part.cfproj'
writeFileSync(OUT, JSON.stringify(built.project))
const dp = built.project.dawProject
const notes = dp.arrangementClips.reduce((a, c) => a + (c.notes?.length ?? 0), 0)
console.log(`${dp.name} — ${BPM} BPM, ${KEY} ${SCALE}, ${built.seconds.toFixed(0)}s, ` +
  `${dp.arrangementClips.length} clips, ${notes} notes, ${dp.clipEffects.length} fx bars`)
for (const s of staged.sections) console.log(`  ${s.name.padEnd(9)} ${String(s.bars).padStart(2)} bars  ${s.layers.join(' ')}`)
console.log(`→ ${OUT}`)
