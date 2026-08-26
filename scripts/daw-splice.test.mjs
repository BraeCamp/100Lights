// Splitting a clip must not lose or move any audio, and must not lose any note.
//
//   npm run test:splice
//
// Splice was forty-five lines inline in a JSX prop, which meant nothing could
// test it. Two cases in it are easy to get wrong in ways you would not hear
// until much later: a WARPED audio clip (where beats and seconds are not
// proportional, so the cut point has to be computed from the stretch) and a
// LOOPED MIDI clip (where the repeats you hear are not stored as notes, so
// cutting the stored pattern silently deletes everything after the first
// repeat). Both are checked here.

import assert from 'node:assert'
import { createRequire } from 'node:module'

const { spliceClipAt } = createRequire(import.meta.url)('../.test-build/daw-splice.js')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// 120 BPM: one beat = 0.5s.
const beatsToSeconds = b => b * 0.5

const audioClip = (over = {}) => ({
  kind: 'audio', id: 'a1', trackId: 't1', name: 'Take',
  startBeat: 4, durationBeats: 8,
  gain: 1, loopEnabled: false, reverse: false, fadeIn: 0, fadeOut: 0,
  trimStart: 0, trimEnd: 0, bufferDuration: 4, ...over,
})

const midiClip = (over = {}) => ({
  kind: 'midi', id: 'm1', trackId: 't1', name: 'Pattern',
  startBeat: 0, durationBeats: 8, isDrumClip: false,
  notes: [
    { id: 'n1', pitch: 60, startBeat: 0, durationBeats: 1, velocity: 0.8 },
    { id: 'n2', pitch: 64, startBeat: 3.5, durationBeats: 1, velocity: 0.8 }, // spans the cut at 4
    { id: 'n3', pitch: 67, startBeat: 6, durationBeats: 1, velocity: 0.8 },
  ],
  ...over,
})

// ── Refusing to cut where a cut makes no sense ───────────────────────────────
check('a cut before the clip does nothing', spliceClipAt(audioClip(), 2, beatsToSeconds) === null)
check('a cut after the clip does nothing', spliceClipAt(audioClip(), 20, beatsToSeconds) === null)
check('a cut exactly on the start edge does nothing', spliceClipAt(audioClip(), 4, beatsToSeconds) === null)
check('a cut exactly on the end edge does nothing', spliceClipAt(audioClip(), 12, beatsToSeconds) === null)

// ── Audio, unwarped: the halves must add back up ─────────────────────────────
{
  const clip = audioClip()
  const r = spliceClipAt(clip, 6, beatsToSeconds)
  const [l, rt] = r.add
  check('both halves exist', r.add.length === 2)
  check('the halves span exactly the original', l.durationBeats + rt.durationBeats === clip.durationBeats,
    `${l.durationBeats} + ${rt.durationBeats} = ${clip.durationBeats}`)
  check('the right half starts at the cut', rt.startBeat === 6)
  check('the left half still starts where the clip did', l.startBeat === clip.startBeat)
  check('the halves get fresh ids', l.id !== clip.id && rt.id !== clip.id && l.id !== rt.id)
  // Unwarped audio plays at native speed: 2 beats in = 1.0s in.
  check('the right half starts 1.0s into the audio', Math.abs(rt.trimStart - 1.0) < 1e-9, `trimStart=${rt.trimStart}`)
  check('the left half ends at that same point', Math.abs(l.trimEnd - (4 - 1.0)) < 1e-9, `trimEnd=${l.trimEnd}`)
  // No audio may be lost: what the left keeps plus what the right keeps must be
  // the whole buffer.
  const leftHeard = clip.bufferDuration - l.trimStart - l.trimEnd
  const rightHeard = clip.bufferDuration - rt.trimStart - rt.trimEnd
  check('no audio is lost across the cut', Math.abs(leftHeard + rightHeard - clip.bufferDuration) < 1e-9,
    `${leftHeard} + ${rightHeard} vs ${clip.bufferDuration}`)
}

// ── Audio, warped: the cut follows the STRETCH, not the clock ────────────────
{
  // 4s of audio stretched over 8 beats (= 4s at 120bpm) is 1:1, so warp it into
  // a clip twice as long to make the two calculations disagree.
  const clip = audioClip({ warpEnabled: true, durationBeats: 16 })
  const r = spliceClipAt(clip, 4 + 8, beatsToSeconds) // halfway through
  const [, rt] = r.add
  check('a warped cut halfway lands halfway through the audio', Math.abs(rt.trimStart - 2) < 1e-9,
    `trimStart=${rt.trimStart} (clock-based would be 4)`)
  const leftHeard = clip.bufferDuration - r.add[0].trimStart - r.add[0].trimEnd
  check('warped: no audio is lost either', Math.abs(leftHeard - 2) < 1e-9, `left holds ${leftHeard}s`)
}

// ── Audio with an existing trim: the cut is measured from the trim ───────────
{
  const clip = audioClip({ trimStart: 1, trimEnd: 0.5 })
  const r = spliceClipAt(clip, 6, beatsToSeconds)
  check('an already-trimmed clip cuts 1.0s past its trim', Math.abs(r.add[1].trimStart - 2.0) < 1e-9,
    `trimStart=${r.add[1].trimStart}`)
  check('the existing tail trim survives on the right half', r.add[1].trimEnd === 0.5)
}

// ── MIDI: every note survives, and one spanning the cut is truncated ─────────
{
  const clip = midiClip()
  const r = spliceClipAt(clip, 4, beatsToSeconds)
  const [l, rt] = r.add
  check('notes before the cut stay left', l.notes.length === 2, `${l.notes.length} left`)
  check('notes after the cut go right', rt.notes.length === 1, `${rt.notes.length} right`)
  check('no note is lost', l.notes.length + rt.notes.length === clip.notes.length)
  const spanning = l.notes.find(n => n.id === 'n2')
  check('a note spanning the cut is truncated to the boundary', Math.abs(spanning.durationBeats - 0.5) < 1e-9,
    `duration=${spanning.durationBeats}`)
  check('the right half rebases its notes to its own start', rt.notes[0].startBeat === 2,
    `startBeat=${rt.notes[0].startBeat} (was 6, cut at 4)`)
  check('pitches are untouched', l.notes[0].pitch === 60 && rt.notes[0].pitch === 67)
}

// ── Looped MIDI: the repeats you HEAR must survive the cut ───────────────────
{
  // One bar of pattern, looped across four bars. Cutting the stored pattern
  // rather than the heard repeats would leave the right half empty.
  const clip = midiClip({
    durationBeats: 16, loopEnabled: true, loopLengthBeats: 4,
    notes: [{ id: 'p1', pitch: 60, startBeat: 0, durationBeats: 1, velocity: 0.8 }],
  })
  const r = spliceClipAt(clip, 8, beatsToSeconds)
  const [l, rt] = r.add
  check('the loop is materialised, not cut raw', l.notes.length === 2 && rt.notes.length === 2,
    `${l.notes.length} left, ${rt.notes.length} right`)
  check('all four heard repeats survive', l.notes.length + rt.notes.length === 4)
  check('the right half is no longer looping', rt.loopEnabled === false)
  check('each half loops at its own length if re-enabled', l.loopLengthBeats === 8 && rt.loopLengthBeats === 8,
    `${l.loopLengthBeats} / ${rt.loopLengthBeats}`)
  check('repeat positions are right', rt.notes.map(n => n.startBeat).join(',') === '0,4',
    rt.notes.map(n => n.startBeat).join(','))
}

console.log(failures ? `\n${failures} failing` : '\nall good')
assert.equal(failures, 0)
