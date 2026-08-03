#!/usr/bin/env node
// ── Starter TEMPLATE skeleton ────────────────────────────────────────────────
// An ORIGINAL, open starting point for users — not a finished song. A minor,
// 90 BPM, loop Am–F–C–G (i–VI–III–VII). Three instruments, no lead:
//   1. Sustained sub-bass (the Sub Sine synth) — one long low note per chord.
//   2. Grand piano — a gentle rising broken chord that blooms into the full
//      voicing (sustain-pedal feel).
//   3. Warm pad — a soft harmonic bed under it all.
// 16 bars (four passes of the loop) so it loops cleanly and leaves room to add
// drums / a lead / whatever the user wants.
//   node scripts/template-skeleton.mjs  → public/_songgen/template-skeleton.json

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let _n = 0
const uid = p => `${p}${(_n++).toString(36)}`
let _s = 90210
const rnd = () => { _s = (_s * 1664525 + 1013904223) >>> 0; return _s / 0xffffffff }
const hv = (base, slot = 0) => { let v = base + (rnd() * 6 - 3); if (slot % 16 === 0) v += 4; return Math.max(24, Math.min(118, Math.round(v))) }
const note = (pitch, startBeat, dur, velocity) => ({ pitch, startBeat: +startBeat.toFixed(4), durationBeats: +Math.max(0.05, dur).toFixed(4), velocity })

// ── Harmony: A minor, Am–F–C–G (i–VI–III–VII), all diatonic ──────────────────
const ROOTS = [33, 29, 36, 31]                        // A1, F1, C2, G1 — low sustained bass
const CH = [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]]   // Am, F, C, G (piano/pad, mid)

const SUB_SINE = { type: 'poly', params: { preset: 'Sub Sine', waveform: 'sine', attack: 0.004, decay: 0.0, sustain: 1.0, release: 0.12, detune: 0, filterType: 'lowpass', filterCutoff: 150, filterResonance: 0.7, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } }
const NONE = { type: 'none', params: {} }

const T = {
  bass:  { name: 'Sub Bass',    instrument: SUB_SINE, volume: 0.4, pan: 0, preset: null, fx: [
    { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.12, color: 0.25, output: -1 } },
    { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -18, ratio: 3, attack: 0.01, release: 0.16, knee: 6, makeupGain: 0 } },
  ] },
  piano: { name: 'Grand Piano', instrument: NONE, volume: 0.85, pan: 0.04, preset: 'builtin-26', fx: [
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.24, decay: 2.4, preDelay: 0.02 } },
  ] },
  pad:   { name: 'Warm Pad',    instrument: NONE, volume: 0.44, pan: -0.06, preset: 'builtin-30', fx: [
    { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.44, decay: 3.6, preDelay: 0.03 } },
    { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 4200, q: 0.9 } },
  ] },
}
for (const k in T) T[k].id = uid('t')
const tracks = Object.entries(T).map(([k, t]) => ({ id: t.id, name: t.name, instrument: t.instrument, volume: t.volume, pan: t.pan, effects: t.fx }))

const clips = []
const clip = (role, presetId) => ({ id: uid('c'), trackId: T[role].id, presetId: presetId ?? null, rollFx: null, startBeat: 0, durationBeats: BARS * 4, notes: [], isDrumClip: false })

const BARS = 16
const bc = clip('bass', null)
const pc = clip('piano', T.piano.preset)
const dc = clip('pad', T.pad.preset)
for (let b = 0; b < BARS; b++) {
  const ci = b % 4, chord = CH[ci]
  // Sub bass: one long note held through the whole bar.
  bc.notes.push(note(ROOTS[ci], b * 4, 4 * 0.99, hv(78)))
  // Grand piano: a rising broken chord that blooms — each note rings to the bar
  // end (sustain-pedal feel), plus the low root in the left hand.
  pc.notes.push(note(chord[0] - 12, b * 4, 4 * 0.98, hv(80)))
  const arp = [chord[0], chord[1], chord[2], chord[0] + 12]
  arp.forEach((p, i) => pc.notes.push(note(p, b * 4 + i, (4 - i) * 0.95, hv(88, i * 4))))
  // Warm pad: the chord + low root, held soft under everything.
  for (const p of [chord[0] - 12, ...chord]) dc.notes.push(note(p, b * 4, 4 * 0.99, hv(54)))
}
;[bc, pc, dc].forEach(c => clips.push(c))

const spec = {
  name: 'Starter Skeleton — A minor',
  genre: 'ambient', tempo: 90, timeSignatureNum: 4, timeSignatureDen: 4, swing: 0,
  key: 9, scale: 'minor', masterVolume: 0.5,
  tracks, clips, automationLanes: [], clipEffects: [],
  _form: `${BARS}-bar loop (Am-F-C-G)`, _tracks: Object.keys(T).join('+'),
}
const out = join(ROOT, 'public', '_songgen', 'template-skeleton.json')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(spec))
const nNotes = clips.reduce((a, c) => a + c.notes.length, 0)
console.log(`${spec.name}\n  ${spec.tempo} bpm · A minor · ${spec._form}\n  ${tracks.length} tracks (${spec._tracks}) · ${nNotes} notes · ${(BARS * 4 / spec.tempo * 60).toFixed(0)}s → ${out}`)
