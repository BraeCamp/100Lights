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

// ── A microphone opens at all ──────────────────────────────────────────────
await tapVoice()
const stopped = (await micRequests()).at(-1)
check('a microphone was actually opened', !!stopped, JSON.stringify(stopped))

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

// ── The case that made it crackle ──────────────────────────────────────────
//
// Brae: "While the voice toggle is on, it has a LOT of static. It sounds like
// I'm washing rice in a sieve."
//
// The transport state was read ONCE, when the microphone opened. Fine while a
// take lasted one command; useless for a session that outlives the condition.
// You click Voice with the transport stopped, so the PROCESSED microphone is
// opened and the device drops into voice-processing mode — then you press play,
// and everything you hear for the rest of the session comes through a mode
// designed for phone calls. It never recovers, because the microphone never
// closes.
//
// So: start a toggled session while stopped, and check what was asked for.
await page.evaluate(() => window.__daw?.stop?.())
await page.waitForTimeout(600)
{
  const before = (await micRequests()).length
  await voiceBtn.click()
  await page.waitForFunction(
    () => document.querySelector('button[data-voice-control]')?.getAttribute('aria-pressed') === 'true',
    null, { timeout: 15000 },
  )
  await page.waitForTimeout(800)
  const asked = (await micRequests()).at(-1)
  check('a held-open session opens raw even with the transport stopped',
    asked?.audio?.echoCancellation === false,
    JSON.stringify(asked?.audio))
  check('and asks for no voice-processing mode at all',
    asked?.audio?.noiseSuppression === false && asked?.audio?.voiceIsolation === undefined,
    JSON.stringify(asked?.audio))
  check('one device open', (await micRequests()).length === before + 1)
  await voiceBtn.click()
  await page.waitForTimeout(900)
}

// ── The button stays lit, and a command runs once ──────────────────────────
//
// Brae: "when it's in toggle it stops being lit up after one command even though
// it's still toggled... the audio is trying to process my commands twice."
//
// One line caused both. When an utterance ended, the recorder fired onSilence —
// which means "this take is over" and is only ever true for push-to-talk. The
// caller closed the session, so the button went dark while the microphone was
// still open, AND the closing stop() transcribed the clip a second time, so
// every command ran twice.
//
// The fake device produces a tone rather than speech, so this cannot make the
// detector fire on demand. What it CAN check is the thing that broke: after a
// silence long enough to end an utterance, is the session still open and lit?
{
  await voiceBtn.click()
  await page.waitForFunction(
    () => document.querySelector('button[data-voice-control]')?.getAttribute('aria-pressed') === 'true',
    null, { timeout: 15000 },
  )
  // Well past the utterance-end timer, which is where the session used to close
  // itself.
  await page.waitForTimeout(5000)
  const lit = await page.evaluate(() =>
    document.querySelector('button[data-voice-control]')?.getAttribute('aria-pressed') === 'true')
  check('the button is still lit after a silence long enough to end an utterance', lit)
  await voiceBtn.click()
  await page.waitForTimeout(900)
}

// ── And it does not open a second audio context on the same hardware ───────
{
  const rates = await page.evaluate(() => window.__contextRates)
  const engineRate = await page.evaluate(() => window.__daw?.ctx?.sampleRate)
  // Borrowing the engine's context means no NEW context is created for the
  // microphone at all. Two clients negotiating one device is where the crackle
  // comes from, and a held-open session gives it minutes to happen.
  const madeForMic = rates.filter(r => r.asked !== null)
  check('the microphone borrows the studio\'s audio context',
    madeForMic.length === 0,
    madeForMic.length ? `made ${madeForMic.length} of its own` : `engine stays at ${engineRate}`)
}

// ── One click, one microphone, held open ───────────────────────────────────
//
// Brae: "This way the user can do multiple things while only clicking Voice
// once."
//
// The obvious implementation — start a new recording after each command — is
// wrong, because re-opening a microphone renegotiates the audio device, which
// is the very thing that was making playback crackle. The claim being checked
// is therefore structural: the session stays open by itself, and the DEVICE is
// touched exactly once however long it runs.
await page.evaluate(() => window.__daw?.stop?.())
await page.waitForTimeout(500)
const before = (await micRequests()).length

await voiceBtn.click()
await page.waitForFunction(
  () => document.querySelector('button[data-voice-control]')?.getAttribute('aria-pressed') === 'true',
  null, { timeout: 15000 },
)
// Long enough for several commands to have come and gone.
await page.waitForTimeout(6000)

const stillOpen = await page.evaluate(() =>
  document.querySelector('button[data-voice-control]')?.getAttribute('aria-pressed') === 'true')
check('in toggle mode the microphone stays open on its own', stillOpen)
check('and the device was opened exactly once for the session',
  (await micRequests()).length === before + 1,
  `${(await micRequests()).length - before} opens`)

await voiceBtn.click()
await page.waitForTimeout(1200)
const closed = await page.evaluate(() =>
  document.querySelector('button[data-voice-control]')?.getAttribute('aria-pressed') !== 'true')
check('and a second click ends the session', closed)

await page.evaluate(() => window.__daw?.stop?.())
// ── Push-to-talk still gets the processed microphone ───────────────────────
//
// The only case where voice processing is still the right thing to ask for: the
// take lasts one sentence, the button is held down for it, and the transport
// cannot start underneath it. Everything above is about the session that CAN.
// Set through a LATER init script, not through evaluate: the first init script
// runs again on every navigation and would put the mode straight back to
// toggle, so the reload would quietly test the case that was already tested.
// Init scripts accumulate and run in order, so this one wins.
await page.addInitScript(() => {
  try { localStorage.setItem('beacon.voice.mode', 'hold') } catch { /* private mode */ }
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawDispatch, null, { timeout: 240000 })
await page.waitForTimeout(2000)
{
  // Real mouse input through the browser, not a dispatched event: hold-to-talk
  // listens for pointer events the page actually receives, and a synthetic one
  // never reaches it.
  const btn = page.locator('button[data-voice-control]').first()
  await btn.hover()
  await page.mouse.down()
  await page.waitForTimeout(2200)
  await page.mouse.up()
  await page.waitForTimeout(1000)
  const held = (await micRequests()).at(-1)
  check('holding the button asks for voice processing',
    held?.audio?.echoCancellation === true, JSON.stringify(held?.audio))
}

await browser.close()
console.log(failures
  ? `\n${failures} failing — opening the mic still disturbs playback`
  : '\nthe microphone opens without touching the monitor path')
process.exit(failures ? 1 : 0)
