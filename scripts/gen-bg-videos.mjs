#!/usr/bin/env node
// Animated backgrounds for the Music Video library — seamless-looping WebM clips rendered
// with canvas + MediaRecorder in a headless browser. Two families:
//   • generative (public/bg/generative/) — abstract motion; posters come from gen-bg-images.
//   • nature (public/bg/nature/) — themed motion for the Aerial/Beach/Mountains/Animals/City
//     categories, PLUS a poster JPG (frame 0) so nothing falls back to a flat colour. These
//     are stylised, not drone footage — real footage can override them via NEXT_PUBLIC_BG_CDN.
//
//   node scripts/gen-bg-videos.mjs   (npm run bg:videos)

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUB = join(ROOT, 'public', 'bg')
mkdirSync(join(PUB, 'generative'), { recursive: true })
mkdirSync(join(PUB, 'nature'), { recursive: true })

const GEN = [
  { id: 'nebula-violet', kind: 'mesh', colors: ['#4c1d95', '#db2777', '#22d3ee'] },
  { id: 'aurora-teal', kind: 'mesh', colors: ['#0ea5e9', '#34d399', '#a78bfa'] },
  { id: 'ocean-deep', kind: 'mesh', colors: ['#082f49', '#0e7490', '#22d3ee'] },
  { id: 'ember-glow', kind: 'mesh', colors: ['#7c2d12', '#f97316', '#fde047'] },
  { id: 'bokeh-lights', kind: 'bokeh', colors: ['#f472b6', '#a78bfa', '#22d3ee', '#fde047'] },
  { id: 'particles-cyan', kind: 'particles', colors: ['#22d3ee', '#a78bfa', '#34d399'] },
  { id: 'waves-blue', kind: 'waves', colors: ['#0369a1', '#0ea5e9', '#38bdf8'] },
  { id: 'liquid-magma', kind: 'liquid', colors: ['#7c2d12', '#f97316', '#fde047'] },
  { id: 'starfield-deep', kind: 'starfield', colors: ['#4c1d95', '#db2777', '#22d3ee'] },
].map(d => ({ ...d, dir: 'generative', poster: false }))

// Themed motion for each nature clip in bg-library. Poster JPG written for every one.
const NATURE = [
  { id: 'aerial-coastline', kind: 'waves', colors: ['#0e7490', '#22d3ee', '#67e8f9'] },
  { id: 'aerial-forest', kind: 'mesh', colors: ['#065f46', '#10b981', '#34d399'] },
  { id: 'aerial-desert', kind: 'waves', colors: ['#b45309', '#f59e0b', '#fcd34d'] },
  { id: 'beach-waves', kind: 'waves', colors: ['#0369a1', '#0ea5e9', '#7dd3fc'] },
  { id: 'beach-sunset', kind: 'waves', colors: ['#c2410c', '#f59e0b', '#fb7185'] },
  { id: 'mountains-peaks', kind: 'peaks', colors: ['#1e293b', '#475569', '#cbd5e1'] },
  { id: 'mountains-valley', kind: 'peaks', colors: ['#0f2440', '#3b5573', '#a8c3e0'] },
  { id: 'animals-birds', kind: 'particles', colors: ['#0c4a6e', '#38bdf8', '#e0f2fe'] },
  { id: 'animals-jellyfish', kind: 'liquid', colors: ['#4c1d95', '#a855f7', '#f0abfc'] },
  { id: 'city-night', kind: 'bokeh', colors: ['#111827', '#a78bfa', '#f472b6', '#22d3ee'] },
  { id: 'city-timelapse', kind: 'bokeh', colors: ['#7c2d12', '#f97316', '#fbbf24', '#f472b6'] },
  { id: 'street-golden', kind: 'bokeh', colors: ['#7c2d12', '#f59e0b', '#fbbf24'] },
  { id: 'street-crosswalk', kind: 'particles', colors: ['#334155', '#94a3b8', '#e2e8f0'] },
  { id: 'street-cafe', kind: 'bokeh', colors: ['#7c2d12', '#d97706', '#fde68a'] },
  { id: 'night-streetlamps', kind: 'bokeh', colors: ['#111827', '#f59e0b', '#fbbf24'] },
  { id: 'night-neon', kind: 'bokeh', colors: ['#0b1020', '#f472b6', '#22d3ee'] },
  { id: 'night-rain-neon', kind: 'waves', colors: ['#0b1020', '#7c3aed', '#22d3ee'] },
  { id: 'night-aurora', kind: 'mesh', colors: ['#052e2b', '#10b981', '#a78bfa'] },
  { id: 'cozy-rain-window', kind: 'particles', colors: ['#1e293b', '#38bdf8', '#cbd5e1'] },
  { id: 'cozy-fireplace', kind: 'liquid', colors: ['#3b1106', '#b45309', '#fbbf24'] },
  { id: 'cozy-coffee', kind: 'mesh', colors: ['#3b2415', '#7c5c3b', '#d6b48a'] },
  { id: 'nature-sunbeams', kind: 'mesh', colors: ['#14532d', '#65a30d', '#fde047'] },
  { id: 'nature-flowers', kind: 'mesh', colors: ['#be185d', '#84cc16', '#fde047'] },
  { id: 'nature-clouds', kind: 'mesh', colors: ['#1e3a8a', '#60a5fa', '#e0f2fe'] },
  { id: 'nature-underwater', kind: 'liquid', colors: ['#083344', '#0e7490', '#67e8f9'] },
].map(d => ({ ...d, dir: 'nature', poster: true }))

// Optional id filter: `node scripts/gen-bg-videos.mjs street-golden night-neon` renders just
// those (handy so re-running for new clips doesn't overwrite fetched real posters).
const only = process.argv.slice(2)
const ALL = [...GEN, ...NATURE].filter(d => !only.length || only.includes(d.id))
const W = 960, H = 540, SECONDS = 6

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H } })
const page = await ctx.newPage()

for (const def of ALL) {
  await page.setContent(`<canvas id="c" width="${W}" height="${H}"></canvas>`)
  const out = await page.evaluate(async ({ id, kind, colors, poster, W, H, seconds }) => {
    const cv = document.getElementById('c'); const g = cv.getContext('2d')
    let s = 0; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) >>> 0
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    const a2 = (a) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
    const pick = () => colors[Math.floor(rnd() * colors.length)]
    const TAU = Math.PI * 2

    // Pre-generate stable params so only positions/alphas animate frame to frame.
    const blobs = Array.from({ length: kind === 'liquid' ? 5 : 7 }, () => ({ bx: rnd() * W, by: rnd() * H, dr: 20 + rnd() * 70, r: (0.3 + rnd() * 0.45) * W, col: pick(), off: rnd() * TAU }))
    const circles = Array.from({ length: 70 }, () => ({ x: rnd() * W, y: rnd() * H, r: 10 + rnd() * 90, col: pick(), off: rnd() * TAU }))
    const parts = Array.from({ length: 200 }, () => ({ x: rnd() * W, y: rnd() * H, r: (1 + rnd() * rnd() * 6) * 3, col: pick(), off: rnd() * TAU, bob: 8 + rnd() * 26 }))
    const stars = Array.from({ length: 620 }, () => ({ x: rnd() * W, y: rnd() * H, ba: 0.2 + rnd() * 0.8, off: rnd() * TAU, big: rnd() > 0.96 }))
    const nebs = Array.from({ length: 4 }, () => ({ bx: rnd() * W, by: rnd() * H, dr: 30 + rnd() * 40, r: (0.4 + rnd() * 0.4) * W, col: pick(), off: rnd() * TAU }))
    const ridges = Array.from({ length: 4 }, () => ({ pts: Array.from({ length: 10 }, () => rnd()) }))

    const vignette = () => { const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); vg.addColorStop(0, '#00000000'); vg.addColorStop(1, '#000000aa'); g.fillStyle = vg; g.fillRect(0, 0, W, H) }

    function frame(t) {
      const ph = TAU * ((t % seconds) / seconds)
      g.globalCompositeOperation = 'source-over'; g.fillStyle = '#06060c'; g.fillRect(0, 0, W, H)
      if (kind === 'mesh' || kind === 'liquid') {
        g.globalCompositeOperation = 'lighter'
        for (const b of blobs) {
          const cx = b.bx + Math.cos(ph + b.off) * b.dr, cy = b.by + Math.sin(ph + b.off) * b.dr
          const rg = g.createRadialGradient(cx, cy, 0, cx, cy, b.r)
          if (kind === 'liquid') { rg.addColorStop(0, b.col + 'ff'); rg.addColorStop(0.32, b.col + 'aa'); rg.addColorStop(1, b.col + '00') }
          else { rg.addColorStop(0, b.col + 'cc'); rg.addColorStop(0.5, b.col + '44'); rg.addColorStop(1, b.col + '00') }
          g.fillStyle = rg; g.fillRect(0, 0, W, H)
        }
      } else if (kind === 'bokeh') {
        g.globalCompositeOperation = 'lighter'
        for (const c of circles) {
          const r = c.r * (0.82 + 0.18 * Math.sin(ph + c.off)), al = 0.06 + 0.28 * (0.5 + 0.5 * Math.sin(ph * 1.3 + c.off))
          const rg = g.createRadialGradient(c.x, c.y, 0, c.x, c.y, r); rg.addColorStop(0, c.col + a2(al)); rg.addColorStop(1, c.col + '00')
          g.fillStyle = rg; g.beginPath(); g.arc(c.x, c.y, r, 0, TAU); g.fill()
        }
      } else if (kind === 'particles') {
        g.globalCompositeOperation = 'lighter'
        for (const p of parts) {
          const y = p.y + Math.sin(ph + p.off) * p.bob, al = 0.3 + 0.6 * (0.5 + 0.5 * Math.sin(ph * 2 + p.off))
          const rg = g.createRadialGradient(p.x, y, 0, p.x, y, p.r); rg.addColorStop(0, p.col + a2(al)); rg.addColorStop(1, p.col + '00')
          g.fillStyle = rg; g.beginPath(); g.arc(p.x, y, p.r, 0, TAU); g.fill()
        }
      } else if (kind === 'waves') {
        g.globalCompositeOperation = 'lighter'
        for (let L = 0; L < 5; L++) {
          const col = colors[L % colors.length], yBase = H * 0.2 + L * H * 0.16
          g.beginPath(); g.moveTo(0, H)
          for (let x = 0; x <= W; x += 16) { const y = yBase + Math.sin(x * 0.006 + ph + L * 1.7) * 40 + Math.sin(x * 0.013 + ph * 0.7 + L) * 18; g.lineTo(x, y) }
          g.lineTo(W, H); g.closePath()
          const grd = g.createLinearGradient(0, yBase - 60, 0, H); grd.addColorStop(0, col + 'aa'); grd.addColorStop(1, col + '11')
          g.fillStyle = grd; g.fill()
        }
      } else if (kind === 'peaks') {
        // Layered mountain silhouettes (far→light, near→dark) with drifting mist bands.
        const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, colors[0]); sky.addColorStop(1, colors[1])
        g.fillStyle = sky; g.fillRect(0, 0, W, H)
        for (let L = 0; L < ridges.length; L++) {
          const rg = ridges[L], yBase = H * 0.4 + L * H * 0.15, amp = H * (0.18 - L * 0.02), segs = rg.pts.length - 1
          g.beginPath(); g.moveTo(0, H)
          for (let x = 0; x <= W; x += 12) { const u = (x / W) * segs, lo = Math.floor(u), hi = Math.min(segs, lo + 1), v = rg.pts[lo] + (rg.pts[hi] - rg.pts[lo]) * (u - lo); g.lineTo(x, yBase - v * amp) }
          g.lineTo(W, H); g.closePath()
          g.fillStyle = [colors[2], colors[1], colors[1], colors[0]][L] + 'ee'; g.fill()
        }
        g.globalCompositeOperation = 'lighter'
        for (let m = 0; m < 3; m++) { const my = H * 0.5 + m * H * 0.13 + Math.sin(ph + m * 1.6) * 10; const grd = g.createLinearGradient(0, my - 34, 0, my + 34); grd.addColorStop(0, colors[2] + '00'); grd.addColorStop(0.5, colors[2] + '44'); grd.addColorStop(1, colors[2] + '00'); g.fillStyle = grd; g.fillRect(0, my - 34, W, 68) }
      } else if (kind === 'starfield') {
        g.globalCompositeOperation = 'lighter'
        for (const nb of nebs) { const cx = nb.bx + Math.cos(ph * 0.5 + nb.off) * nb.dr, cy = nb.by + Math.sin(ph * 0.5 + nb.off) * nb.dr; const rg = g.createRadialGradient(cx, cy, 0, cx, cy, nb.r); rg.addColorStop(0, nb.col + '55'); rg.addColorStop(1, nb.col + '00'); g.fillStyle = rg; g.fillRect(0, 0, W, H) }
        g.globalCompositeOperation = 'source-over'
        for (const st of stars) { const al = st.ba * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(ph * 2 + st.off))); g.fillStyle = `rgba(255,255,255,${al.toFixed(2)})`; g.fillRect(st.x, st.y, st.big ? 2 : 1, st.big ? 2 : 1) }
      }
      g.globalCompositeOperation = 'source-over'; vignette()
    }

    const stream = cv.captureStream(30)
    const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m)) || 'video/webm'
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_200_000 })
    const chunks = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    const done = new Promise(res => { rec.onstop = res })
    frame(0); rec.start()
    const startT = performance.now()
    await new Promise(res => {
      const loop = () => { const t = (performance.now() - startT) / 1000; frame(t); if (t < seconds) requestAnimationFrame(loop); else { rec.stop(); res() } }
      requestAnimationFrame(loop)
    })
    await done
    const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer()
    const bytes = new Uint8Array(buf); let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    frame(0)   // repaint a clean first frame for the poster
    return { webm: btoa(bin), poster: poster ? cv.toDataURL('image/jpeg', 0.82).split(',')[1] : null }
  }, { ...def, W, H, seconds: SECONDS })

  writeFileSync(join(PUB, def.dir, `${def.id}.webm`), Buffer.from(out.webm, 'base64'))
  if (out.poster) writeFileSync(join(PUB, def.dir, `${def.id}.jpg`), Buffer.from(out.poster, 'base64'))
  console.log(`  ✓ ${def.dir}/${def.id}.webm${out.poster ? ' (+poster)' : ''}`)
}

await browser.close()
console.log(`\n✓ ${ALL.length} animated backgrounds rendered`)
