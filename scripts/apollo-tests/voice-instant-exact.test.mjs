#!/usr/bin/env node
// The commands that run without the model must not be reached by a bent word.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-instant-exact.test.mjs
//
// undo, redo, stop and pause are on INSTANT_COMMANDS (local-resolve.ts): they
// fire from the rules alone, in every assistant mode, because a round trip is
// the wrong price for stopping a song. That makes them the one place a fuzzy
// match has nothing downstream to catch it — and Words.has() bends any word
// within one edit of a four-letter target:
//
//   "reverb"  → "revert"  → UNDO.   "the reverb is too much" undid the last
//                                   edit. So did "less reverb", "turn on the
//                                   reverb" — any reverb sentence no other
//                                   rule could read.
//   "hat", "half" → "halt" → STOP.  "the hat is too much" stopped the song.
//   "red", "reds" → "redo" → REDO.
//   "pulse"   → "pause"   → PAUSE.
//
// Found by scripts/apollo-tests/_steal-probe-style sweeps of ordinary words
// through the interpreter. These rules now match their words exactly (see
// Words.exact); a genuine mishearing of "stop" still has a way back through
// the recogniser's alternatives, which are checked against context.
//
// Also here: the relative volume rule now reads an amount that was SAID.
// "Bring the bass down 3 dB" nudged by the default 15 points and read back
// "65%" — true, and not the move that was asked for.

import { importTs } from '../lib/ts-import.mjs'
import { makeTrack } from '../lib/daw-fixture.mjs'

const { interpret } = await importTs('lib/voice/interpret.ts')
const { INSTANT_COMMANDS, confidentEnough } = await importTs('lib/voice/local-resolve.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const pad = makeTrack({ name: 'Pad' })
const bass = makeTrack({ name: 'Bass' })
const bass2 = makeTrack({ name: 'Bass 2' })
const drums = makeTrack({ name: 'Drums' })
const ctx = { tracks: [pad, bass, bass2, drums], tempo: 120, clips: [], library: [], selectedTrackName: 'Pad' }
const read = (s) => interpret(s, ctx)
const instant = (s) => {
  const r = read(s)
  return r.calls.length > 0 && r.calls.every(c => INSTANT_COMMANDS.has(c.name)) && confidentEnough(r, 0.9)
}

// ── ordinary words no longer reach an instant command ──────────────────────
{
  for (const s of [
    'the reverb is too much', 'turn on the reverb on the pad', 'less reverb', 'reverb',
    'i like the reverb', 'take the reverb back a bit',
    'the hat is too much', 'the half', 'hat',
    'the red one', 'red', 'reds',
    'the pulse is too much', 'pulse',
    'i like the beginning', 'what about the beginning', 'the beginning',
    'the top', 'step', 'the step is too much',
  ]) {
    const r = read(s)
    check(`"${s}" is not an instant command`, !instant(s), `${r.matched} ${JSON.stringify(r.calls)}`)
  }
}

// ── the real words still work, as every advertised example does ────────────
{
  const is = (s, name, action) => {
    const r = read(s)
    const c = r.calls[0]
    check(`"${s}" → ${name}${action ? ` ${action}` : ''}`,
      !!c && c.name === name && (action ? c.input.action === action : true) && instant(s),
      `${r.matched} ${JSON.stringify(r.calls)}`)
  }
  is('undo', 'undo'); is('undo that', 'undo'); is('revert that', 'undo'); is('take that back', 'undo')
  is('take it back', 'undo'); is('take the last change back', 'undo')
  is('redo', 'redo'); is('redo that', 'redo')
  is('stop', 'transport', 'stop'); is('halt', 'transport', 'stop'); is('stop playing', 'transport', 'stop')
  is('stops', 'transport', 'stop'); is('okay stop it', 'transport', 'stop')
  is('pause', 'transport', 'pause'); is('hold on', 'transport', 'pause'); is('pause it', 'transport', 'pause')
  is('restart', 'transport', 'restart'); is('start over', 'transport', 'restart')
  is('from the top', 'transport', 'restart'); is('take it from the beginning', 'transport', 'restart')
  is('go back to the beginning', 'transport', 'restart'); is('play from the top', 'transport', 'restart')
}

// ── an amount that was said is the amount ──────────────────────────────────
{
  const vol = (s) => read(s).calls[0]?.input
  // 80% × 10^(-3/20) = 56.6 → 57
  check('"bring the bass down 3 db" moves by 3 dB, not by the default nudge',
    vol('bring the bass down 3 db')?.volume === 57, JSON.stringify(vol('bring the bass down 3 db')))
  check('decibels spelled out', vol('turn the pad down 6 decibels')?.volume === 40)
  check('up 6 dB from 80% clamps at 100', vol('turn the pad up 6 db')?.volume === 100)
  check('"by 10 percent" is ten points', vol('bring the bass down by 10 percent')?.volume === 70)
  check('a track whose name carries a number is not an amount',
    vol('turn the bass 2 up')?.target === 'Bass 2' && vol('turn the bass 2 up')?.volume === 95,
    JSON.stringify(vol('turn the bass 2 up')))
  check('and a dB amount on that track is still read',
    vol('bring bass 2 down 3 db')?.volume === 57, JSON.stringify(vol('bring bass 2 down 3 db')))
  check('the default nudge is unchanged when nothing was said',
    vol('turn the bass up a bit')?.volume === 88 && vol('make the pad louder')?.volume === 95)
  const bare = read('turn the bass down 10')
  check('a bare number is not guessed at (10 what?)',
    bare.matched !== 'set_track.volume.relative', `${bare.matched} ${JSON.stringify(bare.calls)}`)
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
