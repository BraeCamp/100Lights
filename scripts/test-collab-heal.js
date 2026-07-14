// Divergence self-heal test: bob drops one of alice's broadcasts (simulated
// packet loss via the dev fault hook), the periodic fingerprint exchange
// notices, and bob auto-resyncs without a reload.
/* eslint-disable @typescript-eslint/no-require-imports */
const { chromium } = require('playwright-core')

const projectId = process.argv[2]
if (!projectId) { console.error('usage: node test-collab-heal.js <projectId>'); process.exit(1) }
const URL = `http://localhost:3000/projects/${projectId}`
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function openClient(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  await context.route('http://localhost:3000/**', route =>
    route.continue({ headers: { ...route.request().headers(), 'x-test-user': name } })
  )
  const page = await context.newPage()
  page.on('pageerror', err => console.log(`[${name}] pageerror:`, err.message))
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-editor="true"]').waitFor({ timeout: 30000 })
  const discard = page.getByRole('button', { name: /discard/i }).first()
  if (await discard.isVisible().catch(() => false)) await discard.click()
  return { context, page, name }
}

const trackCount = page => page.evaluate(() => window.__daw?._tracks?.length ?? -1)

async function main() {
  const browser = await chromium.launch({ headless: true })
  const alice = await openClient(browser, 'alice')
  await sleep(4000)
  const bob = await openClient(browser, 'bob')
  await sleep(4000)

  const a0 = await trackCount(alice.page)
  const b0 = await trackCount(bob.page)
  if (a0 !== b0) throw new Error(`not in sync at start: ${a0} vs ${b0}`)
  console.log(`in sync at ${a0} tracks`)

  // Simulate a dropped packet: bob discards alice's next action
  await bob.page.evaluate(() => { window.__collabDropNextAction = true })
  await alice.page.locator('[data-help-id="add-track"]').first().click()
  await sleep(1500)
  const a1 = await trackCount(alice.page)
  const b1 = await trackCount(bob.page)
  console.log(`after dropped broadcast — alice: ${a1}, bob: ${b1}`)
  if (b1 !== a1 - 1) throw new Error('drop simulation failed (bob was not diverged)')
  console.log('PASS divergence induced (bob is one track behind)')

  // Fingerprints fire every ~20-24s; two mismatches trigger resync. Allow 75s.
  const t0 = Date.now()
  while (Date.now() - t0 < 75000) {
    const b = await trackCount(bob.page)
    if (b === a1) {
      console.log(`PASS self-heal: bob recovered to ${b} tracks in ${((Date.now() - t0) / 1000).toFixed(0)}s without reloading`)
      console.log('ALL PASS')
      await browser.close()
      return
    }
    await sleep(2000)
  }
  throw new Error('FAIL: bob never self-healed')
}

main().catch(e => { console.error(String(e)); process.exit(1) })
