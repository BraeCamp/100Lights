#!/usr/bin/env node
// ── DELIBERATE recreation — "After Dark" (Mr. Kitty), instrumental ────────────
// Built from Brae's ear-corrections (scripts/briefs/afterdark-brief.json), no
// template, no invented certainty. Elements: a FILTERED PIANO (intro-important),
// a HIGH SUSTAINED DRONE tone, a sub BASS, and DRUMS on a CONSTANT pattern
// (kick-hat-hat-hat-clap-hat-hat-hat) that repeats the whole song. NO arp (that
// was my invention). ~4 min. G# minor · 140 BPM. Instrumental only — no vocal /
// no melodic-hook reproduction; piano/drone content is my own over the harmony.
//   node scripts/recreate-afterdark.mjs  → public/_songgen/afterdark.json

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STEP = 0.25
const tmp = join(mkdtempSync(join(tmpdir(), 'ad-')), 'music.mjs')
execFileSync('npx', ['esbuild', 'scripts/_music_barrel.ts', '--bundle', '--format=esm', '--platform=node', '--outfile=' + tmp], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
const { DRUM_KITS } = await import(pathToFileURL(tmp).href)

let _n = 0
const uid = p => `${p}${(_n++).toString(36)}`
let _s = 424242
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 0xffffffff }
const hv = (base, slot = 0) => { let v = base + (rnd() * 8 - 4); if (slot % 16 === 0) v += 6; else if (slot % 8 === 0) v += 3; else if (slot % 2 === 1) v -= 6; return Math.max(28, Math.min(122, Math.round(v))) }
const note = (pitch, startBeat, dur, velocity) => ({ pitch, startBeat: +startBeat.toFixed(4), durationBeats: +Math.max(0.05, dur).toFixed(4), velocity })

// ── Harmony: G# minor. Progression G#m-E-F#-D#m (i-VI-VII-v) — VERIFY. ────────
const ROOTS = [32, 28, 30, 27]                        // G#1, E1, F#1, D#1 (true sub)
const CH = [[56, 59, 63], [52, 56, 59], [54, 58, 61], [51, 54, 58]]   // G#m, E, F#, D#m (mid, for piano)
const DRONE_PITCH = 80                                // G#5 — high sustained tonic drone (VERIFY note)
const SCALE_PC = new Set([8, 10, 11, 1, 3, 4, 6])
const kit = DRUM_KITS.find(k => k.id === 'house') || DRUM_KITS[0]
const SUB_SINE = { type: 'poly', params: { preset: 'Sub Sine', waveform: 'sine', attack: 0.004, decay: 0.0, sustain: 1.0, release: 0.08, detune: 0, filterType: 'lowpass', filterCutoff: 130, filterResonance: 0.7, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } }
const DRONE_SYN = { type: 'poly', params: { preset: 'Drone Tone', waveform: 'sawtooth', attack: 0.4, decay: 0.0, sustain: 1.0, release: 1.0, detune: 7, filterType: 'lowpass', filterCutoff: 2400, filterResonance: 1.2, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } }
const NONE = { type: 'none', params: {} }

const T = {
  drums: { name: 'Drums', instrument: kit.instrument, volume: 0.82, pan: 0, fx: [
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -15, ratio: 3, attack: 0.004, release: 0.11, knee: 6, makeupGain: 1 } },
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.14, decay: 1.6, preDelay: 0.01 } },
  ] },
  bass: { name: 'Bass', instrument: SUB_SINE, volume: 0.32, pan: 0, preset: null, fx: [
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.2, color: 0.3, output: -1 } },
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -18, ratio: 3, attack: 0.008, release: 0.14, knee: 6, makeupGain: 0 } },
  ] },
  // FILTERED PIANO — the harmonic element, important in the intro. Lowpass opens
  // over the intro then sits brighter in the body.
  piano: { name: 'Piano', instrument: NONE, volume: 0.5, pan: 0.05, preset: 'builtin-0', fx: [
    { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 6000, q: 0.9 } },
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.28, decay: 2.4, preDelay: 0.02 } },
  ] },
  // HIGH SUSTAINED DRONE — a held high tone across the song (texture/tension).
  drone: { name: 'Drone', instrument: DRONE_SYN, volume: 0.16, pan: -0.15, preset: null, fx: [
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.5, decay: 4, preDelay: 0.03 } },
    { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 3600, q: 0.9 } },
  ] },
}
for (const k in T) T[k].id = uid('t')
const tracks = Object.entries(T).map(([k, t]) => ({ id: t.id, name: t.name, instrument: t.instrument, volume: t.volume, pan: t.pan, effects: t.fx }))

const clips = []
const clip = (role, startBar, bars, isDrum, presetId, rollFx) => ({ id: uid('c'), trackId: T[role].id, presetId: presetId ?? null, rollFx: rollFx || null, startBeat: startBar * 4, durationBeats: bars * 4, notes: [], isDrumClip: !!isDrum })
const push = c => { if (c.notes.length) clips.push(c) }

// Bass — driving eighth sub pulse; 'held' for the intro.
function bassLine(c, sec, mode) {
  const vel = mode === 'driveHard' ? 104 : mode === 'drive' ? 92 : 74
  for (let b = 0; b < sec.bars; b++) {
    const r = ROOTS[b % 4]
    if (mode === 'held') { c.notes.push(note(r, b * 4, 4 * 0.995, hv(vel))); continue }
    for (let e = 0; e < 8; e++) c.notes.push(note(r, b * 4 + e * 0.5, 0.46, hv(vel + (e % 2 ? -6 : 0), e * 2)))
  }
}
// Piano — block chords, a gentle half-note pulse (whole-song harmonic bed).
function pianoBar(c, b, chord, vel) { for (const s of [0, 8]) for (const p of chord) c.notes.push(note(p, b * 4 + s * STEP, 7.6 * STEP, hv(vel, s))) }
// Drone — one long held high tone across the section.
function droneSection(c, bars, vel) { c.notes.push(note(DRONE_PITCH, 0, bars * 4 * 0.999, vel)); if (rnd() < 2) c.notes.push(note(DRONE_PITCH - 5, 0, bars * 4 * 0.999, Math.max(24, vel - 14))) }

// Drums — Brae's CONSTANT pattern: kick[0] clap[8] hat[2,4,6,10,12,14]. Same all song.
const BEAT = { kick: [0], clap: [8], hat: [2, 4, 6, 10, 12, 14], crash: [] }
const LANE = { kick: [36, 0.5, 108], clap: [39, 0.4, 98], hat: [42, 0.14, 74], crash: [49, 1.4, 92] }
function drumBar(c, b, first) {
  const feel = { ...BEAT, crash: first ? [0] : [] }
  for (const lane in feel) { const [pitch, dur, vel] = LANE[lane]; for (const s of feel[lane]) c.notes.push(note(pitch, b * 4 + s * STEP, dur, hv(vel, s))) }
}

// ── STRUCTURE (VERIFY) — filtered-piano + drone intro, then the constant beat +
// bass + piano + drone run to ~4 min. Dynamics from the piano filter and bass
// intensity, NOT from dropping the drums (they repeat the whole song). ~144 bars.
const SECTIONS = [
  { name: 'intro',  bars: 8,  layers: { piano: 40, drone: 40 } },                               // filtered piano + drone only
  { name: 'A1',     bars: 16, layers: { drums: true, bass: 'drive', piano: 52, drone: 44 } },
  { name: 'B1',     bars: 16, layers: { drums: true, bass: 'driveHard', piano: 62, drone: 50 }, crashIn: true },
  { name: 'A2',     bars: 16, layers: { drums: true, bass: 'drive', piano: 52, drone: 44 } },
  { name: 'B2',     bars: 16, layers: { drums: true, bass: 'driveHard', piano: 62, drone: 50 }, crashIn: true },
  { name: 'A3',     bars: 16, layers: { drums: true, bass: 'drive', piano: 52, drone: 44 } },
  { name: 'B3',     bars: 16, layers: { drums: true, bass: 'driveHard', piano: 62, drone: 50 }, crashIn: true },
  { name: 'A4',     bars: 16, layers: { drums: true, bass: 'drive', piano: 52, drone: 44 } },
  { name: 'B4',     bars: 16, layers: { drums: true, bass: 'driveHard', piano: 62, drone: 50 }, crashIn: true },
  { name: 'outro',  bars: 8,  layers: { piano: 44, drone: 40 } },                               // back to filtered piano + drone
]

let bar = 0
for (const sec of SECTIONS) {
  const L = sec.layers
  const dc = clip('drums', bar, sec.bars, true)
  const bc = clip('bass', bar, sec.bars, false, null, null)
  const pc = clip('piano', bar, sec.bars, false, T.piano.preset)
  const rc = clip('drone', bar, sec.bars, false, null, null)
  for (let b = 0; b < sec.bars; b++) {
    const ci = b % 4
    if (L.drums) drumBar(dc, b, sec.crashIn && b === 0)
    if (L.piano != null) pianoBar(pc, b, CH[ci], L.piano)
  }
  if (L.drone != null) droneSection(rc, sec.bars, L.drone)
  if (L.bass) bassLine(bc, sec, L.bass)
  ;[dc, bc, pc, rc].forEach(push)
  bar += sec.bars
}
const totalBeats = bar * 4

// Piano filter: closed in the intro, opens as the body comes in.
const padFilter = T.piano.fx.find(e => e.type === 'filter')
const automationLanes = [{
  id: uid('a'), trackId: T.piano.id, parameter: `fx:${padFilter.id}:frequency`,
  label: 'Piano filter', min: 350, max: 8000, defaultValue: 0.6, expanded: false,
  points: [{ beat: 0, value: 0.12 }, { beat: 24, value: 0.35 }, { beat: 32, value: 0.7 }, { beat: totalBeats - 32, value: 0.7 }, { beat: totalBeats - 8, value: 0.2 }, { beat: totalBeats, value: 0.15 }]
    .map(p => ({ id: uid('p'), beat: +Math.max(0, p.beat).toFixed(3), value: p.value })),
}]

const spec = {
  name: 'Mr. Kitty — After Dark (instrumental recreation)',
  genre: 'synthwave', tempo: 140, timeSignatureNum: 4, timeSignatureDen: 4, swing: 0,
  key: 8, scale: 'minor', masterVolume: 0.5,
  tracks, clips, automationLanes, clipEffects: [],
  _form: SECTIONS.map(s => s.name).join(' · '), _tracks: Object.keys(T).join('+'),
}
const out = join(ROOT, 'public', '_songgen', 'afterdark.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(spec))
const nNotes = clips.reduce((a, c) => a + c.notes.length, 0)
console.log(`${spec.name}\n  ${spec.tempo} bpm · G# minor · ${bar} bars · ${(totalBeats / spec.tempo * 60).toFixed(0)}s\n  ${tracks.length} tracks (${spec._tracks}) · ${nNotes} notes → ${out}`)
