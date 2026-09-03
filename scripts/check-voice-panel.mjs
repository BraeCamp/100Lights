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
// The speaking mode is a segmented control now, so the tab is identified by
// what it OFFERS rather than by one option's old full-sentence label.
check('and lands on the settings', /Keep listening/i.test(await panel.innerText()))

// ── It shows what is being said, and what came back ───────────────────────
//
// The scrolling transcript is gone. Brae: "change the conversation tab (which
// is now just the card) so that it only shows what you're saying right now."
//
// So the assertion changes with it: the previous exchange is no longer expected
// to survive, and checking that it does would be pinning behaviour the card
// deliberately dropped. What must hold is that the CURRENT one is legible.
await page.evaluate(() => {
  const p = document.querySelector('[data-voice-panel]')
  const back = p && [...p.querySelectorAll('button')].find(x => /^Settings$/.test(x.textContent.trim()))
  back?.click()   // out of help, if a previous block left it there
})
await page.evaluate(() => {
  const p = document.querySelector('[data-voice-panel]')
  const gear = p && p.querySelector('button[aria-label="Back"]')
  gear?.click()   // the gear toggles back to the live view
})
await page.waitForTimeout(300)
await say('set the tempo to 132')
{
  const text = await panel.innerText()
  check('what it said back is in the window', /132\s*BPM/i.test(text), text.slice(0, 160))
}

// ── The command list is reached from Settings, not from a tab ─────────────
//
// Brae: "'What you can say' shouldn't be there for AI mode so have it as a
// button in settings near the program transcribe button." It sits under the
// two AI controls, because it describes exactly what those controls decide
// whether you are relying on.
await page.evaluate(() => {
  const p = document.querySelector('[data-voice-panel]')
  p?.querySelector('button[aria-label="Settings"]')?.click()
})
await page.waitForTimeout(400)
await page.evaluate(() => {
  const p = document.querySelector('[data-voice-panel]')
  const b = p && [...p.querySelectorAll('button')].find(x => /What you can say/i.test(x.textContent || ''))
  b?.click()
})
await page.waitForTimeout(400)
{
  const text = await panel.innerText()
  check('the window lists what you can say',
    /TRANSPORT/i.test(text) && /QUESTIONS/i.test(text), text.slice(0, 100))
  check('and there is a way back to settings', /Settings/i.test(text))
}

// ── The HUD button is gone from the title bar ─────────────────────────────
//
// Brae: "remove the hud button". The setting itself stays in Settings — this
// asserts it left the row it shared with Close, which is a lot of prominence
// for a mode used once a session.
{
  const bar = await page.evaluate(() => {
    const p = document.querySelector('[data-voice-panel]')
    return p ? p.firstElementChild?.textContent ?? '' : ''
  })
  check('no HUD button in the title bar', !/HUD/i.test(bar), JSON.stringify(bar.slice(0, 60)))
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
  // Renamed from "Check the microphone" when it stopped picking one of four
  // presets and started setting the bar from what it actually measured.
  check('the panel offers a microphone check', /Calibrate to my voice/i.test(text))
  check('and says what it is for',
    /which part is the problem/i.test(text), text.slice(0, 120))
}

// ── HUD ────────────────────────────────────────────────────────────────────
//
// The title-bar button is gone (Brae: "remove the hud button"), so this drives
// the switch in Settings instead. Same mode, same assertions — only the door
// moved, which is exactly the distinction these checks should be able to tell
// apart from the feature being removed.
const hudSwitch = async () => {
  await page.evaluate(() => {
    const p = document.querySelector('[data-voice-panel]')
    if (!p.querySelector('button[role="switch"][aria-label="HUD"]')) {
      p.querySelector('button[aria-label="Settings"]')?.click()
    }
  })
  await page.waitForTimeout(350)
  await page.evaluate(() => {
    document.querySelector('[data-voice-panel] button[role="switch"][aria-label="HUD"]')?.click()
  })
  await page.waitForTimeout(600)
}
const sidebar = page.locator('[data-hud-hide]').first()
check('the studio chrome is there to begin with', await sidebar.isVisible())

await hudSwitch()
check('HUD hides the chrome', !(await sidebar.isVisible()))
check('and the window itself stays, or there is no way back',
  (await panel.count()) > 0)
check('the song is still there', await page.locator('[data-editor="true"]').first().isVisible())

await hudSwitch()
check('and pressing it again brings the studio back', await sidebar.isVisible())

// ── It is remembered ───────────────────────────────────────────────────────
await hudSwitch()
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
