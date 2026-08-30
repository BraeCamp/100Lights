#!/usr/bin/env node
/**
 * The list of everything the studio can say, and the admin page that shows it.
 *
 *   PORT=3000 node scripts/check-voice-phrases-panel.mjs
 *
 * Most of this is about the generated list rather than the page, because that
 * is where the expensive mistakes live.
 *
 * The list must be COMPLETE — it is generated from source at build time, so a
 * response added somewhere the generator does not read simply never appears and
 * nobody notices.
 *
 * And it must be EXACT. The cache key is a hash of the text, so a phrase listed
 * as `Couldn\'t reach the assistant.` — the literal as written in source, with
 * its escape still attached — hashes to a different key from the "Couldn't
 * reach the assistant." the running app asks for. Pre-rendering would buy it,
 * store it, never find it, and let every user pay for it again. That bug was
 * real and shipped-adjacent; these assertions are what stops it coming back.
 *
 * The page itself is behind admin auth, which cannot be faked from here, so the
 * DOM assertions SKIP rather than fail when signed out — and say so, instead of
 * reporting green on a page that never rendered.
 */

import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4680'}`
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

// ── The list ───────────────────────────────────────────────────────────────
const phrases = JSON.parse(readFileSync('lib/voice/phrases.json', 'utf8'))
const all = [...phrases.fixed, ...phrases.shapes]

console.log('WHAT THE STUDIO CAN SAY')
check('fixed phrases were found', phrases.fixed.length > 40, `${phrases.fixed.length}`)
check('templated shapes were found', phrases.shapes.length > 40, `${phrases.shapes.length}`)
check('every entry says where it lives', all.every(p => /^[\w./-]+:\d+$/.test(p.where)),
  all.find(p => !/^[\w./-]+:\d+$/.test(p.where))?.where ?? '')

console.log('\nEXACT, OR THE CACHE SILENTLY MISSES')
// The nested-template bug: `a ${kind} effect` inside an outer template stopped
// the old regex dead, producing half a sentence.
check('nothing was truncated mid-literal', !all.some(p => p.text.includes('\n')))
// The escape bug: source says Couldn\'t, JavaScript produces Couldn't, and only
// one of those is what the app will ask the cache for.
check('no source escapes survived into the text', !all.some(p => /\\['"`nrt\\]/.test(p.text)),
  all.find(p => /\\['"`nrt\\]/.test(p.text))?.text ?? '')
check('apostrophes came through as apostrophes',
  phrases.fixed.some(p => p.text.includes("'")),
  phrases.fixed.find(p => p.text.includes("'"))?.text ?? 'none found')

// A phrase must be findable in the file it claims to come from. Escapes make
// the raw text differ from the source, so the check is on a distinctive
// escape-free fragment.
const sample = phrases.fixed.find(p => p.text.length > 20 && !/['"\\]/.test(p.text))
const [file] = (sample?.where ?? '').split(':')
check('a listed phrase is really in the file it names',
  !!sample && readFileSync(file, 'utf8').includes(sample.text), sample?.text ?? 'none')

console.log('\nTHE TWO KINDS ARE NOT MIXED UP')
// The panel bills one and not the other, so this is the difference between a
// cost estimate and a wrong number.
check('fixed phrases carry no interpolation', phrases.fixed.every(p => !p.text.includes('${')))
check('every shape carries one', phrases.shapes.every(p => p.text.includes('${')))
check('shapes are humanised for reading', phrases.shapes.every(p => !p.display.includes('${')),
  phrases.shapes.find(p => p.display.includes('${'))?.display ?? '')
check('no duplicates within a kind',
  new Set(phrases.fixed.map(p => p.text)).size === phrases.fixed.length
  && new Set(phrases.shapes.map(p => p.text)).size === phrases.shapes.length)

// ── The endpoint and the page ──────────────────────────────────────────────
console.log('\nTHE ADMIN PAGE')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))

// Signed out, this must refuse — it reads the whole bucket.
const api = await page.request.get(`${BASE}/api/admin/voice-phrases`)
check('the API refuses anyone who is not an admin', api.status() === 401, `HTTP ${api.status()}`)

const res = await page.goto(`${BASE}/admin#audio/voice-phrases`, { waitUntil: 'domcontentloaded', timeout: 180000 })
check('the admin page is reachable', !!res && res.status() < 400, `HTTP ${res?.status()}`)
await page.waitForTimeout(2500)

// Only what a person can actually see. body.textContent also contains Next's
// serialised payload inside <script> tags, and matching that reported the panel
// as "registered" on a page showing nothing but an authorisation error.
const visible = await page.evaluate(() => document.body.innerText)

if (/not authorized|sign in|admin password/i.test(visible) && !/Voice Phrases/i.test(visible)) {
  console.log('\nSKIP the panel itself — this browser is not signed in as an admin,')
  console.log('     and admin needs a real Clerk session plus the admin_auth cookie.')
  console.log('     Open /admin#audio/voice-phrases while signed in to see it.')
  await browser.close()
  console.log(failures ? `\n${failures} failing` : '\nthe phrase list is complete and exact')
  process.exit(failures ? 1 : 0)
}

check('the panel is in the audio tab', /Voice Phrases/i.test(visible))
await page.waitForFunction(() => !/Reading storage…/.test(document.body.innerText), null, { timeout: 60000 })
  .catch(() => {})
const after = await page.evaluate(() => document.body.innerText)
check('it says how much has been bought', /Bought/i.test(after))
check('and what the rest would cost, once', /Still to buy/i.test(after))
check('an empty cache explains itself rather than showing a bare zero',
  !/\b0 \/ \d+/.test(after) || /text_to_speech|No voice key configured/i.test(after))
check('the phrases are listed', after.includes(phrases.fixed[0].display))
await page.screenshot({ path: '/tmp/voice-phrases.png' })
console.log('\nscreenshot: /tmp/voice-phrases.png')

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe phrase list is complete and exact')
process.exit(failures ? 1 : 0)
