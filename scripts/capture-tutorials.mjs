// Regenerate the red-circled button screenshots for the feature tutorials.
//
//   npm run capture-tutorials         # all tutorials
//   npm run capture-tutorials fx      # just one
//
// Each tutorial has a DRIVER below: it drives a headless studio to reveal each
// control (add a track, open the device panel, …) and photographs it with a red
// ring + generous surrounding context, keyed on the same data-help-id the
// tutorial page and the live guide use. Output: public/tutorial/<slug>/<n>.png.
//
// By default it spawns its own `next start` (a production build must already
// exist — run `npm run build` first). Set CAPTURE_URL to point at a server you
// started yourself (e.g. CAPTURE_URL=http://localhost:3100).

import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import net from 'node:net'

const ROOT = process.cwd()
const PORT = 3210
const ONLY = process.argv[2] || null
const MARGIN = 130
const VW = 1440, VH = 900

function portUp(port) {
  return new Promise(res => {
    const s = net.connect(port, '127.0.0.1')
    s.on('connect', () => { s.destroy(); res(true) })
    s.on('error', () => res(false))
  })
}
async function waitPort(port, tries = 60) {
  for (let i = 0; i < tries; i++) { if (await portUp(port)) return true; await new Promise(r => setTimeout(r, 1000)) }
  return false
}

let baseUrl = process.env.CAPTURE_URL
let server = null
if (!baseUrl) {
  console.log(`Starting next start on :${PORT} …`)
  server = spawn('npx', ['next', 'start', '-p', String(PORT)], { cwd: ROOT, stdio: 'ignore' })
  if (!(await waitPort(PORT))) { console.error('server did not start (did you run `npm run build`?)'); server.kill(); process.exit(1) }
  baseUrl = `http://localhost:${PORT}`
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: 2 })

async function gotoStudio() {
  // Load against the demo WIP song so buttons are shown in a real, populated
  // project (see scripts/build-tutorial-song.mjs).
  await page.goto(`${baseUrl}/new?modules=audio&fixture=demo-song`, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('[data-help-id="add-track"]', { timeout: 25000 })
  await page.waitForTimeout(1800)  // let the fixture's tracks + clips render
}

async function shoot(slug, index, selector) {
  const el = page.locator(selector).first()
  try { await el.waitFor({ state: 'visible', timeout: 8000 }) } catch { console.log(`  ! step ${index + 1}: ${selector} not visible`); return false }
  await el.scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(150)
  const box = await el.boundingBox()
  if (!box) { console.log(`  ! step ${index + 1}: no box`); return false }
  await page.evaluate(({ box }) => {
    const d = document.createElement('div'); d.id = '__cap_ring'
    const pad = 9, size = Math.max(box.width, box.height) + pad * 2
    d.style.cssText = `position:fixed;left:${box.x + box.width / 2 - size / 2}px;top:${box.y + box.height / 2 - size / 2}px;width:${size}px;height:${size}px;border:4px solid #ef4444;border-radius:50%;box-shadow:0 0 0 2px rgba(239,68,68,0.4);z-index:2147483647;pointer-events:none;`
    document.body.appendChild(d)
  }, { box })
  const x = Math.max(0, box.x - MARGIN), y = Math.max(0, box.y - MARGIN)
  const clip = { x, y, width: Math.min(VW - x, box.width + MARGIN * 2), height: Math.min(VH - y, box.height + MARGIN * 2) }
  const dir = join(ROOT, 'public', 'tutorial', slug); mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${index + 1}.png`), clip })
  await page.evaluate(() => document.getElementById('__cap_ring')?.remove())
  console.log(`  ✓ step ${index + 1}  (${Math.round(clip.width)}x${Math.round(clip.height)})`)
  return true
}

// Per-tutorial drivers. Keep the shoot() order + helpIds aligned with the steps
// in lib/tutorials.ts.
const DRIVERS = {
  fx: async () => {
    await gotoStudio()
    await shoot('fx', 0, '[data-help-id="add-track"]')
    await page.click('[data-help-id="add-track"]')
    await page.waitForTimeout(700)
    await shoot('fx', 1, '[data-help-id="track-settings"]')
    await page.locator('[data-help-id="track-settings"]').first().click()
    await page.waitForTimeout(900)
    await shoot('fx', 2, '[data-help-id="add-device"]')
    // step 4 (bypass) is text-only — no screenshot
  },
}

const slugs = ONLY ? [ONLY] : Object.keys(DRIVERS)
for (const slug of slugs) {
  if (!DRIVERS[slug]) { console.log(`no driver for "${slug}"`); continue }
  console.log(`Capturing ${slug} …`)
  try { await DRIVERS[slug]() } catch (e) { console.error(`  driver error: ${e.message}`) }
}

await browser.close()
if (server) server.kill('SIGTERM')
console.log('done')
