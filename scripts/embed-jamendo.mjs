#!/usr/bin/env node
// Embed Jamendo tracks into pgvector (track_embeddings) so "inspired by ___" can do true audio
// similarity. Fetches tracks by tag, sends each track's audio URL to ImageBind on Replicate, stores
// the 1024-d vector. Needs JAMENDO_CLIENT_ID + REPLICATE_API_TOKEN (with billing — predictions 402
// without credit). Heavy + costs per track; run it in batches.
//
//   node scripts/embed-jamendo.mjs                 # a few tag sweeps
//   node scripts/embed-jamendo.mjs --tags lofi+chillhop --limit 100
import { neon } from '@neondatabase/serverless'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = n => (process.env[n] || (readFileSync(join(ROOT, '.env.local'), 'utf8').match(new RegExp(`^\\s*${n}\\s*=\\s*(.+)\\s*$`, 'm'))?.[1] || '')).trim().replace(/^["']|["']$/g, '')
const JAMENDO = env('JAMENDO_CLIENT_ID'), REPLICATE = env('REPLICATE_API_TOKEN'), DB = env('DATABASE_URL')
if (!JAMENDO || !REPLICATE || !DB) { console.error('✗ Need JAMENDO_CLIENT_ID + REPLICATE_API_TOKEN + DATABASE_URL in .env.local'); process.exit(1) }
const sql = neon(DB)
const IMAGEBIND = '0383f62e173dc821ec52663ed22a076d9c970549c209666ac3db181618b7a304'

const POOL = ['lofi+chillhop+instrumental', 'ambient+drone+meditation', 'medieval+folk+acoustic', 'dark+ambient+cinematic',
  'electronic+downtempo', 'jazz+soul', 'classical+piano', 'synthwave+retrowave', 'rock+indie', 'hiphop+beats']

async function ensure() {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  await sql`CREATE TABLE IF NOT EXISTS track_embeddings (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '',
    audio TEXT NOT NULL, tags TEXT[] NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT 'jamendo', embedding vector(1024), added_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`CREATE INDEX IF NOT EXISTS track_embeddings_vec_idx ON track_embeddings USING hnsw (embedding vector_cosine_ops)`
}

async function jamendo(tags, limit) {
  const ft = tags.split('+').map(t => encodeURIComponent(t.trim())).filter(Boolean).join('+')
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO}&format=json&limit=${limit}&fuzzytags=${ft}&order=popularity_total&audioformat=mp32&include=licenses&groupby=artist_id`, { cache: 'no-store' })
    if (r.ok) { const d = await r.json(); const rows = (d.results || []).filter(t => t.audio); if (rows.length) return rows }
  }
  return []
}

// Returns { vec } | { rate:true } (402 = no Replicate credit)
async function embed(url) {
  const res = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST', headers: { Authorization: `Bearer ${REPLICATE}`, 'Content-Type': 'application/json', Prefer: 'wait=60' },
    body: JSON.stringify({ version: IMAGEBIND, input: { modality: 'audio', input: url } }),
  })
  if (res.status === 402) return { rate: true }
  if (!res.ok) return {}
  let p = await res.json()
  for (let i = 0; i < 20 && (p.status === 'starting' || p.status === 'processing'); i++) {
    await new Promise(r => setTimeout(r, 2500))
    p = await (await fetch(p.urls.get, { headers: { Authorization: `Bearer ${REPLICATE}` } })).json()
  }
  return p.status === 'succeeded' && Array.isArray(p.output) ? { vec: p.output } : {}
}

const args = process.argv.slice(2)
const has = f => args.includes(f)
const argV = (f, d) => (has(f) ? args[args.indexOf(f) + 1] : d)
await ensure()
const queries = has('--tags') ? [argV('--tags')] : POOL
const perTag = Number(argV('--limit', has('--tags') ? '100' : '30'))
let total = 0
for (const tags of queries) {
  const tracks = await jamendo(tags, perTag)
  for (const t of tracks) {
    const id = 'jam-' + t.id
    const [{ n }] = await sql`SELECT COUNT(*)::int n FROM track_embeddings WHERE id = ${id}`
    if (n) continue                                 // already embedded
    const { vec, rate } = await embed(t.audio)
    if (rate) { console.error('\n⏳ Replicate 402 (no credit). Add billing, then re-run.'); process.exit(1) }
    if (!vec) continue
    await sql`INSERT INTO track_embeddings (id, title, artist, audio, tags, source, embedding)
      VALUES (${id}, ${t.name}, ${t.artist_name}, ${t.audio}, ${tags.split('+')}, 'jamendo', ${'[' + vec.join(',') + ']'}::vector)
      ON CONFLICT (id) DO NOTHING`
    total++; process.stdout.write(`\r  ${tags.slice(0, 18).padEnd(18)} · embedded ${total}   `)
  }
}
const [{ n }] = await sql`SELECT COUNT(*)::int n FROM track_embeddings WHERE embedding IS NOT NULL`
console.log(`\nEmbedded ${total} new. Vector store now ${n} tracks.`)
process.exit(0)
