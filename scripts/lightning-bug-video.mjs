// Lightning Bug → content: render a Lightning Bug "Look" (a genre-styled, audio-reactive visualizer
// over a procedural aurora/nebula/waves background — the same look system the live visualizer uses,
// lib/music-looks.ts) reacting to a real Lightning Bug radio track (commercial-safe CC-BY from
// lib/broadcast-playlists.ts), then file it into the admin Content Queue as a draft for review.
//
// Run:  node scripts/lightning-bug-video.mjs            (default: Aurora look + Scott Buckley "Aurora")
// The track is CC-BY, so the required attribution is baked into the queued caption.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { recordFormatVideo } from '../lib/song-video/headless.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
const put = (key, body, ct) => s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET, Key: key, Body: body, ContentType: ct }))

// A Lightning Bug Look → renderer config. style bars→eq-bars, wave→waveform, radial→radial;
// procedural bg style (aurora/nebula/waves) + accent drive the whole palette (see backgrounds.mjs bgPalette).
const LOOK = {
  id: 'aurora', name: 'Aurora', format: 'radial', bgStyle: 'aurora',
  accent: '#34d399', bg: ['#0a1a17', '#050409'],
}
// A real Lightning Bug station track (commercial-safe, CC-BY — attribution required + included below).
const TRACK = {
  slug: 'lightning-bug-aurora',
  title: 'Lightning Bug — live visuals ✨ #Shorts',
  url: 'https://www.scottbuckley.com.au/library/wp-content/uploads/2021/10/Aurora.mp3',
  attribution: '“Aurora” by Scott Buckley (scottbuckley.com.au) · CC BY 4.0',
  start: 20, seconds: 24,
  hook: [{ text: 'Lightning Bug' }, { text: 'live visuals ✨', accent: true }],
}
const caption = `every song gets its own reactive visuals ✨ — Lightning Bug, live in 100Lights\n\nMusic: ${TRACK.attribution}\n\n#lightningbug #musicvisualizer #lofi #ambient #100lights`

const tmp = mkdtempSync(join(tmpdir(), 'lb-video-'))
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
try {
  // 1) pull the CC track, slice the render window (both wav for analysis + mp3 for the mux, aligned).
  const mp3full = join(tmp, 'full.mp3')
  execFileSync('curl', ['-sL', '--fail', '-o', mp3full, TRACK.url])
  const wavPath = join(tmp, 'a.wav'); execFileSync('ffmpeg', ['-y', '-ss', String(TRACK.start), '-t', String(TRACK.seconds), '-i', mp3full, wavPath], { stdio: 'ignore' })
  const mp3cut = join(tmp, 'cut.mp3'); execFileSync('ffmpeg', ['-y', '-ss', String(TRACK.start), '-t', String(TRACK.seconds), '-i', mp3full, '-af', 'afade=t=out:st=' + (TRACK.seconds - 1.5) + ':d=1.5', mp3cut], { stdio: 'ignore' })

  // 2) render the Lightning Bug look (audio-reactive visualizer + procedural aurora bg).
  const songData = { tempo: 120, keyLabel: '', tracks: [{ name: 'Mix', color: LOOK.accent }], notes: [], loopBeats: Math.round(TRACK.seconds * 2) }
  console.log(`▸ rendering Lightning Bug "${LOOK.name}" look (${LOOK.format} / bg:${LOOK.bgStyle}) over ${TRACK.slug}…`)
  const r = await recordFormatVideo(browser, { wavBuf: readFileSync(wavPath), songData, format: LOOK.format, meta: 'MADE IN 100LIGHTS', hook: TRACK.hook, seconds: TRACK.seconds, root: ROOT, tmpDir: tmp, accent: LOOK.accent, bgStyle: LOOK.bgStyle, bg: LOOK.bg })
  if (!r.videoPath) throw new Error('render produced no video')

  // 3) visual-only (silent, separable) + muxed (visual + audio) mp4s.
  const visual = join(tmp, 'v.mp4'); execFileSync('ffmpeg', ['-y', '-i', r.videoPath, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', visual], { stdio: 'ignore' })
  const muxed = join(tmp, 'out.mp4'); execFileSync('ffmpeg', ['-y', '-i', r.videoPath, '-i', mp3cut, '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', muxed], { stdio: 'ignore' })

  // 4) upload to R2 (content/<ts>-<slug>.mp4 — the key shape the queue accepts) + stage separable parts.
  const ts = Date.now()
  const muxKey = `content/${ts}-${TRACK.slug}.mp4`, visKey = `content/${ts}-${TRACK.slug}-visual.mp4`, audKey = `content/${ts}-${TRACK.slug}-audio.mp3`
  await put(muxKey, readFileSync(muxed), 'video/mp4')
  await put(visKey, readFileSync(visual), 'video/mp4')
  await put(audKey, readFileSync(mp3cut), 'audio/mpeg')

  // 5) enqueue as a Content Queue draft (admin reviews + approves before anything posts).
  const musical = JSON.stringify({ genre: 'Ambient', mood: 'cinematic', source: 'Lightning Bug', look: LOOK.id, attribution: TRACK.attribution })
  const upd = await sql`UPDATE content_posts SET video_key=${muxKey}, video_type='video/mp4', title=${TRACK.title}, caption=${caption}, format='lightning-bug', musical=${musical}::jsonb, status='draft' WHERE slug=${TRACK.slug} RETURNING id`
  let id
  if (upd.length) { id = upd[0].id }
  else { id = randomUUID(); await sql`INSERT INTO content_posts (id, slug, format, title, caption, platforms, video_key, video_type, musical, status) VALUES (${id}, ${TRACK.slug}, 'lightning-bug', ${TRACK.title}, ${caption}, ${JSON.stringify(['youtube', 'instagram', 'tiktok'])}::jsonb, ${muxKey}, 'video/mp4', ${musical}::jsonb, 'draft')` }
  console.log(`  ✓ queued draft ${id}`)
  console.log(`  muxed:  ${muxKey}`)
  console.log(`  visual: ${visKey}  audio: ${audKey}  (separable parts staged)`)
} finally {
  await browser.close()
  rmSync(tmp, { recursive: true, force: true })
}
console.log('\nDone. Lightning Bug video filed into the admin Content Queue as a draft.')
