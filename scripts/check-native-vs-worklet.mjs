/**
 * What would Beacon save by playing native nodes instead of the Helios worklet?
 *
 *   PORT=4690 node scripts/check-native-vs-worklet.mjs
 *
 * Brae: "How can we change the Helios bridge so that it makes it work in
 * browser? Perhaps we can have all of the functions for Helios exist in Beacon,
 * and we'll have it sync up with Apollo separately."
 *
 * ⚠️ THE INSTINCT IS RIGHT AND THE REASON IS SPECIFIC. Helios is JavaScript in
 * an AudioWorklet: every sample of every voice is computed by the JS engine on
 * the audio thread. OscillatorNode, BiquadFilterNode and GainNode are the same
 * arithmetic implemented in the browser's own optimised C++, running below JS
 * entirely. Identical synthesis, very different price.
 *
 * ⚠️ AND MERGING ENGINES WOULD NOT HAVE HELPED. Already measured: an idle Apollo
 * engine costs 0.009 of real time, so one multi-timbral instance instead of one
 * per track saves almost nothing. The cost is voices, and the only ways to stop
 * paying for them are to compute them more cheaply (this) or not during playback
 * at all (freezing).
 *
 * Same notes, same count, both ways. The ratio is the answer.
 */
import { chromium } from 'playwright'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const BASE = `http://localhost:${process.env.PORT || '4690'}`
const FIXTURE = join(homedir(), 'Desktop', '100lights-ai-renders', 'close enough.cfproj')
if (!existsSync(FIXTURE)) { console.log(`no fixture at ${FIXTURE}`); process.exit(1) }
const PATCH = JSON.parse(readFileSync(FIXTURE, 'utf8'))
  .dawProject.tracks.find(t => t.instrument?.type === 'apollo').instrument.params

const browser = await chromium.launch({ args: ['--mute-audio'] })
const page = await browser.newPage()
page.on('pageerror', e => console.log('  PAGE ERROR:', String(e).slice(0, 140)))
await page.goto(`${BASE}/create?modules=audio&audioMode=music`, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3000)

const run = async (mode, tracks, patch) => page.evaluate(async ({ mode, tracks, patch, seconds }) => {
  const RATE = 48000
  const ctx = new OfflineAudioContext(2, RATE * seconds, RATE)
  const master = ctx.createGain(); master.gain.value = 0.2; master.connect(ctx.destination)

  if (mode === 'worklet') {
    await ctx.audioWorklet.addModule('/apollo/engine.js?v=probe-' + Date.now())
  }

  for (let k = 0; k < tracks; k++) {
    if (mode === 'worklet') {
      const node = new AudioWorkletNode(ctx, 'apollo-engine', { numberOfInputs: 0, outputChannelCount: [2] })
      node.connect(master)
      node.port.postMessage({ type: 'patch', patch })
      const events = []
      for (let b = 0; b < seconds * 2; b++) {
        for (let v = 0; v < 4; v++) {
          const t = b * 0.5
          events.push({ t, type: 'noteOn', note: 48 + v * 4 + (k % 3), vel: 0.8 })
          events.push({ t: t + 0.45, type: 'noteOff', note: 48 + v * 4 + (k % 3) })
        }
      }
      node.port.postMessage({ type: 'scheduleAt', events })
    } else {
      // ⚠️ A FAIR COMPARISON, not a cheap one: two detuned oscillators per
      // voice, a resonant low-pass, and an ADSR — the shape of an ordinary
      // Apollo patch, built from native nodes. Not every Helios feature, but
      // the ones that carry most of the sound.
      const trackGain = ctx.createGain()
      trackGain.gain.value = 0.25
      trackGain.connect(master)
      for (let b = 0; b < seconds * 2; b++) {
        for (let v = 0; v < 4; v++) {
          const t = b * 0.5
          const midi = 48 + v * 4 + (k % 3)
          const hz = 440 * Math.pow(2, (midi - 69) / 12)
          const env = ctx.createGain()
          const filt = ctx.createBiquadFilter()
          filt.type = 'lowpass'; filt.frequency.value = 1800; filt.Q.value = 6
          env.gain.setValueAtTime(0.0001, t)
          env.gain.exponentialRampToValueAtTime(0.6, t + 0.01)
          env.gain.exponentialRampToValueAtTime(0.25, t + 0.12)
          env.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
          filt.frequency.setValueAtTime(3200, t)
          filt.frequency.exponentialRampToValueAtTime(700, t + 0.4)
          for (const det of [-7, 7]) {
            const o = ctx.createOscillator()
            o.type = 'sawtooth'; o.frequency.value = hz; o.detune.value = det
            o.connect(filt); o.start(t); o.stop(t + 0.5)
          }
          filt.connect(env); env.connect(trackGain)
        }
      }
    }
  }
  await new Promise(r => setTimeout(r, 800))
  const t0 = performance.now()
  const buf = await ctx.startRendering()
  const ms = performance.now() - t0
  let peak = 0
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i += 16) { const v = Math.abs(d[i]); if (v > peak) peak = v }
  return { ratio: +(ms / 1000 / seconds).toFixed(3), peak: +peak.toFixed(3) }
}, { mode, tracks, patch, seconds: 4 })

const best = async (mode, tracks) => {
  let r = null
  for (let i = 0; i < 3; i++) {
    const one = await run(mode, tracks, PATCH)
    if (!r || one.ratio < r.ratio) r = one
  }
  return r
}

console.log('\nSame notes, same track counts. CPU-seconds per second of audio.\n')
console.log('  tracks   Helios worklet (JS)   native nodes (C++)   saving')
for (const n of [1, 4, 8, 16]) {
  const w = await best('worklet', n)
  const v = await best('native', n)
  const saving = w.ratio > 0 ? `${(w.ratio / Math.max(v.ratio, 0.001)).toFixed(1)}x cheaper` : '—'
  console.log(`  ${String(n).padStart(6)}   ${String(w.ratio).padStart(18)}   ${String(v.ratio).padStart(18)}   ${saving}`)
}

console.log('\nA ratio over 1.0 cannot play in real time. The audio thread is one')
console.log('thread and must finish every block before its deadline.')
await browser.close()
process.exit(0)
