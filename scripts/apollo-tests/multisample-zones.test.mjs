#!/usr/bin/env node
// Building an instrument out of a folder of samples.
//
//   node --experimental-strip-types scripts/apollo-tests/multisample-zones.test.mjs
//
// Every failure this guards against renders a perfectly tidy zone table and is
// only audible: a note mapped a semitone off, a zone zero keys wide that never
// sounds, a gap in the middle of the keyboard, or 351 samples downloaded to
// play 88 pitches. None of it shows up in a screenshot.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const {
  midiFromNoteName, noteOf, takeRank, velLayer, bestTakes, spanZones,
} = await importTs('lib/apollo/multisample-zones.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// ── Note names ──────────────────────────────────────────────────────────────
// Middle C is MIDI 60 and A440 is MIDI 69. Get the octave offset wrong and the
// whole instrument plays an octave out, which sounds plausible until it is
// played against anything else.
check('C-1 is 0', midiFromNoteName('C-1') === 0, String(midiFromNoteName('C-1')))
check('C4 is 60', midiFromNoteName('C4') === 60, String(midiFromNoteName('C4')))
check('A4 is 69', midiFromNoteName('A4') === 69, String(midiFromNoteName('A4')))
check('A#3 is 58', midiFromNoteName('A#3') === 58, String(midiFromNoteName('A#3')))
check('Bb3 is A#3', midiFromNoteName('Bb3') === midiFromNoteName('A#3'))
check('G9 is 127', midiFromNoteName('G9') === 127, String(midiFromNoteName('G9')))

// The match is anchored on purpose. A matcher loose enough to read the pitch
// out of "Grand Piano, Steinway B A#3" also invents one for "Harmonica-C" and
// files a harmonica at middle C.
for (const junk of ['Grand Piano, Steinway B A#3', 'Tom 2', 'Harmonica-C', 'Gong 1', '', 'H3']) {
  check(`"${junk}" is not a note name`, midiFromNoteName(junk) === null)
}

// ── Where the pitch comes from ──────────────────────────────────────────────
check('an explicit renderSpec wins',
  noteOf({ name: 'C4', renderSpec: { midiNote: 42 }, tags: ['note:G5'] }) === 42)
check('the note: tag beats the display name',
  noteOf({ name: 'Grand Piano, Steinway B A#3', tags: ['note:A#3'] }) === 58)
check('a bare note name still works (AI-rendered entries)',
  noteOf({ name: 'F#2' }) === 42, String(noteOf({ name: 'F#2' })))
check('a sound with no pitch anywhere is skipped, not guessed',
  noteOf({ name: 'Snare Hard', tags: ['cat:snare'] }) === null)
check('a malformed tag falls through rather than throwing',
  noteOf({ name: 'C4', tags: ['note:banana'] }) === 60)

// ── Choosing a take ─────────────────────────────────────────────────────────
const main1 = { name: 'x', tags: ['note:C4', 'rr:rr1', 'mic:main'] }
const main2 = { name: 'x', tags: ['note:C4', 'rr:rr2', 'mic:main'] }
const room1 = { name: 'x', tags: ['note:C4', 'rr:rr1', 'mic:room'] }
check('main mic beats a room mic', takeRank(main1) < takeRank(room1))
check('the first round robin beats the second', takeRank(main1) < takeRank(main2))
check('mic position outranks round robin', takeRank(main2) < takeRank(room1))

// ── One zone per pitch ──────────────────────────────────────────────────────
// The Steinway shape: many takes of each note, in no particular order.
const steinway = []
for (const note of ['C4', 'D4', 'E4']) {
  for (const rr of ['rr3', 'rr1', 'rr2']) {
    for (const mic of ['room', 'main']) {
      steinway.push({ name: `Piano ${note} ${rr}`, tags: [`note:${note}`, `rr:${rr}`, `mic:${mic}`] })
    }
  }
}
const picked = bestTakes(steinway)
check('18 samples of 3 pitches becomes 3 zones', picked.length === 3, `${picked.length}`)
check('and keeps rr1 on the main mic each time',
  picked.every(p => p.item.tags.includes('rr:rr1') && p.item.tags.includes('mic:main')),
  picked.map(p => p.item.name).join(', '))
check('sorted low to high', picked.map(p => p.note).join() === '60,62,64', picked.map(p => p.note).join())
check('unpitched samples in the folder are dropped, not mapped to 0',
  bestTakes([...steinway, { name: 'readme', tags: [] }]).length === 3)
check('an empty folder yields nothing rather than throwing', bestTakes([]).length === 0)

// ── Velocity layers ─────────────────────────────────────────────────────────
// The audible bug: a piano sampled at three dynamics, reduced by taking
// whichever sample sorted first, plays pianissimo on C and fortissimo on C#.
check('a velocity layer is read off the tag', velLayer({ name: 'x', tags: ['vl:2'] }) === 2)
check('and is null when there is none', velLayer({ name: 'x', tags: ['rr:rr1'] }) === null)

const piano = []
for (const note of ['C4', 'C#4', 'D4']) {
  for (const vl of ['1', '2', '3']) {
    piano.push({ name: `${note} vl${vl}`, tags: [`note:${note}`, `vl:${vl}`, 'rr:rr1', 'mic:main'] })
  }
}
const layered = bestTakes(piano)
check('every pitch comes back on the SAME velocity layer',
  new Set(layered.map(x => velLayer(x.item))).size === 1,
  layered.map(x => `${x.note}:vl${velLayer(x.item)}`).join(' '))
check('and it is the middle layer, not the softest or the loudest',
  layered.every(x => velLayer(x.item) === 2),
  layered.map(x => velLayer(x.item)).join())

// Two layers has no true middle; take the lower of the pair rather than
// silently preferring the loudest sample in the instrument.
const twoLayer = ['1', '4'].map(vl =>
  ({ name: `C4 vl${vl}`, tags: ['note:C4', `vl:${vl}`, 'mic:main'] }))
check('with an even number of layers it stays on the quieter one',
  velLayer(bestTakes(twoLayer)[0].item) === 1)

// Velocity is chosen first, but round robin still breaks the remaining tie.
const tie = [
  { name: 'a', tags: ['note:C4', 'vl:2', 'rr:rr2', 'mic:main'] },
  { name: 'b', tags: ['note:C4', 'vl:2', 'rr:rr1', 'mic:main'] },
  { name: 'c', tags: ['note:C4', 'vl:1', 'rr:rr1', 'mic:main'] },
  { name: 'd', tags: ['note:C4', 'vl:3', 'rr:rr1', 'mic:main'] },
]
check('within the chosen layer, the first round robin still wins',
  bestTakes(tie)[0].item.name === 'b', bestTakes(tie)[0].item.name)

// An instrument with no velocity tags at all must still reduce cleanly.
check('unlayered instruments are unaffected',
  bestTakes(steinway).length === 3)

// ── Covering the keyboard ───────────────────────────────────────────────────
const spans = spanZones([60, 62, 64])
check('the lowest zone reaches the bottom of the keyboard', spans[0].loKey === 0)
check('the highest zone reaches the top', spans[2].hiKey === 127)
check('each zone keeps its own root', spans.map(s => s.rootKey).join() === '60,62,64')

// No gaps and no overlaps: every key from 0 to 127 belongs to exactly one zone.
const owners = new Array(128).fill(0)
for (const s of spans) for (let k = s.loKey; k <= s.hiKey; k++) owners[k]++
check('every key is covered exactly once', owners.every(n => n === 1),
  `uncovered ${owners.filter(n => n === 0).length}, doubled ${owners.filter(n => n > 1).length}`)
check('no zone is zero keys wide', spans.every(s => s.hiKey >= s.loKey))

// Duplicate roots are the bug dedupe exists to prevent. Two takes of a pitch
// still tile (the pair splits at the midpoint of a zero-width gap); THREE
// leave the middle one with hiKey below loKey, so it covers nothing and its
// sample is downloaded to never sound. A real piano folder has four to six
// takes per note, so most of its zones would be dead.
const collapsed = spanZones([60, 60, 60, 62])
check('three takes of one pitch leaves a zone covering nothing',
  collapsed.some(s => s.hiKey < s.loKey),
  'which is why bestTakes() runs first')
check('and deduping first fixes it',
  spanZones(bestTakes([
    { name: 'a', tags: ['note:C4'] }, { name: 'b', tags: ['note:C4'] },
    { name: 'c', tags: ['note:C4'] }, { name: 'd', tags: ['note:D4'] },
  ]).map(x => x.note)).every(s => s.hiKey >= s.loKey))

// A single-sample folder still has to play across the whole keyboard.
const lone = spanZones([60])
check('one sample covers the keyboard', lone[0].loKey === 0 && lone[0].hiKey === 127)

console.log(failures ? `\n${failures} failing` : '\nzone maps are gapless and one-per-pitch')
assert.equal(failures, 0)
