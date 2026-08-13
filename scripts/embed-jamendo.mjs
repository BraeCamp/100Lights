#!/usr/bin/env node
// Embed Jamendo tracks into pgvector (track_embeddings) so "inspired by ___" can match by ACTUAL
// SOUND — using a LOCAL CLAP model (scripts/clap-embed.py), no paid Replicate/ImageBind, no per-track
// cost. Bakes the paid step out: pay once in compute, local forever.
//
// Only commercial-safe (non-NonCommercial) tracks are embedded, so every neighbour returned to the
// admin is usable on a monetized broadcast. Stores each track's genre/mood tags too, so the live
// route can pick a seed by vibe and then return its nearest-by-sound neighbours (query-by-example —
// nothing runs in production).
//
//   npm run embed:jamendo                          # sweep the built-in tag pool
//   node scripts/embed-jamendo.mjs --tags darkpop+synthpop+melancholic --limit 150
//   node scripts/embed-jamendo.mjs --target 3000   # keep sweeping until ~3000 tracks embedded
import { neon } from '@neondatabase/serverless'
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = n => (process.env[n] || (readFileSync(join(ROOT, '.env.local'), 'utf8').match(new RegExp(`^\\s*${n}\\s*=\\s*(.+)\\s*$`, 'm'))?.[1] || '')).trim().replace(/^["']|["']$/g, '')
const JAMENDO = env('JAMENDO_CLIENT_ID'), DB = env('DATABASE_URL')
if (!JAMENDO || !DB) { console.error('✗ Need JAMENDO_CLIENT_ID + DATABASE_URL in .env.local'); process.exit(1) }
const PY = join(ROOT, '.venv-clap', 'bin', 'python')
if (!existsSync(PY)) { console.error(`✗ CLAP venv missing (${PY}). Create it:\n  python3 -m venv .venv-clap && ./.venv-clap/bin/pip install torch transformers librosa soundfile`); process.exit(1) }
const sql = neon(DB)
const DIM = 512   // CLAP (laion/clap-htsat-unfused)

// Broad pool so the vector store is a diverse universe to draw neighbours from.
const POOL = [
  'lofi+chillhop+instrumental', 'ambient+drone+meditation', 'medieval+folk+acoustic', 'dark+ambient+cinematic',
  'electronic+downtempo', 'jazz+soul', 'classical+piano', 'synthwave+retrowave', 'rock+indie', 'hiphop+beats',
  'darkpop+synthpop+melancholic', 'bedroompop+dreampop+moody', 'rnb+soul+sensual', 'house+techno+dance',
  'metal+heavy+guitar', 'folk+singer+songwriter', 'orchestral+epic+soundtrack', 'funk+groove+disco',
  'trap+beats+808', 'chillout+relax+study',
  // deeper / more specific pockets for richer seeds
  'indie+pop+vocal', 'alternative+moody+guitar', 'electropop+catchy+female', 'dreampop+shoegaze+reverb',
  'sad+emotional+piano', 'phonk+dark+trap', 'ambient+cinematic+emotional', 'soul+rnb+smooth',
  'punk+garage+energetic', 'reggae+dub+chill', 'country+acoustic+storytelling', 'edm+festival+drop',
  'jazz+lounge+piano', 'world+ethnic+percussion', 'blues+guitar+soulful', 'gospel+choir+uplifting',
  'kpop+dance+pop', 'latin+pop+rhythm', 'drumandbass+breakbeat', 'vaporwave+chill+retro',
]

async function ensure() {
  await sql`CREATE EXTENSION IF NOT EXISTS vector`
  // If a table already exists with a different embedding dimension, drop it (it's a cache we rebuild).
  const dim = await sql`SELECT a.atttypmod AS d FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid WHERE c.relname = 'track_embeddings' AND a.attname = 'embedding'`
    .then(r => r[0]?.d).catch(() => null)
  if (dim && dim !== DIM) { console.log(`↻ existing store is ${dim}-d, rebuilding as ${DIM}-d`); await sql`DROP TABLE IF EXISTS track_embeddings` }
  await sql`CREATE TABLE IF NOT EXISTS track_embeddings (id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', artist TEXT NOT NULL DEFAULT '',
    audio TEXT NOT NULL, tags TEXT[] NOT NULL DEFAULT '{}', source TEXT NOT NULL DEFAULT 'jamendo',
    license TEXT NOT NULL DEFAULT '', embedding vector(${sql.unsafe(String(DIM))}), added_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`CREATE INDEX IF NOT EXISTS track_embeddings_vec_idx ON track_embeddings USING hnsw (embedding vector_cosine_ops)`
}

const isCommercial = ccurl => !/\/by-nc/i.test(ccurl || '')   // exclude NonCommercial

async function jamendo(tags, limit, offset = 0) {
  const ft = tags.split('+').map(t => encodeURIComponent(t.trim())).filter(Boolean).join('+')
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`https://api.jamendo.com/v3.0/tracks/?client_id=${JAMENDO}&format=json&limit=${limit}&offset=${offset}&fuzzytags=${ft}&order=popularity_total&audioformat=mp32&include=licenses+musicinfo&groupby=artist_id`, { cache: 'no-store' })
    if (r.ok) { const d = await r.json(); const rows = (d.results || []).filter(t => t.audio && isCommercial(t.license_ccurl)); if (rows.length) return rows }
  }
  return []
}

// --- CLAP embedder child process: write {id,url} lines, read {id,vec} lines in order ---
const py = spawn(PY, [join(ROOT, 'scripts', 'clap-embed.py')], { stdio: ['pipe', 'pipe', 'inherit'] })
const rl = createInterface({ input: py.stdout })
const queue = []
let ready
const readyP = new Promise(res => { ready = res })
rl.on('line', line => {
  let m; try { m = JSON.parse(line) } catch { return }
  if (m.ready) return ready()
  const cb = queue.shift(); if (cb) cb(m)
})
py.on('exit', c => { if (c) console.error(`\nCLAP process exited (${c})`) })
const embed = url => new Promise(res => { queue.push(res); py.stdin.write(JSON.stringify({ url }) + '\n') })

const args = process.argv.slice(2)
const has = f => args.includes(f)
const argV = (f, d) => (has(f) ? args[args.indexOf(f) + 1] : d)
const target = Number(argV('--target', '0'))

console.log('loading CLAP model…')
await ensure()
await readyP
console.log('CLAP ready. embedding commercial-safe tracks…\n')

const queries = has('--tags') ? [argV('--tags')] : POOL
const perTag = Number(argV('--limit', '60'))
const pages = Number(argV('--pages', has('--tags') ? '3' : '2'))   // paginate to get more distinct artists per tag
let added = 0, skipped = 0, failed = 0
outer: for (const tags of queries) {
  for (let page = 0; page < pages; page++) {
    const tracks = await jamendo(tags, perTag, page * perTag)
    if (!tracks.length) break   // no more pages for this tag
    for (const t of tracks) {
      const id = 'jam-' + t.id
      const [{ n }] = await sql`SELECT COUNT(*)::int n FROM track_embeddings WHERE id = ${id}`
      if (n) { skipped++; continue }
      const { vec, err } = await embed(t.audio)
      if (!vec) { failed++; if (err) process.stderr.write(`\n  ✗ ${t.name}: ${err}`); continue }
      const mi = t.musicinfo?.tags || {}
      const tt = [...(mi.genres || []), ...(mi.vartags || []), ...(mi.instruments || [])].map(x => String(x).toLowerCase())
      await sql`INSERT INTO track_embeddings (id, title, artist, audio, tags, source, license, embedding)
        VALUES (${id}, ${t.name}, ${t.artist_name}, ${t.audio}, ${tt}, 'jamendo', ${t.license_ccurl || ''}, ${'[' + vec.join(',') + ']'})
        ON CONFLICT (id) DO NOTHING`
      added++; process.stdout.write(`\r  ${tags.slice(0, 22).padEnd(22)} · +${added} embedded  (${skipped} skip, ${failed} fail)   `)
      if (target && added + skipped >= target) break outer
    }
  }
}
py.stdin.end()
const [{ n }] = await sql`SELECT COUNT(*)::int n FROM track_embeddings WHERE embedding IS NOT NULL`
console.log(`\n\nDone. +${added} new (${skipped} already there, ${failed} failed). Vector store now ${n} tracks.`)
process.exit(0)
