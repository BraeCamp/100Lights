/**
 * Records the landing-page demo loop: a scripted ~30s session in the audio
 * editor, captured as webm via Playwright's video recording.
 *
 * Usage: node scripts/record-demo.js [--debug-dir <dir>]
 *   Requires the dev server on :3000 with DEV_OPEN=1 (auth bypass).
 *   Output: public/demo/daw-loop.webm + public/demo/daw-poster.jpg
 */
const { chromium } = require('playwright-core')
const fs = require('fs')
const path = require('path')

const OUT_DIR = path.join(__dirname, '..', 'public', 'demo')
const VIDEO_TMP = path.join(__dirname, '..', '.demo-video-tmp')
const W = 1280, H = 800

const dbgIdx = process.argv.indexOf('--debug-dir')
const DEBUG_DIR = dbgIdx > -1 ? process.argv[dbgIdx + 1] : null

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// A visible cursor: Playwright videos don't render the real pointer, so we
// inject a dot that follows mousemove and pulses on mousedown.
const CURSOR_SCRIPT = `
  window.addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div')
    c.id = '__demo_cursor'
    c.style.cssText = 'position:fixed;top:0;left:0;width:18px;height:18px;border-radius:50%;' +
      'background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.9);z-index:2147483647;' +
      'pointer-events:none;transform:translate(-50%,-50%);transition:width .12s,height .12s;' +
      'box-shadow:0 0 8px rgba(0,0,0,.6)'
    document.body.appendChild(c)
    document.addEventListener('mousemove', e => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px' }, true)
    document.addEventListener('mousedown', () => { c.style.width = '26px'; c.style.height = '26px' }, true)
    document.addEventListener('mouseup', () => { c.style.width = '18px'; c.style.height = '18px' }, true)
  })
`

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.rmSync(VIDEO_TMP, { recursive: true, force: true })
  if (DEBUG_DIR) fs.mkdirSync(DEBUG_DIR, { recursive: true })

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  })
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: VIDEO_TMP, size: { width: W, height: H } },
    permissions: ['microphone'],
  })
  await context.addInitScript(CURSOR_SCRIPT)
  const page = await context.newPage()

  const help = (id) => page.locator(`[data-help-id="${id}"]`).first()
  let shot = 0
  const debug = async (name) => {
    if (DEBUG_DIR) await page.screenshot({ path: path.join(DEBUG_DIR, `${String(++shot).padStart(2, '0')}-${name}.png`) })
  }

  // Glide the fake cursor to the element, then click.
  async function glideClick(locator, { pause = 300 } = {}) {
    const box = await locator.boundingBox()
    if (!box) throw new Error('glideClick: element not visible')
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 24 })
    await sleep(pause)
    await locator.click()
  }

  await page.goto('http://localhost:3000/new?modules=audio&audioMode=music', { waitUntil: 'domcontentloaded' })
  await page.locator('[data-editor="true"]').waitFor({ timeout: 20000 })

  const discard = page.getByRole('button', { name: /discard/i }).first()
  if (await discard.isVisible().catch(() => false)) await discard.click()
  await page.mouse.move(W / 2, H / 2)
  await sleep(1200)
  await debug('loaded')

  // ── Beat 1: build the session ──
  await glideClick(help('add-track'))
  await sleep(500)
  await glideClick(help('add-track'))
  await sleep(700)
  await debug('tracks-added')

  // ── Beat 2: metronome + play ──
  await glideClick(help('metronome'))
  await sleep(350)
  await glideClick(help('play'))
  await sleep(3000)
  await debug('playing')

  // ── Beat 3: JAM — live capture into the arrangement, waveform grows ──
  await glideClick(help('jam'))
  await sleep(4000)
  await debug('jam-capturing')

  // ── Beat 4: ride track 1's volume slider while capturing ──
  try {
    // Track-row volume slider, not the transport swing slider: pick the
    // first range input below the toolbar area.
    let sbox = null
    for (const el of await page.locator('input[type="range"]').all()) {
      const b = await el.boundingBox()
      if (b && b.y > 150 && b.x < 480) { sbox = b; break }
    }
    if (sbox) {
      const cy = sbox.y + sbox.height / 2
      await page.mouse.move(sbox.x + sbox.width * 0.7, cy, { steps: 22 })
      await page.mouse.down()
      await page.mouse.move(sbox.x + sbox.width * 0.35, cy, { steps: 24 })
      await sleep(250)
      await page.mouse.move(sbox.x + sbox.width * 0.8, cy, { steps: 24 })
      await page.mouse.up()
    }
    await sleep(700)
    await debug('slider')
  } catch { /* keep rolling */ }

  // ── Beat 5: stop the capture, zoom in on the take ──
  await glideClick(help('jam'))
  await sleep(1000)
  await glideClick(help('zoom-in')).catch(() => {})
  await sleep(500)
  await glideClick(help('zoom-in')).catch(() => {})
  await sleep(1500)
  await debug('zoomed')

  // ── Beat 6: poster on the arrangement take, then stop — loop point ──
  await page.mouse.move(W - 60, H - 60, { steps: 18 })
  await sleep(600)
  await page.screenshot({ path: path.join(OUT_DIR, 'daw-poster.jpg'), type: 'jpeg', quality: 82 })
  await debug('final')
  await glideClick(help('play')).catch(() => {}) // stop
  await sleep(1100)

  await context.close() // flushes the video file
  await browser.close()

  const files = fs.readdirSync(VIDEO_TMP).filter(f => f.endsWith('.webm'))
  if (!files.length) throw new Error('no video produced')
  fs.copyFileSync(path.join(VIDEO_TMP, files[0]), path.join(OUT_DIR, 'daw-loop.webm'))
  fs.rmSync(VIDEO_TMP, { recursive: true, force: true })
  const mb = (fs.statSync(path.join(OUT_DIR, 'daw-loop.webm')).size / 1024 / 1024).toFixed(1)
  console.log(`done: ${path.join(OUT_DIR, 'daw-loop.webm')} (${mb} MB)`)
}

main().catch(err => { console.error(err); process.exit(1) })
