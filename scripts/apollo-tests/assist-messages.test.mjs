#!/usr/bin/env node
// A conversation the Anthropic API will accept.
//
//   node --experimental-strip-types scripts/apollo-tests/assist-messages.test.mjs
//
// ⚠️ THE 400 THAT COST A SESSION:
//
//     messages.0.content.1: unexpected 'tool_use_id' found in 'tool_result'
//     blocks. Each 'tool_result' block must have a corresponding 'tool_use'
//     block in the previous message.
//
// A tool_result is only legal directly after the assistant turn that asked for
// it, and the request is refused WHOLE when it is not — so one stray block
// means the model never sees the sentence at all, and the studio says "an API
// error" for something that never reached it.
//
// Two things separated them, and both are reproduced here:
//
//   the studio posted `content: data.raw ?? []`, so a reply carrying no raw
//   blocks became an EMPTY assistant message; the route drops empty messages,
//   and its tool_result was left with nothing before it — index 0, exactly as
//   reported.
//
//   the 40-message cap trims from the START, which can cut an assistant's
//   tool_use while keeping the user tool_result that followed it.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const route = readFileSync('app/api/ai/assist/route.ts', 'utf8')
const voice = readFileSync('components/editor/daw/VoiceControl.tsx', 'utf8')

// ── the repair exists, and runs after both hazards ─────────────────────────
{
  check('the route strips tool_results with no matching tool_use',
    /b\?\.type !== 'tool_result' \|\| \(b\.tool_use_id \? offered\.has\(b\.tool_use_id\)/.test(route))
  // ⚠️ Order matters: repairing BEFORE the cap would let the cap re-orphan one.
  const capAt = route.indexOf('messages.length - 40')
  const fixAt = route.indexOf("b?.type !== 'tool_result'")
  check('and it runs AFTER the history cap, not before',
    capAt > 0 && fixAt > capAt, `cap@${capAt} repair@${fixAt}`)
  check('a message left with nothing but orphans is removed',
    /if \(kept\.length === 0\) messages\.splice\(i, 1\)/.test(route))
  check('and the conversation cannot open on an assistant turn',
    /while \(messages\.length && messages\[0\]\.role === 'assistant'\) messages\.shift\(\)/.test(route))
}

// ── and the studio stops producing the shape in the first place ────────────
{
  check('the studio no longer posts `data.raw ?? []`', !/content: data\.raw \?\? \[\]/.test(voice))
  check('it only pairs a result with a real tool_use',
    /const raw = Array\.isArray\(data\.raw\) \? data\.raw : \[\]/.test(voice)
    && /if \(!raw\.length\) break/.test(voice))
}

// ── the repair, run for real against the reported shape ────────────────────
//
// The route's logic, transcribed, so the RULE is tested rather than the regexes
// above. If this diverges from the route it is because somebody changed the
// route, which is exactly when this should fail.
{
  const repair = msgs => {
    const idsIn = m => {
      const out = new Set()
      if (Array.isArray(m.content)) for (const b of m.content) if (b?.type === 'tool_use' && b.id) out.add(b.id)
      return out
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i]
      if (m.role !== 'user' || !Array.isArray(m.content)) continue
      const offered = i > 0 && msgs[i - 1].role === 'assistant' ? idsIn(msgs[i - 1]) : new Set()
      const kept = m.content.filter(b => b?.type !== 'tool_result' || (b.tool_use_id ? offered.has(b.tool_use_id) : false))
      if (kept.length === m.content.length) continue
      if (kept.length === 0) msgs.splice(i, 1); else m.content = kept
    }
    while (msgs.length && msgs[0].role === 'assistant') msgs.shift()
    return msgs
  }

  // Brae's exact shape: a lone tool_result at index 0.
  const orphaned = repair([
    { role: 'user', content: [
      { type: 'text', text: 'change reverb to 100% on pad' },
      { type: 'tool_result', tool_use_id: 'toolu_01ANWvdmU5RJmDgKQUySnig9', content: 'done' },
    ] },
  ])
  check('the reported shape is repaired, not rejected',
    orphaned.length === 1 && orphaned[0].content.length === 1
      && orphaned[0].content[0].type === 'text',
    JSON.stringify(orphaned).slice(0, 90))

  // A legitimate pair must survive untouched — a repair that eats real
  // conversation would break the multi-turn loop instead.
  const healthy = repair([
    { role: 'user', content: 'mute the hats' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_A', name: 'set_track', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_A', content: 'Hats muted.' }] },
  ])
  check('a real tool_use/tool_result pair is left alone',
    healthy.length === 3 && healthy[2].content.length === 1)

  // And the cap's failure mode: the assistant turn gone, its result stranded.
  const trimmed = repair([
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_GONE', content: 'done' }] },
    { role: 'user', content: 'and solo the bass' },
  ])
  check('a result stranded by the history cap is dropped with its message',
    trimmed.length === 1 && trimmed[0].content === 'and solo the bass')
}

console.log(failures ? `\n${failures} failing` : '\nthe conversation is always well-formed')
assert.equal(failures, 0)
