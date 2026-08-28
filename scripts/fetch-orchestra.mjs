#!/usr/bin/env node
/**
 * Bowed strings, guitars and basses — the instruments VCSL does not have.
 *
 *   node scripts/fetch-orchestra.mjs --plan    # what it would take, and how big
 *   node scripts/fetch-orchestra.mjs           # download it (resumable)
 *   node scripts/fetch-orchestra.mjs --only vsco-strings
 *
 * VCSL gave us keys, winds, mallets and world instruments. What it has no
 * answer for is the two most-played instrument families in popular music:
 * anything bowed, and anything with a fretboard. Its "Composite Chordophones"
 * is harps and a strumstick.
 *
 * Every source here is CC0-1.0, verified by reading the repository's own
 * LICENSE file rather than trusting a directory listing — the whole test for
 * shipping audio inside a product is redistribution rights, and "free" is not
 * the same claim.
 *
 * The layouts disagree with each other, so each source says how to read itself.
 * What they share — per-segment URL encoding, one manifest row per file,
 * durations from the WAV header, articulation-aware folders — lives in
 * scripts/lib/sample-fetch.mjs.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  githubTree, rawUrl, parseSampleName, isNonNote, folderFor, download, writeManifest,
} from './lib/sample-fetch.mjs'

const OUT = process.env.OUT || join(homedir(), 'Desktop', 'CC0 Orchestra')
const plan = process.argv.includes('--plan')
// indexOf returns -1 when the flag is absent, and argv[0] is the node binary —
// so a bare run would look like `--only /opt/homebrew/bin/node`.
const onlyAt = process.argv.indexOf('--only')
const only = onlyAt >= 0 ? process.argv[onlyAt + 1] : ''

// ── The sources ─────────────────────────────────────────────────────────────
//
// `instrument` and `variant` read a repo path. `variant` is what separates one
// articulation from another, and it matters: everything in one folder becomes
// one instrument, so a folder holding both arco and pizzicato builds a cello
// that is plucked on some notes and bowed on others.

const SOURCES = [
  {
    id: 'vsco-strings',
    owner: 'sgossner', repo: 'VSCO-2-CE',
    family: 'strings',
    // Strings/Cello Section/pizzT/pizzT_A2_v1_RR1.wav
    include: p => p.startsWith('Strings/'),
    instrument: p => p.split('/')[1],
    variant: p => p.split('/').slice(2, -1).join('/'),
    author: 'Versilian Studios and VSCO 2 CE contributors',
    source: 'Versilian Studios Chamber Orchestra 2 Community Edition',
    url: 'https://github.com/sgossner/VSCO-2-CE',
  },
  {
    id: 'guitars-black-green',
    owner: 'sfzinstruments', repo: 'karoryfer.black-and-green-guitars',
    family: 'guitar',
    // Samples/black/ord/btb_a3_rr1.wav
    include: p => p.startsWith('Samples/'),
    instrument: p => ({ black: 'Black Electric Guitar', green: 'Green Electric Guitar' })[p.split('/')[1]]
      ?? p.split('/')[1],
    variant: p => p.split('/').slice(2, -1).join('/'),
    author: 'Karoryfer Samples',
    source: 'Karoryfer Black and Green Guitars',
    url: 'https://github.com/sfzinstruments/karoryfer.black-and-green-guitars',
  },
  {
    id: 'guitars-shiny',
    owner: 'sfzinstruments', repo: 'karoryfer.shinyguitar',
    family: 'guitar',
    // Samples/acoustic/a2_release_rr1_1.wav — the articulation is in the NAME
    // here, not the folder, so variant comes from the filename instead.
    include: p => p.startsWith('Samples/'),
    instrument: p => ({
      acoustic: 'Shiny Acoustic Guitar', electric: 'Shiny Semi-Hollow Guitar',
    })[p.split('/')[1]] ?? p.split('/')[1],
    variant: p => (/release/i.test(p.split('/').pop()) ? 'Releases' : ''),
    author: 'Karoryfer Samples',
    source: 'Karoryfer Shiny Guitar',
    url: 'https://github.com/sfzinstruments/karoryfer.shinyguitar',
  },
  {
    id: 'basses-black-blue',
    owner: 'sfzinstruments', repo: 'karoryfer.black-and-blue-basses',
    family: 'bass',
    // Samples/darkblack/reg/…
    include: p => p.startsWith('Samples/'),
    instrument: p => ({ darkblack: 'Dark Black Bass', babyblue: 'Baby Blue Bass' })[p.split('/')[1]]
      ?? p.split('/')[1],
    variant: p => p.split('/').slice(2, -1).join('/'),
    author: 'Karoryfer Samples',
    source: 'Karoryfer Black and Blue Basses',
    url: 'https://github.com/sfzinstruments/karoryfer.black-and-blue-basses',
  },
  {
    id: 'double-bass',
    owner: 'sfzinstruments', repo: 'dsmolken.double-bass',
    family: 'strings',
    // arco/arco_a2_f_down.wav — arco vs pizz is the top-level folder, and the
    // dynamic (pp/p/mf/f/ff) and bow direction are in the filename.
    include: p => /^(arco|pizz)\//.test(p),
    instrument: () => 'Double Bass',
    variant: p => p.split('/').slice(0, -1).join('/'),
    author: 'David Smolken (dsmolken)',
    source: 'dsmolken Double Bass',
    url: 'https://github.com/sfzinstruments/dsmolken.double-bass',
  },
  {
    id: 'cello',
    owner: 'sfzinstruments', repo: 'karoryfer-bigcat.cello',
    family: 'strings',
    // Samples/staccato/…
    include: p => p.startsWith('Samples/'),
    instrument: () => 'Cello',
    variant: p => p.split('/').slice(1, -1).join('/'),
    author: 'Karoryfer Samples / bigcat',
    source: 'Karoryfer-bigcat Cello',
    url: 'https://github.com/sfzinstruments/karoryfer-bigcat.cello',
  },
]

// ── Collect ─────────────────────────────────────────────────────────────────

const AUDIO = /\.(wav|flac|ogg)$/i
const chosen = only ? SOURCES.filter(s => s.id === only) : SOURCES
if (!chosen.length) {
  console.error(`no source called "${only}". known: ${SOURCES.map(s => s.id).join(', ')}`)
  process.exit(1)
}

const rows = []
for (const src of chosen) {
  const { branch, license, files } = await githubTree(src.owner, src.repo)

  // The licence is the reason we may ship any of this. Refuse rather than
  // quietly importing something that turns out to be attribution-only.
  if (license !== 'CC0-1.0') {
    console.error(`✗ ${src.repo}: license is ${license ?? 'unknown'}, not CC0-1.0 — skipping`)
    continue
  }

  const picked = files.filter(f => AUDIO.test(f.path) && src.include(f.path))
  for (const f of picked) {
    const meta = parseSampleName(f.path)
    const instrument = src.instrument(f.path)
    const variant = src.variant(f.path)
    rows.push({
      file: join(src.id, instrument, variant, f.path.split('/').pop()),
      category: src.family,
      // Articulation belongs in the folder — see folderFor(). A folder is one
      // instrument in one articulation, or the thing it builds is a chimera.
      subcategory: folderFor(instrument, isNonNote(f.path) ? `Releases/${variant}` : variant),
      group: `${src.family}/${src.id}`,
      title: instrument + (meta.note ? ` ${meta.note}` : ''),
      instrument,
      note: meta.note,
      articulation: meta.artic || variant.split('/').pop() || '',
      variant,
      round_robin: meta.rr,
      velocity: meta.vel,
      bow: meta.bow,
      mic: meta.mic,
      family: src.family,
      author: src.author,
      license: 'CC0-1.0',
      source: src.source,
      source_url: `${src.url}/blob/${branch}/${f.path.split('/').map(encodeURIComponent).join('/')}`,
      bytes: f.size ?? 0,
      remote: f.path,
      _src: src, _branch: branch,
    })
  }
  const mb = picked.reduce((n, f) => n + (f.size || 0), 0) / 1e6
  console.log(`${src.id.padEnd(22)} ${String(picked.length).padStart(5)} files  ${mb.toFixed(0).padStart(5)} MB  (${license})`)
}

const totalMb = rows.reduce((n, r) => n + r.bytes, 0) / 1e6
const folders = new Set(rows.map(r => `${r.category}/${r.subcategory}`))
const pitched = rows.filter(r => r.note).length
console.log(`\n${rows.length} samples, ${(totalMb / 1000).toFixed(2)} GB, ${folders.size} folders`)
console.log(`${pitched} carry a note name (${Math.round(pitched / rows.length * 100)}%)`)

if (plan) {
  const byFolder = {}
  for (const r of rows) {
    const k = `${r.category}/${r.subcategory}`
    byFolder[k] ??= { n: 0, notes: new Set() }
    byFolder[k].n++
    if (r.note) byFolder[k].notes.add(r.note)
  }
  console.log('\nfolders (each becomes one playable instrument):')
  for (const [k, v] of Object.entries(byFolder).sort((a, b) => b[1].n - a[1].n).slice(0, 30)) {
    console.log(`  ${k.padEnd(54)} ${String(v.n).padStart(4)} files  ${String(v.notes.size).padStart(3)} pitches`)
  }
  console.log(`  … ${Math.max(0, Object.keys(byFolder).length - 30)} more`)
  process.exit(0)
}

// ── Fetch ───────────────────────────────────────────────────────────────────

const { done, skipped, failed } = await download(rows, OUT, {
  urlOf: r => rawUrl(r._src.owner, r._src.repo, r._branch, r.remote),
})

for (const r of rows) { delete r._src; delete r._branch }
const onDisk = writeManifest(OUT, rows, {
  licenseText: chosen.map(s => `${s.source} — CC0 1.0 Universal (public domain dedication)\n${s.url}\n`).join('\n'),
})

if (failed.length) {
  console.log(`\n${failed.length} could not be fetched:`)
  for (const f of failed.slice(0, 10)) console.log(`  ✗ ${f}`)
}
console.log(`\n${done} fetched, ${skipped} already there, ${failed.length} failed`)
console.log(`manifest: ${join(OUT, 'MANIFEST.csv')} (${onDisk.length} rows)`)
