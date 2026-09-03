#!/usr/bin/env node
// The assistant loop: what goes back to the model, and when.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-loop.test.mjs
//
// VoiceControl has a four-turn loop that replies to the model with the result
// of every tool call. It only ever ran ONE turn, because the route never sent
// back the model's own turn (`raw`) and the loop, quite rightly, refuses to
// post a tool_result with no tool_use before it. Three things followed:
//
//   a refused batch was reported to NOBODY. The only setProblem for a refusal
//   sat on `turn === MAX_TURNS - 1`, which was never reached, and the code
//   after the loop only ever spoke `lastSay`. "Working on it" — then silence.
//
//   the model was told results come back and that it could `describe` before
//   acting. A model that believed that spent its one turn looking and never
//   acted.
//
//   the cost model assumed two turns per command. Nobody had ever paid for a
//   second one.
//
// The rule now: a second turn is bought ONLY when a call was refused (the
// model gets the reason and fixes it). A turn where everything ran ends the
// exchange — the studio's read-back is the report. And the refusal that ends
// an exchange is spoken.

import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')
const route = readFileSync('app/api/ai/assist/route.ts', 'utf8')
const assist = readFileSync('lib/ai-assist.ts', 'utf8')

// ── the route sends the model's turn back, so a reply is possible at all ────
{
  check('the route returns the assistant turn verbatim', /raw: result\.raw/.test(route))
  check('runAssist still produces it', /raw: blocks as AssistBlock\[\]/.test(assist))
}

// ── the loop's policy ──────────────────────────────────────────────────────
{
  // The loop body, from planning to the pair that goes back.
  const from = voice.indexOf('const plans = planVoiceCallsEach(calls, proj, voiceCtx())')
  const to = voice.indexOf('// ── The refusal is SAID, not just filed')
  const body = voice.slice(from, to)
  check('the loop body was found', from > 0 && to > from)

  check('each call is planned against what the calls before it made',
    /planVoiceCallsEach\(calls, proj, voiceCtx\(\)\)/.test(body))
  check('a turn where everything ran ENDS the exchange — no "done" turn is bought',
    /if \(badAt < 0\) \{[\s\S]*?lastProblem = ''[\s\S]*?break\s*\}/.test(body))
  check('a refusal goes back to the model',
    /priorProblem = lastProblem[\s\S]*?lastProblem = plans\[badAt\]\.problem/.test(body)
    && /msgs\.push\(\s*\{ role: 'assistant', content: raw \},\s*\{ role: 'user', content: results \},\s*\)/.test(body))
  check('unless the model repeated itself', /if \(lastProblem === priorProblem\) break/.test(body))
  check('and never past the last turn', /if \(turn === MAX_TURNS - 1\) break/.test(body))
  check('it still only pairs a result with a real tool_use',
    /const raw = Array\.isArray\(data\.raw\) \? data\.raw : \[\]/.test(body) && /if \(!raw\.length\) break/.test(body))
}

// ── the refusal is spoken ──────────────────────────────────────────────────
{
  check('a refusal that ends the exchange is said out loud, as a problem',
    /if \(lastProblem && !lastSay\) \{\s*respond\(spoke \? `\$\{lastProblem\} \$\{spoke\}` : lastProblem, 'problem'\)/.test(voice))
  check('the old fourth-turn-only setProblem is gone',
    !/turn === MAX_TURNS - 1 && badAt >= 0/.test(voice))
  check('a question the model asked after a refusal is still filed in the ledger',
    /recordCommand\(\{ said: text, by: 'assistant', turns: usedTurns, \.\.\.spend, problem: lastProblem \|\| undefined \}\)\s*traceEnd\(''/.test(voice))
}

// ── what is learned ────────────────────────────────────────────────────────
{
  check('only a first-turn answer is learned — a retry was informed by the refusal, not the sentence',
    /if \(!lastProblem && ranCalls\.length && usedTurns === 1\)/.test(voice))
  check('and only the calls that RAN, not every call across the exchange',
    /rememberCommand\(text, ranCalls, names\)/.test(voice) && /shareableTemplate\(text, ranCalls, names\)/.test(voice))
}

// ── the prompt tells the truth about the loop ──────────────────────────────
{
  const hintAt = assist.indexOf('const LOOP_HINT')
  const hint = assist.slice(hintAt, assist.indexOf('].join', hintAt))
  check('the model is no longer told to look before it acts', !/look before you act/i.test(hint))
  check('it is told a refusal comes back and nothing else does',
    /reason comes back to you/.test(hint) && /you will not see the results/.test(hint))
  check('and to put the whole sentence in one reply', /everything the sentence asks for in one reply/.test(hint))
}

// ── the summary carries what the model would otherwise have to ask for ─────
{
  const { musicStateSummary } = await importTs('lib/voice/music-tools.ts')
  const s = musicStateSummary({
    tempo: 120, timeSignatureNum: 4, timeSignatureDen: 4,
    tracks: [{ id: 't1', name: 'Pad', volume: 0.8 }],
    arrangementClips: [],
    cueMarkers: [{ beat: 32, name: 'Drop' }, { beat: 16, name: 'Chorus' }],
  })
  check('sections are in the song summary, in order',
    /Sections: Chorus at bar 5, Drop at bar 9\./.test(s), s)
  const none = musicStateSummary({ tempo: 120, tracks: [] })
  check('and absent when there are none', !/Sections/.test(none))
}

// ── recent context is trimmed to what can be referred back to ─────────────
{
  const memory = await importTs('lib/voice/voice-memory.ts')
  memory.clearVoiceMemory()
  const say = (said, calls, by = 'local') => memory.remember({
    said, heard: 0.9, by, matched: 'x', understood: 0.9, calls, said_back: 'ok',
  })
  say('mute the pad', [{ name: 'set_track', input: {} }])
  say('play', [{ name: 'transport', input: { action: 'play' } }])
  say('stop', [{ name: 'transport', input: { action: 'stop' } }])
  say('click on', [{ name: 'metronome', input: { on: true } }])
  say('add reverb to the pad', [{ name: 'add_effect', input: {} }], 'assistant')
  const ctx = memory.recentContext(6)
  check('transport and click lines are not sent — nothing can point back at them',
    !/"play"|"stop"|"click on"/.test(ctx), ctx)
  check('the edits are', /mute the pad/.test(ctx) && /add reverb to the pad/.test(ctx))
  check('the studio sends six lines, not ten', /recent: recentContext\(6\)/.test(voice))
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed')
process.exit(failures ? 1 : 0)
