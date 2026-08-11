#!/usr/bin/env node
// Generate premium generative BACKGROUND IMAGES bundled with the app, so the Music
// Video background library shows real detailed images offline (not flat gradients)
// while the hosted nature-clip library fills in. Renders 1280x720 JPGs via canvas
// in a headless browser → public/bg/generative/<id>.jpg.
//
//   node scripts/gen-bg-images.mjs   (npm run bg:images)

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
  { id: 'sunset-haze', kind: 'mesh', colors: ['#f59e0b', '#f43f5e', '#7c3aed'] },
  { id: 'ocean-deep', kind: 'mesh', colors: ['#082f49', '#0e7490', '#22d3ee'] },
  { id: 'ember-glow', kind: 'mesh', colors: ['#7c2d12', '#f97316', '#fde047'] },
  { id: 'bokeh-lights', kind: 'bokeh', colors: ['#f472b6', '#a78bfa', '#22d3ee', '#fde047'] },
  { id: 'bokeh-warm', kind: 'bokeh', colors: ['#fb7185', '#fbbf24', '#f97316'] },
  { id: 'synthwave-grid', kind: 'grid', colors: ['#db2777', '#7c3aed', '#22d3ee'] },
  { id: 'particles-cyan', kind: 'particles', colors: ['#22d3ee', '#a78bfa', '#34d399'] },
  { id: 'waves-blue', kind: 'waves', colors: ['#0369a1', '#0ea5e9', '#38bdf8'] },
  { id: 'liquid-magma', kind: 'liquid', colors: ['#7c2d12', '#f97316', '#fde047'] },
  { id: 'starfield-deep', kind: 'starfield', colors: ['#4c1d95', '#db2777', '#22d3ee'] },
  { id: 'plasma-neon', kind: 'plasma', colors: ['#22d3ee', '#a855f7', '#f472b6'] },
  { id: 'plasma-sunset', kind: 'plasma', colors: ['#f59e0b', '#f43f5e', '#7c3aed'] },
  { id: 'mountains-dusk', kind: 'mountains', colors: ['#7c3aed', '#f472b6', '#fbbf24'] },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

for (const def of DEFS) {
  await page.setContent('<canvas id="c" width="1280" height="720"></canvas>')   // fresh canvas each time
  const dataUrl = await page.evaluate(({ id, kind, colors }) => {
    const W = 1280, H = 720
    const g = document.getElementById('c').getContext('2d')
    let s = 0; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) >>> 0
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
    const hexRgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
    const lerp = (a, b, t) => Math.round(a + (b - a) * t)
    const a2 = (a) => Math.round(a * 255).toString(16).padStart(2, '0')

    g.fillStyle = '#06060c'; g.fillRect(0, 0, W, H)

    if (kind === 'mesh') {
      g.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 7; i++) {
        const cx = rnd() * W, cy = rnd() * H, r = (0.35 + rnd() * 0.45) * W, col = colors[Math.floor(rnd() * colors.length)]
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r)
        rg.addColorStop(0, col + 'cc'); rg.addColorStop(0.5, col + '44'); rg.addColorStop(1, col + '00')
        g.fillStyle = rg; g.fillRect(0, 0, W, H)
      }
      g.globalCompositeOperation = 'source-over'
    } else if (kind === 'bokeh') {
      g.globalCompositeOperation = 'lighter'
      const bg = g.createRadialGradient(W / 2, H, 0, W / 2, H, W); bg.addColorStop(0, colors[0] + '33'); bg.addColorStop(1, '#06060c00')
      g.fillStyle = bg; g.fillRect(0, 0, W, H)
      for (let i = 0; i < 90; i++) {
        const cx = rnd() * W, cy = rnd() * H, r = 10 + rnd() * 110, col = colors[Math.floor(rnd() * colors.length)]
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, col + a2(0.05 + rnd() * 0.35)); rg.addColorStop(1, col + '00')
        g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill()
      }
      g.globalCompositeOperation = 'source-over'
    } else if (kind === 'grid') {
      const sky = g.createLinearGradient(0, 0, 0, H * 0.62); sky.addColorStop(0, '#0b0616'); sky.addColorStop(1, colors[1])
      g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.62)
      const sunR = 150, sx = W / 2, sy = H * 0.5
      const sun = g.createLinearGradient(0, sy - sunR, 0, sy + sunR); sun.addColorStop(0, colors[2]); sun.addColorStop(1, colors[0])
      g.save(); g.beginPath(); g.arc(sx, sy, sunR, 0, Math.PI * 2); g.clip(); g.fillStyle = sun; g.fillRect(0, 0, W, H)
      g.globalCompositeOperation = 'destination-out'
      for (let i = 0; i < 7; i++) { g.fillStyle = '#000'; g.fillRect(sx - sunR, sy - sunR * 0.3 + i * 22, sunR * 2, 8) }
      g.restore()
      const gg = g.createLinearGradient(0, H * 0.62, 0, H); gg.addColorStop(0, '#160a24'); gg.addColorStop(1, '#0b0616')
      g.fillStyle = gg; g.fillRect(0, H * 0.62, W, H * 0.38)
      g.strokeStyle = colors[0] + 'aa'; g.lineWidth = 1.5
      const hz = H * 0.62
      for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(W / 2 + i * 20, hz); g.lineTo(W / 2 + i * 220, H); g.stroke() }
      for (let i = 0; i < 14; i++) { const y = hz + Math.pow(i / 14, 2) * (H - hz); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
    } else if (kind === 'particles') {
      g.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 240; i++) {
        const cx = rnd() * W, cy = rnd() * H, r = (1 + rnd() * rnd() * 7) * 4, col = colors[Math.floor(rnd() * colors.length)]
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, col + a2(0.3 + rnd() * 0.7)); rg.addColorStop(1, col + '00')
        g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill()
      }
      g.globalCompositeOperation = 'source-over'
    } else if (kind === 'waves') {
      g.globalCompositeOperation = 'lighter'
      for (let L = 0; L < 5; L++) {
        const col = colors[L % colors.length], yBase = H * 0.2 + L * H * 0.16
        g.beginPath(); g.moveTo(0, H)
        for (let x = 0; x <= W; x += 20) { const y = yBase + Math.sin(x * 0.006 + L * 1.7) * 40 + Math.sin(x * 0.013 + L) * 18; g.lineTo(x, y) }
        g.lineTo(W, H); g.closePath()
        const grd = g.createLinearGradient(0, yBase - 60, 0, H); grd.addColorStop(0, col + 'aa'); grd.addColorStop(1, col + '11')
        g.fillStyle = grd; g.fill()
      }
      g.globalCompositeOperation = 'source-over'
    } else if (kind === 'liquid') {
      g.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 5; i++) {
        const cx = rnd() * W, cy = rnd() * H, r = (0.3 + rnd() * 0.4) * W, col = colors[Math.floor(rnd() * colors.length)]
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, col + 'ff'); rg.addColorStop(0.32, col + 'aa'); rg.addColorStop(1, col + '00')
        g.fillStyle = rg; g.fillRect(0, 0, W, H)
      }
      g.globalCompositeOperation = 'source-over'
    } else if (kind === 'starfield') {
      g.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 4; i++) { const cx = rnd() * W, cy = rnd() * H, r = (0.4 + rnd() * 0.4) * W, col = colors[Math.floor(rnd() * colors.length)]; const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r); rg.addColorStop(0, col + '55'); rg.addColorStop(1, col + '00'); g.fillStyle = rg; g.fillRect(0, 0, W, H) }
      g.globalCompositeOperation = 'source-over'
      for (let i = 0; i < 620; i++) { const x = rnd() * W, y = rnd() * H, a = rnd(); g.fillStyle = `rgba(255,255,255,${(0.2 + a * 0.8).toFixed(2)})`; const sz = a > 0.95 ? 2 : 1; g.fillRect(x, y, sz, sz) }
      g.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 14; i++) { const x = rnd() * W, y = rnd() * H; const rg = g.createRadialGradient(x, y, 0, x, y, 7); rg.addColorStop(0, '#ffffffcc'); rg.addColorStop(1, '#ffffff00'); g.fillStyle = rg; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill() }
      g.globalCompositeOperation = 'source-over'
    } else if (kind === 'plasma') {
      const img = g.createImageData(W, H), d = img.data
      const c = [hexRgb(colors[0]), hexRgb(colors[1]), hexRgb(colors[2 % colors.length])]
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const v = (Math.sin(x / 70) + Math.sin(y / 55) + Math.sin((x + y) / 90) + Math.sin(Math.sqrt((x - W / 2) ** 2 + (y - H / 2) ** 2) / 70)) / 4
        const t = (v + 1) / 2
        let r, gg, b
        if (t < 0.5) { const u = t * 2; r = lerp(c[0][0], c[1][0], u); gg = lerp(c[0][1], c[1][1], u); b = lerp(c[0][2], c[1][2], u) }
        else { const u = (t - 0.5) * 2; r = lerp(c[1][0], c[2][0], u); gg = lerp(c[1][1], c[2][1], u); b = lerp(c[1][2], c[2][2], u) }
        const i = (y * W + x) * 4; d[i] = r; d[i + 1] = gg; d[i + 2] = b; d[i + 3] = 255
      }
      g.putImageData(img, 0, 0)
    } else if (kind === 'mountains') {
      const sky = g.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, colors[0]); sky.addColorStop(0.55, colors[1]); sky.addColorStop(1, '#120a1e')
      g.fillStyle = sky; g.fillRect(0, 0, W, H)
      const sg = g.createRadialGradient(W * 0.72, H * 0.32, 0, W * 0.72, H * 0.32, 95); sg.addColorStop(0, colors[2] + 'ee'); sg.addColorStop(1, colors[2] + '00')
      g.fillStyle = sg; g.beginPath(); g.arc(W * 0.72, H * 0.32, 95, 0, Math.PI * 2); g.fill()
      for (let i = 0; i < 130; i++) { const x = rnd() * W, y = rnd() * H * 0.45; g.fillStyle = `rgba(255,255,255,${(0.15 + rnd() * 0.6).toFixed(2)})`; g.fillRect(x, y, 1, 1) }
      for (let L = 0; L < 4; L++) {
        const baseY = H * 0.5 + L * H * 0.11
        g.beginPath(); g.moveTo(0, H); g.lineTo(0, baseY)
        // Step past W and clamp so the ridge reaches the exact right edge (no seam).
        for (let x = 0; x <= W + 36; x += 36) { const xx = Math.min(x, W); const y = baseY - Math.sin(xx * 0.007 + L * 2.1) * (28 + L * 22) - rnd() * 12; g.lineTo(xx, y) }
        g.lineTo(W, H); g.closePath()
        g.fillStyle = `rgba(10,7,20,${(0.42 + L * 0.17).toFixed(2)})`; g.fill()
      }
    }

    // grain for texture
    g.globalAlpha = 0.05
    for (let i = 0; i < 2600; i++) { g.fillStyle = rnd() > 0.5 ? '#fff' : '#000'; g.fillRect(rnd() * W, rnd() * H, 1, 1) }
    g.globalAlpha = 1
    // vignette
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75); vg.addColorStop(0, '#00000000'); vg.addColorStop(1, '#000000aa')
    g.fillStyle = vg; g.fillRect(0, 0, W, H)

    return document.getElementById('c').toDataURL('image/jpeg', 0.86)
  }, def)

  writeFileSync(join(OUT, `${def.id}.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log(`  ✓ ${def.id}`)
}

await browser.close()
console.log(`\n✓ ${DEFS.length} background images → public/bg/generative/<id>.jpg`)
