// The click (lib/metronome.ts): what it sounds like, how often it clicks, and
// the count-in shown as negative bars.
//
//   node scripts/apollo-tests/metronome.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { clickBeats, renderClick, countInPosition, describeMetronome, CLICK_SOUNDS, CLICK_RHYTHMS } =
  await importTs('lib/metronome.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg ?? ''} — got ${a}, wanted ${b}`)

console.log('\nhow often it clicks')

ok('a named rhythm is exactly that rhythm at any tempo', () => {
  for (const bpm of [40, 120, 300]) {
    near(clickBeats('1/4', bpm), 1)
    near(clickBeats('1/8', bpm), 0.5)
    near(clickBeats('1/16', bpm), 0.25)
    near(clickBeats('1/8T', bpm), 1 / 3)
    near(clickBeats('1/16T', bpm), 1 / 6)
  }
})

ok('auto subdivides when the beat is too far apart to play to', () => {
  // ⚠️ At 60 BPM the gap between clicks is longer than the phrase you are
  // trying to place inside it.
  near(clickBeats('auto', 60), 0.5)
  near(clickBeats('auto', 90), 0.5)
})

ok('auto is a plain beat at ordinary tempos', () => {
  near(clickBeats('auto', 100), 1)
  near(clickBeats('auto', 120), 1)
  near(clickBeats('auto', 180), 1)
})

ok('and thins out to a bar when a beat would be a buzz', () => {
  near(clickBeats('auto', 200, 4), 4)
  near(clickBeats('auto', 260, 3), 3)
})

console.log('\nwhat it sounds like')

ok('every sound makes real audio, and the accent is louder', () => {
  const peak = a => a.reduce((m, v) => Math.max(m, Math.abs(v)), 0)
  for (const s of CLICK_SOUNDS) {
    const down = renderClick(s.id, 48000, true)
    const up   = renderClick(s.id, 48000, false)
    assert.ok(down.length > 0 && up.length > 0, `${s.id} rendered nothing`)
    assert.ok(peak(down) > 0.05, `${s.id} accent is silent`)
    assert.ok(peak(up) > 0.02, `${s.id} offbeat is silent`)
    assert.ok(peak(down) > peak(up), `${s.id}: the downbeat has to stand out or a bar has no shape`)
  }
})

ok('the sounds are actually different from one another', () => {
  // Otherwise the menu is six names for one click.
  const sigs = CLICK_SOUNDS.map(s => {
    const a = renderClick(s.id, 48000, true)
    // Cheap signature: length, and energy in the first and second halves.
    let e1 = 0, e2 = 0
    for (let i = 0; i < a.length; i++) (i < a.length / 2 ? (e1 += a[i] * a[i]) : (e2 += a[i] * a[i]))
    return `${a.length}:${e1.toFixed(2)}:${e2.toFixed(2)}`
  })
  assert.equal(new Set(sigs).size, CLICK_SOUNDS.length, sigs.join(' | '))
})

ok('the same click twice is the same numbers', () => {
  // ⚠️ A bare Math.random in here would fail the determinism guard the moment a
  // click reached a render.
  const a = renderClick('stick', 44100, true)
  const b = renderClick('stick', 44100, true)
  assert.deepEqual([...a], [...b])
})

console.log('\nthe count-in')

ok('a two-bar count reads as negative bars ticking down', () => {
  // ⚠️ Counting UP from zero would put 1.1.1 on screen before the song has
  // started — the same number you see once you are already late.
  assert.equal(countInPosition(0, 8, 4), '-2.1.1')
  assert.equal(countInPosition(1, 8, 4), '-2.2.1')
  assert.equal(countInPosition(4, 8, 4), '-1.1.1')
  assert.equal(countInPosition(7, 8, 4), '-1.4.1')
})

ok('and hands the display back when the count is over', () => {
  assert.equal(countInPosition(8, 8, 4), null)
  assert.equal(countInPosition(9, 8, 4), null)
  assert.equal(countInPosition(0, 0, 4), null, 'no count-in at all')
})

ok('it follows the meter', () => {
  assert.equal(countInPosition(0, 6, 3), '-2.1.1')
  assert.equal(countInPosition(3, 6, 3), '-1.1.1')
})

console.log('\nsaid out loud')

ok('the settings read as what they do', () => {
  assert.equal(describeMetronome({ sound: 'click', rhythm: 'auto', onlyWhileRecording: false, countInBars: 0 }), 'Click on auto')
  assert.match(describeMetronome({ sound: 'cowbell', rhythm: '1/8', onlyWhileRecording: true, countInBars: 2 }), /Cowbell on 1\/8, only while recording, 2 bars of count-in/)
})

ok('every sound and rhythm has a distinct id and a label', () => {
  assert.equal(new Set(CLICK_SOUNDS.map(s => s.id)).size, CLICK_SOUNDS.length)
  assert.equal(new Set(CLICK_RHYTHMS.map(r => r.id)).size, CLICK_RHYTHMS.length)
  assert.ok(CLICK_SOUNDS.every(s => s.label && s.hint.length > 10))
})

console.log(`\n${passed} passed`)
