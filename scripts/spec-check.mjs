#!/usr/bin/env node
// ── MIDI-side pre-check — hear the ARRANGEMENT without rendering ──────────────
// Reads a compose build-spec (public/_songgen/*.json) and reports, per track:
// in-key %, onset density (notes/bar), note-length profile (sustained vs punchy),
// register, max polyphony, and structural flags (out-of-key, clip overlaps,
// empty tracks). Instant — catches "bass is a pulse not a drone", wrong notes,
// stacked clips, dead tracks BEFORE a slow real-time render.
//   node scripts/spec-check.mjs public/_songgen/artemas-kiss.json
import { readFileSync } from 'node:fs'

const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10], mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10], harmonicMinor: [0, 2, 3, 5, 7, 8, 11],
}
const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const median = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)] }

export function checkSpec(spec) {
  const allowed = new Set((SCALES[spec.scale] || SCALES.minor).map(x => ((spec.key || 0) + x) % 12))
  const beatsPerBar = 4
  const byTrack = new Map(spec.tracks.map(t => [t.id, t]))
  const clipsByTrack = {}
  for (const c of spec.clips) (clipsByTrack[c.trackId] ||= []).push(c)

  const tracks = spec.tracks.map(t => {
    const clips = (clipsByTrack[t.id] || []).sort((a, b) => a.startBeat - b.startBeat)
    const allNotes = clips.flatMap(c => c.notes.map(n => ({ ...n, abs: c.startBeat + n.startBeat })))
    const isDrum = clips.some(c => c.isDrumClip)
    // overlaps: two clips on this track share beats
    let overlaps = 0
    for (let i = 1; i < clips.length; i++) if (clips[i].startBeat < clips[i - 1].startBeat + clips[i - 1].durationBeats - 1e-6) overlaps++
    // span in bars (of covered clips)
    const spanBeats = clips.length ? Math.max(...clips.map(c => c.startBeat + c.durationBeats)) - Math.min(...clips.map(c => c.startBeat)) : 0
    const bars = Math.max(1, spanBeats / beatsPerBar)
    const pitches = allNotes.map(n => n.pitch)
    const durs = allNotes.map(n => n.durationBeats)
    // out-of-key (skip drums)
    let oob = 0
    if (!isDrum) for (const n of allNotes) if (!allowed.has(((n.pitch % 12) + 12) % 12)) oob++
    // max simultaneous voices
    const evs = []
    for (const n of allNotes) { evs.push([n.abs, 1], [n.abs + n.durationBeats, -1]) }
    evs.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let cur = 0, poly = 0
    for (const [, d] of evs) { cur += d; if (cur > poly) poly = cur }
    return {
      name: t.name, isDrum, notes: allNotes.length,
      onsetsPerBar: +(allNotes.length / bars).toFixed(1),
      medNoteBeats: +median(durs).toFixed(2),
      register: pitches.length ? [Math.min(...pitches), Math.max(...pitches)] : null,
      maxPoly: poly, overlaps, oob,
      character: isDrum ? 'drums' : (median(durs) >= 3 ? 'sustained/drone' : median(durs) >= 1 ? 'held' : 'punchy/pulse'),
    }
  })

  const flags = []
  for (const t of tracks) {
    if (t.oob) flags.push(`${t.name}: ${t.oob} OUT-OF-KEY note(s)`)
    if (t.overlaps) flags.push(`${t.name}: ${t.overlaps} overlapping clip(s) on one track`)
    if (!t.notes) flags.push(`${t.name}: EMPTY (no notes)`)
    if (t.register && t.register[0] < 21) flags.push(`${t.name}: note(s) below MIDI 21 (~27Hz) — subsonic/muddy risk`)
  }
  const totalOob = tracks.reduce((a, t) => a + t.oob, 0)
  return { key: `${KEY_NAMES[spec.key || 0]} ${spec.scale}`, tempo: spec.tempo, tracks, flags, inKey: totalOob === 0 }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2]
  if (!path) { console.log('usage: node scripts/spec-check.mjs <build-spec.json>'); process.exit(0) }
  const r = checkSpec(JSON.parse(readFileSync(path, 'utf8')))
  console.log(`\n${path.split('/').pop()} — ${r.key} @ ${r.tempo}bpm  ${r.inKey ? '✓ in key' : '✗ OUT OF KEY'}`)
  console.log('  track      notes  onsets/bar  medNote  register    poly  character')
  for (const t of r.tracks) console.log(`  ${t.name.padEnd(9)} ${String(t.notes).padStart(6)} ${String(t.onsetsPerBar).padStart(11)} ${String(t.medNoteBeats).padStart(8)}  ${(t.register ? t.register.join('-') : '-').padEnd(10)} ${String(t.maxPoly).padStart(5)}  ${t.character}`)
  if (r.flags.length) { console.log('  flags:'); r.flags.forEach(f => console.log('   ⚠ ' + f)) } else console.log('  ✓ no structural flags')
}
