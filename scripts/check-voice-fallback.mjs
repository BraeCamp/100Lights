#!/usr/bin/env node
/**
 * The studio voice must never be the reason nothing is said.
 *
 *   PORT=3000 node scripts/check-voice-fallback.mjs
 *
 * The shared recording cache is an optimisation sitting in front of something
 * that already worked, which makes its failure modes the interesting part: a
 * refused request, an account without synthesis permission, a rate limit, a
 * dead URL, no network at all. Every one has to end with the browser's own
 * voice saying the thing anyway.
 *
 * And with `onDone` firing — which is the half that is easy to forget and
 * expensive to get wrong. In a held-open session that callback is what stops
 * the recorder ignoring the room; a studio that goes permanently deaf because
 * an utterance never reported finishing is a worse bug than one that never
 * spoke.
 *
 * The endpoint is broken on purpose, five ways, through the real module.
 */

import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4680'}`
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))

// Headless Chromium has no speech voices, so synthesis is replaced with
// something that records. That is the right stub regardless: the question is
// whether it fell back, and a real voice would answer by making a noise nothing
// can assert on.
await page.addInitScript(() => {
  window.__spokenAloud = []
  // defineProperty, not assignment: speechSynthesis is a readonly accessor on
  // Window, so `window.speechSynthesis = {...}` silently does nothing and the
  // real (voiceless, headless) one stays in place — which looks exactly like
  // the fallback being broken.
  Object.defineProperty(window, 'speechSynthesis', {
    configurable: true,
    value: {
      speak(u) { window.__spokenAloud.push(u.text); setTimeout(() => u.onend?.(), 10) },
      cancel() {},
      getVoices: () => [{ name: 'Test', lang: 'en-US', localService: true }],
    },
  })
  Object.defineProperty(window, 'SpeechSynthesisUtterance', {
    configurable: true,
    value: class {
      constructor(text) { this.text = text; this.onend = null; this.onerror = null }
    },
  })
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
// The hook is installed by the voice control once it has mounted and read its
// settings, which is a beat after the project is dispatchable.
await page.waitForFunction(() => !!window.__beaconSpeak, null, { timeout: 60000 })
  .catch(() => {})

if (!(await page.evaluate(() => !!window.__beaconSpeak))) {
  console.log('FAIL window.__beaconSpeak is not exposed — is this a dev build?')
  await browser.close()
  process.exit(1)
}

console.log('\nBreaking the cache on purpose. Something must always speak.\n')

const scenarios = [
  ['no synthesis permission (501)',
    `async () => new Response(JSON.stringify({error:'not configured'}), {status:501, headers:{'content-type':'application/json'}})`],
  ['not signed in (401)',
    `async () => new Response(JSON.stringify({error:'sign in'}), {status:401, headers:{'content-type':'application/json'}})`],
  ['too many new phrases today (429)',
    `async () => new Response(JSON.stringify({error:'slow down'}), {status:429, headers:{'content-type':'application/json'}})`],
  ['the network is gone',
    `async () => { throw new TypeError('Failed to fetch') }`],
  ['a URL that will not play',
    `async () => new Response(JSON.stringify({url:'https://example.invalid/nope.mp3'}), {status:200, headers:{'content-type':'application/json'}})`],
]

for (const [label, stub] of scenarios) {
  const out = await page.evaluate(async ({ s, phrase }) => {
    window.__spokenAloud = []
    let done = 0
    const real = window.fetch.bind(window)
    const fake = new Function('return ' + s)()
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || ''
      if (url.includes('/api/voice/say')) return fake(url)
      return real(input, init)
    }
    localStorage.setItem('beacon.voice.speak', 'on')
    localStorage.setItem('beacon.voice.studio', 'on')
    window.__beaconSpeak(phrase, { onDone: () => { done++ } })
    await new Promise(r => setTimeout(r, 1500))
    window.fetch = real
    return { said: window.__spokenAloud.slice(), done }
  // A different phrase each time, or the client-side memo of resolved URLs
  // answers from the previous scenario and the stub is never reached.
  }, { s: stub, phrase: `Drums ${label} muted.` })

  check(`${label} → said anyway`, out.said.length > 0, JSON.stringify(out.said).slice(0, 70))
  check(`${label} → reported finishing`, out.done === 1, `${out.done} onDone`)
}

// And the case that is not a failure: a URL that plays is played, and the
// browser voice stays out of it. Otherwise "always falls back" could be passing
// because the studio voice never works at all.
const good = await page.evaluate(async () => {
  window.__spokenAloud = []
  let done = 0
  const real = window.fetch.bind(window)
  // A silent one-sample wav, as a data URL — small, and it really decodes.
  const wav = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA='
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/voice/say')) {
      return new Response(JSON.stringify({ url: wav, cached: true }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return real(input, init)
  }
  localStorage.setItem('beacon.voice.speak', 'on')
  localStorage.setItem('beacon.voice.studio', 'on')
  window.__beaconSpeak('Bass 2 soloed.', { onDone: () => { done++ } })
  await new Promise(r => setTimeout(r, 1500))
  window.fetch = real
  return { said: window.__spokenAloud.slice(), done }
})
check('a recording that plays is used, not the browser voice', good.said.length === 0,
  JSON.stringify(good.said).slice(0, 70))
check('and it still reports finishing', good.done === 1, `${good.done} onDone`)

await browser.close()
console.log(failures ? `\n${failures} failing` : '\nthe voice always arrives, whatever the cache does')
process.exit(failures ? 1 : 0)
