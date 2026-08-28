#!/usr/bin/env node
/**
 * Is the fix the user is testing against actually the code that is live?
 *
 *   node scripts/check-deployed-fix.mjs [marker] [--base https://100lights.com]
 *
 * A deploy reporting READY only means the SERVER holds the new build. A browser
 * still holding the old chunks keeps running them, and every measurement taken
 * in that tab describes code that was replaced hours ago.
 *
 * It drives a real browser rather than scraping the HTML, and that is the whole
 * point: the interesting modules — freeze-cache among them — are lazily
 * imported, so they appear in NO script tag on the page. A first version of
 * this scanned the 27 chunks referenced by the HTML, found nothing, and would
 * have reported the fix missing. The control that caught it: searching for
 * `project-combine`, a string certainly in that file, also found nothing. An
 * absence you cannot distinguish from "never looked there" is not evidence.
 *
 * So: open the studio, let it settle, collect every .js the page actually
 * fetched, and search those.
 */

import { chromium } from 'playwright'

const args = process.argv.slice(2)
const MARKER = args.find(a => !a.startsWith('--')) ?? 'apollo-combine-strikes-v2'
const CONTROL = process.env.CONTROL ?? 'project-combine'
const BASE = process.env.BASE ?? 'https://100lights.com'
const PAGE = process.env.PAGE ?? '/create?modules=audio&audioMode=music'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
const scripts = new Set()
page.on('response', r => {
  const u = r.url()
  if (/\.js(\?|$)/.test(u) && r.status() === 200) scripts.add(u)
})

await page.goto(`${BASE}${PAGE}`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForTimeout(6000)
// Dismiss the first-run dialog so the studio actually mounts and pulls its
// lazy chunks — the ones worth searching only load once it does.
await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"][aria-label="Choose your studio setup"]')
  const b = d && [...d.querySelectorAll('button,div[role=button]')].find(e => /Everything/i.test(e.textContent || ''))
  b?.click()
}).catch(() => {})
await page.waitForTimeout(9000)
await browser.close()

console.log(`${scripts.size} scripts actually fetched by the page\n`)

let hits = 0, controlHits = 0
await Promise.all([...scripts].map(async u => {
  try {
    const body = await (await fetch(u)).text()
    if (body.includes(MARKER)) { hits++; console.log(`  FOUND "${MARKER}"`) }
    if (body.includes(CONTROL)) controlHits++
  } catch { /* ignore */ }
}))

console.log(`\ncontrol "${CONTROL}" found in ${controlHits} script(s)`)
if (!controlHits) {
  console.log('INCONCLUSIVE — the control string was not found either, so the module was never')
  console.log('reached. Absence of the marker here means nothing. Widen the wait or the control.')
  process.exit(2)
}
console.log(hits
  ? `LIVE — the deployed bundle contains the fix. A browser still showing the old behaviour is holding cached JS; hard reload.`
  : `NOT LIVE — the module was reached (control hit) but the marker is absent. The fix is not deployed.`)
process.exit(hits ? 0 : 1)
