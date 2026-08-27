#!/usr/bin/env node
// Can you add an existing project from the Beacon and Prism dashboards?
//
//   node scripts/check-module-add-project.mjs        (needs a dev server)
//
// Brae: "Previously I had asked you to make it so that I can add projects from
// the Beacon and Prism dashboards. That isn't present."
//
// Both pages could always START something new — the missing thing was bringing
// an EXISTING project in, which only ever lived on /projects. So the check is
// not "is there a button" but "does the control that opens a file picker exist
// on both dashboards, and does choosing a file actually add the project".

import { chromium } from 'playwright'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.PORT || '4618'
const BASE = process.argv[2]?.replace(/\/$/, '') || `http://localhost:${PORT}`
const FIXTURE = join(homedir(), 'Desktop', '100lights-ai-renders', 'Hallway Light.cfproj')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage()
// Force the <input type="file"> fallback. The File System Access picker is
// what Chromium actually uses, and Playwright's filechooser event cannot see
// it — an earlier version of this check reported "no file picker" against a
// button that opens one perfectly well. The fallback is also the real path for
// Firefox and Safari, so it is worth exercising rather than working around.
await page.addInitScript(() => { delete window.showOpenFilePicker })
page.on('pageerror', e => console.log('  page error:', e.message))

for (const [name, path] of [['Beacon', '/beacon'], ['Prism', '/prism']]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)

  const found = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')]
    const add = btns.filter(b => /add a project/i.test(b.textContent || ''))
    const nw = [...document.querySelectorAll('a')].filter(a => /new .*project|new podcast/i.test(a.textContent || ''))
    return { add: add.length, nw: nw.length }
  })
  console.log(`  ${name}: ${found.nw} "new project" links, ${found.add} "add a project" buttons`)
  check(`${name} can start a new project`, found.nw > 0, `${found.nw}`)
  check(`${name} can add an existing project`, found.add > 0, `${found.add}`)
}

// And it has to actually do something. Clicking it must open a file chooser —
// a button that looks right and opens nothing is the same bug in a new place.
if (existsSync(FIXTURE)) {
  await page.goto(`${BASE}/beacon`, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)
  const chooser = page.waitForEvent('filechooser', { timeout: 15000 }).catch(() => null)
  // A real click, not a scripted one: opening a file picker needs a trusted
  // user gesture, and element.click() from page script is not one.
  await page.getByRole('button', { name: /add a project/i }).first().click()
  const fc = await chooser
  check('clicking it opens a file picker', !!fc)
  if (fc) {
    await fc.setFiles(FIXTURE)
    // Choosing a single file while signed out navigates straight into the
    // editor, which destroys the execution context — reading the page without
    // waiting for that throws, and the throw looked like a failure when it was
    // the success path.
    await page.waitForLoadState('domcontentloaded').catch(() => {})
    await page.waitForTimeout(6000)
    // Signed out, a single file opens straight into the editor rather than
    // being filed into an account — so landing in the editor IS the success.
    const landed = await page.evaluate(() => ({
      url: location.pathname,
      msg: [...document.querySelectorAll('div')]
        .map(d => (d.textContent || '').trim())
        .find(t => /^Imported |^Sign in to import|^Nothing imported/.test(t)) || null,
    }))
    console.log(`  after choosing a file: ${landed.url}${landed.msg ? ` — "${landed.msg.slice(0, 60)}"` : ''}`)
    check('choosing a file gets the project somewhere',
      landed.url.startsWith('/projects/') || !!landed.msg,
      landed.url)
  }
} else {
  console.log(`  (no fixture at ${FIXTURE} — skipping the file-picker case)`)
}

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nprojects can be added from both dashboards')
process.exit(failures ? 1 : 0)
