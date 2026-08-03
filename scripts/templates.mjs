#!/usr/bin/env node
// ── Starter TEMPLATES ────────────────────────────────────────────────────────
// ORIGINAL, open starting points for users (not finished songs). Each is SIMPLE
// (3 instruments, no lead) but BREATHES: sections where instruments drop out and
// re-enter (layer in/out + a stripped break), register/filter movement — so it's
// not a flat loop. Every track is split into PER-SECTION clips (multiple editable
// pieces, with pauses), never one long sample. 1.5–2.5 min each.
// Techniques: [[project-100lights-arrangement-techniques]]. Rules: 1.5–2.5 min +
// editable clips + pauses [[feedback-song-length-editability]].
//   node scripts/templates.mjs  → public/_songgen/template-*.json

import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const note = (pitch, startBeat, dur, velocity) => ({ pitch, startBeat: +startBeat.toFixed(4), durationBeats: +Math.max(0.05, dur).toFixed(4), velocity })
const SUB = fc => ({ type: 'poly', params: { preset: 'Sub Sine', waveform: 'sine', attack: 0.004, decay: 0, sustain: 1, release: 0.12, detune: 0, filterType: 'lowpass', filterCutoff: fc, filterResonance: 0.7, lfoEnabled: false, lfoRate: 4, lfoDepth: 0, lfoTarget: 'filter', lfoWaveform: 'sine' } })
const NONE = { type: 'none', params: {} }

function buildTemplate(cfg) {
  let n = 0; const uid = p => `${p}${(n++).toString(36)}`
  let s = cfg.seed
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
  const hv = (base, slot = 0) => { let v = base + (rnd() * 6 - 3); if (slot === 0) v += 3; return Math.max(24, Math.min(120, Math.round(v))) }
  const { chords, roots } = cfg
  const P = chords.length

  const T = {
    bass:  { name: 'Sub Bass', instrument: SUB(cfg.subCutoff ?? 150), volume: cfg.vol.bass, pan: 0, preset: null, fx: [
      { id: uid('e'), type: 'saturator', params: { enabled: true, drive: 0.12, color: 0.25, output: -1 } },
      { id: uid('e'), type: 'compressor', params: { enabled: true, threshold: -18, ratio: 3, attack: 0.01, release: 0.16, knee: 6, makeupGain: 0 } },
    ] },
    keys:  { name: cfg.keysName, instrument: NONE, volume: cfg.vol.keys, pan: 0.05, preset: cfg.presets.keys, fx: [
      { id: uid('e'), type: 'reverb', params: { enabled: true, wet: cfg.keysReverb ?? 0.24, decay: 2.6, preDelay: 0.02 } },
    ] },
    pad:   { name: cfg.padName, instrument: NONE, volume: cfg.vol.pad, pan: -0.06, preset: cfg.presets.pad, fx: [
      { id: uid('e'), type: 'reverb', params: { enabled: true, wet: 0.46, decay: 3.6, preDelay: 0.03 } },
      { id: uid('e'), type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 9000, q: 0.9 } },
    ] },
  }
  for (const k in T) T[k].id = uid('t')
  const tracks = Object.entries(T).map(([, t]) => ({ id: t.id, name: t.name, instrument: t.instrument, volume: t.volume, pan: t.pan, effects: t.fx }))

  const clips = []
  // A clip PER SECTION PER active layer → multiple editable pieces + pauses.
  const mkClip = (role, startBar, bars, presetId, rollFx) => ({ id: uid('c'), trackId: T[role].id, presetId: presetId ?? null, rollFx: rollFx || null, startBeat: startBar * 4, durationBeats: bars * 4, notes: [], isDrumClip: false })

  let bar = 0
  for (const sec of cfg.sections) {
    const bassVel = { low: 66, mid: 80, full: 96 }[sec.bass] ?? 0
    // BASS — one held low note per chord (re-articulated each bar = editable), rests when the section omits it.
    if (sec.bass) { const c = mkClip('bass', bar, sec.bars, null); for (let b = 0; b < sec.bars; b++) c.notes.push(note(roots[(bar + b) % P], b * 4, 3.9, hv(bassVel))); clips.push(c) }
    // KEYS — a rising broken chord that blooms; brighter/higher on 'build' sections.
    if (sec.keys != null) {
      const oct = sec.keysOct ?? 0, kv = Math.round(sec.keys * 90), c = mkClip('keys', bar, sec.bars, cfg.presets.keys)
      for (let b = 0; b < sec.bars; b++) {
        const ch = chords[(bar + b) % P].map(p => p + oct)
        c.notes.push(note(ch[0] - 12, b * 4, 3.9, hv(kv - 8)))
        ;[ch[0], ch[1], ch[2], ch[0] + 12].forEach((p, i) => c.notes.push(note(p, b * 4 + i, (4 - i) * 0.95, hv(kv, i))))
      }
      clips.push(c)
    }
    // PAD — held chord bed; clip filterHz per section = simple filter motion (open on builds, dark on breaks).
    if (sec.pad != null) {
      const pv = Math.round(sec.pad * 90), c = mkClip('pad', bar, sec.bars, cfg.presets.pad, { filterHz: sec.bright ? 7500 : sec.dark ? 2400 : 4200 })
      for (let b = 0; b < sec.bars; b++) for (const p of [chords[(bar + b) % P][0] - 12, ...chords[(bar + b) % P]]) c.notes.push(note(p, b * 4, 3.95, hv(pv)))
      clips.push(c)
    }
    bar += sec.bars
  }

  const totalBeats = bar * 4
  const spec = {
    name: cfg.name, genre: cfg.genre, tempo: cfg.tempo, timeSignatureNum: 4, timeSignatureDen: 4, swing: 0,
    key: cfg.key, scale: cfg.scale, masterVolume: 0.5, tracks, clips, automationLanes: [], clipEffects: [],
    _form: cfg.sections.map(s => s.name).join(' · '), _tracks: 'bass+keys+pad',
  }
  const out = join(ROOT, 'public', '_songgen', `${cfg.file}.json`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(spec))
  const clipsPerTrack = tracks.map(t => clips.filter(c => c.trackId === t.id).length)
  console.log(`${cfg.name} — ${cfg.tempo}bpm · ${(totalBeats / cfg.tempo * 60).toFixed(0)}s · ${bar} bars · clips/track [${clipsPerTrack}] → ${cfg.file}.json`)
}

// A layer-in/out arc reused by all three (intro sparse → build → stripped break → build → resolve).
const ARC = (extra = {}) => ([
  { name: 'intro', bars: 6, keys: 0.5, pad: 0.42, dark: true },                                    // keys + pad, NO bass (pause)
  { name: 'A',     bars: 8, bass: 'full', keys: 0.62, pad: 0.5 },                                   // bass enters
  { name: 'B',     bars: 8, bass: 'full', keys: 0.74, pad: 0.56, keysOct: 12, bright: true, ...extra }, // build: keys up an octave, filter opens
  { name: 'break', bars: 4, pad: 0.52, dark: true },                                                // STRIP to pad only (drop-out)
  { name: 'A2',    bars: 8, bass: 'full', keys: 0.62, pad: 0.5 },
  { name: 'B2',    bars: 8, bass: 'full', keys: 0.74, pad: 0.56, keysOct: 12, bright: true },
  { name: 'outro', bars: 6, keys: 0.45, pad: 0.4, dark: true },                                     // resolve: back to keys + pad
])

// ── The three starter templates — different key / mood / instruments ─────────
buildTemplate({
  file: 'template-cinematic', name: 'Starter · A minor (Cinematic)', genre: 'ambient', seed: 90210,
  tempo: 90, key: 9, scale: 'minor', keysName: 'Grand Piano', padName: 'Warm Pad',
  presets: { keys: 'builtin-26', pad: 'builtin-30' },     // Grand Piano + Warm Pad
  vol: { bass: 0.4, keys: 1.0, pad: 0.46 },
  roots: [33, 29, 36, 31],                                // A1 F1 C2 G1
  chords: [[57, 60, 64], [53, 57, 60], [60, 64, 67], [55, 59, 62]],   // Am F C G
  sections: ARC(),
})

buildTemplate({
  file: 'template-lofi', name: 'Starter · D minor (Lo-fi)', genre: 'lofi', seed: 4242,
  tempo: 82, key: 2, scale: 'minor', keysName: 'Rhodes', padName: 'Choir Pad',
  presets: { keys: 'builtin-2', pad: 'builtin-29' },      // Rhodes + Choir Aahs
  vol: { bass: 0.42, keys: 1.08, pad: 0.52 }, keysReverb: 0.3,
  roots: [26, 34, 29, 36],                                // D1 Bb1 F1 C2
  chords: [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]],   // Dm Bb F C
  sections: [
    { name: 'intro', bars: 6, keys: 0.5, pad: 0.44, dark: true },
    { name: 'A',     bars: 8, bass: 'mid', keys: 0.6, pad: 0.5 },
    { name: 'B',     bars: 8, bass: 'full', keys: 0.72, pad: 0.55, bright: true },
    { name: 'break', bars: 4, keys: 0.5, dark: true },     // strip to Rhodes only (different break element)
    { name: 'A2',    bars: 8, bass: 'mid', keys: 0.6, pad: 0.5 },
    { name: 'outro', bars: 6, keys: 0.44, pad: 0.4, dark: true },
  ],
})

buildTemplate({
  file: 'template-warm', name: 'Starter · C major (Warm)', genre: 'ambient', seed: 100100,
  tempo: 100, key: 0, scale: 'major', keysName: 'Warm EP', padName: 'Synth Strings',
  presets: { keys: 'builtin-27', pad: 'builtin-9' },      // Warm EP + Synth Strings
  vol: { bass: 0.38, keys: 0.82, pad: 0.42 },
  roots: [36, 31, 33, 29],                                // C2 G1 A1 F1
  chords: [[60, 64, 67], [55, 60, 62], [57, 60, 64], [53, 57, 60]],   // C  Gsus4(G-C-D)  Am  F  — sus color on the V
  sections: ARC(),
})
