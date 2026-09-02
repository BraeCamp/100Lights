#!/usr/bin/env node
// What every command cost, and what it did not.
//
//   node --experimental-strip-types scripts/apollo-tests/voice-ledger.test.mjs
//
// Brae: "Give an option in voice control settings to see a log with lumens and
// macros used, amounts of calls, costs per call, stuff like that".
//
// ⚠️ A READ-OUT THAT DISAGREES WITH THE INVOICE IS WORSE THAN NO READ-OUT. The
// panel weighs a cache read and a cache write exactly as the assist route does
// when it charges for them, and this is what keeps the two tables from drifting
// apart quietly.

import assert from 'node:assert'
import { readFileSync } from 'node:fs'
import { importTs } from '../lib/ts-import.mjs'

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const { costOf, recordCommand, ledgerSummary, clearLedger, ledger } =
  await importTs('lib/voice/voice-ledger.ts')

// ── the money agrees with the server ───────────────────────────────────────
{
  const route = readFileSync('app/api/ai/assist/route.ts', 'utf8')
  check('the route weighs a write at 1.25 and a read at a tenth',
    /cacheWriteTokens \* 1\.25 \+ u\.cacheReadTokens \* 0\.1/.test(route))
  check('and it hands the token counts back, not just a price',
    /usage: \{[\s\S]{0,160}cacheRead: u\.cacheReadTokens/.test(route))

  // The same shape the panel will be given for a real turn.
  const usd = costOf({ tokensIn: 300, tokensOut: 250, cacheRead: 13900, cacheWrite: 0 })
  const expected = (300 + 13900 * 0.1) * (3 / 1e6) + 250 * (15 / 1e6)
  check('a warm-cache turn is priced the same way', Math.abs(usd - expected) < 1e-12,
    `$${usd.toFixed(6)}`)
  // ⚠️ A cache WRITE is the expensive turn, and it must not read as cheap.
  const cold = costOf({ tokensIn: 300, tokensOut: 250, cacheRead: 0, cacheWrite: 13900 })
  check('and a cold one costs more than a warm one', cold > usd * 4, `$${cold.toFixed(4)} vs $${usd.toFixed(4)}`)
}

// ── free commands are counted, which is the whole point ────────────────────
{
  clearLedger()
  recordCommand({ said: 'stop', by: 'rules' })
  recordCommand({ said: 'mute the pad', by: 'learned' })
  recordCommand({ said: 'solo the bass', by: 'shared' })
  recordCommand({ said: 'make the pad warmer', by: 'assistant', turns: 2, tokensIn: 300, tokensOut: 250, cacheRead: 13900, credits: 4 })

  const s = ledgerSummary()
  check('every command is logged, not only the paid ones', s.total === 4, String(s.total))
  check('free and paid are counted apart', s.free === 3 && s.paid === 1, `${s.free} free / ${s.paid} paid`)
  check('the three free paths are told apart',
    s.byPath.rules === 1 && s.byPath.learned === 1 && s.byPath.shared === 1,
    JSON.stringify(s.byPath))
  check('only the assistant costs anything', s.usd > 0 && Math.abs(s.usd - s.perPaid) < 1e-12)
  check('lumens are carried through', s.credits === 4)
  check('turns are added up across the exchange', s.turns === 2)

  // ⚠️ Valued at what a command ACTUALLY cost here, never at a list price.
  check('the saving is the free commands at the measured rate',
    Math.abs(s.saved - 3 * s.perPaid) < 1e-12, `$${s.saved.toFixed(4)}`)

  check('the newest command is first, which is how a log is read',
    ledger()[0].said === 'make the pad warmer')
}

// ── nothing paid yet means no rate to guess with ───────────────────────────
{
  clearLedger()
  recordCommand({ said: 'stop', by: 'rules' })
  const s = ledgerSummary()
  check('with nothing paid, the saving is zero rather than invented',
    s.saved === 0 && s.perPaid === 0)
}

console.log(failures ? `\n${failures} failing` : '\nthe log agrees with the invoice')
assert.equal(failures, 0)
