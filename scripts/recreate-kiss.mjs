#!/usr/bin/env node
// ── DELIBERATE recreation — "i like the way you kiss me" (Artemas), instrumental
// An ORIGINAL dark-pop instrumental in its idiom: G# minor · 150 BPM · loop
// G#m–E–B–D#m (i–VI–III–v). NO vocal / no fabricated lead (the vocal is the
// topline). Driving four-on-the-floor energy, a SYNTH sub-bass (the new Sub Sine
// system), dark synth stabs, atmosphere pad. Hand-authored + deterministic;
// judged by scripts/listen-analyzer.mjs.
//   node scripts/recreate-kiss.mjs  → public/_songgen/artemas-kiss.json

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STEP = 0.25
const tmp = join(mkdtempSync(join(tmpdir(), 'kiss-')), 'music.mjs')
execFileSync('npx', ['esbuild', 'scripts/_music_barrel.ts', '--bundle', '--format=esm', '--platform=node', '--outfile=' + tmp], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
const { DRUM_KITS } = await import(pathToFileURL(tmp).href)

let _n = 0
const uid = p => `${p}${(_n++).toString(36)}`
let _s = 777123
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 0xffffffff }
const hv = (base, slot = 0) => { let v = base + (rnd() * 8 - 4); if (slot % 16 === 0) v += 6; else if (slot % 8 === 0) v += 3; else if (slot % 2 === 1) v -= 6; return Math.max(28, Math.min(122, Math.round(v))) }
const note = (pitch, startBeat, dur, velocity) => ({ pitch, startBeat: +startBeat.toFixed(4), durationBeats: +Math.max(0.05, dur).toFixed(4), velocity })

// ── Harmony: G# minor, loop G#m–E–B–D#m (i–VI–III–v). All diatonic. ───────────
const ROOTS = [32, 28, 35, 27]                        // G#1, E1, B1, D#1 — true sub range (39-62Hz)
const CH = [[56, 59, 63], [52, 56, 59], [59, 63, 66], [63, 66, 70]]   // G#m, E, B, D#m (mid register)
const PAD = CH.map(c => [c[0] - 12, ...c])
const SCALE_PC = new Set([8, 10, 11, 1, 3, 4, 6])     // G# natural minor
const kit = DRUM_KITS.find(k => k.id === 'house') || DRUM_KITS[0]
const NONE = { type: 'none', params: {} }
const SUB_SINE = { type: 'poly', params: { preset: 'Sub Sine', waveform: 'sine', attack: 0.004, decay: 0.0, sustain: 1.0, release: 0.08, detune: 0, filterType: 'lowpass', filterCutoff: 130, filterResonance: 0.7, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } }

const T = {
  drums: { name: 'Drums', instrument: kit.instrument, volume: 0.7, pan: 0, fx: [
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -15, ratio: 3, attack: 0.004, release: 0.11, knee: 6, makeupGain: 1 } },
  ] },
  bass: { name: 'Bass', instrument: SUB_SINE, volume: 0.42, pan: 0, preset: null, fx: [
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.16, color: 0.28, output: -1 } },
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -18, ratio: 3, attack: 0.008, release: 0.14, knee: 6, makeupGain: 0, sidechainTrackId: null } },
  ] },
  pad: { name: 'Pad', instrument: NONE, volume: 0.34, pan: 0.12, preset: 'builtin-12', fx: [
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.36, decay: 3, preDelay: 0.03 } },
    { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 6000, q: 0.9 } },
  ] },
  // Driving synth chord stabs — the harmonic engine (a bit brighter/gritty; this
  // song is more energetic than "how could u love").
  stab: { name: 'Stab', instrument: NONE, volume: 0.36, pan: -0.12, preset: 'builtin-3', fx: [
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.3, color: 0.45, output: -2 } },
    { id: uid('e'), type: 'delay', params: { enabled: true, wet: 0.16, time: 0.25, feedback: 0.18, syncToTempo: true, syncBeats: 0.25 } },
  ] },
}
for (const k in T) T[k].id = uid('t')
const tracks = Object.entries(T).map(([k, t]) => ({ id: t.id, name: t.name, instrument: t.instrument, volume: t.volume, pan: t.pan, effects: t.fx }))
const STAB_FX = { drive: 0.24, distortion: 0.04, highpassHz: 180, filterHz: 2800, mid: 0.16, sustainLevel: 0.4 }

const clips = []
const clip = (role, startBar, bars, isDrum, presetId, rollFx) => ({ id: uid('c'), trackId: T[role].id, presetId: presetId ?? null, rollFx: rollFx || null, startBeat: startBar * 4, durationBeats: bars * 4, notes: [], isDrumClip: !!isDrum })
const push = c => { if (c.notes.length) clips.push(c) }

// ── Bass — driving sub: root re-articulated on each beat (a pulsing sub under
// the four-floor kick), one note per beat, punchy. energy scales velocity.
function bassDrive(c, sec) {
  const vel = sec.bass === 'low' ? 70 : sec.bass === 'mid' ? 92 : 108
  for (let b = 0; b < sec.bars; b++) {
    const r = ROOTS[b % 4]
    if (sec.bass === 'low') { c.notes.push(note(r, b * 4, 4 * 0.99, hv(vel))); continue }   // held under breakdowns
    for (const beat of [0, 1, 2, 3]) c.notes.push(note(r, b * 4 + beat, 0.92, hv(vel, beat * 4)))   // quarter-note pulse
  }
}
function padBar(c, b, chord, vel) { for (const p of chord) c.notes.push(note(p, b * 4, 4 * 0.98, hv(vel))) }
function stabBar(c, b, chord, slots, vel) { for (const s of slots) for (const p of chord) c.notes.push(note(p, b * 4 + s * STEP, 1.6 * STEP, hv(vel, s))) }

// ── Drums — driving four-on-the-floor; verse lighter, hook full, fill in ──────
const FEEL = {
  verse: { kick: [0, 4, 8, 12], clap: [4, 12], hat: [2, 6, 10, 14], oh: [], crash: [] },
  hook:  { kick: [0, 4, 8, 12], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [2, 6, 10, 14], crash: [0] },
}
const LANE = { kick: [36, 0.5, 106], clap: [39, 0.4, 92], hat: [42, 0.14, 70], oh: [46, 0.3, 74], crash: [49, 1.4, 92] }
function drumBar(c, b, feel, first, fill) {
  for (const lane in feel) { const [pitch, dur, vel] = LANE[lane]; for (const s of feel[lane]) { if (lane === 'crash' && !first) continue; c.notes.push(note(pitch, b * 4 + s * STEP, dur, hv(vel, s))) } }
  if (fill) for (let s = 8; s < 16; s += 1) c.notes.push(note(39, b * 4 + s * STEP, 0.18, Math.min(116, 60 + s * 4)))
}

// ── ARRANGEMENT — driving dark-pop; no fake lead ─────────────────────────────
const FORM = [
  { name: 'intro',  bars: 4, pad: 0.5, stab: [0, 8] },
  { name: 'verse',  bars: 8, drums: 'verse', bass: 'mid', pad: 0.4, stab: [0, 6, 10] },
  { name: 'pre',    bars: 4, drums: 'verse', bass: 'mid', pad: 0.46, stab: [0, 4, 8, 12], fillLast: true },
  { name: 'hook',   bars: 8, drums: 'hook', bass: 'full', pad: 0.56, stab: [0, 3, 6, 8, 11, 14] },
  { name: 'break',  bars: 2, bass: 'low', pad: 0.56, stab: [0, 8] },
  { name: 'verse',  bars: 8, drums: 'verse', bass: 'mid', pad: 0.4, stab: [0, 6, 10] },
  { name: 'hook',   bars: 8, drums: 'hook', bass: 'full', pad: 0.56, stab: [0, 3, 6, 8, 11, 14] },
  { name: 'outro',  bars: 4, bass: 'low', pad: 0.44, stab: [0, 8] },
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
  if (sec.bass) bassDrive(bc, sec)
  ;[dc, bc, pc, sc].forEach(push)
  bar += sec.bars
}
const totalBeats = bar * 4

const raw = [{ beat: 0, value: 0.25 }, { beat: 12, value: 0.9 }]
for (const S of hookStarts) raw.push({ beat: S - 8, value: 0.8 }, { beat: S - 0.5, value: 0.3 }, { beat: S, value: 1 })
raw.push({ beat: totalBeats, value: 0.6 })
raw.sort((a, b) => a.beat - b.beat)
const padFilter = T.pad.fx.find(e => e.type === 'filter')
const automationLanes = [{
  id: uid('a'), trackId: T.pad.id, parameter: `fx:${padFilter.id}:frequency`,
  label: 'Pad filter', min: 300, max: 12000, defaultValue: 0.5, expanded: false,
  points: raw.filter(p => p.beat >= 0).map(p => ({ id: uid('p'), beat: +p.beat.toFixed(3), value: p.value })),
}]

const spec = {
  name: 'Artemas — i like the way you kiss me (instrumental recreation)',
  genre: 'synthwave', tempo: 150, timeSignatureNum: 4, timeSignatureDen: 4, swing: 0,
  key: 8, scale: 'minor', masterVolume: 0.5,
  tracks, clips, automationLanes, clipEffects: [],
  _form: FORM.map(s => s.name).join(' · '), _tracks: Object.keys(T).join('+'),
}
const out = join(ROOT, 'public', '_songgen', 'artemas-kiss.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(spec))
const nNotes = clips.reduce((a, c) => a + c.notes.length, 0)
console.log(`${spec.name}\n  ${spec.tempo} bpm · G# minor · ${spec._form}\n  ${tracks.length} tracks (${spec._tracks}) · ${nNotes} notes · ${(totalBeats / spec.tempo * 60).toFixed(0)}s → ${out}`)
