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
  await sleep(4000)  // alice joins the room

  // ── Late-join sync: alice edits BEFORE bob joins ──
  const aStart = await trackCount(alice.page)
  await alice.page.locator('[data-help-id="add-track"]').first().click()
  await sleep(300)
  await alice.page.locator('[data-help-id="add-track"]').first().click()
  await sleep(500)
  const aPre = await trackCount(alice.page)
  console.log(`alice edited before bob joined: ${aStart} → ${aPre} tracks (unsaved)`) 

  console.log('opening bob…')
  const bob = await openClient(browser, 'bob')
  const tJoin = await waitForTracks(bob.page, aPre, 15000, 'bob catches up to live (unsaved) state after joining')
  console.log(`PASS late-join sync: bob caught up to ${aPre} tracks in ${tJoin}ms`)

  const a0 = await trackCount(alice.page)
  const b0 = await trackCount(bob.page)
  console.log(`tracks — alice: ${a0}, bob: ${b0}`)
  if (a0 !== b0 || a0 < 0) throw new Error('clients disagree after join sync')

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

  // ── DUPLICATE_TRACK determinism: nested ids must match across clients ──
  await alice.page.locator('[data-help-id="track-head"]').first().click({ button: 'right' })
  await sleep(300)
  await alice.page.getByRole('button', { name: 'Duplicate' }).first().click()
  const dupTarget = (await trackCount(alice.page))
  await waitForTracks(bob.page, dupTarget, 8000, 'bob sees duplicated track')
  console.log(`PASS duplicate synced (now ${dupTarget} tracks)`)

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

  // ── Recorded audio syncs: alice JAMs a take → bob can PLAY it ──
  // (metronome + play + JAM produces a real clip; eager upload attaches an
  // r2Key that bob's engine resolves via signed URL)
  await alice.page.locator('[data-help-id="metronome"]').first().click()
  await alice.page.locator('[data-help-id="rewind"]').first().click()
  await alice.page.locator('[data-help-id="play"]').first().click()
  await sleep(3000)
  await alice.page.locator('[data-help-id="jam"]').first().click()
  await sleep(400)
  await alice.page.locator('[data-help-id="play"]').first().click() // stop

  // Wait for the upload to attach an r2Key on alice's clip
  const keyOnAlice = await (async () => {
    const t0 = Date.now()
    while (Date.now() - t0 < 20000) {
      const k = await alice.page.evaluate(() => window.__daw?._clips?.[0]?.r2Key ?? null)
      if (k) return k
      await sleep(300)
    }
    return null
  })()
  if (!keyOnAlice) throw new Error('recording never got an r2Key on alice')
  console.log(`PASS eager upload: alice's take has r2Key ${keyOnAlice.slice(0, 30)}…`)

  // Bob must receive the clip WITH the key, then audibly play it
  const t0k = Date.now()
  while (Date.now() - t0k < 10000) {
    const k = await bob.page.evaluate(() => window.__daw?._clips?.[0]?.r2Key ?? null)
    if (k === keyOnAlice) break
    await sleep(200)
  }
  const bobKey = await bob.page.evaluate(() => window.__daw?._clips?.[0]?.r2Key ?? null)
  if (bobKey !== keyOnAlice) throw new Error('bob never received the r2Key')

  const clipInfo = await bob.page.evaluate(() => {
    const c = window.__daw?._clips?.[0]
    return c ? { start: c.startBeat, dur: c.durationBeats, id: c.id } : null
  })
  const bobPeak = await bob.page.evaluate(async (clip) => {
    const e = window.__daw
    // Force-resolve the buffer first so we can tell decode failures from seek misses
    const buf = await e.loadClipBuffer(e._clips[0])
    if (!buf) return -1  // r2 fetch/decode failed
    // Scan the buffer for the loudest sample so we know where the audio IS
    const ch = buf.getChannelData(0)
    let bufPeak = 0, peakAt = 0
    for (let i = 0; i < ch.length; i += 20) {
      const v = Math.abs(ch[i]); if (v > bufPeak) { bufPeak = v; peakAt = i / buf.sampleRate }
    }
    console.log(`[bobdiag] ctx=${e.ctx.state} bufDur=${buf.duration.toFixed(1)}s bufPeak=${bufPeak.toFixed(3)} at ${peakAt.toFixed(1)}s`)
    if (bufPeak < 0.005) return -2  // the uploaded audio itself is silent
    const an = e.ctx.createAnalyser(); an.fftSize = 2048
    e.masterGain.connect(an)
    const data = new Float32Array(an.fftSize)
    // Seek the transport to just before the loudest moment of the buffer
    const beatsPerSec = e.tempo / 60
    e.seek(Math.max(clip.start, clip.start + (peakAt - 1) * beatsPerSec))
    document.querySelector('[data-help-id="play"]').click()
    let peak = 0
    const t0 = Date.now()
    while (Date.now() - t0 < 6000) {
      an.getFloatTimeDomainData(data)
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]))
      if (peak > 0.02) break
      await new Promise(r => setTimeout(r, 60))
    }
    document.querySelector('[data-help-id="play"]').click()
    e.masterGain.disconnect(an)
    return +peak.toFixed(4)
  }, clipInfo)
  if (bobPeak === -1) throw new Error('bob could not fetch/decode the r2 audio')
  if (bobPeak === -2) throw new Error('uploaded recording decodes but contains only silence')
  if (bobPeak <= 0.005) throw new Error(`bob's playback of alice's recording was silent (peak ${bobPeak})`)
  console.log(`PASS cross-client audio: bob played alice's recording (peak ${bobPeak})`)

  // ── Presence: each should see one other collaborator (avatar row) ──
  const avatarsVisible = await alice.page.evaluate(() =>
    [...document.querySelectorAll('div')].some(d => d.title && /\(you\)$/.test(d.title))
  )
  console.log(`presence avatars on alice: ${avatarsVisible ? 'visible' : 'NOT VISIBLE'}`)

  await browser.close()
  console.log('ALL PASS')
}

main().catch(err => { console.error('FAIL:', err.message); process.exit(1) })
