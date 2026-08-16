// Make 5 music shorts × 3 video treatments each (15 total) and file them as editable, AUDIBLE
// video projects in a new "Shorts" folder in Brae's account. Reuses existing EL songs (no new EL
// spend / the local key is 401). Each treatment = an audio-reactive format (eq-bars/radial/waveform —
// the ones that work for EL audio, which has no note data) + a hook copied from what works on
// YouTube Shorts / TikTok. Single muxed video clip per project (plays with sound — see the fix in
// project-100lights-video-audio-tracks). Renders with the FIXED recordFormatVideo (no black screens).
import { chromium } from 'playwright'
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { recordFormatVideo } from '../lib/song-video/headless.mjs'

const ROOT = process.cwd()
const env = {}
for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
const BUCKET = env.R2_BUCKET, USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'
const D = `${homedir()}/Desktop/100lights-ai-renders`

// 5 shorts (genre spread) × 3 proven short-form treatments. hook = [line1, line2(accent)].
const SONGS = [
  { genre: 'EDM', file: 'EDM EL__full-mix.mp3', start: 0, treatments: [
    { fmt: 'eq-bars',  hook: ['wait for the', 'drop 🔊'],       accent: '#a78bfa', angle: 'wait for the drop' },
    { fmt: 'radial',   hook: ['rate this drop', '1–10 🔥'],      accent: '#f472b6', angle: 'rate 1–10' },
    { fmt: 'waveform', hook: ['an AI made', 'this EDM 🤖'],      accent: '#38bdf8', angle: 'AI made this' },
  ] },
  { genre: 'House', file: 'Hybrid House__full-mix.mp3', start: 8, treatments: [
    { fmt: 'waveform', hook: ['POV: the perfect', 'house loop 🏠'], accent: '#34d399', angle: 'POV perfect loop' },
    { fmt: 'eq-bars',  hook: ['this house beat', 'is illegal 🔥'],   accent: '#fbbf24', angle: 'illegal beat' },
    { fmt: 'radial',   hook: ['guess the', 'BPM 👀'],               accent: '#a78bfa', angle: 'guess the BPM' },
  ] },
  { genre: 'Lofi', file: 'Dusk (lofi master).mp3', start: 10, treatments: [
    { fmt: 'waveform', hook: ['POV: 3am', 'study session 📚'],  accent: '#f59e0b', angle: '3am study' },
    { fmt: 'radial',   hook: ['lofi to', 'heal to 🌙'],          accent: '#818cf8', angle: 'heal to' },
    { fmt: 'eq-bars',  hook: ['the loop you', 'needed today'],    accent: '#f472b6', angle: 'loop you needed' },
  ] },
  { genre: 'Synthwave', file: 'ai-synthwave-5011-1786226222457.mp3', start: 8, treatments: [
    { fmt: 'waveform', hook: ['night drive', 'coded 🌃'],        accent: '#f472b6', angle: 'night drive' },
    { fmt: 'radial',   hook: ['1985', 'called 🕹️'],             accent: '#a78bfa', angle: '1985 called' },
    { fmt: 'eq-bars',  hook: ['wait for the', 'synth 🎹'],       accent: '#38bdf8', angle: 'wait for the synth' },
  ] },
  { genre: 'Orchestral', file: 'Orchestral EL__full-mix.mp3', start: 0, treatments: [
    { fmt: 'waveform', hook: ['an AI wrote', 'this orchestra 🎻'], accent: '#a78bfa', angle: 'AI wrote this' },
    { fmt: 'radial',   hook: ["the villain's", 'theme 🎬'],        accent: '#ef4444', angle: 'villain theme' },
    { fmt: 'eq-bars',  hook: ['movie trailer', 'energy 🔊'],       accent: '#fbbf24', angle: 'trailer energy' },
  ] },
]

const put = (key, body, ct) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: ct }))
const probe = p => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim()) || 30

// folder
await sql`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
const folderId = randomUUID()
await sql`INSERT INTO folders (id, user_id, name) VALUES (${folderId}, ${USER}, 'Shorts')`
console.log('folder created: Shorts')

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
let made = 0
for (const song of SONGS) {
  const src = `${D}/${song.file}`
  let dur; try { dur = probe(src) } catch { console.error(`  ✗ ${song.genre}: source missing (${song.file})`); continue }
  const start = Math.min(song.start, Math.max(0, dur - 12))
  const seconds = Math.min(22, Math.max(8, Math.round(dur - start)))
  for (const t of song.treatments) {
    const tmp = mkdtempSync(join(tmpdir(), 'short-'))
    try {
      const wavPath = join(tmp, 'a.wav')
      execFileSync('ffmpeg', ['-y', '-ss', String(start), '-t', String(seconds), '-i', src, wavPath], { stdio: 'ignore' })
      const songData = { tempo: 120, keyLabel: '', tracks: [{ name: 'Mix', color: t.accent }], notes: [], loopBeats: Math.round(seconds * 2) }
      const hook = [{ text: t.hook[0] }, { text: t.hook[1], accent: true }]
      process.stdout.write(`▸ ${song.genre} · ${t.angle} (${t.fmt})… `)
      const r = await recordFormatVideo(browser, { wavBuf: readFileSync(wavPath), songData, format: t.fmt, meta: 'MADE IN 100LIGHTS', hook, seconds, root: ROOT, tmpDir: tmp, accent: t.accent })
      if (!r.videoPath) throw new Error('no video')
      const muxed = join(tmp, 'out.mp4')
      execFileSync('ffmpeg', ['-y', '-i', r.videoPath, '-ss', String(start), '-t', String(seconds), '-i', src,
        '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', muxed], { stdio: 'ignore' })
      const vidId = randomUUID(), vidKey = `${USER}/${vidId}.mp4`
      await put(vidKey, readFileSync(muxed), 'video/mp4')
      const name = `${song.genre} — ${t.angle} (${t.fmt})`
      await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at)
        VALUES (${vidId}, ${USER}, ${name}, 'video/mp4', ${seconds}, ${vidKey}, NULL, NOW()) ON CONFLICT (id) DO NOTHING`
      const projId = randomUUID()
      const data = {
        _type: '100lights-project', version: 1, id: projId, name, userId: USER,
        aspect: '9:16', audioMode: 'music', modules: ['video'],
        media: [{ id: vidId, name, r2Key: vidKey, duration: seconds, contentType: 'video' }],
        tracks: [{ id: 'v1', label: 'Video', type: 'media', height: 64 }],
        clips: [{ id: randomUUID(), color: t.accent, label: name, inPoint: 0, outPoint: seconds, startTime: 0, trackId: 'v1', mediaRefId: vidId, contentType: 'video', captions: [] }],
        outputs: [], captions: [], chapters: [], beatGrid: null, zoomLevel: 1, adjustments: {}, savedAt: new Date().toISOString(),
      }
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '-' + projId.slice(0, 6)
      await sql`INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data, folder_id)
        VALUES (${projId}, ${USER}, ${name}, ${slug}, 'braedancampbell', NOW(), ${JSON.stringify(data)}::jsonb, ${folderId})`
      made++; console.log('✓')
    } catch (e) { console.log(`✗ ${e.message}`) }
    finally { rmSync(tmp, { recursive: true, force: true }) }
  }
}
await browser.close()
console.log(`\nDone — ${made}/15 shorts in the "Shorts" folder (All Projects). Each: audible video, editable.`)
