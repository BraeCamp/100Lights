// The warp renderer (lib/warp-render.ts): a click train whose hits drifted is
// rendered through its markers and the clicks land on the grid; the render is
// as long as the clip's wall time; a span's speed follows its markers; the
// stretch mode hands each span to the stretcher with the right factor. Runs
// on a fake buffer — no Web Audio in Node.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { renderWarped, renderSpans, resampleSpan } = await importTs('lib/warp-render.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
const sr = 1000   // one frame a millisecond keeps the numbers readable
const makeBuffer = (channels, frames, sampleRate) => {
  const chans = Array.from({ length: channels }, () => new Float32Array(frames))
  return { sampleRate, numberOfChannels: channels, length: frames, duration: frames / sampleRate, getChannelData: i => chans[i] }
}
// Clicks (a single 1.0 frame) at 0, 0.45, 1.05, 1.5 s in a 2 s sample.
const src = makeBuffer(1, 2 * sr, sr)
for (const t of [0, 0.45, 1.05, 1.5]) src.getChannelData(0)[Math.round(t * sr)] = 1
const clicks = buf => { const d = buf.getChannelData(0); const out = []; for (let i = 0; i < d.length; i++) if (d[i] > 0.5) out.push(+(i / buf.sampleRate).toFixed(3)); return out }
const markers = [{ beat: 0, sec: 0 }, { beat: 1, sec: 0.45 }, { beat: 2, sec: 1.05 }, { beat: 3, sec: 1.5 }, { beat: 4, sec: 2 }]
const wall = (b0, b1) => (b1 - b0) * 0.5   // 120 bpm

check('the spans follow the markers, with their seconds and wall time', () => {
  const sp = renderSpans({ markers, clipBeats: 4, wallSeconds: wall })
  assert.deepEqual(sp.map(s => [s.beat0, s.beat1, s.sec0, s.sec1, s.wall]), [[0, 1, 0, 0.45, 0.5], [1, 2, 0.45, 1.05, 0.5], [2, 3, 1.05, 1.5, 0.5], [3, 4, 1.5, 2, 0.5]])
})
check('re-pitch: the drifted clicks land on the beat and the render is the clip\'s wall length', () => {
  const out = renderWarped(src, { markers, clipBeats: 4, wallSeconds: wall, mode: 'repitch', makeBuffer })
  assert.equal(out.length, 2000)
  const cs = clicks(out)
  assert.equal(cs.length, 4, `four clicks, got ${cs}`)
  for (const [i, c] of cs.entries()) assert.ok(Math.abs(c - i * 0.5) <= 0.002, `click ${i} at ${c}`)
})
check('a clip longer than its markers keeps the last span\'s speed to the end', () => {
  const out = renderWarped(src, { markers: [{ beat: 0, sec: 0 }, { beat: 2, sec: 1 }], clipBeats: 4, wallSeconds: wall, mode: 'repitch', makeBuffer })
  assert.equal(out.length, 2000)
  // 0.5 s of sample per beat = as recorded; the clicks stay where they were
  assert.deepEqual(clicks(out), [0, 0.45, 1.05, 1.5])
})
check('resampleSpan interpolates', () => {
  const s = new Float32Array([0, 1, 0, 0])
  const o = new Float32Array(4)
  resampleSpan(s, 0, 2, 4, o, 0)
  assert.deepEqual([...o].map(v => +v.toFixed(2)), [0, 0.5, 1, 0.5])
})
check('stretch mode hands each span to the stretcher with the factor its seconds over its wall time', () => {
  const factors = []
  const stretch = (buf, f) => { factors.push(+f.toFixed(3)); const n = Math.round(buf.length / f); const o = makeBuffer(1, n, buf.sampleRate); o.getChannelData(0).fill(0.25); return o }
  const out = renderWarped(src, { markers, clipBeats: 4, wallSeconds: wall, mode: 'stretch', makeBuffer, stretch })
  assert.deepEqual(factors, [0.9, 1.2, 0.9], 'a 0.45 s span into 0.5 s is 0.9; 0.6 s into 0.5 s is 1.2; the last span is a plain copy — no stretcher call')
  assert.equal(out.length, 2000)
  assert.ok(out.getChannelData(0)[100] === 0.25 && out.getChannelData(0)[1900] !== 0.25, 'stretched spans were written; the untouched last span was copied')
})

console.log(failures ? `\n${failures} failing` : '\nthe clicks land on the beat')
process.exit(failures ? 1 : 0)
