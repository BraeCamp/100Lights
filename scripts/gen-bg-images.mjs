#!/usr/bin/env node
// Generate premium generative BACKGROUND IMAGES bundled with the app, so the Music
// Video background library shows real detailed images offline (not flat gradients)
// while the hosted nature-clip library fills in. Renders 1280x720 JPGs via canvas
// in a headless browser → public/bg/generative/<id>.jpg.
//
//   node scripts/gen-bg-images.mjs

import { chromium } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'bg', 'generative')
mkdirSync(OUT, { recursive: true })

// id → { kind, colors }. kind picks the generator.
const DEFS = [
  { id: 'nebula-violet', kind: 'mesh', colors: ['#4c1d95', '#db2777', '#22d3ee'] },
  { id: 'aurora-teal', kind: 'mesh', colors: ['#0ea5e9', '#34d399', '#a78bfa'] },
  { id: 'sunset-haze', kind: 'mesh', colors: ['#f59e0b', '#f43f5e', '#7c3aed'] },
  { id: 'ocean-deep', kind: 'mesh', colors: ['#082f49', '#0e7490', '#22d3ee'] },
  { id: 'ember-glow', kind: 'mesh', colors: ['#7c2d12', '#f97316', '#fde047'] },
  { id: 'bokeh-lights', kind: 'bokeh', colors: ['#f472b6', '#a78bfa', '#22d3ee', '#fde047'] },
  { id: 'bokeh-warm', kind: 'bokeh', colors: ['#fb7185', '#fbbf24', '#f97316'] },
  { id: 'synthwave-grid', kind: 'grid', colors: ['#db2777', '#7c3aed', '#22d3ee'] },
]

const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

for (const def of DEFS) {
  await page.setContent('<canvas id="c" width="1280" height="720"></canvas>')   // fresh canvas each time
  const dataUrl = await page.evaluate(({ id, kind, colors }) => {
    const W = 1280, H = 720
    const cv = document.getElementById('c')
    const g = cv.getContext('2d')
    // seeded RNG so results are stable
    let s = 0; for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) >>> 0
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }

    g.fillStyle = '#06060c'; g.fillRect(0, 0, W, H)

    if (kind === 'mesh') {
      g.globalCompositeOperation = 'lighter'
      for (let i = 0; i < 7; i++) {
        const cx = rnd() * W, cy = rnd() * H, r = (0.35 + rnd() * 0.45) * W
        const col = colors[Math.floor(rnd() * colors.length)]
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r)
        rg.addColorStop(0, col + 'cc'); rg.addColorStop(0.5, col + '44'); rg.addColorStop(1, col + '00')
        g.fillStyle = rg; g.fillRect(0, 0, W, H)
      }
      g.globalCompositeOperation = 'source-over'
    } else if (kind === 'bokeh') {
      g.globalCompositeOperation = 'lighter'
      // soft base glow
      const bg = g.createRadialGradient(W / 2, H, 0, W / 2, H, W)
      bg.addColorStop(0, colors[0] + '33'); bg.addColorStop(1, '#06060c00')
      g.fillStyle = bg; g.fillRect(0, 0, W, H)
      for (let i = 0; i < 90; i++) {
        const cx = rnd() * W, cy = rnd() * H, r = 10 + rnd() * 110
        const col = colors[Math.floor(rnd() * colors.length)]
        const rg = g.createRadialGradient(cx, cy, 0, cx, cy, r)
        const a = 0.05 + rnd() * 0.35
        rg.addColorStop(0, col + Math.round(a * 255).toString(16).padStart(2, '0'))
        rg.addColorStop(1, col + '00')
        g.fillStyle = rg; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill()
      }
      g.globalCompositeOperation = 'source-over'
    } else if (kind === 'grid') {
      // synthwave sky
      const sky = g.createLinearGradient(0, 0, 0, H * 0.62)
      sky.addColorStop(0, '#0b0616'); sky.addColorStop(1, colors[1])
      g.fillStyle = sky; g.fillRect(0, 0, W, H * 0.62)
      // sun
      const sunR = 150, sx = W / 2, sy = H * 0.5
      const sun = g.createLinearGradient(0, sy - sunR, 0, sy + sunR)
      sun.addColorStop(0, colors[2]); sun.addColorStop(1, colors[0])
      g.save(); g.beginPath(); g.arc(sx, sy, sunR, 0, Math.PI * 2); g.clip()
      g.fillStyle = sun; g.fillRect(0, 0, W, H)
      g.globalCompositeOperation = 'destination-out'
      for (let i = 0; i < 7; i++) { g.fillStyle = '#000'; g.fillRect(sx - sunR, sy - sunR * 0.3 + i * 22, sunR * 2, 8) }
      g.restore()
      // ground grid
      const gg = g.createLinearGradient(0, H * 0.62, 0, H)
      gg.addColorStop(0, '#160a24'); gg.addColorStop(1, '#0b0616')
      g.fillStyle = gg; g.fillRect(0, H * 0.62, W, H * 0.38)
      g.strokeStyle = colors[0] + 'aa'; g.lineWidth = 1.5
      const hz = H * 0.62
      for (let i = -12; i <= 12; i++) { g.beginPath(); g.moveTo(W / 2 + i * 20, hz); g.lineTo(W / 2 + i * 220, H); g.stroke() }
      for (let i = 0; i < 14; i++) { const y = hz + Math.pow(i / 14, 2) * (H - hz); g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke() }
    }

    // grain for texture
    g.globalAlpha = 0.05
    for (let i = 0; i < 2600; i++) { g.fillStyle = rnd() > 0.5 ? '#fff' : '#000'; g.fillRect(rnd() * W, rnd() * H, 1, 1) }
    g.globalAlpha = 1
    // vignette
    const vg = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.75)
    vg.addColorStop(0, '#00000000'); vg.addColorStop(1, '#000000aa')
    g.fillStyle = vg; g.fillRect(0, 0, W, H)

    return cv.toDataURL('image/jpeg', 0.86)
  }, def)

  const b64 = dataUrl.split(',')[1]
  writeFileSync(join(OUT, `${def.id}.jpg`), Buffer.from(b64, 'base64'))
  console.log(`  ✓ ${def.id}`)
}

await browser.close()
console.log(`\n✓ ${DEFS.length} background images → public/bg/generative/<id>.jpg`)
