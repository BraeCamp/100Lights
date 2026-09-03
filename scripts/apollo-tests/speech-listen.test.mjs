#!/usr/bin/env node
// Does the microphone stay open until you say it can close?
//
//   node --experimental-strip-types scripts/apollo-tests/speech-listen.test.mjs
//
// Brae: "When I click the voice button, it says 'I didn't catch that' even when
// it's on toggle mode."
//
// `continuous = true` reads like "listen until told to stop" and is not that.
// Chrome ends the session on its own after a stretch of quiet — sometimes
// within a second, before anyone has spoken — and the old `onend` handled that
// identically to the user finishing: it delivered an empty transcript, which
// prints "I didn't catch that" the instant the button is pressed. In toggle
// mode the button is a promise that it is still listening, and it was not.
//
// SpeechRecognition is a browser global, so it is stubbed here. That is the
// whole point: the restart logic is ordinary state machinery and belongs under
// test, rather than being re-derived by hand every time it breaks.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}
const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))

// A stand-in for the browser's recognizer, driven by the test.
const built = []
class FakeRecognition {
  constructor() {
    this.started = 0
    this.onresult = null; this.onerror = null; this.onend = null
    built.push(this)
  }
  start() { this.started++ }
  stop() { this.endNaturally() }
  abort() {}
  /** Chrome deciding, on its own, that the session is over. */
  endNaturally() { this.onend?.() }
  /** A final phrase arriving. */
  say(text) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: true })] })
  }
  /** Words on screen that the recogniser has not yet committed to. */
  partial(text) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal: false })] })
  }
  fail(error) { this.onerror?.({ error }) }
}
globalThis.window = globalThis
globalThis.SpeechRecognition = FakeRecognition

const { listen } = await importTs('lib/voice/speech.ts')

// ── An end nobody asked for must RESTART, not report ────────────────────────
{
  built.length = 0
  let errors = 0, finals = 0
  const h = listen({ onFinal: () => finals++, onError: () => errors++ })
  const rec = built[0]
  check('it starts listening', !!h && rec.started === 1, `started ${rec.started}`)

  rec.endNaturally()          // Chrome gives up after silence
  await tick(200)
  check('a session ending on its own does not report "I didn\'t catch that"', errors === 0,
    `${errors} error(s)`)
  check('it restarts instead', rec.started === 2, `started ${rec.started}`)

  // Now the user actually speaks, and then clicks the button to finish.
  rec.say('loop bass two three more times')
  h.stop()
  await tick(200)
  check('stopping delivers what was said', finals === 1, `${finals} final(s)`)
  check('and reports no error', errors === 0, `${errors} error(s)`)
}

// ── Stopping BETWEEN sessions still delivers ────────────────────────────────
// The restart is on a timer, so at this moment there is no live recognition for
// stop() to end and no onend will fire. Without a fallback the transcript is
// never handed over and the button sits on "Listening…" forever.
{
  built.length = 0
  let finals = 0, errors = 0, text = ''
  const h = listen({ onFinal: t => { finals++; text = t }, onError: () => errors++ })
  const rec = built[0]
  rec.say('move everything over by one bar')
  rec.endNaturally()          // session over; a restart is now pending on a timer
  h.stop()                    // ...and the user clicks stop inside that window
  await tick(500)
  check('stopping between sessions still delivers', finals === 1, `${finals} final(s)`)
  check('with the words intact', text === 'move everything over by one bar', text)
  check('and no spurious error', errors === 0, `${errors} error(s)`)
}

// ── A network blip is not the end ───────────────────────────────────────────
//
// Chrome's recognition is not local: it streams audio to Google and gets words
// back, so `network` is an ordinary transient — a VPN, a firewall, a slow
// connection, a service hiccup — and it arrives IMMEDIATELY, before a word has
// been spoken. Treating it like a denied microphone is what produced "it said
// speech recognition failed right off the bat before I could even say
// anything".
{
  built.length = 0
  const msgs = []
  let finals = 0
  const h = listen({ onFinal: t => { finals++; void t }, onError: m => msgs.push(m) })
  const rec = built[0]
  rec.fail('network')
  rec.endNaturally()
  // The retry after an error BACKS OFF — every restart re-opens the microphone,
  // and restarting every 120ms against a failing service shows up as the
  // recording indicator flashing on and off once a second. So it should NOT
  // have restarted yet at 250ms...
  await tick(250)
  check('a network blip does not report a failure', msgs.length === 0, msgs.join(' | '))
  check('and it does not re-open the microphone immediately', rec.started === 1,
    `started ${rec.started}`)
  // ...but it does come back.
  await tick(500)
  check('and it keeps listening', rec.started === 2, `started ${rec.started}`)

  // ...and the words still arrive afterwards.
  rec.say('set the tempo to 120')
  h.stop()
  await tick(400)
  check('and the command still lands after a blip', finals === 1, `${finals} final(s)`)
}

// ── ...but a service that never works must say so ───────────────────────────
{
  built.length = 0
  const msgs = []
  const h = listen({ onFinal: () => {}, onError: m => msgs.push(m) })
  const rec = built[0]
  // Twelve in a row is not a blip.
  for (let i = 0; i < 14; i++) { rec.fail('network'); rec.endNaturally(); await tick(150) }
  check('a service that never answers is eventually reported',
    msgs.some(m => /speech service|type the command/i.test(m)), msgs.slice(-1).join(''))
  check('and it stops retrying', rec.started < 14, `started ${rec.started}`)
  h.abort()
}

// ── A fatal error must not spin ─────────────────────────────────────────────
{
  built.length = 0
  const msgs = []
  const h = listen({ onFinal: () => {}, onError: m => msgs.push(m) })
  const rec = built[0]
  rec.fail('not-allowed')
  rec.endNaturally()
  await tick(300)
  check('a denied microphone is reported', msgs.some(m => /permission/i.test(m)), msgs.join(' | '))
  check('and it does not restart forever', rec.started === 1, `started ${rec.started}`)
  check('and it does not ALSO say "I didn\'t catch that"',
    !msgs.some(m => /didn't catch/i.test(m)), msgs.join(' | '))
  h.abort()
}

// ── Silence, genuinely ──────────────────────────────────────────────────────
// The message still has to exist: the caller stopped it and nothing was heard.
{
  built.length = 0
  const msgs = []
  const h = listen({ onFinal: () => {}, onError: m => msgs.push(m) })
  h.stop()
  await tick(400)
  check('stopping with nothing said does say "I didn\'t catch that"',
    msgs.some(m => /didn't catch/i.test(m)), msgs.join(' | '))
}

// ── Heard, shown, and thrown away ───────────────────────────────────────────
//
// ⚠️ Brae: "I asked Light to 'Change the reverb on pad to 100%' and it heard me
// but said 'I didn't catch that'." Both halves were true. Interim results are
// what appears on screen; only FINAL ones were kept; and a session that ends
// before the recogniser promotes the one to the other discarded the sentence
// while its words were still visible.
{
  built.length = 0
  let got = null, errors = 0
  const h = listen({ onFinal: (t, _alts, conf) => { got = { t, conf } }, onError: () => errors++ })
  const rec = built[0]

  rec.partial('change the reverb on pad to 100%')
  h.stop()
  await tick(200)
  check('words seen but never finalised are delivered, not discarded',
    got?.t === 'change the reverb on pad to 100%', JSON.stringify(got))
  check('and they do not report "I didn\'t catch that"', errors === 0, `${errors} error(s)`)
  // Low confidence is not a detail — it is what sends an unconfirmed sentence to
  // the assistant instead of letting a rule fire on words nobody stood behind.
  check('delivered at reduced confidence', got?.conf === 0.5, String(got?.conf))
}

// ── A real final still wins ─────────────────────────────────────────────────
{
  built.length = 0
  let got = null
  const h = listen({ onFinal: (t, _alts, conf) => { got = { t, conf } }, onError: () => {} })
  const rec = built[0]
  rec.partial('mute the')
  rec.say('mute the pad')
  h.stop()
  await tick(200)
  check('a finalised sentence is used instead of the interim', got?.t === 'mute the pad', JSON.stringify(got))
  check('and keeps its own confidence', got?.conf === 1, String(got?.conf))
}

console.log(failures
  ? `\n${failures} failing`
  : '\nthe microphone stays open until the caller closes it')
assert.equal(failures, 0)
