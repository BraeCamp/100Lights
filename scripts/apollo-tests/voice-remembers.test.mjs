#!/usr/bin/env node
// Light remembering what was just said.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-remembers.test.mjs
//
// Brae: "it answers in a way that asks for specifics then doesn't know what to
// do when I give them because it forgets. We probably need it to remember the
// last 5 or 10 commands too so that it knows the context."
//
// Two separate failures wore the same face.
//
//   ⚠️ A QUESTION DID NOT HOLD THE FLOOR. Attention was decided by how recently
//   a COMMAND was accepted. The studio asking "which track did you mean?" — the
//   strongest invitation to speak there is — counted for nothing, and the
//   answer to it ("the bass one") reads as no command at all, so it was thrown
//   away as something overheard. From outside, a studio that stops listening
//   for the reply is indistinguishable from one that forgot it had asked.
//
//   ⚠️ AND NOTHING SURVIVED A SUCCESS. The conversation array is cleared every
//   time a command works — it has to be, because a tool_use turn cannot be
//   replayed without its results — so a finished command left no trace at all
//   and "do that to the bass as well" had no "that" to point at.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

// voice-memory reads localStorage at module scope on first use.
const store = new Map()
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
  removeItem: k => store.delete(k),
}

const memory = await importTs('lib/voice/voice-memory.ts')
const attention = await importTs('lib/voice/attention.ts')

// ── a question holds the conversation open ─────────────────────────────────
{
  const base = {
    text: 'the bass one', now: 1_000_000, continuous: true,
    // Long past the ordinary attention window: somebody thought about it.
    lastAcceptedAt: 1_000_000 - (attention.ATTENTION_MS + 5_000),
  }
  const ignored = attention.considerUtterance(base)
  const answered = attention.considerUtterance({ ...base, awaitingAnswer: true })

  check('an unaddressed sentence long after the last command is ignored',
    ignored.act === false, ignored.reason ?? '')
  // ⚠️ The point: the same sentence, with a question open, IS the answer.
  check('but the same words answer a question that is still open',
    answered.act === true && answered.text === 'the bass one')

  // The live path does not use considerUtterance — it uses shouldActOn — so
  // the rule has to hold in BOTH, and the call site has to pass it.
  const unreadable = {
    held: true, collecting: false, readable: false, queueWord: false,
    assistantActs: false,
  }
  check('shouldActOn drops an unreadable sentence with nothing pending',
    attention.shouldActOn(unreadable) === false)
  check('and keeps it while something is being answered',
    attention.shouldActOn({ ...unreadable, answering: true }) === true)

  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  // ⚠️ THE WIRING IS THE FIX. The structured asks were all listed; the
  // free-form one the assistant raises was not.
  check('and the studio counts its own open question as being answered',
    /answering: confirmed \|\| pendingAsk !== null \|\| !!askingRef\.current/.test(voice))
}

// ── the last few commands, as context ──────────────────────────────────────
{
  memory.clearVoiceMemory()
  check('nothing remembered reads as nothing, not as an empty heading',
    memory.recentContext() === '')

  memory.remember({ said: 'mute the drums', heard: 0.9, by: 'local', matched: 'mute',
    understood: 0.9, calls: [{ name: 'set_track', input: {} }], said_back: 'Drums muted.' })
  memory.remember({ said: 'make it louder', heard: 0.9, by: 'assistant', matched: '',
    understood: 0, calls: [], asked: 'Which track did you mean?' })

  const ctx = memory.recentContext()
  check('what was asked is there', /mute the drums/.test(ctx) && /Drums muted\./.test(ctx))
  // ⚠️ The case Brae hit: the assistant has to see that IT asked something.
  check('and so is the question it asked back',
    /asked back: Which track did you mean\?/.test(ctx), ctx.split('\n').pop())
  check('one line per exchange', ctx.split('\n').length === 2)

  // ⚠️ An undone edit is a WRONG example — offering it as context invites the
  // same mistake again.
  memory.remember({ said: 'delete the intro', heard: 0.9, by: 'local', matched: 'del',
    understood: 0.9, calls: [], said_back: 'Deleted.' })
  memory.markUndone()
  check('an undone command is left out', !/delete the intro/.test(memory.recentContext()))

  // ⚠️ A command from this morning is not context for this sentence, it is a
  // red herring. A window of 0 does NOT prove that: an exchange stamped in the
  // same millisecond is genuinely current, so whether it survives depends on
  // how fast the machine is — which is how this assertion first failed only
  // inside the full suite. A window that has already closed is unambiguous.
  check('and so is anything old', memory.recentContext(10, -1) === '')

  let n = 0
  while (n++ < 30) {
    memory.remember({ said: `command ${n}`, heard: 0.9, by: 'local', matched: 'x',
      understood: 0.9, calls: [], said_back: 'ok' })
  }
  check('never more than asked for', memory.recentContext(10).split('\n').length === 10)
}

// ── it reaches the model, and does not cost a cache hit ────────────────────
{
  const assist = readFileSync('lib/ai-assist.ts', 'utf8')
  const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
  const route = readFileSync('app/api/ai/assist/route.ts', 'utf8')

  check('the studio sends it', /recent: recentContext\(\d*\)/.test(voice))
  check('the route passes it on, capped', /body\.recent.*slice\(0, 2000\)/s.test(route))
  check('and it becomes a system block', /if \(recent\)/.test(assist))

  // ⚠️ THE PREFIX IS CACHED FOR AN HOUR AND THE WHOLE BILL TURNS ON THE HIT
  // RATE. Anything that changes per utterance must sit AFTER the breakpoint.
  const cacheAt = assist.indexOf('cache_control')
  const recentAt = assist.indexOf('if (recent)')
  check('placed after the cache breakpoint, so it costs no hit',
    cacheAt > 0 && recentAt > cacheAt, `cache@${cacheAt} recent@${recentAt}`)
}

console.log(failures ? `\n${failures} failing` : '\nit remembers')
assert.equal(failures, 0)
