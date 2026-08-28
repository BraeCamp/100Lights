#!/usr/bin/env node
/**
 * Does the Plugin menu open, in the right order, and does Apollo still open?
 *
 *   PORT=4620 node scripts/check-plugin-menu.mjs
 *
 * This menu replaced the transport bar's Apollo button, so the ways it breaks
 * are not crashes. Apollo becomes unreachable; or the built-in synth ends up
 * below three third-party plugins; or "Add Plugin" quietly isn't rendered; or
 * the button opens a menu but choosing Apollo no longer opens Apollo — which
 * is the entire cost of having changed it. A screenshot shows none of that,
 * so the order and the outcome are asserted.
 */

import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4620'}`
let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, {
  waitUntil: 'domcontentloaded', timeout: 180000,
})
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 }).catch(() => {})
await page.waitForTimeout(3500)

// The first-run "choose your setup" dialog sits over everything.
const dlg = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
if (await dlg.count()) {
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Choose your studio setup"]')
    const b = d && [...d.querySelectorAll('button,div[role=button]')].find(e => /Everything/i.test(e.textContent || ''))
    b?.click()
  })
  await dlg.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
}
await page.waitForTimeout(1500)

// The menu lives in the transport bar, where the Apollo button used to be. No
// track is needed: choosing anything creates one, which is what the old button
// did and the reason a new user's first click does something.
const btn = page.locator('button[aria-haspopup="menu"]')
const found = await btn.count()
check('the plugin menu is in the transport bar', found > 0, `${found} menu buttons`)

if (found) {
  const label = ((await btn.first().textContent()) || '').trim()
  check('and it still reads APOLLO by default', /APOLLO/i.test(label), `"${label}"`)

  await btn.first().click()
  await page.waitForTimeout(1400)

  const rows = await page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]')
    if (!menu) return null
    return [...menu.querySelectorAll('[role="menuitem"]')]
      .map(e => (e.textContent || '').trim()).filter(Boolean)
  })
  check('it opens a menu', Array.isArray(rows) && rows.length > 0,
    rows ? `${rows.length} items` : 'no [role=menu] appeared')

  if (rows?.length) {
    console.log('\n  menu:')
    for (const r of rows) console.log(`    ${r}`)
    console.log()
    check('Apollo is the FIRST entry', /^Apollo/.test(rows[0]), rows[0])
    check('"Add Plugin" is the LAST entry', /Add Plugin/i.test(rows.at(-1) || ''), rows.at(-1))
    check('registry plugins are listed between them', rows.slice(1, -1).length > 0,
      rows.slice(1, -1).join(' | ') || 'none — is /plugins/<id>/beacon-plugin.json served?')
    check('Luz is one of them', rows.some(r => /luz/i.test(r)), rows.join(' | '))

    // Choosing Apollo must still open Apollo. That is what this button did
    // before it grew a menu; breaking it would be the whole cost of the change.
    await page.evaluate(() => {
      const first = document.querySelector('[role="menu"] [role="menuitem"]')
      first?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    await page.waitForTimeout(3000)
    check('the menu closed after choosing', (await page.locator('[role="menu"]').count()) === 0)
    const apolloOpen = await page.locator('[data-apollo-board], [data-apollo-card]').count()
    check('choosing Apollo opens Apollo', apolloOpen > 0, `${apolloOpen} apollo surfaces`)
  }
}

await page.screenshot({ path: '/tmp/plugin-menu.png' })
console.log('\nscreenshot: /tmp/plugin-menu.png')
await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe plugin menu works')
process.exit(failures ? 1 : 0)
