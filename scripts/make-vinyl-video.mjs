// Batch 3 — REALISTIC vinyl short: real turntable footage (Pexels) as the background, with the
// 100LIGHTS chrome (brand, label, caption, progress, scrims + credit) drawn as a canvas overlay in
// ONE Playwright pass, then the lofi song muxed in. Saved as "Vinyl (Video)" in Shorts › Tests.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'

const env = {}
for (const l of readFileSync('/Users/brae/100lights/.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
const BUCKET = env.R2_BUCKET, USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'
const D = `${homedir()}/Desktop/100lights-ai-renders`, W = 810, H = 1440

const CFG = {
  title: 'Vinyl (Video)', footage: `${D}/vinyl-footage-marchenkov.mp4`, credit: 'footage: D. Marchenkov / Pexels',
  song: `${D}/Dusk (lofi master).mp3`, start: 10, seconds: 16, accent: '#f472b6',
  label: 'Dusk', caption: 'NOW SPINNING',
}

async function ensureFolder() {
  await sql`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_id TEXT`
  const par = await sql`SELECT id FROM folders WHERE user_id=${USER} AND name='Shorts' ORDER BY created_at DESC LIMIT 1`
  const parentId = par[0]?.id ?? null
  const f = await sql`SELECT id FROM folders WHERE user_id=${USER} AND name='Tests' AND parent_id IS NOT DISTINCT FROM ${parentId} ORDER BY created_at DESC LIMIT 1`
  return f[0]?.id
}

// data: URL the footage so the file:// page can play it without a CORS-blocked relative fetch.
const footageDataUrl = `data:video/mp4;base64,${readFileSync(CFG.footage).toString('base64')}`

const html = `<style>*{margin:0}html,body{height:100%;background:#000;overflow:hidden}#v,#c{position:absolute;inset:0;width:100vw;height:100vh}#v{object-fit:cover}</style>
<video id=v muted playsinline></video><canvas id=c></canvas>
<script>
const W=${W},H=${H},c=document.getElementById('c');c.width=W;c.height=H;const x=c.getContext('2d');
const AC=${JSON.stringify(CFG.accent)},SEC=${CFG.seconds},LABEL=${JSON.stringify(CFG.label)},CAP=${JSON.stringify(CFG.caption)},CRED=${JSON.stringify(CFG.credit)};
const hexa=(h,a)=>{const n=parseInt(h.slice(1),16);return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')';};
const rr=(X,Y,w,h,r)=>{x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();};
const v=document.getElementById('v'); v.src=${JSON.stringify(footageDataUrl)}; let t0=0;
function draw(){const t=t0?(performance.now()-t0)/1000:0;x.clearRect(0,0,W,H);
// top scrim (brand legibility) + bottom scrim (label)
let g=x.createLinearGradient(0,0,0,220);g.addColorStop(0,'rgba(0,0,0,0.55)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,W,220);
g=x.createLinearGradient(0,H-360,0,H);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,0.75)');x.fillStyle=g;x.fillRect(0,H-360,W,360);
// accent glow tint (ties footage to brand)
g=x.createRadialGradient(W/2,H*0.42,0,W/2,H*0.42,W);g.addColorStop(0,hexa(AC,0.05));g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,W,H);
// brand
x.textAlign='left';x.fillStyle='#fff';x.font='800 30px system-ui,Arial';x.fillText('100LIGHTS',48,84);
x.font='600 14px ui-monospace,monospace';x.fillStyle=hexa('#ffffff',0.7);x.fillText('MADE IN 100LIGHTS',48,110);
// label + caption (bottom-left)
x.fillStyle=hexa('#ffffff',0.82);x.font='600 24px ui-monospace,monospace';x.fillText(CAP,48,H-150);
x.fillStyle=AC;x.font='800 64px system-ui,Arial';x.fillText(LABEL,48,H-92);
// pink accent tick
x.fillStyle=AC;rr(48,H-232,64,6,3);x.fill();
// credit (small, bottom-right)
x.textAlign='right';x.fillStyle=hexa('#ffffff',0.5);x.font='500 15px system-ui,Arial';x.fillText(CRED,W-40,H-40);
// progress
x.textAlign='left';x.fillStyle=hexa('#ffffff',0.18);rr(48,H-64,W-96,4,2);x.fill();
x.fillStyle=AC;rr(48,H-64,(W-96)*Math.min(1,t/SEC),4,2);x.fill();
requestAnimationFrame(draw);}
v.addEventListener('canplay',()=>{ v.play().then(()=>{ t0=performance.now(); window.__ready=true; }).catch(()=>{ t0=performance.now(); window.__ready=true; }); },{once:true});
v.load(); draw();
</script>`

const folderId = await ensureFolder()
const tmp = mkdtempSync(join(tmpdir(), 'vinvid-'))
try {
  const rdir = join(tmp, 'r'); mkdirSync(rdir, { recursive: true }); writeFileSync(join(rdir, 'i.html'), html)
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: join(tmp, 'v'), size: { width: W, height: H } } })
  const page = await ctx.newPage()
  process.stdout.write(`▸ ${CFG.title} (real footage + overlay)… `)
  await page.goto('file://' + join(rdir, 'i.html'), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(CFG.seconds * 1000 + 500)
  const v = page.video(); const videoPath = v ? await v.path() : null
  await ctx.close(); await browser.close()
  if (!videoPath) throw new Error('no video recorded')
  const muxed = join(tmp, 'out.mp4')
  execFileSync('ffmpeg', ['-y', '-i', videoPath, '-ss', String(CFG.start), '-t', String(CFG.seconds), '-i', CFG.song,
    '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', muxed], { stdio: 'ignore' })
  const vidId = randomUUID(), vidKey = `${USER}/${vidId}.mp4`
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: vidKey, Body: readFileSync(muxed), ContentType: 'video/mp4' }))
  await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at) VALUES (${vidId}, ${USER}, ${CFG.title}, 'video/mp4', ${CFG.seconds}, ${vidKey}, NULL, NOW()) ON CONFLICT (id) DO NOTHING`
  const media = [{ id: vidId, name: CFG.title, r2Key: vidKey, duration: CFG.seconds, contentType: 'video' }]
  const clip = { id: randomUUID(), color: CFG.accent, label: CFG.title, inPoint: 0, outPoint: CFG.seconds, startTime: 0, trackId: 'v1', mediaRefId: vidId, contentType: 'video', captions: [] }
  const tracks = [{ id: 'v1', label: 'Video', type: 'media', height: 64 }]
  const existing = await sql`SELECT id, data FROM projects WHERE user_id=${USER} AND deleted_at IS NULL AND folder_id=${folderId} AND data->>'name'=${CFG.title} ORDER BY saved_at DESC LIMIT 1`
  if (existing.length) {
    const d = existing[0].data; d.media = media; d.clips = [clip]; d.tracks = tracks; d.savedAt = new Date().toISOString()
    await sql`UPDATE projects SET data=${JSON.stringify(d)}::jsonb, saved_at=NOW() WHERE id=${existing[0].id}`
    console.log('✓ updated')
  } else {
    const projId = randomUUID()
    const data = { _type: '100lights-project', version: 1, id: projId, name: CFG.title, userId: USER, aspect: '9:16', audioMode: 'music', modules: ['video'], media, tracks, clips: [clip], outputs: [], captions: [], chapters: [], beatGrid: null, zoomLevel: 1, adjustments: {}, savedAt: new Date().toISOString() }
    const slug = 'vinyl-video-' + projId.slice(0, 6)
    await sql`INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data, folder_id) VALUES (${projId}, ${USER}, ${CFG.title}, ${slug}, 'braedancampbell', NOW(), ${JSON.stringify(data)}::jsonb, ${folderId})`
    console.log('✓ created')
  }
} finally { rmSync(tmp, { recursive: true, force: true }) }
console.log('Done — Vinyl (Video) in Shorts › Tests.')
