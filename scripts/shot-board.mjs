// Screenshots the board, for looking at UI changes without a browser open.
//   PORT=4620 node scripts/shot-board.mjs
import { chromium } from 'playwright'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = `http://localhost:${process.env.PORT || '4620'}`
const b = await chromium.launch()
const p = await b.newPage({ viewport: { width: 1400, height: 1000 } })
await p.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 120000 })
await p.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 180000 }).catch(() => {})
await p.waitForTimeout(4000)
const dlg = p.locator('[role="dialog"][aria-label="Choose your studio setup"]')
await dlg.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {})
if (await dlg.count()) {
  await p.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Choose your studio setup"]')
    const x = d && [...d.querySelectorAll('button,div[role=button]')].find(e => /Everything/i.test(e.textContent || ''))
    x?.click()
  })
  await dlg.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
}
await p.waitForTimeout(1500)
await p.evaluate(() => {
  const x = [...document.querySelectorAll('button')].find(e => /apollo/i.test((e.textContent || '').trim()))
  x?.click()
})
await p.waitForSelector('[data-apollo-board]', { timeout: 30000 }).catch(() => {})
await p.waitForTimeout(2500)
const OUT = tmpdir()
await p.screenshot({ path: join(OUT, 'board-closed.png') })

// Open two neighbours so the "join into a rack" behaviour is visible.
for (const id of ['osc', 'subnoise']) {
  await p.evaluate(m => {
    const bar = document.querySelector(`[data-module-bar="${m}"]`)
    bar?.querySelector('button')?.click()
  }, id)
  await p.waitForTimeout(1200)
}
await p.waitForTimeout(1500)
await p.screenshot({ path: join(OUT, 'board-open.png') })
await b.close()
console.log(join(OUT, 'board-closed.png'), join(OUT, 'board-open.png'))
