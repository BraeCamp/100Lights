#!/usr/bin/env node
/**
 * Are the catalog's multisampled instruments actually playable?
 *
 *   npm run check:instruments
 *
 * An instrument pack can import perfectly — every row inserted, every file in
 * R2 — and still be unusable, because "playable" needs four things the import
 * itself never checks:
 *
 *   1. the pitch survived, as a `note:` tag Apollo can read back
 *   2. each instrument sits in its OWN folder, or "From Instrument…" merges
 *      two pianos into one instrument that is half of each
 *   3. release samples are NOT in a note folder, or the piano plays key-noise
 *   4. the audio is really at the other end of the URL
 *
 * Reads the database directly, then fetches one real sound over HTTP.
 * Needs DATABASE_URL in .env.local.
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { neon } from '@neondatabase/serverless'
import { importTs } from './lib/ts-import.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = n => (process.env[n] || (readFileSync(join(ROOT, '.env.local'), 'utf8')
  .match(new RegExp(`^\\s*${n}\\s*=\\s*(.+)\\s*$`, 'm'))?.[1] || '')).trim().replace(/^["']|["']$/g, '')

const PACK = process.argv[2] || 'CC0 Instruments'
const BASE = process.env.BASE || 'https://100lights.com'
const sql = neon(env('DATABASE_URL'))
const { bestTakes, spanZones, noteOf } = await importTs('lib/apollo/multisample-zones.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const rows = await sql`
  SELECT id, name, folder, duration, tags, r2_key FROM catalog_sounds WHERE parent_folder = ${PACK}`
const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM catalog_sounds`
console.log(`${rows.length} sounds in "${PACK}", ${total} in the catalog overall\n`)
check('the pack is in the catalog at all', rows.length > 0)
if (!rows.length) process.exit(1)

// ── The tags Apollo reads ───────────────────────────────────────────────────
const tagsOf = r => (Array.isArray(r.tags) ? r.tags : JSON.parse(r.tags || '[]'))
const entries = rows.map(r => ({ ...r, tags: tagsOf(r) }))
const pitched = entries.filter(e => noteOf(e) != null)
check('sounds carry a readable pitch', pitched.length > 0, `${pitched.length} of ${entries.length}`)
check('every sound records its licence',
  entries.every(e => e.tags.some(t => t.startsWith('lic:'))))
check('every sound records where it came from',
  entries.every(e => e.tags.some(t => t.startsWith('src:'))))
check('no sound would display 0:00', entries.every(e => Number(e.duration) > 0),
  `${entries.filter(e => !(Number(e.duration) > 0)).length} with no duration`)

// ── Folders build instruments ───────────────────────────────────────────────
const byFolder = new Map()
for (const e of entries) {
  if (!e.folder) continue
  if (!byFolder.has(e.folder)) byFolder.set(e.folder, [])
  byFolder.get(e.folder).push(e)
}
check('every sound is filed in a folder', entries.every(e => !!e.folder))

const instruments = [...byFolder.entries()]
  .map(([folder, items]) => ({ folder, items, takes: bestTakes(items) }))
  .filter(x => x.takes.length >= 3)          // the same bar the panel applies
  .sort((a, b) => b.takes.length - a.takes.length)

check('folders build multisampled instruments', instruments.length > 0,
  `${instruments.length} instruments, ${instruments.reduce((n, x) => n + x.takes.length, 0)} zones`)

console.log('\n  largest instruments:')
for (const x of instruments.slice(0, 8)) {
  console.log(`    ${x.folder.padEnd(44)} ${String(x.items.length).padStart(4)} files → ${String(x.takes.length).padStart(3)} zones`)
}

// A zone map with a gap has a dead key in the middle of the instrument.
const broken = []
for (const x of instruments) {
  const spans = spanZones(x.takes.map(t => t.note))
  const owners = new Array(128).fill(0)
  for (const s of spans) for (let k = s.loKey; k <= s.hiKey; k++) owners[k]++
  if (!owners.every(n => n === 1)) broken.push(x.folder)
}
check('every instrument covers the keyboard exactly once', broken.length === 0,
  broken.slice(0, 3).join(', ') || `${instruments.length} checked`)

// Two instruments in one folder is the failure that sounds like a badly
// sampled piano rather than like a bug.
const mixed = instruments.filter(x =>
  new Set(x.items.map(e => e.tags.find(t => t.startsWith('inst:'))).filter(Boolean)).size > 1)
check('no folder holds two different instruments', mixed.length === 0,
  mixed.map(x => x.folder).join(', ') || 'each folder is one instrument')

// ── Releases are not notes ──────────────────────────────────────────────────
const releaseFolders = [...byFolder.keys()].filter(f => /\(releases\)$/.test(f))
const strayReleases = instruments.filter(x =>
  !/\(releases\)$/.test(x.folder) && x.items.some(e => /(^|\/|_)Rel(eases)?(_|\/|$)/i.test(
    e.tags.find(t => t.startsWith('var:'))?.slice(4) || '')))
check('release samples are kept out of the note folders', strayReleases.length === 0,
  `${releaseFolders.length} release folders, ${strayReleases.length} strays`)

// ── The audio is really there ───────────────────────────────────────────────
const sample = instruments[0].takes[0].item
// The route takes the R2 KEY, not the catalog id.
const res = await fetch(`${BASE}/api/catalog/audio?key=${encodeURIComponent(sample.r2_key)}`)
const bytes = Number(res.headers.get('content-length') || 0)
check(`"${sample.name}" streams from ${BASE}`, res.ok && bytes > 1000,
  `HTTP ${res.status}, ${res.headers.get('content-type')}, ${bytes} bytes`)

// The list every visitor downloads on page load must still carry `note:`.
const api = await fetch(`${BASE}/api/catalog`)
if (api.ok) {
  const list = await api.json()
  const items = Array.isArray(list) ? list : (list.sounds ?? list.items ?? [])
  const mine = items.filter(x => (x.parentFolder ?? x.parent_folder) === PACK)
  check('the pack is served by /api/catalog', mine.length > 0, `${mine.length} of ${items.length}`)
  if (mine.length) {
    check('and the served rows still carry note:',
      mine.some(x => (x.tags || []).some(t => String(t).startsWith('note:'))))
    check('while the reorganise-only tags are trimmed out',
      !mine.some(x => (x.tags || []).some(t => /^(inst|var|grp|fam|src|url):/.test(String(t)))),
      'inst:/var:/grp:/fam: are database-only')
  }
} else {
  console.log(`  (skipped the API check — ${BASE}/api/catalog answered ${api.status})`)
}

console.log(failures ? `\n${failures} failing` : '\nthe pack is playable')
process.exit(failures ? 1 : 0)
