#!/usr/bin/env node
// Generate a distinct app icon per mini-app (1024 + 512 + 192 PNG).
//
// Each icon uses the app's own colour and a simple, recognizable glyph drawn from
// its identity — so the icons are clearly different app-to-app (an App Review 4.3
// signal), and consistent as a family. Rendered from SVG via a headless browser.
// Output: mobile/icons/<slug>/icon-<size>.png — feed the 1024 into your iOS/Android
// icon step (e.g. @capacitor/assets) per app before building.
//
//   node scripts/gen-app-icons.mjs

import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// Grid glyph for the beat maker (a mini sequencer).
function gridGlyph() {
  const on = new Set(['0,0', '2,0', '0,1', '3,1', '1,2', '3,2'])
  let r = ''
  const s = 15, gap = 6, x0 = 24, y0 = 30
  for (let row = 0; row < 3; row++) for (let col = 0; col < 4; col++) {
    const x = x0 + col * (s + gap), y = y0 + row * (s + gap)
    r += `<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="4" fill="#fff" opacity="${on.has(`${col},${row}`) ? 1 : 0.32}"/>`
  }
  return r
}
function bars(hs, { x0 = 24, w = 6, gap = 4, bottom = 74 } = {}) {
  return hs.map((h, i) => `<rect x="${x0 + i * (w + gap)}" y="${bottom - h}" width="${w}" height="${h}" rx="3" fill="#fff" opacity="${0.55 + (i % 3) * 0.15}"/>`).join('')
}

// slug → { grad:[from,to], glyph:svgMarkup(0..100 space) }
const ICONS = {
  beatmaker: { grad: ['#fb7185', '#e11d48'], glyph: gridGlyph() },
  captions: {
    grad: ['#60a5fa', '#2563eb'],
    glyph: `<rect x="22" y="40" width="56" height="13" rx="6" fill="#fff"/><rect x="22" y="59" width="34" height="13" rx="6" fill="#fff" opacity="0.6"/>`,
  },
  lightningbug: { grad: ['#f472b6', '#db2777'], glyph: bars([30, 52, 38, 66, 44, 58, 34]) },
  voicemidi: {
    grad: ['#22d3ee', '#0891b2'],
    glyph: `<rect x="43" y="24" width="14" height="30" rx="7" fill="#fff"/><path d="M35 48 a15 15 0 0 0 30 0" stroke="#fff" stroke-width="4.5" fill="none" stroke-linecap="round"/><line x1="50" y1="63" x2="50" y2="74" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><line x1="41" y1="74" x2="59" y2="74" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/>`,
  },
  transcribe: {
    grad: ['#34d399', '#059669'],
    glyph: `${bars([18, 34, 24, 40], { x0: 22, w: 6, gap: 5, bottom: 62 })}<circle cx="66" cy="56" r="7" fill="#fff"/><rect x="71.5" y="34" width="4" height="22" fill="#fff"/>`,
  },
  sheetmusic: {
    grad: ['#fbbf24', '#d97706'],
    glyph: `${[38, 45, 52, 59, 66].map(y => `<line x1="24" y1="${y}" x2="76" y2="${y}" stroke="#fff" stroke-width="2.4" opacity="0.85"/>`).join('')}<ellipse cx="40" cy="59" rx="7" ry="5.5" fill="#fff"/><ellipse cx="60" cy="52" rx="7" ry="5.5" fill="#fff"/><rect x="46" y="38" width="3" height="21" fill="#fff"/><rect x="66" y="31" width="3" height="21" fill="#fff"/>`,
  },
  autotune: {
    grad: ['#a78bfa', '#7c3aed'],
    glyph: `${[40, 55, 70].map(y => `<line x1="22" y1="${y}" x2="78" y2="${y}" stroke="#fff" stroke-width="2.4" opacity="0.4"/>`).join('')}<polyline points="24,70 38,70 38,55 56,55 56,40 76,40" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="76" cy="40" r="6" fill="#fff"/>`,
  },
}

const SIZES = [1024, 512, 192]
const browser = await chromium.launch()
let made = 0
for (const [slug, spec] of Object.entries(ICONS)) {
  const dir = join(ROOT, 'mobile', 'icons', slug)
  mkdirSync(dir, { recursive: true })
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100%" height="100%"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${spec.grad[0]}"/><stop offset="1" stop-color="${spec.grad[1]}"/></linearGradient></defs><rect width="100" height="100" fill="url(#g)"/><g filter="drop-shadow(0 1px 1px rgba(0,0,0,0.18))">${spec.glyph}</g></svg>`
  for (const size of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 })
    const page = await ctx.newPage()
    await page.setContent(`<!doctype html><html><body style="margin:0;width:${size}px;height:${size}px">${svg}</body></html>`)
    await page.screenshot({ path: join(dir, `icon-${size}.png`), clip: { x: 0, y: 0, width: size, height: size } })
    await ctx.close()
  }
  made++
  console.log(`  ✓ ${slug}`)
}
await browser.close()
console.log(`\n✓ ${made} app icons (1024/512/192) → mobile/icons/<slug>/icon-<size>.png`)
