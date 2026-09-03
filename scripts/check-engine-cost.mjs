/**
 * What does ONE Apollo engine actually cost, and where does the money go?
 *
 *   PORT=4684 node scripts/check-engine-cost.mjs
 *
 * Brae: "Why is nothing helping the Beacon lag... Look for more extreme and
 * creative solutions."
 *
 * ⚠️ EVERY FIX SO FAR HAS REDUCED THE NUMBER OF ENGINES. None has asked what an
 * engine COSTS, and without that number there is no way to know whether one per
 * track is affordable at all. Beacon runs a whole Helios synth per track —
 * Apollo was built as a standalone instrument that owns the machine, and each
 * instance allocates its own 32 voices, its own LFO tables and its own reverb.
 *
 * This renders offline and times it, which turns the question into a ratio:
 * seconds of CPU per second of audio. Above 1.0 in real time is a dropout; a
 * real machine needs to stay well under it, because the browser, the UI and the
 * rest of the mix are on the same chip.
 *
 * ⚠️ IDLE AND PLAYING ARE MEASURED SEPARATELY, and that is the whole point. If
 * an idle engine is nearly free, the cost is voices and the answer is fewer
 * notes. If an idle engine is expensive, the cost is the INSTANCE and no amount
 * of note-level tuning will help — the answer is fewer engines, which means one
 * multi-timbral engine instead of one per track.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = `http://localhost:${process.env.PORT || '4684'}`
const FIXTURE = join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')
if (!existsSync(FIXTURE)) { console.log(`no fixture at ${FIXTURE}`); process.exit(1) }
const PATCH = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  .dawProject.tracks.find(t => t.instrument?.type === 'apollo').instrument.params

const browser = await chromium.launch({ args: ['--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 140)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)

const bench = async (engines, notesPerEngine, seconds, patch) => page.evaluate(
  async ({ engines, notesPerEngine, seconds, patch }) => {
    const RATE = 48000
    const ctx = new OfflineAudioContext(2, RATE * seconds, RATE)
    // ⚠️ Cache-busted. The service worker answers .js stale-while-revalidate, so
    // an unversioned request here would benchmark whichever engine happened to
    // be cached — which is the very hazard this session just found in the app.
    await ctx.audioWorklet.addModule('/apollo/engine.js?v=probe-' + Date.now())
    const master = ctx.createGain()
    master.gain.value = 0.3
    master.connect(ctx.destination)

    for (let i = 0; i < engines; i++) {
      const node = new AudioWorkletNode(ctx, 'apollo-engine', { numberOfInputs: 0, outputChannelCount: [2] })
      node.connect(master)
      node.port.postMessage({ type: 'patch', patch })
      if (notesPerEngine > 0) {
        const events = []
        // Chords, spread across the render, held long enough to overlap.
        for (let b = 0; b < seconds * 2; b++) {
          for (let v = 0; v < notesPerEngine; v++) {
            const t = b * 0.5
            events.push({ t, type: 'noteOn', note: 48 + v * 4 + (i % 3), vel: 0.8 })
            events.push({ t: t + 0.45, type: 'noteOff', note: 48 + v * 4 + (i % 3) })
          }
        }
        node.port.postMessage({ type: 'scheduleAt', events })
      }
    }
    // Let the patches and any samples land before rendering starts.
    await new Promise(r => setTimeout(r, 900))
    const t0 = performance.now()
    const buf = await ctx.startRendering()
    const ms = performance.now() - t0
    let peak = 0
    const d = buf.getChannelData(0)
    for (let i = 0; i < d.length; i += 16) { const v = Math.abs(d[i]); if (v > peak) peak = v }
    return { ms: Math.round(ms), ratio: +(ms / 1000 / seconds).toFixed(3), peak: +peak.toFixed(4) }
  }, { engines, notesPerEngine, seconds, patch })

const SEC = 4
console.log('\nOffline render: CPU-seconds per second of audio (lower is better).\n')
console.log('  engines   notes each   ratio    peak     verdict')

/**
 * Best of three.
 *
 * ⚠️ The same configuration measured 0.394, 1.157 and 2.274 across three runs on
 * this machine — a six-fold swing, entirely from other processes. The MINIMUM is
 * the honest number: it is the run that got the fairest share of the CPU, and
 * every other run is that plus interference. Averaging measures the neighbours.
 */
const row = async (n, notes, patch = PATCH, label = '') => {
  let r = null
  for (let i = 0; i < 3; i++) {
    const one = await bench(n, notes, SEC, patch)
    if (!r || one.ratio < r.ratio) r = one
  }
  const verdict = r.ratio > 1 ? 'OVER BUDGET' : r.ratio > 0.5 ? 'tight' : 'ok'
  console.log(`  ${String(n).padStart(7)}   ${String(notes).padStart(10)}   ${String(r.ratio).padStart(5)}   ${r.peak.toFixed(4)}   ${verdict}${label}`)
  return r
}

console.log('\n  — idle engines: the cost of EXISTING —')
const idle1 = await row(1, 0)
const idle4 = await row(4, 0)
const idle8 = await row(8, 0)

console.log('\n  — the same engines playing four-note chords —')
const play1 = await row(1, 4)
const play4 = await row(4, 4)
const play8 = await row(8, 4)

// ⚠️ 'draft' skips the per-sample cutoff ramp and other niceties; 'high' renders
// at 2x and decimates. Worth knowing what the setting is actually worth before
// suggesting anybody change it.
const draft = JSON.parse(JSON.stringify(PATCH)); draft.global.quality = 'draft'
const high = JSON.parse(JSON.stringify(PATCH)); high.global.quality = 'high'
console.log('\n  — 8 engines, same notes, different quality settings —')
await row(8, 4, draft, "   quality 'draft'")
await row(8, 4, PATCH, "   quality 'good' (default)")
await row(8, 4, high, "   quality 'high' (2x oversampled)")

// ── WHERE does the money go inside one engine? ────────────────────────────
//
// ⚠️ THE QUESTION THAT DECIDES THE FIX. If the cost is Apollo's own FX bus, then
// Beacon is paying for a reverb and a delay PER TRACK inside each engine while
// it already has its own track effects outside — the same processing twice, and
// the inner copy cannot be shared between tracks. That is removable. If the cost
// is oscillators and filters, it is the synth itself and only fewer voices or a
// bounce will help.
const variant = (name, fn) => { const p = JSON.parse(JSON.stringify(PATCH)); fn(p); return [name, p] }
const variants = [
  variant('everything on (as saved)', () => {}),
  variant('Apollo FX bus off', p => { if (Array.isArray(p.fx)) for (const f of p.fx) f.enabled = false }),
  variant('unison forced to 1', p => { for (const o of p.oscs || []) { o.unison = 1; o.voices = 1 } }),
  variant('second filter off', p => { if (p.filters?.[1]) p.filters[1].enabled = false }),
  variant('FX off + unison 1', p => {
    if (Array.isArray(p.fx)) for (const f of p.fx) f.enabled = false
    for (const o of p.oscs || []) { o.unison = 1; o.voices = 1 }
  }),
]
console.log('\n  — 4 engines, four-note chords, one thing removed at a time —')
for (const [name, p] of variants) await row(4, 4, p, `   ${name}`)

// ⚠️ THE ONE LEVER THAT SCALES WITH ACTUAL WORK. Every variant above removes a
// FEATURE and saves ~6%, because the cost is the voice itself. Polyphony is
// different: it is how MANY voices exist, and a patch saved at 16 keeps 16
// alive per track whether the part needs them or not. Release tails are what
// fills them — a four-note chord every half second overlaps its own decay.
console.log('\n  — 4 engines, same notes, different polyphony —')
for (const poly of [16, 8, 4, 2]) {
  const p = JSON.parse(JSON.stringify(PATCH)); p.global.poly = poly
  await row(4, 4, p, `   poly ${poly}${poly === (PATCH.global.poly ?? 16) ? ' (as saved)' : ''}`)
}

console.log(`\n${'='.repeat(70)}`)
const perIdle = (idle8.ratio - idle1.ratio) / 7
const perVoice = ((play8.ratio - idle8.ratio) - (play1.ratio - idle1.ratio)) / 7
console.log(`cost of one MORE idle engine:     ${perIdle.toFixed(3)} of real time`)
console.log(`cost of its notes on top:         ${perVoice.toFixed(3)}`)
console.log(perIdle > perVoice
  ? '\n⚠️  EXISTING costs more than PLAYING. The per-instance overhead is the\n'
    + '    problem, so reducing notes cannot fix it — one multi-timbral engine\n'
    + '    shared by every track is the shape of the answer.'
  : '\nPlaying costs more than existing — the cost is voices, not instances.')

await browser.close()
process.exit(0)
