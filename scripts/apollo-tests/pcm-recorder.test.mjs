// The take recorder's arithmetic without a browser: blocks join into a
// sample-exact take, the WAV it writes decodes back to the same samples, and
// a stubbed audio graph drives start/stop the way the engine does. The
// real-path check (.claude/take-check.mjs) records a real tone in the studio.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { PcmRecorder, joinBlocks } = await importTs('lib/pcm-recorder.ts')
const { decodeWav } = await importTs('lib/wav-codec.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}

check('blocks join into one buffer per channel, cut to the frame count', () => {
  const a = [new Float32Array([1, 2, 3]), new Float32Array([-1, -2, -3])]
  const b = [new Float32Array([4, 5, 6]), new Float32Array([-4, -5, -6])]
  const out = joinBlocks([a, b], 2, 5)
  assert.deepEqual(Array.from(out[0]), [1, 2, 3, 4, 5])
  assert.deepEqual(Array.from(out[1]), [-1, -2, -3, -4, -5])
})
check('a mono block recorded as stereo lands on both channels', () => {
  const out = joinBlocks([[new Float32Array([0.5, 0.25])]], 2, 2)
  assert.deepEqual(Array.from(out[1]), [0.5, 0.25])
})

// A stub of just enough Web Audio for the recorder: the processor's callback
// is fired by the test, the clock is ours.
function fakeContext(sampleRate = 48000) {
  const ctx = {
    sampleRate, currentTime: 0, destination: { name: 'destination' },
    createScriptProcessor(bufferSize, inCh) {
      const proc = { bufferSize, inCh, onaudioprocess: null, connect() {}, disconnect() {} }
      ctx.lastProc = proc
      return proc
    },
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} } },
  }
  return ctx
}
const fakeSource = { connect() {}, disconnect() {} }
const feed = (ctx, proc, blocks) => {
  for (const block of blocks) {
    proc.onaudioprocess({ inputBuffer: { length: block[0].length, numberOfChannels: block.length, getChannelData: i => block[i] } })
  }
}

{
  const ctx = fakeContext(48000)
  const rec = new PcmRecorder(ctx, fakeSource, { channels: 2, bufferSize: 256 })
  rec.start()
  const tone = n => Float32Array.from({ length: n }, (_, i) => Math.sin(i / 10))
  feed(ctx, ctx.lastProc, [[tone(256), tone(256)], [tone(256), tone(256)], [tone(256), tone(256)]])
  const framesBefore = rec.frames
  ctx.currentTime = 600 / 48000              // 600 frames passed on the clock
  const take = await rec.stop()
  check('a take is trimmed to the clock, not rounded up to the block', () => {
    assert.equal(framesBefore, 768)
    assert.equal(take.frames, 600)
    assert.equal(take.channels[0].length, 600)
    assert.equal(take.sampleRate, 48000)
    assert.equal(rec.state, 'stopped')
  })
}

{
  // The last block is still inside the processor when stop is called: the
  // recorder waits for it rather than losing it.
  const ctx = fakeContext(48000)
  const rec = new PcmRecorder(ctx, fakeSource, { channels: 1, bufferSize: 256 })
  rec.start()
  const proc = ctx.lastProc
  feed(ctx, proc, [[Float32Array.from({ length: 256 }, () => 0.5)]])
  ctx.currentTime = 400 / 48000              // 400 frames passed; only 256 delivered
  let settled = false
  const pending = rec.stop().then(t => { settled = true; return t })
  await new Promise(r => setTimeout(r, 20))
  const waited = !settled && rec.state === 'stopping'
  feed(ctx, proc, [[Float32Array.from({ length: 256 }, () => 0.25)]])
  const take = await pending
  check('stop waits for the block that carries the last frame, then trims', () => {
    assert.ok(waited, 'should have been waiting for the next block')
    assert.equal(take.frames, 400)
    assert.equal(take.channels[0][255], 0.5)
    assert.equal(take.channels[0][256], 0.25)
    assert.equal(take.channels[0][399], 0.25)
  })
}

{
  // A graph that has gone quiet cannot deliver the block: after two blocks'
  // worth of waiting the recorder settles for what it has.
  const ctx = fakeContext(48000)
  const rec = new PcmRecorder(ctx, fakeSource, { channels: 1, bufferSize: 256 })
  rec.start()
  feed(ctx, ctx.lastProc, [[new Float32Array(256)]])
  ctx.currentTime = 1000 / 48000
  const t0 = Date.now()
  const take = await rec.stop()
  check('a silent graph does not hang the stop', () => {
    assert.equal(take.frames, 256)
    assert.ok(Date.now() - t0 < 1000)
  })
}

{
  const ctx = fakeContext(44100)
  const rec = new PcmRecorder(ctx, fakeSource, { channels: 2, bufferSize: 256 })
  rec.start()
  const L = Float32Array.from({ length: 256 }, (_, i) => Math.sin(i * 0.1))
  const R = Float32Array.from({ length: 256 }, (_, i) => Math.cos(i * 0.1) * 0.5)
  feed(ctx, ctx.lastProc, [[L, R]])
  ctx.currentTime = 256 / 44100              // exactly the block
  const take = await rec.stop()
  const ab = await take.blob.arrayBuffer()
  check('the WAV it writes decodes back to the same samples', () => {
    assert.equal(take.frames, 256)
    assert.equal(take.blob.type, 'audio/wav')
    const dec = decodeWav(ab)
    assert.equal(dec.sampleRate, 44100)
    assert.equal(dec.channels.length, 2)
    assert.equal(dec.channels[0].length, 256)
    for (let i = 0; i < 256; i += 17) {
      assert.ok(Math.abs(dec.channels[0][i] - L[i]) < 1e-6, `L[${i}]`)
      assert.ok(Math.abs(dec.channels[1][i] - R[i]) < 1e-6, `R[${i}]`)
    }
  })
}

{
  const rec = new PcmRecorder(fakeContext(), fakeSource)
  const take = await rec.stop()
  check('stopping a recorder that never started is an empty take, not a crash', () => {
    assert.equal(take.frames, 0)
    assert.equal(take.blob.size, 0)
  })
}

console.log(failures ? `\n${failures} failing` : '\nevery sample of the take survives')
process.exit(failures ? 1 : 0)
