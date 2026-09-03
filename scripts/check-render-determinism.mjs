// The same song, on two machines running different audio rates, must render to
// the same audio — sample for sample.
//
// Brae: "we want it to work on the desktop app... let's see what we can do to
// make sure that the song never sounds different on another machine."
//
// A browser's AudioContext runs at whatever the sound device runs at: 44.1 kHz
// on a lot of hardware, 48 kHz on most of the rest, and the desktop app is
// another Chromium with the same exposure. So this opens the studio twice, with
// the live context forced to each rate, renders the same project, and compares.
//
// ⚠️ Before the fix this could not pass: the render used the device rate, so
// the two runs produced different-length, different-content buffers — and
// nothing in the cache key said so.

import { chromium } from 'playwright'
// Fixtures inline: this runs from the repo, not the scratch dir.
const POLY_INSTRUMENT = {
  type: 'poly',
  params: {
    waveform: 'sawtooth', attack: 0.005, decay: 0.15, sustain: 0.6, release: 0.4, detune: 0,
    filterType: 'lowpass', filterCutoff: 2400, filterResonance: 1.2,
    lfoEnabled: false, lfoRate: 4, lfoDepth: 0.3, lfoTarget: 'filter', lfoWaveform: 'sine',
  },
}
const midiClip = (id, trackId, notes, opts = {}) => ({
  id, kind: 'midi', trackId, name: opts.name ?? 'Notes',
  startBeat: opts.startBeat ?? 0, durationBeats: opts.durationBeats ?? 4, color: '#4aa9ff', notes,
})
import { createHash } from 'node:crypto'
import { writeFileSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'

import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
const OUT = mkdtempSync(join(tmpdir(), 'render-determinism-'))
// ⚠️ Comparing the ENCODED bytes is wrong: the render comes back as AAC, which
// is lossy and whose container carries encoder state, so two identical renders
// can still differ byte for byte. Decode both to raw PCM at one fixed rate and
// compare THAT — the audio, not its packaging.
function pcm(buf, tag) {
  writeFileSync(`${OUT}/det-${tag}.m4a`, buf)
  execSync(`ffmpeg -y -loglevel error -i ${OUT}/det-${tag}.m4a -ar 48000 -ac 2 -f s16le -acodec pcm_s16le ${OUT}/det-${tag}.raw`)
  return readFileSync(`${OUT}/det-${tag}.raw`)
}
function bandRms(raw) {
  let s = 0, n = 0
  for (let i = 0; i + 1 < raw.length; i += 2) { const v = raw.readInt16LE(i) / 32768; s += v * v; n++ }
  return { samples: n, rms: Math.sqrt(s / Math.max(1, n)) }
}

// One render per machine cannot see an intermittent fault; this many can.
const REPEATS = Number(process.env.REPEATS || 12)

const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })

async function renderAt(deviceRate) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await ctx.addCookies([{ name: '__clerk_db_jwt', value: 'dev', domain: 'localhost', path: '/' }])
  const page = await ctx.newPage()
  // Force the LIVE context to this machine's "sound card" rate, the way a real
  // device would, before any studio code constructs one.
  await page.addInitScript(rate => {
    const Real = window.AudioContext
    window.AudioContext = class extends Real {
      constructor(opts) { super({ ...(opts || {}), sampleRate: rate }) }
    }
    window.webkitAudioContext = window.AudioContext
  }, deviceRate)
  await page.goto('http://localhost:3000/create?modules=audio&audioMode=music', { waitUntil: 'domcontentloaded', timeout: 180000 })
  await page.waitForFunction(() => !!window.__dawDispatch, { timeout: 180000 })
  await page.waitForTimeout(4000)
  const setup = page.locator('div[aria-label="Choose your studio setup"]')
  if (await setup.count()) { await setup.locator('button').last().click(); await page.waitForTimeout(2000) }
  await page.waitForFunction(() => document.querySelectorAll('[data-help-id]').length > 0, { timeout: 60000 })

  await page.evaluate(({ inst, clip }) => {
    window.__dawDispatch({ type: 'ADD_TRACK', id: 'tk', name: 'Pad' })
    window.__dawDispatch({ type: 'SET_INSTRUMENT', trackId: 'tk', instrument: inst })
    window.__dawDispatch({ type: 'ADD_CLIP', clip })
    window.__dawDispatch({ type: 'ADD_EFFECT', trackId: 'tk', effect: {
      id: 'flt', type: 'filter', params: { enabled: true, type: 'lowpass', frequency: 900, q: 2 } } })
    // ⚠️ The reverb is not decoration here. Its impulse response is NOISE, and
    // it was filled with Math.random() — so before the fix this song rendered
    // to different audio every time even on one machine, and the tail is the
    // part no listener would ever spot by ear.
    window.__dawDispatch({ type: 'ADD_EFFECT', trackId: 'tk', effect: {
      id: 'rev', type: 'reverb', params: { enabled: true, mix: 0.45, decay: 2.4 } } })
  }, {
    inst: POLY_INSTRUMENT,
    clip: midiClip('c1', 'tk', [40, 47, 52, 59].map((p, i) => ({ id: `n${i}`, pitch: p, startBeat: i * 0.5, durationBeats: 4, velocity: 108 })), { durationBeats: 8 }),
  })
  await page.waitForTimeout(1800)

  const live = await page.evaluate(() => window.__dawEngine?.ctx?.sampleRate ?? null)

  // ⚠️ Render REPEATEDLY, not once. Two separate bugs made a song sound
  // different, and only one of them was the device: the other was a race
  // between posting notes to the Apollo worklet and starting the render, which
  // dropped notes in roughly one render out of eight. A single render per
  // machine passes that bug seven times out of eight and calls it determinism.
  const runs = []
  for (let i = 0; i < REPEATS; i++) {
    const m = await page.evaluate(() => window.__dawRenderOffline({ startBeat: 0, endBeat: 8 }))
    const buf = Buffer.from(m.base64, 'base64')
    runs.push({ buf, sha: createHash('sha256').update(pcm(buf, 'probe')).digest('hex').slice(0, 16), durationSec: m.durationSec })
  }
  const distinct = [...new Set(runs.map(r => r.sha))]
  console.log(`  ${REPEATS} renders at ${live} Hz → ${distinct.length} distinct result${distinct.length === 1 ? '' : 's'}`)
  if (distinct.length > 1) {
    for (const sha of distinct) console.log(`    ${sha} ×${runs.filter(r => r.sha === sha).length}`)
  }
  const r = { base64: runs[0].buf.toString('base64'), durationSec: runs[0].durationSec }
  await ctx.close()
  return { live, bytes: runs[0].buf, durationSec: r.durationSec, distinct: distinct.length }
}

const a = await renderAt(44100)
const b = await renderAt(48000)
console.log(`machine A: live context ${a.live} Hz — render ${a.bytes?.length ?? 0} bytes, ${a.durationSec?.toFixed?.(3)}s`)
console.log(`machine B: live context ${b.live} Hz — render ${b.bytes?.length ?? 0} bytes, ${b.durationSec?.toFixed?.(3)}s`)

if (!a.bytes || !b.bytes) { console.log('NO RENDER — cannot compare'); process.exit(1) }
const pa = pcm(a.bytes, 'a'), pb = pcm(b.bytes, 'b')
const sa = bandRms(pa), sb = bandRms(pb)
console.log(`\ndecoded A: ${sa.samples} samples, rms ${sa.rms.toFixed(6)}`)
console.log(`decoded B: ${sb.samples} samples, rms ${sb.rms.toFixed(6)}`)
// Sample-by-sample difference, as a level relative to the signal.
const n = Math.min(pa.length, pb.length)
let diff = 0
for (let i = 0; i + 1 < n; i += 2) { const d = (pa.readInt16LE(i) - pb.readInt16LE(i)) / 32768; diff += d * d }
const diffRms = Math.sqrt(diff / Math.max(1, n / 2))
const diffDb = 20 * Math.log10(Math.max(diffRms, 1e-9) / Math.max(sa.rms, 1e-9))
console.log(`difference between them: ${diffDb.toFixed(1)} dB below the signal`)
const ha = createHash('sha256').update(pa).digest('hex').slice(0, 16)
const hb = createHash('sha256').update(pb).digest('hex').slice(0, 16)
console.log(`pcm sha  A ${ha}\n         B ${hb}`)
console.log(a.live !== b.live ? `(the two really were different machines: ${a.live} vs ${b.live} Hz)` : '⚠️ both contexts ended up the same rate — the test proved nothing')
// AAC is lossy, so identical renders decode to very-nearly identical PCM. A
// difference far below the signal means the same audio through a lossy codec;
// a difference near it means the renders genuinely differ.
const stable = a.distinct === 1 && b.distinct === 1
if (!stable) console.log('\n⚠️ one machine did not even agree with ITSELF — that is the note-drop race, not the device')
const same = stable && sa.samples === sb.samples && diffDb < -40
console.log(same
  ? '\nIDENTICAL — the song renders the same on both machines ✓'
  : `\nDIFFERENT — the render still depends on the device ✗`)
await browser.close()
process.exit(same && a.live !== b.live ? 0 : 1)
