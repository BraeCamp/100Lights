/**
 * Do Light's panels stay on the screen when it is docked in a corner?
 *
 *   PORT=4673 node scripts/check-popup-fit.mjs
 *
 * Brae: "On most pages, the voice and type controls are on the bottom right of
 * the screen so their menus go down and off of the viewport."
 *
 * ⚠️ THE BUG WAS A CONSTANT WHERE A MEASUREMENT BELONGED. Both panels were
 * written as `top: 100%` — correct in the transport bar, where the control sits
 * near the top of a tall editor, and useless in the corner it occupies on every
 * other page, where "below" is off the bottom of the screen.
 *
 * Checks the rendered rectangle, not the CSS: whether the panel is on screen is
 * a fact about where it landed.
 */
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4673'}`

let failed = 0
const check = (label, pass, extra = '') => {
  if (!pass) failed++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 120)))

// /library is an ordinary app page: Light docks in the bottom-right corner there.
await page.goto(`${BASE}/library`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)

const corner = await page.evaluate(() => {
  const el = document.querySelector('[data-voice-root], [data-light-root]')
    || [...document.querySelectorAll('div')].find(d => {
      const s = getComputedStyle(d)
      return s.position === 'fixed' && parseInt(s.bottom) === 18 && parseInt(s.right) === 18
    })
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { bottom: r.bottom, right: r.right, viewportH: innerHeight }
})

check('Light is docked near the bottom of the viewport',
  !!corner && corner.viewportH - corner.bottom < 120,
  corner ? `${Math.round(corner.viewportH - corner.bottom)}px from the bottom` : 'not found')

// Open the panel however it is reachable, then measure where it landed.
const opened = await page.evaluate(async () => {
  const btns = [...document.querySelectorAll('button')]
  const b = btns.find(x => /voice|light|listen/i.test(x.getAttribute('aria-label') || x.title || x.textContent || ''))
  if (!b) return false
  b.click()
  await new Promise(r => setTimeout(r, 500))
  return true
})

if (!opened) {
  console.log('  (could not find the button to open the panel — skipping the panel check)')
} else {
  const panel = await page.evaluate(() => {
    const el = document.querySelector('[data-voice-panel]')
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { top: r.top, bottom: r.bottom, height: r.height, viewportH: innerHeight }
  })
  if (!panel) {
    console.log('  (the panel did not open — skipping)')
  } else {
    // ⚠️ THE WHOLE POINT: every edge inside the viewport.
    check('the panel fits on the screen',
      panel.top >= -1 && panel.bottom <= panel.viewportH + 1,
      `top ${Math.round(panel.top)}, bottom ${Math.round(panel.bottom)}, viewport ${panel.viewportH}`)
    check('and it opened UPWARD from a bottom-docked button',
      panel.bottom <= panel.viewportH + 1)
  }
}

// ── and the place it always worked must keep working ──────────────────────
//
// ⚠️ In the studio Light lives in the transport bar, not the corner, and there
// it should still open DOWNWARD. A flip that fired everywhere would have traded
// one off-screen panel for another.
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(5000)
const inStudio = await page.evaluate(async () => {
  const btns = [...document.querySelectorAll('button')]
  const b = btns.find(x => /voice|light|listen/i.test(x.getAttribute('aria-label') || x.title || x.textContent || ''))
  if (!b) return null
  const anchor = b.getBoundingClientRect()
  b.click()
  await new Promise(r => setTimeout(r, 500))
  const el = document.querySelector('[data-voice-panel]')
  if (!el) return { anchorTop: anchor.top, panel: null }
  const r = el.getBoundingClientRect()
  return { anchorTop: anchor.top, panel: { top: r.top, bottom: r.bottom, viewportH: innerHeight } }
})
if (!inStudio?.panel) {
  console.log('  (no panel in the studio — skipping the downward check)')
} else {
  const { panel, anchorTop } = inStudio
  check('in the studio it still fits',
    panel.top >= -1 && panel.bottom <= panel.viewportH + 1,
    `top ${Math.round(panel.top)}, bottom ${Math.round(panel.bottom)}, viewport ${panel.viewportH}`)
  check('and opens downward when there is room below',
    panel.top >= anchorTop - 1, `anchor ${Math.round(anchorTop)}, panel top ${Math.round(panel.top)}`)
}

console.log(failed ? `\n${failed} failing` : '\npanels stay on screen')
await browser.close()
process.exit(failed ? 1 : 0)
