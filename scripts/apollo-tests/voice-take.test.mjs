#!/usr/bin/env node
// Saying a drum part, and saying chords, against a click.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-take.test.mjs
//
// Brae: "they need to say the name of the type of drum/symbol in the sequencer
// to the beat. For example, they'd say 'kick clap kick kick crash'... The user
// can also say 'ta means closed hi hat, and cha means snare'... For piano roll
// the user can say the name of the chord or similarly create a shorthand."

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { drumTake, chordTake, takeToNotes, describeTake } = await importTs('lib/voice/pass.ts')
const { parseDefinitions, applyDefinitions, clearVocab, drumForWord, laneFromName } =
  await importTs('lib/voice/vocab.ts')
const { parseChord, readChordAt } = await importTs('lib/voice/chords-spoken.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// 120bpm: a beat is 0.5s, a sixteenth 0.125s. The grid is sixteenths, so ONE
// BEAT IS FOUR STEPS — beat 1 is step 4, not step 8. (Getting that wrong is how
// this test first "failed" against perfectly correct code.) Count-in ends at 10.
const BPM = 120, ORIGIN = 10
const at = beat => ORIGIN + beat * 0.5
const spike = (beat, strength = 1) => ({ t: at(beat), strength })
// The transcriber's times drift late, as they really do.
const said = (word, beat, drift = 0.03) => ({ word, s: at(beat) + drift })

let n = 0
const id = () => `n${n++}`

// ── "kick clap kick kick crash", played on beats ───────────────────────────
{
  const beats = [0, 1, 2, 2.5, 3]
  const words = ['kick', 'clap', 'kick', 'kick', 'crash'].map((w, i) => said(w, beats[i]))
  const onsets = beats.map(b => spike(b))
  const take = drumTake(words, onsets, { bpm: BPM, originSec: ORIGIN })

  check('every name becomes a hit', take.hits.length === 5, String(take.hits.length))
  check('on the steps they were played',
    take.hits.map(h => h.step).join() === '0,4,8,10,12', take.hits.map(h => h.step).join())
  check('with the right drums',
    take.hits.map(h => h.lane).join() === 'kick,clap,kick,kick,crash',
    take.hits.map(h => h.lane).join())
  // ⚠️ THE point of onset alignment: the words arrived 30ms late and the hits
  // still land exactly on the grid. Trusting the transcript would put the
  // first hit a quarter of a sixteenth behind the beat.
  check('placed by the audio, not the transcript', take.fromAudio && take.hits.every(h => h.timing === 'onset'))
  check('one bar, because it fits in one', take.bars === 1, `${take.bars} bars`)
  check('and it can say what it heard', /kick, clap, kick/.test(describeTake(take)), describeTake(take))
}

// A take that really does run past a bar gets the bars it needs.
{
  const words = [said('kick', 0), said('snare', 5)]
  const long = drumTake(words, [spike(0), spike(5)], { bpm: BPM, originSec: ORIGIN })
  check('a take past bar one gets two bars', long.bars === 2 && long.hits[1].step === 20,
    `${long.bars} bars, last step ${long.hits[1].step}`)
}

// ── Coming in late STAYS late ──────────────────────────────────────────────
// Without an origin the first word becomes beat one and a late entry is
// silently pulled onto the downbeat, which is the whole difference between
// recording to a click and recording next to one.
{
  const words = [said('kick', 1), said('snare', 2)]
  const onsets = [spike(1), spike(2)]
  const late = drumTake(words, onsets, { bpm: BPM, originSec: ORIGIN })
  check('a late entry keeps its place', late.hits[0].step === 4, String(late.hits[0].step))
  const noOrigin = drumTake(words, onsets, { bpm: BPM })
  check('and without a click it starts where you did', noOrigin.hits[0].step === 0,
    String(noOrigin.hits[0].step))
}

// ── One drum at a time ─────────────────────────────────────────────────────
// Brae: "The user can do one drum bit at a time."
{
  const words = [said('kick', 0), said('snare', 1), said('kick', 2)]
  const onsets = [spike(0), spike(1), spike(2)]
  const only = drumTake(words, onsets, { bpm: BPM, originSec: ORIGIN, onlyLane: 'kick' })
  check('a single-lane pass takes only that drum', only.hits.length === 2, String(only.hits.length))
  check('and says what it left out', only.ignored.includes('snare'), only.ignored.join())
}

// ── Words that are not drums are reported, not swallowed ───────────────────
{
  const words = [said('kick', 0), said('um', 0.5), said('kick', 1)]
  const take = drumTake(words, [spike(0), spike(0.5), spike(1)], { bpm: BPM, originSec: ORIGIN })
  check('a stray word is set aside', take.hits.length === 2 && take.ignored.length === 1,
    `${take.hits.length} hits, ignored ${take.ignored.join()}`)
}

// ── Velocity carries how hard it was said ──────────────────────────────────
{
  const take = drumTake([said('kick', 0), said('kick', 1)],
    [spike(0, 1), spike(1, 0.1)], { bpm: BPM, originSec: ORIGIN })
  check('a harder syllable is a louder hit', take.hits[0].velocity > take.hits[1].velocity,
    `${take.hits[0].velocity} vs ${take.hits[1].velocity}`)
}

// ── Shorthand ──────────────────────────────────────────────────────────────
{
  clearVocab()
  check('a lane is found from however it is named',
    laneFromName('closed hi hat') === 'closedHat' && laneFromName('bass drum') === 'kick')

  const defs = parseDefinitions('ta means closed hi hat, and cha means snare')
  check('both definitions are read from one breath', defs.length === 2,
    defs.map(d => `${d.word}=${d.means.lane}`).join())
  check('and they mean what was said',
    defs[0].means.lane === 'closedHat' && defs[1].means.lane === 'snare',
    defs.map(d => d.means.lane).join())

  const say = applyDefinitions(defs)
  check('it reads them back', /ta.*closed hi hat/.test(say), say)
  check('and then "ta" is a hi-hat', drumForWord('ta') === 'closedHat', String(drumForWord('ta')))
  // ⚠️ The built-in guess must LOSE. "cha" would otherwise fall through the
  // phonetic rules to a cymbal, and overriding a stated meaning with a guess
  // defeats the entire point of being able to state one.
  check('and a stated meaning beats the phonetic guess',
    drumForWord('cha') === 'snare', String(drumForWord('cha')))

  const take = drumTake([said('ta', 0), said('cha', 1)], [spike(0), spike(1)],
    { bpm: BPM, originSec: ORIGIN })
  check('a take uses the session words',
    take.hits.map(h => h.lane).join() === 'closedHat,snare', take.hits.map(h => h.lane).join())

  // Changing one replaces it.
  applyDefinitions(parseDefinitions('ta means kick'))
  check('a redefinition replaces the old meaning', drumForWord('ta') === 'kick', String(drumForWord('ta')))
  clearVocab()
  check('and clearing gives the built-ins back', drumForWord('ta') === 'snare', String(drumForWord('ta')))
}

// ── Chords ─────────────────────────────────────────────────────────────────
{
  clearVocab()
  check('"C major" is a C triad', readChordAt(['c', 'major'], 0).pitches.join() === '60,64,67',
    readChordAt(['c', 'major'], 0).pitches.join())
  check('"A minor" is a minor triad', readChordAt(['a', 'minor'], 0).pitches.join() === '69,72,76',
    readChordAt(['a', 'minor'], 0).pitches.join())
  // ⚠️ Longest-first, or "C minor seven" reads as "C minor" and leaves a "seven"
  // behind that looks like the start of another chord.
  const m7 = readChordAt(['c', 'minor', 'seven'], 0)
  check('"C minor seven" is one chord, not two', m7.used === 3 && m7.pitches.length === 4,
    `used ${m7.used}, ${m7.pitches.join()}`)
  check('"E flat major" handles the accidental',
    readChordAt(['e', 'flat', 'major'], 0).pitches[0] === 63,
    String(readChordAt(['e', 'flat', 'major'], 0).pitches[0]))
  check('a bare note is a major chord', readChordAt(['g'], 0).pitches.join() === '67,71,74',
    readChordAt(['g'], 0).pitches.join())
  check('a written symbol works too', readChordAt(['f#m'], 0).pitches.join() === '66,69,73',
    readChordAt(['f#m'], 0).pitches.join())
  check('an ordinary word is not a chord', readChordAt(['louder'], 0) === null)

  // Shorthand, which is what makes chords playable to a beat at all.
  applyDefinitions(parseDefinitions('one means C major, and four means F major, and five means G major'))
  const beats = [0, 1, 2, 3]
  const words = ['one', 'four', 'five', 'one'].map((w, i) => said(w, beats[i]))
  const take = chordTake(words, beats.map(b => spike(b)), { bpm: BPM, originSec: ORIGIN })
  check('numbers become chords on the beat', take.hits.length === 4, String(take.hits.length))
  check('at the right steps', take.hits.map(h => h.step).join() === '0,4,8,12',
    take.hits.map(h => h.step).join())
  check('with the right notes', take.hits[1].pitches.join() === '65,69,72', take.hits[1].pitches.join())

  // The multi-word case: the chord keeps the time of its FIRST word.
  const spoken = chordTake(
    [said('c', 0), said('major', 0.2), said('a', 1), said('minor', 1.2)],
    [spike(0), spike(0.2), spike(1), spike(1.2)],
    { bpm: BPM, originSec: ORIGIN },
  )
  check('a spoken chord name is one hit at its start',
    spoken.hits.length === 2 && spoken.hits.map(h => h.step).join() === '0,4',
    `${spoken.hits.length} hits at ${spoken.hits.map(h => h.step).join()}`)
  check('and it is named back properly', spoken.hits[1].label === 'Am', spoken.hits[1].label)
  clearVocab()
}

// ── Notes out ──────────────────────────────────────────────────────────────
{
  const take = drumTake([said('kick', 0), said('snare', 1)], [spike(0), spike(1)],
    { bpm: BPM, originSec: ORIGIN })
  const notes = takeToNotes(take, id)
  check('drum notes are GM pitches on the grid',
    notes.map(x => x.pitch).join() === '36,38' && notes[1].startBeat === 1,
    notes.map(x => `${x.pitch}@${x.startBeat}`).join())

  clearVocab()
  const chords = chordTake([said('c', 0)], [spike(0)], { bpm: BPM, originSec: ORIGIN })
  const cn = takeToNotes(chords, id, 1)
  check('a chord becomes its notes, together',
    cn.length === 3 && cn.every(x => x.startBeat === 0) && cn.every(x => x.durationBeats === 1),
    cn.map(x => x.pitch).join())
}

console.log(failures ? `\n${failures} failing` : '\na spoken take lands on the grid it was played to')
assert.equal(failures, 0)
