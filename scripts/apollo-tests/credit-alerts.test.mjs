#!/usr/bin/env node
// Warning someone before the credits run out.
//
//   node --experimental-strip-types scripts/apollo-tests/credit-alerts.test.mjs
//
// Brae: "a notification when they hit 50%, 75%, 90%, and 100% of their allowed
// balance used."
//
// Threshold logic has two classic failures and both are bad in opposite ways:
// firing on every call that stays above a mark (so people learn to ignore it),
// and firing once ever (so a topped-up account is never warned again). Most of
// what is asserted here is about not repeating, and about resetting when the
// allowance does.

import assert from 'node:assert'
import { importTs } from '../lib/ts-import.mjs'

const { creditAlertFor, shouldResetAlerts, CREDIT_ALERT_LEVELS } =
  await importTs('lib/credit-alerts.ts')

let failures = 0
const check = (label, pass, extra = '') => {
  if (!pass) failures++
  console.log(`${pass ? 'PASS' : 'FAIL'} ${label}${extra ? '  ' + extra : ''}`)
}

const GRANT = 10_000
const at = (balanceAfter, alreadyReported = 0) =>
  creditAlertFor({ balanceBefore: balanceAfter, balanceAfter, monthlyGrant: GRANT, alreadyReported })

check('the levels are the four asked for',
  CREDIT_ALERT_LEVELS.join(',') === '50,75,90,100', CREDIT_ALERT_LEVELS.join(','))

// ── Each mark, on the way down ──────────────────────────────────────────────
check('nothing at 40% used', at(6_000) === null)
check('50% used fires', at(5_000)?.level === 50, String(at(5_000)?.level))
check('75% used fires', at(2_500, 50)?.level === 75, String(at(2_500, 50)?.level))
check('90% used fires', at(1_000, 75)?.level === 90, String(at(1_000, 75)?.level))
check('empty fires 100', at(0, 90)?.level === 100, String(at(0, 90)?.level))

// ── Not repeating, which is what makes it worth reading ────────────────────
check('the same level does not fire twice', at(4_900, 50) === null)
check('nor does a lower one once a higher is reported', at(4_000, 90) === null)

// A single large spend should announce the level it REACHED, not every level
// it passed — four notifications for one command is how a warning gets muted.
const big = at(500, 0)
check('one big spend reports the highest level reached, once', big?.level === 90,
  String(big?.level))

// ── Resetting when the allowance does ──────────────────────────────────────
check('a top-up means the marks can speak again', shouldResetAlerts(500, 10_500) === true)
check('but spending is not a reset', shouldResetAlerts(5_000, 4_000) === false)
check('after a reset, 50% fires again', at(5_000, 0)?.level === 50)

// ── The denominator has to exist ───────────────────────────────────────────
check('no monthly allowance means no percentage to report',
  creditAlertFor({ balanceBefore: 100, balanceAfter: 0, monthlyGrant: 0, alreadyReported: 0 }) === null)
check('a negative balance is still 100%, not more',
  creditAlertFor({ balanceBefore: 10, balanceAfter: -50, monthlyGrant: GRANT, alreadyReported: 90 })?.usedPct === 100)

// ── What it actually says ──────────────────────────────────────────────────
check('the message names what is left', /5,000/.test(at(5_000)?.message ?? ''), at(5_000)?.message)
check('and at 100% says what still works',
  /still works/i.test(at(0, 90)?.message ?? ''), at(0, 90)?.message)
check('90% suggests acting before it bites',
  /top up/i.test(at(1_000, 75)?.message ?? ''), at(1_000, 75)?.message)

console.log(failures
  ? `\n${failures} failing`
  : '\neach threshold is announced once, and again after a top-up')
assert.equal(failures, 0)
