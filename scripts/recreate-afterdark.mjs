#!/usr/bin/env node
// ── DELIBERATE recreation — "After Dark" (Mr. Kitty), instrumental ────────────
// An ORIGINAL darkwave instrumental in its idiom: G# minor · 140 BPM. NO vocal
// and NO reproduction of the song's signature arpeggio riff — I write my OWN
// arpeggio over the harmony. Structure/progression are my best attempt (see
// scripts/briefs/afterdark-brief.json) for Brae to verify against Spotify, not
// a generic template. Opens on the DRIVING elements (arp + bass), not a pad.
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
const CH = [[56, 59, 63], [52, 56, 59], [54, 58, 61], [51, 54, 58]]   // G#m, E, F#, D#m (mid)
const PAD = CH.map(c => [c[0] - 12, ...c])
const SCALE_PC = new Set([8, 10, 11, 1, 3, 4, 6])     // G# natural minor
const kit = DRUM_KITS.find(k => k.id === 'house') || DRUM_KITS[0]
const NONE = { type: 'none', params: {} }
const SUB_SINE = { type: 'poly', params: { preset: 'Sub Sine', waveform: 'sine', attack: 0.004, decay: 0.0, sustain: 1.0, release: 0.08, detune: 0, filterType: 'lowpass', filterCutoff: 130, filterResonance: 0.7, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } }

const T = {
  drums: { name: 'Drums', instrument: kit.instrument, volume: 0.85, pan: 0, fx: [
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -15, ratio: 3, attack: 0.004, release: 0.11, knee: 6, makeupGain: 1 } },
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.12, decay: 1.4, preDelay: 0.01 } },   // darkwave gated-ish space
  ] },
  bass: { name: 'Bass', instrument: SUB_SINE, volume: 0.3, pan: 0, preset: null, fx: [
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.2, color: 0.3, output: -1 } },
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -18, ratio: 3, attack: 0.008, release: 0.14, knee: 6, makeupGain: 0 } },
  ] },
  // The bright ARPEGGIO — darkwave's signature texture. My OWN up-down pattern
  // over the chord tones (not the song's riff), high + plucky with delay.
  arp: { name: 'Arp', instrument: NONE, volume: 0.58, pan: -0.1, preset: 'builtin-8', fx: [
    { id: uid('e'), type: 'delay', params: { enabled: true, wet: 0.28, time: 0.214, feedback: 0.32, syncToTempo: true, syncBeats: 0.375 } },
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.24, decay: 2, preDelay: 0.02 } },
  ] },
  pad: { name: 'Pad', instrument: NONE, volume: 0.4, pan: 0.14, preset: 'builtin-12', fx: [
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.42, decay: 3.4, preDelay: 0.03 } },
    { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 5200, q: 0.9 } },
  ] },
}
for (const k in T) T[k].id = uid('t')
const tracks = Object.entries(T).map(([k, t]) => ({ id: t.id, name: t.name, instrument: t.instrument, volume: t.volume, pan: t.pan, effects: t.fx }))
const ARP_FX = { drive: 0.12, highpassHz: 250, filterHz: 8000, sustainLevel: 0.2 }   // bright, plucky

const clips = []
const clip = (role, startBar, bars, isDrum, presetId, rollFx) => ({ id: uid('c'), trackId: T[role].id, presetId: presetId ?? null, rollFx: rollFx || null, startBeat: startBar * 4, durationBeats: bars * 4, notes: [], isDrumClip: !!isDrum })
const push = c => { if (c.notes.length) clips.push(c) }

// Bass — driving eighth pulse on the root; 'held' sub for the break.
function bassLine(c, sec, mode) {
  const vel = mode === 'driveHard' ? 106 : mode === 'drive' ? 92 : 74
  for (let b = 0; b < sec.bars; b++) {
    const r = ROOTS[b % 4]
    if (mode === 'held') { c.notes.push(note(r, b * 4, 4 * 0.995, hv(vel))); continue }
    for (let e = 0; e < 8; e++) c.notes.push(note(r, b * 4 + e * 0.5, 0.46, hv(vel + (e % 2 ? -6 : 0), e * 2)))
  }
}
// Arp — original up-down 16th arpeggio through the chord tones (2 octaves, high).
function arpBar(c, b, chord, vel) {
  const tones = [...chord, ...chord.map(p => p + 12)].map(p => p + 12)
  const L = tones.length, period = (L - 1) * 2
  for (let s = 0; s < 16; s++) { const ph = s % period; const idx = ph < L ? ph : period - ph; c.notes.push(note(tones[idx], b * 4 + s * STEP, STEP * 0.92, hv(vel, s))) }
}
function padBar(c, b, chord, vel) { for (const p of chord) c.notes.push(note(p, b * 4, 4 * 0.98, hv(vel))) }

// Drums — driving; 'main' = four-on-floor, 'full' = + open hats & crash.
const FEEL = {
  main: { kick: [0, 4, 8, 12], clap: [4, 12], hat: [2, 6, 10, 14], oh: [], crash: [] },
  full: { kick: [0, 4, 8, 12], clap: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [2, 6, 10, 14], crash: [0] },
}
const LANE = { kick: [36, 0.5, 106], clap: [39, 0.4, 96], hat: [42, 0.14, 70], oh: [46, 0.3, 74], crash: [49, 1.4, 92] }
function drumBar(c, b, feel, first) {
  for (const lane in feel) { const [pitch, dur, vel] = LANE[lane]; for (const s of feel[lane]) { if (lane === 'crash' && !first) continue; c.notes.push(note(pitch, b * 4 + s * STEP, dur, hv(vel, s))) } }
}

// ── STRUCTURE (VERIFY) — my attempt at how the song is built. Opens on the
// DRIVING elements (arp + bass), drums+pad enter, chorus goes full, a stripped
// break for contrast. Sections carry an energy character; layers authored here.
const SECTIONS = [
  { name: 'intro',  bars: 4, energy: 0.6, layers: { arp: 0.55, bass: 'drive' }, crashIn: false },
  { name: 'verse',  bars: 8, energy: 0.6, layers: { drums: 'main', bass: 'drive', arp: 0.5, pad: 0.34 } },
  { name: 'chorus', bars: 8, energy: 1.0, layers: { drums: 'full', bass: 'driveHard', arp: 0.6, pad: 0.5 }, crashIn: true },
  { name: 'break',  bars: 4, energy: 0.4, layers: { arp: 0.5, bass: 'held', pad: 0.5 } },
  { name: 'verse',  bars: 8, energy: 0.6, layers: { drums: 'main', bass: 'drive', arp: 0.5, pad: 0.34 } },
  { name: 'chorus', bars: 8, energy: 1.0, layers: { drums: 'full', bass: 'driveHard', arp: 0.6, pad: 0.5 }, crashIn: true },
  { name: 'outro',  bars: 4, energy: 0.5, layers: { arp: 0.45, bass: 'drive' } },
]

let bar = 0
const chorusStarts = []
for (const sec of SECTIONS) {
  const L = sec.layers
  if (sec.name === 'chorus') chorusStarts.push(bar * 4)
  const dc = clip('drums', bar, sec.bars, true)
  const bc = clip('bass', bar, sec.bars, false, null, null)
  const ac = clip('arp', bar, sec.bars, false, T.arp.preset, { ...ARP_FX })
  const pc = clip('pad', bar, sec.bars, false, T.pad.preset)
  for (let b = 0; b < sec.bars; b++) {
    const ci = b % 4
    if (L.drums) drumBar(dc, b, FEEL[L.drums], b === 0 && sec.crashIn)
    if (L.arp != null) arpBar(ac, b, CH[ci], L.arp * 125)
    if (L.pad != null) padBar(pc, b, PAD[ci], L.pad * 125)
  }
  if (L.bass) bassLine(bc, sec, L.bass)
  ;[dc, bc, ac, pc].forEach(push)
  bar += sec.bars
}
const totalBeats = bar * 4

// Pad filter opens into each chorus (the classic lift).
const raw = [{ beat: 0, value: 0.4 }]
for (const S of chorusStarts) raw.push({ beat: S - 8, value: 0.7 }, { beat: S - 0.5, value: 0.3 }, { beat: S, value: 1 })
raw.push({ beat: totalBeats, value: 0.6 })
raw.sort((a, b) => a.beat - b.beat)
const padFilter = T.pad.fx.find(e => e.type === 'filter')
const automationLanes = [{
  id: uid('a'), trackId: T.pad.id, parameter: `fx:${padFilter.id}:frequency`,
  label: 'Pad filter', min: 300, max: 11000, defaultValue: 0.5, expanded: false,
  points: raw.filter(p => p.beat >= 0).map(p => ({ id: uid('p'), beat: +p.beat.toFixed(3), value: p.value })),
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
console.log(`${spec.name}\n  ${spec.tempo} bpm · G# minor · ${spec._form}\n  ${tracks.length} tracks (${spec._tracks}) · ${nNotes} notes · ${(totalBeats / spec.tempo * 60).toFixed(0)}s → ${out}`)
