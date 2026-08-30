#!/usr/bin/env node
/**
 * The voice window, and the HUD.
 *
 *   PORT=4669 node scripts/check-voice-panel.mjs
 *
 * Brae: "create a windowed panel that opens when voice control is activated? It
 * will have its settings, what the user says, responses, and anything else...
 * Add a button that toggles HUD. When that is pressed, it will get rid of
 * everything but the song and Apollo's sound visuals."
 *
 * Two claims that are easy to make and easy to get subtly wrong: that the panel
 * shows BOTH sides of the conversation (not just the last thing that happened),
 * and that HUD actually removes chrome from the page rather than merely setting
 * an attribute nothing reads.
 */

import { chromium } from 'playwright'

const BASE = process.env.BASE || `http://localhost:${process.env.PORT || '4700'}`

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-capture', '--use-fake-ui-for-media-stream'],
})
const context = await browser.newContext({ permissions: ['microphone'] })
const page = await context.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 140)))

await page.route('**/api/ai/assist*', r =>
  r.fulfill({ status: 200, contentType: 'application/json', body: '{"calls":[]}' }))
await page.addInitScript(() => {
  try {
    localStorage.setItem('100lights-ui-tier', 'full')
    localStorage.setItem('beacon.voice.transcriber', 'server')
    localStorage.setItem('beacon.voice.mode', 'toggle')
    // NOT the HUD setting. addInitScript runs on every navigation including the
    // reload below, so forcing it here would wipe the choice this test is about
    // to make and then blame the app for not remembering it. Unset means off.
  } catch { /* private mode */ }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
await page.waitForTimeout(2000)

const panel = page.locator('[data-voice-panel]')
const typeBtn = page.locator('button[title="Type a command instead of speaking"]')
const typeField = page.locator('input[placeholder*="loop bass"]').first()

async function say(sentence) {
  if (!(await typeField.isVisible().catch(() => false))) await typeBtn.click()
  await typeField.waitFor({ state: 'visible', timeout: 15000 })
  await typeField.fill(sentence)
  await typeField.press('Enter')
  await page.waitForTimeout(1200)
}

// ── The settings gear opens the window ─────────────────────────────────────
check('the window is not there to begin with', (await panel.count()) === 0)
await page.locator('button[aria-label="Voice settings"]').click()
await page.waitForTimeout(700)
check('the gear opens it', (await panel.count()) > 0)
check('and lands on the settings', /Hold the button to speak/i.test(await panel.innerText()))

// ── It shows both sides of the conversation ────────────────────────────────
await panel.getByText('Conversation', { exact: false }).click()
await page.waitForTimeout(300)
await say('set the tempo to 132')
{
  const text = await panel.innerText()
  check('what you said is in the window', /set the tempo to 132/i.test(text), text.slice(0, 120))
  check('and what it said back', /132\s*BPM/i.test(text), text.slice(0, 160))
}
await say('mute the drums')
{
  const text = await panel.innerText()
  // The point of a transcript: the earlier exchange is STILL THERE. The
  // popovers this replaced showed one thing at a time and overwrote it.
  check('and the previous exchange is still there',
    /set the tempo to 132/i.test(text) && /mute the drums/i.test(text),
    text.replace(/\s+/g, ' ').slice(0, 160))
}

// ── The commands it knows are listed in it ─────────────────────────────────
await panel.getByText('What you can say', { exact: false }).click()
await page.waitForTimeout(300)
{
  const text = await panel.innerText()
  check('the window lists what you can say',
    /TRANSPORT/i.test(text) && /QUESTIONS/i.test(text), text.slice(0, 100))
}

// ── It is a card, and it moves ─────────────────────────────────────────────
//
// Brae: "let's move the voice dropdown so that it's a card that can be moved."
//
// A dropdown is anchored to the button that opened it, which is fine for a menu
// and wrong for something read while working: it sits over the arrangement, in
// the one place it cannot be moved away from.
{
  const bar = panel.locator('div').first()
  const before = await panel.boundingBox()
  await bar.hover()
  await page.mouse.down()
  await page.mouse.move(300, 400, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = await panel.boundingBox()
  check('the card can be dragged somewhere else',
    !!before && !!after && Math.abs(after.x - before.x) > 40,
    `${Math.round(before?.x ?? 0)} → ${Math.round(after?.x ?? 0)}`)

  // Remembered, or moving it is something you do once per page load.
  const moved = await page.evaluate(() => localStorage.getItem('beacon.voice.panel-position'))
  check('and where it was left is remembered', !!moved, String(moved))

  // Double-click puts it back, for a card dragged somewhere unhelpful.
  await bar.dblclick()
  await page.waitForTimeout(400)
  const home = await page.evaluate(() => localStorage.getItem('beacon.voice.panel-position'))
  check('double-clicking the bar puts it back', home === null, String(home))
}

// ── The microphone check ───────────────────────────────────────────────────
{
  await panel.getByText('Settings', { exact: false }).click()
  await page.waitForTimeout(300)
  const text = await panel.innerText()
  check('the panel offers a microphone check', /RUN A CHECK/i.test(text))
  check('and says what it is for',
    /which part is the problem/i.test(text), text.slice(0, 120))
}

// ── HUD ────────────────────────────────────────────────────────────────────
const sidebar = page.locator('[data-hud-hide]').first()
check('the studio chrome is there to begin with', await sidebar.isVisible())

await panel.locator('button', { hasText: 'HUD' }).first().click()
await page.waitForTimeout(600)
check('HUD hides the chrome', !(await sidebar.isVisible()))
check('and the window itself stays, or there is no way back',
  (await panel.count()) > 0)
check('the song is still there', await page.locator('[data-editor="true"]').first().isVisible())

await panel.locator('button', { hasText: 'HUD' }).first().click()
await page.waitForTimeout(600)
check('and pressing it again brings the studio back', await sidebar.isVisible())

// ── It is remembered ───────────────────────────────────────────────────────
await panel.locator('button', { hasText: 'HUD' }).first().click()
await page.waitForTimeout(600)
// Asserted before the reload, so a failure below says which half broke: the
// setting not being saved, or the saved setting not being applied.
check('turning it on records the choice',
  (await page.evaluate(() => localStorage.getItem('beacon.voice.hud'))) === 'on',
  String(await page.evaluate(() => localStorage.getItem('beacon.voice.hud'))))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
await page.waitForTimeout(2500)
check('HUD survives a reload',
  !(await page.locator('[data-hud-hide]').first().isVisible()),
  'it is a mode, not a moment')

await browser.close()
console.log(failures
  ? `\n${failures} failing`
  : '\nthe window shows the conversation, and the HUD clears the room')
process.exit(failures ? 1 : 0)
