// Reusable headless render helpers (extracted from scripts/generate-and-capture.mjs, unchanged logic).
// Lets any producer: open the studio on a project, bounce its audio, and render a song-video FORMAT
// (9:16, synced to that audio) — without the studio chrome. Needs a running dev server for the audio
// bounce (dev-only window.__daw* hooks); the FORMAT video render itself is self-contained (file://).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

// Load a project into a fresh studio page (full UI tier, onboarding dismissed).
export async function openStudio(context, url, project) {
  await context.addInitScript(() => { try { localStorage.setItem('100lights-ui-tier', 'full') } catch { /* private */ } })
  const page = await context.newPage()
  await page.goto(`${url}/new?modules=audio`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => typeof (window).__dawDispatch === 'function', null, { timeout: 30000 })
  await page.waitForTimeout(600)
  await page.evaluate(p => (window).__dawDispatch({ type: 'LOAD_PROJECT', project: p }), project)
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape').catch(() => {})
  return page
}

// Bounce [0, sliceBeats] of the project to a WAV (realtime). Returns { master(base64), sampleRate, durationSec }.
export async function bounceAudio(browser, url, project, sliceBeats) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await openStudio(ctx, url, project)
  const wav = await page.evaluate(async (endB) => {
    const r = await (window).__dawRenderWav({ startBeat: 0, endBeat: endB, tailSec: 0.5 })
    return r ? { master: r.master, sampleRate: r.sampleRate, durationSec: r.durationSec } : null
  }, sliceBeats)
  await ctx.close()
  return wav
}

// ── Offline audio analysis (so audio-reactive formats work in HEADLESS) ───────
// Headless Chromium runs WebAudio SILENT: a live AnalyserNode over a <media>
// element returns all-zeros, so waveform/eq-bars/radial draw nothing and the
// canvas comes out black. Instead we decode the mix in Node and precompute the
// exact bytes a real getByteFrequencyData/getByteTimeDomainData would return,
// one frame per FPS tick, then feed the engine a MOCK analyser + mock wall-clock
// media. No headless audio involved; the real mp3 is muxed back by the caller.

export function decodeWav(buf) {
  const str = (o, n) => buf.toString('ascii', o, o + n)
  if (str(0, 4) !== 'RIFF' || str(8, 4) !== 'WAVE') throw new Error('not a RIFF/WAVE file')
  let o = 12, fmt = null, dataOff = -1, dataLen = 0
  while (o + 8 <= buf.length) {
    const id = str(o, 4), sz = buf.readUInt32LE(o + 4)
    if (id === 'fmt ') fmt = { audioFormat: buf.readUInt16LE(o + 8), channels: buf.readUInt16LE(o + 10), sampleRate: buf.readUInt32LE(o + 12), bitsPerSample: buf.readUInt16LE(o + 22) }
    else if (id === 'data') { dataOff = o + 8; dataLen = Math.min(sz, buf.length - (o + 8)) }
    o += 8 + sz + (sz & 1)
  }
  if (!fmt || dataOff < 0) throw new Error('WAV missing fmt/data chunk')
  const { channels, sampleRate, bitsPerSample, audioFormat } = fmt
  const bytesPer = bitsPerSample / 8, nSamp = Math.floor(dataLen / (bytesPer * channels))
  const out = new Float32Array(nSamp)
  for (let i = 0; i < nSamp; i++) {
    let acc = 0
    for (let ch = 0; ch < channels; ch++) {
      const p = dataOff + (i * channels + ch) * bytesPer
      let v = 0
      if (audioFormat === 3 && bitsPerSample === 32) v = buf.readFloatLE(p)
      else if (bitsPerSample === 16) v = buf.readInt16LE(p) / 32768
      else if (bitsPerSample === 24) { let x = buf[p] | (buf[p + 1] << 8) | (buf[p + 2] << 16); if (x & 0x800000) x -= 0x1000000; v = x / 8388608 }
      else if (bitsPerSample === 32) v = buf.readInt32LE(p) / 2147483648
      else if (bitsPerSample === 8) v = (buf[p] - 128) / 128
      acc += v
    }
    out[i] = acc / channels
  }
  return { samples: out, sampleRate }
}

// In-place iterative radix-2 FFT (length must be a power of two).
function fft(re, im) {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { const tr = re[i]; re[i] = re[j]; re[j] = tr; const ti = im[i]; im[i] = im[j]; im[j] = ti }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let cwr = 1, cwi = 0
      for (let k = 0; k < len >> 1; k++) {
        const a = i + k, b = a + (len >> 1)
        const xr = re[b] * cwr - im[b] * cwi, xi = re[b] * cwi + im[b] * cwr
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi
        const ncwr = cwr * wr - cwi * wi; cwi = cwr * wi + cwi * wr; cwr = ncwr
      }
    }
  }
}

// Precompute { freq: Uint8[nF*FB], wave: Uint8[nF*N] } mirroring the byte output
// of a real fftSize-N analyser, one frame per (1/FPS)s over `seconds`.
export function analyzeFrames(samples, sampleRate, seconds, FPS, N) {
  const FB = N >> 1, nF = Math.ceil(seconds * FPS) + 2
  const freq = new Uint8Array(nF * FB), wave = new Uint8Array(nF * N)
  const hann = new Float64Array(N); for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1))
  const re = new Float64Array(N), im = new Float64Array(N)
  const minDb = -90, maxDb = -20
  for (let fr = 0; fr < nF; fr++) {
    const start = Math.round((fr / FPS) * sampleRate) - (N >> 1)
    for (let i = 0; i < N; i++) {
      const idx = start + i
      const s = (idx >= 0 && idx < samples.length) ? samples[idx] : 0
      let wv = 128 + Math.round(s * 127); wave[fr * N + i] = wv < 0 ? 0 : wv > 255 ? 255 : wv
      re[i] = s * hann[i]; im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < FB; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * (2 / N)
      const db = 20 * Math.log10(mag + 1e-9)
      let b = Math.round((db - minDb) / (maxDb - minDb) * 255)
      freq[fr * FB + k] = b < 0 ? 0 : b > 255 ? 255 : b
    }
  }
  return { FPS, N, FB, nF, freq, wave }
}

// Detect "drops" from the precomputed spectrum: low-band (bass/kick) energy per frame,
// smoothed, then rising edges where energy jumps hard from a quiet stretch into a loud
// sustained one. Returns drop times (seconds). Format-agnostic → drives a burst overlay.
export function detectDrops(A, seconds) {
  const { freq, FB, nF, FPS } = A
  const loBins = Math.max(4, Math.floor(FB * 0.10))     // low ~10% of bins = bass/kick
  const e = new Float64Array(nF)
  for (let fr = 0; fr < nF; fr++) { let s = 0; for (let k = 2; k < loBins; k++) s += freq[fr * FB + k]; e[fr] = s / (loBins - 2) / 255 }
  // short vs longer moving average → onset of sustained energy
  const drops = []
  const win = Math.round(FPS * 0.8)
  let lastDrop = -99
  for (let fr = win; fr < nF - FPS; fr++) {
    let before = 0, after = 0
    for (let k = 1; k <= win; k++) before += e[fr - k]
    for (let k = 0; k < win; k++) after += e[fr + k]
    before /= win; after /= win
    const t = fr / FPS
    // rise into a sustained-loud section (after ≥ 1.4× before), now loud, spaced ≥ 3s apart
    if (after > 0.33 && before > 0.02 && after > before * 1.4 && t - lastDrop > 3 && t < seconds - 1) { drops.push(+t.toFixed(2)); lastDrop = t }
  }
  return drops
}

// Render a song-video FORMAT to a (webm) video, 9:16, locked to the given audio. Inlines
// lib/song-video/{formats,engine}.mjs into a self-contained file:// page; a mock wall-clock
// media + precomputed mock analyser drive it (headless WebAudio is silent — see above).
export async function recordFormatVideo(browser, { wavBuf, songData, format, meta, hook, seconds, root, tmpDir, accent = '#a78bfa', dropBurst = false, bare = false }) {
  const rdir = join(tmpDir, 'render'); mkdirSync(rdir, { recursive: true })
  // Inline all three engine modules as one self-contained file:// script. CRUCIAL:
  // strip EVERY relative import — a leftover `import … from './backgrounds.mjs'`
  // is CORS-blocked under file:// and aborts the whole ES module → pure black frame.
  const strip = s => s
    .replace(/^\s*import\b[^\n]*from\s*'\.\/[^']*'[^\n]*$/gm, '')      // drop all relative imports
    .replace(/^export\s+(function|const|class|let|var)\b/gm, '$1')     // de-export declarations
    .replace(/^export\s*\{[^}]*\}[^\n]*$/gm, '')                       // drop `export { … }`
    .replace(/[^\x00-\x7F]/g, '')
  // Order matters: backgrounds + formats define what engine references.
  const backgrounds = strip(readFileSync(join(root, 'lib/song-video/backgrounds.mjs'), 'utf8'))
  const formats = strip(readFileSync(join(root, 'lib/song-video/formats.mjs'), 'utf8'))
  const engine = strip(readFileSync(join(root, 'lib/song-video/engine.mjs'), 'utf8'))
  const aj = o => JSON.stringify(o).replace(/[^\x00-\x7F]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))

  const FPS = 30, NFFT = 1024
  const { samples, sampleRate } = decodeWav(Buffer.isBuffer(wavBuf) ? wavBuf : Buffer.from(wavBuf))
  const A = analyzeFrames(samples, sampleRate, seconds, FPS, NFFT)
  const freqB64 = Buffer.from(A.freq).toString('base64'), waveB64 = Buffer.from(A.wave).toString('base64')
  const drops = dropBurst ? detectDrops(A, seconds) : []

  const html = `<style>*{margin:0}html,body{height:100%;background:#050409;overflow:hidden}canvas{position:absolute;inset:0;width:100vw;height:100vh;display:block}#burst{pointer-events:none}</style>
<canvas id=c></canvas><canvas id=burst></canvas>
<script type="module">
${backgrounds}
${formats}
${engine}
const SONG=${aj(songData)};
// Precomputed audio-reactive frames (headless WebAudio is silent, so we feed the
// engine a MOCK analyser built offline from the decoded mix + a wall-clock media).
const FPS=${FPS}, FB=${A.FB}, N=${A.N}, NF=${A.nF};
const FREQ=Uint8Array.from(atob("${freqB64}"),c=>c.charCodeAt(0));
const WAVE=Uint8Array.from(atob("${waveB64}"),c=>c.charCodeAt(0));
const fi=()=>{ let i=Math.round(media.currentTime*FPS); return i<0?0:i>=NF?NF-1:i; };
let _t0=performance.now();
const media={ get currentTime(){ return (performance.now()-_t0)/1000; }, set currentTime(v){ _t0=performance.now()-v*1000; }, play(){ return Promise.resolve(); }, pause(){}, duration:${seconds} };
const analyser={ fftSize:N, frequencyBinCount:FB,
  getByteFrequencyData(a){ const i=fi(); a.set(FREQ.subarray(i*FB,i*FB+FB)); },
  getByteTimeDomainData(a){ const i=fi(); a.set(WAVE.subarray(i*N,i*N+N)); } };
const inst=mountSongVideo(document.getElementById('c'),SONG,{format:${aj(format)},brand:${aj(bare ? '' : '100LIGHTS')},meta:${aj(bare ? '' : meta)},hook:${aj(bare ? [] : (hook || []))},accent:${aj(accent)},loopBeats:SONG.loopBeats,synth:false,media,analyser});
// ── DROP BURST overlay (extra payoff exactly on the drop) — its own canvas, same wall-clock ──
const DROPS=${aj(drops)}, ACC=${aj(accent)};
const bc=document.getElementById('burst'), W9=810, H9=1440; bc.width=W9; bc.height=H9; const bx=bc.getContext('2d');
const hx=(h,a)=>{const n=parseInt(h.slice(1),16);return 'rgba('+(n>>16&255)+','+(n>>8&255)+','+(n&255)+','+a+')';};
function burst(){ const t=media.currentTime; bx.clearRect(0,0,W9,H9);
  for(const d of DROPS){ const dt=t-d; if(dt<0||dt>1.1) continue; const p=dt/1.1, e=1-Math.pow(1-p,2);
    // expanding ring
    bx.globalCompositeOperation='lighter';
    bx.strokeStyle=hx(ACC,0.55*(1-p)); bx.lineWidth=14*(1-p)+2; bx.beginPath(); bx.arc(W9/2,H9*0.46,60+e*760,0,7); bx.stroke();
    bx.strokeStyle=hx('#ffffff',0.4*(1-p)); bx.lineWidth=6*(1-p)+1; bx.beginPath(); bx.arc(W9/2,H9*0.46,40+e*620,0,7); bx.stroke();
    // full-frame flash on impact
    if(dt<0.14){ bx.fillStyle=hx('#ffffff',0.22*(1-dt/0.14)); bx.fillRect(0,0,W9,H9); }
    // radiating particles
    for(let k=0;k<18;k++){ const a=k/18*Math.PI*2, r=e*(560+((k*53)%180)); bx.fillStyle=hx(ACC,0.7*(1-p)); bx.beginPath(); bx.arc(W9/2+Math.cos(a)*r, H9*0.46+Math.sin(a)*r, 7*(1-p)+2, 0, 7); bx.fill(); }
    bx.globalCompositeOperation='source-over';
  }
  requestAnimationFrame(burst);
}
inst.play(); burst(); window.__ready=true;
</script>`
  writeFileSync(join(rdir, 'render.html'), html)
  const W9 = 810, H9 = 1440
  const ctx = await browser.newContext({ viewport: { width: W9, height: H9 }, recordVideo: { dir: join(tmpDir, 'video'), size: { width: W9, height: H9 } } })
  const page = await ctx.newPage()
  await page.goto('file://' + join(rdir, 'render.html'), { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => (window).__ready === true, null, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(seconds * 1000 + 500)
  const v = page.video(); await ctx.close()
  return { videoPath: v ? await v.path() : null, w: W9, h: H9 }
}
