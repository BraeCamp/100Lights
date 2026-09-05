#!/usr/bin/env node
// What the rules are allowed to decide, and what they must stop deciding.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-rules-scope.test.mjs
//
// Brae: "Asked it to 'Change the name of the item drums 1 to drums 2' and it
// changed the time signature... When AI mode is enabled, is it still using the
// rules for the non AI variant? It shouldn't be doing that... a cleaner ruleset
// would make it easier to [add functions] without issue."
//
// Both halves of that were true, and they compound: the rules ran FIRST on
// anything they felt confident about, so a greedy rule could not be corrected
// by the model that was supposed to be in charge. No model was involved in
// turning a rename into a time signature.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { interpret } = await importTs('lib/voice/interpret.ts')
const { runsLocally, confidentEnough, INSTANT_COMMANDS } = await importTs('lib/voice/local-resolve.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const ctx = {
  tracks: [{ id: 'td', name: 'Drums', volume: 0.8 }, { id: 'tb', name: 'Bass', volume: 0.8 }],
  tempo: 120,
  clips: [
    { id: 'c1', name: 'Drums 1', trackId: 'td' },
    { id: 'c2', name: 'Drums 2', trackId: 'td' },
  ],
}
const read = t => interpret(t, ctx)

// ── renaming an item is renaming an item ───────────────────────────────────
{
  const said = [
    'Change the name of the item drums 1 to drums 2',
    'change the name of drums 1 to drums 2',
    'rename drums 1 to intro',
    'rename the clip drums 1 to intro',
  ]
  const wrong = []
  for (const line of said) {
    const got = read(line).calls[0]
    if (got?.name !== 'rename_clip') wrong.push(`"${line}" → ${got?.name ?? 'nothing'}`)
  }
  check('every way of asking to rename an item renames it', wrong.length === 0, wrong.join(' | '))

  const first = read('Change the name of the item drums 1 to drums 2').calls[0]
  check('and it renames the right one, to the right thing',
    first?.input?.target === 'Drums 1' && first?.input?.name === 'Drums 2',
    JSON.stringify(first?.input))
}

// ── a meter is a pair SAID AS A PAIR ───────────────────────────────────────
//
// ⚠️ set_time_signature accepted the bare word "change" plus any two numbers
// anywhere in the sentence, so "CHANGE the name of the item drums 1 to drums 2"
// was read as 1/2. Numbers with words between them are two arguments to
// something else — which was true of every sentence this rule was stealing.
{
  const notMeters = [
    'Change the name of the item drums 1 to drums 2',
    'change the name of drums 1 to drums 2',
    'move clip 1 to bar 2',
  ]
  const stolen = notMeters.filter(l => read(l).calls[0]?.name === 'set_time_signature')
  check('a sentence with two separated numbers is not a meter', stolen.length === 0, stolen.join(' | '))

  const meters = [['put it in 3 4', 3, 4], ['switch to 6 8', 6, 8], ['change the time signature to 5 4', 5, 4]]
  const broke = []
  for (const [line, n, d] of meters) {
    const got = read(line).calls[0]
    if (got?.name !== 'set_time_signature' || got.input.numerator !== n || got.input.denominator !== d) {
      broke.push(`"${line}" → ${got?.name}(${got?.input?.numerator}/${got?.input?.denominator})`)
    }
  }
  check('and a meter said as a meter still works', broke.length === 0, broke.join(' | '))
}

// ── one-edit collisions on short trigger words ─────────────────────────────
//
// ⚠️ "Call drums 1 the intro" became a DIMINUENDO, because "call" is one edit
// from "fall" and has() bends words. The third time this exact trap has been
// sprung; the answer is always the same — a trigger that short must be exact.
{
  const got = read('call drums 1 the intro').calls[0]
  check('"call" is not heard as "fall"', got?.name !== 'dynamics_ramp', got?.name ?? 'nothing')
  check('and a real diminuendo still works',
    read('diminuendo the bass').calls[0]?.name === 'dynamics_ramp')
  check('as does the shorthand, said exactly',
    read('make the bass fall away').calls[0]?.name === 'dynamics_ramp')
}

// ── with the assistant on, the rules stand back ────────────────────────────
{
  const editing = read('mute the drums')
  check('an edit runs locally in rules mode', runsLocally(editing, 0.95, 'rules'))
  // ⚠️ THE POINT. An edit must reach the model when the model is in charge,
  // or a wrong rule cannot be corrected by the thing meant to be deciding.
  check('and does NOT in AI mode — the assistant decides', !runsLocally(editing, 0.95, 'auto'))
  check('nor when the assistant only asks first', !runsLocally(editing, 0.95, 'ask'))

  // ⚠️ Except the ones where a round-trip IS the bug. "Stop" has to stop now.
  const stop = read('stop')
  check('but the transport never waits for a model',
    runsLocally(stop, 0.6, 'auto'), stop.calls[0]?.name)
  // ⚠️ Still tiny, and the bar for joining it is high: every name here is a
  // sentence the model never reads. The transport four are here because a
  // round-trip IS the bug. `sound_like` and `adjust_it` are here because they
  // never guess — they only fire on a word that is IN the vocabulary, they ask
  // a question the model cannot hand back (its options carry the calls they
  // would make), and the assistant, told what this studio can do, answers such
  // a sentence by calling them anyway. Raise this number only with an argument
  // that good.
  check('and the instant list is deliberately tiny',
    INSTANT_COMMANDS.size <= 6, `${INSTANT_COMMANDS.size} commands`)

  // The gate is only ever a narrowing of the existing bar, never a widening.
  const weak = { calls: [{ name: 'transport', input: {} }], confidence: 0.2, corrections: 0 }
  check('a reading the rules do not trust is still not run',
    !runsLocally(weak, 0.9, 'rules') && !runsLocally(weak, 0.9, 'auto'))
  check('and confidentEnough is unchanged by any of this',
    confidentEnough(editing, 0.95) === true)
}

console.log(failures ? `\n${failures} failing` : '\nthe rules decide less, and get less wrong')
assert.equal(failures, 0)
