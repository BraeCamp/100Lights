#!/usr/bin/env node
// Widening the net before anything decides what was said.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-hypotheses.test.mjs
//
// Brae: "it's okay to have the system recognize multiple possible words from the
// audio instead of deciding on one and having the next part decide what closest
// word it can be corrected to if context doesn't fit well... the idea of
// widening the net to find the solution is there."
//
// A recogniser collapses a distribution into one sentence before anything knows
// which words matter. This layer un-collapses it: from one transcript it
// proposes the sentences that could have been said, and the project picks.
//
// Widening a net is easy and dangerous — the failure is a system that hears
// what it expects instead of what it was told, which is confident, silent and
// much worse than not understanding. So most of what is asserted here is about
// the net staying SHUT:
//
//   the transcript always competes, and always for free;
//   a rewrite only wins when it fits the project better than the words heard;
//   the vocabulary bounds it, so it proposes commands and track names and not
//   arbitrary English;
//   and a rewrite that wins says so, rather than acting silently.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { hypotheses, phoneticKey, editDistance } = await importTs('lib/voice/hypotheses.ts')
const { interpretHeard, interpret } = await importTs('lib/voice/interpret.ts')
const { COMMAND_VOCABULARY } = await importTs('lib/voice/commands.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const tracks = (...names) => ({
  tracks: names.map((name, i) => ({ id: `t${i}`, name, volume: 0.8, pan: 0 })),
  tempo: 120,
})
const CTX = tracks('Bass 2', 'Pad', 'Drums', 'Vocals')
const VOCAB = [...COMMAND_VOCABULARY, 'bass', 'pad', 'drums', 'vocals']

// ── Sounding alike, spelled differently ────────────────────────────────────
//
// The pairs that actually get misheard are phonetic, not typographic. Edit
// distance calls "mute"/"moot" two apart and "bass"/"bars" one apart, which is
// precisely backwards for anything downstream of a microphone.
check('mute and moot sound the same', phoneticKey('mute') === phoneticKey('moot'),
  `${phoneticKey('mute')} vs ${phoneticKey('moot')}`)
check('sole and solo sound the same', phoneticKey('sole') === phoneticKey('solo'))
check('but bass and bars do not', phoneticKey('bass') !== phoneticKey('bars'),
  `${phoneticKey('bass')} vs ${phoneticKey('bars')}`)
check('nor do pad and pan', phoneticKey('pad') !== phoneticKey('pan'))
// The numbers make the case better than any argument: by spelling, "bass" and
// "bars" are ONE edit apart and "mute" and "moot" are THREE. A parser working
// from edit distance alone is therefore most confident about exactly the pair
// it should keep apart, and blind to the pair it should merge.
check('by spelling, bass and bars are nearly the same word',
  editDistance('bass', 'bars', 4) === 1)
check('and mute and moot are far apart',
  editDistance('mute', 'moot', 4) === 3)
check('which is backwards, and why sound is consulted first',
  phoneticKey('mute') === phoneticKey('moot') && phoneticKey('bass') !== phoneticKey('bars'))
check('and it gives up past the cap', editDistance('abcdefgh', 'zzz', 2) > 2)

// ── The transcript always competes, and always for free ────────────────────
{
  const h = hypotheses({ text: 'mute the drums', confidence: 0.9 }, VOCAB)
  check('what was heard is always the first proposal', h[0].text === 'mute the drums')
  check('and it costs nothing to believe', h[0].cost === 0)
  check('the net stays bounded', h.length <= 24, `${h.length} proposals`)
}

// ── A mishearing two edits away is still reachable ────────────────────────
//
// This is the case the previous layer could not fix. "moot" is two edits from
// "mute" so no correction rule would ever reach it; it is one SOUND away, which
// is what makes it a plausible mishearing in the first place.
{
  const heard = { text: 'moot the drums', confidence: 0.55 }
  const flat = interpret(heard.text, CTX)
  check('read literally, "moot the drums" means nothing', flat.calls.length === 0, flat.matched)

  const wide = interpretHeard(heard, CTX)
  check('but widening the net finds it',
    wide.calls[0]?.name === 'set_track' && wide.calls[0]?.input?.muted === true,
    `${wide.matched} → ${JSON.stringify(wide.calls[0]?.input)}`)
  check('and it admits what it changed',
    wide.rewrittenFrom === 'moot the drums' && /moot/.test(wide.rewriteReason ?? ''),
    wide.rewriteReason)
}

// ── A rewrite does not win when the words heard already make sense ────────
{
  // "loop bars 9 to 17" is a real command. Nothing should rewrite "bars" into
  // "bass" to reach a different one, however close the project makes it look.
  const heard = { text: 'loop bars 9 to 17', confidence: 0.9 }
  const wide = interpretHeard(heard, CTX)
  check('a sentence that already works is not rewritten',
    wide.rewrittenFrom === undefined && wide.matched === 'set_loop_region.range',
    `${wide.matched}, from ${wide.rewrittenFrom ?? '(not rewritten)'}`)
}
{
  const heard = { text: 'mute the pad', confidence: 0.95 }
  const wide = interpretHeard(heard, CTX)
  check('nor is a clean command touched',
    wide.rewrittenFrom === undefined && wide.calls[0]?.input?.target === 'Pad',
    JSON.stringify(wide.calls[0]?.input))
}

// ── Confidence decides how hard the net is thrown ─────────────────────────
{
  const sure = hypotheses(
    { text: 'mute the drums', words: [
      { word: 'mute', confidence: 0.99 }, { word: 'the', confidence: 0.99 }, { word: 'drums', confidence: 0.99 },
    ] }, VOCAB)
  const unsure = hypotheses(
    { text: 'mute the drums', words: [
      { word: 'mute', confidence: 0.3 }, { word: 'the', confidence: 0.99 }, { word: 'drums', confidence: 0.99 },
    ] }, VOCAB)
  check('a word the recogniser was sure of is left alone',
    sure.length < unsure.length, `${sure.length} vs ${unsure.length} proposals`)
  check('and a word it doubted is reconsidered',
    unsure.some(h => h.text !== 'mute the drums'))
}

// ── The project's own names are in the net ────────────────────────────────
//
// A general recogniser has never seen this project's track names and is likelier
// to mangle them than any other word in the sentence. They are also the one part
// of the vocabulary that cannot be known in advance.
{
  const ctx = tracks('Rhodes', 'Drums')
  // "roads" for "Rhodes" is exactly the mistake a recogniser makes here.
  const wide = interpretHeard({ text: 'mute the roads', confidence: 0.5 }, ctx)
  check('a mangled track name can be recovered',
    wide.calls[0]?.input?.target === 'Rhodes',
    `${wide.matched} → ${JSON.stringify(wide.calls[0]?.input)}`)
}

// ── Nonsense stays nonsense ───────────────────────────────────────────────
//
// The real risk of a wide net: enough proposals and SOMETHING resolves. These
// sentences share words with real commands and must still come back empty.
const NONSENSE = [
  'what time is it',
  'i think that sounded pretty good',
  'can you make it more interesting',
  'the drums are too loud in the room',
  'i was talking to someone else',
  'hang on let me think about that',
]
for (const text of NONSENSE) {
  const wide = interpretHeard({ text, confidence: 0.9 }, CTX)
  check(`no command invented from: "${text}"`,
    wide.calls.length === 0,
    `${wide.matched} → ${JSON.stringify(wide.calls[0]?.input ?? null)}`)
}

// And again with the net thrown as hard as it goes.
//
// At high confidence the rewriting step is skipped entirely, so the cases above
// pass without ever exercising the thing they are meant to test — a suite that
// passes for the wrong reason is worse than no suite, because it is believed.
// Low confidence is where every substitution is on the table, and it is exactly
// the condition a noisy room produces.
for (const text of NONSENSE) {
  const wide = interpretHeard({ text, confidence: 0.25 }, CTX)
  check(`nor with the net thrown wide: "${text}"`,
    wide.calls.length === 0,
    `${wide.matched} → ${JSON.stringify(wide.calls[0]?.input ?? null)}`)
}

// Per-word doubt, which is the shape Deepgram actually returns.
{
  const text = 'i think that sounded pretty good'
  const wide = interpretHeard({
    text,
    words: text.split(' ').map(word => ({ word, confidence: 0.4 })),
  }, CTX)
  check('nor when every individual word is doubted',
    wide.calls.length === 0,
    `${wide.matched} → ${JSON.stringify(wide.calls[0]?.input ?? null)}`)
}

// ── It stays cheap enough to run on every utterance ───────────────────────
{
  const long = { text: 'could you please take the bass and move it back about two bars for me', confidence: 0.4 }
  const started = Date.now()
  for (let i = 0; i < 50; i++) interpretHeard(long, CTX)
  const each = (Date.now() - started) / 50
  check('a long, low-confidence sentence still reads in a few milliseconds',
    each < 25, `${each.toFixed(1)}ms each`)
}

console.log(failures
  ? `\n${failures} failing`
  : '\nthe net is wide, bounded, and never wins on its own say-so')
assert.equal(failures, 0)
