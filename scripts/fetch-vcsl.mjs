#!/usr/bin/env node
/**
 * Fetch the melodic half of VCSL — the Versilian Community Sample Library.
 *
 *   node scripts/fetch-vcsl.mjs --plan      # what it would take, and how big
 *   node scripts/fetch-vcsl.mjs             # download it
 *
 * VCSL is CC0-1.0: 4,231 samples, 6.15 GB, classified Hornbostel-Sachs. 571 of
 * its percussion samples are already in the catalog via the drums pack, so this
 * takes what is missing — the TONAL instruments the app currently only
 * synthesises: pianos, harpsichords, saxes, recorders, organs, harps, mallets,
 * kalimbas, tubular bells.
 *
 * Curated rather than mirrored, because a library is a set of choices:
 *
 *   - Membranophones are skipped wholesale. They are drums and we have them.
 *   - Untuned idiophones are skipped for the same reason — shakers, tambourines,
 *     cowbells, woodblocks, cymbals. The TUNED ones stay, and so do the texture
 *     instruments a drum pack never carries: wine glasses, bell trees, gongs.
 *   - Of five pianos only two survive. Steinway B is the flagship at 351
 *     samples, the Yamaha upright is a genuine contrast, and the other three
 *     are 1.1 GB of near-duplicate grand. Five pianos is not five times the
 *     library, it is four times the download.
 *   - Two harpsichords of five, chosen as different historical types.
 *
 * ⚠️ VCSL has NO bowed strings and NO guitars. "Composite Chordophones" is
 * harps and a strumstick. Violin, cello and guitar remain synthesised, and
 * need a different source.
 */

import { mkdirSync, writeFileSync, existsSync, statSync, readFileSync, openSync, readSync, closeSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

const OUT = process.env.OUT || join(homedir(), 'Desktop', 'CC0 Instruments')
const TREE = join(homedir(), '.claude', 'jobs', '0055fedb', 'tmp', 'vcsl-tree.json')
const RAW = 'https://raw.githubusercontent.com/sgossner/VCSL/master/'
const plan = process.argv.includes('--plan')
const CONCURRENCY = 12

// ── What to take ────────────────────────────────────────────────────────────

/** Drums. Already in the catalog, 571 of them, from this very library. */
const SKIP_FAMILY = new Set(['Membranophones'])

/** Untuned percussion — a drum pack's job, and it already did it. */
const SKIP_INSTRUMENT = new Set([
  'Suspended Cymbal 1', 'Suspended Cymbal 2', 'Clash Cymbals 1', 'Clash Cymbals 2',
  'Hi-Hat Cymbal', 'Shaker, Small', 'Shaker, Large', 'Shaker - Legacy', 'Cabasa',
  'Tambourine 1', 'Tambourine 2', 'Tambourine 3 - Legacy', 'Tambourine 4 - Legacy',
  'Tambourine 5 - Legacy', 'Claves', 'Woodblock', 'Cowbells', 'Agogo Bells', 'Guiro',
  'Claps', 'Cajon', 'Brake Drum', 'Anvil', 'Ratchet', 'Slapstick', 'Vibraslap',
  'Slit Drum', 'Sleigh Bells', 'Finger Cymbals', 'Flexatone', 'Siren',
  'Train Whistle, Toy', 'Ball Whistle',
])

/** Near-duplicates. The library is better for choosing. */
const SKIP_DUPLICATE = new Set([
  'Grand Piano, Kawai', 'Grand Piano, Kawai - Legacy', 'Upright Piano, Knight',
  'Harpsichord, Unk', 'Harpsichord, Italian', 'Harpsichord, French',
])

/** Where each instrument lands in the library. Keyed by instrument name so a
 *  reader can see the whole shape of the pack in one place. */
const GROUP = [
  [/Grand Piano|Upright Piano/, 'keys/piano'],
  [/Harpsichord/, 'keys/harpsichord'],
  [/FM Piano|^Piano 1$|Clavisynth/, 'keys/electric'],
  [/Organ/, 'keys/organ'],
  [/Saxophone|Saxello/, 'winds/saxophone'],
  [/Recorder/, 'winds/recorder'],
  [/Harmonica/, 'winds/harmonica'],
  [/Ocarina/, 'winds/ocarina'],
  [/Didgeridoo/, 'winds/didgeridoo'],
  [/Vibraphone|Marimba|Xylophone|Balafon|Glockenspiel/, 'mallets/tuned'],
  [/Tubular Bells|Hand Chimes|Bell Tree|Mark Trees|Hand Bells|Gong|Wine Glasses/, 'mallets/bells'],
  [/Kalimba|Mbira|Nyunga/, 'world/thumb-piano'],
  [/Harp/, 'strings/harp'],
  [/Dan Tranh|Strumstick|Psaltery/, 'world/plucked'],
  [/Triangles/, 'mallets/bells'],
]

const groupFor = name => GROUP.find(([re]) => re.test(name))?.[1] ?? null

// ── Reading the filename ────────────────────────────────────────────────────
//
// "AltRecorder_Stac_A#3_rr1_Main.wav" carries instrument, articulation, NOTE,
// round-robin and mic. The note is the valuable part: with it these become
// playable multisample instruments rather than a heap of one-shots.

const NOTE = /^([A-G])(#|b)?(-?\d)$/
const ARTIC = {
  stac: 'staccato', sus: 'sustain', legato: 'legato', trem: 'tremolo',
  pizz: 'pizzicato', hard: 'hard', soft: 'soft', med: 'medium', roll: 'roll',
  long: 'long', short: 'short', mute: 'muted', open: 'open', damp: 'damped',
}

function parseName(file) {
  const stem = file.split('/').pop().replace(/\.wav$/i, '')
  const parts = stem.split(/[_\-]/)
  let note = '', rr = '', artic = '', mic = '', vel = ''
  for (const p of parts) {
    if (!note && NOTE.test(p)) { note = p; continue }
    if (/^rr\d+$/i.test(p)) { rr = p.toLowerCase(); continue }
    if (/^vl\d+$/i.test(p)) { vel = p.slice(2); continue }   // velocity layer
    const a = ARTIC[p.toLowerCase()]
    if (a && !artic) { artic = a; continue }
    if (/^(main|close|room|far|mid|dist)$/i.test(p)) mic = p.toLowerCase()
  }
  return { note, rr, artic, mic, vel, stem }
}

// A release is the noise a key or valve makes when it is LET GO — the damper
// falling, the pad closing. VCSL ships them as their own sample set, at the
// same pitches as the notes. They belong in the library, but not in the same
// folder as the notes: Apollo builds an instrument from everything in one
// folder, and a piano whose zones are half damper-thuds plays as a piano that
// does not sound.
const isRelease = path => /(^|\/)Rel(eases)?(\/|$)/i.test(path) || /_Rel_/i.test(path)

// ── Select ──────────────────────────────────────────────────────────────────

const tree = JSON.parse(readFileSync(TREE, 'utf8'))
const all = tree.tree.filter(x => x.type === 'blob' && x.path.toLowerCase().endsWith('.wav'))

const picked = []
for (const x of all) {
  const p = x.path.split('/')
  if (p.length < 3) continue
  const [family, , instrument] = p
  if (SKIP_FAMILY.has(family)) continue
  if (SKIP_INSTRUMENT.has(instrument) || SKIP_DUPLICATE.has(instrument)) continue
  const group = groupFor(instrument)
  if (!group) continue                       // nothing sensible to call it
  picked.push({ ...x, family, instrument, group })
}

const totalMb = picked.reduce((n, x) => n + (x.size || 0), 0) / 1e6
const byGroup = {}
for (const x of picked) {
  byGroup[x.group] ??= { n: 0, mb: 0, inst: new Set() }
  byGroup[x.group].n++
  byGroup[x.group].mb += (x.size || 0) / 1e6
  byGroup[x.group].inst.add(x.instrument)
}

console.log(`${picked.length} samples, ${(totalMb / 1000).toFixed(2)} GB, ${new Set(picked.map(x => x.instrument)).size} instruments\n`)
for (const [g, v] of Object.entries(byGroup).sort((a, b) => b[1].n - a[1].n)) {
  console.log(`  ${g.padEnd(20)} ${String(v.n).padStart(4)} files  ${v.mb.toFixed(0).padStart(5)} MB   ${[...v.inst].slice(0, 4).join(', ')}${v.inst.size > 4 ? ` +${v.inst.size - 4}` : ''}`)
}
const withNote = picked.filter(x => parseName(x.path).note).length
console.log(`\n  ${withNote} of ${picked.length} carry a note name (${Math.round(withNote / picked.length * 100)}%) — those can become playable multisamples`)

if (plan) process.exit(0)

// ── Fetch ───────────────────────────────────────────────────────────────────

mkdirSync(OUT, { recursive: true })

// Encode PER SEGMENT. encodeURI() leaves '#' alone — it is legal in a URL, as
// the fragment delimiter — so "AltRecorder_Stac_A#4_rr1_Main.wav" asks the
// server for "AltRecorder_Stac_A" and gets a 404. Every sharp fails and every
// natural succeeds, which reads as a flaky network rather than a bug: the first
// run fetched 1,673 files and had lost every black key on every instrument.
const urlFor = path => RAW + path.split('/').map(encodeURIComponent).join('/')

// Built once, from the selection — not inside the worker. A row pushed per
// ATTEMPT means a retried file appears in the manifest twice, and the first run
// wrote 4,137 rows for 2,452 samples.
const rows = picked.map(x => {
  const meta = parseName(x.path)
  // Everything between the instrument folder and the file is an articulation or
  // mic variant ("…/Psaltery, Bowed and Plucked/LongBow/…"). Flattening would
  // throw that away, and it is not always repeated in the filename.
  const variant = x.path.split('/').slice(3, -1).join('/')
  return {
    file: join(x.group, x.instrument, variant, x.path.split('/').pop()),
    // The importer files a sound under "<category>/<subcategory>", and Apollo's
    // "From Instrument…" groups zones by that folder. So the subcategory has to
    // be the INSTRUMENT: file every piano under "keys/piano" and the Steinway
    // and the Yamaha merge into one instrument that is half of each. The
    // coarser grouping survives as a tag.
    category: x.group.split('/')[0],
    subcategory: isRelease(x.path) ? `${x.instrument} (releases)` : x.instrument,
    group: x.group,
    title: x.instrument + (meta.note ? ` ${meta.note}` : ''),
    instrument: x.instrument,
    note: meta.note,
    articulation: meta.artic || variant.split('/').pop() || '',
    variant,
    round_robin: meta.rr,
    velocity: meta.vel,
    mic: meta.mic,
    family: x.family,
    author: 'Versilian Studios and contributors',
    license: 'CC0-1.0',
    source: 'Versilian Community Sample Library (VCSL)',
    source_url: 'https://github.com/sgossner/VCSL/blob/master/'
      + x.path.split('/').map(encodeURIComponent).join('/'),
    bytes: x.size ?? 0,
    remote: x.path,
  }
})

let done = 0, skipped = 0
const failed = []
const queue = rows.slice()
const attempts = new Map()

async function worker() {
  while (queue.length) {
    const r = queue.shift()
    const dest = join(OUT, r.file)
    if (existsSync(dest) && statSync(dest).size > 0) { skipped++; continue }
    try {
      const res = await fetch(urlFor(r.remote), { signal: AbortSignal.timeout(120000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, buf)
      done++
      if (done % 200 === 0) console.log(`  ${done} fetched, ${queue.length} to go`)
    } catch (e) {
      // Three tries each, then give up on that file rather than spinning the
      // whole queue forever on something that is simply not there.
      const n = (attempts.get(r.file) ?? 0) + 1
      attempts.set(r.file, n)
      if (n < 3) queue.push(r)
      else failed.push(`${r.remote}: ${String(e.message).slice(0, 60)}`)
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))

/**
 * Seconds, from the WAV header — 4 KB read per file, not a decode.
 *
 * Without it every sound in the library reads "0:00", which looks like a
 * broken import rather than a missing field.
 */
function wavSeconds(path) {
  try {
    const fd = openSync(path, 'r')
    const head = Buffer.alloc(4096)
    const n = readSync(fd, head, 0, 4096, 0)
    closeSync(fd)
    if (n < 44 || head.toString('ascii', 0, 4) !== 'RIFF') return 0
    const byteRate = head.readUInt32LE(28)
    if (!byteRate) return 0
    // Walk the chunk list rather than assuming data starts at 44: VCSL files
    // carry LIST/INFO chunks, and a fixed offset reads their bytes as audio.
    let off = 12
    while (off + 8 <= n) {
      const id = head.toString('ascii', off, off + 4)
      const size = head.readUInt32LE(off + 4)
      if (id === 'data') return Number((size / byteRate).toFixed(3))
      off += 8 + size + (size % 2)
    }
    return 0
  } catch { return 0 }
}

// Only what actually landed goes in the manifest. A row pointing at a file that
// is not on disk fails inside the importer, after its neighbours have already
// been uploaded to R2.
const onDisk = rows.filter(r => {
  try { return statSync(join(OUT, r.file)).size > 0 } catch { return false }
})
for (const r of onDisk) r.duration_s = wavSeconds(join(OUT, r.file))
const cols = [...Object.keys(rows[0]).filter(c => c !== 'remote'), 'duration_s']
const csv = [cols.join(',')]
for (const r of onDisk) csv.push(cols.map(c => {
  const v = String(r[c] ?? '')
  return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}).join(','))
writeFileSync(join(OUT, 'MANIFEST.csv'), csv.join('\n'))
writeFileSync(join(OUT, 'LICENSE-CC0-1.0.txt'),
  'Versilian Community Sample Library (VCSL) — CC0 1.0 Universal (public domain dedication).\n' +
  'https://github.com/sgossner/VCSL\n')

if (failed.length) {
  console.log(`\n${failed.length} could not be fetched:`)
  for (const f of failed.slice(0, 10)) console.log(`  ✗ ${f}`)
}
console.log(`\n${done} fetched, ${skipped} already there, ${failed.length} failed`)
console.log(`manifest: ${join(OUT, 'MANIFEST.csv')} (${onDisk.length} rows)`)
