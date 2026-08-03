#!/usr/bin/env node
// ── DELIBERATE recreation v3 — minimal & faithful ────────────────────────────
// An ORIGINAL dark-pop instrumental in the idiom of Artemas' "how could u love
// somebody like me?" (F# minor · 146 · loop F#m–A–D = i–III–VI). NO vocal, and
// crucially NO fabricated lead melody — the real track's topline IS the vocal,
// so instrumentally it's a MINIMAL dark groove: a long sustained SUB-BASS drone,
// dark gritty chord stabs, an atmosphere pad, and a driving beat. The vocal's
// space is left as space. Hand-authored + deterministic; judged by
// scripts/listen-analyzer.mjs.
//   node scripts/recreate-artemas.mjs  → public/_songgen/artemas-how-could-u.json

import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const STEP = 0.25
const tmp = join(mkdtempSync(join(tmpdir(), 'artemas-')), 'music.mjs')
execFileSync('npx', ['esbuild', 'scripts/_music_barrel.ts', '--bundle', '--format=esm', '--platform=node', '--outfile=' + tmp], { cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
const { DRUM_KITS } = await import(pathToFileURL(tmp).href)

let _n = 0
const uid = p => `${p}${(_n++).toString(36)}`
let _s = 20240412
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 0xffffffff }
const hv = (base, slot = 0) => { let v = base + (rnd() * 8 - 4); if (slot % 16 === 0) v += 6; else if (slot % 8 === 0) v += 3; else if (slot % 2 === 1) v -= 6; return Math.max(28, Math.min(122, Math.round(v))) }
const note = (pitch, startBeat, dur, velocity) => ({ pitch, startBeat: +startBeat.toFixed(4), durationBeats: +Math.max(0.05, dur).toFixed(4), velocity })

// ── Harmony: F# minor, loop F#m–A–D–D. Bass roots in OCTAVE 1 = true sub range
// (F#1≈46Hz, A1≈55Hz, D1≈37Hz) so the drone reads as a subwoofer, not a synth bass.
const ROOTS = [30, 33, 26, 26]                        // F#1, A1, D1, D1
const CH = [[54, 57, 61], [57, 61, 64], [50, 54, 57], [50, 54, 57]]   // F#m, A, D, D triads (mid register)
const PAD = CH.map((c, i) => [c[0] - 12, ...c])
const kit = DRUM_KITS.find(k => k.id === 'trap808') || DRUM_KITS[0]
const NONE = { type: 'none', params: {} }

// ── Tracks — minimal dark lineup ─────────────────────────────────────────────
const T = {
  drums: { name: 'Drums', instrument: kit.instrument, volume: 0.72, pan: 0, fx: [
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -16, ratio: 3, attack: 0.005, release: 0.12, knee: 6, makeupGain: 1 } },
  ] },
  // SUB BASS — a long sustained subwoofer tone: Sub Drone voiced an octave down,
  // heavily lowpassed to a near-sine sub, gentle saturation for small-speaker
  // audibility. One held note per chord (a true drone).
  bass: { name: 'Bass', instrument: NONE, volume: 0.6, pan: 0, preset: 'builtin-46', fx: [
    { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 130, q: 0.7 } },
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.18, color: 0.2, output: -1 } },
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -20, ratio: 4, attack: 0.01, release: 0.16, knee: 6, makeupGain: 2 } },
  ] },
  pad: { name: 'Pad', instrument: NONE, volume: 0.26, pan: 0.12, preset: 'builtin-30', fx: [
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.4, decay: 3.4, preDelay: 0.03 } },
    { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 5000, q: 0.9 } },
  ] },
  // Dark gritty chord stabs — the harmonic movement; kept dark (no octave-up).
  stab: { name: 'Stab', instrument: NONE, volume: 0.34, pan: -0.14, preset: 'builtin-8', fx: [
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.28, color: 0.4, output: -2 } },
    { id: uid('e'), type: 'delay', params: { enabled: true, wet: 0.14, time: 0.375, feedback: 0.12, syncToTempo: true, syncBeats: 0.375 } },
  ] },
}
for (const k in T) T[k].id = uid('t')
const tracks = Object.entries(T).map(([k, t]) => ({ id: t.id, name: t.name, instrument: t.instrument, volume: t.volume, pan: t.pan, effects: t.fx }))
const BASS_FX = { sub: 0.6, bass: 0.3, filterHz: 150, sustainLevel: 1 }              // force deep, pure, sustained
const STAB_FX = { drive: 0.24, distortion: 0.04, highpassHz: 180, filterHz: 3000, mid: 0.16, sustainLevel: 0.85 }

const clips = []
const clip = (role, startBar, bars, isDrum, presetId, rollFx) => ({ id: uid('c'), trackId: T[role].id, presetId: presetId ?? null, rollFx: rollFx || null, startBeat: startBar * 4, durationBeats: bars * 4, notes: [], isDrumClip: !!isDrum })
const push = c => { if (c.notes.length) clips.push(c) }

// ── SUB DRONE — one long held note per chord (never chopped) ──────────────────
function bassDrone(c, sec) {
  const vel = sec.bass === 'low' ? 74 : sec.bass === 'mid' ? 92 : 108
  let b = 0
  while (b < sec.bars) {
    const r = ROOTS[b % 4]; let run = 1
    while (b + run < sec.bars && ROOTS[(b + run) % 4] === r) run++
    c.notes.push(note(r, b * 4, run * 4 * 0.995, hv(vel)))
    b += run
  }
}
function padBar(c, b, chord, vel) { for (const p of chord) c.notes.push(note(p, b * 4, 4 * 0.98, hv(vel))) }
function stabBar(c, b, chord, slots, vel) { for (const s of slots) for (const p of chord) c.notes.push(note(p, b * 4 + s * STEP, 1.4 * STEP, hv(vel, s))) }

// ── Drums — driving dark groove; verse sparse, hook full, fill into the hook ──
const FEEL = {
  verse: { kick: [0, 8], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], crash: [] },
  hook:  { kick: [0, 6, 8, 14], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 11, 12, 14, 15], oh: [4, 12], crash: [0] },
}
const LANE = { kick: [36, 0.5, 104], clap: [39, 0.4, 94], hat: [42, 0.14, 74], oh: [46, 0.3, 78], crash: [49, 1.4, 92] }
function drumBar(c, b, feel, first, fill) {
  for (const lane in feel) { const [pitch, dur, vel] = LANE[lane]; for (const s of feel[lane]) { if (lane === 'crash' && !first) continue; c.notes.push(note(pitch, b * 4 + s * STEP, dur, hv(vel, s))) } }
  if (fill) for (let s = 8; s < 16; s += 1) c.notes.push(note(39, b * 4 + s * STEP, 0.18, Math.min(116, 60 + s * 4)))
}

// ── ARRANGEMENT — section contrast from drums/energy + a break; no fake lead ──
const FORM = [
  { name: 'intro',  bars: 4, pad: 0.5 },
  { name: 'verse',  bars: 8, drums: 'verse', bass: 'mid', pad: 0.4, stab: [0, 6, 10] },
  { name: 'pre',    bars: 4, drums: 'verse', bass: 'mid', pad: 0.46, stab: [0, 6, 10], fillLast: true },
  { name: 'hook',   bars: 8, drums: 'hook', bass: 'full', pad: 0.56, stab: [0, 6, 10, 13] },
  { name: 'break',  bars: 2, bass: 'low', pad: 0.56 },
  { name: 'verse',  bars: 8, drums: 'verse', bass: 'mid', pad: 0.4, stab: [0, 6, 10] },
  { name: 'hook',   bars: 8, drums: 'hook', bass: 'full', pad: 0.56, stab: [0, 6, 10, 13] },
  { name: 'outro',  bars: 4, bass: 'low', pad: 0.44 },
]

let bar = 0
const hookStarts = []
for (const sec of FORM) {
  if (sec.name === 'hook') hookStarts.push(bar * 4)
  const dc = clip('drums', bar, sec.bars, true)
  const bc = clip('bass', bar, sec.bars, false, T.bass.preset, { ...BASS_FX })
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

// Pad filter opens across the intro, dips before each hook, opens on the downbeat.
const raw = [{ beat: 0, value: 0.22 }, { beat: 12, value: 0.9 }]
for (const S of hookStarts) raw.push({ beat: S - 8, value: 0.8 }, { beat: S - 0.5, value: 0.25 }, { beat: S, value: 1 })
raw.push({ beat: totalBeats, value: 0.6 })
raw.sort((a, b) => a.beat - b.beat)
const padFilter = T.pad.fx.find(e => e.type === 'filter')
const automationLanes = [{
  id: uid('a'), trackId: T.pad.id, parameter: `fx:${padFilter.id}:frequency`,
  label: 'Pad filter', min: 300, max: 12000, defaultValue: 0.5, expanded: false,
  points: raw.filter(p => p.beat >= 0).map(p => ({ id: uid('p'), beat: +p.beat.toFixed(3), value: p.value })),
}]

const spec = {
  name: 'Artemas — how could u love (instrumental recreation)',
  genre: 'synthwave', tempo: 146, timeSignatureNum: 4, timeSignatureDen: 4, swing: 0,
  key: 6, scale: 'minor', masterVolume: 0.5,
  tracks, clips, automationLanes, clipEffects: [],
  _form: FORM.map(s => s.name).join(' · '), _tracks: Object.keys(T).join('+'),
}
const out = join(ROOT, 'public', '_songgen', 'artemas-how-could-u.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(spec))
const nNotes = clips.reduce((a, c) => a + c.notes.length, 0)
console.log(`${spec.name}\n  ${spec.tempo} bpm · F# minor · ${spec._form}\n  ${tracks.length} tracks (${spec._tracks}) · ${nNotes} notes · ${(totalBeats / spec.tempo * 60).toFixed(0)}s → ${out}`)
