#!/usr/bin/env node
// The admin-only diagnostics menu: hidden from everyone else, and it works.
//
//   node scripts/check-admin-menu.mjs [baseUrl]
//
// Brae: "Can you add a button to run diagnose? It would only be for admin
// accounts and it would live in a dropdown with admin only options."
//
// Two claims, and the first one matters more: a tool that leaks to every user
// is worse than no tool. A signed-out visitor must not see it at all. Then the
// button has to actually capture a report — a button that opens a menu and
// produces nothing is the console instruction with extra steps.

import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const BASE = process.argv[2]?.replace(/\/$/, '') || `http://localhost:${process.env.PORT || '4618'}`
const FIXTURE = join(homedir(), 'Desktop', '100lights-ai-renders', 'Hallway Light.cfproj')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({ args: ['--mute-audio'] })
const ctx = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] })
const page = await ctx.newPage()
page.on('pageerror', e => console.log('  page error:', e.message))

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
const dialog = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
await dialog.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
if (await dialog.count()) {
  await dialog.getByRole('button', { name: /Everything|Standard/i }).first().click().catch(() => {})
  await dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
}
await page.waitForTimeout(1500)

// 1. Signed out is not an admin.
const seenByGuest = await page.locator('[data-admin-menu]').count()
check('a signed-out visitor cannot see the admin menu', seenByGuest === 0, `${seenByGuest} found`)

// 2. Now BE the admin. Clerk cannot be signed in headlessly, so useIsAdmin has
//    a development-only override; without it this check could only ever prove
//    the menu is hidden, which would pass just as well if the menu did not
//    exist at all. An earlier version of this file set the flag and asserted it
//    was set — which tested nothing.
await page.addInitScript(() => { window.__forceAdmin = true })
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(10000)
const dlg2 = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
if (await dlg2.count()) {
  await dlg2.getByRole('button', { name: /Everything|Standard/i }).first().click().catch(() => {})
  await dlg2.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
}
await page.waitForTimeout(1500)
const menuBtn = page.locator('[data-admin-menu]')
check('an admin does see the menu', await menuBtn.count() > 0, `${await menuBtn.count()} found`)

// 3. The diagnostic the menu drives has to exist and produce a real report,
//    whether it is reached from a button or the console.
if (existsSync(FIXTURE)) {
  const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject
  await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), dawProject)
  await page.waitForTimeout(4000)
}
// Drive it the way Brae will: open the menu, click Start watching.
await menuBtn.first().click()
await page.waitForTimeout(500)
const startItem = page.getByRole('button', { name: /start watching/i })
check('the menu offers a way to start', await startItem.count() > 0)
await startItem.first().click()
await page.waitForTimeout(1200)
check('the button starts a capture (the menu says so)',
  /ADMIN\s*\d+s/.test((await menuBtn.first().innerText()).trim()),
  (await menuBtn.first().innerText()).trim())

const playBtn = page.locator('button[title="Play / Stop (Space)"]').first()
if (await playBtn.count()) await playBtn.click()
await page.waitForTimeout(12000)

// Copy the report through the BUTTON, and read what actually reached the
// clipboard — that is the whole deliverable.
await menuBtn.first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /copy report/i }).first().click()
await page.waitForTimeout(1200)
const report = await page.evaluate(async () => {
  try { return await navigator.clipboard.readText() } catch { return 'clipboard-unreadable' }
})
await page.evaluate(() => window.__dawEngine?.stop())
let parsed = null
try { parsed = JSON.parse(report) } catch { /* string means it refused */ }
check('the report is real data, not a message', !!parsed, String(report).slice(0, 60))
if (parsed) {
  console.log(`  clock ${parsed.audioClockRate}x, master peak ${parsed.master?.peak}, ${Object.keys(parsed.tracks || {}).length} tracks`)
  check('the report carries what it is for',
    'audioClockRate' in parsed && 'tracks' in parsed && 'longestStallMs' in parsed
    && parsed.master?.everSounded === true,
    Object.keys(parsed).join(', '))
}

// 4. Stopping actually stops, again through the menu.
await menuBtn.first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /stop watching/i }).first().click()
await page.waitForTimeout(600)
const afterStop = await page.evaluate(() => {
  const r = window.__dawDiagnose.report()
  return typeof r === 'string' ? r : 'still-reporting'
})
check('stopping ends the capture', /not watching/i.test(afterStop), afterStop.slice(0, 40))

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe admin menu is admin-only and its diagnostics work')
process.exit(failures ? 1 : 0)
