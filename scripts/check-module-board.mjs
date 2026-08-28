#!/usr/bin/env node
// The Apollo board: does it work, and did it fix what it was built to fix?
//
//   PORT=4620 node scripts/check-module-board.mjs
//
// Two claims, and the second is the reason the board exists.
//
//   It behaves — bars, working knobs, toggles that grey the module out while
//   leaving its name readable, an overflow control for modules with more
//   knobs than fit, an eye, and open modules joining into one rack.
//
//   It is cheap — the old rack blocked the main thread for ~2.9 SECONDS on
//   every open, measured on production at 3315 / 2809 / 2886 ms. Opening the
//   board should cost a fraction of that, and expanding one module should
//   cost about one panel rather than eleven.

import { chromium } from 'playwright'

const PORT = process.env.PORT || '4620'
const BASE = process.argv[2]?.replace(/\/$/, '') || `http://localhost:${PORT}`
const BUDGET_MS = Number(process.env.BUDGET_MS || 900)

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({ args: ['--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  page error:', e.message))

await page.addInitScript(() => {
  const w = window
  w.__f = { gaps: [], on: false }
  let last = performance.now()
  const tick = () => {
    const t = performance.now()
    if (w.__f.on) w.__f.gaps.push(t - last)
    last = t
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  w.__start = () => { w.__f.gaps = []; w.__f.on = true }
  w.__stop = () => {
    w.__f.on = false
    const g = w.__f.gaps
    return {
      blockedMs: Math.round(g.filter(x => x > 50).reduce((n, x) => n + x, 0)),
      stalls: g.filter(x => x > 50).length,
      worst: Math.round(Math.max(0, ...g)),
    }
  }
  w.__visuals = () => ({ canvases: document.querySelectorAll('canvas').length })
})

const settle = ms => page.waitForTimeout(ms)
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 120000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 180000 }).catch(() => {})
await settle(4000)

const dlg = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
await dlg.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
if (await dlg.count()) {
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Choose your studio setup"]')
    const b = d && [...d.querySelectorAll('button,div[role=button]')].find(x => /Everything/i.test(x.textContent || ''))
    b?.click()
  })
  await dlg.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
}
await settle(1500)

const canvasBefore = await page.evaluate(() => window.__visuals().canvases)

// ── Opening the board ───────────────────────────────────────────────────────
await page.evaluate(() => window.__start())
const t0 = Date.now()
await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /apollo/i.test((x.textContent || '').trim()))
  b?.click()
})
await page.waitForSelector('[data-apollo-board]', { timeout: 30000 }).catch(() => {})
await settle(2500)
const openStats = await page.evaluate(() => window.__stop())
const openMs = Date.now() - t0
const canvasAfter = await page.evaluate(() => window.__visuals().canvases)

const bars = await page.evaluate(() => [...document.querySelectorAll('[data-module-bar]')].map(b => b.getAttribute('data-module-bar')))
console.log(`\n  board opened in ${openMs} ms — ${openStats.blockedMs} ms blocked, ${openStats.stalls} stalls, worst ${openStats.worst} ms`)
console.log(`  ${bars.length} bars: ${bars.join(', ')}`)
console.log(`  canvases: ${canvasBefore} → ${canvasAfter}`)

check('the board opens', bars.length > 0, `${bars.length} bars`)
check('every module has a bar', bars.filter(b => !b.startsWith('fx:')).length >= 9, `${bars.length}`)
check('opening the board is far cheaper than the old rack',
  openStats.blockedMs < BUDGET_MS, `${openStats.blockedMs} ms blocked, budget ${BUDGET_MS} ms`)
check('and it mounts no canvases at all',
  canvasAfter === canvasBefore, `${canvasAfter - canvasBefore} added`)

// ── The knobs are real ──────────────────────────────────────────────────────
const knobs = await page.evaluate(() => {
  const bar = document.querySelector('[data-module-bar="osc"]')
  return bar ? bar.querySelectorAll('svg').length : 0
})
check('bars carry working knobs', knobs > 0, `${knobs} on the oscillator bar`)

// ── Overflow ────────────────────────────────────────────────────────────────
//
// The invariant, not a fixed expectation: the ALL button is shown exactly when
// the knob row cannot fit its knobs. Two earlier versions of this check got it
// wrong — first asserting the button is always there (it is not: eight macros
// fit fine at 1280px), then resizing the viewport to force overflow, which does
// nothing because the Apollo card is a floating window with its own width, and
// which polluted every measurement after it with relayout cost.
const overflow = await page.evaluate(() => {
  const out = []
  for (const bar of document.querySelectorAll('[data-module-bar]')) {
    // The knob row specifically. Scanning every div in the bar caught an
    // unrelated element and reported overflow on a bar whose knobs fit.
    const row = bar.querySelector('[data-knob-row]')
    const overflows = !!row && row.scrollWidth > row.clientWidth + 2
    const btn = [...bar.querySelectorAll('button')].find(b => /^(ALL|LESS)$/.test((b.textContent || '').trim()))
    out.push({ id: bar.getAttribute('data-module-bar'), overflows, hasButton: !!btn })
  }
  return out
})
const wrong = overflow.filter(o => o.overflows !== o.hasButton)
console.log(`  overflow: ${overflow.filter(o => o.overflows).length} bars overflow, ${overflow.filter(o => o.hasButton).length} show ALL`)
check('the ALL button appears exactly when knobs do not fit', wrong.length === 0,
  wrong.map(w => `${w.id} overflow=${w.overflows} button=${w.hasButton}`).join(', ') || 'consistent')

// The invariant above holds trivially while nothing overflows, which proves
// nothing about the feature. Narrow the CARD — the board's actual container,
// which is a floating window with its own width — until the eight macro knobs
// genuinely do not fit, and watch the ResizeObserver do its job.
const narrowed = await page.evaluate(() => {
  const board = document.querySelector('[data-apollo-board]')
  const card = board?.closest('div[style*="width"]') || board?.parentElement?.parentElement
  if (!card) return false
  card.dataset.prevWidth = card.style.width
  card.style.width = '430px'
  return true
})
await settle(1200)
const narrowState = await page.evaluate(() => {
  const bar = document.querySelector('[data-module-bar="macros"]')
  const row = bar?.querySelector('[data-knob-row]')
  const btn = [...(bar?.querySelectorAll('button') ?? [])].find(b => /^(ALL|LESS)$/.test((b.textContent || '').trim()))
  return {
    overflows: !!row && row.scrollWidth > row.clientWidth + 2,
    button: btn ? btn.textContent.trim() : null,
    height: Math.round(bar?.getBoundingClientRect().height ?? 0),
  }
})
console.log(`  narrowed to 430px — macros overflows: ${narrowState.overflows}, button: ${narrowState.button}`)
check('narrowing the card makes the knobs overflow', narrowed && narrowState.overflows)
check('and the ALL button appears when they do', narrowState.button === 'ALL', String(narrowState.button))

if (narrowState.button === 'ALL') {
  await page.evaluate(() => {
    const bar = document.querySelector('[data-module-bar="macros"]')
    const btn = [...bar.querySelectorAll('button')].find(b => (b.textContent || '').trim() === 'ALL')
    btn?.click()
  })
  await settle(700)
  const expanded = await page.evaluate(() => {
    const bar = document.querySelector('[data-module-bar="macros"]')
    const btn = [...bar.querySelectorAll('button')].find(b => /^(ALL|LESS)$/.test((b.textContent || '').trim()))
    return { height: Math.round(bar.getBoundingClientRect().height), button: btn?.textContent.trim() }
  })
  console.log(`  macros bar ${narrowState.height} → ${expanded.height} px, button now ${expanded.button}`)
  check('clicking ALL wraps the knobs into view', expanded.height > narrowState.height + 8,
    `${narrowState.height} → ${expanded.height} px`)
  check('and the button offers to go back', expanded.button === 'LESS', String(expanded.button))
}

// Put the card back before the timing measurements below.
await page.evaluate(() => {
  const board = document.querySelector('[data-apollo-board]')
  const card = board?.closest('div[style*="width"]') || board?.parentElement?.parentElement
  if (card) card.style.width = card.dataset.prevWidth || ''
})
await settle(1200)

// ── Expanding a module ──────────────────────────────────────────────────────
await page.evaluate(() => window.__start())
const t1 = Date.now()
await page.evaluate(() => {
  const bar = document.querySelector('[data-module-bar="filters"]')
  bar?.querySelector('button')?.click()
})
await settle(2500)
const expandStats = await page.evaluate(() => window.__stop())
console.log(`\n  expanding one module: ${Date.now() - t1} ms, ${expandStats.blockedMs} ms blocked`)
check('expanding one module costs a fraction of the old rack',
  expandStats.blockedMs < BUDGET_MS, `${expandStats.blockedMs} ms blocked`)

const panelUp = await page.evaluate(() => /CUTOFF|RES/i.test(document.body.innerText))
check('and the panel actually arrives', panelUp)

// Re-opening a module that was already opened should be free — that is the
// whole reason panels are kept mounted behind the collapse.
await page.evaluate(() => {
  const bar = document.querySelector('[data-module-bar="filters"]')
  bar?.querySelector('button')?.click()
})
await settle(800)
await page.evaluate(() => window.__start())
await page.evaluate(() => {
  const bar = document.querySelector('[data-module-bar="filters"]')
  bar?.querySelector('button')?.click()
})
await settle(1200)
const reopen = await page.evaluate(() => window.__stop())
console.log(`  re-opening the same module: ${reopen.blockedMs} ms blocked`)
check('re-opening a module is nearly free', reopen.blockedMs < 120, `${reopen.blockedMs} ms`)

// ── Toggling ────────────────────────────────────────────────────────────────
const toggled = await page.evaluate(() => {
  const bar = document.querySelector('[data-module-bar="subnoise"]')
  const btn = [...bar.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') !== null && b.getAttribute('title')?.includes('Sub'))
  const before = btn?.getAttribute('aria-pressed')
  btn?.click()
  return { before, found: !!btn }
})
await settle(700)
const after = await page.evaluate(() => {
  const bar = document.querySelector('[data-module-bar="subnoise"]')
  const btn = [...bar.querySelectorAll('button')].find(b => b.getAttribute('aria-pressed') !== null && b.getAttribute('title')?.includes('Sub'))
  return btn?.getAttribute('aria-pressed')
})
check('a module can be switched on from its bar', toggled.found && toggled.before !== after,
  `${toggled.before} → ${after}`)

// ── The eye ─────────────────────────────────────────────────────────────────
// Visuals are their own lazy layer: nothing draws until asked. The board
// mounted zero canvases above, so if one appears here it came from the eye.
const canvasBeforeEye = await page.evaluate(() => window.__visuals().canvases)
const eyeClicked = await page.evaluate(() => {
  const bar = document.querySelector('[data-module-bar="osc"]')
  const btn = [...bar.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '◉')
  if (!btn) return false
  btn.click()
  return true
})
await settle(2500)
const canvasAfterEye = await page.evaluate(() => window.__visuals().canvases)
console.log(`\n  eye: canvases ${canvasBeforeEye} → ${canvasAfterEye}`)
check('the eye exists on a module that has a visual', eyeClicked)
check('and opening it is what mounts the canvas', canvasAfterEye > canvasBeforeEye,
  `${canvasAfterEye - canvasBeforeEye} added`)

// Closing it again should put the canvas away, or "no visuals while playing"
// is only true until the first time you peek.
await page.evaluate(() => {
  const bar = document.querySelector('[data-module-bar="osc"]')
  const btn = [...bar.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '◉')
  btn?.click()
})
await settle(1200)
const canvasClosed = await page.evaluate(() => window.__visuals().canvases)
check('and closing it puts the canvas away again', canvasClosed === canvasBeforeEye,
  `${canvasClosed} vs ${canvasBeforeEye}`)

// ── Open modules join into one rack ─────────────────────────────────────────
// Brae: "they connect to become a rack when multiple items are selected".
// Two neighbours both open should share an edge — no gap, no double border.
for (const id of ['osc', 'subnoise']) {
  const isOpen = await page.evaluate(m => {
    const bar = document.querySelector(`[data-module-bar="${m}"]`)
    return bar?.querySelector('button')?.getAttribute('aria-expanded') === 'true'
  }, id)
  if (!isOpen) {
    await page.evaluate(m => {
      const bar = document.querySelector(`[data-module-bar="${m}"]`)
      bar?.querySelector('button')?.click()
    }, id)
    await settle(1500)
  }
}
await settle(1000)
const joined = await page.evaluate(() => {
  const a = document.querySelector('[data-module-bar="osc"]')?.closest('div[style*="border"]')
  const b = document.querySelector('[data-module-bar="subnoise"]')?.closest('div[style*="border"]')
  if (!a || !b) return null
  const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect()
  return { gap: Math.round(rb.top - ra.bottom), bTopBorder: getComputedStyle(b).borderTopWidth }
})
console.log(`  two open neighbours: ${joined?.gap} px apart, top border ${joined?.bTopBorder}`)
check('open neighbours close ranks into one rack',
  joined !== null && Math.abs(joined.gap) <= 1 && joined.bTopBorder === '0px',
  `gap ${joined?.gap}px, border ${joined?.bTopBorder}`)

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe board works, and it is cheap')
process.exit(failures ? 1 : 0)
