#!/usr/bin/env node
/**
 * Import a folder of samples into the official sound catalog.
 *
 *   node scripts/import-catalog-samples.mjs "~/Desktop/CC0 Samples" --dry-run
 *   node scripts/import-catalog-samples.mjs "~/Desktop/CC0 Samples" --limit 5
 *   node scripts/import-catalog-samples.mjs "~/Desktop/CC0 Samples"
 *
 * Uploads each sound to R2 and writes a catalog_sounds row, which puts it in
 * EVERY user's Sound Library — and therefore in Apollo's sample picker, since
 * that reads the same library.
 *
 * Reads MANIFEST.csv when the folder has one (category, duration, licence,
 * author, source), otherwise falls back to the directory layout. The manifest
 * is worth having: it carries attribution, and a catalogue of other people's
 * work without attribution is a licence problem waiting to happen even when
 * the licence is CC0.
 *
 * Idempotent. The catalog id is derived from the file's path, so re-running
 * skips what is already there and picks up only what is new — which matters
 * when the upload is hundreds of files and something times out halfway.
 *
 * Needs in .env.local: DATABASE_URL, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET.
 */

import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, basename, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = n => (process.env[n] || (readFileSync(join(ROOT, '.env.local'), 'utf8')
  .match(new RegExp(`^\\s*${n}\\s*=\\s*(.+)\\s*$`, 'm'))?.[1] || '')).trim().replace(/^["']|["']$/g, '')

const args = process.argv.slice(2)
const dir = (args.find(a => !a.startsWith('--')) || '').replace(/^~/, homedir())
const dryRun = args.includes('--dry-run')
const limit = Number((args.find(a => a.startsWith('--limit')) || '').split(/[= ]/)[1] || 0)
  || Number(args[args.indexOf('--limit') + 1]) || 0

if (!dir) { console.error('usage: import-catalog-samples.mjs <folder> [--dry-run] [--limit N]'); process.exit(1) }

// ── Categories ──────────────────────────────────────────────────────────────
// The library's own vocabulary (BeatType in lib/beat-analyzer.ts). Anything
// without a home becomes 'custom' rather than being forced into a drum that it
// is not — a shaker filed under "tom" is worse than a shaker filed under
// nothing, because the first one lies to every filter in the app.
const CATEGORY = {
  kick: 'kick', snare: 'snare', hihat: 'hihat', 'open-hihat': 'open-hihat',
  clap: 'clap', tom: 'tom', cymbal: 'crash', crash: 'crash', ride: 'ride',
  rimshot: 'rim', rim: 'rim', shaker: 'shaker', '808': '808',
  'hand-percussion': 'shaker', 'small-percussion': 'shaker',
  'found-percussion': 'custom', loops: 'custom', percussion: 'shaker',
}

// ── What to import ──────────────────────────────────────────────────────────
function fromManifest() {
  const path = join(dir, 'MANIFEST.csv')
  try { statSync(path) } catch { return null }
  const text = readFileSync(path, 'utf8')
  const rows = []
  // Minimal CSV: fields may be quoted and contain commas.
  const lines = text.split(/\r?\n/).filter(Boolean)
  const head = lines[0].split(',')
  for (const line of lines.slice(1)) {
    const cells = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') inQ = !inQ
      else if (ch === ',' && !inQ) { cells.push(cur); cur = '' }
      else cur += ch
    }
    cells.push(cur)
    const r = Object.fromEntries(head.map((h, i) => [h, cells[i]]))
    if (r.file) rows.push(r)
  }
  return rows
}

function fromDisk() {
  const out = []
  const walk = d => {
    for (const name of readdirSync(d)) {
      const full = join(d, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.(wav|mp3|ogg|flac|m4a)$/i.test(name)) continue
      out.push({ file: relative(dir, full), category: basename(dirname(full)) })
    }
  }
  walk(dir)
  return out
}

const rows = fromManifest() ?? fromDisk()
console.log(`${rows.length} sounds in ${dir}${fromManifest() ? ' (from MANIFEST.csv)' : ' (from the folder layout)'}`)

/** A stable id from the file's path, so re-running is a no-op for what exists. */
const idFor = file => 'cc0-' + createHash('sha1').update(file).digest('hex').slice(0, 16)

/** "388042__sami-kullstrom__clap.wav" → "Clap". Freesound ids and uploader
 *  handles are noise in a picker; the attribution lives in the tags. */
function prettyName(file, category, row) {
  // A manifest that carries a real title beats anything derived from a path.
  if (row?.title) {
    // Drop leading track numbers — "110717_02_(4)_Seagull" — which are the
    // recordist's filing, not the sound's name. Separators are normalised
    // FIRST: stripping "(4)" before the underscores become spaces leaves the
    // pattern unmatched, which is how "(4) Seagull" survived the first pass.
    let t = String(row.title)
      .replace(/\.(wav|mp3|ogg|flac|m4a)$/i, '')
      .replace(/[_-]+/g, ' ')
      .trim()
    let prev
    do { prev = t; t = t.replace(/^(\(\s*\d+\s*\)|\d+)\s*/, '').trim() } while (t !== prev)
    if (t) return t.replace(/\b\w/g, c => c.toUpperCase())
  }
  let n = basename(file, extname(file))
  n = n.replace(/^\d+__[^_]+__/, '')          // freesound id + author prefix
  n = n.replace(/[_-]+/g, ' ').trim()
  n = n.replace(/\b\w/g, c => c.toUpperCase())
  return n || category
}

/** Both levels where the manifest has them: a 3,000-sound pack with only
 *  thirteen folders is a pile, not a library. */
const folderFor = r => (r.subcategory ? `${r.category}/${r.subcategory}` : (r.category || null))

/** The pack's name in the library. Taken from the folder rather than hardcoded
 *  so the next import is not another edit here. */
const PARENT = basename(dir.replace(/\/$/, ''))

const picked = limit ? rows.slice(0, limit) : rows
const CONTENT_TYPE = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4' }

if (dryRun) {
  console.log('\nDry run — nothing uploaded.\n')
  for (const r of picked.slice(0, 12)) {
    const cat = CATEGORY[r.category] || 'custom'
    console.log(`  ${prettyName(r.file, r.category, r).padEnd(26)} ${cat.padEnd(8)} ${String(folderFor(r)).padEnd(24)} ${r.file.slice(0, 40)}`)
  }
  const cats = {}
  for (const r of picked) { const c = CATEGORY[r.category] || 'custom'; cats[c] = (cats[c] || 0) + 1 }
  console.log('\n  by library category:', Object.entries(cats).map(([k, v]) => `${k} ${v}`).join(', '))
  process.exit(0)
}

// ── Upload ──────────────────────────────────────────────────────────────────
const sql = neon(env('DATABASE_URL'))
const BUCKET = env('R2_BUCKET')
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') },
})

const existing = new Set(
  (await sql`SELECT id FROM catalog_sounds`.catch(() => [])).map(r => String(r.id)),
)
console.log(`${existing.size} already in the catalog\n`)

let done = 0, skipped = 0, failed = 0
const CONCURRENCY = 6
const queue = picked.slice()

async function worker() {
  while (queue.length) {
    const r = queue.shift()
    const id = idFor(r.file)
    if (existing.has(id)) { skipped++; continue }
    try {
      const bytes = readFileSync(join(dir, r.file))
      const ext = extname(r.file).toLowerCase()
      const r2Key = `catalog/${id}${ext}`
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: r2Key, Body: bytes, ContentType: CONTENT_TYPE[ext] || 'audio/wav',
      }))
      // EVERYTHING the manifest knows, kept as `key:value` strings.
      //
      // Brae: "make sure they keep the notes that they need to help
      // reorganizing." A pack like this is only reorganisable if the labels,
      // the predominance flag, the subcategory and the source survive the
      // import — derive them again later and you are guessing. They live in
      // the DATABASE; /api/catalog trims the heavy ones before sending the
      // list to every visitor, because that request runs on every page load.
      //
      // JSONB takes a JSON string, not a JS array. Passing the array straight
      // through fails with "invalid input syntax for type json" AFTER the
      // upload has happened, leaving an object in R2 with no row pointing at
      // it. Keys are deterministic, so a re-run overwrites rather than
      // accumulating orphans.
      const tags = JSON.stringify([
        r.category && `cat:${r.category}`,
        r.subcategory && `sub:${r.subcategory}`,
        r.tier && `tier:${r.tier}`,
        r.primary_label && `label:${r.primary_label}`,
        r.all_labels && `labels:${r.all_labels}`,
        r.pp_verified && `pp:${r.pp_verified}`,
        r.ambience_hint && `amb:${r.ambience_hint}`,
        // A multisampled instrument is only playable if the NOTE survives the
        // import. Apollo reads `note:` back off the tags to build key zones —
        // scraping it out of the display name instead would mean guessing, and
        // guessing wrong on any sound whose name happens to end in "B3".
        r.note && `note:${r.note}`,
        r.instrument && `inst:${r.instrument}`,
        r.articulation && `art:${r.articulation}`,
        r.round_robin && `rr:${r.round_robin}`,
        r.mic && `mic:${r.mic}`,
        r.variant && `var:${r.variant}`,
        r.group && `grp:${r.group}`,
        r.family && `fam:${r.family}`,
        r.tags && `kw:${r.tags}`,
        r.description && `desc:${r.description}`,
        r.author && `by:${r.author}`,
        r.license && `lic:${r.license}`,
        (r.source || r.source_pack) && `src:${r.source || r.source_pack}`,
        r.source_url && `url:${r.source_url}`,
      ].filter(Boolean))
      await sql`
        INSERT INTO catalog_sounds (id, name, category, r2_key, duration, content_type, folder, parent_folder, tags)
        VALUES (${id}, ${prettyName(r.file, r.category, r)}, ${CATEGORY[r.category] || 'custom'},
                ${r2Key}, ${Number(r.duration_s) || 0}, ${CONTENT_TYPE[ext] || 'audio/wav'},
                ${folderFor(r)}, ${PARENT}, ${tags})
        ON CONFLICT (id) DO NOTHING`
      done++
      if (done % 25 === 0) console.log(`  ${done} uploaded, ${queue.length} to go`)
    } catch (e) {
      failed++
      if (failed <= 3) console.log(`  ✗ ${r.file}: ${String(e.message).slice(0, 90)}`)
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, worker))
console.log(`\n${done} added, ${skipped} already there, ${failed} failed`)
