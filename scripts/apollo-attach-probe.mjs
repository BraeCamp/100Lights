/**
 * How many Apollo engines does ONE track need?
 *
 *   PORT=4670 node scripts/apollo-attach-probe.mjs
 *
 * daw-instruments.ts says "Apollo runs a persistent AudioWorklet engine per
 * track destination". daw-instrument.ts keys them in a WeakMap by that
 * destination node. The question this settles is whether the destination is
 * actually per-track — because playInstrumentNote is handed `noteDest`, and
 * noteDest is only `nodes.midiInput` when a note needs no FX chain of its own.
 * With roll FX it becomes a per-CLIP chain input, and when that chain cannot be
 * shared it becomes a per-NOTE one.
 *
 * Each is a full Helios polysynth rendering every 128-sample quantum.
 *
 * Controlled: identical one-track projects that differ only in what should be
 * irrelevant to how many synths exist — clip count, then a clip effect.
 */
import { chromium } from 'playwright'

const BASE = `http://localhost:${process.env.PORT || '4670'}`

const note = (start, pitch) => ({
  id: `n${start}_${pitch}`, pitch, velocity: 100, startBeat: start, durationBeats: 0.5,
})

/** One Apollo track, `clips` clips of 4 notes each. */
function project({ clips = 1, clipEffects = false, rollFx = false }) {
  const trackId = 't-apollo'
  const arrangementClips = []
  for (let c = 0; c < clips; c++) {
    arrangementClips.push({
      kind: 'midi', id: `c${c}`, trackId, name: `Clip ${c}`,
      startBeat: c * 4, durationBeats: 4,
      notes: [0, 1, 2, 3].map(i => note(i, 60 + i)),
      ...(rollFx ? { rollFx: typeof rollFx === 'object' ? rollFx : { filterHz: 800 } } : {}),
    })
  }
  return {
    id: 'p1', name: 'probe', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
    swing: 0, masterVolume: 0.8,
    tracks: [{
      id: trackId, name: 'Apollo', type: 'midi', color: '#8b5cf6',
      volume: 0.8, pan: 0, mute: false, solo: false, armed: false, height: 90,
      effects: [],
      // The simplest possible Apollo instrument — the default patch.
      instrument: { type: 'apollo', params: { version: 1 } },
    }],
    arrangementClips,
    clipEffects: clipEffects
      ? [{ id: 'ce1', trackId, type: 'lowpass', startBeat: 0, durationBeats: 64, amount: 0.5 }]
      : [],
    returnTracks: [], automationLanes: [], sessionGrid: [], scenes: [], takeLanes: [],
    loopStart: 0, loopEnd: 4, loopEnabled: false,
  }
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
})
const page = await browser.newPage()
page.on('pageerror', e => console.log('  page error:', String(e).slice(0, 120)))

await page.addInitScript(() => {
  const w = window
  w.__n = { made: 0 }
  const Orig = w.AudioWorkletNode
  if (Orig) {
    w.AudioWorkletNode = new Proxy(Orig, {
      construct(t, a, nt) {
        if (String(a[1]) === 'apollo-engine') w.__n.made++
        return Reflect.construct(t, a, nt)
      },
    })
  }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 120000 })
await page.waitForTimeout(2500)

async function run(label, proj) {
  await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), proj)
  await page.waitForTimeout(2500)
  await page.evaluate(() => { window.__n.made = 0 })
  // One play long enough to schedule every clip, then stop.
  await page.evaluate(() => { void window.__dawEngine?.play(0) })
  await page.waitForTimeout(6000)
  await page.evaluate(() => window.__dawEngine?.stop())
  await page.waitForTimeout(1200)
  const made = await page.evaluate(() => window.__n.made)
  console.log(`  ${label.padEnd(46)} ${String(made).padStart(3)} Apollo engines`)
  return made
}

console.log('\nONE Apollo track. Engines built during a single play/stop:\n')
const a = await run('1 clip,  no clip FX', project({ clips: 1 }))
const b = await run('4 clips, no clip FX', project({ clips: 4 }))
const c = await run('8 clips, no clip FX', project({ clips: 8 }))
const d = await run('4 clips, WITH a clip effect', project({ clips: 4, clipEffects: true }))
const e = await run('4 clips, WITH roll FX (low-pass)', project({ clips: 4, rollFx: { filterHz: 800 } }))
const f = await run('4 clips, WITH a FILTER ENVELOPE', project({ clips: 4, rollFx: { filterHz: 800, filterEnv: 0.6 } }))

console.log(`\n${'='.repeat(64)}`)
console.log('One track should need exactly ONE engine, whatever it contains.')
console.log(`  scaling with clip count:   1->${a}   4->${b}   8->${c}`)
console.log(`  a clip effect costs:       ${d - b > 0 ? '+' : ''}${d - b} more than the same 4 clips`)
console.log(`  roll FX costs:             ${e - b > 0 ? '+' : ''}${e - b} more than the same 4 clips`)
console.log(`  a filter envelope costs:   ${f - b > 0 ? '+' : ''}${f - b} more than the same 4 clips`)
console.log(c > a || e > 0 || f > 0
  ? '\n⚠️  Engine count GROWS WITH CONTENT. The WeakMap is keyed by the note\n'
    + '    destination, and that is per-clip (or per-note) whenever a note needs\n'
    + '    an FX chain — so "one engine per track" is not what happens.'
  : '\nOne engine per track, as intended.')

await browser.close()
process.exit(0)
