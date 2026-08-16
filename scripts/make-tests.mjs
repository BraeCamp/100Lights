// "One of each" — a diverse comparison batch of DISTINCT short concepts, all filed into a
// "Tests" folder nested inside "Shorts". Reuses engine formats (visualizer/falling-notes/stems)
// + a text renderer, and adds new canvas renderers (bouncing ball, fake iMessage, vinyl, tier list).
// Each = editable, audible video project (single muxed clip).
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { recordFormatVideo } from '../lib/song-video/headless.mjs'
import { songVideoData } from '../lib/song-video/from-project.mjs'

const ROOT = process.cwd(), env = {}
for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
const BUCKET = env.R2_BUCKET, USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'
const D = `${homedir()}/Desktop/100lights-ai-renders`, W = 810, H = 1440
const put = (key, body, ct) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: ct }))
const HEAD = `<style>*{margin:0}html,body{height:100%;background:#0a0812;overflow:hidden}canvas{width:100vw;height:100vh;display:block}</style><canvas id=c></canvas><script>
const W=${W},H=${H},c=document.getElementById('c');c.width=W;c.height=H;const x=c.getContext('2d');const t0=performance.now();
const hexa=(h,a)=>{const n=parseInt(h.slice(1),16);return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')';};
const brand=()=>{x.textAlign='left';x.fillStyle='#ece9fd';x.font='800 30px system-ui,Arial';x.fillText('100LIGHTS',48,84);x.font='600 14px ui-monospace,monospace';x.fillStyle=hexa('#ece9fd',0.5);x.fillText('MADE IN 100LIGHTS',48,110);};
const bg=(t,AC)=>{x.fillStyle='#0a0812';x.fillRect(0,0,W,H);const gx=W/2+Math.sin(t*0.3)*80,gy=H*0.42+Math.cos(t*0.23)*60,p=0.5+0.5*Math.sin(t*2.1);const g=x.createRadialGradient(gx,gy,0,gx,gy,W*0.95);g.addColorStop(0,hexa(AC,0.16+0.05*p));g.addColorStop(0.5,hexa(AC,0.04));g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,W,H);};
const prog=(t,SEC,AC)=>{x.fillStyle=hexa('#ffffff',0.12);x.fillRect(48,H-64,W-96,4);x.fillStyle=AC;x.fillRect(48,H-64,(W-96)*Math.min(1,t/SEC),4);};
const rr=(X,Y,w,h,r)=>{x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();};`

// ── canvas renderers ──────────────────────────────────────────────────────────
const textCard = (lines, AC, SEC) => HEAD + `const L=${JSON.stringify(lines)},AC=${JSON.stringify(AC)},SEC=${SEC};
function draw(){const t=(performance.now()-t0)/1000;bg(t,AC);brand();x.textAlign='center';
const sz=L.map(l=>l.size||(l.accent?66:50)),lh=sz.map(s=>s*1.3),bk=lh.reduce((a,b)=>a+b,0);let yy=H*0.5-bk/2;
for(let i=0;i<L.length;i++){const l=L[i],p=Math.max(0,Math.min(1,(t-l.at)/0.5));x.globalAlpha=p;x.font=(l.accent?'800 ':'700 ')+sz[i]+'px system-ui,Arial';x.fillStyle=l.accent?AC:'#fff';x.fillText(l.text,W/2,yy+sz[i]*0.82-(1-p)*26);yy+=lh[i];x.globalAlpha=1;}
prog(t,SEC,AC);requestAnimationFrame(draw);}window.__ready=true;draw();</script>`

const fakeIMsg = (title, msgs, AC, SEC) => HEAD + `const M=${JSON.stringify(msgs)},AC=${JSON.stringify(AC)},SEC=${SEC},TITLE=${JSON.stringify(title)};
function draw(){const t=(performance.now()-t0)/1000;x.fillStyle='#0a0812';x.fillRect(0,0,W,H);
x.textAlign='center';x.fillStyle='#ece9fd';x.font='800 30px system-ui,Arial';x.fillText(TITLE,W/2,150);x.strokeStyle=hexa('#ffffff',0.1);x.lineWidth=1;x.beginPath();x.moveTo(60,185);x.lineTo(W-60,185);x.stroke();
let y=290;x.textAlign='left';x.font='600 34px system-ui,Arial';
for(let i=0;i<M.length;i++){const m=M[i],p=Math.max(0,Math.min(1,(t-m.at)/0.35));if(p<=0){continue;}const tw=Math.min(560,x.measureText(m.text).width+56),bw=tw,bx=m.me?W-60-bw:60,by=y-(1-p)*18;x.globalAlpha=p;
x.fillStyle=m.me?AC:'#26262e';rr(bx,by,bw,74,22);x.fill();x.fillStyle=m.me?'#0a0812':'#ece9fd';x.fillText(m.text,bx+28,by+48);x.globalAlpha=1;y+=100;}
prog(t,SEC,AC);requestAnimationFrame(draw);}window.__ready=true;draw();</script>`

const tierList = (title, tiers, chips, AC, SEC) => HEAD + `const TI=${JSON.stringify(tiers)},CH=${JSON.stringify(chips)},AC=${JSON.stringify(AC)},SEC=${SEC},TITLE=${JSON.stringify(title)};
const rowH=150,top=230,rx=210;
function draw(){const t=(performance.now()-t0)/1000;bg(t,AC);brand();
x.textAlign='center';x.fillStyle='#fff';x.font='800 46px system-ui,Arial';x.fillText(TITLE,W/2,180);
for(let i=0;i<TI.length;i++){const ry=top+i*rowH;x.fillStyle=hexa(TI[i].c,0.9);rr(60,ry,120,rowH-16,16);x.fill();x.fillStyle='#0a0812';x.font='800 56px system-ui,Arial';x.textAlign='center';x.fillText(TI[i].k,120,ry+(rowH-16)/2+20);x.fillStyle=hexa('#ffffff',0.05);rr(rx-15,ry,W-rx-45,rowH-16,16);x.fill();}
for(const ch of CH){const p=Math.max(0,Math.min(1,(t-ch.at)/0.5)),e=1-Math.pow(1-p,3);if(p<=0)continue;const sx=W/2,sy=H-90,cx=sx+(ch.tx-sx)*e,cy=sy+(ch.ty-sy)*e;x.globalAlpha=Math.min(1,p*1.5);x.fillStyle=hexa(AC,0.9);rr(cx-ch.w/2,cy-30,ch.w,60,14);x.fill();x.fillStyle='#0a0812';x.font='800 30px system-ui,Arial';x.textAlign='center';x.fillText(ch.label,cx,cy+11);x.globalAlpha=1;}
prog(t,SEC,AC);requestAnimationFrame(draw);}window.__ready=true;draw();</script>`

const vinyl = (title, AC, SEC) => HEAD + `const AC=${JSON.stringify(AC)},SEC=${SEC},TITLE=${JSON.stringify(title)};
function draw(){const t=(performance.now()-t0)/1000;bg(t,AC);brand();const cx=W/2,cy=H*0.46,R=W*0.36,rot=t*2.1;
x.save();x.translate(cx,cy);x.rotate(rot);
x.beginPath();x.arc(0,0,R,0,7);x.fillStyle='#0d0d12';x.fill();
for(let r=R*0.42;r<R;r+=10){x.beginPath();x.arc(0,0,r,0,7);x.strokeStyle=hexa('#ffffff',0.04);x.lineWidth=1;x.stroke();}
x.beginPath();x.arc(0,0,R*0.34,0,7);x.fillStyle=AC;x.fill();x.fillStyle='#0a0812';x.beginPath();x.arc(0,0,7,0,7);x.fill();
x.restore();
// shine
x.beginPath();x.arc(cx,cy,R,0,7);x.strokeStyle=hexa(AC,0.5);x.lineWidth=3;x.stroke();
x.textAlign='center';x.fillStyle=hexa('#ece9fd',0.85);x.font='600 26px ui-monospace,monospace';x.fillText('NOW SPINNING',W/2,cy+R+90);
x.fillStyle='#fff';x.font='800 44px system-ui,Arial';x.fillText(TITLE,W/2,cy+R+150);
prog(t,SEC,AC);requestAnimationFrame(draw);}window.__ready=true;draw();</script>`

// bouncing ball: each bounce LANDS exactly on a note onset (parabola between onsets)
const bounce = (onsets, xs, AC, SEC) => HEAD + `const ON=${JSON.stringify(onsets)},XS=${JSON.stringify(xs)},AC=${JSON.stringify(AC)},SEC=${SEC};
const floorY=H*0.72,topY=H*0.2;
function draw(){const t=(performance.now()-t0)/1000;bg(t,AC);brand();
// floor + note markers
x.strokeStyle=hexa('#ffffff',0.12);x.lineWidth=2;x.beginPath();x.moveTo(40,floorY);x.lineTo(W-40,floorY);x.stroke();
let seg=0;while(seg<ON.length-1&&t>=ON[seg+1])seg++;
for(let i=0;i<ON.length;i++){const flash=Math.max(0,1-(t-ON[i])/0.35);if(t<ON[i]-0.02&&flash<=0){}x.fillStyle=hexa(AC,0.18+0.7*Math.max(0,flash));rr(XS[i]-26,floorY-6,52,12,6);x.fill();}
// ball position
let bx,by;if(t<ON[0]){bx=XS[0];by=topY;}else if(seg>=ON.length-1){bx=XS[XS.length-1];by=floorY-16;}
else{const t0s=ON[seg],t1s=ON[seg+1],T=t1s-t0s,tt=(t-t0s)/T;const peak=Math.min(floorY-topY,(floorY-topY)*Math.min(1,T*1.4));by=floorY-16-4*peak*tt*(1-tt);bx=XS[seg]+(XS[seg+1]-XS[seg])*tt;}
// trail
x.fillStyle=hexa(AC,0.25);x.beginPath();x.arc(bx,by,26,0,7);x.fill();
x.shadowColor=hexa(AC,0.9);x.shadowBlur=24;x.fillStyle='#fff';x.beginPath();x.arc(bx,by,16,0,7);x.fill();x.shadowBlur=0;
x.fillStyle=hexa(AC,0.9);x.beginPath();x.arc(bx,by,16,0,7);x.stroke?0:0;
prog(t,SEC,AC);requestAnimationFrame(draw);}window.__ready=true;draw();</script>`

async function recordCanvas(browser, html, seconds, tmp) {
  const rdir = join(tmp, 'r'); mkdirSync(rdir, { recursive: true }); writeFileSync(join(rdir, 'i.html'), html)
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: join(tmp, 'v'), size: { width: W, height: H } } })
  const page = await ctx.newPage()
  await page.goto('file://' + join(rdir, 'i.html'), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(seconds * 1000 + 400)
  const v = page.video(); await ctx.close(); return v ? await v.path() : null
}

// build the bounce onsets/xs from a MIDI song (melodic track, deduped)
function bounceData(cfprojName, seconds, startBeat = 0) {
  const cf = JSON.parse(readFileSync(`${D}/${cfprojName}.cfproj`, 'utf8'))
  const sd = songVideoData(cf.dawProject, { startBeat })
  const spb = 60 / (sd.tempo || 120)
  const counts = {}; for (const n of sd.notes) counts[n.tr] = (counts[n.tr] || 0) + 1
  const lead = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(e => +e[0]).find(tr => counts[tr] > 6) ?? 0
  let ev = sd.notes.filter(n => n.tr === lead).map(n => ({ s: n.s * spb, p: n.p })).sort((a, b) => a.s - b.s)
  const merged = []; for (const e of ev) { if (!merged.length || e.s - merged[merged.length - 1].s > 0.14) merged.push(e) }
  const win = merged.filter(e => e.s <= seconds)
  const ps = win.map(e => e.p), lo = Math.min(...ps), hi = Math.max(...ps)
  const onsets = win.map(e => +e.s.toFixed(3))
  const xs = win.map(e => Math.round(120 + (hi === lo ? 0.5 : (e.p - lo) / (hi - lo)) * (W - 240)))
  return { onsets, xs }
}

const FH = 'ai-filtered-house-43770-1786843840300'
const bd = bounceData(FH, 18)
const ITEMS = [
  { name: 'Radial Visualizer', kind: 'format', format: 'radial', song: 'EDM EL__full-mix.mp3', start: 0, seconds: 18, accent: '#a78bfa', hook: [{ text: 'wait for the' }, { text: 'drop 🔊', accent: true }] },
  { name: 'Kinetic Text Hook', kind: 'canvas', html: () => textCard([{ text: 'i let an AI', at: 0.8 }, { text: 'make this beat.', at: 1.5 }, { text: 'it took', at: 4.3 }, { text: '12 seconds. 🔊', at: 5.0, accent: true }], '#38bdf8', 15), song: 'EDM EL__full-mix.mp3', start: 0, seconds: 15, accent: '#38bdf8' },
  { name: 'Falling Notes', kind: 'format', format: 'falling-notes', cfproj: FH, song: `${FH}.mp3`, start: 0, seconds: 18, accent: '#34d399', hook: [{ text: 'watch it' }, { text: 'get played 🎹', accent: true }] },
  { name: 'Stem Builder', kind: 'format', format: 'stems', cfproj: FH, song: `${FH}.mp3`, start: 0, seconds: 18, accent: '#f59e0b', hook: [{ text: 'the layers' }, { text: 'stack up 🎚️', accent: true }] },
  { name: 'Bouncing Ball', kind: 'canvas', html: () => bounce(bd.onsets, bd.xs, '#22d3ee', 18), song: `${FH}.mp3`, start: 0, seconds: 18, accent: '#22d3ee' },
  { name: 'Fake iMessage', kind: 'canvas', html: () => fakeIMsg('producer friend 💬', [
    { text: 'yo send me that beat', at: 0.6 }, { me: true, text: 'which one', at: 2.2 }, { text: 'the fire one from ur story', at: 3.6 },
    { me: true, text: 'ngl an AI made it 😭', at: 6.0 }, { text: 'in how long', at: 8.0 }, { me: true, text: '12 seconds', at: 9.6 }, { text: 'delete this app 💀', at: 11.4 }], '#3b82f6', 14),
    song: 'Hybrid House__full-mix.mp3', start: 8, seconds: 14, accent: '#3b82f6' },
  { name: 'Vinyl Spin', kind: 'canvas', html: () => vinyl('Dusk', '#f472b6', 16), song: 'Dusk (lofi master).mp3', start: 10, seconds: 16, accent: '#f472b6' },
  { name: 'Tier List', kind: 'canvas', html: () => tierList('ranking AI genres 🎧',
    [{ k: 'S', c: '#ef4444' }, { k: 'A', c: '#f59e0b' }, { k: 'B', c: '#eab308' }, { k: 'C', c: '#22c55e' }],
    [{ label: 'EDM', tier: 0, w: 130, tx: 285, ty: 305, at: 1.2 }, { label: 'Synthwave', tier: 0, w: 220, tx: 470, ty: 305, at: 2.6 }, { label: 'House', tier: 1, w: 150, tx: 295, ty: 455, at: 4.0 }, { label: 'Lofi', tier: 1, w: 120, tx: 470, ty: 455, at: 5.4 }, { label: 'Orchestral', tier: 2, w: 230, tx: 330, ty: 605, at: 6.8 }], '#a78bfa', 15),
    song: 'ai-synthwave-5011-1786226222457.mp3', start: 8, seconds: 15, accent: '#a78bfa' },
]

// folder: "Tests" nested in "Shorts"
await sql`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
await sql`ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_id TEXT`
const sh = await sql`SELECT id FROM folders WHERE user_id=${USER} AND name='Shorts' ORDER BY created_at DESC LIMIT 1`
const parentId = sh[0]?.id ?? null
const folderId = randomUUID()
await sql`INSERT INTO folders (id, user_id, name, parent_id) VALUES (${folderId}, ${USER}, 'Tests', ${parentId})`
console.log(`folder created: Tests (inside Shorts=${parentId})`)

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
let made = 0
for (const it of ITEMS) {
  const tmp = mkdtempSync(join(tmpdir(), 'test-'))
  try {
    const srcMp3 = `${D}/${it.song}`
    process.stdout.write(`▸ ${it.name}… `)
    let videoPath
    if (it.kind === 'canvas') videoPath = await recordCanvas(browser, it.html(), it.seconds, tmp)
    else {
      let songData
      if (it.cfproj) songData = songVideoData(JSON.parse(readFileSync(`${D}/${it.cfproj}.cfproj`, 'utf8')).dawProject, { startBeat: 0 })
      else songData = { tempo: 120, keyLabel: '', tracks: [{ name: 'Mix', color: it.accent }], notes: [], loopBeats: Math.round(it.seconds * 2) }
      const wavPath = join(tmp, 'a.wav'); execFileSync('ffmpeg', ['-y', '-ss', String(it.start), '-t', String(it.seconds), '-i', srcMp3, wavPath], { stdio: 'ignore' })
      const r = await recordFormatVideo(browser, { wavBuf: readFileSync(wavPath), songData, format: it.format, meta: 'MADE IN 100LIGHTS', hook: it.hook, seconds: it.seconds, root: ROOT, tmpDir: tmp, accent: it.accent })
      videoPath = r.videoPath
    }
    if (!videoPath) throw new Error('no video')
    const muxed = join(tmp, 'out.mp4')
    execFileSync('ffmpeg', ['-y', '-i', videoPath, '-ss', String(it.start), '-t', String(it.seconds), '-i', srcMp3, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', muxed], { stdio: 'ignore' })
    const vidId = randomUUID(), vidKey = `${USER}/${vidId}.mp4`
    await put(vidKey, readFileSync(muxed), 'video/mp4')
    await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at) VALUES (${vidId}, ${USER}, ${it.name}, 'video/mp4', ${it.seconds}, ${vidKey}, NULL, NOW()) ON CONFLICT (id) DO NOTHING`
    const projId = randomUUID()
    const data = { _type: '100lights-project', version: 1, id: projId, name: it.name, userId: USER, aspect: '9:16', audioMode: 'music', modules: ['video'],
      media: [{ id: vidId, name: it.name, r2Key: vidKey, duration: it.seconds, contentType: 'video' }],
      tracks: [{ id: 'v1', label: 'Video', type: 'media', height: 64 }],
      clips: [{ id: randomUUID(), color: it.accent, label: it.name, inPoint: 0, outPoint: it.seconds, startTime: 0, trackId: 'v1', mediaRefId: vidId, contentType: 'video', captions: [] }],
      outputs: [], captions: [], chapters: [], beatGrid: null, zoomLevel: 1, adjustments: {}, savedAt: new Date().toISOString() }
    const slug = it.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '-' + projId.slice(0, 6)
    await sql`INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data, folder_id) VALUES (${projId}, ${USER}, ${it.name}, ${slug}, 'braedancampbell', NOW(), ${JSON.stringify(data)}::jsonb, ${folderId})`
    made++; console.log('✓')
  } catch (e) { console.log(`✗ ${e.message}`) }
  finally { rmSync(tmp, { recursive: true, force: true }) }
}
await browser.close()
console.log(`\nDone — ${made}/${ITEMS.length} test shorts in "Shorts › Tests".`)
