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

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nApollo opens where the armed sample is')
process.exit(failures ? 1 : 0)
