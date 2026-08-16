// Config-driven shorts builder. Single source of truth = scripts/shorts-config.json.
// Edit the words there, then:  node scripts/build-shorts.mjs <id ...|all>
//
// ★★ EDITABLE_CONTENT RULE (Brae, non-negotiable) ★★
// EVERY short is saved EDITABLE — NEVER bake audio into the video. Each project = a SILENT visual on a
// video track + the song as SEPARATE, editable audio clip(s) on an audio track (the music must stay
// fixable). The TIER LIST uses one audio clip PER GENRE (separate files, so each can be swapped/edited).
// Preview plays the audio via the editor's audio-layers; export mixes them (lib/video-export/audio-mix).
// If you ever change the save path, keep audio and visual SEPARATE. See the save section below + memory
// feedback-content-save-structure / project-100lights-video-audio-tracks.
import { chromium } from 'playwright'
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir, homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { neon } from '@neondatabase/serverless'
import { recordFormatVideo, decodeWav, analyzeFrames, detectDrops } from '../lib/song-video/headless.mjs'
import { songVideoData } from '../lib/song-video/from-project.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const env = {}
for (const l of readFileSync(join(ROOT, '.env.local'), 'utf8').split('\n')) { const m = l.match(/^([A-Z0-9_]+)=(.*)$/); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
const sql = neon(env.DATABASE_URL)
const s3 = new S3Client({ region: 'auto', endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY } })
const BUCKET = env.R2_BUCKET, USER = 'user_3FElUNjivSIJ9gZsJUKp1496n17'
const D = `${homedir()}/Desktop/100lights-ai-renders`, W = 810, H = 1440
const CFG = JSON.parse(readFileSync(join(ROOT, 'scripts/shorts-config.json'), 'utf8'))
const put = (key, body, ct) => s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: ct }))
const songFile = k => `${D}/${CFG.songs[k] || k}`
const cfprojFile = k => `${D}/${(CFG.songs[k] || k).replace(/\.mp3$/i, '')}.cfproj`  // song key → its .cfproj (strip .mp3)

const HEAD = `<style>*{margin:0}html,body{height:100%;background:#0a0812;overflow:hidden}canvas{width:100vw;height:100vh;display:block}</style><canvas id=c></canvas><script>
const W=${W},H=${H},c=document.getElementById('c');c.width=W;c.height=H;const x=c.getContext('2d');const t0=performance.now();
const hexa=(h,a)=>{const n=parseInt(h.slice(1),16);return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')';};
const brand=()=>{x.textAlign='left';x.fillStyle='#ece9fd';x.font='800 30px system-ui,Arial';x.fillText('100LIGHTS',48,84);x.font='600 14px ui-monospace,monospace';x.fillStyle=hexa('#ece9fd',0.5);x.fillText('MADE IN 100LIGHTS',48,110);};
const bg=(t,AC)=>{x.fillStyle='#0a0812';x.fillRect(0,0,W,H);const gx=W/2+Math.sin(t*0.3)*80,gy=H*0.42+Math.cos(t*0.23)*60,p=0.5+0.5*Math.sin(t*2.1);const g=x.createRadialGradient(gx,gy,0,gx,gy,W*0.95);g.addColorStop(0,hexa(AC,0.16+0.05*p));g.addColorStop(0.5,hexa(AC,0.04));g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,W,H);};
const prog=(t,SEC,AC)=>{x.fillStyle=hexa('#ffffff',0.12);x.fillRect(48,H-64,W-96,4);x.fillStyle=AC;x.fillRect(48,H-64,(W-96)*Math.min(1,t/SEC),4);};
const rr=(X,Y,w,h,r)=>{x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();};`

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

// tier list — chips now animate into their assigned TIER ROW (fixes the disconnected list)
const tierList = (heading, tiers, chips, AC, SEC) => HEAD + `const TI=${JSON.stringify(tiers)},CH=${JSON.stringify(chips)},AC=${JSON.stringify(AC)},SEC=${SEC},HEAD2=${JSON.stringify(heading)};
const rowH=150,topY=240,rx=210,slots={};
CH.forEach(ch=>{slots[ch.tier]=(slots[ch.tier]||0);ch._slot=slots[ch.tier]++;});
function chipXY(ch){const ry=topY+ch.tier*rowH+(rowH-16)/2;const cols=CH.filter(c=>c.tier===ch.tier).length;const areaX=rx+10,areaW=W-rx-55;const cx=areaX+areaW*((ch._slot+0.5)/cols);return{cx,cy:ry};}
function draw(){const t=(performance.now()-t0)/1000;bg(t,AC);brand();
x.textAlign='center';x.fillStyle='#fff';x.font='800 44px system-ui,Arial';x.fillText(HEAD2,W/2,185);
for(let i=0;i<TI.length;i++){const ry=topY+i*rowH;x.fillStyle=hexa(TI[i].c,0.9);rr(60,ry,120,rowH-16,16);x.fill();x.fillStyle='#0a0812';x.font='800 54px system-ui,Arial';x.textAlign='center';x.fillText(TI[i].k,120,ry+(rowH-16)/2+18);x.fillStyle=hexa('#ffffff',0.05);rr(rx-15,ry,W-rx-45,rowH-16,16);x.fill();}
for(const ch of CH){const p=Math.max(0,Math.min(1,(t-ch.at)/0.55)),e=1-Math.pow(1-p,3);if(p<=0)continue;const d=chipXY(ch),sx=W/2,sy=H-70,cx=sx+(d.cx-sx)*e,cy=sy+(d.cy-sy)*e,w=Math.min(230,x.measureText(ch.label).width+50);x.globalAlpha=Math.min(1,p*1.6);
const land=Math.max(0,1-(t-(ch.at+0.55))/0.25);x.save();x.translate(cx,cy);x.scale(1+0.12*Math.max(0,land),1+0.12*Math.max(0,land));x.fillStyle=hexa(AC,0.92);rr(-w/2,-30,w,60,14);x.fill();x.fillStyle='#0a0812';x.font='800 30px system-ui,Arial';x.textAlign='center';x.fillText(ch.label,0,11);x.restore();x.globalAlpha=1;}
prog(t,SEC,AC);requestAnimationFrame(draw);}window.__ready=true;draw();</script>`

const vinyl = (label, caption, AC, SEC) => HEAD + `const AC=${JSON.stringify(AC)},SEC=${SEC},TITLE=${JSON.stringify(label)},CAP=${JSON.stringify(caption)};
function draw(){const t=(performance.now()-t0)/1000;bg(t,AC);brand();const cx=W/2,cy=H*0.44,R=W*0.36,rot=t*3.4;
x.save();x.translate(cx,cy);
x.beginPath();x.arc(0,0,R,0,7);x.fillStyle='#0c0c11';x.fill();
for(let r=R*0.40;r<R;r+=9){x.beginPath();x.arc(0,0,r,0,7);x.strokeStyle=hexa('#ffffff',0.045);x.lineWidth=1;x.stroke();}
x.save();x.rotate(rot);
for(let k=0;k<12;k++){const a=k*Math.PI/6;x.strokeStyle=hexa(AC,k%3===0?0.9:0.35);x.lineWidth=k%3===0?5:3;x.beginPath();x.moveTo(Math.cos(a)*R*0.86,Math.sin(a)*R*0.86);x.lineTo(Math.cos(a)*R*0.97,Math.sin(a)*R*0.97);x.stroke();}
x.beginPath();x.arc(0,0,R*0.34,0,7);x.fillStyle=AC;x.fill();x.fillStyle='#0a0812';x.font='800 26px system-ui,Arial';x.textAlign='center';x.fillText(TITLE,0,-R*0.14);
x.beginPath();x.arc(0,0,7,0,7);x.fillStyle='#0a0812';x.fill();
x.beginPath();x.arc(R*0.62,0,9,0,7);x.fillStyle='#ffffff';x.shadowColor=hexa(AC,0.9);x.shadowBlur=16;x.fill();x.shadowBlur=0;
x.restore();
const gg=x.createLinearGradient(-R,-R,R,R);gg.addColorStop(0,'rgba(255,255,255,0.14)');gg.addColorStop(0.5,'rgba(255,255,255,0)');x.beginPath();x.arc(0,0,R,0,7);x.fillStyle=gg;x.fill();
x.restore();
x.beginPath();x.arc(cx,cy,R,0,7);x.strokeStyle=hexa(AC,0.5);x.lineWidth=3;x.stroke();
x.textAlign='center';x.fillStyle=hexa('#ece9fd',0.85);x.font='600 26px ui-monospace,monospace';x.fillText(CAP,W/2,cy+R+96);
prog(t,SEC,AC);requestAnimationFrame(draw);}window.__ready=true;draw();</script>`

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

// Auto best-section: analyze the song (first 90s) and pick the most compelling `seconds`-window to
// open on — the first DROP (so it hits ~1.5s in), else the highest-energy sustained window. Returns
// the start second. Reuses the offline spectrum analysis from headless.mjs.
function bestSectionStart(mp3, seconds, tmp) {
  const wav = join(tmp, 'best.wav')
  execFileSync('ffmpeg', ['-y', '-t', '90', '-i', mp3, '-ac', '1', '-ar', '22050', wav], { stdio: 'ignore' })
  const { samples, sampleRate } = decodeWav(readFileSync(wav))
  const dur = samples.length / sampleRate
  const A = analyzeFrames(samples, sampleRate, dur, 30, 1024)
  const drops = detectDrops(A, dur)
  if (drops.length) return Math.max(0, +(drops[0] - 1.5).toFixed(2))       // the drop lands ~1.5s in
  // else: slide a `seconds` window over broadband energy, pick the loudest window
  const { freq, FB, nF } = A, hiBin = Math.max(8, Math.floor(FB * 0.5))
  const per = new Float64Array(nF)
  for (let fr = 0; fr < nF; fr++) { let s = 0; for (let k = 2; k < hiBin; k++) s += freq[fr * FB + k]; per[fr] = s }
  const winF = Math.round(seconds * 30)
  let best = 0, bestSum = -1
  for (let fr = 0; fr + winF < nF; fr += 15) { let s = 0; for (let j = 0; j < winF; j++) s += per[fr + j]; if (s > bestSum) { bestSum = s; best = fr } }
  return +(best / 30).toFixed(2)
}

// Snap [start, seconds] to whole bars so a cut loops cleanly (start on a downbeat, N bars long).
function barAlign(start, seconds, tempo) {
  const bar = 4 * 60 / (tempo || 122)
  const s = Math.max(0, Math.round(start / bar) * bar)
  const n = Math.max(1, Math.round(seconds / bar))
  return { start: +s.toFixed(3), seconds: +(n * bar).toFixed(3), bars: n }
}

// Tier montage: a snippet of each chip's genre song plays across that chip's window
// (chip[i].at → chip[i+1].at). Contiguous segments concat into one timeline WAV.
function buildMontage(chips, seconds, tmp) {
  const segs = chips.map((ch, i) => ({ song: ch.song, from: i === 0 ? 0 : ch.at, to: i < chips.length - 1 ? chips[i + 1].at : seconds }))
  const parts = []
  segs.forEach((s, i) => {
    const dur = +(s.to - s.from).toFixed(3)
    if (dur <= 0.05 || !s.song) return
    const p = join(tmp, `seg${i}.wav`)
    // pull from a catchy offset (8s) with tiny fades to avoid clicks at the hard cut
    execFileSync('ffmpeg', ['-y', '-ss', '8', '-t', String(dur), '-i', songFile(s.song),
      '-af', `afade=t=in:st=0:d=0.02,afade=t=out:st=${Math.max(0, dur - 0.05)}:d=0.05`, '-ar', '44100', '-ac', '2', p], { stdio: 'ignore' })
    parts.push(p)
  })
  const list = join(tmp, 'mlist.txt'); writeFileSync(list, parts.map(p => `file '${p}'`).join('\n'))
  const out = join(tmp, 'montage.wav')
  execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', list, '-ar', '44100', '-ac', '2', out], { stdio: 'ignore' })
  return out
}

// Real footage (Pexels/local mp4) as the background + 100LIGHTS chrome overlay, in one pass.
// Footage is inlined as a data: URL so the file:// page plays it without a CORS-blocked fetch.
function videoBg(sc, AC, SEC) {
  const footageDataUrl = `data:video/mp4;base64,${readFileSync(`${D}/${sc.footage}`).toString('base64')}`
  return `<style>*{margin:0}html,body{height:100%;background:#000;overflow:hidden}#v,#c{position:absolute;inset:0;width:100vw;height:100vh}#v{object-fit:cover}</style>
<video id=v muted playsinline></video><canvas id=c></canvas>
<script>
const W=${W},H=${H},c=document.getElementById('c');c.width=W;c.height=H;const x=c.getContext('2d');
const AC=${JSON.stringify(AC)},SEC=${SEC},LABEL=${JSON.stringify(sc.label || '')},CAP=${JSON.stringify(sc.caption2 || 'NOW SPINNING')},CRED=${JSON.stringify(sc.credit || '')};
const hexa=(h,a)=>{const n=parseInt(h.slice(1),16);return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')';};
const rr=(X,Y,w,h,r)=>{x.beginPath();x.moveTo(X+r,Y);x.arcTo(X+w,Y,X+w,Y+h,r);x.arcTo(X+w,Y+h,X,Y+h,r);x.arcTo(X,Y+h,X,Y,r);x.arcTo(X,Y,X+w,Y,r);x.closePath();};
const v=document.getElementById('v'); v.src=${JSON.stringify(footageDataUrl)}; let t0=0;
function draw(){const t=t0?(performance.now()-t0)/1000:0;x.clearRect(0,0,W,H);
let g=x.createLinearGradient(0,0,0,220);g.addColorStop(0,'rgba(0,0,0,0.55)');g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,W,220);
g=x.createLinearGradient(0,H-360,0,H);g.addColorStop(0,'rgba(0,0,0,0)');g.addColorStop(1,'rgba(0,0,0,0.75)');x.fillStyle=g;x.fillRect(0,H-360,W,360);
g=x.createRadialGradient(W/2,H*0.42,0,W/2,H*0.42,W);g.addColorStop(0,hexa(AC,0.05));g.addColorStop(1,'rgba(0,0,0,0)');x.fillStyle=g;x.fillRect(0,0,W,H);
x.textAlign='left';x.fillStyle='#fff';x.font='800 30px system-ui,Arial';x.fillText('100LIGHTS',48,84);
x.font='600 14px ui-monospace,monospace';x.fillStyle=hexa('#ffffff',0.7);x.fillText('MADE IN 100LIGHTS',48,110);
x.fillStyle=hexa('#ffffff',0.82);x.font='600 24px ui-monospace,monospace';x.fillText(CAP,48,H-150);
x.fillStyle=AC;x.font='800 64px system-ui,Arial';x.fillText(LABEL,48,H-92);
x.fillStyle=AC;rr(48,H-232,64,6,3);x.fill();
if(CRED){x.textAlign='right';x.fillStyle=hexa('#ffffff',0.5);x.font='500 15px system-ui,Arial';x.fillText(CRED,W-40,H-40);}
x.textAlign='left';x.fillStyle=hexa('#ffffff',0.18);rr(48,H-64,W-96,4,2);x.fill();
x.fillStyle=AC;rr(48,H-64,(W-96)*Math.min(1,t/SEC),4,2);x.fill();
requestAnimationFrame(draw);}
v.addEventListener('canplay',()=>{ v.play().then(()=>{ t0=performance.now(); window.__ready=true; }).catch(()=>{ t0=performance.now(); window.__ready=true; }); },{once:true});
v.load(); draw();
</script>`
}

function bounceGrid(seconds, tempo) {
  const spb = 60 / (tempo || 122), seq = [0, 0.22, 0.44, 0.66, 0.88, 0.66, 0.44, 0.22], onsets = [], xs = []
  let i = 0
  for (let t = 0; t <= seconds - 0.05; t += spb) { onsets.push(+t.toFixed(3)); xs.push(Math.round(120 + (W - 240) * seq[i % seq.length])); i++ }
  onsets.push(+seconds.toFixed(3)); xs.push(xs[xs.length - 1]); return { onsets, xs }
}
async function recordCanvas(browser, html, seconds, tmp) {
  const rdir = join(tmp, 'r'); mkdirSync(rdir, { recursive: true }); writeFileSync(join(rdir, 'i.html'), html)
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, recordVideo: { dir: join(tmp, 'v'), size: { width: W, height: H } } })
  const page = await ctx.newPage(); await page.goto('file://' + join(rdir, 'i.html'), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(seconds * 1000 + 400)
  const v = page.video(); await ctx.close(); return v ? await v.path() : null
}

async function ensureFolder(childName = CFG.folder.name) {
  await sql`CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  await sql`ALTER TABLE folders ADD COLUMN IF NOT EXISTS parent_id TEXT`
  const par = await sql`SELECT id FROM folders WHERE user_id=${USER} AND name=${CFG.folder.parent} ORDER BY created_at DESC LIMIT 1`
  const parentId = par[0]?.id ?? null
  let f = await sql`SELECT id FROM folders WHERE user_id=${USER} AND name=${childName} AND parent_id IS NOT DISTINCT FROM ${parentId} ORDER BY created_at DESC LIMIT 1`
  if (f.length) return f[0].id
  const id = randomUUID()
  await sql`INSERT INTO folders (id, user_id, name, parent_id) VALUES (${id}, ${USER}, ${childName}, ${parentId})`
  return id
}

// ── Auto-variant recipes: one song + genre → N DIFFERENT-concept shorts to A/B (auto best-section). ──
const cap = s => s.charAt(0).toUpperCase() + s.slice(1)
const GENRE_META = {
  edm:        { accents: ['#a78bfa', '#38bdf8', '#f472b6'], hook: ['wait for the', 'drop 🔊'], hook2: ['rate this drop', '1–10 🔥'], text: ['i let an AI', 'make this beat.', 'it took', '12 seconds. 🔊'], tags: '#edm #dropmix #aimusic #musicproducer #beatmaker' },
  house:      { accents: ['#34d399', '#fbbf24', '#a78bfa'], hook: ['POV: the perfect', 'house loop 🏠'], hook2: ['this house beat', 'is illegal 🔥'], text: ['i made a house', 'beat with AI 🏠', 'in one', 'prompt.'], tags: '#housemusic #aimusic #producer #beatmaker' },
  synthwave:  { accents: ['#f472b6', '#a78bfa', '#38bdf8'], hook: ['night drive', 'coded 🌃'], hook2: ['1985', 'called 🕹️'], text: ['an AI made', 'this synthwave 🌃', 'in', '12 seconds.'], tags: '#synthwave #retrowave #aimusic #producer' },
  lofi:       { accents: ['#f59e0b', '#818cf8', '#f472b6'], hook: ['lofi to', 'heal to 🌙'], hook2: ['the loop you', 'needed today'], text: ['lofi made', 'by an AI 🌙', 'to study', '& chill.'], tags: '#lofi #lofihiphop #studybeats #chillbeats' },
  orchestral: { accents: ['#a78bfa', '#ef4444', '#fbbf24'], hook: ['an AI wrote', 'this orchestra 🎻'], hook2: ["the villain's", 'theme 🎬'], text: ['an AI wrote', 'a whole', 'orchestra 🎻', 'listen.'], tags: '#orchestral #filmscore #aimusic #trailermusic' },
  default:    { accents: ['#a78bfa', '#38bdf8', '#f472b6'], hook: ['wait for', 'it 🔊'], hook2: ['rate this', '1–10'], text: ['made with AI', 'in 100Lights', 'in', 'seconds.'], tags: '#aimusic #musicproducer #beatmaker' },
}
const GENRE_NAME = { edm: 'EDM', house: 'House', synthwave: 'Synthwave', lofi: 'Lo-Fi', orchestral: 'Orchestral', default: 'Track' }
function variantsFor(songKey, genre, n) {
  const m = GENRE_META[genre] || GENRE_META.default
  const name = GENRE_NAME[genre] || cap(genre)
  const base = { song: songKey, seconds: 16, autoStart: true }
  const cap1 = `${m.hook.join(' ')} — made in 100Lights\n\n${m.tags}`
  const cap2 = `${m.text.join(' ')} 🤖 — made in 100Lights\n\n${m.tags}`
  const cap3 = `${m.hook2.join(' ')} — made in 100Lights\n\n${m.tags}`
  const templates = [
    { renderer: 'format', format: 'radial', dropBurst: true, hook: m.hook, accent: m.accents[0], title: `${name} — Drop (radial)`, caption: cap1 },
    { renderer: 'text', lines: m.text.map((t, i) => ({ text: t, at: +(0.7 + i * 0.9).toFixed(2), accent: i === m.text.length - 1 })), accent: m.accents[1], title: `${name} — Text hook`, caption: cap2 },
    { renderer: 'format', format: 'waveform', hook: m.hook2, accent: m.accents[2], title: `${name} — Waveform`, caption: cap3 },
  ]
  return templates.slice(0, Math.max(1, n)).map((t, i) => ({ id: `auto-${genre}-${i}`, ...base, ...t }))
}

async function buildOne(browser, folderId, sc) {
  const tmp = mkdtempSync(join(tmpdir(), 'bs-'))
  try {
    let seconds = sc.seconds, start = sc.start ?? 0
    const accent = sc.accent
    const srcMp3 = songFile(sc.song)
    // Auto best-section: pick the window automatically (the drop / loudest span) instead of `start`.
    // Skipped for cfproj/note formats (their notes are keyed from beat 0) and the video-bg renderer.
    if ((sc.autoStart || AUTO) && !sc.cfproj && sc.renderer !== 'video-bg' && sc.renderer !== 'bounce') {
      try { start = bestSectionStart(srcMp3, seconds, tmp); process.stdout.write(`[auto start ${start}s] `) } catch { /* keep configured start */ }
    }
    // Bar-align the window for loop-ready shorts (needs a known tempo → cfproj-based songs).
    let tempo = null
    if (sc.loop) {
      if (sc.cfproj) tempo = JSON.parse(readFileSync(cfprojFile(sc.cfproj), "utf8")).dawProject.tempo
      else if (sc.renderer === 'bounce') tempo = JSON.parse(readFileSync(cfprojFile("filtered_house"), "utf8")).dawProject.tempo
      if (tempo) { const a = barAlign(start, seconds, tempo); start = a.start; seconds = a.seconds }
    }
    const loops = sc.loop ? Math.max(1, sc.loops || 2) : 1
    process.stdout.write(`▸ ${sc.title}${sc.loop ? ` (loop×${loops}, bar-aligned ${seconds}s)` : ''}… `)
    let videoPath
    if (sc.renderer === 'format') {
      let songData
      if (sc.cfproj) songData = songVideoData(JSON.parse(readFileSync(cfprojFile(sc.cfproj), "utf8")).dawProject, { startBeat: 0 })
      else songData = { tempo: 120, keyLabel: '', tracks: [{ name: 'Mix', color: accent }], notes: [], loopBeats: Math.round(seconds * 2) }
      const wavPath = join(tmp, 'a.wav'); execFileSync('ffmpeg', ['-y', '-ss', String(start), '-t', String(seconds), '-i', srcMp3, wavPath], { stdio: 'ignore' })
      const hook = (sc.hook || []).map((t, i) => ({ text: t, accent: i === 1 }))
      const r = await recordFormatVideo(browser, { wavBuf: readFileSync(wavPath), songData, format: sc.format, meta: 'MADE IN 100LIGHTS', hook, seconds, root: ROOT, tmpDir: tmp, accent, dropBurst: !!sc.dropBurst })
      videoPath = r.videoPath
    } else if (sc.renderer === 'text') videoPath = await recordCanvas(browser, textCard(sc.lines, accent, seconds), seconds, tmp)
    else if (sc.renderer === 'imessage') videoPath = await recordCanvas(browser, fakeIMsg(sc.chatTitle, sc.messages, accent, seconds), seconds, tmp)
    else if (sc.renderer === 'tier') videoPath = await recordCanvas(browser, tierList(sc.heading, sc.tiers, sc.chips, accent, seconds), seconds, tmp)
    else if (sc.renderer === 'vinyl') videoPath = await recordCanvas(browser, vinyl(sc.label, sc.caption2 || 'NOW SPINNING', accent, seconds), seconds, tmp)
    else if (sc.renderer === 'video-bg') videoPath = await recordCanvas(browser, videoBg(sc, accent, seconds), seconds, tmp)
    else if (sc.renderer === 'bounce') {
      const tempo = JSON.parse(readFileSync(cfprojFile("filtered_house"), "utf8")).dawProject.tempo || 122
      const bd = bounceGrid(seconds, tempo); videoPath = await recordCanvas(browser, bounce(bd.onsets, bd.xs, accent, seconds), seconds, tmp)
    } else throw new Error(`unknown renderer ${sc.renderer}`)
    if (!videoPath) throw new Error('no video')

    // ── EDITABLE OUTPUT (see EDITABLE_CONTENT at top) — NEVER bake audio into the video. The project is
    // saved as a SILENT visual on a video track + the song as SEPARATE, editable audio clip(s) on an
    // audio track. Tier list gets one audio clip PER GENRE (separate files). Preview plays them via the
    // editor's audio-layers; export mixes them (lib/video-export/audio-mix). ──────────────────────────
    const useMontage = sc.renderer === 'tier' && Array.isArray(sc.chips) && sc.chips.some(c => c.song)
    const finalDur = +(seconds * loops).toFixed(2)

    // 1) Silent visual (the recording is already audio-less; re-encode clean, loop if this is a loop short).
    let visual = join(tmp, 'visual.mp4')
    execFileSync('ffmpeg', ['-y', '-i', videoPath, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', visual], { stdio: 'ignore' })
    if (loops > 1) { const lp = join(tmp, 'visual-loop.mp4'); execFileSync('ffmpeg', ['-y', '-stream_loop', String(loops - 1), '-i', visual, '-c', 'copy', lp], { stdio: 'ignore' }); visual = lp }

    // 2) Audio clip specs {file, startTime, dur, label}: tier → one snippet per genre; else the song
    //    segment (placed `loops` times for loop shorts, all referencing one uploaded file).
    const audioSpecs = []
    if (useMontage) {
      const segs = sc.chips.map((ch, i) => ({ song: ch.song, label: ch.label, from: i === 0 ? 0 : ch.at, to: i < sc.chips.length - 1 ? sc.chips[i + 1].at : seconds }))
      segs.forEach((s, i) => {
        const dur = +(s.to - s.from).toFixed(3); if (dur <= 0.05 || !s.song) return
        const f = join(tmp, `aud${i}.mp3`)
        execFileSync('ffmpeg', ['-y', '-ss', '8', '-t', String(dur), '-i', songFile(s.song), '-c:a', 'libmp3lame', '-q:a', '3', f], { stdio: 'ignore' })
        audioSpecs.push({ file: f, startTime: +s.from.toFixed(3), dur, label: s.label })
      })
    } else {
      const f = join(tmp, 'audio.mp3')
      execFileSync('ffmpeg', ['-y', '-ss', String(start), '-t', String(seconds), '-i', srcMp3, '-c:a', 'libmp3lame', '-q:a', '3', f], { stdio: 'ignore' })
      for (let k = 0; k < loops; k++) audioSpecs.push({ file: f, startTime: +(k * seconds).toFixed(3), dur: seconds, label: sc.song })
    }

    // 3) Upload the visual + each unique audio file; register them in the media library.
    const vidId = randomUUID(), vidKey = `${USER}/${vidId}.mp4`
    await put(vidKey, readFileSync(visual), 'video/mp4')
    await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at) VALUES (${vidId}, ${USER}, ${sc.title + ' (visual)'}, 'video/mp4', ${finalDur}, ${vidKey}, NULL, NOW()) ON CONFLICT (id) DO NOTHING`
    const media = [{ id: vidId, name: `${sc.title} (visual)`, r2Key: vidKey, duration: finalDur, contentType: 'video' }]
    const fileMedia = new Map()
    for (const a of audioSpecs) {
      if (fileMedia.has(a.file)) continue
      const aid = randomUUID(), akey = `${USER}/${aid}.mp3`, aname = `${sc.title} — ${a.label}`
      await put(akey, readFileSync(a.file), 'audio/mpeg')
      await sql`INSERT INTO user_media (id, user_id, name, content_type, duration, r2_key, thumbnail, created_at) VALUES (${aid}, ${USER}, ${aname}, 'audio/mpeg', ${a.dur}, ${akey}, NULL, NOW()) ON CONFLICT (id) DO NOTHING`
      fileMedia.set(a.file, aid)
      media.push({ id: aid, name: aname, r2Key: akey, duration: a.dur, contentType: 'audio' })
    }

    // 4) Editable project: a Video track (silent visual) + an Audio track (the song clip(s)).
    const tracks = [
      { id: 'v1', label: 'Video', type: 'media', height: 64 },
      { id: 'a1', label: 'Audio', type: 'audio', height: 56, volume: 1 },
    ]
    const clips = [{ id: randomUUID(), color: accent, label: sc.title, inPoint: 0, outPoint: finalDur, startTime: 0, trackId: 'v1', mediaRefId: vidId, contentType: 'video', captions: [] }]
    for (const a of audioSpecs) clips.push({ id: randomUUID(), color: '#34d399', label: a.label, inPoint: 0, outPoint: a.dur, startTime: a.startTime, trackId: 'a1', mediaRefId: fileMedia.get(a.file), contentType: 'audio', captions: [] })

    const existing = await sql`SELECT id, data FROM projects WHERE user_id=${USER} AND deleted_at IS NULL AND folder_id=${folderId} AND data->>'name'=${sc.title} ORDER BY saved_at DESC LIMIT 1`
    if (existing.length) {
      const d = existing[0].data; d.media = media; d.clips = clips; d.tracks = tracks; d.postCaption = sc.caption || ''; d.savedAt = new Date().toISOString()
      await sql`UPDATE projects SET data=${JSON.stringify(d)}::jsonb, saved_at=NOW() WHERE id=${existing[0].id}`
      console.log(`✓ updated (editable: 1 video + ${audioSpecs.length} audio)`)
    } else {
      const projId = randomUUID()
      const data = { _type: '100lights-project', version: 1, id: projId, name: sc.title, userId: USER, aspect: '9:16', audioMode: 'music', modules: ['video'], media, tracks, clips, outputs: [], captions: [], chapters: [], beatGrid: null, zoomLevel: 1, adjustments: {}, postCaption: sc.caption || '', savedAt: new Date().toISOString() }
      const slug = sc.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) + '-' + projId.slice(0, 6)
      await sql`INSERT INTO projects (id, user_id, name, slug, owner_username, saved_at, data, folder_id) VALUES (${projId}, ${USER}, ${sc.title}, ${slug}, 'braedancampbell', NOW(), ${JSON.stringify(data)}::jsonb, ${folderId})`
      console.log(`✓ created (editable: 1 video + ${audioSpecs.length} audio)`)
    }
  } catch (e) { console.log(`✗ ${e.message}`) }
  finally { rmSync(tmp, { recursive: true, force: true }) }
}

const argv = process.argv.slice(2)
const flag = (name, def) => { const a = argv.find(x => x.startsWith(`--${name}=`)); return a ? a.split('=').slice(1).join('=') : def }
// eslint-disable-next-line no-var
var AUTO = argv.includes('--auto')                    // force auto best-section for every targeted short

// ── Variants mode: node build-shorts.mjs --variants --song=<key> --genre=<g> [--n=3] [--folder=Auto] ──
if (argv.includes('--variants')) {
  const songKey = flag('song')
  const genre = (flag('genre') || 'default').toLowerCase()
  const n = parseInt(flag('n', '3'), 10) || 3
  const folderName = flag('folder', 'Auto')
  if (!songKey) { console.error('--variants needs --song=<key from shorts-config.songs, or a filename>'); process.exit(1) }
  const variants = variantsFor(songKey, genre, n)
  const folderId = await ensureFolder(folderName)
  console.log(`Auto-variants: ${variants.length} ${genre} shorts from "${songKey}" → "${CFG.folder.parent} › ${folderName}" (auto best-section)`)
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  for (const sc of variants) await buildOne(browser, folderId, sc)
  await browser.close()
  console.log(`\nDone — ${variants.length} variant(s) built.`)
} else {
  const ids = argv.filter(a => !a.startsWith('--'))
  const want = ids.length && ids[0] !== 'all' ? new Set(ids) : null
  const targets = CFG.shorts.filter(s => !want || want.has(s.id))
  if (!targets.length) { console.error('no matching shorts. ids:', CFG.shorts.map(s => s.id).join(', ')); process.exit(1) }
  const folderName = flag('folder', CFG.folder.name)          // --folder=<name> to build into a custom folder
  const folderId = await ensureFolder(folderName)
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
  for (const sc of targets) await buildOne(browser, folderId, sc)
  await browser.close()
  console.log(`\nDone — ${targets.length} short(s) built/updated in "${CFG.folder.parent} › ${folderName}"${AUTO ? ' (auto best-section)' : ''}.`)
}
