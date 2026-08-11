#!/usr/bin/env node
// Animated versions of the generative backgrounds — seamless-looping WebM clips so
// the Music Video library has real MOTION backgrounds bundled and offline (the static
// JPGs from gen-bg-images become their posters). Renders each with canvas + MediaRecorder
// in a headless browser → public/bg/generative/<id>.webm.
//
//   node scripts/gen-bg-videos.mjs   (npm run bg:videos)

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'bg', 'generative')
mkdirSync(OUT, { recursive: true })

const DEFS = [
  { id: 'nebula-violet', kind: 'mesh', colors: ['#4c1d95', '#db2777', '#22d3ee'] },
  { id: 'aurora-teal', kind: 'mesh', colors: ['#0ea5e9', '#34d399', '#a78bfa'] },
  { id: 'ocean-deep', kind: 'mesh', colors: ['#082f49', '#0e7490', '#22d3ee'] },
  { id: 'ember-glow', kind: 'mesh', colors: ['#7c2d12', '#f97316', '#fde047'] },
  { id: 'bokeh-lights', kind: 'bokeh', colors: ['#f472b6', '#a78bfa', '#22d3ee', '#fde047'] },
  { id: 'particles-cyan', kind: 'particles', colors: ['#22d3ee', '#a78bfa', '#34d399'] },
  { id: 'waves-blue', kind: 'waves', colors: ['#0369a1', '#0ea5e9', '#38bdf8'] },
  { id: 'liquid-magma', kind: 'liquid', colors: ['#7c2d12', '#f97316', '#fde047'] },
  { id: 'starfield-deep', kind: 'starfield', colors: ['#4c1d95', '#db2777', '#22d3ee'] },
]

const W = 960, H = 540, SECONDS = 6

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: W, height: H } })
const page = await ctx.newPage()

for (const def of DEFS) {
  await page.setContent(`<canvas id="c" width="${W}" height="${H}"></canvas>`)
  const b64 = await page.evaluate(async ({ id, kind, colors, W, H, seconds }) => {
    const cv = document.getElementById('c'); const g = cv.getContext('2d')
    let s = 0; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) >>> 0
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    const a2 = (a) => Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')
    const pick = () => colors[Math.floor(rnd() * colors.length)]
    const TAU = Math.PI * 2

    // Pre-generate stable params so only positions/alphas animate.
    const blobs = Array.from({ length: kind === 'liquid' ? 5 : 7 }, () => ({ bx: rnd() * W, by: rnd() * H, dr: 20 + rnd() * 70, r: (0.3 + rnd() * 0.45) * W, col: pick(), off: rnd() * TAU }))
    const circles = Array.from({ length: 70 }, () => ({ x: rnd() * W, y: rnd() * H, r: 10 + rnd() * 90, col: pick(), off: rnd() * TAU }))
    const parts = Array.from({ length: 200 }, () => ({ x: rnd() * W, y: rnd() * H, r: (1 + rnd() * rnd() * 6) * 3, col: pick(), off: rnd() * TAU, bob: 8 + rnd() * 26 }))
    const stars = Array.from({ length: 620 }, () => ({ x: rnd() * W, y: rnd() * H, ba: 0.2 + rnd() * 0.8, off: rnd() * TAU, big: rnd() > 0.96 }))
    const nebs = Array.from({ length: 4 }, () => ({ bx: rnd() * W, by: rnd() * H, dr: 30 + rnd() * 40, r: (0.4 + rnd() * 0.4) * W, col: pick(), off: rnd() * TAU }))

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
      } else if (kind === 'starfield') {
        g.globalCompositeOperation = 'lighter'
        for (const n of nebs) { const cx = n.bx + Math.cos(ph * 0.5 + n.off) * n.dr, cy = n.by + Math.sin(ph * 0.5 + n.off) * n.dr; const rg = g.createRadialGradient(cx, cy, 0, cx, cy, n.r); rg.addColorStop(0, n.col + '55'); rg.addColorStop(1, n.col + '00'); g.fillStyle = rg; g.fillRect(0, 0, W, H) }
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
    return btoa(bin)
  }, { ...def, W, H, seconds: SECONDS })

  writeFileSync(join(OUT, `${def.id}.webm`), Buffer.from(b64, 'base64'))
  console.log(`  ✓ ${def.id}.webm`)
}

await browser.close()
console.log(`\n✓ ${DEFS.length} animated backgrounds → public/bg/generative/<id>.webm`)
