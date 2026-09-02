/**
 * How much can the audio thread actually carry before it breaks?
 *
 *   PORT=4682 node scripts/check-load-ceiling.mjs
 *
 * Brae: "Continue to reduce the CPU and ram load until it has its problems so
 * that you can find the weak links."
 *
 * ⚠️ THROTTLING THE MACHINE COULD NOT DO IT, and the reason matters. The
 * debugger's CPU throttle slows the MAIN thread only — at 1/20 speed with a
 * 256MB heap the studio still played perfectly, because Apollo's DSP does not
 * run there. It runs on the audio render thread, which no throttle reaches.
 *
 * So the pressure goes on the work instead: the same song, with more of it,
 * until the sound gives out. That finds the ceiling in the units that matter —
 * how many Apollo engines and how many simultaneous voices — rather than in
 * units of somebody else's laptop.
 *
 * ⚠️ CHORDS, NOT SINGLE NOTES. "It plays one chord then goes quiet" is a
 * polyphony-shaped complaint, and one note per beat would never find it.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

// ⚠️ A REAL PATCH, not a stub. `{ version: 1 }` is accepted by everything and
// sounds like nothing — no oscillator is enabled in it — so a probe built on one
// measures silence and calls it a fault. Taken from a real song instead.
const FIXTURE = join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')
const PATCH = existsSync(FIXTURE)
  ? JSON.parse(readFileSync(FIXTURE, 'utf8')).dawProject.tracks.find(t => t.instrument?.type === 'apollo')?.instrument.params
  : { version: 1 }

const BASE = `http://localhost:${process.env.PORT || '4682'}`
const SECONDS = Number(process.env.SECONDS || 8)

/** `tracks` Apollo tracks, each `clips` clips of four-note chords. */
function project({ tracks, clips, clipEffects }) {
  const t = [], arrangementClips = [], effects = []
  for (let k = 0; k < tracks; k++) {
    const id = `t${k}`
    t.push({
      id, name: `Apollo ${k}`, type: 'midi', color: '#8b5cf6',
      volume: 0.6, pan: 0, mute: false, solo: false, armed: false, height: 90,
      effects: [], instrument: { type: 'apollo', params: JSON.parse(JSON.stringify(PATCH)) },
    })
    for (let c = 0; c < clips; c++) {
      arrangementClips.push({
        kind: 'midi', id: `c${k}_${c}`, trackId: id, name: `c${c}`,
        startBeat: c * 4, durationBeats: 4,
        // A four-note chord on every beat — the shape that exhausts polyphony.
        notes: [0, 1, 2, 3].flatMap(b =>
          [0, 4, 7, 11].map(iv => ({
            id: `n${k}_${c}_${b}_${iv}`, pitch: 48 + iv + (k % 3) * 5,
            velocity: 100, startBeat: b, durationBeats: 0.9,
          }))),
      })
    }
    if (clipEffects) {
      effects.push({ id: `ce${k}`, trackId: id, type: 'lowpass', startBeat: 0, durationBeats: 512, amount: 0.5 })
    }
  }
  return {
    id: 'p', name: 'ceiling', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
    swing: 0, masterVolume: 0.8, tracks: t, arrangementClips, clipEffects: effects,
    returnTracks: [], automationLanes: [], sessionGrid: [], scenes: [], takeLanes: [],
    loopStart: 0, loopEnd: clips * 4, loopEnabled: false,
  }
}

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 120)))

await page.addInitScript(() => {
  const w = window
  w.__c = { made: 0, procErrors: 0 }
  const O = w.AudioWorkletNode
  if (O) {
    w.AudioWorkletNode = new Proxy(O, {
      construct(t, a, nt) {
        const n = Reflect.construct(t, a, nt)
        if (String(a[1]) === 'apollo-engine') { w.__c.made++; n.onprocessorerror = () => { w.__c.procErrors++ } }
        return n
      },
    })
  }
})

await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !!window.__dawEngine, null, { timeout: 180000 })
await page.waitForTimeout(3000)

await page.evaluate(() => {
  const e = window.__dawEngine
  const an = e.ctx.createAnalyser(); an.fftSize = 1024
  ;(e.masterGain ?? e.master).connect(an)
  const buf = new Float32Array(an.fftSize)
  window.__peak = 0
  setInterval(() => {
    an.getFloatTimeDomainData(buf)
    let p = 0
    for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > p) p = v }
    if (p > window.__peak) window.__peak = p
  }, 40)
})

async function trial(cfg) {
  await page.evaluate(() => window.__dawEngine?.stop())
  await page.waitForTimeout(700)
  await page.evaluate(p => window.__dawDispatch?.({ type: 'LOAD_PROJECT', project: p }), project(cfg))
  await page.waitForTimeout(3500)
  await page.evaluate(() => { window.__c.made = 0; void window.__dawEngine?.play(0) })

  let prev = 0, silent = 0, slow = 0, first = 0
  for (let i = 1; i <= SECONDS; i++) {
    await page.waitForTimeout(1000)
    const r = await page.evaluate(() => {
      const p = window.__peak; window.__peak = 0
      return { p, beat: window.__dawEngine?.currentBeat ?? 0, ...window.__c }
    })
    const rate = i === 1 ? 2 : r.beat - prev
    prev = r.beat
    if (i === 1) first = r.p
    if (r.p < 0.001) silent++
    if (rate < 1.4) slow++
  }
  const s = await page.evaluate(() => ({ ...window.__c }))
  const verdict = silent >= 3 ? 'WENT QUIET' : slow >= 3 ? 'SLOWED' : 'ok'
  const label = `${cfg.tracks} tracks x ${cfg.clips} clips${cfg.clipEffects ? ' + clip FX' : ''}`
  console.log(`  ${label.padEnd(34)} engines ${String(s.made).padStart(4)}  procErr ${s.procErrors}  first-second level ${first.toFixed(4)}  ${verdict}`)
  return { verdict, made: s.made, procErrors: s.procErrors }
}

console.log('\nSame song, more of it, until the sound gives out.\n')
const steps = [
  { tracks: 1, clips: 4 },
  { tracks: 4, clips: 4 },
  { tracks: 8, clips: 8 },
  { tracks: 8, clips: 8, clipEffects: true },
  { tracks: 16, clips: 16, clipEffects: true },
  { tracks: 32, clips: 16, clipEffects: true },
]
for (const s of steps) {
  const r = await trial(s)
  if (r.verdict !== 'ok') { console.log('\n⚠️  Broke here — this is the ceiling, in engines and voices.'); break }
}

await browser.close()
process.exit(0)
