#!/usr/bin/env node
/**
 * Is the voice system actually live, in a production build?
 *
 *   BASE=https://100lights.com node scripts/check-voice-live.mjs
 *
 * check-voice-commands.mjs is the thorough one and it needs the dev-only hooks
 * to load a known song and read the project back, so it can only ever run
 * against a dev server. That leaves the question this file answers: did the
 * thing that works locally actually reach production?
 *
 * It uses only what a visitor has — type a command, look at the screen — so it
 * runs anywhere. Deliberately shallow: this is a deployment check, not a
 * behaviour suite. The assistant is intercepted, so it spends nothing.
 */

import { chromium } from 'playwright'

const BASE = process.env.BASE || `http://localhost:${process.env.PORT || '4700'}`

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
await page.route('**/api/ai/assist*', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '{"calls":[]}' }))
await page.addInitScript(() => {
  try { localStorage.setItem('100lights-ui-tier', 'full') } catch { /* private mode */ }
})
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })

const typeBtn = page.locator('button[title="Type a command instead of speaking"]')
await typeBtn.waitFor({ state: 'visible', timeout: 240000 })
await page.waitForTimeout(2500)

const field = page.locator('input[placeholder*="loop bass"]').first()
async function say(sentence) {
  if (!(await field.isVisible().catch(() => false))) await typeBtn.click()
  await field.waitFor({ state: 'visible', timeout: 15000 })
  await field.fill(sentence)
  await field.press('Enter')
  await page.waitForTimeout(1400)
}

/** Everything the voice control is currently showing.
 *
 *  Every element type, not just divs: the speech toggle lives in a <label>, so
 *  a div-only sweep reported it missing from a page it was sitting on. */
const onScreen = () => page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('div, label, span, button')) {
    const t = (el.textContent || '').trim()
    if (t && t.length < 250) out.push(t)
  }
  return out.join(' | ')
})

// ── A question the studio answers ──────────────────────────────────────────
//
// Needs no project and no hooks: whatever song is open has a tempo.
await say('what is the tempo')
check('the studio answers a question in words', /\d+\s*BPM/i.test(await onScreen()),
  (await onScreen()).slice(0, 90))

// ── The speech toggle reached production ───────────────────────────────────
await page.locator('button[aria-label="Voice settings"]').click()
await page.waitForTimeout(600)
const settings = await onScreen()
check('the "answer out loud" setting is there', /answer out loud/i.test(settings))
check('and the command list is generated into the panel',
  /THINGS YOU CAN SAY/i.test(settings) && /QUESTIONS/i.test(settings))

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe voice system is live')
process.exit(failures ? 1 : 0)
