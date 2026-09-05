// The status bar's arithmetic (lib/status-bar.ts): clock and grid formats,
// and a selection summarised in both. The bar is driven in
// .claude/statusbar-check.mjs.
import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { formatClock, formatPosition, formatLength, summarizeSelection } = await importTs('lib/status-bar.ts')

let failures = 0
const check = (label, fn) => {
  try { fn(); console.log(`PASS ${label}`) }
  catch (e) { failures++; console.log(`FAIL ${label}\n   ${e.message}`) }
}

check('the clock reads m:ss.mmm', () => {
  assert.equal(formatClock(0), '0:00.000')
  assert.equal(formatClock(4.5), '0:04.500')
  assert.equal(formatClock(65.0004), '1:05.000')
  assert.equal(formatClock(-3), '0:00.000')
})
check('positions count from 1, the way the ruler does', () => {
  assert.equal(formatPosition(0), '1.1.1')
  assert.equal(formatPosition(4), '2.1.1')
  assert.equal(formatPosition(5.5), '2.2.3')
  assert.equal(formatPosition(6, 3), '3.1.1')
})
check('lengths read in bars and beats', () => {
  assert.equal(formatLength(8), '2 bars')
  assert.equal(formatLength(4), '1 bar')
  assert.equal(formatLength(6), '1 bar 2 beats')
  assert.equal(formatLength(1), '1 beat')
  assert.equal(formatLength(0), '0 beats')
})
check('a selection is summarised in the grid and on the clock', () => {
  const project = { tempo: 120, tempoMarkers: [], timeSignatureNum: 4 }
  const clips = [
    { id: 'a', kind: 'midi', trackId: 't', name: 'A', startBeat: 4, durationBeats: 8, isDrumClip: false, notes: [] },
    { id: 'b', kind: 'midi', trackId: 't', name: 'B', startBeat: 8, durationBeats: 8, isDrumClip: false, notes: [] },
  ]
  const s = summarizeSelection(clips, project)
  assert.equal(s.count, 2)
  assert.equal(s.position, '2.1.1')
  assert.equal(s.end, '5.1.1')
  assert.equal(s.length, '3 bars')
  assert.equal(s.startClock, '0:02.000')   // beat 4 at 120 bpm
  assert.equal(s.endClock, '0:08.000')
  assert.equal(s.lengthClock, '0:06.000')
  assert.equal(summarizeSelection([], project), null)
})
check('the clock follows a tempo change', () => {
  const project = { tempo: 120, tempoMarkers: [{ beat: 4, tempo: 60 }], timeSignatureNum: 4 }
  const s = summarizeSelection([{ id: 'a', kind: 'midi', trackId: 't', name: 'A', startBeat: 4, durationBeats: 4, isDrumClip: false, notes: [] }], project)
  assert.equal(s.startClock, '0:02.000')
  assert.equal(s.lengthClock, '0:04.000')   // four beats at 60 bpm
})

console.log(failures ? `\n${failures} failing` : '\nthe bar reads right')
process.exit(failures ? 1 : 0)
