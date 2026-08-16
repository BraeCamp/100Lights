// Rebuild + update two Tests shorts in place:
//  • Bouncing Ball — was going static (onsets ran out); now bounces on a continuous beat grid for the
//    FULL duration and loops cleanly.
//  • Vinyl Spin — was too symmetric to read as spinning; now has rotating tick marks + an orbiting
//    marker + a fixed specular glare so the rotation is obvious.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { songVideoData } from '../lib/song-video/from-project.mjs'

const env = {}
for (const l of readFileSync('/Users/brae/100lights/.env.local', 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
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

// VINYL v2 — obvious rotation: rotating ticks + orbiting marker + title-on-label + fixed glare
const vinyl = (title, AC, SEC) => HEAD + `const AC=${JSON.stringify(AC)},SEC=${SEC},TITLE=${JSON.stringify(title)};
function draw(){const t=(performance.now()-t0)/1000;bg(t,AC);brand();const cx=W/2,cy=H*0.44,R=W*0.36,rot=t*3.4;
x.save();x.translate(cx,cy);
x.beginPath();x.arc(0,0,R,0,7);x.fillStyle='#0c0c11';x.fill();
for(let r=R*0.40;r<R;r+=9){x.beginPath();x.arc(0,0,r,0,7);x.strokeStyle=hexa('#ffffff',0.045);x.lineWidth=1;x.stroke();}
x.save();x.rotate(rot);
// rotating tick marks near the rim (these make the spin obvious)
for(let k=0;k<12;k++){const a=k*Math.PI/6;x.strokeStyle=hexa(AC,k%3===0?0.9:0.35);x.lineWidth=k%3===0?5:3;x.beginPath();x.moveTo(Math.cos(a)*R*0.86,Math.sin(a)*R*0.86);x.lineTo(Math.cos(a)*R*0.97,Math.sin(a)*R*0.97);x.stroke();}
// label + title text on it (rotates → clearly spinning)
x.beginPath();x.arc(0,0,R*0.34,0,7);x.fillStyle=AC;x.fill();
x.fillStyle='#0a0812';x.font='800 26px system-ui,Arial';x.textAlign='center';x.fillText(TITLE,0,-R*0.14);
x.beginPath();x.arc(0,0,7,0,7);x.fillStyle='#0a0812';x.fill();
// orbiting bright marker
x.beginPath();x.arc(R*0.62,0,9,0,7);x.fillStyle='#ffffff';x.shadowColor=hexa(AC,0.9);x.shadowBlur=16;x.fill();x.shadowBlur=0;
x.restore();
// fixed specular glare (does NOT rotate) — the contrast sells the motion
const gg=x.createLinearGradient(-R,-R,R,R);gg.addColorStop(0,'rgba(255,255,255,0.14)');gg.addColorStop(0.5,'rgba(255,255,255,0)');
x.beginPath();x.arc(0,0,R,0,7);x.fillStyle=gg;x.fill();
x.restore();
x.beginPath();x.arc(cx,cy,R,0,7);x.strokeStyle=hexa(AC,0.5);x.lineWidth=3;x.stroke();
x.textAlign='center';x.fillStyle=hexa('#ece9fd',0.85);x.font='600 26px ui-monospace,monospace';x.fillText('NOW SPINNING',W/2,cy+R+96);
prog(t,SEC,AC);requestAnimationFrame(draw);}window.__ready=true;draw();</script>`

// BOUNCING BALL v2 — continuous beat-grid bounces, full duration, loops
const bounce = (onsets, xs, AC, SEC) => HEAD + `const ON=${JSON.stringify(onsets)},XS=${JSON.stringify(xs)},AC=${JSON.stringify(AC)},SEC=${SEC};
const floorY=H*0.72,topY=H*0.24;
function draw(){const t=(performance.now()-t0)/1000;bg(t,AC);brand();
x.strokeStyle=hexa('#ffffff',0.12);x.lineWidth=2;x.beginPath();x.moveTo(40,floorY);x.lineTo(W-40,floorY);x.stroke();
let seg=0;while(seg<ON.length-1&&t>=ON[seg+1])seg++;
for(let i=0;i<ON.length;i++){const fl=Math.max(0,1-(t-ON[i])/0.32);x.fillStyle=hexa(AC,0.14+0.75*Math.max(0,fl));rr(XS[i]-28,floorY-6,56,12,6);x.fill();if(fl>0.05){x.strokeStyle=hexa(AC,0.10*fl);x.lineWidth=2;x.beginPath();x.moveTo(XS[i],floorY);x.lineTo(XS[i],floorY-260*fl);x.stroke();}}
let bx,by;const last=ON.length-1;
if(t<ON[0]){bx=XS[0];by=floorY-16;}
else if(seg>=last){const T=0.5,tt=Math.min(1,(t-ON[last])/T);by=floorY-16-4*(floorY-topY)*0.6*tt*(1-tt);bx=XS[last];}
else{const a=ON[seg],b2=ON[seg+1],T=b2-a,tt=(t-a)/T;const peak=(floorY-topY)*Math.min(1,T*1.6);by=floorY-16-4*peak*tt*(1-tt);bx=XS[seg]+(XS[seg+1]-XS[seg])*tt;}
x.fillStyle=hexa(AC,0.22);x.beginPath();x.arc(bx,by,28,0,7);x.fill();
x.shadowColor=hexa(AC,0.95);x.shadowBlur=26;x.fillStyle='#fff';x.beginPath();x.arc(bx,by,17,0,7);x.fill();x.shadowBlur=0;
prog(t,SEC,AC);requestAnimationFrame(draw);}window.__ready=true;draw();</script>`

// continuous beat-grid bounce data for the full window (melodic up-down x pattern)
function bounceGrid(seconds, tempo) {
  const spb = 60 / (tempo || 120), seq = [0, 0.22, 0.44, 0.66, 0.88, 0.66, 0.44, 0.22]
  const onsets = [], xs = []
  let i = 0
  for (let t = 0; t <= seconds - 0.05; t += spb) { onsets.push(+t.toFixed(3)); xs.push(Math.round(120 + (W - 240) * seq[i % seq.length])); i++ }
  onsets.push(+seconds.toFixed(3)); xs.push(xs[xs.length - 1]) // land on the end so it never freezes
  return { onsets, xs }
}

async function recordCanvas(browser, html, seconds, tmp) {
  const rdir = join(tmp, 'r'); mkdirSync(rdir, { recursive: true }); writeFileSync(join(rdir, 'i.html'), html)
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: join(tmp, 'v'), size: { width: W, height: H } } })
  const page = await ctx.newPage()
  await page.goto('file://' + join(rdir, 'i.html'), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(seconds * 1000 + 400)
  const v = page.video(); await ctx.close(); return v ? await v.path() : null
}

const FH = 'ai-filtered-house-43770-1786843840300'
const tempo = JSON.parse(readFileSync(`${D}/${FH}.cfproj`, 'utf8')).dawProject.tempo || 122
const bd = bounceGrid(18, tempo)

const JOBS = [
  { name: 'Bouncing Ball', song: `${FH}.mp3`, start: 24, seconds: 18, accent: '#22d3ee', html: bounce(bd.onsets, bd.xs, '#22d3ee', 18) },
  { name: 'Vinyl Spin', song: 'Dusk (lofi master).mp3', start: 10, seconds: 16, accent: '#f472b6', html: vinyl('Dusk', '#f472b6', 16) },
]

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
for (const j of JOBS) {
  const tmp = mkdtempSync(join(tmpdir(), 'upd-'))
  try {
    process.stdout.write(`▸ ${j.name}… `)
    const videoPath = await recordCanvas(browser, j.html, j.seconds, tmp)
    if (!videoPath) throw new Error('no video')
    const muxed = join(tmp, 'out.mp4')
    execFileSync('ffmpeg', ['-y', '-i', videoPath, '-ss', String(j.start), '-t', String(j.seconds), '-i', `${D}/${j.song}`, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-shortest', muxed], { stdio: 'ignore' })
    const rows = await sql`SELECT id, data FROM projects WHERE user_id=${USER} AND deleted_at IS NULL AND data->>'name'=${j.name} ORDER BY saved_at DESC LIMIT 1`
    if (!rows.length) throw new Error('project not found')
    const vidId = randomUUID(), vidKey = `${USER}/${vidId}.mp4`
    await put(vidKey, readFileSync(muxed), 'video/mp4')
    await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at) VALUES (${vidId}, ${USER}, ${j.name}, 'video/mp4', ${j.seconds}, ${vidKey}, NULL, NOW()) ON CONFLICT (id) DO NOTHING`
    const d = rows[0].data
    d.media = [{ id: vidId, name: j.name, r2Key: vidKey, duration: j.seconds, contentType: 'video' }]
    d.clips = [{ id: randomUUID(), color: j.accent, label: j.name, inPoint: 0, outPoint: j.seconds, startTime: 0, trackId: 'v1', mediaRefId: vidId, contentType: 'video', captions: [] }]
    d.savedAt = new Date().toISOString()
    await sql`UPDATE projects SET data=${JSON.stringify(d)}::jsonb, saved_at=NOW() WHERE id=${rows[0].id}`
    console.log('✓ updated')
  } catch (e) { console.log(`✗ ${e.message}`) }
  finally { rmSync(tmp, { recursive: true, force: true }) }
}
await browser.close()
console.log('\nDone — Bouncing Ball + Vinyl Spin rebuilt & updated in place.')
