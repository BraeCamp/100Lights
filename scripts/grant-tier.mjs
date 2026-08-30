#!/usr/bin/env node
// Put an account on a credit tier — Spark, Glow or Beam — without Stripe.
//
//   node scripts/grant-tier.mjs <email> <spark|glow|beam|free> [--local]
//
// Brae: "Change braedancampbell@gmail.com so that it has the Beam
// subscription, please?"
//
// ⚠️ A credit TIER is not a membership PLAN, and the two are easy to confuse
// because both are "subscriptions" in ordinary speech:
//
//   scripts/grant-plan.mjs   free / pro / studio / max — what FEATURES are
//                            unlocked (lib/entitlements.ts, subscriptions table)
//   this                     Spark / Glow / Beam — how many LUMENS arrive each
//                            month (lib/credit-tiers.ts, user_credits table)
//
// Somebody can be on Max with no credit tier, which is exactly what this
// account was: every feature unlocked, and a balance that was a one-off gift
// rather than a monthly allotment.
//
// The tier is not stored as a name anywhere. It IS `monthly_grant` — the size
// of the allotment is what identifies the tier — so setting the tier means
// setting that number, which is what the Stripe webhook does through
// applyTierGrant(). This makes the same write, including the ledger row, so
// the grant is auditable next to every other movement.
//
// Production by default, because that is where the account is. --local for the
// other one.

import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

// The labels people see, mapped to the keys Stripe and the database use. Kept
// in step with lib/credit-tiers.ts by the check below rather than by hope.
const BY_LABEL = { free: 'free', spark: 'starter', glow: 'creator', beam: 'pro' }

const args = process.argv.slice(2)
const positional = args.filter(a => !a.startsWith('--'))
const email = positional[0]
const asked = (positional[1] ?? '').toLowerCase()
const local = args.includes('--local')
const tier = BY_LABEL[asked]

if (!email || !tier) {
  console.error(`usage: node scripts/grant-tier.mjs <email> <${Object.keys(BY_LABEL).join('|')}> [--local]`)
  process.exit(2)
}

// ── The numbers come from the app, never from here ──────────────────────────
//
// Restating 600,000 in this file would be a second copy of a figure that only
// means anything if it matches the one the app bills against — and it would go
// stale silently the first time a tier was repriced.
const tiersSrc = readFileSync('lib/credit-tiers.ts', 'utf8')
const block = tiersSrc.match(new RegExp(`\\b${tier}:\\s*\\{([^}]*)\\}`))
const grant = Number(block?.[1].match(/monthlyCredits:\s*([\d_]+)/)?.[1].replace(/_/g, ''))
const label = block?.[1].match(/label:\s*'([^']+)'/)?.[1]
if (!Number.isFinite(grant) || !label) {
  console.error(`could not read the ${tier} tier out of lib/credit-tiers.ts — has it been restructured?`)
  process.exit(1)
}
if (label.toLowerCase() !== asked) {
  console.error(`lib/credit-tiers.ts calls '${tier}' "${label}", not "${asked}" — refusing to guess.`)
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => /^[A-Z0-9_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const clerkKey = env.CLERK_SECRET_KEY
const dbUrl = local ? env.DATABASE_URL : (env.PROD_DATABASE_URL || env.DATABASE_URL)
if (!clerkKey) { console.error('no CLERK_SECRET_KEY in .env.local'); process.exit(1) }
if (!dbUrl) { console.error('no database url in .env.local'); process.exit(1) }
console.log(`database: ${local ? 'LOCAL' : 'PRODUCTION'}`)
console.log(`tier:     ${label} (${tier}) — ${grant.toLocaleString()} Lumens a month`)

// An email is what a person knows; the table is keyed by Clerk id.
const res = await fetch(
  `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
  { headers: { Authorization: `Bearer ${clerkKey}` } },
)
if (!res.ok) {
  console.error(`Clerk lookup failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  process.exit(1)
}
const users = await res.json()
if (!Array.isArray(users) || !users.length) { console.error(`No Clerk user with the email ${email}`); process.exit(1) }
if (users.length > 1) { console.error(`${users.length} users share that email — refusing to guess which.`); process.exit(1) }
const userId = users[0].id
console.log(`user:     ${userId}  (${email})`)

const sql = neon(dbUrl)

const before = await sql`SELECT balance, monthly_grant FROM user_credits WHERE user_id = ${userId}`
console.log(`before:   balance=${before[0]?.balance ?? '(no row)'} monthly=${before[0]?.monthly_grant ?? 0}`)

// The same write applyTierGrant makes: set the allotment, add this cycle's
// worth, and start the cycle now.
await sql`
  INSERT INTO user_credits (user_id, balance, monthly_grant, cycle_start)
  VALUES (${userId}, ${grant}, ${grant}, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    balance = user_credits.balance + ${grant},
    monthly_grant = ${grant},
    cycle_start = NOW(),
    updated_at = NOW()`
// More credits mean the usage warnings should be able to speak again — without
// this, an account that was near its limit stays permanently past its "90%
// used" mark and is never warned on the new cycle.
try { await sql`UPDATE user_credits SET alert_level = 0 WHERE user_id = ${userId}` } catch { /* courtesy */ }
try {
  await sql`
    INSERT INTO credit_ledger (user_id, delta, reason)
    VALUES (${userId}, ${grant}, ${`monthly grant (${tier})`})`
} catch { /* the ledger is an audit trail, not a gate */ }

const after = await sql`SELECT balance, monthly_grant, cycle_start FROM user_credits WHERE user_id = ${userId}`
const now = after[0]
console.log(`after:    balance=${Number(now.balance).toLocaleString()} monthly=${Number(now.monthly_grant).toLocaleString()}`)
console.log(`\nOn ${label}. ${grant.toLocaleString()} Lumens arrive each cycle — about $${(grant / 5000).toFixed(0)} of AI at 5,000 per dollar.`)
console.log('⚠️  This is the credit tier only. Feature access is the membership plan;')
console.log('    check it with scripts/grant-plan.mjs if that is what was meant.')
