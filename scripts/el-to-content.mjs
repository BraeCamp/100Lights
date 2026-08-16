// Turn the EL songs into content: render a 9:16 AUDIO-REACTIVE video (visual reads the real audio's
// spectrum via a WebAudio AnalyserNode). Produces THREE artifacts per song:
//   • muxed mp4 (visual + audio) → the Content Queue draft (for review→publish)
//   • visual-only mp4 + the audio → uploaded to R2 so they can be saved as a 2-track (video+audio)
//     EDITABLE project in Brae's account (a follow-up browser step files those into his media library).
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
const D = `${homedir()}/Desktop/100lights-ai-renders`

const SONGS = [
  { mp3: `${D}/Orchestral EL__full-mix.mp3`, slug: 'orchestral-el', format: 'waveform',
    title: 'An AI wrote this orchestral piece 🎻 #Shorts',
    caption: 'An AI composed this cinematic orchestral cue. Made in 100Lights.\n\n#orchestral #filmscore #aimusic #composer',
    hook: [{ text: 'an AI wrote' }, { text: 'this orchestra.', accent: true }] },
  { mp3: `${D}/EDM EL__full-mix.mp3`, slug: 'edm-el', format: 'eq-bars',
    title: 'Wait for the AI-made EDM drop 🎧 #Shorts',
    caption: 'An AI built this melodic EDM drop. Made in 100Lights.\n\n#edm #futurebass #aimusic #producer',
    hook: [{ text: 'wait for the' }, { text: 'drop 🎧', accent: true }] },
]

const account = []
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
for (const s of SONGS) {
  const tmp = mkdtempSync(join(tmpdir(), 'el-content-'))
  try {
    const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', s.mp3]).toString().trim()) || 30
    const seconds = Math.min(30, Math.max(8, Math.round(dur)))
    const wavPath = join(tmp, 'a.wav'); execFileSync('ffmpeg', ['-y', '-i', s.mp3, wavPath], { stdio: 'ignore' })
    const songData = { tempo: 120, keyLabel: '', tracks: [{ name: 'Mix', color: '#a78bfa' }], notes: [], loopBeats: Math.round(seconds * 2) }
    console.log(`▸ rendering ${s.slug} (${s.format}, ${seconds}s)…`)
    const r = await recordFormatVideo(browser, { wavBuf: readFileSync(wavPath), songData, format: s.format, meta: 'MADE IN 100LIGHTS', hook: s.hook, seconds, root: ROOT, tmpDir: tmp })
    if (!r.videoPath) throw new Error('render produced no video')
    // visual-only mp4 (silent) + muxed mp4 (visual + audio)
    const visual = join(tmp, 'v.mp4'); execFileSync('ffmpeg', ['-y', '-i', r.videoPath, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', visual], { stdio: 'ignore' })
    const muxed = join(tmp, 'out.mp4'); execFileSync('ffmpeg', ['-y', '-i', r.videoPath, '-i', s.mp3, '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', muxed], { stdio: 'ignore' })
    const ts = Date.now()
    const muxKey = `content/${ts}-${s.slug}.mp4`, visKey = `content/${ts}-${s.slug}-visual.mp4`, audKey = `content/${ts}-${s.slug}-audio.mp3`
    await put(muxKey, readFileSync(muxed), 'video/mp4')
    await put(visKey, readFileSync(visual), 'video/mp4')
    await put(audKey, readFileSync(s.mp3), 'audio/mpeg')
    // update the existing queue row (replace the black video), or insert if missing
    const upd = await sql`UPDATE content_posts SET video_key=${muxKey}, video_type='video/mp4', title=${s.title}, caption=${s.caption}, format=${s.format} WHERE slug=${s.slug} RETURNING id`
    if (!upd.length) await sql`INSERT INTO content_posts (id, slug, format, title, caption, platforms, video_key, video_type, status) VALUES (${randomUUID()}, ${s.slug}, ${s.format}, ${s.title}, ${s.caption}, ${JSON.stringify(['youtube'])}::jsonb, ${muxKey}, 'video/mp4', 'draft')`
    account.push({ slug: s.slug, title: s.title, visKey, audKey, seconds })
    console.log(`  ✓ ${s.slug}: queue updated + visual/audio staged`)
  } catch (e) { console.error(`  ✗ ${s.slug}: ${e.message}`) }
  finally { rmSync(tmp, { recursive: true, force: true }) }
}
await browser.close()
writeFileSync('/Users/brae/.claude/jobs/22b592f1/tmp/el-account.json', JSON.stringify(account))
console.log('\nDone. Queue updated with working videos; visual+audio staged for the account save.')
