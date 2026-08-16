#!/usr/bin/env node
// Seed the in-app Content Queue (Admin → Content Queue) with already-rendered .mp4 Shorts:
// uploads each to R2 under content/<ts>-<slug>.mp4 and inserts a `content_posts` draft row, so
// they show up for review → approve → publish. Reuses the same table lib/content/store.ts creates.
//
//   node scripts/seed-content.mjs "~/Desktop/100lights-ai-renders/Short - Same Melody (epic) 3 Genres.mp4" [more.mp4 ...]
//   node scripts/seed-content.mjs            # defaults to the 5 Shorts in ~/Desktop/100lights-ai-renders/
//
// Writes to the SAME Neon DB + R2 the app uses (DATABASE_URL / R2_* from .env.local).
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })

const DIR = `${homedir()}/Desktop/100lights-ai-renders`
const DEFAULTS = [
  ['Short - Same Melody (epic) 3 Genres.mp4',  'Same melody, 3 genres — which hits hardest?', 'One melody rebuilt across 3 genres in 100Lights.\n\n#musicproducer #beatmaker #phonk #madeinbrowser'],
  ['Short - Same Melody (penta) 3 Genres.mp4', 'Same 4 notes → 3 completely different vibes', 'Same pentatonic hook, three genres. Made in 100Lights.\n\n#musicproduction #flstudio #lofi #producer'],
  ['Short - Same Melody (pop) 3 Genres.mp4',   'One pop melody, three genres',                'Watch one pop line become 3 tracks in 100Lights.\n\n#popmusic #producer #beatmaking #musictok'],
  ['Short - Scored Clip (CINEMATIC).mp4',      'Scoring to picture in the browser',            'Cinematic score built shot-by-shot in 100Lights.\n\n#filmscore #cinematic #composer #musicproducer'],
]

const args = process.argv.slice(2)
const jobs = args.length
  ? args.map(p => [p.replace(/^~/, homedir()), null, null])
  : DEFAULTS.map(([f, t, c]) => [`${DIR}/${f}`, t, c])

// ensure the table exists (mirror of lib/content/store.ts ensure())
await sql`CREATE TABLE IF NOT EXISTS content_posts (
  id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), project_id TEXT,
  slug TEXT NOT NULL DEFAULT 'song-video', format TEXT NOT NULL DEFAULT 'falling-notes',
  title TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '',
  platforms JSONB NOT NULL DEFAULT '["youtube"]', video_key TEXT NOT NULL,
  video_type TEXT NOT NULL DEFAULT 'video/webm', musical JSONB,
  status TEXT NOT NULL DEFAULT 'draft', results JSONB NOT NULL DEFAULT '{}',
  error TEXT, published_at TIMESTAMPTZ )`

let n = 0
for (const [path, title, caption] of jobs) {
  if (!existsSync(path)) { console.log(`skip (missing): ${path}`); continue }
  const base = path.split('/').pop().replace(/\.[^.]+$/, '')
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'short'
  const key = `content/${Date.now()}-${slug}.mp4`
  const bytes = readFileSync(path)
  await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: bytes, ContentType: 'video/mp4' }))
  const id = randomUUID()
  await sql`INSERT INTO content_posts (id, slug, format, title, caption, platforms, video_key, video_type, status)
    VALUES (${id}, ${slug}, 'falling-notes', ${title || base}, ${caption || ''}, ${JSON.stringify(['youtube'])}::jsonb, ${key}, 'video/mp4', 'draft')`
  console.log(`✓ queued "${title || base}"  (${(bytes.length/1e6).toFixed(1)}MB → ${key})`)
  n++
}
console.log(`\nDone — ${n} draft(s) in the Content Queue. Open Admin → Content Queue to review/approve.`)
