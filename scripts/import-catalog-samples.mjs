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
function prettyName(file, category) {
  let n = basename(file, extname(file))
  n = n.replace(/^\d+__[^_]+__/, '')          // freesound id + author prefix
  n = n.replace(/[_-]+/g, ' ').trim()
  n = n.replace(/\b\w/g, c => c.toUpperCase())
  return n || category
}

const picked = limit ? rows.slice(0, limit) : rows
const CONTENT_TYPE = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.m4a': 'audio/mp4' }

if (dryRun) {
  console.log('\nDry run — nothing uploaded.\n')
  for (const r of picked.slice(0, 12)) {
    const cat = CATEGORY[r.category] || 'custom'
    console.log(`  ${prettyName(r.file, r.category).padEnd(28)} ${cat.padEnd(8)} ${r.file}`)
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
      // JSONB column — it takes a JSON string, not a JS array. Passing the
      // array straight through fails with "invalid input syntax for type json"
      // AFTER the upload has already happened, which leaves the object in R2
      // and no row pointing at it. The key is deterministic, so a re-run
      // overwrites rather than accumulating orphans.
      const tags = JSON.stringify([r.author && `by ${r.author}`, r.license, r.source_pack].filter(Boolean))
      await sql`
        INSERT INTO catalog_sounds (id, name, category, r2_key, duration, content_type, folder, parent_folder, tags)
        VALUES (${id}, ${prettyName(r.file, r.category)}, ${CATEGORY[r.category] || 'custom'},
                ${r2Key}, ${Number(r.duration_s) || 0}, ${CONTENT_TYPE[ext] || 'audio/wav'},
                ${r.category || null}, ${'CC0 Drums'}, ${tags})
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
