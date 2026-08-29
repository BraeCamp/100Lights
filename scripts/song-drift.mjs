#!/usr/bin/env node
// ── "Drift" — an ORIGINAL dark-pop instrumental in the Artemas idiom ─────────
//
//   node scripts/song-drift.mjs  → public/_songgen/drift.json
//
// Not the recreation. scripts/recreate-artemas.mjs deliberately reproduces "how
// could u love somebody like me?" (F# minor, 146, i–III–VI); this is a NEW song
// that shares its character and nothing else — B minor, 150, i–VI–iv–v, a
// different form and a different arc.
//
// What "the Artemas idiom" means here, concretely, because a template would
// produce something generic:
//
//   SPACE IS THE INSTRUMENT. In the real track the topline is the vocal, so the
//   music underneath is deliberately unfinished — a sub, a stab, a pad, a beat.
//   There is NO LEAD LINE here and that is not an omission: inventing a melody
//   to fill the vocal's gap is exactly what makes a recreation sound wrong, and
//   it is a standing rule for this repo's songs.
//
//   THE BASS IS A DRONE, not a bassline. One held note per chord, octave 1,
//   played by a synth oscillator rather than a sample so it never decays and has
//   no low-note limit.
//
//   THE MOVEMENT IS HARMONIC AND FILTERED, not melodic. Chords change; the pad's
//   filter opens and closes with the energy; the stabs thin out and thicken.
//
// The arc is the point. Density is not constant: it starts on a filtered pad
// alone, drops to almost nothing before the last hook, and ends by taking the
// drums away rather than by fading. Voicings are m7/maj7 (not bare triads) so
// the harmony has colour without a melody sitting on top of it.
//
// Deterministic: a fixed seed, hand-authored placement, no random gates. Every
// track is split into one clip PER SECTION, so the song opens in Beacon as
// something editable rather than as four long unsplittable blocks.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STEP = 0.25
const tmp = join(mkdtempSync(join(tmpdir(), 'drift-')), 'music.mjs')
execFileSync('npx', ['esbuild', 'scripts/_music_barrel.ts', '--bundle', '--format=esm', '--platform=node', '--outfile=' + tmp], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
const { DRUM_KITS } = await import(pathToFileURL(tmp).href)

let _n = 0
const uid = p => `${p}${(_n++).toString(36)}`
let _s = 20260829
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 0xffffffff }
// Humanised velocity: downbeats lean in, off-16ths lean back. Without this every
// hit is identical and the groove reads as a drum machine rather than a part.
const hv = (base, slot = 0) => {
  let v = base + (rnd() * 8 - 4)
  if (slot % 16 === 0) v += 6
  else if (slot % 8 === 0) v += 3
  else if (slot % 2 === 1) v -= 6
  return Math.max(28, Math.min(122, Math.round(v)))
}
const note = (pitch, startBeat, dur, velocity) => ({
  pitch, startBeat: +startBeat.toFixed(4),
  durationBeats: +Math.max(0.05, dur).toFixed(4), velocity,
})

// ── Harmony: B minor — i · VI · iv · v ───────────────────────────────────────
//
// Bm – G – Em – F#m. The v is MINOR on purpose: a dominant F# would pull back to
// B with a leading tone and brighten the whole loop, which is the wrong colour
// for this. Staying minor keeps it modal and unresolved, which is what lets the
// same four bars repeat for two minutes without asking to end.
const ROOTS = [35, 31, 28, 30]                    // B1, G1, E1, F#1 — true sub range
// Sevenths, not triads: Bm7 / Gmaj7 / Em7 / F#m7. A bare triad under no melody
// sounds like a placeholder; the 7th gives the pad somewhere to sit.
const CH = [
  [59, 62, 66, 69],   // Bm7   B  D  F# A
  [55, 59, 62, 66],   // Gmaj7 G  B  D  F#
  [52, 55, 59, 62],   // Em7   E  G  B  D
  [54, 57, 61, 64],   // F#m7  F# A  C# E
]
// The pad doubles an octave below its root so it has body under the stabs.
const PAD = CH.map(c => [c[0] - 12, ...c])

const kit = DRUM_KITS.find(k => k.id === 'trap808') || DRUM_KITS[0]
const NONE = { type: 'none', params: {} }
// A pure sine with a flat sustain — a subwoofer drone, not a bass patch. An
// oscillator (rather than a sample) holds B1 ≈ 61 Hz dead flat for a whole bar.
const SUB_SINE = { type: 'poly', params: {
  preset: 'Sub Sine', waveform: 'sine', attack: 0.004, decay: 0.0, sustain: 1.0,
  release: 0.08, detune: 0, filterType: 'lowpass', filterCutoff: 130,
  filterResonance: 0.7, lfoEnabled: false, lfoRate: 4, lfoDepth: 0,
  lfoTarget: 'filter', lfoWaveform: 'sine',
} }

const T = {
  drums: { name: 'Drums', instrument: kit.instrument, volume: 0.70, pan: 0, preset: null, fx: [
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -16, ratio: 3, attack: 0.005, release: 0.12, knee: 6, makeupGain: 1 } },
  ] },
  bass: { name: 'Sub', instrument: SUB_SINE, volume: 0.44, pan: 0, preset: null, fx: [
    // A little drive so the sub is audible on a laptop speaker without losing
    // the fundamental — harmonics carry where the 61 Hz cannot.
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.15, color: 0.26, output: -1 } },
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -18, ratio: 3, attack: 0.01, release: 0.16, knee: 6, makeupGain: 0 } },
  ] },
  pad: { name: 'Pad', instrument: NONE, volume: 0.25, pan: 0.13, preset: 'builtin-30', fx: [
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.42, decay: 3.6, preDelay: 0.03 } },
    { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 5000, q: 0.9 } },
  ] },
  stab: { name: 'Stab', instrument: NONE, volume: 0.33, pan: -0.15, preset: 'builtin-8', fx: [
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.30, color: 0.42, output: -2 } },
    { id: uid('e'), type: 'delay', params: { enabled: true, wet: 0.16, time: 0.375, feedback: 0.14, syncToTempo: true, syncBeats: 0.375 } },
  ] },
}
for (const k in T) T[k].id = uid('t')
const tracks = Object.entries(T).map(([, t]) => ({
  id: t.id, name: t.name, instrument: t.instrument, volume: t.volume, pan: t.pan, effects: t.fx,
}))
const STAB_FX = { drive: 0.26, distortion: 0.05, highpassHz: 190, filterHz: 2800, mid: 0.18, sustainLevel: 0.85 }

const clips = []
const clip = (role, startBar, bars, isDrum, presetId, rollFx) => ({
  id: uid('c'), trackId: T[role].id, presetId: presetId ?? null, rollFx: rollFx || null,
  startBeat: startBar * 4, durationBeats: bars * 4, notes: [], isDrumClip: !!isDrum,
})
const push = c => { if (c.notes.length) clips.push(c) }

// One held note per chord, never chopped — and near-touching (0.999) so
// consecutive roots leave no release gap in the drone.
function bassDrone(c, sec) {
  const vel = sec.bass === 'low' ? 72 : sec.bass === 'mid' ? 92 : 108
  let b = 0
  while (b < sec.bars) {
    const r = ROOTS[b % 4]
    let run = 1
    while (b + run < sec.bars && ROOTS[(b + run) % 4] === r) run++
    c.notes.push(note(r, b * 4, run * 4 * 0.999, hv(vel)))
    b += run
  }
}
function padBar(c, b, chord, vel) { for (const p of chord) c.notes.push(note(p, b * 4, 4 * 0.98, hv(vel))) }
function stabBar(c, b, chord, slots, vel) {
  for (const s of slots) for (const p of chord) c.notes.push(note(p, b * 4 + s * STEP, 1.35 * STEP, hv(vel, s)))
}

// ── Drums ────────────────────────────────────────────────────────────────────
// Three feels, not two, so the second half can lift without simply repeating the
// first hook: `drive` adds the 16th-note hats and an extra kick that `hook` does
// not have, and it is used only after the bridge.
const FEEL = {
  verse: { kick: [0, 8], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], crash: [] },
  hook:  { kick: [0, 6, 8, 14], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 11, 12, 14, 15], oh: [4, 12], crash: [0] },
  drive: { kick: [0, 3, 6, 8, 11, 14], clap: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], oh: [4, 12], crash: [0] },
}
const LANE = { kick: [36, 0.5, 104], clap: [39, 0.4, 94], hat: [42, 0.14, 72], oh: [46, 0.3, 78], crash: [49, 1.4, 92] }
function drumBar(c, b, feel, first, fill) {
  for (const lane in feel) {
    const [pitch, dur, vel] = LANE[lane]
    for (const s of feel[lane]) {
      if (lane === 'crash' && !first) continue
      c.notes.push(note(pitch, b * 4 + s * STEP, dur, hv(vel, s)))
    }
  }
  // A rolling clap fill into the next section — the only place the drums lead.
  if (fill) for (let s = 8; s < 16; s++) c.notes.push(note(39, b * 4 + s * STEP, 0.18, Math.min(116, 58 + s * 4)))
}

// ── Form ─────────────────────────────────────────────────────────────────────
//
// 70 bars at 150 = 1:52. The shape is deliberately not symmetrical:
//
//   The bridge REMOVES rather than adds — pad and sub only, no drums, no stabs —
//   so the last hook lands by contrast instead of by being louder. That is the
//   one thing a constant-density arrangement can never do.
//
//   The outro takes the drums away first and lets the pad and sub ring out, so
//   the song ends on the harmony rather than stopping.
const FORM = [
  { name: 'intro',  bars: 8,                                        pad: 0.42 },
  { name: 'verse',  bars: 8, drums: 'verse', bass: 'mid',  pad: 0.40, stab: [0, 6, 10] },
  { name: 'pre',    bars: 4, drums: 'verse', bass: 'mid',  pad: 0.46, stab: [0, 6, 10], fillLast: true },
  { name: 'hook',   bars: 8, drums: 'hook',  bass: 'full', pad: 0.56, stab: [0, 6, 10, 13] },
  { name: 'break',  bars: 2,                 bass: 'low',  pad: 0.50 },
  { name: 'verse',  bars: 8, drums: 'verse', bass: 'mid',  pad: 0.40, stab: [0, 6, 10] },
  { name: 'pre',    bars: 4, drums: 'verse', bass: 'mid',  pad: 0.46, stab: [0, 6, 10], fillLast: true },
  { name: 'hook',   bars: 8, drums: 'hook',  bass: 'full', pad: 0.56, stab: [0, 6, 10, 13] },
  { name: 'bridge', bars: 4,                 bass: 'low',  pad: 0.52 },
  { name: 'hook',   bars: 8, drums: 'drive', bass: 'full', pad: 0.60, stab: [0, 3, 6, 10, 13] },
  { name: 'outro',  bars: 8,                 bass: 'low',  pad: 0.44 },
]

let bar = 0
const hookStarts = []
for (const sec of FORM) {
  if (sec.name === 'hook') hookStarts.push(bar * 4)
  const dc = clip('drums', bar, sec.bars, true)
  const bc = clip('bass', bar, sec.bars, false, null, null)
  const pc = clip('pad', bar, sec.bars, false, T.pad.preset)
  const sc = clip('stab', bar, sec.bars, false, T.stab.preset, { ...STAB_FX })
  for (let b = 0; b < sec.bars; b++) {
    const ci = b % 4
    if (sec.drums) drumBar(dc, b, FEEL[sec.drums], b === 0, sec.fillLast && b === sec.bars - 1)
    if (sec.pad) padBar(pc, b, PAD[ci], sec.pad * 90)
    if (sec.stab) stabBar(sc, b, CH[ci], sec.stab, 64)
  }
  if (sec.bass) bassDrone(bc, sec)
  ;[dc, bc, pc, sc].forEach(push)
  bar += sec.bars
}
const totalBeats = bar * 4

// ── Filter motion ────────────────────────────────────────────────────────────
// Brightness tracks energy: the pad opens across the intro, DIPS in the bar
// before each hook and snaps open on its downbeat. The dip is what makes the
// hook arrive — an opening filter with no dip in front of it just gets louder.
const raw = [{ beat: 0, value: 0.18 }, { beat: 24, value: 0.85 }]
for (const S of hookStarts) raw.push({ beat: S - 8, value: 0.78 }, { beat: S - 0.5, value: 0.22 }, { beat: S, value: 1 })
raw.push({ beat: totalBeats - 24, value: 0.7 }, { beat: totalBeats, value: 0.3 })
raw.sort((a, b) => a.beat - b.beat)

const padFilter = T.pad.fx.find(e => e.type === 'filter')
const automationLanes = [{
  id: uid('a'), trackId: T.pad.id, parameter: `fx:${padFilter.id}:frequency`,
  label: 'Pad filter', min: 300, max: 12000, defaultValue: 0.5, expanded: false,
  points: raw.filter(p => p.beat >= 0).map(p => ({ id: uid('p'), beat: +p.beat.toFixed(3), value: p.value })),
}]

const spec = {
  name: 'Drift',
  genre: 'synthwave', tempo: 150, timeSignatureNum: 4, timeSignatureDen: 4, swing: 0,
  key: 11, scale: 'minor', masterVolume: 0.5,
  tracks, clips, automationLanes, clipEffects: [],
  _form: FORM.map(s => s.name).join(' · '), _tracks: Object.keys(T).join('+'),
}
const out = join(ROOT, 'public', '_songgen', 'drift.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(spec))
const nNotes = clips.reduce((a, c) => a + c.notes.length, 0)
console.log(`${spec.name}\n  ${spec.tempo} bpm · B minor · ${spec._form}`)
console.log(`  ${tracks.length} tracks (${spec._tracks}) · ${clips.length} clips · ${nNotes} notes · ${(totalBeats / spec.tempo * 60).toFixed(0)}s → ${out}`)
