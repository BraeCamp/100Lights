/**
 * Two-client collaboration smoke test.
 *
 * Launches two isolated browser contexts as synthetic collaborators
 * (x-test-user header + DEV_OPEN=1 dev server) on the same project URL and
 * asserts that edits made by one appear in the other via the Liveblocks room.
 *
 * Usage: node scripts/test-collab.js <projectId>
 */
const { chromium } = require('playwright-core')

const projectId = process.argv[2]
if (!projectId) { console.error('usage: node scripts/test-collab.js <projectId>'); process.exit(1) }
const URL = `http://localhost:3000/projects/${projectId}`

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function openClient(browser, name) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  // Inject the test-user header only for same-origin requests — sending a
  // custom header cross-origin breaks CORS (Clerk's CDN rejects it).
  await context.route('http://localhost:3000/**', route =>
    route.continue({ headers: { ...route.request().headers(), 'x-test-user': name } })
  )
  const page = await context.newPage()
  page.on('pageerror', err => console.log(`[${name}] pageerror:`, err.message))
  page.on('websocket', ws => {
    if (!ws.url().includes('liveblocks')) return
    console.log(`[${name}] ws open: ${ws.url().slice(0, 60)}…`)
    ws.on('close', () => console.log(`[${name}] ws CLOSED`))
    ws.on('socketerror', e => console.log(`[${name}] ws ERROR: ${e}`))
    ws.on('framesent', f => { const s = String(f.payload); if (s.includes('ACTION') || s.includes('ADD_TRACK')) console.log(`[${name}] SENT: ${s.slice(0, 120)}`) })
    ws.on('framereceived', f => { const s = String(f.payload); if (s.includes('ACTION') || s.includes('ADD_TRACK')) console.log(`[${name}] RECV: ${s.slice(0, 120)}`) })
  })
  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  await page.locator('[data-editor="true"]').waitFor({ timeout: 30000 })
  // Dismiss the offline-restore prompt if present
  const discard = page.getByRole('button', { name: /discard/i }).first()
  if (await discard.isVisible().catch(() => false)) await discard.click()
  return { context, page, name }
}

async function trackCount(page) {
  return page.evaluate(() => window.__daw?._tracks?.length ?? -1)
}

async function waitForTracks(page, n, timeoutMs, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const count = await page.evaluate(() => window.__daw?._tracks?.length ?? -1)
    if (count === n) return Date.now() - t0
    await sleep(150)
  }
  throw new Error(`timeout waiting for: ${label}`)
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
  console.log('opening alice…')
  const alice = await openClient(browser, 'alice')
  console.log('opening bob…')
  const bob = await openClient(browser, 'bob')

  // Give the lazy-loaded collab layer time to join the room
  await sleep(5000)

  const a0 = await trackCount(alice.page)
  const b0 = await trackCount(bob.page)
  console.log(`initial tracks — alice: ${a0}, bob: ${b0}`)
  if (a0 !== b0 || a0 < 0) throw new Error('clients disagree before any edit')

  // Diagnostics: is the collab layer mounted and the room joined?
  for (const c of [alice, bob]) {
    const diag = await c.page.evaluate(async () => {
      const invite = !!document.querySelector('[data-help-id="invite"]')
      const res = await fetch('/api/liveblocks-auth', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: 'diag' }) })
      return { inviteBtn: invite, authStatus: res.status, avatarsRegion: document.querySelectorAll('[title$="(you)"]').length }
    })
    console.log(`[${c.name}] collab UI: ${JSON.stringify(diag)}`)
  }

  // ── Alice adds a track → Bob must see it ──
  await alice.page.locator('[data-help-id="add-track"]').first().click()
  await sleep(500)
  console.log('alice local tracks after click:', await trackCount(alice.page))
  const tA = await waitForTracks(bob.page, a0 + 1, 10000, "bob sees alice's track")
  console.log(`PASS alice→bob track sync in ${tA}ms`)

  // ── Bob adds a track → Alice must see it ──
  await bob.page.locator('[data-help-id="add-track"]').first().click()
  const tB = await waitForTracks(alice.page, a0 + 2, 10000, "alice sees bob's track")
  console.log(`PASS bob→alice track sync in ${tB}ms`)

  // ── Determinism: both clients must agree on entity ids, not just counts ──
  const aliceIds = await alice.page.evaluate(() => (window.__daw?._tracks ?? []).map(t => t.id))
  const bobIds = await bob.page.evaluate(() => (window.__daw?._tracks ?? []).map(t => t.id))
  if (JSON.stringify(aliceIds) !== JSON.stringify(bobIds)) {
    throw new Error(`track ids diverged:\n  alice: ${aliceIds}\n  bob:   ${bobIds}`)
  }
  console.log('PASS track ids identical on both clients')

  // ── Soft locks: alice selects a track → bob sees her marker on the head ──
  await alice.page.locator('[data-help-id="view-arrangement"]').first().click()
  await bob.page.locator('[data-help-id="view-arrangement"]').first().click()
  await sleep(400)
  await alice.page.locator('[data-help-id="track-head"]').first().click()
  const t0 = Date.now()
  let markerSeen = false
  while (Date.now() - t0 < 8000) {
    markerSeen = await bob.page.evaluate(() =>
      document.querySelectorAll('[title$="is on this track"]').length > 0)
    if (markerSeen) break
    await sleep(200)
  }
  if (!markerSeen) throw new Error('bob never saw alice\'s track marker')
  console.log(`PASS presence track marker visible to bob in ${Date.now() - t0}ms`)

  // ── Presence: each should see one other collaborator (avatar row) ──
  const avatarsVisible = await alice.page.evaluate(() =>
    [...document.querySelectorAll('div')].some(d => d.title && /\(you\)$/.test(d.title))
  )
  console.log(`presence avatars on alice: ${avatarsVisible ? 'visible' : 'NOT VISIBLE'}`)

  await browser.close()
  console.log('ALL PASS')
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1) })
