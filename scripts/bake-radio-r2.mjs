#!/usr/bin/env node
// Mirror the radio playlists' audio into Cloudflare R2, so the browser AND the 24/7 streamer fetch
// audio straight from R2's zero-egress CDN instead of our metered proxy (or the source hosts). Once a
// track is on R2, the playlist route hands out its R2 URL + a `direct` flag → the client bypasses the
// proxy entirely. Result: on-site radio costs ~$0 per listener, and the stream no longer depends on
// incompetech / Scott Buckley / Jamendo staying up.
//
//   node scripts/bake-radio-r2.mjs                      # bake every enabled station
//   node scripts/bake-radio-r2.mjs --station calm-orchestral
//   node scripts/bake-radio-r2.mjs --list              # show what's already mirrored
//
// Idempotent: skips anything already mirrored (dedupes identical tracks across stations by URL hash).
//
// Env (read from process env or .env.local):
//   DATABASE_URL                                   — Neon/Postgres (the radio_audio_mirror table)
//   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
//   R2_RADIO_BUCKET (or R2_BUCKET)                 — the bucket to upload into
//   R2_PUBLIC_BASE                                 — that bucket's PUBLIC url, no trailing slash,
//                                                    e.g. https://pub-xxxxxxxx.r2.dev  or  https://cdn.100lights.com
//   BASE_URL (default http://localhost:3001)       — the app origin to read playlists from

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { neon } from '@neondatabase/serverless'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
// Load .env.local for anything not already in the environment.
try {
  for (const line of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch { /* no .env.local — rely on the environment */ }

const args = process.argv.slice(2)
const stationArg = args.includes('--station') ? args[args.indexOf('--station') + 1] : null
const listOnly = args.includes('--list')
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const BUCKET = process.env.R2_RADIO_BUCKET || process.env.R2_BUCKET
const PUBLIC_BASE = (process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '')
const PREFIX = 'radio/'

if (!process.env.DATABASE_URL) { console.error('✗ DATABASE_URL is required'); process.exit(1) }
const sql = neon(process.env.DATABASE_URL)
await sql`
  CREATE TABLE IF NOT EXISTS radio_audio_mirror (
    src_url TEXT PRIMARY KEY, r2_url TEXT NOT NULL, r2_key TEXT NOT NULL, bytes BIGINT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`

if (listOnly) {
  const rows = await sql`SELECT src_url, r2_url, bytes FROM radio_audio_mirror ORDER BY updated_at DESC`
  const total = rows.reduce((n, r) => n + Number(r.bytes || 0), 0)
  console.log(`${rows.length} mirrored tracks · ${(total / 1e6).toFixed(0)} MB on R2\n`)
  for (const r of rows) console.log(`  ${(Number(r.bytes || 0) / 1e6).toFixed(1).padStart(5)}MB  ${r.r2_url}`)
  process.exit(0)
}

// R2 config required for baking.
for (const [k, v] of Object.entries({ R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID, R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY, 'R2_RADIO_BUCKET/R2_BUCKET': BUCKET, R2_PUBLIC_BASE: PUBLIC_BASE })) {
  if (!v) { console.error(`✗ Missing ${k}. See the header of this script for the required env.`); process.exit(1) }
}
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
})

// Which stations to bake?
let slugs
if (stationArg) slugs = [stationArg]
else {
  const r = await fetch(`${BASE_URL}/api/broadcast/stations`)
  if (!r.ok) { console.error(`✗ couldn't list stations (${r.status}) from ${BASE_URL} — is the app running / is BASE_URL right?`); process.exit(1) }
  slugs = (await r.json()).stations.map(s => s.slug)
}

// Collect unique source track URLs across the chosen stations.
const srcUrls = new Set()
for (const slug of slugs) {
  const r = await fetch(`${BASE_URL}/api/broadcast/playlist?station=${encodeURIComponent(slug)}`)
  if (!r.ok) { console.warn(`  · playlist ${slug}: ${r.status} (skipped)`); continue }
  const d = await r.json()
  for (const t of d.tracks || []) {
    const u = String(t.url || '')
    // Skip proxied/local/already-R2 URLs — only mirror true remote source files.
    if (/^https?:/i.test(u) && !u.includes('/api/broadcast/audio') && (!PUBLIC_BASE || !u.startsWith(PUBLIC_BASE))) srcUrls.add(u)
  }
}
console.log(`${slugs.length} station(s) · ${srcUrls.size} unique source tracks`)

const existing = new Set((await sql`SELECT src_url FROM radio_audio_mirror`).map(r => String(r.src_url)))
const extOf = (u) => { const m = u.split('?')[0].match(/\.(mp3|m4a|aac|ogg|oga|wav|flac|opus)$/i); return m ? m[1].toLowerCase() : 'mp3' }
const ctypeOf = (e) => ({ mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', flac: 'audio/flac', opus: 'audio/opus' }[e] || 'audio/mpeg')

let done = 0, skipped = 0, failed = 0, bytes = 0
for (const src of srcUrls) {
  if (existing.has(src)) { skipped++; continue }
  const e = extOf(src)
  const key = `${PREFIX}${createHash('sha1').update(src).digest('hex')}.${e}`
  try {
    const r = await fetch(src, { headers: { 'User-Agent': 'Mozilla/5.0 (100lights radio bake)' } })
    if (!r.ok) { console.warn(`  ✗ ${r.status}  ${src.slice(0, 72)}`); failed++; continue }
    const body = new Uint8Array(await r.arrayBuffer())
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET, Key: key, Body: body, ContentType: ctypeOf(e),
      CacheControl: 'public, max-age=31536000, immutable',
    }))
    const r2Url = `${PUBLIC_BASE}/${key}`
    await sql`
      INSERT INTO radio_audio_mirror (src_url, r2_url, r2_key, bytes, updated_at)
      VALUES (${src}, ${r2Url}, ${key}, ${body.length}, NOW())
      ON CONFLICT (src_url) DO UPDATE SET r2_url = EXCLUDED.r2_url, r2_key = EXCLUDED.r2_key, bytes = EXCLUDED.bytes, updated_at = NOW()`
    done++; bytes += body.length
    if (done === 1 || done % 10 === 0) console.log(`  ✓ ${done} baked · ${(bytes / 1e6).toFixed(0)}MB …`)
  } catch (err) {
    console.warn(`  ✗ ${src.slice(0, 60)}: ${err.message}`); failed++
  }
}

console.log(`\nDone. baked ${done} · skipped ${skipped} (already mirrored) · failed ${failed}`)
console.log(`Uploaded ${(bytes / 1e6).toFixed(1)}MB to ${BUCKET} under ${PREFIX} · public base ${PUBLIC_BASE}`)
if (done) console.log(`The playlist route will now hand these out as direct R2 URLs (zero-egress, no proxy).`)
