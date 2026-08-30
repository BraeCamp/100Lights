#!/usr/bin/env node
/**
 * The two AI settings, and whether they actually do anything.
 *
 *   PORT=3000 node scripts/check-voice-ai-settings.mjs
 *
 * Brae: "Can we have the AI transcription and editing be in the settings so
 * that paid users can move to and from AI to non-AI from there?"
 *
 * A settings toggle is the easiest thing in the world to render and the easiest
 * thing in the world to render WITHOUT wiring, so the assertions here are about
 * consequence rather than appearance:
 *
 *   Off must mean off. A sentence the built-in commands cannot read must not
 *   reach the paid endpoint — not "ask first", not "quietly send it anyway".
 *   The panel would look identical either way.
 *
 *   Ask must still stop. The confirmation barrier is the older constraint
 *   ("every single time it should get confirmation first") and adding a third
 *   state must not have loosened it.
 *
 *   The ear setting must be the one the recorder reads, not a second copy that
 *   drifts from it.
 */

import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4680'}`
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
})
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))

// A sentence with no built-in reading, so every run reaches the barrier rather
// than being handled for free — which would pass the "did not call out" check
// for entirely the wrong reason.
const BEYOND_THE_RULES = 'make the whole thing sound more like a rainy afternoon'

await page.addInitScript(() => {
  class Fake {
    constructor() { this.onresult = null; this.onend = null; this.onerror = null }
    start() {
      setTimeout(() => {
        const r = [{ transcript: window.__spoken }]
        r.isFinal = true
        this.onresult?.({ resultIndex: 0, results: Object.assign([r], { length: 1 }) })
      }, 30)
    }
    stop() { setTimeout(() => this.onend?.(), 20) }
    abort() {}
  }
  window.SpeechRecognition = Fake
  window.webkitSpeechRecognition = Fake

  window.__assistCalls = []
  const real = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/ai/assist')) {
      window.__assistCalls.push(url)
      return new Response(JSON.stringify({ message: 'Done.', actions: [], credits: 200, balance: 1000 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    // A paid plan, so the controls are operable rather than locked.
    if (url.includes('/api/billing/info')) {
      return new Response(JSON.stringify({ plan: 'max', status: 'active' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })
    }
    return real(input, init)
  }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
await page.waitForTimeout(2000)
const dlg = page.locator('[role="dialog"][aria-label="Choose your studio setup"]')
if (await dlg.count()) {
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-label="Choose your studio setup"]')
    const b = d && [...d.querySelectorAll('button,div[role=button]')].find(e => /Everything/i.test(e.textContent || ''))
    b?.click()
  })
  await dlg.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {})
}
await page.waitForTimeout(1200)

// ── The settings are reachable and operable ────────────────────────────────
const gear = page.locator('[data-voice-settings]')
if (!await gear.count()) {
  console.log('FAIL no settings control on the transport')
  await browser.close()
  process.exit(1)
}
await gear.first().click()
await page.waitForTimeout(700)
const panel = page.locator('[data-voice-panel]')
check('the settings open', await panel.count() > 0)

const text = await page.evaluate(() => document.querySelector('[data-voice-panel]')?.innerText ?? '')
check('AI transcription is offered as a choice', /Hearing/i.test(text) && /Browser/i.test(text))
check('AI editing is offered as a choice', /Understanding/i.test(text) && /Ask first/i.test(text))
check('and both can be switched off', /\bOff\b/.test(text))

/**
 * Make sure the settings are open and on the settings tab.
 *
 * Speaking a command closes the card, so anything that talks and then changes a
 * setting has to reopen it. Doing that with a bare gear click toggles it SHUT
 * when it happened to still be open, which is how the first version of this
 * check died on a null panel.
 */
const openSettings = async () => {
  if (!await page.locator('[data-voice-panel]').count()) {
    await gear.first().click()
    await page.waitForTimeout(600)
  }
  await page.evaluate(() => {
    const p = document.querySelector('[data-voice-panel]')
    const t = p && [...p.querySelectorAll('button')].find(x => x.textContent.trim() === 'Settings')
    t?.click()
  })
  await page.waitForTimeout(300)
}

/** Click a segment by its visible label, within the settings panel. */
const choose = async label => {
  await openSettings()
  await page.evaluate(l => {
    const p = document.querySelector('[data-voice-panel]')
    const b = p && [...p.querySelectorAll('button')].find(x => x.textContent.trim() === l)
    b?.click()
  }, label)
  await page.waitForTimeout(350)
}

/** Say something and see whether it reached the paid endpoint. */
const say = async sentence => {
  await page.evaluate(s => { window.__spoken = s; window.__assistCalls = [] }, sentence)
  const btn = page.locator('[data-voice-control]')
  const box = await btn.first().boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(280)
  await page.mouse.up()
  await page.waitForTimeout(2600)
  return {
    calls: await page.evaluate(() => window.__assistCalls.length),
    said: await page.evaluate(() =>
      document.querySelector('[data-voice-readback]')?.textContent
      ?? document.querySelector('[data-voice-panel]')?.innerText ?? ''),
  }
}

console.log('\nOFF MUST MEAN OFF')
await choose('Off')
const off = await say(BEYOND_THE_RULES)
check('a sentence the rules cannot read does not reach the assistant', off.calls === 0, `${off.calls} calls`)
check('and it says why, and where to change it', /assistant is off|Settings/i.test(off.said),
  off.said.replace(/\s+/g, ' ').slice(0, 110))

console.log('\nASK MUST STILL STOP')
await choose('Ask first')
const ask = await say(BEYOND_THE_RULES)
check('it still does not spend without being told to', ask.calls === 0, `${ask.calls} calls`)
check('and shows what it heard, so it can be checked first',
  new RegExp(BEYOND_THE_RULES.slice(0, 20), 'i').test(ask.said),
  ask.said.replace(/\s+/g, ' ').slice(0, 110))

console.log('\nTHE CHOICES ARE REMEMBERED')
const stored = await page.evaluate(() => ({
  assistant: localStorage.getItem('beacon.voice.assistant'),
  // The older flag the barrier itself reads. If these two ever disagree the
  // setting says one thing and the studio does another.
  legacy: localStorage.getItem('beacon.voice.ai-auto'),
}))
check('the assistant setting is written', stored.assistant === 'ask', String(stored.assistant))
check('and the flag the barrier reads agrees with it', stored.legacy === 'off', String(stored.legacy))

await choose('AI')
await page.waitForTimeout(300)
const ear = await page.evaluate(() => localStorage.getItem('beacon.voice.transcriber'))
check('choosing the AI ear writes the key the recorder reads', ear === 'server', String(ear))

await page.screenshot({ path: '/tmp/voice-ai-settings.png' })
console.log('\nscreenshot: /tmp/voice-ai-settings.png')
await browser.close()
console.log(failures ? `\n${failures} failing` : '\noff means off, and ask still stops')
process.exit(failures ? 1 : 0)
