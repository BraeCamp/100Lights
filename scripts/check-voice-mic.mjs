#!/usr/bin/env node
/**
 * Does opening the microphone leave the monitor path alone?
 *
 *   PORT=4666 node scripts/check-voice-mic.mjs
 *
 * Brae: "when I hit voice control during playback, the audio starts becoming
 * staticy. It loads fine, just bad static."
 *
 * Asking for echoCancellation is not a request about the microphone. On macOS
 * it switches the device into the system's voice-processing mode, and that mode
 * owns the OUTPUT too — it resamples and filters everything the browser plays so
 * a voice call sounds clean. Over a mix that is heard as static, arriving the
 * instant the mic opens.
 *
 * Whether it SOUNDS better is not something a headless browser can judge, and
 * this does not pretend to. What it checks is the mechanism: that the studio
 * asks for a raw microphone while the transport is running, asks for the
 * processed one when it is not, and never opens an audio context at a rate that
 * could make the browser renegotiate the output device mid-bar.
 *
 * That is the difference between "I changed something plausible" and "the
 * change I described is the change that happens".
 */

import { chromium } from 'playwright'

const BASE = process.env.BASE || `http://localhost:${process.env.PORT || '4700'}`

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const browser = await chromium.launch({
  args: [
    '--use-fake-device-for-media-capture',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
})
const context = await browser.newContext({ permissions: ['microphone'] })
const page = await context.newPage({ viewport: { width: 1400, height: 900 } })
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 140)))

await page.addInitScript(() => {
  try {
    localStorage.setItem('100lights-ui-tier', 'full')
    // Force the recorded path. The browser's own recogniser does not go through
    // startRecording at all, so the default would test nothing.
    localStorage.setItem('beacon.voice.transcriber', 'server')
    localStorage.setItem('beacon.voice.mode', 'toggle')
  } catch { /* private mode */ }

  // Record what is actually asked for, and at what rate contexts are opened.
  const w = window
  w.__micRequests = []
  w.__contextRates = []
  const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  navigator.mediaDevices.getUserMedia = c => { w.__micRequests.push(JSON.parse(JSON.stringify(c))); return realGUM(c) }
  const RealCtx = window.AudioContext
  window.AudioContext = class extends RealCtx {
    constructor(options) { super(options); w.__contextRates.push({ asked: options?.sampleRate ?? null, actual: this.sampleRate }) }
  }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded', timeout: 180000 })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
await page.waitForTimeout(2000)

// By its stable attribute, not its label: the label changes while listening, so
// a text locator finds the button to start a take and cannot find it to stop
// one.
const voiceBtn = page.locator('button[data-voice-control]').first()
const micRequests = () => page.evaluate(() => window.__micRequests)

/** Open and immediately close the microphone. */
async function tapVoice() {
  await voiceBtn.click()
  // Wait for it to actually be listening rather than for a fixed pause: opening
  // a microphone is asynchronous and a permission prompt makes it slower.
  await page.waitForFunction(
    () => document.querySelector('button[data-voice-control]')?.getAttribute('aria-pressed') === 'true',
    null, { timeout: 15000 },
  ).catch(() => {})
  await page.waitForTimeout(600)
  await voiceBtn.click()
  await page.waitForTimeout(900)
}

// ── Stopped: the processed microphone is the right one to ask for ──────────
await tapVoice()
const stopped = (await micRequests()).at(-1)
check('a microphone was actually opened', !!stopped, JSON.stringify(stopped))
check('with the transport stopped, voice processing is asked for',
  stopped?.audio?.echoCancellation === true, JSON.stringify(stopped?.audio))

// ── Playing: leave the output alone ────────────────────────────────────────
// Started on the ENGINE, not through the reducer: TRANSPORT is carried out by
// the engine directly, so dispatching it changes no state and the transport
// stays stopped — which made this check quietly test the wrong case.
await page.evaluate(async () => { await window.__daw?.play?.() })
await page.waitForTimeout(1500)
const isPlaying = await page.evaluate(() => !!window.__daw?.isPlaying)
check('the transport is running', isPlaying)

await tapVoice()
const playing = (await micRequests()).at(-1)
check('while playing, a RAW microphone is asked for instead',
  playing?.audio?.echoCancellation === false,
  JSON.stringify(playing?.audio))
check('and none of the voice-processing modes are requested',
  playing?.audio?.noiseSuppression === false
  && playing?.audio?.autoGainControl === false
  && playing?.audio?.voiceIsolation === undefined,
  JSON.stringify(playing?.audio))

// ── And the audio context cannot fight the engine over the device rate ─────
const rates = await page.evaluate(() => window.__contextRates)
const engineRate = await page.evaluate(() => window.__daw?.ctx?.sampleRate)
const micContexts = rates.filter(r => r.asked !== null)
check('the mic context is opened at the studio\'s own rate',
  micContexts.length > 0 && micContexts.every(r => r.asked === engineRate),
  `engine ${engineRate}, asked ${micContexts.map(r => r.asked).join(',') || 'nothing'}`)

await page.evaluate(() => window.__daw?.stop?.())
await browser.close()
console.log(failures
  ? `\n${failures} failing — opening the mic still disturbs playback`
  : '\nthe microphone opens without touching the monitor path')
process.exit(failures ? 1 : 0)
