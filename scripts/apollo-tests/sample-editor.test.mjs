// The Sample Editor's arithmetic (lib/sample-editor.ts): native seconds after
// trims, Seg BPM read off a clip and written back as a length, ×2 / ÷2, warp
// speed, dB both ways, trim drags that never cross, the playhead's place in
// the sample, and what a default remembers. The pane is driven in
// .claude/sample-editor-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { nativeSeconds, segBpmOf, beatsAtSegBpm, warpSpeed, setSegBpm, gainToDb, dbToGain, trimByDrag, sampleFraction, sampleDetails, describeSample, pickClipDefaults } = await importTs('lib/sample-editor.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}
// A two-second sample, half a second trimmed off the front, four beats long.
const clip = { bufferDuration: 2, trimStart: 0.5, trimEnd: 0, durationBeats: 4, gain: 1, reverse: false }

check('native seconds are the buffer minus both trims; null before the buffer is known', () => {
  assert.equal(nativeSeconds(clip), 1.5)
  assert.equal(nativeSeconds({ trimStart: 0, trimEnd: 0 }), null)
})
check('Seg BPM is read off the clip: 1.5 s spanning 4 beats is 160 BPM; a stored value wins', () => {
  assert.equal(segBpmOf(clip), 160)
  assert.equal(segBpmOf({ ...clip, segBpm: 120 }), 120)
  assert.equal(segBpmOf({ trimStart: 0, trimEnd: 0, durationBeats: 4 }), null)
})
check('setting the Seg BPM writes the clip length the sample spans at it, warp on', () => {
  assert.deepEqual(setSegBpm(clip, 80), { segBpm: 80, durationBeats: 2, warpEnabled: true })
  assert.deepEqual(setSegBpm(clip, 320), { segBpm: 320, durationBeats: 8, warpEnabled: true })
  assert.deepEqual(setSegBpm(clip, 100, 0.25), { segBpm: 100, durationBeats: 2.5, warpEnabled: true })
  assert.equal(beatsAtSegBpm(1.5, 160), 4)
  assert.equal(setSegBpm({ trimStart: 0, trimEnd: 0 }, 120), null)
})
check('warp speed is the song tempo over the sample tempo', () => {
  assert.equal(warpSpeed(120, 120), 1)
  assert.ok(Math.abs(warpSpeed(130, 120) - 1.0833) < 1e-3)
})
check('dB both ways', () => {
  assert.ok(Math.abs(gainToDb(1)) < 1e-9)
  assert.ok(Math.abs(gainToDb(0.5) + 6.02) < 0.01)
  assert.ok(Math.abs(dbToGain(-6) - 0.501) < 0.001)
  assert.ok(gainToDb(0) < -59, 'silence reads as a floor, not -Infinity')
})
check('trim drags clamp so the edges never cross and never go negative', () => {
  assert.deepEqual(trimByDrag(clip, 'start', -1), { trimStart: 0 })
  assert.deepEqual(trimByDrag(clip, 'start', 5), { trimStart: 1.99 })
  assert.deepEqual(trimByDrag(clip, 'end', -0.5), { trimEnd: 0.5 }, 'the end edge dragged left trims more')
  assert.deepEqual(trimByDrag(clip, 'end', 1), { trimEnd: 0 })
  assert.equal(trimByDrag({ trimStart: 0, trimEnd: 0 }, 'start', 1), null)
})
check('the playhead maps a beat in the clip to its place in the sample, honouring trims and reverse', () => {
  assert.equal(sampleFraction(clip, 0), 0.25)          // the trimmed half second
  assert.equal(sampleFraction(clip, 4), 1)
  assert.equal(sampleFraction(clip, 2), 0.625)
  assert.equal(sampleFraction({ ...clip, reverse: true }, 0), 1)
})
check('sample details read off a buffer, in words', () => {
  const d = sampleDetails({ sampleRate: 48000, numberOfChannels: 2, length: 96000, duration: 2 })
  assert.deepEqual(d, { sampleRate: 48000, channels: 2, seconds: 2, frames: 96000 })
  assert.equal(describeSample(d), '48.0 kHz · 32-bit float · stereo · 2.00 s')
})
check('a default remembers the sample settings, not the placement', () => {
  const d = pickClipDefaults({ ...clip, id: 'c', kind: 'audio', trackId: 't', name: 'x', startBeat: 9, warpEnabled: true, warpMode: 'stretch', segBpm: 160, pitchSemitones: 2, fadeIn: 0, fadeOut: 0, loopEnabled: false })
  assert.deepEqual(d, { warpEnabled: true, warpMode: 'stretch', segBpm: 160, gain: 1, pitchSemitones: 2, reverse: false, fadeIn: 0, fadeOut: 0, loopEnabled: false })
  assert.equal('startBeat' in d, false)
})

console.log(failures ? `\n${failures} failing` : '\nthe numbers agree')
process.exit(failures ? 1 : 0)
