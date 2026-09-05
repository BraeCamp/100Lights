// The Beats and Texture warp modes (lib/warp-modes.ts), through the renderer:
// Beats slows a click loop to half speed by moving each slice to its beat and
// playing it as recorded — the clicks stay short and land a beat apart, the
// gaps are silent with Loop Off, filled with Forward, and the Transient
// Envelope fades a slice; Texture keeps the energy and the length. Runs on a
// fake buffer.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { renderWarped } = await importTs('lib/warp-render.ts')
const { beatsSpan, textureSpan, DEFAULT_BEATS } = await importTs('lib/warp-modes.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const sr = 1000
const makeBuffer = (channels, frames, sampleRate) => {
  const chans = Array.from({ length: channels }, () => new Float32Array(frames))
  return { sampleRate, numberOfChannels: channels, length: frames, duration: frames / sampleRate, getChannelData: i => chans[i] }
}
// Four 50 ms bursts (value 1) at 0, 0.5, 1.0, 1.5 s in a 2 s sample — a straight loop at 120.
const src = makeBuffer(1, 2 * sr, sr)
for (const t of [0, 0.5, 1, 1.5]) for (let i = 0; i < 50; i++) src.getChannelData(0)[Math.round(t * sr) + i] = 1
const transients = [0, 0.5, 1, 1.5]
const runs = buf => { const d = buf.getChannelData(0); const out = []; let inRun = false, start = 0; for (let i = 0; i < d.length; i++) { const on = Math.abs(d[i]) > 0.5; if (on && !inRun) { inRun = true; start = i } if (!on && inRun) { inRun = false; out.push([start / sr, (i - start) / sr]) } } if (inRun) out.push([start / sr, (d.length - start) / sr]); return out }
const straight = [{ beat: 0, sec: 0 }, { beat: 4, sec: 2 }]
// Half speed: the clip is 4 beats at 60 BPM — a beat is a second.
const wallSlow = (b0, b1) => (b1 - b0) * 1

check('Beats, Loop Off: each slice lands on its beat, plays as recorded, and the gap is silent', () => {
  const out = renderWarped(src, { markers: straight, clipBeats: 4, wallSeconds: wallSlow, mode: 'beats', makeBuffer, beats: { cutsSec: transients, params: DEFAULT_BEATS } })
  assert.equal(out.length, 4000)
  const r = runs(out)
  assert.equal(r.length, 4, `four bursts, got ${JSON.stringify(r)}`)
  for (const [i, [t, len]] of r.entries()) { assert.ok(Math.abs(t - i) < 0.002, `burst ${i} at ${t}`); assert.ok(Math.abs(len - 0.05) < 0.003, `burst ${i} still 50 ms (${len})`) }
})
check('Beats, Forward loop: the gap after each slice is filled with repeats of it', () => {
  const out = renderWarped(src, { markers: straight, clipBeats: 4, wallSeconds: wallSlow, mode: 'beats', makeBuffer, beats: { cutsSec: transients, params: { ...DEFAULT_BEATS, loop: 'forward' } } })
  const d = out.getChannelData(0)
  // The slice (50 ms burst then 450 ms of silence) repeats every 500 ms: a burst at 0.5 s inside the first slot, and at 1.5 s.
  assert.ok(d[Math.round(0.51 * sr)] > 0.5 && d[Math.round(1.51 * sr)] > 0.5, "a repeat's burst at 0.5 and 1.5 s")
  assert.ok(Math.abs(d[Math.round(0.3 * sr)]) < 0.01, "and the source's own silence between them")
})
check('Beats, Back-and-Forth: the second repeat runs backwards', () => {
  // A ramp slice makes direction visible.
  const ramp = makeBuffer(1, 100, sr)
  for (let i = 0; i < 100; i++) ramp.getChannelData(0)[i] = i / 100
  const out = new Float32Array(300)
  beatsSpan(ramp.getChannelData(0), 0, 100, 300, out, 0, [], { preserve: 'transients', loop: 'backforth', envelope: 100 }, sr)
  assert.ok(out[150] > out[190], 'the second copy descends')
  assert.ok(out[210] < out[290], 'the third ascends again')
})
check('Beats: the Transient Envelope fades a slice out when a gap follows', () => {
  const out = new Float32Array(200)
  const s = new Float32Array(100).fill(1)
  beatsSpan(s, 0, 100, 200, out, 0, [], { preserve: 'transients', loop: 'off', envelope: 50 }, sr)
  assert.equal(out[40], 1, 'the first half is untouched')
  assert.ok(out[75] < 0.6 && out[75] > 0.4, `fading through the second half (${out[75]})`)
  assert.ok(out[150] === 0, 'silence in the gap')
})
check('Beats: a slice too long for its slot is cut to fit', () => {
  const out = new Float32Array(50)
  const s = new Float32Array(100).fill(1)
  beatsSpan(s, 0, 100, 50, out, 0, [], DEFAULT_BEATS, sr)
  assert.equal(out[10], 1); assert.ok(out[49] < 0.5, 'faded at the cut')
})
check('Beats: grid cuts slice a span without transients', () => {
  const out = renderWarped(src, { markers: straight, clipBeats: 4, wallSeconds: wallSlow, mode: 'beats', makeBuffer, beats: { cutsSec: [0.5, 1, 1.5], params: DEFAULT_BEATS } })
  assert.equal(runs(out).length, 4)
})
check('Texture keeps the length and the energy, and is the same every time', () => {
  const tone = makeBuffer(1, 2 * sr, sr)
  for (let i = 0; i < 2 * sr; i++) tone.getChannelData(0)[i] = Math.sin((2 * Math.PI * 50 * i) / sr)
  const a = renderWarped(tone, { markers: straight, clipBeats: 4, wallSeconds: wallSlow, mode: 'texture', makeBuffer, texture: { params: { grainMs: 60, flux: 0.3 }, seed: 's' } })
  const b = renderWarped(tone, { markers: straight, clipBeats: 4, wallSeconds: wallSlow, mode: 'texture', makeBuffer, texture: { params: { grainMs: 60, flux: 0.3 }, seed: 's' } })
  assert.equal(a.length, 4000)
  const rms = buf => { const d = buf.getChannelData(0); let s = 0; for (const v of d) s += v * v; return Math.sqrt(s / d.length) }
  assert.ok(rms(a) > 0.4 && rms(a) < 0.8, `energy survives (${rms(a).toFixed(3)} vs the source's 0.707)`)
  assert.deepEqual([...a.getChannelData(0).slice(1000, 1100)], [...b.getChannelData(0).slice(1000, 1100)], 'seeded: identical twice')
})
check('textureSpan with no flux reads the source at the warped rate', () => {
  const s = new Float32Array(1000).fill(0.5)
  const out = new Float32Array(2000)
  textureSpan(s, 0, 1000, 2000, out, 0, { grainMs: 50, flux: 0 }, sr, 'x')
  assert.ok(Math.abs(out[1000] - 0.5) < 0.05, `a flat source stays flat (${out[1000]})`)
})

console.log(failures ? `\n${failures} failing` : '\nthe slices sit on the beat')
process.exit(failures ? 1 : 0)
