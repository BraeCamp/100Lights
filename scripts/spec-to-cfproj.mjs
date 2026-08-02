#!/usr/bin/env node
// Convert a composer build-spec (public/_songgen/*.json) into a loadable
// 100Lights project file (.cfproj) written to Content/Audio/.
//
//   node scripts/spec-to-cfproj.mjs <spec.json> [more.json ...]
//   node scripts/spec-to-cfproj.mjs --all        # every composer spec

import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SPEC_DIR = join(ROOT, 'public', '_songgen')
const OUT_DIR = join(ROOT, 'Content', 'Audio')
const uid = () => randomUUID()

// Distinct track colors (drums, bass, keys, pad, lead, extras…).
const COLORS = ['#ef4444', '#a78bfa', '#3b82f6', '#14b8a6', '#f59e0b', '#22c55e', '#ec4899']

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function toDawProject(spec) {
  const id = uid()
  const tracks = spec.tracks.map((t, i) => ({
    id: t.id, name: t.name, type: 'audio',
    color: COLORS[i % COLORS.length],
    volume: t.volume ?? 0.8, pan: t.pan ?? 0,
    mute: false, solo: false, armed: false,
    height: 64, effects: t.effects ?? [], instrument: t.instrument,
  }))
  const arrangementClips = spec.clips.map(c => ({
    kind: 'midi', id: c.id, trackId: c.trackId, name: spec.tracks.find(t => t.id === c.trackId)?.name ?? 'Clip',
    startBeat: c.startBeat, durationBeats: c.durationBeats,
    notes: c.notes.map(n => ({ id: uid(), pitch: n.pitch, startBeat: n.startBeat, durationBeats: n.durationBeats, velocity: n.velocity })),
    isDrumClip: !!c.isDrumClip,
    ...(c.presetId ? { presetId: c.presetId } : {}),
    ...(c.rollFx ? { rollFx: c.rollFx } : {}),
  }))
  const loopEnd = Math.max(4, ...arrangementClips.map(c => c.startBeat + c.durationBeats))
  return {
    id, name: spec.name,
    tempo: spec.tempo, timeSignatureNum: spec.timeSignatureNum ?? 4, timeSignatureDen: spec.timeSignatureDen ?? 4,
    tracks, arrangementClips,
    scenes: Array.from({ length: 4 }, (_, i) => ({ id: uid(), name: `Scene ${i + 1}` })),
    sessionGrid: {},
    loopStart: 0, loopEnd, loopEnabled: false,
    masterVolume: spec.masterVolume ?? 0.8,
    automationLanes: spec.automationLanes ?? [], clipEffects: [], returnTracks: [], takeLanes: [],
    crossfaderValue: 0.5, waveformZoom: 1, swing: spec.swing ?? 0,
    cueMarkers: [], sections: [],
    key: spec.key ?? 0, scale: spec.scale ?? 'minor',
  }
}

function toCfproj(spec) {
  const dp = toDawProject(spec)
  return {
    _type: '100lights-project', version: 1, id: dp.id, name: dp.name,
    savedAt: '2026-08-02T00:00:00.000Z',
    tracks: [], clips: [], adjustments: {}, zoomLevel: 1,
    captions: [], outputs: [], media: [], modules: ['audio'], audioMode: 'music',
    dawProject: dp,
  }
}

const slugFor = (spec, file) => {
  // "Deep House — A minor" → deep-house-a-minor
  const base = (spec.name || basename(file, '.json'))
    .toLowerCase().replace(/[—–]/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
  return base
}

let files = process.argv.slice(2)
if (files.includes('--all') || files.length === 0) {
  // Every composer spec (skip the older gen_rhythm song1/song2).
  files = readdirSync(SPEC_DIR).filter(f => f.endsWith('.json') && !/^song[12]\.json$/.test(f)).map(f => join(SPEC_DIR, f))
}
mkdirSync(OUT_DIR, { recursive: true })
for (const f of files) {
  const path = f.includes('/') ? f : join(SPEC_DIR, f)
  const spec = JSON.parse(readFileSync(path, 'utf8'))
  const cfproj = toCfproj(spec)
  const out = join(OUT_DIR, `${slugFor(spec, path)}.cfproj`)
  writeFileSync(out, JSON.stringify(cfproj, null, 1))
  const nNotes = cfproj.dawProject.arrangementClips.reduce((a, c) => a + c.notes.length, 0)
  console.log(`${cfproj.name.padEnd(28)} · ${cfproj.dawProject.tracks.length} trk · ${nNotes} notes · key ${KEY_NAMES[cfproj.dawProject.key]} ${cfproj.dawProject.scale}`)
  console.log(`  → ${out}`)
}
