#!/usr/bin/env node
/**
 * Gifting any paid tier, and any credit tier, from the admin menu.
 *
 *   node --experimental-strip-types scripts/check-admin-gift.mjs
 *
 * Brae: "We also need to change the Admin menu so that I can gift any of the
 * existing paid Tiers."
 *
 * It could gift Pro and nothing else. The route rejected everything else
 * outright — `plan must be 'pro' or null` — so Studio and Max had existed in
 * the tier table for a while with no way to put anybody on one except a script.
 *
 * The route needs a signed-in admin, so what runs here is the part that can be
 * checked without one and is where the bug actually lived: the validation, and
 * whether the menu is built from the tier tables or from a hand-written list
 * that will go stale the next time a tier is added.
 */

import { readFileSync } from 'node:fs'
import { importTs } from './lib/ts-import.mjs'

const { PAID_PLANS, PLAN_LABEL } = await importTs('lib/entitlements.ts')
const { CREDIT_TIERS } = await importTs('lib/credit-tiers.ts')

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? `  ${detail}` : ''}`)
  if (!ok) failures++
}

const route = readFileSync('app/api/admin/gift/route.ts', 'utf8')
const panel = readFileSync('app/(app)/admin/UsersPanel.tsx', 'utf8')

console.log('THE ROUTE NO LONGER KNOWS ONLY ONE PLAN')
check('it does not hard-code the one plan any more',
  !/plan\s*!==\s*'pro'/.test(route), "the old `plan !== 'pro'` guard")
check('it validates against the shared list instead',
  /PAID_PLANS/.test(route))
check('and there is more than one paid plan to offer',
  PAID_PLANS.length > 1, PAID_PLANS.join(', '))
check('every paid plan has a label to show',
  PAID_PLANS.every(p => !!PLAN_LABEL[p]), PAID_PLANS.map(p => PLAN_LABEL[p]).join(', '))

console.log('\nAND IT CAN GIFT A CREDIT TIER')
check('the route accepts a tier', /\btier\b/.test(route))
check('it grants it the same way the Stripe webhook does',
  /applyTierGrant/.test(route), 'rather than writing user_credits by hand')
check('free is not giftable as a tier',
  /tier === 'free'/.test(route), 'gifting "free" would be a no-op that looks like a grant')
check('the paid tiers are the ones people are sold',
  Object.keys(CREDIT_TIERS).filter(t => t !== 'free').length === 3,
  Object.entries(CREDIT_TIERS).filter(([t]) => t !== 'free').map(([, v]) => v.label).join(', '))

console.log('\nTHE MENU IS BUILT FROM THE TABLES, NOT RETYPED')
// This is the part that decides whether the next tier appears by itself or
// waits for somebody to remember this file — which is exactly how Studio and
// Max came to be ungiftable in the first place.
check('the plan buttons come from PAID_PLANS', /PAID_PLANS\.map/.test(panel))
check('the tier items come from CREDIT_TIERS', /CREDIT_TIERS\)/.test(panel))
check('no hand-written "Gift Pro" list survives',
  !/Gift Pro — 7 days/.test(panel))
check('the custom-days box gifts the CHOSEN plan',
  !/applyGift\(ctx\.user\.userId, 'pro'/.test(panel),
  "it used to send 'pro' whatever was selected")

console.log(failures ? `\n${failures} failing` : '\nany paid plan, and any credit tier, from the menu')
process.exit(failures ? 1 : 0)
