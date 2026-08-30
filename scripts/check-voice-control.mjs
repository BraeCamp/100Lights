#!/usr/bin/env node
/**
 * Say something to Beacon and check the song changes.
 *
 *   PORT=4680 node scripts/check-voice-control.mjs
 *
 * The unit tests already prove that a tool call becomes the right actions. What
 * they cannot see is the wiring: that the button is there, that holding it
 * listens, that the transcript reaches the assistant, and that what comes back
 * is actually dispatched into the project.
 *
 * So the microphone and the API are both STUBBED — a canned transcript and a
 * canned set of tool calls — and the assertion is on the project itself. That
 * keeps the test about this app's wiring rather than about speech accuracy or
 * an API key, and it means it runs anywhere, every time, with the same answer.
 */

import { chromium } from 'playwright'
import { importTs } from './lib/ts-import.mjs'
import { makeTrack, makeClip, makeProject } from './lib/daw-fixture.mjs'

const { initPatch } = await importTs('lib/apollo/patch.ts')
const { defaultProject } = await importTs('lib/daw-types.ts')

const BASE = `http://localhost:${process.env.PORT || '4680'}`

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

function buildProject() {
  const patch = initPatch()
  const inst = () => ({ type: 'apollo', params: JSON.parse(JSON.stringify(patch)) })
  const tracks = [
    makeTrack({ id: 'tk', name: 'Kick', instrument: inst() }),
    makeTrack({ id: 'tb1', name: 'Bass 1', instrument: inst() }),
    makeTrack({ id: 'tb2', name: 'Bass 2', instrument: inst() }),
  ]
  const clips = [
    makeClip({
      id: 'cb2', trackId: 'tb2', name: 'Bass 2 line', startBeat: 16, durationBeats: 8,
      notes: [{ id: 'n1', pitch: 43, startBeat: 0, durationBeats: 2, velocity: 100 }],
    }),
  ]
  return makeProject(defaultProject, { tempo: 120, tracks, clips })
}

// A microphone, or every listening check fails with "Could not open the
// microphone" and says nothing about the feature. Fake-device gives
// getUserMedia something to hand back; fake-ui answers the permission prompt.
const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 160)))

// Stub the microphone and the assistant BEFORE the app loads.
await page.addInitScript(() => {
  // A speech recogniser that reports one canned sentence when stopped.
  window.__spoken = 'Hey Light, could you loop bass 2 3 more times, please'
  class FakeRecognition {
    constructor() { this.onresult = null; this.onend = null; this.onerror = null }
    start() {
      setTimeout(() => {
        this.onresult?.({ resultIndex: 0, results: Object.assign([[{ transcript: window.__spoken }]], { length: 1 }) })
        Object.defineProperty(this, '_done', { value: true, configurable: true })
      }, 30)
    }
    stop() { setTimeout(() => this.onend?.(), 20) }
    abort() { }
  }
  // isFinal has to be true or the transcript is treated as an unfinished tail.
  const origResult = FakeRecognition.prototype.start
  FakeRecognition.prototype.start = function () {
    setTimeout(() => {
      const r = [{ transcript: window.__spoken }]
      r.isFinal = true
      this.onresult?.({ resultIndex: 0, results: Object.assign([r], { length: 1 }) })
    }, 30)
  }
  window.SpeechRecognition = FakeRecognition
  window.webkitSpeechRecognition = FakeRecognition

  // The assistant, answering with tool calls instead of reaching Anthropic.
  window.__assistCalls = []
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input && input.url) || ''
    if (url.includes('/api/ai/assist')) {
      try { window.__assistCalls.push(JSON.parse(init.body)) } catch { /* ignore */ }
      return new Response(JSON.stringify({
        message: 'Done.',
        actions: window.__cannedActions ?? [{ name: 'loop_clip', input: { clip: 'bass 2', times: 3 } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return realFetch(input, init)
  }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
await page.waitForTimeout(2500)
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
await page.evaluate(p => window.__dawDispatch({ type: 'LOAD_PROJECT', project: p }), buildProject())
await page.waitForTimeout(1500)

const btn = page.locator('[data-voice-control]')
check('the voice button is in the transport', await btn.count() > 0, `${await btn.count()} found`)

if (await btn.count()) {
  // window.__dawProject() — not __dawEngine.projectForTest, which does not
  // exist and never did: it read as undefined, `before` was null, and the
  // comparison below could not fail no matter what the command did.
  const before = await page.evaluate(() => window.__dawProject?.()?.arrangementClips?.length ?? null)

  // Hold to speak, exactly as a person would.
  const box = await btn.first().boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(300)
  await page.mouse.up()
  await page.waitForTimeout(2500)

  // This check was written when every sentence went to the assistant, and it
  // asserted that one had been sent. That is now the FAILURE case: "loop bass 2
  // three more times" is understood by the rules, which cost nothing, and a
  // paid call here would mean the local reading had stopped working. The
  // assertion is inverted rather than deleted, because "did this quietly start
  // costing money again" is worth watching forever.
  const sent = await page.evaluate(() => window.__assistCalls ?? [])
  check('a command the rules understand costs nothing', sent.length === 0, `${sent.length} paid calls`)

  // The point of the whole feature: the song actually changed. The transcript
  // is not evidence — it shows what was HEARD, and it says "loop bass 2" whether
  // or not anything looped. Ask the project.
  const after = await page.evaluate(() => window.__dawProject?.()?.arrangementClips?.length ?? null)
  check('the song actually changed', before !== null && after !== null && after > before,
    `${before} clips → ${after}`)

  const readback = (await page.locator('[data-voice-readback]').textContent().catch(() => '')) ?? ''
  check('and it said so, naming the clip', /Bass 2/i.test(readback), readback.trim().slice(0, 90))
}

// The settings Brae asked for: hold vs toggle, and whether Enter runs a command.
//
// These used to live in a popover of their own. They now live in the voice
// card's Settings tab — the popover was removed when the card was built, and
// this check went on hunting for it and failing for reasons that had nothing to
// do with the settings working. Same assertions, current door.
const gear = page.locator('[data-voice-settings]')
check('there is a settings control', await gear.count() > 0, `${await gear.count()} found`)
if (await gear.count()) {
  await gear.first().click()
  await page.waitForTimeout(600)
  const panel = page.locator('[data-voice-panel]')
  check('it opens the voice card', await panel.count() > 0)
  const text = (await panel.textContent().catch(() => '')) ?? ''
  check('offering hold and toggle', /Hold/.test(text) && /Keep listening/i.test(text), text.slice(0, 80))
  check('and the Enter setting', /Enter/i.test(text), text.slice(0, 200))

  // Switching to toggle has to persist, or the setting is decoration.
  //
  // A segmented control now, not two radios — the options are alternatives
  // worth comparing rather than a form field, and the old selector silently
  // found nothing once they became buttons.
  await page.evaluate(() => {
    const panel = document.querySelector('[data-voice-panel]')
    const b = panel && [...panel.querySelectorAll('button')]
      .find(x => /^Keep listening$/.test(x.textContent.trim()))
    b?.click()
  })
  await page.waitForTimeout(300)
  const stored = await page.evaluate(() => localStorage.getItem('beacon.voice.mode'))
  check('choosing toggle is remembered', stored === 'toggle', String(stored))
}

await page.screenshot({ path: '/tmp/voice-control.png' })
await browser.close()
console.log('\nscreenshot: /tmp/voice-control.png')
console.log(failures ? `\n${failures} failing` : '\nspeaking a command reaches the assistant and edits the song')
process.exit(failures ? 1 : 0)
