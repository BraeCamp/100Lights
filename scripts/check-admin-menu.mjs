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

// 4. Stopping ends the capture but KEEPS the report.
//
// Brae: "when I stop recording for the one that's there, allow me to copy the
// analysis if another recording has not been created." Stopping used to throw
// the capture away, so the natural order — stop, then decide to send it — lost
// the very thing you stopped to look at.
await menuBtn.first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /stop watching/i }).first().click()
await page.waitForTimeout(800)

await menuBtn.first().click()
await page.waitForTimeout(400)
const copyLast = page.getByRole('button', { name: /copy last report/i })
check('after stopping, the last report is still offered', await copyLast.count() > 0)
if (await copyLast.count()) {
  await page.evaluate(() => navigator.clipboard.writeText('cleared'))
  await copyLast.first().click()
  await page.waitForTimeout(1000)
  const kept = await page.evaluate(async () => {
    try { return await navigator.clipboard.readText() } catch { return 'unreadable' }
  })
  let keptOk = false
  try { keptOk = !!JSON.parse(kept).audioClockRate } catch { /* not json */ }
  check('and copying it gives the finished capture, not an error string', keptOk, kept.slice(0, 50))
}

// Starting a new capture must retire the old one, or you could send a stale
// report alongside a fresh recording without noticing.
await menuBtn.first().click()
await page.waitForTimeout(400)
await page.getByRole('button', { name: /start watching/i }).first().click()
await page.waitForTimeout(800)
await menuBtn.first().click()
await page.waitForTimeout(400)
check('a new capture retires the kept one',
  await page.getByRole('button', { name: /copy last report/i }).count() === 0)
await page.getByRole('button', { name: /stop watching/i }).first().click()
await page.waitForTimeout(600)

// 5. The other admin tools.
await menuBtn.first().click()
await page.waitForTimeout(400)
check('the menu offers the render cache', await page.getByRole('button', { name: /clear render cache/i }).count() > 0)
check('the menu offers a mix bounce', await page.getByRole('button', { name: /bounce mix to wav/i }).count() > 0)

await page.getByRole('button', { name: /copy build info/i }).first().click()
await page.waitForTimeout(1000)
const build = await page.evaluate(async () => {
  try { return await navigator.clipboard.readText() } catch { return 'unreadable' }
})
let buildJson = null
try { buildJson = JSON.parse(build) } catch { /* not json */ }
console.log(`  build info: ${buildJson ? `${buildJson.commit}, Apollo ${buildJson.apolloEngine}` : build.slice(0, 40)}`)
check('build info says which commit and engine are running',
  !!buildJson?.commit && !!buildJson?.apolloEngine && !!buildJson?.renderCache,
  buildJson ? Object.keys(buildJson).join(', ') : build.slice(0, 40))

// Clearing the cache has to actually empty it, not just say so.
//
// Read it straight away. Waiting 2.5s measured 3 clips still cached and looked
// like a failure, but baking resumes the moment the transport is stopped — so
// that was the cache correctly REFILLING, not failing to clear. The claim is
// that it empties, not that it stays empty.
await menuBtn.first().click()
await page.waitForTimeout(400)
const readyBefore = await page.evaluate(() => window.__combineStats?.().ready ?? -1)
await page.getByRole('button', { name: /clear render cache/i }).first().click()
await page.waitForTimeout(150)
const readyAfter = await page.evaluate(() => window.__combineStats?.().ready ?? -1)
console.log(`  render cache ${readyBefore} -> ${readyAfter} clips`)
check('clearing the render cache empties it', readyAfter === 0 && readyBefore > 0,
  `${readyBefore} -> ${readyAfter}`)

// 6. The bounce has to produce an actual file — base64 to blob to download is
//    three places it can silently fail, and "the button exists" proves none of
//    them. Done on a DELIBERATELY TINY project: renderWav renders the whole
//    song offline, so bouncing the nine-track fixture would take minutes here.
if (existsSync(FIXTURE)) {
  const full = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject
  const oneTrack = full.tracks[0]
  const tiny = {
    ...full,
    name: 'Bounce Test',
    tracks: [oneTrack],
    arrangementClips: (full.arrangementClips ?? [])
      .filter(c => c.trackId === oneTrack.id)
      .slice(0, 1)
      .map(c => ({ ...c, startBeat: 0, durationBeats: 4, notes: (c.notes ?? []).slice(0, 1) })),
  }
  await page.evaluate(t => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: t }), tiny)
  await page.waitForTimeout(3000)

  await menuBtn.first().click()
  await page.waitForTimeout(400)
  const dl = page.waitForEvent('download', { timeout: 120000 }).catch(() => null)
  await page.getByRole('button', { name: /bounce mix to wav/i }).first().click()
  const file = await dl
  check('bouncing downloads a file', !!file, file ? await file.suggestedFilename() : 'no download')
  if (file) {
    const path = await file.path()
    const head = path ? readFileSync(path).subarray(0, 12) : Buffer.alloc(0)
    const isWav = head.subarray(0, 4).toString() === 'RIFF' && head.subarray(8, 12).toString() === 'WAVE'
    console.log(`  downloaded ${await file.suggestedFilename()}, ${path ? readFileSync(path).length : 0} bytes`)
    check('and the file is a real WAV', isWav, head.subarray(0, 4).toString())
  }
}

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe admin menu is admin-only and its tools work')
process.exit(failures ? 1 : 0)
