#!/usr/bin/env node
// The content producer — turns the recipe catalog (lib/content/recipes.mjs) into drafts in the in-app
// Content Queue (Admin → Content Queue), tagged with experiment/variant/channel for A/B testing across
// YouTube channels. Two modes:
//
//   node scripts/make-content.mjs --plan                 # print the render jobs, touch nothing
//   node scripts/make-content.mjs --ingest=<dir>         # file already-rendered mp4s from <dir>,
//                                                          # matched to variants by filename order
//   node scripts/make-content.mjs --experiment=visual-showdown --ingest=~/Desktop/100lights-ai-renders
//
// (Fresh headless render — sheet-accompany audio + a song-video FORMAT — is the next wire-up; it needs a
//  dev server, so it's gated behind --render and off by default. The queue + A/B path below is proven.)
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { renderJobs, VISUALS, HOOKS } from '../lib/content/recipes.mjs'

const ROOT_DIR = fileURLToPath(new URL('..', import.meta.url))

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}
const argv = process.argv.slice(2)
const flag = (n, d) => { const a = argv.find(x => x.startsWith(`--${n}=`)); return a ? a.split('=')[1] : d }
const has = n => argv.includes(`--${n}`)
const EXPERIMENT = flag('experiment', null)
const INGEST = flag('ingest', null)

const jobs = renderJobs(EXPERIMENT ? [EXPERIMENT] : null)

// ── caption drafting (hook-first; the admin edits before publishing) ──────────
function draftCaption(job) {
  const title = ({
    aiWrote: 'An AI wrote this song in one pass 🎧',
    madeInBrowser: 'Made this entirely in a browser',
    sameMelody: 'Same melody, different genre — which hits?',
    guessGenre: 'Guess the genre before the drop',
    povFinished: 'POV: you finally finished a song',
    waitForIt: 'Wait for the drop 🎧',
    howLong: 'This took 4 minutes',
    studyThis: 'Lock in — focus mode',
  }[job.hook] || `${job.genre} in 100Lights`)
  const tags = `#musicproducer #beatmaker #${(job.genre || 'music').replace(/\s+/g, '')} #madeinbrowser #100lights`
  const caption = `${title}\n\n${VISUALS[job.visual] ? VISUALS[job.visual] + '.' : ''}\n${tags}`
  return { title: `${title} #Shorts`.slice(0, 100), caption }
}

if (has('plan') || (!INGEST && !has('render'))) {
  console.log(`\n=== ${jobs.length} render jobs across ${new Set(jobs.map(j => j.experiment)).size} experiments ===\n`)
  for (const j of jobs) {
    console.log(`  [${j.experiment}] ${j.variant.padEnd(16)} ch:${j.channelHint}  ${(j.genre || (j.multiGenre || []).join('/')).padEnd(22)} visual:${j.visual || '-'} hook:${j.hook || '-'} ${j.seconds}s`)
    console.log(`      tests: ${j.tests}`)
  }
  console.log(`\n(--ingest=<dir> files existing mp4s with these A/B tags; --render needs a dev server and renders fresh variants — default --limit=1. This --plan default creates nothing.)`)
  process.exit(0)
}

// ── queue writer (shared prod DB + R2; A/B columns added if missing) ──────────
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })

await sql`CREATE TABLE IF NOT EXISTS content_posts (
  id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), project_id TEXT,
  slug TEXT NOT NULL DEFAULT 'song-video', format TEXT NOT NULL DEFAULT 'falling-notes',
  title TEXT NOT NULL DEFAULT '', caption TEXT NOT NULL DEFAULT '',
  platforms JSONB NOT NULL DEFAULT '["youtube"]', video_key TEXT NOT NULL,
  video_type TEXT NOT NULL DEFAULT 'video/webm', musical JSONB,
  status TEXT NOT NULL DEFAULT 'draft', results JSONB NOT NULL DEFAULT '{}',
  error TEXT, published_at TIMESTAMPTZ )`
// A/B columns (idempotent) — experiment + variant + target channel.
await sql`ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS experiment TEXT`
await sql`ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS variant TEXT`
await sql`ALTER TABLE content_posts ADD COLUMN IF NOT EXISTS channel TEXT`

async function fileToQueue(job, mp4Path) {
  const bytes = readFileSync(mp4Path)
  const slug = `${job.experiment}-${job.variant}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)
  const key = `content/${Date.now()}-${slug}.mp4`
  await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: bytes, ContentType: 'video/mp4' }))
  const { title, caption } = draftCaption(job)
  await sql`INSERT INTO content_posts
    (id, slug, format, title, caption, platforms, video_key, video_type, status, experiment, variant, channel)
    VALUES (${randomUUID()}, ${slug}, ${job.visual || 'falling-notes'}, ${title}, ${caption},
            ${JSON.stringify(['youtube'])}::jsonb, ${key}, 'video/mp4', 'draft',
            ${job.experiment}, ${job.variant}, ${job.channelHint})`
  console.log(`✓ queued [${job.experiment}] ${job.variant} → channel ${job.channelHint}  (${(bytes.length/1e6).toFixed(1)}MB)`)
}

if (INGEST) {
  const dir = INGEST.replace(/^~/, homedir())
  const files = readdirSync(dir).filter(f => f.toLowerCase().endsWith('.mp4')).sort().map(f => `${dir}/${f}`)
  if (!files.length) { console.error(`no mp4s in ${dir}`); process.exit(1) }
  console.log(`Matching ${jobs.length} variants to ${files.length} rendered mp4s (by order, cycling)…\n`)
  let n = 0
  for (let i = 0; i < jobs.length; i++) {
    const mp4 = files[i % files.length]
    await fileToQueue(jobs[i], mp4); n++
  }
  console.log(`\nDone — ${n} A/B draft(s) queued. Open Admin → Content Queue; each is tagged experiment/variant/channel.`)
  process.exit(0)
}

// ── fresh render (opt-in via --render; OFF by default so it never creates content unasked) ──────────
// Phase 1: author a song (sheet-accompany → .cfproj) → bounce its audio. Phase 2: render the chosen
// song-video FORMAT (9:16, synced) → mp4 → file into the queue with the job's A/B tags.
if (has('render')) {
  const DEV_URL = flag('url', 'http://localhost:3000')
  const LIMIT = Number(flag('limit', '1'))            // safety: one variant unless asked for more
  const up = await fetch(DEV_URL).then(() => true).catch(() => false)
  if (!up) { console.error(`Dev server not reachable at ${DEV_URL}.\nStart it, then re-run:\n  (cd ${ROOT_DIR} && DEV_OPEN=1 npm run dev)   # then: node scripts/make-content.mjs --render`); process.exit(1) }

  const { chromium } = await import('playwright')
  const { bounceAudio, recordFormatVideo } = await import('../lib/song-video/headless.mjs')
  const { songVideoData, defaultMeta } = await import('../lib/song-video/from-project.mjs')
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')

  const OUT_DIR = `${homedir()}/Desktop/100lights-ai-renders`
  const MELODIES = ['ode', 'greensleeves']            // sheet-accompany's public-domain tunes (v1 audio)
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  let done = 0
  const batch = jobs.slice(0, LIMIT)
  for (const job of batch) {
    const tmp = mkdtempSync(join(tmpdir(), 'makecontent-'))
    try {
      // Phase 1 — author: sheet-accompany writes a .cfproj (its own mp3 render may fail without a
      // server; we ignore that and bounce the audio ourselves from the .cfproj).
      try { execFileSync('node', ['scripts/sheet-accompany.mjs', `--song=${MELODIES[done % MELODIES.length]}`], { cwd: ROOT_DIR, stdio: 'ignore' }) } catch { /* cfproj is written before the mp3 step */ }
      const cf = readdirSync(OUT_DIR).filter(f => f.endsWith('.cfproj') && /accompaniment/i.test(f)).sort().pop()
      if (!cf) throw new Error('sheet-accompany produced no .cfproj')
      const project = JSON.parse(readFileSync(join(OUT_DIR, cf), 'utf8'))
      const bpm = project.bpm || 120
      const sliceBeats = Math.max(8, Math.round((job.seconds || 15) * bpm / 60))

      // Phase 1b — bounce audio (dev server); Phase 2 — render the FORMAT video (9:16 synced).
      const wav = await bounceAudio(browser, DEV_URL, project, sliceBeats)
      if (!wav) throw new Error('audio bounce returned nothing (dev-server guest gate)')
      const songData = songVideoData(project, { startBeat: 0, beats: sliceBeats, genre: job.genre })
      const r = await recordFormatVideo(browser, {
        wavBuf: Buffer.from(wav.master, 'base64'), songData,
        format: job.visual || 'falling-notes', meta: defaultMeta(songData),
        hook: HOOKS[job.hook] || [], seconds: job.seconds || 15, root: ROOT_DIR, tmpDir: tmp,
      })
      if (!r.videoPath) throw new Error('video capture failed')
      const mp4 = join(tmp, 'out.mp4')
      execFileSync('ffmpeg', ['-y', '-i', r.videoPath, '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', mp4], { stdio: 'ignore' })
      await fileToQueue(job, mp4)
      done++
    } catch (e) {
      console.error(`✗ ${job.experiment}/${job.variant}: ${e.message}`)
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  }
  await browser.close()
  console.log(`\nRendered + queued ${done}/${batch.length} variant(s). (use --limit=N for more)`)
  process.exit(0)
}

console.error('Nothing to do. Use --plan (default), --ingest=<dir>, or --render.')
process.exit(1)
