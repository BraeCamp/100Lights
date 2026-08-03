#!/usr/bin/env node
// ── DELIBERATE recreation (not the random composer) ───────────────────────────
// An ORIGINAL instrumental bed in the idiom of Artemas' "how could u love
// somebody like me?" — built by hand from the song's factual, uncopyrightable
// parameters (F# minor · 146 BPM · loop F#m–A–D = i–III–VI) plus the artist's
// known production signatures (driving syncopated bass backbone, dark minimal
// pad, sparse off-beat stabs, emphasis over a CONSISTENT groove with a few
// breaks). NO vocal melody / no lyrics. Every note placed on purpose so we can
// render + analyze and see whether deliberate targeting hits the sound — the
// point being to close the "listening" loop the random pipeline can't.
//
//   node scripts/recreate-artemas.mjs   → public/_songgen/artemas-how-could-u.json

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
// deterministic jitter so velocities aren't robotic but the file is reproducible
let _s = 20240412
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 0xffffffff }
const hv = (base, slot) => { let v = base + (rnd() * 8 - 4); if (slot % 16 === 0) v += 6; else if (slot % 8 === 0) v += 3; else if (slot % 2 === 1) v -= 6; return Math.max(28, Math.min(122, Math.round(v))) }
const note = (pitch, startBeat, dur, velocity) => ({ pitch, startBeat: +startBeat.toFixed(4), durationBeats: +Math.max(0.05, dur).toFixed(4), velocity })

// ── Harmony: F# minor, loop F#m–A–D–D (i–III–VI–VI) ──────────────────────────
const ROOTS = [42, 45, 38, 38]                       // F#2, A2, D2, D2 — bass roots
const CH = [[54, 57, 61], [57, 61, 64], [50, 54, 57], [50, 54, 57]]  // F#m, A, D, D triads (F#3-region)
const PAD = CH.map((c, i) => [ROOTS[i], ...c])       // pad adds the low root for weight

const kit = DRUM_KITS.find(k => k.id === 'trap808') || DRUM_KITS[0]
const NONE = { type: 'none', params: {} }

// Tracks — deliberate, dark palette. Bass is the identity (loud, saturated).
const T = {
  drums: { id: uid('t'), name: 'Drums', instrument: kit.instrument, volume: 0.74, pan: 0, effects: [
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -16, ratio: 3, attack: 0.005, release: 0.12, knee: 6, makeupGain: 1 } },
  ] },
  bass: { id: uid('t'), name: 'Bass', instrument: NONE, volume: 0.48, pan: 0, effects: [
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.34, color: 0.35, output: -1 } },
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -18, ratio: 3.5, attack: 0.008, release: 0.14, knee: 6, makeupGain: 1 } },
  ] },
  pad: { id: uid('t'), name: 'Pad', instrument: NONE, volume: 0.3, pan: 0.1, effects: [
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.36, decay: 3, preDelay: 0.03 } },
    { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 15000, q: 0.9 } },
  ] },
  // Stab = the presence/air element: a brighter voice, less wash so it doesn't
  // smear into the next section (that smear was flattening the arc).
  stab: { id: uid('t'), name: 'Stab', instrument: NONE, volume: 0.5, pan: -0.12, effects: [
    { id: uid('e'), type: 'delay', params: { enabled: true, wet: 0.18, time: 0.375, feedback: 0.16, syncToTempo: true, syncBeats: 0.375 } },
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.2, decay: 1.8, preDelay: 0.02 } },
  ] },
}
const PRESET = { bass: 'builtin-46', pad: 'builtin-30', stab: 'builtin-3' }   // builtin-46 = Sub Drone (new)
const tracks = Object.values(T).map(t => ({ id: t.id, name: t.name, instrument: t.instrument, volume: t.volume, pan: t.pan, effects: t.effects }))

const clips = []
const clip = (role, startBar, bars, isDrum, presetId) => ({ id: uid('c'), trackId: T[role].id, presetId: presetId ?? null, rollFx: null, startBeat: startBar * 4, durationBeats: bars * 4, notes: [], isDrumClip: !!isDrum })
const push = c => { if (c.notes.length) clips.push(c) }

// ── The bass DRONE — ONE long, deep, sustained note per chord (Artemas), the
// Sub Drone preset does the "starts strong" attack. Consecutive equal roots are
// merged into a single held note so a chord that lasts 2 bars is ONE note, not
// two re-struck ones. Energy only moves the velocity — the drone never chops up.
function bassDrone(c, sec) {
  const vel = sec.bass === 'low' ? 62 : sec.bass === 'mid' ? 84 : 102
  let b = 0
  while (b < sec.bars) {
    const r = ROOTS[b % 4]
    let run = 1
    while (b + run < sec.bars && ROOTS[(b + run) % 4] === r) run++
    c.notes.push(note(r, b * 4, run * 4 * 0.99, hv(vel, 0)))
    b += run
  }
}
// ── Pad — held chord, breathes underneath ─────────────────────────────────────
function padBar(c, localBar, chord, vel) { const bt = localBar * 4; for (const p of chord) c.notes.push(note(p, bt, 4 * 0.98, hv(vel, 0))) }
// ── Stab — short dark off-beat chord hits (movement, not melody) ─────────────
function stabBar(c, localBar, chord, slots, vel) { const bt = localBar * 4; for (const s of slots) for (const p of chord) c.notes.push(note(p, bt + s * STEP, 1.4 * STEP, hv(vel, s))) }
// ── Drums — driving backbeat; feel varies by section ──────────────────────────
const FEEL = {
  verse: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [7], crash: [] },
  hook:  { kick: [0, 6, 8, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], oh: [4, 12], crash: [0] },
}
const LANE = { kick: [36, 0.5, 104], snare: [39, 0.4, 98], hat: [42, 0.14, 82], oh: [46, 0.3, 84], crash: [49, 1.4, 96] }
function drumBar(c, localBar, feel, first) {
  const bt = localBar * 4
  for (const lane in feel) { const [pitch, dur, vel] = LANE[lane]; for (const s of feel[lane]) { if (lane === 'crash' && !first) continue; c.notes.push(note(pitch, bt + s * STEP, dur, hv(vel, s))) } }
}

// ── ARRANGEMENT ── consistent groove + a few breaks; emphasis by drums/energy.
// [role, bars, energy]  energy drives bass density + which layers play.
const FORM = [
  { name: 'intro',  bars: 4, drums: false, bass: 'low',  pad: 0.4,  stab: null },
  { name: 'verse',  bars: 8, drums: 'verse', bass: 'mid',  pad: 0.36, stab: [6, 14] },
  { name: 'hook',   bars: 8, drums: 'hook',  bass: 'full', pad: 0.54, stab: [2, 6, 10, 14] },
  { name: 'break',  bars: 2, drums: false,   bass: 'low',  pad: 0.48, stab: null },   // the drop-out
  { name: 'verse',  bars: 8, drums: 'verse', bass: 'mid',  pad: 0.36, stab: [6, 14] },
  { name: 'hook',   bars: 8, drums: 'hook',  bass: 'full', pad: 0.54, stab: [2, 6, 10, 14] },
  { name: 'outro',  bars: 4, drums: false,   bass: 'low',  pad: 0.38, stab: null },
]

let bar = 0
for (const sec of FORM) {
  const dc = clip('drums', bar, sec.bars, true)
  const bc = clip('bass', bar, sec.bars, false, PRESET.bass)
  const pc = clip('pad', bar, sec.bars, false, PRESET.pad)
  const sc = clip('stab', bar, sec.bars, false, PRESET.stab)
  for (let b = 0; b < sec.bars; b++) {
    const ci = b % 4
    if (sec.drums) drumBar(dc, b, FEEL[sec.drums], b === 0)
    padBar(pc, b, PAD[ci], sec.pad * 90)
    if (sec.stab) stabBar(sc, b, CH[ci], sec.stab, 62)
  }
  bassDrone(bc, sec)
  push(dc); push(bc); push(pc); push(sc)
  bar += sec.bars
}
const totalBeats = bar * 4

// ── Filter automation: the pad opens across the intro, closes into the break,
// re-opens at the second hook — the "few breaks" doing the emphasis work.
const hookStarts = []
{ let b = 0; for (const s of FORM) { if (s.name === 'hook') hookStarts.push(b * 4); b += s.bars } }
const raw = [{ beat: 0, value: 0.15 }, { beat: 12, value: 1 }]           // intro open
for (const S of hookStarts) raw.push({ beat: S - 8, value: 0.85 }, { beat: S - 0.5, value: 0.2 }, { beat: S, value: 1 })
raw.push({ beat: totalBeats, value: 0.6 })
raw.sort((a, b) => a.beat - b.beat)
const automationLanes = [{
  id: uid('a'), trackId: T.pad.id, parameter: `fx:${T.pad.effects[1].id}:frequency`,
  label: 'Pad filter', min: 300, max: 16000, defaultValue: 0.5, expanded: false,
  points: raw.filter(p => p.beat >= 0).map(p => ({ id: uid('p'), beat: +p.beat.toFixed(3), value: p.value })),
}]

const spec = {
  name: 'Artemas — how could u love (instrumental recreation)',
  genre: 'synthwave', tempo: 146, timeSignatureNum: 4, timeSignatureDen: 4, swing: 0,
  key: 6, scale: 'minor', masterVolume: 0.5,
  tracks, clips, automationLanes, clipEffects: [],
  _form: FORM.map(s => s.name).join(' · '),
  _tracks: 'drums+bass+pad+stab',
}
const out = join(ROOT, 'public', '_songgen', 'artemas-how-could-u.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(spec))
const nNotes = clips.reduce((a, c) => a + c.notes.length, 0)
console.log(`${spec.name}\n  ${spec.tempo} bpm · F# minor · ${spec._form}\n  ${tracks.length} tracks · ${nNotes} notes · ${(totalBeats / spec.tempo * 60).toFixed(0)}s → ${out}`)
