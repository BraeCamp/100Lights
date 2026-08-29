// ── "Drift" — an ORIGINAL dark-pop instrumental in the Artemas idiom ─────────
//
//   node scripts/song-drift.mjs            → ~/Desktop/100lights-songs/Drift.cfproj
//   node scripts/song-drift.mjs --render   → also bounce an mp3 through the studio
//
// Not the recreation. scripts/recreate-artemas.mjs deliberately reproduces "how
// could u love somebody like me?" (F# minor, 146, i–III–VI); this is a NEW song
// sharing its character and nothing else — B minor, 150, i–VI–iv–v, its own form
// and its own arc.
//
// What "the Artemas idiom" means here, concretely, because a template would
// produce something generic:
//
//   SPACE IS THE INSTRUMENT. In that music the topline is the vocal, so what
//   sits underneath is deliberately unfinished — a sub, a stab, a pad, a beat.
//   There is NO LEAD LINE, which is also this repo's standing rule: inventing a
//   melody to fill the vocal's gap is exactly what makes a recreation sound
//   wrong.
//
//   THE BASS IS A DRONE, not a bassline. One held note per chord, low, so it
//   never competes for attention with the harmony above it.
//
//   MOVEMENT IS HARMONIC AND FILTERED, not melodic. Chords change, the pad
//   opens and closes with the energy, the stabs thin out and thicken.
//
// The arc is the point, and it is the thing a loop-with-drums-added never gets:
// the BRIDGE REMOVES rather than adds — no drums, no stabs — so the last hook
// lands by contrast instead of by being louder, and the outro takes the drums
// away first so the song ends on the harmony rather than stopping.
//
// Dynamics live as EFFECT BARS in the FX lane (dipInto/lift), where they can be
// seen and edited, rather than hidden inside clip graphs.

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { execFileSync } from 'child_process'
import {
  uid, rng, feel, N, eq3, reverb, chorus, compressor,
  assemble, assertInRange, dipInto, lift,
} from './song-kit.mjs'

const argv = process.argv.slice(2)
const flagOf = (n, d) => (argv.find(a => a.startsWith(`--${n}=`)) || `=${d}`).split('=').slice(1).join('=')

const BPM = 150
const BPB = 4
const OUT_DIR = join(homedir(), 'Desktop', '100lights-songs')
mkdirSync(OUT_DIR, { recursive: true })

const rand = rng(20260829)
const F = feel(rand, BPM)

// ── Harmony: B minor — i · VI · iv · v ───────────────────────────────────────
//
// Bm – G – Em – F#m. The v stays MINOR on purpose: a dominant F# would pull back
// to B with a leading tone and brighten the whole loop, which is the wrong
// colour. Minor keeps it modal and unresolved, and that is what lets four bars
// repeat for two minutes without ever asking to end.
//
// Sevenths rather than bare triads. Under no melody a triad sounds like a
// placeholder; the 7th gives the pad somewhere to sit and the stabs some grit
// to bite on.
const ROOT = [35, 31, 28, 30]                 // B1, G1, E1, F#1
const CH = [
  [59, 62, 66, 69],   // Bm7    B  D  F# A
  [55, 59, 62, 66],   // Gmaj7  G  B  D  F#
  [52, 55, 59, 62],   // Em7    E  G  B  D
  [54, 57, 61, 64],   // F#m7   F# A  C# E
]
const PAD = CH.map(c => [c[0] - 12, ...c])    // an octave under the root for body

// ── Parts ────────────────────────────────────────────────────────────────────
// Every generator takes the number of bars and returns notes RELATIVE to the
// section, which is the shape assemble() expects.

/** One held note per chord, never chopped. Near-touching so the drone has no
 *  release gap where the root changes. */
function subPart(bars, vel) {
  const out = []
  let b = 0
  while (b < bars) {
    const r = ROOT[b % 4]
    let run = 1
    while (b + run < bars && ROOT[(b + run) % 4] === r) run++
    out.push(N(r, b * BPB, run * BPB * 0.999, F.vary(vel, 4)))
    b += run
  }
  return out
}

function padPart(bars, vel) {
  const out = []
  for (let b = 0; b < bars; b++) {
    for (const p of PAD[b % 4]) out.push(N(p, b * BPB + F.jitter(6), BPB * 0.98, F.vary(vel, 5)))
  }
  return out
}

/** Off-beat chord stabs — the only thing carrying rhythm in the mids. `slots`
 *  are 16th indices, so [0, 6, 10] is the dotted push that gives the idiom its
 *  lean. */
function stabPart(bars, slots, vel) {
  const out = []
  for (let b = 0; b < bars; b++) {
    for (const s of slots) {
      for (const p of CH[b % 4]) {
        out.push(N(p, b * BPB + s * 0.25 + F.jitter(8), 0.34, F.vary(vel - (s % 2 ? 6 : 0), 7)))
      }
    }
  }
  return out
}

// Drums. Three feels, not two, so the last hook can lift without simply
// repeating the first: `drive` adds straight 16th hats and two extra kicks that
// `hook` does not have, and it is used only after the bridge.
const LANE = { kick: 36, clap: 39, hat: 42, oh: 46, crash: 49 }
const FEEL = {
  verse: { kick: [0, 8], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7] },
  hook: { kick: [0, 6, 8, 14], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 11, 12, 14, 15], oh: [4, 12] },
  drive: { kick: [0, 3, 6, 8, 11, 14], clap: [4, 12], hat: [...Array(16).keys()], oh: [4, 12] },
}
const VEL = { kick: 104, clap: 94, hat: 70, oh: 78, crash: 92 }
const DUR = { kick: 0.5, clap: 0.4, hat: 0.14, oh: 0.3, crash: 1.4 }

function drumPart(bars, feelName, { crashFirst = false, fillLast = false, gain = 1 } = {}) {
  const out = []
  const f = FEEL[feelName]
  for (let b = 0; b < bars; b++) {
    if (crashFirst && b === 0) out.push(N(LANE.crash, 0, DUR.crash, Math.round(VEL.crash * gain)))
    for (const lane of Object.keys(f)) {
      for (const s of f[lane]) {
        // Swing the off-16ths late and vary the velocity, or the groove reads as
        // a drum machine rather than a part.
        const t = b * BPB + s * 0.25 + F.swing16(s, 0.05) + F.jitter(5)
        const accent = s % 16 === 0 ? 6 : s % 8 === 0 ? 3 : s % 2 ? -7 : 0
        out.push(N(LANE[lane], t, DUR[lane], F.vary(VEL[lane] * gain + accent, 6)))
      }
    }
    // A rolling clap fill into the next section — the one place the drums lead.
    if (fillLast && b === bars - 1) {
      for (let s = 8; s < 16; s++) {
        out.push(N(LANE.clap, b * BPB + s * 0.25, 0.18, Math.min(116, 58 + s * 4)))
      }
    }
  }
  return out
}

export function build() {
  // Effects: eq3 / chorus / compressor / reverb only. The kit's palette leaves
  // out delay and distortion because they derive a non-finite AudioParam at
  // headless bounce time and silently kill the render — the saturation and
  // delay this idiom wants go on in post instead.
  const tracks = [
    // Synth instruments, not library presets.
    //
    // A `presetId` plays a SAMPLE out of the user's sound library, and when that
    // library does not have the folder — a fresh browser, a signed-out visitor,
    // a machine that has not synced — the note is dropped and the track is
    // simply silent. Measured on the first cut of this song: Stab (builtin-8,
    // "Metallic Pluck") never made a sound, because a headless browser's library
    // is empty. A song written to TEST the studio must not depend on what is
    // installed, so both pitched parts are oscillators, which always sound.
    { key: 'sub', id: uid(), name: 'Sub', presetId: null, volume: 0.50, color: '#4c1d95',
      instrument: { type: 'poly', params: {
        waveform: 'sine', attack: 0.006, decay: 0.0, sustain: 1.0, release: 0.12,
        detune: 0, filterType: 'lowpass', filterCutoff: 140, filterResonance: 0.6,
        lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(5, -9, -14, 90, 500, 4000), compressor(-21, 4, 1)] },
    { key: 'pad', id: uid(), name: 'Pad', presetId: null, volume: 0.19, pan: 0.13, color: '#7c3aed',
      instrument: { type: 'poly', params: {
        waveform: 'sawtooth', attack: 1.1, decay: 1.0, sustain: 0.62, release: 2.8,
        detune: 14, filterType: 'lowpass', filterCutoff: 1500, filterResonance: 0.8,
        lfoEnabled: true, lfoRate: 0.11, lfoDepth: 0.22, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      effects: [eq3(-10, -4, 1, 320, 850, 7000), chorus(0.42, 0.28, 0.45), reverb(0.38, 3.2, 0.03)] },
    { key: 'stab', id: uid(), name: 'Stab', presetId: null, volume: 0.28, pan: -0.15, color: '#a78bfa',
      instrument: { type: 'poly', params: {
        waveform: 'square', attack: 0.003, decay: 0.14, sustain: 0.18, release: 0.14,
        detune: 9, filterType: 'lowpass', filterCutoff: 2100, filterResonance: 3.0,
        lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } },
      // decay 2.6, not 1.5. A track reverb at decay 1.5 silences the WHOLE
      // track — master output included, and even with wet at 0, so it is not
      // the wet mix. Measured with a fresh browser per trial: 1.5 silent in
      // every trial, while 0.8, 2.0, 2.5, 3.0 and 3.2 all sound. Not a
      // threshold, so not "short decay" — a bad combination somewhere in the
      // Helios reverb tank, which is where track effects run by default
      // (heliosFx). Logged rather than worked around blindly; the song simply
      // uses a value that is known good.
      effects: [eq3(-9, -1, -2, 300, 1100, 6000), reverb(0.22, 2.6, 0.02)] },
    { key: 'drums', id: uid(), name: 'Drums', presetId: null, isDrum: true, volume: 0.44, color: '#c084fc',
      instrument: { type: 'drum', params: { pack: 'techno' } },
      effects: [eq3(1.5, -3, -3, 120, 600, 7000), compressor(-23, 5, 2), reverb(0.05, 0.32, 0.01)] },
  ]

  // ── Form: 70 bars at 150 = 1:52 ───────────────────────────────────────────
  // Deliberately not symmetrical. Layers arrive and leave ONE at a time, and the
  // bridge is a subtraction.
  const sections = [
    { name: 'intro', bars: 8, parts: {
      pad: padPart(8, 74) } },
    { name: 'verse 1', bars: 8, parts: {
      pad: padPart(8, 66), sub: subPart(8, 92), drums: drumPart(8, 'verse', { gain: 0.84 }),
      stab: stabPart(8, [0, 6, 10], 62) } },
    { name: 'pre 1', bars: 4, parts: {
      pad: padPart(4, 72), sub: subPart(4, 96), drums: drumPart(4, 'verse', { gain: 0.88, fillLast: true }),
      stab: stabPart(4, [0, 6, 10], 68) } },
    { name: 'hook 1', bars: 8, parts: {
      pad: padPart(8, 82), sub: subPart(8, 108), drums: drumPart(8, 'hook', { crashFirst: true }),
      stab: stabPart(8, [0, 6, 10, 13], 78) } },
    // Everything but the low end drops out for two bars. The hook is still
    // ringing in the reverb tail, which is what makes this land as a breath
    // rather than as a hole.
    { name: 'break', bars: 2, parts: {
      pad: padPart(2, 70), sub: subPart(2, 76) } },
    { name: 'verse 2', bars: 8, parts: {
      pad: padPart(8, 66), sub: subPart(8, 92), drums: drumPart(8, 'verse', { gain: 0.84 }),
      stab: stabPart(8, [0, 6, 10], 62) } },
    { name: 'pre 2', bars: 4, parts: {
      pad: padPart(4, 72), sub: subPart(4, 96), drums: drumPart(4, 'verse', { gain: 0.88, fillLast: true }),
      stab: stabPart(4, [0, 6, 10], 68) } },
    { name: 'hook 2', bars: 8, parts: {
      pad: padPart(8, 82), sub: subPart(8, 108), drums: drumPart(8, 'hook', { crashFirst: true }),
      stab: stabPart(8, [0, 6, 10, 13], 78) } },
    // The bridge REMOVES. Four bars of pad and sub only — no drums, no stabs.
    // This is what buys the last hook its impact; adding a layer here instead
    // would leave nowhere to go.
    { name: 'bridge', bars: 4, parts: {
      pad: padPart(4, 74), sub: subPart(4, 78) } },
    { name: 'hook 3', bars: 8, parts: {
      pad: padPart(8, 86), sub: subPart(8, 112), drums: drumPart(8, 'drive', { gain: 1.06, crashFirst: true }),
      stab: stabPart(8, [0, 3, 6, 10, 13], 82) } },
    // Drums go first; the pad and sub ring out. The song ends on the harmony
    // rather than stopping.
    { name: 'outro', bars: 8, parts: {
      pad: padPart(8, 60), sub: subPart(8, 74) } },
  ]

  // ── Dynamics, as visible FX bars ──────────────────────────────────────────
  // A dip in the two beats BEFORE each hook, so the hook arrives instead of
  // merely getting louder — an opening filter with nothing pulled down in front
  // of it is not a transition. Plus a long lift across each hook.
  let beat = 0
  const at = {}
  for (const s of sections) { at[s.name] = beat; beat += s.bars * BPB }
  const songBeats = beat

  const fxBars = []
  for (const h of ['hook 1', 'hook 2', 'hook 3']) {
    for (const k of ['pad', 'stab']) fxBars.push(dipInto(k, at[h], 2))
    // Restored: the drive in this bar was a suspect while hunting the silent
    // Stab and was cleared by measurement — removing it changed nothing.
    fxBars.push(lift('stab', at[h], 8 * BPB, { drive: 0.05, gain: 1.06 }))
  }
  // The bridge closes the pad down and lets it reopen into the final hook.
  fxBars.push(dipInto('pad', at['hook 3'], 4))

  const out = assemble({
    name: 'Drift', bpm: BPM, bpb: BPB, key: 'B', scale: 'minor', swing: 0,
    tracks, sections, bars: fxBars.filter(Boolean), masterVolume: 0.30,
  })

  const notesOf = key => out.project.dawProject.arrangementClips
    .filter(c => c.trackId === tracks.find(t => t.key === key).id).flatMap(c => c.notes)
  // Oscillators have no sampled range to fall outside of, so these are musical
  // bounds rather than technical ones: the sub stays in the octave where it is
  // felt rather than heard, and the stabs stay off the very bottom where a
  // square wave turns to mud under the drone.
  assertInRange('Sub', notesOf('sub'), 24, 48)
  assertInRange('Stab', notesOf('stab'), 45, 84)

  return { out, tracks, songBeats }
}

const { out, tracks } = build()
const label = 'Drift'
const cfPath = join(OUT_DIR, `${label}.cfproj`)
writeFileSync(cfPath, JSON.stringify(out.project))

console.log(`▸ "${label}" · ${BPM} BPM · B minor · i–VI–iv–v · ${out.songBeats / BPB} bars · ${out.seconds.toFixed(1)}s (${Math.floor(out.seconds / 60)}:${String(Math.round(out.seconds % 60)).padStart(2, '0')})`)
for (const t of tracks) {
  const clips = out.project.dawProject.arrangementClips.filter(c => c.trackId === t.id)
  console.log(`  ${t.name.padEnd(6)} ${String(clips.length).padStart(2)} clips / ${clips.reduce((n, c) => n + c.notes.length, 0)} notes`)
}
console.log(`  ${out.project.dawProject.clipEffects.length} effect bars in the FX lane`)
console.log(`  → ${cfPath}`)

if (argv.includes('--render')) {
  const url = flagOf('url', 'http://localhost:4618')
  console.log('▸ rendering through the studio engine…')
  execFileSync('node', ['scripts/hear-ai.mjs', `--project=${cfPath}`, `--url=${url}`,
    `--out=${join(OUT_DIR, label + '.mp3')}`, '--keep'], { stdio: 'inherit' })
}
