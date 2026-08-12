#!/usr/bin/env node
// Poster-only CDN publisher for background clips. For each target clip it:
//   1. gets an MP4 (fetches + transcodes from Pexels for artsy clips, or reuses the already-
//      bundled public/bg/nature/<id>.mp4 for the local ones with `--nature`),
//   2. uploads the MP4 to Cloudflare R2 at key `bg/<id>.mp4`,
//   3. writes ONLY the small poster to public/bg/nature/<id>.jpg (bundled offline),
//   4. rebuilds lib/bg-cdn.ts from what's actually on R2 (authoritative list).
//
// This is how the catalog scales for online mode: MP4s live on R2, the repo carries only
// posters. Streaming activates once NEXT_PUBLIC_BG_CDN points at the bucket's public URL.
//
// Setup: R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET (+ PEXELS_API_KEY
// for artsy fetches) in .env.local. Needs ffmpeg. Then:
//   npm run bg:publish                 # publish the artsy clips (fetch + transcode + upload)
//   npm run bg:publish -- --nature     # also upload the already-bundled nature MP4s to R2
//   npm run bg:publish -- artsy-smoke  # just these ids

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { S3Client, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'bg', 'nature')

// Artsy clips — abstract/cinematic. Poster-only: the MP4 lives on R2, never bundled.
const ARTSY = {
  'artsy-ink-water': 'ink in water swirl slow motion',
  'artsy-light-leaks': 'light leaks film burn overlay',
  'artsy-smoke': 'colored smoke slow motion black background',
  'artsy-prism': 'prism light refraction rainbow',
  'artsy-oil-macro': 'oil and water bubbles macro',
  'artsy-paint-mix': 'paint mixing colors macro fluid',
  'artsy-fireworks': 'fireworks night sky slow motion',
  'artsy-water-caustics': 'water caustics light underwater',
  'artsy-gold-particles': 'gold particles bokeh floating black',
  'artsy-silk': 'flowing silk fabric slow motion',
  'artsy-lava-lamp': 'lava lamp blobs macro',
  'artsy-bokeh-drift': 'bokeh lights drifting abstract',
  // Night / neon — punchy
  'artsy-neon-signs': 'neon sign glowing night close up',
  'artsy-light-trails': 'long exposure light trails night traffic',
  'artsy-neon-tunnel': 'neon tunnel light motion',
  'artsy-laser': 'laser light show concert beams',
  'artsy-rain-neon': 'rain neon reflection night city',
  'artsy-city-bokeh-night': 'city bokeh lights night defocused',
  'artsy-plasma-ball': 'plasma ball electricity purple',
  'artsy-holographic': 'holographic iridescent foil abstract',
  'artsy-liquid-metal': 'liquid metal chrome flowing',
  'artsy-glitter': 'gold glitter sparkle falling',
  // Cinematic / music-video textures
  'artsy-marble-ink': 'marbling ink paint swirl blue',
  'artsy-liquid-color': 'colorful liquid paint flow macro',
  'artsy-bubbles': 'soap bubbles iridescent macro',
  'artsy-crystal': 'crystal prism light refraction rainbow',
  'artsy-honey': 'honey pouring golden macro slow',
  'artsy-powder': 'color powder explosion black background',
  'artsy-lens-flare': 'anamorphic lens flare light streak',
  'artsy-god-rays': 'light rays dust atmosphere forest',
  'artsy-projector': 'film projector light dust beam',
  'artsy-disco': 'disco ball light reflections party',
  'artsy-strobe': 'strobe light flashing dark',
  'artsy-spotlight': 'spotlight stage smoke beam',
  'artsy-film-grain': 'film grain scratches vintage overlay',
  'artsy-vhs-static': 'vhs static glitch retro noise',
  'artsy-silhouette-dance': 'dancer silhouette backlight',
  'artsy-slow-water': 'water droplets ripple slow motion',
  'artsy-smoke-dance': 'smoke swirl backlit dark slow',
  'artsy-particles-float': 'dust particles floating light beam',
  'artsy-neon-grid': 'retro neon grid synthwave motion',
  'artsy-galaxy': 'galaxy stars space nebula',
}

// --- env ---------------------------------------------------------------------------------
function loadEnv() {
  const p = join(ROOT, '.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnv()

const need = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET']
const missing = need.filter(k => !process.env[k])
if (missing.length) { console.error(`✗ Missing R2 env: ${missing.join(', ')} (add to .env.local)`); process.exit(1) }
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }) }
catch { console.error('✗ ffmpeg not found on PATH.'); process.exit(1) }

const KEY = process.env.PEXELS_API_KEY
const BUCKET = process.env.R2_BUCKET
const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
})

// --- args --------------------------------------------------------------------------------
const argv = process.argv.slice(2)
const alsoNature = argv.includes('--nature')
const explicit = argv.filter(a => !a.startsWith('--'))

// --- helpers -----------------------------------------------------------------------------
function bestFile(video) {
  const files = (video.video_files || []).filter(f => f.file_type === 'video/mp4' && f.width && f.height && f.width >= f.height)
  if (!files.length) return null
  const usable = files.filter(f => f.width <= 1920)
  return (usable.length ? usable : files).sort((a, b) => (b.width - a.width) || (a.quality === 'hd' ? -1 : 1))[0]
}
async function pexels(query) {
  const url = `https://api.pexels.com/videos/search?query=${encodeURIComponent(query)}&orientation=landscape&size=medium&per_page=12`
  const res = await fetch(url, { headers: { Authorization: KEY } })
  if (!res.ok) throw new Error(`Pexels ${res.status}`)
  return (await res.json()).videos || []
}
async function download(url, dest) {
  const res = await fetch(url); if (!res.ok) throw new Error(`download ${res.status}`)
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()))
}
function transcode(input, outMp4) {
  // ~8s keeps clips punchy — quick changes hold attention when auto-shuffling.
  execFileSync('ffmpeg', ['-y', '-i', input, '-t', '8', '-an',
    '-vf', 'scale=1280:720:force_original_aspect_ratio=increase,crop=1280:720,fps=30',
    '-c:v', 'libx264', '-crf', '25', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', outMp4], { stdio: 'ignore' })
}
function poster(mp4, outJpg) {
  execFileSync('ffmpeg', ['-y', '-i', mp4, '-frames:v', '1', '-q:v', '4', outJpg], { stdio: 'ignore' })
}
async function uploadMp4(id, mp4Path) {
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `bg/${id}.mp4`, Body: readFileSync(mp4Path), ContentType: 'video/mp4' }))
}

// --- run ---------------------------------------------------------------------------------
const artsyIds = explicit.length ? explicit.filter(id => ARTSY[id]) : Object.keys(ARTSY)

for (const id of artsyIds) {
  if (!KEY) { console.warn('  – artsy clips need PEXELS_API_KEY — skipping'); break }
  const raw = join(tmpdir(), `pub-${id}-${process.pid}.mp4`)
  const mp4 = join(tmpdir(), `pub-${id}-${process.pid}.out.mp4`)
  try {
    const vids = await pexels(ARTSY[id])
    const cand = vids.map(v => ({ v, f: bestFile(v) })).filter(x => x.f).sort((a, b) => (b.v.duration >= 6 ? 1 : 0) - (a.v.duration >= 6 ? 1 : 0))[0]
    if (!cand) { console.warn(`  – ${id}: no clip found`); continue }
    await download(cand.f.link, raw)
    transcode(raw, mp4)
    poster(mp4, join(OUT, `${id}.jpg`))   // bundle the poster only
    await uploadMp4(id, mp4)              // MP4 → R2, not the repo
    console.log(`  ✓ ${id}  → R2 bg/${id}.mp4 (+poster)  ← ${cand.v.user?.name || 'Pexels'}`)
  } catch (e) {
    console.warn(`  ✗ ${id}: ${e.message}`)
  }
}

if (alsoNature) {
  const local = readdirSync(OUT).filter(f => f.endsWith('.mp4')).map(f => f.replace(/\.mp4$/, ''))
  for (const id of local) {
    try { await uploadMp4(id, join(OUT, `${id}.mp4`)); console.log(`  ✓ ${id}  → R2 bg/${id}.mp4 (from bundled)`) }
    catch (e) { console.warn(`  ✗ ${id}: ${e.message}`) }
  }
}

// Rebuild lib/bg-cdn.ts from what's actually on R2 under bg/ — authoritative, no fragile parse.
const published = new Set()
let token
do {
  const res = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: 'bg/', MaxKeys: 1000, ContinuationToken: token }))
  for (const o of res.Contents ?? []) { const m = (o.Key || '').match(/^bg\/(.+)\.mp4$/); if (m) published.add(m[1]) }
  token = res.IsTruncated ? res.NextContinuationToken : undefined
} while (token)

const ids = [...published].sort()
writeFileSync(join(ROOT, 'lib', 'bg-cdn.ts'),
  `// Auto-generated by scripts/publish-bg-clips.mjs — clip ids whose MP4 is published to R2 at\n` +
  `// key \`bg/<id>.mp4\`. When NEXT_PUBLIC_BG_CDN is set, these stream from the CDN and only their\n` +
  `// small poster is bundled (the "poster-only" catalog). Do not edit by hand; re-run the\n` +
  `// publish script to refresh.\n` +
  `export const CDN_CLIPS: string[] = [${ids.map(s => `'${s}'`).join(', ')}]\n`)

console.log(`\n✓ ${ids.length} clips on R2. Set NEXT_PUBLIC_BG_CDN to the bucket's public URL to stream them.`)
