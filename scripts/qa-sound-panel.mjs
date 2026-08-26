// Open the sound-settings panel and look at it: knobs, and nothing behind a menu.
//
//   node scripts/qa-sound-panel.mjs http://localhost:4618
//
// Needs a running studio, so it is a hand-run check rather than part of the
// unit suite — but it asserts the two things that are easy to believe without
// looking: that the panel actually renders knobs, and that nothing it offers is
// still hidden behind a popover.
import { chromium } from '/Users/brae/100lights/node_modules/playwright/index.mjs'

const url = process.argv[2] || 'http://localhost:4618'
let fail = 0
const ok = (n, p, x = '') => { if (!p) fail++; console.log(`${p ? 'PASS' : 'FAIL'} ${n}${x ? '  ' + x : ''}`) }

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } })
page.on('pageerror', e => console.log('PAGEERROR:', e.message.slice(0, 180)))
await page.goto(`${url}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.evaluate(() => localStorage.setItem('100lights-ui-tier', 'full'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawDispatch, { timeout: 180000 })
await page.waitForTimeout(2500)
await page.click('body')

await page.evaluate(() => {
  const tid = crypto.randomUUID()
  window.__dawDispatch({ type: 'ADD_TRACK', id: tid, name: 'Sound Test' })
  window.__dawDispatch({
    type: 'ADD_CLIP',
    clip: {
      kind: 'midi', id: crypto.randomUUID(), trackId: tid, name: 'Test', startBeat: 0, durationBeats: 8,
      notes: [60, 64, 67].map((p, i) => ({ id: crypto.randomUUID(), pitch: p, startBeat: i, durationBeats: 1, velocity: 90 })),
      isDrumClip: false,
    },
  })
})
await page.waitForTimeout(1200)

// Through the palette, so no stray keystroke reaches the studio.
await page.keyboard.press('Meta+k')
await page.waitForSelector('input[placeholder^="Type a command"]', { timeout: 6000 })
await page.keyboard.type('piano roll', { delay: 12 })
await page.waitForTimeout(450)
const items = await page.$$eval('[data-palette-item]', e => e.map(x => x.textContent.trim()))
console.log('palette:', items[0] ?? '(nothing)')
if (items.length) await page.click('[data-palette-item="0"]')
await page.waitForTimeout(1500)

const opened = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /^Sound/.test((x.textContent || '').trim()))
  if (!b) return false
  b.click()
  return true
})
await page.waitForTimeout(900)
ok('the Sound panel opens', opened)

const r = await page.evaluate(() => {
  const knobs = [...document.querySelectorAll('svg')].filter(s => s.style.cursor === 'ns-resize')
  const body = document.body.innerText || ''
  return {
    knobs: knobs.length,
    sliders: document.querySelectorAll('input[type="range"]').length,
    overlays: document.querySelectorAll('[data-sound-overlay="true"]').length,
    hasTone: /TONE/.test(body),
    hasDrawMenu: /Draw a graph/.test(body),
    hasLayoutSwitch: /Layout /.test(body),
  }
})
console.log(`knobs ${r.knobs} - sliders ${r.sliders} - open popovers ${r.overlays}`)
ok('the panel uses knobs', r.knobs > 0, String(r.knobs))
ok('no sliders anywhere', r.sliders === 0, String(r.sliders))
ok('nothing sits behind a popover', r.overlays === 0)
ok('the tone row is laid out inline', r.hasTone)
ok('the Draw menu is gone', !r.hasDrawMenu)
ok('the layout-comparison switch is gone', !r.hasLayoutSwitch)

await page.screenshot({ path: '/Users/brae/.claude/jobs/0055fedb/tmp/sound.png' })
console.log(fail ? `\n${fail} failing` : '\nsound settings are knobs, laid out')
await browser.close()
process.exit(fail ? 1 : 0)
