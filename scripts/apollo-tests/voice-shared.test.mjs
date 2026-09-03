#!/usr/bin/env node
// One person's paid lesson, everybody's free command — and what never travels.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-shared.test.mjs
//
// Brae: "The pooled cache and macro ideas don't seem to require much fund at
// all. How much can we do right now?"
//
// ⚠️ A POOLED ENTRY IS EXECUTED BY PEOPLE WHO NEVER SAW IT, on songs its author
// will never open. That is a different risk in kind from a cache answering its
// own author, so almost everything here is about what must NOT leave a browser:
// nothing anybody said about their own song, nothing destructive, nothing
// naming a tool that does not exist.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { shareable, shareableTemplate, mergeShared, recallCommand, forgetLearned } =
  await importTs('lib/voice/learned.ts')

const SONG = ['Pad', 'Bass', 'Drums']

// ── what may be offered ────────────────────────────────────────────────────
{
  const gift = shareableTemplate('mute the pad',
    [{ name: 'set_track', input: { target: 'pad', mute: true } }], SONG)
  check('an ordinary lesson generalises into something shareable',
    gift?.template === 'mute the {0}', JSON.stringify(gift))

  check('a sentence with no argument is not pooled — it is about one song',
    !shareableTemplate('turn on the metronome', [{ name: 'set_metronome', input: { on: true } }], SONG))

  check('nothing pointing at "that" travels',
    !shareableTemplate('do that to the pad as well',
      [{ name: 'set_track', input: { target: 'pad' } }], SONG))

  check('nothing destructive travels',
    !shareableTemplate('bin the pad',
      [{ name: 'delete_track', input: { target: 'pad' } }], SONG))

  check('nor a call carrying a number nobody said',
    !shareableTemplate('add four bars after the pad',
      [{ name: 'add_clip', input: { target: 'pad', atBeat: 128 } }], SONG))
}

// ── ⚠️ the check that stops words leaving ──────────────────────────────────
//
// The slots take out the track names. This takes out everything else: every
// literal word left in a template has to be one the command vocabulary already
// knows, so a sentence carrying anything personal cannot be offered even in
// principle.
{
  check('a template of known words is shareable',
    shareable('mute the {0}', [{ name: 'set_track', input: {} }]))
  check('a template carrying free text is not',
    !shareable('mute the {0} for gemmas birthday party', [{ name: 'set_track', input: {} }]),
    'this is the one that keeps people\'s words at home')
  check('a template that is nothing but a slot is not',
    !shareable('{0}', [{ name: 'set_track', input: {} }]))
  check('and neither is one with no slot at all',
    !shareable('mute the pad', [{ name: 'set_track', input: {} }]))
}

// ── the pool answers, but never outranks this studio ───────────────────────
{
  forgetLearned()
  mergeShared([{ template: 'mute the {0}', calls: [{ name: 'set_track', input: { target: '{0}', mute: true } }] }])
  const got = recallCommand('mute the drums')
  check('a sentence this studio never learned is answered by the pool',
    got?.calls[0].input.target === 'drums' && got.from === 'shared', JSON.stringify(got))

  // ⚠️ What somebody taught THIS studio must always win: a person who corrected
  // the same sentence twice has said something about how they work, and a
  // stranger's entry outvoting them would feel like the studio forgetting.
  const { rememberCommand } = await importTs('lib/voice/learned.ts')
  rememberCommand('mute the drums', [{ name: 'set_track', input: { target: 'drums', solo: true } }], SONG)
  const mine = recallCommand('mute the drums')
  check('but the studio\'s own lesson comes first',
    mine?.from === 'exact' && mine.calls[0].input.solo === true, JSON.stringify(mine))
}

// ── the server refuses the same things, independently ──────────────────────
//
// Transcribed rather than imported: the module opens a database connection at
// load. If this drifts from the route it is because somebody changed the route,
// which is exactly when it should fail.
{
  const src = readFileSync('lib/voice/shared-learned.ts', 'utf8')
  check('the server checks the tool name is real', /MUSIC_TOOL_NAMES as readonly string\[\]\)\.includes/.test(src))
  check('the server refuses destructive calls', /destructive commands are never pooled/.test(src))
  check('the server insists on a slot', /only templates are pooled/.test(src))
  check('the server restricts the characters a template may contain',
    /\^\[a-z0-9 %\{\}\]\+\$/.test(src))
  check('nothing is served that has not been approved',
    /WHERE approved = true AND blocked = false/.test(src))
  check('and the same person twice is not two people',
    /INSERT INTO voice_learned_by[\s\S]{0,120}ON CONFLICT DO NOTHING RETURNING id/.test(src))
}

console.log(failures ? `\n${failures} failing` : '\ntaught once, free for everybody')
assert.equal(failures, 0)
