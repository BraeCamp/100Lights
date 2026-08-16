// DIFFERENT IDEAS (not visualizer skins). Builds genuinely distinct short concepts + files them as
// editable, audible video projects in a "Shorts — Ideas" folder:
//   1. TEXT-HOOK CARD  — the statement IS the video (kinetic type, no spectrum). EL-compatible.
//   2. QUIZ / REVEAL   — "guess the genre 👀 … it's ___" (same renderer, timed reveal). EL-compatible.
//   3. PRODUCT POV     — "type a vibe → get a song" text card. EL-compatible.
//   4. FALLING NOTES   — Synthesia-style note visual (needs MIDI → authored song, not EL audio).
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { recordFormatVideo } from '../lib/song-video/headless.mjs'
import { songVideoData } from '../lib/song-video/from-project.mjs'

const ROOT = process.cwd()
const env = {}
for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
const BUCKET = env.R2_BUCKET, USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'
const D = `${homedir()}/Desktop/100lights-ai-renders`
const W = 810, H = 1440
const put = (key, body, ct) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: ct }))

// ── TEXT-CARD renderer: kinetic typography over a drifting accent glow (no spectrum) ──
// lines: [{ text, at, accent?, size? }]  at = seconds when the line reveals.
function textCardHtml(lines, accent, seconds) {
  return `<style>*{margin:0}html,body{height:100%;background:#0a0812;overflow:hidden}canvas{width:100vw;height:100vh;display:block}</style>
<canvas id=c></canvas><script>
const W=${W},H=${H},c=document.getElementById('c');c.width=W;c.height=H;const x=c.getContext('2d');
const L=${JSON.stringify(lines)},AC=${JSON.stringify(accent)},SEC=${seconds},t0=performance.now();
const hexa=(h,a)=>{const n=parseInt(h.slice(1),16);return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')';};
function draw(){
  const t=(performance.now()-t0)/1000;
  x.fillStyle='#0a0812';x.fillRect(0,0,W,H);
  const gx=W/2+Math.sin(t*0.3)*90,gy=H*0.44+Math.cos(t*0.23)*60,pulse=0.5+0.5*Math.sin(t*2.1);
  const g=x.createRadialGradient(gx,gy,0,gx,gy,W*0.95);
  g.addColorStop(0,hexa(AC,0.20+0.06*pulse));g.addColorStop(0.5,hexa(AC,0.05));g.addColorStop(1,'rgba(0,0,0,0)');
  x.fillStyle=g;x.fillRect(0,0,W,H);
  x.textAlign='left';x.fillStyle='#ece9fd';x.font='800 34px system-ui,Arial';x.fillText('100LIGHTS',50,92);
  x.font='600 15px ui-monospace,monospace';x.fillStyle=hexa('#ece9fd',0.5);x.fillText('MADE IN 100LIGHTS',50,122);
  x.textAlign='center';
  const sizes=L.map(l=>l.size||(l.accent?68:52)),lh=sizes.map(s=>s*1.3),block=lh.reduce((a,b)=>a+b,0);
  let yy=H*0.5-block/2;
  for(let i=0;i<L.length;i++){const l=L[i],sz=sizes[i],p=Math.max(0,Math.min(1,(t-l.at)/0.5));
    x.globalAlpha=p;const dy=(1-p)*26;x.font=(l.accent?'800 ':'700 ')+sz+'px system-ui,Arial';
    x.fillStyle=l.accent?AC:'#ffffff';x.fillText(l.text,W/2,yy+sz*0.82-dy);yy+=lh[i];x.globalAlpha=1;}
  x.fillStyle=hexa('#ffffff',0.12);x.fillRect(50,H-70,W-100,4);
  x.fillStyle=AC;x.fillRect(50,H-70,(W-100)*Math.min(1,t/SEC),4);
  requestAnimationFrame(draw);
}
window.__ready=true;draw();
</script>`
}
async function recordCanvas(browser, html, seconds, tmpDir) {
  const rdir = join(tmpDir, 'r'); execFileSync('mkdir', ['-p', rdir]); writeFileSync(join(rdir, 'i.html'), html)
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: join(tmpDir, 'v'), size: { width: W, height: H } } })
  const page = await ctx.newPage()
  await page.goto('file://' + join(rdir, 'i.html'), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(seconds * 1000 + 400)
  const v = page.video(); await ctx.close()
  return v ? await v.path() : null
}

// ── the shorts (each a DIFFERENT idea) ──
const IDEAS = [
  { kind: 'text', name: 'Text hook — 12 seconds (EDM)', song: 'EDM EL__full-mix.mp3', start: 0, seconds: 15, accent: '#a78bfa',
    lines: [{ text: 'i let an AI', at: 0.8 }, { text: 'make this beat.', at: 1.5 }, { text: 'it took', at: 4.5 }, { text: '12 seconds. 🔊', at: 5.2, accent: true }] },
  { kind: 'text', name: 'Quiz reveal — guess the genre (Synthwave)', song: 'ai-synthwave-5011-1786226222457.mp3', start: 8, seconds: 16, accent: '#f472b6',
    lines: [{ text: 'guess the', at: 0.7 }, { text: 'genre 👀', at: 1.3, accent: true }, { text: '. . .', at: 6.5, size: 60 }, { text: "it's synthwave 🕹️", at: 11, accent: true, size: 58 }] },
  { kind: 'text', name: 'Product POV — type a vibe (Lofi)', song: 'Dusk (lofi master).mp3', start: 10, seconds: 16, accent: '#f59e0b',
    lines: [{ text: 'POV: you type', at: 0.8 }, { text: 'a vibe →', at: 1.5 }, { text: 'get a full song', at: 4.2 }, { text: 'no DAW skills. 🎹', at: 8, accent: true, size: 56 }] },
  { kind: 'notes', name: 'Falling notes — watch it play (Filtered House)', cfproj: 'ai-filtered-house-43770-1786843840300', mp3: 'ai-filtered-house-43770-1786843840300.mp3', start: 0, seconds: 20, accent: '#34d399' },
]

await sql`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
const folderId = randomUUID()
await sql`INSERT INTO folders (id, user_id, name) VALUES (${folderId}, ${USER}, 'Shorts — Ideas')`
console.log('folder created: Shorts — Ideas')

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
let made = 0
for (const it of IDEAS) {
  const tmp = mkdtempSync(join(tmpdir(), 'idea-'))
  try {
    const srcMp3 = `${D}/${it.kind === 'notes' ? it.mp3 : it.song}`
    process.stdout.write(`▸ ${it.name}… `)
    let videoPath
    if (it.kind === 'text') {
      videoPath = await recordCanvas(browser, textCardHtml(it.lines, it.accent, it.seconds), it.seconds, tmp)
    } else {
      const cf = JSON.parse(readFileSync(`${D}/${it.cfproj}.cfproj`, 'utf8'))
      const songData = songVideoData(cf.dawProject, { startBeat: 0 })
      const wavPath = join(tmp, 'a.wav'); execFileSync('ffmpeg', ['-y', '-ss', String(it.start), '-t', String(it.seconds), '-i', srcMp3, wavPath], { stdio: 'ignore' })
      const r = await recordFormatVideo(browser, { wavBuf: readFileSync(wavPath), songData, format: 'falling-notes', meta: 'MADE IN 100LIGHTS', hook: [{ text: 'watch it' }, { text: 'get played 🎹', accent: true }], seconds: it.seconds, root: ROOT, tmpDir: tmp, accent: it.accent })
      videoPath = r.videoPath
    }
    if (!videoPath) throw new Error('no video')
    const muxed = join(tmp, 'out.mp4')
    execFileSync('ffmpeg', ['-y', '-i', videoPath, '-ss', String(it.start), '-t', String(it.seconds), '-i', srcMp3,
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', muxed], { stdio: 'ignore' })
    const vidId = randomUUID(), vidKey = `${USER}/${vidId}.mp4`
    await put(vidKey, readFileSync(muxed), 'video/mp4')
    await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at)
      VALUES (${vidId}, ${USER}, ${it.name}, 'video/mp4', ${it.seconds}, ${vidKey}, NULL, NOW()) ON CONFLICT (id) DO NOTHING`
    const projId = randomUUID()
    const data = { _type: '100lights-project', version: 1, id: projId, name: it.name, userId: USER, aspect: '9:16', audioMode: 'music', modules: ['video'],
      media: [{ id: vidId, name: it.name, r2Key: vidKey, duration: it.seconds, contentType: 'video' }],
      tracks: [{ id: 'v1', label: 'Video', type: 'media', height: 64 }],
      clips: [{ id: randomUUID(), color: it.accent, label: it.name, inPoint: 0, outPoint: it.seconds, startTime: 0, trackId: 'v1', mediaRefId: vidId, contentType: 'video', captions: [] }],
      outputs: [], captions: [], chapters: [], beatGrid: null, zoomLevel: 1, adjustments: {}, savedAt: new Date().toISOString() }
    const slug = it.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '-' + projId.slice(0, 6)
    await sql`INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data, folder_id)
      VALUES (${projId}, ${USER}, ${it.name}, ${slug}, 'braedancampbell', NOW(), ${JSON.stringify(data)}::jsonb, ${folderId})`
    made++; console.log('✓')
  } catch (e) { console.log(`✗ ${e.message}`) }
  finally { rmSync(tmp, { recursive: true, force: true }) }
}
await browser.close()
console.log(`\nDone — ${made}/${IDEAS.length} DIFFERENT-idea shorts in "Shorts — Ideas".`)
