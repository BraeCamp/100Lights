// "under it all" — A♭ minor, 132 BPM. An original song in the measured Artemas
// space (styles/artemas.json), not a recreation of any of theirs.
//
// ── WHAT THIS SONG IS ───────────────────────────────────────────────────────
//
// Weight and space. One low sound moves underneath a room that is mostly empty,
// and everything else is staging for it. When a part arrives you hear it because
// there is nothing else there to hide behind.
//
// ── WHY THIS SHAPE ──────────────────────────────────────────────────────────
//
// CRAFT §7b separates the five references into five kinds of record, and two of
// them are already written: "i'd ruin it again" took the DRIVING shape and
// "Cold Signal" took the HALF-TIME one. This takes the one nothing has attempted:
//
//   cross my heart | 132 bpm | sub 61% / bass 27% | harmony −20 dB | 9 sections
//                  | travels 15.6 dB | "sub-led and nearly empty"
//
// Every number below is that row, and each is a decision made against it:
//
//   tempo    132.   Not the 98 median — that is what the last two songs used, and
//                   this shape lives at the top of the range.
//   sub-led  the sub is the loudest thing and it is the only part that MOVES by
//                   pitch. It is not accompaniment, it is the song.
//   harmony  −20 dB. Nearly absent. The pad here is a ghost — audible as room,
//                   never as chords. This is the widest variable in the whole
//                   reference set (−5.2 to −20 dB) and it is a decision.
//   sections 9, and they travel 15.6 dB. This is the ONE shape where our habit of
//                   moving too much (17.7 dB against their 3–15.6) is correct, so
//                   the dynamic scale is wide: 0.55–1.0, not ruinitagain's 0.72.
//   swing    49.5–50.0% across all five references. None, anywhere.
//
// ── WHY A♭ MINOR ────────────────────────────────────────────────────────────
//
// Not for the mood — for where the sub lands. The loop falls i – i – ♭VII – ♭VI,
// so the sub's roots descend, and in A♭ minor they descend to A♭1 · G♭1 · E1 =
// 52 · 46 · 41 Hz. That is inside the 20–60 Hz sub band for all three notes AND
// inside SLOTS.sub (28–45), so the descent survives `intoSlot` intact.
//
// It does not in the neighbouring keys, which is the whole reason for the choice:
// in G♭ minor the third root is D1 = 26, one semitone under the slot floor, and
// `intoSlot` folds it UP an octave — turning a three-step fall into a fall and a
// jump. On a record whose only moving part is the sub, that is the song broken.
//
// ♭VI of A♭ minor is F♭. It is spelled enharmonically here (Emaj7) because
// double-flat chord symbols are unreadable and the parser takes either — the
// same trick "the quiet part" used for its Neapolitan.
//
// ── WHAT EACH PART DOES, AND REFUSES TO DO ──────────────────────────────────
//
//   sub    ONE note for the whole song, moved by a drawn curve. It descends and
//          it never rises within the loop; the only rise is the loop restarting.
//          The glide is slow on purpose (0.6 beats ≈ 270 ms) — on a sub-led
//          record the movement between notes IS the hook, so it is meant to be
//          heard travelling rather than to arrive cleanly.
//   kick   one per bar, on the downbeat, plus a single late push. Techno kit:
//          58 Hz with 8% of its energy in 80–250, which is the punch that reads
//          THROUGH a sub instead of underneath it (trap808's is deeper and would
//          fight for the same octave).
//   rim    ONE backbeat a bar, at 132 that is a half-time feel. A rim not a clap
//          because a clap has body and body is what this record is spending on
//          the sub.
//   hats   eighths, never sixteenths. Sixteenths at 132 are 8.8 onsets/sec, the
//          top of the measured range, and this song's whole argument is space.
//   bass   arrives late and stays sparse. At 27% against the sub's 61% it is an
//          outline of the harmony, not a second low end.
//   ghost  the harmony, at −20 dB. Long, dark, filtered down to a hum. It is
//          there so the chords exist, not so they are heard.
//   clap   the drops only. It is the thing that says "this is the loud part".
//
// ── ONE MEASUREMENT THAT IS NOT ACTIONABLE, AND WHY ─────────────────────────
//
// `listen` warns that the mix is near-mono at 0.973, against the references'
// 0.438–0.932. That warning is correct and is being left alone on purpose.
// Correlation is energy-weighted, and on this record 58% of the energy is the
// sub and another 25% is the bass — 83% of it is low end, which is kept mono
// deliberately, because a widened sub is a mixing fault in any idiom. Even a
// perfectly decorrelated top end cannot pull the figure below about 0.83 here.
// The references reach 0.44 because they have a wide vocal and wide synths over
// a mono low end; this is an instrumental with neither. The fix is a part that
// does not exist, not a width control — so nothing is turned up to chase it.

import { uid, N, rng, feel, assemble, bar, dipInto, lift } from './song-kit.mjs'
import { groove, play, voice, intoSlot, stagger, densityArc, deMud } from './lib/craft.mjs'
import { glideSub, fogPad } from './apollo-voices.mjs'
import { sKick, sRim, sClap, sHat, sOpenHat, sBass } from './sampled-voices.mjs'

const BPM = 132, BPB = 4, KEY = 'Ab', SCALE = 'minor'
const rand = rng(20260829)
const f = feel(rand, BPM)
const g = groove({ bpm: BPM, spreadMs: 14, seed: 20260829 })

// ── Harmony ─────────────────────────────────────────────────────────────────
// i – i – ♭VII – ♭VI. Two bars of home, then a two-step fall away from it, and
// the loop restarts by jumping back up. Half the loop is one chord because a
// nearly-empty record needs somewhere to be still.
const LOOP = ['Abm9', 'Abm9', 'Gbmaj9', 'Emaj7']
const ROOTS = { Abm9: 44, Gbmaj9: 42, Emaj7: 40 }
const chordAt = i => LOOP[i % 4]

// ── Sub ─────────────────────────────────────────────────────────────────────
const subStep = i => ({
  pitch: intoSlot(ROOTS[chordAt(i)] - 12, 'sub'), beat: 0, durationBeats: BPB, velocity: 92,
})

// ── Bass ────────────────────────────────────────────────────────────────────
// Two notes a bar, both off the downbeat — the sub already owns every downbeat,
// and doubling it there is how a low end turns to mud. `full` adds one more.
const bassBar = (i, full = false) => {
  const root = intoSlot(ROOTS[chordAt(i)], 'bass')
  const out = [
    { pitch: root, beat: 0.5, durationBeats: 0.7, velocity: 98 },
    { pitch: root, beat: 2.5, durationBeats: 0.9, velocity: 86 },
  ]
  if (full) out.push({ pitch: root + 7, beat: 3.5, durationBeats: 0.4, velocity: 74 })
  return out
}

// ── Ghost harmony ───────────────────────────────────────────────────────────
// Three notes, held, voice-led so the loop reads as one shape changing rather
// than four chords. It sits at −20 dB; it is room, not chords.
//
// Centred at 64, not the 57 written first: at 57 it shared ten semitones with
// the bass, which `listen` calls out as a register clash — two parts in one
// octave mask each other whatever the faders do. Moving it up also put the only
// midrange this song has where the reference keeps its own (mid 4.3%).
let lastVoicing = null
const ghostBar = i => {
  const v = deMud(voice(chordAt(i), { style: 'open', centre: 64, spread: 10, near: lastVoicing })).slice(0, 3)
  lastVoicing = v
  return v.map(p => ({ pitch: p, beat: 0, durationBeats: BPB - 0.2, velocity: 54 }))
}

// ── Drums ───────────────────────────────────────────────────────────────────
const kickBar = (b, push = false) => {
  const out = [{ pitch: 36, beat: 0, durationBeats: 0.5, velocity: 120 }]
  // One late push every fourth bar, so the pattern is not identical eight times
  // running. Any more often and it stops being an event.
  if (push && b % 4 === 3) out.push({ pitch: 36, beat: 3.5, durationBeats: 0.4, velocity: 96 })
  return out
}
const rimBar = () => [{ pitch: 51, beat: 2, durationBeats: 0.4, velocity: 104 }]
const clapBar = () => [{ pitch: 39, beat: 2, durationBeats: 0.5, velocity: 110 }]
const hatBar = () => Array.from({ length: 8 }, (_, k) => ({
  pitch: 42, beat: k * 0.5, durationBeats: 0.22, velocity: k % 2 ? 90 : 66,
}))
// One open hat every four bars inside a drop. Written first as one per SECTION,
// which came to two notes in the whole song at 35 dB down — a track doing
// nothing. Every fourth bar is still sparse and is actually a part.
const openBar = b => [{ pitch: 46, beat: 0, durationBeats: 1.2, velocity: b === 0 ? 96 : 74 }]

// ── Arrangement ─────────────────────────────────────────────────────────────
// Nine sections, which is the reference's count and far more than we usually
// write. Short sections are what let a record travel 15 dB without any single
// change being violent.
const SECTIONS = [
  { name: 'Under',   bars: 4,  energy: 0.14, want: ['sub'] },
  { name: 'Room',    bars: 8,  energy: 0.30, want: ['sub', 'hats'] },
  { name: 'Verse',   bars: 8,  energy: 0.50, want: ['sub', 'hats', 'kick', 'rim'] },
  { name: 'Push',    bars: 4,  energy: 0.66, want: ['sub', 'hats', 'kick', 'rim', 'bass', 'ghost'] },
  { name: 'Drop',    bars: 12, energy: 1.00, want: ['sub', 'hats', 'kick', 'rim', 'bass', 'clap', 'ghost', 'open'] },
  { name: 'Gone',    bars: 4,  energy: 0.12, want: ['sub', 'ghost'] },
  { name: 'Verse 2', bars: 12, energy: 0.58, want: ['sub', 'hats', 'kick', 'rim', 'bass'] },
  { name: 'Drop 2',  bars: 12, energy: 0.98, want: ['sub', 'hats', 'kick', 'rim', 'bass', 'clap', 'ghost', 'open'] },
  { name: 'Out',     bars: 8,  energy: 0.20, want: ['sub', 'ghost'] },
]

const TRACKS = [
  { key: 'sub',   id: uid(), name: 'Sub',   presetId: null, volume: 0.74, color: '#a78bfa',
    glide: true, glideOpts: { glide: 0.6, accel: 0.25, decel: 0.75, anchor: 'center' },
    instrument: { type: 'apollo', params: glideSub() } },
  { key: 'bass',  id: uid(), name: 'Bass',  presetId: null, volume: 0.52, color: '#f472b6',
    instrument: { type: 'apollo', params: sBass('electric-bass', { cutoff: 0.62 }) } },
  { key: 'ghost', id: uid(), name: 'Ghost', presetId: null, volume: 0.07, pan: 0.10, color: '#67e8f9',
    instrument: { type: 'apollo', params: fogPad() } },
  { key: 'kick',  id: uid(), name: 'Kick',  presetId: null, volume: 0.76, color: '#fb923c',
    instrument: { type: 'apollo', params: sKick('techno') } },
  { key: 'rim',   id: uid(), name: 'Rim',   presetId: null, volume: 0.86, pan: -0.14, color: '#a3e635',
    instrument: { type: 'apollo', params: sRim('studio', { verb: 0.20 }) } },
  { key: 'clap',  id: uid(), name: 'Clap',  presetId: null, volume: 0.66, pan: 0.16, color: '#fca5a5',
    instrument: { type: 'apollo', params: sClap('techno', { verb: 0.26 }) } },
  { key: 'hats',  id: uid(), name: 'Hats',  presetId: null, volume: 0.76, pan: 0.22, color: '#fda4af',
    instrument: { type: 'apollo', params: sHat('techno', { verb: 0.10 }) } },
  { key: 'open',  id: uid(), name: 'Open',  presetId: null, volume: 0.74, pan: -0.20, color: '#fdba74',
    instrument: { type: 'apollo', params: sOpenHat('techno', { verb: 0.14 }) } },
]

const density = densityArc(SECTIONS.map(s => s.energy))
const staged = stagger(SECTIONS)
for (const u of staged.unresolved) console.log(`  ! ${u}`)

let barIndex = 0
const sections = staged.sections.map((sec, si) => {
  const parts = {}
  const push = (k, ns) => { (parts[k] ??= []).push(...ns) }
  const on = new Set(sec.layers)
  const isDrop = sec.name.startsWith('Drop')
  for (let b = 0; b < sec.bars; b++) {
    const i = barIndex + b
    const shift = ns => ns.map(n => ({ ...n, beat: n.beat + b * BPB }))
    if (on.has('sub')) push('sub', shift([subStep(i)]))
    if (on.has('ghost')) push('ghost', shift(ghostBar(i)))
    if (on.has('bass')) push('bass', shift(bassBar(i, isDrop)))
    if (on.has('kick')) push('kick', shift(kickBar(b, isDrop)))
    if (on.has('rim')) push('rim', shift(rimBar()))
    if (on.has('clap')) push('clap', shift(clapBar()))
    if (on.has('hats')) push('hats', shift(hatBar()))
    // The open hat is a seam marker: bar 0 of the section, and nowhere else.
    if (on.has('open') && b % 4 === 0) push('open', shift(openBar(b)))
  }
  barIndex += sec.bars

  // A WIDE scale, unlike ruinitagain's 0.72–1.0: this is the shape that travels.
  const dyn = 0.55 + 0.45 * density[si]
  const ROLE = { kick: 'kick', clap: 'clap', rim: 'clap', hats: 'hats', open: 'hats', sub: 'sub', bass: 'bass', ghost: 'pad' }
  const played = {}
  for (const [k, ns] of Object.entries(parts)) {
    if (k === 'sub') {
      // Glide notes are pitch TARGETS, not notes — grooving them would micro-time
      // an attack that does not exist.
      played[k] = ns.map(n => N(n.pitch, n.beat, n.durationBeats, 92))
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
  // The sub is one unbroken note, so its ENTRANCES AND EXITS are gain moves.
  // A glide track cannot drop out by having no notes — there is only ever one.
  bar('sub', 0, W(4), { gain: 0.8 }, [[0, 0], [W(3), 0.9], [W(4), 1]], 0),
  bar('sub', at['Gone'], W(4), { gain: 0.62 }, [[0, 1], [W(1), 0.5], [W(4), 0.55]], 0),
  bar('sub', at['Out'], W(8), { gain: 0.7 }, [[0, 1], [W(4), 0.7], [W(8), 0]], 0),
  // The ghost opens from nothing and closes to nothing every time it appears.
  bar('ghost', at['Push'], W(4), { filterHz: 560, gain: 0.75 }, [[0, 0], [W(4), 1]], 0),
  bar('ghost', at['Drop'], W(12), { filterHz: 760, gain: 0.9 }, [[0, 1], [W(10), 1], [W(12), 0.3]], 0),
  bar('ghost', at['Gone'], W(4), { filterHz: 620, gain: 1.0 }, [[0, 0], [W(1.5), 1], [W(4), 0.8]], 0),
  bar('ghost', at['Drop 2'], W(12), { filterHz: 800, gain: 0.9 }, [[0, 0.3], [W(2), 1], [W(12), 0.4]], 0),
  bar('ghost', at['Out'], W(8), { filterHz: 560, gain: 1.0 }, [[0, 0.9], [W(8), 0]], 0),
  // Space before each arrival, and a lift across it.
  dipInto('hats', at['Verse'], 2),
  dipInto('kick', at['Drop'], 3),
  dipInto('bass', at['Drop'], 3),
  lift('bass', at['Drop'], W(12), { drive: 0.06, gain: 1.08 }, 1),
  lift('kick', at['Drop'], W(12), { drive: 0.04, gain: 1.05 }, 1),
  dipInto('hats', at['Verse 2'], 4),
  dipInto('kick', at['Drop 2'], 3),
  lift('bass', at['Drop 2'], W(12), { drive: 0.07, gain: 1.10 }, 1),
  lift('kick', at['Drop 2'], W(12), { drive: 0.05, gain: 1.06 }, 1),
]

const built = assemble({
  name: 'under it all',
  bpm: BPM, bpb: BPB, key: KEY, scale: SCALE,
  swing: 0, tracks: TRACKS, sections, bars, masterVolume: 0.84,
})

import { writeFileSync } from 'node:fs'
const OUT = process.env.SONG_OUT ?? '/Users/brae/Desktop/100lights-ai-renders/under it all.cfproj'
writeFileSync(OUT, JSON.stringify(built.project))
const dp = built.project.dawProject
const notes = dp.arrangementClips.reduce((a, c) => a + (c.notes?.length ?? 0), 0)
console.log(`${dp.name} — ${BPM} BPM, ${KEY} ${SCALE}, ${built.seconds.toFixed(0)}s, ` +
  `${dp.arrangementClips.length} clips, ${notes} notes, ${dp.clipEffects.length} fx bars`)
for (const s of staged.sections) console.log(`  ${s.name.padEnd(9)} ${String(s.bars).padStart(2)} bars  ${s.layers.join(' ')}`)
console.log(`→ ${OUT}`)
