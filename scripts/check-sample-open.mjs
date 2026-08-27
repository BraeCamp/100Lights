#!/usr/bin/env node
// Does Apollo open on the Sample section when a sound was picked in Beacon first?
//
//   node scripts/check-sample-open.mjs         (needs a dev server; PORT= to point it)
//
// Brae: "When I open Apollo while having a sample selected it brings up the
// oscellator section but instead is should open with the Sample section open."
//
// The bug was an ORDERING one. `onApolloSampleSelect` only fires for selections
// made after Apollo subscribed — deliberately, so that opening Apollo cannot
// overwrite a patch you were working on — and the ordinary way to use the
// bridge is to pick the sound first and open Apollo second. So the fix is a
// pickup at mount time, and the test has to reproduce that order: arm the
// selection while Apollo is NOT mounted, then mount it. A test that opened
// Apollo and then selected would have passed against the broken build.

import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const PORT = process.env.PORT || '4618'
const BASE = `http://localhost:${PORT}`

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const res = await fetch(`${BASE}/apollo`, { signal: AbortSignal.timeout(25000) }).catch(() => null)
if (!res?.ok) {
  console.log(`no dev server on ${BASE} — start one, or pass PORT=`)
  process.exit(1)
}

const browser = await chromium.launch()
const page = await browser.newPage()
page.on('pageerror', e => console.log('  page error:', e.message))

/** Which engine is osc 1 showing? Read the visible control rather than internal
 *  state — the complaint was about what is on screen. */
const readEngine = () => page.evaluate(() => {
  const sels = [...document.querySelectorAll('select')]
  const s = sels.find(el => [...el.options].some(o => o.value === 'wavetable'))
  return s ? s.value : null
})

const settle = () => page.waitForTimeout(7000)

// 1. Baseline. Nothing armed, no autosave: Apollo opens on its own oscillator.
await page.goto(`${BASE}/apollo`, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => { try { localStorage.clear() } catch { /* private mode */ } })
await page.reload({ waitUntil: 'domcontentloaded' })
await settle()
const baseline = await readEngine()
console.log(`  nothing armed:                  osc 1 engine = ${baseline}`)
check('a fresh Apollo opens on its own oscillator', baseline === 'wavetable', String(baseline))

// 2. The real ordering. Leave Apollo (client-side, so the module-level store
//    survives — Beacon and Apollo are the same bundle), arm a selection while
//    nothing is listening, then come back and mount Apollo fresh.
// Real client-side navigation via the app's own router. `history.pushState`
// does not unmount anything, and a plain <a> click is a FULL page load that
// wipes the module store — the first version of this test used one and reported
// the fix broken when it was the navigation that was wrong.
await page.evaluate(() => window.next.router.push('/'))
await page.waitForTimeout(2500)
await page.evaluate(() => window.__apolloArmSample?.('check-sample-open', 'Check Sample'))
const armed = await page.evaluate(() => !!window.__apolloArmSample)
check('the bridge can be armed while Apollo is closed', armed)

// Mount Apollo through the app's own client-side navigation. A full goto would
// reload the bundle and wipe the armed selection, which is the state under test.
await page.evaluate(() => window.next.router.push('/apollo'))
await settle()

const afterArm = await readEngine()
console.log(`  armed first, then opened:       osc 1 engine = ${afterArm}`)
check('Apollo opens on the Sample section, not the oscillator one', afterArm === 'sample', String(afterArm))

const patchName = await page.evaluate(() => window.__apolloPatch?.()?.name ?? null)
check('and it took the sample’s name', patchName === 'Check Sample', String(patchName))

// 3. The guard. A patch you were already working on must NOT be replaced just
//    because something is armed — that is the rule the mount pickup had to keep.
await page.evaluate(() => window.__apolloUpdate?.(p => { p.name = 'My Own Patch' }))
await page.evaluate(() => window.__apolloArmSample?.('other-sample', 'Other Sample'))
await page.evaluate(() => window.next.router.push('/'))
await page.waitForTimeout(2500)
await page.evaluate(() => window.next.router.push('/apollo'))
await settle()
const guarded = await page.evaluate(() => window.__apolloPatch?.()?.name ?? null)
console.log(`  a named patch, something armed: patch name = ${guarded}`)
check('a patch you were working on is left alone', guarded !== 'Other Sample', String(guarded))

// 4. The EMBEDDED card, which is what Brae actually meant: "To clarify, I mean
//    when Apollo opens in Beacon." The rack hosted inside Beacon is a different
//    mount from the standalone app — it takes its patch from the host and skips
//    the deep-link path entirely — so passing above says nothing about it.
const beacon = `${BASE}/create?modules=audio&audioMode=music`
await page.goto(beacon, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 120000 }).catch(() => {})
await page.waitForTimeout(6000)

// Arm a sound the way picking one in the Sound Library does, BEFORE the rack is
// opened — the whole point is that the selection precedes the mount.
await page.evaluate(() => window.__apolloArmSample?.('check-embed-sample', 'Embed Sample'))

// Open the rack with the toolbar's own APOLLO button — the control a person
// reaches for. NOT the command palette: its Apollo command acts on a selected
// track, so in an empty project it does not exist at all, and pressing Enter
// there silently did something else while this test read the result as a
// failure of the fix.
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')]
    .find(b => /apollo/i.test((b.textContent || '').trim()))
  if (!btn) return false
  btn.click()
  return true
})
check('Beacon has a control that opens Apollo', opened)
await page.waitForTimeout(8000)

const embedEngine = await page.evaluate(() => {
  const sels = [...document.querySelectorAll('select')]
  const s = sels.find(el => [...el.options].some(o => o.value === 'wavetable'))
  return s ? s.value : null
})
console.log(`  Apollo opened inside Beacon:    osc 1 engine = ${embedEngine}`)
check('the rack inside Beacon also opens on the Sample section', embedEngine === 'sample', String(embedEngine))

// 5. The case that actually matters, and that scenario 4 missed: a project
//    with TRACKS IN IT. The rack seeds its patch from the track's instrument,
//    so the patch it opens with is not a blank one — which is exactly the
//    condition an "only onto an untouched patch" guard refuses. Scenario 4 used
//    an empty project, got a seed of initPatch(), and sailed through.
const FIXTURE = join(homedir(), 'Desktop', '100lights-ai-renders', 'Hallway Light.cfproj')
if (existsSync(FIXTURE)) {
  const dawProject = JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject
  await page.goto(beacon, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 120000 }).catch(() => {})
  await page.waitForTimeout(5000)
  await page.evaluate(pr => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: pr }), dawProject)
  await page.waitForTimeout(4000)

  await page.evaluate(() => window.__apolloArmSample?.('check-real-project', 'Real Project Sample'))
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => /apollo/i.test((b.textContent || '').trim()))
    btn?.click()
  })
  await page.waitForTimeout(8000)

  const realEngine = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')]
    const s = sels.find(el => [...el.options].some(o => o.value === 'wavetable'))
    return s ? s.value : null
  })
  console.log(`  with a real project loaded:     osc 1 engine = ${realEngine}`)
  check('a real project with tracks also opens on the Sample section', realEngine === 'sample', String(realEngine))

  // 6. The rack SEEDED FROM A TRACK'S OWN PATCH — the path the first fix
  //    silently refused, because it judged "have you started work on this?" by
  //    the patch's name, and a seeded patch carries the track's name. Every
  //    other scenario here seeds from a blank initPatch() and so never touched
  //    the failing branch.
  await page.evaluate(() => {
    const el = document.querySelector('[data-track-id]')
    el?.click()
  })
  await page.waitForTimeout(1200)
  await page.evaluate(() => window.__apolloArmSample?.('check-seeded', 'Seeded Sample'))
  const ranSeeded = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role=option],li,button,div')]
      .find(e => /^Edit .* in Apollo$/.test((e.textContent || '').trim()))
    if (el) { el.click(); return true }
    return false
  })
  if (!ranSeeded) {
    await page.keyboard.press('Meta+k')
    await page.waitForTimeout(700)
    await page.keyboard.type('Apollo', { delay: 40 })
    await page.waitForTimeout(1100)
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role=option],li,button,div')]
        .find(e => /^Edit .* in Apollo$/.test((e.textContent || '').trim()))
      el?.click()
    })
  }
  await page.waitForTimeout(9000)
  const seededEngine = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')]
    const s = sels.find(el => [...el.options].some(o => o.value === 'wavetable'))
    return s ? s.value : null
  })
  console.log(`  rack seeded from a track:       osc 1 engine = ${seededEngine}`)
  check('a rack seeded from a track also takes the sound', seededEngine === 'sample', String(seededEngine))

  // 7. CLOSE IT AND OPEN IT AGAIN. A "spend the selection once" rule passes
  //    every scenario above and fails here — and failing here looks exactly
  //    like the bug being reported: pick a sound, open Apollo once, and from
  //    then on opening Apollo never shows your sound again. While a sound is
  //    selected in the library, every rack that opens shows it.
  await page.evaluate(() => {
    const close = [...document.querySelectorAll('button')]
      .find(b => (b.getAttribute('aria-label') || '') === 'Close' || (b.textContent || '').trim() === '✕')
    close?.click()
  })
  await page.waitForTimeout(2000)
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find(b => /apollo/i.test((b.textContent || '').trim()))
    btn?.click()
  })
  await page.waitForTimeout(9000)
  const reopened = await page.evaluate(() => {
    const sels = [...document.querySelectorAll('select')]
    const s = sels.find(el => [...el.options].some(o => o.value === 'wavetable'))
    return s ? s.value : null
  })
  console.log(`  closed and opened again:        osc 1 engine = ${reopened}`)
  check('opening Apollo a second time still shows the sound', reopened === 'sample', String(reopened))
} else {
  console.log('  (no Hallway Light fixture — skipping the real-project case)')
}

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nApollo opens where the armed sample is')
process.exit(failures ? 1 : 0)
