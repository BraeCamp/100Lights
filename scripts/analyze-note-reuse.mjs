#!/usr/bin/env node
// How much of a song's rendering is the SAME calculation done again?
//
//   node scripts/analyze-note-reuse.mjs "<project.cfproj>"
//
// Brae: "It's the same calculation but at different pitches so it should be
// able to apply the same edits to the preset itself."
//
// Today the render cache is keyed per CLIP, on the clip's notes plus the patch.
// So every clip renders all of its notes, and touching one note re-renders that
// whole clip. But a note's sound depends only on (patch, pitch, velocity,
// length) — nothing about which clip it sits in, or what is around it. This
// counts how many DISTINCT such notes a song actually contains, against how
// much audio the per-clip scheme renders to produce them.

import { readFileSync } from 'node:fs'

const path = process.argv[2]
if (!path) { console.log('usage: analyze-note-reuse.mjs <project.cfproj>'); process.exit(1) }
const raw = JSON.parse(readFileSync(path, 'utf8'))
const proj = raw.dawProject ?? raw.project ?? raw
const bpm = proj.tempo || 120
const spb = 60 / bpm

// Velocity and length are bucketed rather than taken exactly: rendering a
// separate note for velocity 81 and velocity 82 would be silly, and the whole
// point is reuse. Buckets are the knob to tune — coarser means fewer renders
// and a rougher approximation.
const velBucket = v => Math.round((v ?? 100) / 16)          // ~8 layers
const lenBucket = b => Math.round(Math.log2(Math.max(b, 0.0625)) * 2) / 2

let clipCount = 0, noteCount = 0, clipAudioSec = 0
const distinct = new Set()
const byPitchVel = new Set()
const byPitch = new Set()
const perPatch = new Map()

// Clips live in arrangementClips and point back at a track, not inside it.
const byTrack = new Map()
for (const c of proj.arrangementClips ?? []) {
  if (!byTrack.has(c.trackId)) byTrack.set(c.trackId, [])
  byTrack.get(c.trackId).push(c)
}

for (const t of proj.tracks ?? []) {
  const inst = t.instrument
  if (!inst) continue
  // The patch identity. Two tracks on the same patch share every note render.
  const patchKey = JSON.stringify(inst.params ?? {}).length + ':' + (inst.params?.name ?? t.name)
  for (const c of byTrack.get(t.id) ?? []) {
    const notes = c.notes ?? []
    if (!notes.length) continue
    clipCount++
    clipAudioSec += (c.durationBeats ?? 0) * spb
    for (const n of notes) {
      noteCount++
      const k = `${patchKey}|${n.pitch}|${velBucket(n.velocity)}|${lenBucket(n.durationBeats ?? 1)}`
      distinct.add(k)
      // The cheaper variant: render ONE long note per pitch and velocity, and
      // get shorter notes by cutting it off where note-off falls. Correct only
      // while the amplitude envelope is the only thing that responds to note
      // length — a filter envelope still moving at cut-off point would be
      // frozen at the wrong place.
      byPitchVel.add(`${patchKey}|${n.pitch}|${velBucket(n.velocity)}`)
      byPitch.add(`${patchKey}|${n.pitch}`)
      if (!perPatch.has(patchKey)) perPatch.set(patchKey, new Set())
      perPatch.get(patchKey).add(k)
    }
  }
}

// Rendering one note costs its own length plus the tail the release needs.
const TAIL_SEC = 1.5
let distinctAudioSec = 0
for (const k of distinct) {
  const lb = Number(k.split('|')[3])
  distinctAudioSec += Math.pow(2, lb) * spb + TAIL_SEC
}

const pct = (a, b) => `${((a / b) * 100).toFixed(1)}%`
console.log(`\n${proj.name ?? 'project'} — ${bpm} BPM`)
console.log(`  ${proj.tracks?.length ?? 0} tracks, ${clipCount} clips with notes, ${noteCount} notes`)
console.log('')
console.log(`  rendered per clip (today)     ${clipAudioSec.toFixed(0)}s of audio across ${clipCount} renders`)
console.log(`  distinct notes to render      ${distinct.size}  (${pct(distinct.size, noteCount)} of ${noteCount} notes)`)
console.log(`  rendered per note (proposed)  ${distinctAudioSec.toFixed(0)}s of audio`)
console.log(`  ratio                         ${(clipAudioSec / distinctAudioSec).toFixed(2)}x less audio to render`)
console.log('')
console.log('  if length is handled by cutting a long note short instead:')
console.log(`    per pitch + velocity         ${byPitchVel.size} renders  (${pct(byPitchVel.size, noteCount)} of the notes)`)
console.log(`    per pitch, velocity scaled   ${byPitch.size} renders  (${pct(byPitch.size, noteCount)} of the notes)`)
console.log('')
console.log('  per patch:')
for (const [k, set] of [...perPatch].sort((a, b) => b[1].size - a[1].size)) {
  console.log(`    ${k.split(':')[1].padEnd(14)} ${String(set.size).padStart(4)} distinct notes`)
}
console.log('')
console.log('  And the part that matters more than the ratio: a note render is')
console.log('  keyed on the PATCH, not the clip — so moving, adding or deleting')
console.log('  notes invalidates nothing at all. Today it re-renders the clip.')
