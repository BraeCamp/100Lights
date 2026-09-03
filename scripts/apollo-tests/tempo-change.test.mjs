#!/usr/bin/env node
// A song whose tempo changes must SOUND the way it looks.
//
//   node --experimental-strip-types scripts/apollo-tests/tempo-change.test.mjs
//
// Brae: "When the BPM changes, some stuff doesn't change properly. It changes
// in the UI, but the sound is off by a bit which just ends up making it look
// normal but sound like a mess."
//
// Two faults, one symptom. (1) With tempo markers, SET_TEMPO changed only the
// number: the map is pinned by a beat-0 marker, so the notes kept their grid
// while the engine's scalar tempo — and every curve length, synced delay and
// Apollo clock that read it — moved to the new one. (2) Even with the map
// honoured for note STARTS, everything sized in seconds from a beat count
// (automation curves, fades, seek offsets, synced delays, Apollo's clock, the
// render length) used the one global tempo, so a section at another bpm played
// its shapes early or late under a lane that drew correctly in beats.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

const { tempoSegments, beatsAtEvenSeconds, tempoAt } = await importTs('lib/tempo-map.ts')
const { sampleAutomationAt } = await importTs('lib/clip-effect-utils.ts')
const { planVoiceCall } = await importTs('lib/voice/execute-music.ts')

// ── the curve grid follows the map ─────────────────────────────────────────
{
  const one = [{ beat: 0, bpm: 120 }]
  const flat = beatsAtEvenSeconds(0, 8, one, 5)
  check('with one tempo, even seconds are even beats', flat.every((b, i) => near(b, i * 2)), JSON.stringify(flat))

  // 120 for two bars, then 60: beats 0-8 take 4 s, beats 8-16 take 8 s.
  const segs = tempoSegments({ tempo: 120, tempoMarkers: [{ id: 'a', beat: 0, tempo: 120 }, { id: 'b', beat: 8, tempo: 60 }] })
  const mixed = beatsAtEvenSeconds(0, 16, segs, 7)   // every 2 s of a 12 s span
  check('across a change, a sample every two seconds lands at 0,4,8,10,12,14,16 beats',
    [0, 4, 8, 10, 12, 14, 16].every((b, i) => near(mixed[i], b, 1e-6)), JSON.stringify(mixed))

  // A fall from 1 to 0 over the slow section, heard evenly in time.
  const pt = (id, t, v) => ({ id, t, v, smooth: false, h1: [0, 0], h2: [0, 0] })
  const fall = [pt('p', 0, 1), pt('q', 8, 0)]
  const inSlow = sampleAutomationAt(fall, beatsAtEvenSeconds(8, 8, segs, 5))
  check('inside one section the shape samples as before', inSlow.every((v, i) => near(v, 1 - i * 0.25)), JSON.stringify(inSlow))
  // 16 beats over 12 s: the first 4 s cover half the beats, so the value has
  // already fallen to 0.5 a third of the way through the time.
  const straddle = sampleAutomationAt([pt('p', 0, 1), pt('q', 16, 0)], beatsAtEvenSeconds(0, 16, segs, 7))
  check('a shape straddling the change is stretched where the song is slower',
    near(straddle[2], 0.5) && near(straddle[4], 0.25), JSON.stringify(straddle))
  check("the bpm at a beat is the section's", tempoAt(4, segs) === 120 && tempoAt(8, segs) === 60 && tempoAt(40, segs) === 60)
}

// ── the engine sizes every second from the map ─────────────────────────────
{
  const eng = readFileSync('lib/daw-engine.ts', 'utf8')
  const flat = (eng.match(/this\.beatsToSeconds\(/g) ?? []).length
  check('the flat beats→seconds helper is left only as the fallback in _slicedCurve', flat === 1, `${flat} call(s)`)
  check("curves take the bar's start beat", /startBeat\?: number,\s*\n\s*\): \{ curve: Float32Array; durSec: number \}/.test(eng))
  check('and every effect bar passes it',
    (eng.match(/effSeekOffsetSec, (?:map|v => [^,]+(?:, meta\))?), eff\.startBeat\)/g) ?? []).length >= 7)
  check('fades span the map', /_spanSeconds\(clip\.startBeat, clip\.startBeat \+ clip\.fadeIn\)/.test(eng))
  check('the scheduler tells synced delays, Apollo and plugins which section it is in',
    /this\._syncLocalTempo\(now\)/.test(eng) && /setApolloCtxTempo\(this\.ctx, bpm\)/.test(eng))
  check('and the chain signature no longer bakes the global tempo', !/@\$\{this\.tempo\}/.test(eng))
  check("the engine's scalar tempo is the map's opening bpm", /this\.tempo = openingBpm/.test(eng))
  check("a render expects the map's length", /const expectedSec = Math\.max\(0, this\._spanSeconds\(start, end\)\) \+ tail/.test(eng))

  const fx = readFileSync('lib/daw-effects.ts', 'utf8')
  check('a synced delay retimes live', /setTempo\(next\)/.test(fx) && /delay\.delayTime\.setTargetAtTime\(timeFor\(\)/.test(fx))
  const helios = readFileSync('lib/apollo/daw-fx.ts', 'utf8')
  check("an Apollo FX chain is told the song's bpm, not initPatch's 120",
    /fxOnlyPatch\(units, bpmNow\)/.test(helios) && /p\.global\.bpm = bpm/.test(helios))
  const transport = readFileSync('components/editor/daw/Transport.tsx', 'utf8')
  check("the count-in clicks at the section's tempo",
    /countIn\(countInBars \* project\.timeSignatureNum, tempoAt\(engine\.currentBeat/.test(transport))
}

// ── a global tempo edit moves the sound with the number ────────────────────
{
  const src = readFileSync('lib/daw-state.ts', 'utf8')
  const setTempo = src.slice(src.indexOf("case 'SET_TEMPO'"), src.indexOf("case 'SET_TIME_SIG'"))
  check('SET_TEMPO retempos the opening marker when there is one',
    /const opening = markers\.find\(m => m\.beat <= 0\.01\)/.test(setTempo) && /tempoMarkers = opening \? markers\.map/.test(setTempo))
  check("and rescales only the opening section's audio", /c\.startBeat < nextBeat - 1e-6/.test(setTempo))
  const upd = src.slice(src.indexOf("case 'UPDATE_TEMPO_MARKER'"), src.indexOf("case 'REMOVE_TEMPO_MARKER'"))
  check('editing the opening marker keeps the global number in step',
    /const globalTempo = marker\.beat <= 0\.01 \? tempo : project\.tempo/.test(upd))
  const add = src.slice(src.indexOf("case 'ADD_TEMPO_MARKER'"), src.indexOf("case 'UPDATE_TEMPO_MARKER'"))
  check('so does placing a marker at the start', /action\.marker\.beat <= 0\.01 \? Math\.max\(40/.test(add))

  // The pinned map cannot be moved by the number alone — which is the fault.
  const before = tempoSegments({ tempo: 90, tempoMarkers: [{ id: 'a', beat: 0, tempo: 120 }, { id: 'b', beat: 32, tempo: 100 }] })
  check('(the map ignores a global tempo that disagrees with the beat-0 marker — hence the reducer moves the marker)', before[0].bpm === 120)
}

// ── "set the tempo to 100" means the section being heard ───────────────────
{
  const project = {
    id: 'p', tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
    tracks: [{ id: 't1', name: 'Bass', volume: 0.8 }], arrangementClips: [],
    tempoMarkers: [{ id: 'm0', beat: 0, tempo: 120 }, { id: 'm1', beat: 32, tempo: 90 }],
  }
  const inSlow = planVoiceCall({ name: 'set_tempo', input: { bpm: '100' } }, project, { atBeat: 40 })
  check('at bar 11 it retempos the section that starts at bar 9',
    inSlow.actions?.[0]?.type === 'UPDATE_TEMPO_MARKER' && inSlow.actions[0].markerId === 'm1' && inSlow.actions[0].tempo === 100,
    JSON.stringify(inSlow))
  check('and says from where', /bar 9|9th bar/.test(inSlow.say ?? ''), inSlow.say)
  const inOpening = planVoiceCall({ name: 'set_tempo', input: { bpm: '100' } }, project, { atBeat: 4 })
  check('in the opening it is the global tempo (the reducer moves the marker with it)',
    inOpening.actions?.[0]?.type === 'SET_TEMPO', JSON.stringify(inOpening))
  const noMarkers = planVoiceCall({ name: 'set_tempo', input: { bpm: '100' } }, { ...project, tempoMarkers: undefined }, { atBeat: 40 })
  check('with no markers it is the whole song, as before', noMarkers.actions?.[0]?.type === 'SET_TEMPO')
}

console.log(failures ? `\n${failures} failing` : '\nthe song sounds the way it looks')
assert.equal(failures, 0)
