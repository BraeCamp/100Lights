// Asking for a sound by feel (lib/voice/plain-words.ts) and bending what came
// back (lib/voice/proposal.ts). The conversation itself is driven in
// .claude/light-check.mjs, where there is a studio to hear it.
//
//   node scripts/apollo-tests/plain-words.test.mjs

import assert from 'node:assert/strict'
import { importTs } from '../lib/ts-import.mjs'

const { PLAIN_WORDS, plainWordIn, needsAsking, senseFromAnswer, defaultSense, describeSense, plainForms } = await importTs('lib/voice/plain-words.ts')
const {
  readAdjust, isBareAdjustment, stepAmount, rampParameter, rampEnds, describeSpan, playbackSpan,
  setProposal, getProposal, clearProposal, PROPOSAL_TTL_MS, ADJUST_WORDS,
} = await importTs('lib/voice/proposal.ts')
const { isEchoOfReadBack } = await importTs('lib/voice/echo-guard.ts')

let passed = 0
const ok = (name, fn) => { fn(); passed++; console.log(`PASS ${name}`) }
const word = (w) => PLAIN_WORDS.find(x => x.word === w)

console.log('\nthe words people use')

ok('a word is found however it was said, and whole', () => {
  assert.equal(plainWordIn('i want it to sound fuzzier')?.word, 'fuzzy')
  assert.equal(plainWordIn('make the pad wiggle a bit')?.word, 'wiggle')
  assert.equal(plainWordIn('can it be dreamier')?.word, 'dreamy', 'the comparative is how people say it')
  assert.equal(plainWordIn('make it swampy'), null, 'a word nobody listed is not invented')
  assert.equal(plainWordIn('that fuzzball preset'), null, 'a longer word is not a match')
  assert.equal(plainWordIn('nothing here'), null)
})

ok('every sense names a real move with a strength', () => {
  for (const w of PLAIN_WORDS) {
    assert.ok(w.senses.length >= 1, w.word)
    for (const s of w.senses) {
      const call = s.call('Pad', s.amount)
      assert.ok(call.name && call.input, `${w.word}/${s.id}`)
      assert.equal(call.input.target, 'Pad')
      assert.ok(s.amount > 0 && s.amount <= 100, `${w.word}/${s.id} amount`)
      assert.ok(s.says.length > 8, `${w.word}/${s.id} needs describing for someone who does not know the word`)
    }
  }
})

ok('a word with two sounds asks; a word with one does not', () => {
  assert.equal(needsAsking(word('fuzzy')), true)
  assert.ok(word('fuzzy').asks.includes('?'))
  assert.equal(needsAsking(word('muffled')), false)
  assert.equal(needsAsking(word('echoey')), false)
})

ok('an answer picks a sense from a fragment', () => {
  const fuzzy = word('fuzzy')
  assert.equal(senseFromAnswer(fuzzy, 'more muffled').id, 'muffled')
  assert.equal(senseFromAnswer(fuzzy, 'the static one').id, 'static')
  assert.equal(senseFromAnswer(fuzzy, 'like it is behind a door').id, 'muffled')
  assert.equal(senseFromAnswer(fuzzy, 'the second').id, 'muffled')
  assert.equal(senseFromAnswer(fuzzy, 'purple'), null)
  assert.equal(defaultSense(fuzzy).id, 'static', 'the commoner reading, when an answer settles nothing')
})

ok('what is about to happen, said plainly', () => {
  assert.equal(describeSense(word('muffled').senses[0], 50), 'a filter closing it down at 50%')
  assert.equal(describeSense(word('fuzzy').senses[0], 40), 'some grit on it at 40%')
  assert.equal(describeSense(word('wiggle').senses[0], 50), 'the volume pulsing at 50%, every 1/8')
})

ok('the vocabulary is a real list', () => {
  assert.ok(plainForms().length > 40, `${plainForms().length} forms`)
  assert.equal(plainForms().includes('wider'), false, 'stereo width belongs to set_width, exactly')
})

console.log('\nbending what is on the table')

ok('less and more, and how far', () => {
  assert.deepEqual(readAdjust('a little bit less of that'), { kind: 'less', size: 'little' })
  assert.deepEqual(readAdjust('more'), { kind: 'more', size: 'normal' })
  assert.deepEqual(readAdjust('way more'), { kind: 'more', size: 'lot' })
  assert.deepEqual(readAdjust('a lot less'), { kind: 'less', size: 'lot' })
})

ok('"start that way then come down" is a shape, and "that way" is not a size', () => {
  assert.deepEqual(readAdjust('start that way then come down'), { kind: 'ramp_down', size: 'normal' })
  assert.deepEqual(readAdjust('have it build up over the section'), { kind: 'ramp_up', size: 'normal' })
})

ok('taking it back beats keeping it, however it is said', () => {
  assert.equal(readAdjust('undo that').kind, 'undo')
  assert.equal(readAdjust('no nevermind').kind, 'undo')
  assert.equal(readAdjust('take that back off').kind, 'undo')
  assert.equal(readAdjust('that sounds good thanks').kind, 'keep')
  assert.equal(readAdjust('what time is it'), null)
})

ok('an adjustment is a sentence made of NOTHING but adjustment words', () => {
  assert.equal(isBareAdjustment(['little', 'bit', 'less']), true)
  assert.equal(isBareAdjustment(['turn', 'bass', 'up']), false, '"turn the bass up" is a new request')
  assert.equal(isBareAdjustment(['remove', 'drop', 'marker']), false)
  assert.equal(isBareAdjustment([]), false)
  assert.ok(ADJUST_WORDS.has('less') && ADJUST_WORDS.has('then'))
})

ok('stepping the strength stays on the dial', () => {
  assert.equal(stepAmount(50, 'less', 'little'), 38)
  assert.equal(stepAmount(50, 'more', 'normal'), 72)
  assert.equal(stepAmount(5, 'less', 'lot'), 0)
  assert.equal(stepAmount(95, 'more', 'lot'), 100)
})

ok('a ramp starts where the sound is and lands proportionally — 50% comes down to 20%', () => {
  const p = { word: 'fuzzy', sense: word('muffled').senses[0], target: 'Pad', span: { start: 0, end: 32 }, amount: 50, at: Date.now() }
  assert.deepEqual(rampEnds(p, 'ramp_down', 'normal'), { from: 50, to: 20 })
  assert.deepEqual(rampEnds(p, 'ramp_down', 'little'), { from: 50, to: 30 })
  assert.deepEqual(rampEnds({ ...p, amount: 10 }, 'ramp_down', 'lot'), { from: 10, to: 2 }, 'a quiet one does not fall off the bottom')
})

ok('only an effect can be spread over the bars, and the rest say so', () => {
  assert.equal(rampParameter(word('muffled').senses[0]), 'lowpass')
  assert.equal(rampParameter(word('fuzzy').senses[0]), 'drive')
  assert.equal(rampParameter(word('echoey').senses[0]), 'delay')
  assert.equal(rampParameter(word('wiggle').senses[0]), null, 'an LFO depth is not on the automation list')
  assert.equal(rampParameter(word('bigger').senses[1]), null, 'nor is a tone shape')
})

console.log('\nplaying it back where it happens')

ok('a span in bars, for saying out loud', () => {
  assert.equal(describeSpan({ start: 0, end: 32 }, 4), 'bars 1 to 8')
  assert.equal(describeSpan({ start: 0, end: 4 }, 4), 'bar 1')
  assert.equal(describeSpan(null, 4), '')
})

ok('playback takes a run-up and a tail, and never runs off either end', () => {
  assert.deepEqual(playbackSpan({ start: 32, end: 64 }, 4, 80), { start: 24, end: 72 })
  assert.deepEqual(playbackSpan({ start: 0, end: 16 }, 4, 80), { start: 0, end: 24 }, 'no run-up before the beginning')
  assert.deepEqual(playbackSpan(null, 4, 80), { start: 0, end: 32 }, 'no span: the opening')
})

console.log('\nanswering a question said out loud')

ok('an answer is not mistaken for Light hearing its own question back', () => {
  // ⚠️ Answering a SPOKEN question means saying its words back at an open
  // microphone, which is exactly the shape the echo guard exists to catch.
  // Every option here has to survive it, or the conversation cannot happen by
  // voice at all — only by typing.
  const q = word('fuzzy').asks
  for (const answer of ['more muffled', 'more like static', 'the muffled one', 'muffled', 'the second one']) {
    assert.equal(isEchoOfReadBack(answer, q, 500), false, answer)
  }
  const w = word('wiggle').asks
  for (const answer of ['the volume pulsing', 'the tone moving underneath', 'side to side']) {
    assert.equal(isEchoOfReadBack(answer, w, 500), false, answer)
  }
  // And the question coming back whole still is an echo.
  assert.equal(isEchoOfReadBack(q, q, 500), true)
})

console.log('\nthe table is put away when it goes stale')

ok('a proposal is held, and let go of', () => {
  clearProposal()
  assert.equal(getProposal(), null)
  const p = { word: 'fuzzy', sense: word('muffled').senses[0], target: 'Pad', span: null, amount: 50, at: Date.now() }
  setProposal(p)
  assert.equal(getProposal()?.word, 'fuzzy')
  assert.equal(getProposal(Date.now() + PROPOSAL_TTL_MS + 1), null, 'an hour later, "a bit less" is not applied to something forgotten')
  clearProposal()
})

console.log(`\n${passed} passed`)
