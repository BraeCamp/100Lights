#!/usr/bin/env node
/**
 * Can a spoken or typed command spend credits without being confirmed?
 *
 *   PORT=4661 node scripts/check-ai-confirm.mjs
 *
 * Brae: "I'm worried that AI will mishear things and create commands and use
 * credits accidentally. Can we set a barrier so that it doesn't use credits
 * before confirming?" — and then, unambiguously: "every single time it should
 * get confirmation first."
 *
 * The guard is one `if` in VoiceControl, which is exactly the kind of line that
 * gets refactored away by someone who cannot see what it is holding back. So
 * this asserts the behaviour from OUTSIDE the page: it watches the network and
 * fails if a request to the assistant is ever made that nobody pressed a button
 * for. Reading the source proves the line is there; only this proves it works.
 *
 * The assistant route needs a session, so in dev it would answer 401 — which
 * does not matter here. The question is whether the request was ATTEMPTED, and
 * an intercepted route counts that regardless of what it answers.
 */

import { chromium } from 'playwright'

// Runs against a dev server by default, or anywhere BASE points — including
// production, which is safe because the assistant route is intercepted below
// and never actually reached.
const BASE = process.env.BASE || `http://localhost:${process.env.PORT || '4700'}`

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 140)))

// Every attempt to reach the assistant, counted. Fulfilled locally so the test
// never depends on credits, an API key, or a signed-in session.
let assistCalls = 0
await page.route('**/api/ai/assist*', async route => {
  assistCalls++
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ calls: [], say: 'ok' }),
  })
})

// Answer the first-run setup question before it is asked: the full studio, so
// every control this exercises is on screen. Choosing it by clicking would make
// this test depend on the wording of a dialog it is not about.
await page.addInitScript(() => {
  try { localStorage.setItem('100lights-ui-tier', 'full') } catch { /* private mode */ }
  // ⚠️ Ask-first is no longer the default — the assistant acts unless somebody
  // asks to be asked. Brae: "It still pulls up 'Ask the assistant' menu which
  // it shouldn't do at all in AI mode."
  //
  // So this suite selects it, because what it exists to prove is that the
  // barrier WORKS when it is on: nothing is spent before the press, the words
  // are shown and correctable, and cancelling costs nothing. Those guarantees
  // are the reason the setting is still there, and they matter more now that
  // it is a choice rather than the default.
  try {
    localStorage.setItem('beacon.voice.assistant', 'ask')
    localStorage.setItem('beacon.voice.ai-auto', 'off')
  } catch { /* private mode */ }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })

const typeBtn = page.locator('button[title="Type a command instead of speaking"]')
// Wait for the control under test, not for a dev-only window hook —
// __dawDispatch does not exist in a production build, so waiting on it made
// this runnable in exactly one of the two places it is worth running.
await typeBtn.waitFor({ state: 'visible', timeout: 240000 })
await page.waitForTimeout(2000)
const typeField = page.locator('input[placeholder*="loop bass"]').first()
const confirmPanel = page.getByText("I DON'T KNOW THAT ONE", { exact: false })
const confirmField = page.locator('input').first()

/** Send a sentence the way a person would: open the box, type, Enter. */
async function say(sentence) {
  // Clear anything left over, so the toggle below is never the thing that
  // CLOSES the box and the next step times out looking for it.
  if (await confirmPanel.count()) {
    await page.locator('button', { hasText: 'CANCEL' }).first().click()
    await page.waitForTimeout(300)
  }
  if (!(await typeField.isVisible().catch(() => false))) await typeBtn.click()
  await typeField.waitFor({ state: 'visible', timeout: 15000 })
  await typeField.fill(sentence)
  await typeField.press('Enter')
  await page.waitForTimeout(1600)
}

// ── A command the local rules DO know: runs, and costs nothing ─────────────
await say('stop')
check('a known command runs without asking permission', assistCalls === 0, `assist calls: ${assistCalls}`)
check('and shows no confirmation for a free action', (await confirmPanel.count()) === 0)

// ── A command they do NOT know: must stop and ask ──────────────────────────
const before = assistCalls
await say('make the chorus feel more exciting somehow')
check('an unknown command does NOT reach the assistant on its own',
  assistCalls === before, `assist calls: ${assistCalls}`)
check('it asks first', (await confirmPanel.count()) > 0)

// What it heard is shown, and can be corrected — the whole point of the barrier.
const shown = await confirmField.inputValue().catch(() => '')
check('the confirmation shows the words it is about to act on',
  /chorus/i.test(shown), JSON.stringify(shown.slice(0, 60)))

// ── Cancelling spends nothing ─────────────────────────────────────────────
await page.locator('button', { hasText: 'CANCEL' }).first().click()
await page.waitForTimeout(700)
check('cancelling spends nothing', assistCalls === before, `assist calls: ${assistCalls}`)
check('and the confirmation goes away', (await confirmPanel.count()) === 0)

// ── Correcting the words costs nothing ────────────────────────────────────
//
// The reason the field is editable. A sentence that arrives garbled is fixed in
// place and tried again — and because run() always consults the local rules
// first, a correction that lands on a known command never reaches the paid
// path, confirmed or not. The tempo is used here because it needs no track, so
// this asserts the barrier rather than the contents of whatever project loaded.
await say('crank that up a bit would you')
check('a vague sentence stops at the barrier', (await confirmPanel.count()) > 0)
await confirmField.fill('set the tempo to 120')
await confirmField.press('Enter')
await page.waitForTimeout(1500)
check('a corrected sentence is retried locally, for free', assistCalls === before,
  `assist calls: ${assistCalls}`)
check('and it actually took effect',
  await page.evaluate(() => !!document.body.textContent?.match(/\b120\b/)))

// ── Confirming is the ONLY thing that spends ──────────────────────────────
await say('write me a bassline in the style of a march')
check('still nothing spent before the press', assistCalls === before, `assist calls: ${assistCalls}`)
if (await confirmPanel.count()) {
  await page.locator('button', { hasText: 'ASK THE ASSISTANT' }).first().click()
  await page.waitForTimeout(2500)
}
check('pressing the button is what sends it', assistCalls === before + 1,
  `assist calls: ${assistCalls}`)

// ── And the activation, which is the only thing that skips it ──────────────
//
// Brae: "Full AI integration will be in the highest tier and only when
// activated." That is a default and an override, not a contradiction with
// "every single time it should get confirmation first" — so the override has to
// be provably OFF unless somebody turns it on, and provably effective when they
// do.
{
  const before = assistCalls
  // ⚠️ BOTH keys. `beacon.voice.assistant` is the one the mode is read from now
  // and it wins over the older flag — and addInitScript above re-runs on every
  // navigation, so a reload re-pins it to 'ask' and flipping only the old key
  // changes nothing at all. Same trap this suite's HUD and voice-mode checks
  // have both fallen into.
  await page.evaluate(() => {
    try {
      localStorage.setItem('beacon.voice.assistant', 'auto')
      localStorage.setItem('beacon.voice.ai-auto', 'on')
    } catch { /* private mode */ }
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('beacon.voice.assistant', 'auto')
      localStorage.setItem('beacon.voice.ai-auto', 'on')
    } catch { /* private mode */ }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await typeBtn.waitFor({ state: 'visible', timeout: 240000 })
  await page.waitForTimeout(2500)

  await say('write me a bassline in the style of a march')
  await page.waitForTimeout(1500)
  check('once activated, the assistant is reached without asking',
    assistCalls === before + 1, `${assistCalls - before} calls`)
  check('and no confirmation was shown', (await confirmPanel.count()) === 0)

  // Off again, and the barrier is back — the setting is the whole difference.
  await page.evaluate(() => {
    try {
      localStorage.setItem('beacon.voice.assistant', 'ask')
      localStorage.setItem('beacon.voice.ai-auto', 'off')
    } catch { /* private mode */ }
  })
  await page.addInitScript(() => {
    try {
      localStorage.setItem('beacon.voice.assistant', 'ask')
      localStorage.setItem('beacon.voice.ai-auto', 'off')
    } catch { /* private mode */ }
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await typeBtn.waitFor({ state: 'visible', timeout: 240000 })
  await page.waitForTimeout(2500)
  const after = assistCalls
  await say('write me a bassline in the style of a march')
  check('turning it off puts the barrier back', assistCalls === after,
    `${assistCalls - after} calls`)
}

await browser.close()
console.log(failures
  ? `\n${failures} failing — a command could spend credits unconfirmed`
  : '\nnothing reaches the assistant without being confirmed')
process.exit(failures ? 1 : 0)
