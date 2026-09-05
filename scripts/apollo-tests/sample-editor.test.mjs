// The Sample Editor's arithmetic (lib/sample-editor.ts): native seconds after
// trims, Seg BPM read off a clip and written back as a length, ×2 / ÷2, warp
// speed, dB both ways, trim drags that never cross, the playhead's place in
// the sample, and what a default remembers. The pane is driven in
// .claude/sample-editor-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { nativeSeconds, segBpmOf, beatsAtSegBpm, warpSpeed, setSegBpm, gainToDb, dbToGain, trimByDrag, sampleFraction, sampleDetails, describeSample, pickClipDefaults, slipByDrag, cropSample, isSharedPatch, SHARED_CLIP_FIELDS } = await importTs('lib/sample-editor.ts')

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

// ── Slip edit ────────────────────────────────────────────────────────────────
// A two-second sample with half a second trimmed off each end.
const slippable = { bufferDuration: 2, trimStart: 0.5, trimEnd: 0.5 }

check('slipping moves the window through the sample and keeps its length', () => {
  assert.deepEqual(slipByDrag(slippable, 0.2), { trimStart: 0.7, trimEnd: 0.3 })
  assert.deepEqual(slipByDrag(slippable, -0.2), { trimStart: 0.3, trimEnd: 0.7 })
  const p = slipByDrag(slippable, 0.2)
  assert.equal(2 - p.trimStart - p.trimEnd, 1, 'the clip still plays one second of sample')
})
check('slipping stops at the ends of the sample, and does nothing when there is no room', () => {
  assert.deepEqual(slipByDrag(slippable, 5), { trimStart: 1, trimEnd: 0 })
  assert.deepEqual(slipByDrag(slippable, -5), { trimStart: 0, trimEnd: 1 })
  assert.equal(slipByDrag({ bufferDuration: 2, trimStart: 0, trimEnd: 0 }, 0.2), null, 'nothing trimmed off: nowhere to slide')
  assert.equal(slipByDrag({ trimStart: 0.5, trimEnd: 0.5 }, 0.2), null, 'the buffer is not known yet')
  assert.equal(slipByDrag(slippable, 0), null)
})
check('a clip with warp markers slips its MARKERS — they are what maps the sample onto the beats', () => {
  const warped = { bufferDuration: 2, trimStart: 0, trimEnd: 0, warpMarkers: [{ beat: 0, sec: 0.4 }, { beat: 4, sec: 1.4 }] }
  assert.deepEqual(slipByDrag(warped, 0.1).warpMarkers, [{ beat: 0, sec: 0.5 }, { beat: 4, sec: 1.5 }])
  assert.equal('trimStart' in slipByDrag(warped, 0.1), false, 'the trims are not in the map, so they stay')
  assert.deepEqual(slipByDrag(warped, 5).warpMarkers, [{ beat: 0, sec: 1 }, { beat: 4, sec: 2 }], 'the last marker stops at the end of the buffer')
  assert.deepEqual(slipByDrag(warped, -5).warpMarkers, [{ beat: 0, sec: 0 }, { beat: 4, sec: 1 }])
})

// ── Crop ─────────────────────────────────────────────────────────────────────
// Four beats at 120 BPM is two seconds; the sample is three.
const croppable = { bufferDuration: 3, trimStart: 0, trimEnd: 0, durationBeats: 4, warpEnabled: false, loopEnabled: false, reverse: false }

check('cropping cuts the audio the clip never reaches', () => {
  assert.deepEqual(cropSample(croppable, 120), { trimEnd: 1 })
  assert.deepEqual(cropSample({ ...croppable, trimStart: 0.5 }, 120), { trimEnd: 0.5 }, 'from the trimmed start, two seconds still play')
  assert.deepEqual(cropSample({ ...croppable, durationBeats: 2 }, 120), { trimEnd: 2 })
})
check('a reversed clip plays the END of the sample, so the crop takes off the front', () => {
  assert.deepEqual(cropSample({ ...croppable, reverse: true }, 120), { trimStart: 1 })
})
check('nothing to crop when the clip plays all of its sample', () => {
  assert.equal(cropSample({ ...croppable, warpEnabled: true }, 120), null, 'warped: the whole span is fitted to the beats')
  assert.equal(cropSample({ ...croppable, loopEnabled: true }, 120), null, 'looping: the whole span repeats')
  assert.equal(cropSample({ ...croppable, durationBeats: 8 }, 120), null, 'the clip outlasts its audio')
  assert.equal(cropSample({ ...croppable, durationBeats: 6 }, 120), null, 'exactly as long: nothing over')
  assert.equal(cropSample({ trimStart: 0, trimEnd: 0, durationBeats: 4 }, 120), null, 'the buffer is not known yet')
})
check('the tempo decides how much a clip plays', () => {
  assert.deepEqual(cropSample(croppable, 240), { trimEnd: 2 }, 'twice as fast: half the audio')
  assert.equal(cropSample(croppable, 60), null, 'half as fast: four seconds wanted, three there')
  assert.deepEqual(cropSample(croppable, 0), { trimEnd: 1 }, 'a nonsense tempo falls back to 120')
})

// ── Multi-clip editing ───────────────────────────────────────────────────────
check('a patch a selection can share is level, pitch, fades, loop and the warp settings', () => {
  assert.ok(isSharedPatch({ gain: 0.5 }))
  assert.ok(isSharedPatch({ warpEnabled: true, warpMode: 'beats' }))
  assert.ok(isSharedPatch({ pitchSemitones: 3, reverse: true, fadeIn: 1, clipFade: false }))
  assert.equal(SHARED_CLIP_FIELDS.includes('gain'), true)
})
check('what describes ONE sample never fans out', () => {
  for (const p of [{ trimStart: 0.5 }, { trimEnd: 0.5 }, { warpMarkers: [] }, { segBpm: 120 }, { durationBeats: 4 }, { tempoLeader: true }, { transients: [] }]) {
    assert.equal(isSharedPatch(p), false, `${Object.keys(p)[0]} must stay on its own clip`)
  }
  assert.equal(isSharedPatch({ gain: 0.5, trimStart: 0.2 }), false, 'one per-sample field is enough to keep the whole patch here')
  assert.equal(isSharedPatch({}), false)
})

console.log(failures ? `\n${failures} failing` : '\nthe numbers agree')
process.exit(failures ? 1 : 0)
