#!/usr/bin/env node
// Where do the bytes in a .cfproj go, and what would each fix be worth?
//
// Nobody noticed a song file was 0.89 MB of which 0.67 MB was one unread
// wavetable, because file size was invisible until someone opened Finder. This
// makes it a number you can look at.
//
//   node scripts/project-size.mjs <song.cfproj> [more.cfproj ...]
//   node scripts/project-size.mjs ~/Desktop/100lights-ai-renders/*.cfproj
//
// For context on the comparison this came out of: an Ableton `.als` is gzipped
// XML that contains NO audio — samples are referenced by path into the project
// folder beside it. Big Ableton PROJECTS reach hundreds of MB because of that
// folder; the .als itself is usually well under a megabyte. Our .cfproj is the
// .als equivalent, except it is uncompressed and, on the ElevenLabs path, has
// the audio inlined as base64 — which is the one place we are structurally
// heavier than Ableton rather than merely untidy.

import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { gzipSync } from 'node:zlib'

const files = process.argv.slice(2).filter(a => !a.startsWith('--'))
if (!files.length) { console.error('usage: project-size.mjs <song.cfproj> [...]'); process.exit(2) }

const KB = n => n / 1024
const fmt = n => (n >= 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(KB(n)) + ' KB')

let grand = 0, grandSavable = 0
for (const f of files) {
  let raw, p
  try { raw = readFileSync(f, 'utf8'); p = JSON.parse(raw) }
  catch (e) { console.log(`${basename(f)}: unreadable — ${e.message.slice(0, 60)}\n`); continue }
  const dp = p.dawProject ?? p
  const size = o => Buffer.byteLength(JSON.stringify(o), 'utf8')
  const total = Buffer.byteLength(raw, 'utf8')
  grand += total

  // Inlined audio — the ElevenLabs path, and the biggest structural difference
  // from how a DAW project file normally works.
  let audio = 0
  const scanAudio = o => {
    if (typeof o === 'string') { if (o.startsWith('data:audio')) audio += o.length; return }
    if (Array.isArray(o)) { for (const x of o) scanAudio(x); return }
    if (o && typeof o === 'object') for (const v of Object.values(o)) scanAudio(v)
  }
  scanAudio(p)

  // User wavetables travel inside every patch that uses one.
  let tables = 0
  const tableRows = []
  for (const t of dp.tracks ?? []) {
    for (const [id, tbl] of Object.entries(t.instrument?.params?.userTables ?? {})) {
      const b = size(tbl)
      tables += b
      tableRows.push({ track: t.name, id, bytes: b, frames: tbl.frames })
    }
  }

  let patches = 0
  for (const t of dp.tracks ?? []) if (t.instrument?.params) patches += size(t.instrument.params)

  let notes = 0, ids = 0, count = 0
  for (const c of dp.arrangementClips ?? []) for (const n of c.notes ?? []) {
    notes += size(n); count++
    if (n.id != null) ids += Buffer.byteLength(`"id":${JSON.stringify(n.id)},`, 'utf8')
  }
  const fx = size(dp.clipEffects ?? [])
  const gz = gzipSync(Buffer.from(raw), { level: 9 }).length

  console.log(`${basename(f)}  —  ${fmt(total)}`)
  const row = (label, b) => { if (b > 0) console.log(`  ${label.padEnd(34)}${fmt(b).padStart(9)}  ${((b / total) * 100).toFixed(1).padStart(5)}%`) }
  row('inlined base64 audio', audio)
  row('instrument patches', patches)
  row('  └ embedded wavetables', tables)
  row(`notes (${count})`, notes)
  row('  └ note ids', ids)
  row('effect-bar graphs', fx)
  console.log(`  ${'gzipped'.padEnd(34)}${fmt(gz).padStart(9)}  ${(total / gz).toFixed(1)}x`)

  // Only count what is genuinely recoverable without changing how it sounds.
  const savable = []
  for (const t of tableRows) {
    if (t.frames > 4) {
      const after = t.bytes * (4 / t.frames)
      savable.push([`${t.track}: ${t.id} wavetable has ${t.frames} frames`, t.bytes - after])
    }
  }
  if (audio > total * 0.3) savable.push(['audio inlined as base64 rather than referenced', audio - audio / 1.33])
  if (ids > 20000) savable.push([`${count} note ids are full uuids`, ids * 0.7])
  if (savable.length) {
    console.log('  recoverable:')
    let s = 0
    for (const [why, b] of savable) { console.log(`    ${why} → ${fmt(b)}`); s += b }
    grandSavable += s
  }
  console.log('')
}

if (files.length > 1) {
  console.log(`${files.length} files, ${fmt(grand)} total` +
    (grandSavable ? `, about ${fmt(grandSavable)} recoverable` : ''))
}
