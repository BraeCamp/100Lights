#!/usr/bin/env node
// Saying a beat and getting that beat.
//
//   node --experimental-strip-types scripts/apollo-tests/beatbox.test.mjs
//
// Brae: "the user can say something like 'I want to make a beat like boom ka
// boom boom ka' It will be able to decipher that and turn it into a drum beat
// based on the timing."
//
// ⚠️ The inputs here are what a TRANSCRIBER returns, not what a person meant.
// Nobody transcribes beatbox syllables cleanly: "boom ka" comes back as "boom
// car", "bloom kah", "b um ka". A test written from the ideal spellings would
// pass on every run and fail on every user, so the mangled forms are the point.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { laneForWord, beatWordsOf, parseSpokenBeat, beatToNotes, describeBeat } =
  await importTs('lib/voice/beatbox.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const words = (str, times) => str.split(/\s+/).map((word, i) => (
  times ? { word, s: times[i] } : { word }
))
let n = 0
const id = () => `n${n++}`

// ── Which drum a syllable means ────────────────────────────────────────────
check('boom is a kick', laneForWord('boom') === 'kick')
check('ka is a snare', laneForWord('ka') === 'snare')
check('ts is a hat', laneForWord('ts') === 'closedHat')
check('a long hiss opens the hat', laneForWord('tssss') === 'openHat', String(laneForWord('tssss')))
check('an ordinary word is not a drum', laneForWord('tempo') === null, String(laneForWord('tempo')))
check('nor is a preamble word', laneForWord('want') === null, String(laneForWord('want')))

// The transcriber's versions, which is what actually arrives.
check('"car" still reads as the snare it was', laneForWord('car') === 'snare', String(laneForWord('car')))
check('"bloom" is still a kick', laneForWord('bloom') === 'kick', String(laneForWord('bloom')))
check('an unknown round plosive falls back to kick', laneForWord('dooph') === 'kick', String(laneForWord('dooph')))
check('an unknown open attack falls back to snare', laneForWord('kaff') === 'snare', String(laneForWord('kaff')))
// ⚠️ The mistake that matters most: a hat heard as a snare turns a groove into
// a march, so the hiss test has to win over the "starts with t" test.
check('"tss" is a hat, not a snare', laneForWord('tss') === 'closedHat', String(laneForWord('tss')))

// ── The sentence in front of the beat ──────────────────────────────────────
const spoken = words('I want to make a beat like boom ka boom boom ka')
const { beat, ignored } = beatWordsOf(spoken)
check('the beat is found at the end', beat.map(w => w.word).join(' ') === 'boom ka boom boom ka',
  beat.map(w => w.word).join(' '))
check('and the sentence in front is dropped', ignored.includes('want') && ignored.includes('beat'),
  ignored.join(' '))

// A sentence that merely ENDS in something drum-shaped is not a beat.
const notABeat = beatWordsOf(words('play it back to me like that cat'))
check('one stray syllable is not a beat', notABeat.beat.length === 0,
  notABeat.beat.map(w => w.word).join(' '))

// ── Timing, when the recogniser gives times ────────────────────────────────
// 120bpm: a beat is 0.5s, a 16th is 0.125s. Said on 1, the "and" of 1, 2, 3,
// the "and" of 3 — a real pattern rather than an even one.
const timed = parseSpokenBeat(
  words('boom ka boom boom ka', [10.00, 10.25, 10.50, 11.00, 11.25]),
  { bpm: 120 },
)
check('timings are used when they exist', timed.timing === 'heard', timed.timing)
check('and land on the grid they were said on',
  timed.hits.map(h => h.step).join(',') === '0,2,4,8,10',
  timed.hits.map(h => h.step).join(','))
check('with the right drums', timed.hits.map(h => h.lane).join(',') === 'kick,snare,kick,kick,snare',
  timed.hits.map(h => h.lane).join(','))
check('one bar', timed.bars === 1 && timed.steps === 16, `${timed.bars} bars / ${timed.steps} steps`)

// The whole point of the feature: a DIFFERENT rhythm from the same words.
const shuffled = parseSpokenBeat(
  words('boom ka boom boom ka', [0, 0.375, 0.75, 1.5, 1.75]),
  { bpm: 120 },
)
check('a different rhythm gives different steps',
  shuffled.hits.map(h => h.step).join(',') !== timed.hits.map(h => h.step).join(','),
  shuffled.hits.map(h => h.step).join(','))

// ── Timing, when it does not ───────────────────────────────────────────────
const even = parseSpokenBeat(words('boom ka boom boom ka'), { bpm: 120 })
check('no timings falls back to even spacing', even.timing === 'even', even.timing)
check('spaced as eighths', even.hits.map(h => h.step).join(',') === '0,2,4,6,8',
  even.hits.map(h => h.step).join(','))
// ⚠️ 'even' is not a detail. It is a different beat from the one they said, and
// the studio has to be able to admit that.
check('and it reports which it did', even.timing !== timed.timing)

// ── The grid ───────────────────────────────────────────────────────────────
const twoBar = parseSpokenBeat(
  words('boom ka boom ka', [0, 1, 2, 3.5]),   // 3.5s at 120bpm = beat 7 = step 28
  { bpm: 120 },
)
check('a longer phrase gets whole bars', twoBar.bars === 2 && twoBar.steps === 32,
  `${twoBar.bars} bars / ${twoBar.steps} steps`)

// The metronome's downbeat, not the first syllable: coming in late must stay
// late, or singing along to a click can never be off the beat.
const late = parseSpokenBeat(words('boom ka', [0.5, 1.0]), { bpm: 120, originSec: 0 })
check('an origin keeps a late entry late', late.hits[0].step === 4, String(late.hits[0].step))

// Two syllables meaning the same drum at the same moment are one hit.
const doubled = parseSpokenBeat(words('boom boom ka', [0, 0.01, 0.5]), { bpm: 120 })
check('a doubled syllable is one hit', doubled.hits.length === 2, String(doubled.hits.length))

// ── Notes out ──────────────────────────────────────────────────────────────
const notes = beatToNotes(timed, id)
check('every hit becomes a note', notes.length === timed.hits.length)
check('kick is GM 36 and snare 38',
  notes[0].pitch === 36 && notes[1].pitch === 38, `${notes[0].pitch}/${notes[1].pitch}`)
check('notes sit on the 16th grid',
  notes.every(x => Math.abs((x.startBeat / 0.25) - Math.round(x.startBeat / 0.25)) < 1e-9))
check('downbeats are louder', notes[0].velocity > notes[1].velocity,
  `${notes[0].velocity} vs ${notes[1].velocity}`)
check('the same sentence gives the same beat every time',
  JSON.stringify(parseSpokenBeat(words('boom ka boom', [0, 0.5, 1]), { bpm: 120 }).hits)
  === JSON.stringify(parseSpokenBeat(words('boom ka boom', [0, 0.5, 1]), { bpm: 120 }).hits))

check('it can say what it heard', /kick/.test(describeBeat(timed)), describeBeat(timed))

// ── Tempo actually matters ─────────────────────────────────────────────────
// The same seconds at half the tempo are half as many steps.
const slow = parseSpokenBeat(words('boom ka', [0, 0.5]), { bpm: 60 })
check('tempo converts seconds to steps', slow.hits[1].step === 2, String(slow.hits[1].step))

console.log(failures ? `\n${failures} failing` : '\na spoken beat becomes the beat that was spoken')
assert.equal(failures, 0)
