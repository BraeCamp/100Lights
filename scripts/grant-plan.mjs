#!/usr/bin/env node
// Put an account on a plan without Stripe.
//
//   node scripts/grant-plan.mjs <email> <free|pro|studio|max> [--until=2027-01-01] [--local]
//
// Brae: "You can just put my plan as the highest and I'll do it manually."
//
// Uses the GIFT columns rather than writing a fake Stripe subscription, because
// that is what they are for: getSubscription gives an active gift precedence
// over everything else, and a gift with no expiry never lapses. Writing plan =
// 'max' directly would work until the next Stripe webhook overwrote it with
// whatever Stripe believes, which is nothing.
//
// Production by default, because that is where the account is. --local for the
// other one.

import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const PLANS = ['free', 'pro', 'studio', 'max']
const args = process.argv.slice(2)
const flag = n => args.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const positional = args.filter(a => !a.startsWith('--'))
const email = positional[0]
const plan = positional[1]
const until = flag('until') ?? null
const local = args.includes('--local')

if (!email || !PLANS.includes(plan)) {
  console.error(`usage: node scripts/grant-plan.mjs <email> <${PLANS.join('|')}> [--until=YYYY-MM-DD] [--local]`)
  process.exit(2)
}

// Secrets from .env.local rather than the command line, where they would end up
// in shell history and in session output.
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const clerkKey = env.CLERK_SECRET_KEY
const dbUrl = local ? env.DATABASE_URL : (env.PROD_DATABASE_URL || env.DATABASE_URL)
if (!clerkKey) { console.error('no CLERK_SECRET_KEY in .env.local'); process.exit(1) }
if (!dbUrl) { console.error('no database url in .env.local'); process.exit(1) }
console.log(`database: ${local ? 'LOCAL' : 'PRODUCTION'}`)

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
// No CREATE TABLE here. The table is created by the app and its real shape is
// not the obvious one — stripe_customer_id is NOT NULL with no default, which a
// hand-written CREATE got wrong and an INSERT then tripped over. Writing to a
// table this important means reading its actual columns first, not guessing
// them from what the code appears to use.

const before = await sql`SELECT plan, gift_plan, gift_until FROM subscriptions WHERE user_id = ${userId}`
const had = before[0]
console.log(`before:   plan=${had?.plan ?? '(no row)'} gift=${had?.gift_plan ?? 'none'}${had?.gift_until ? ` until ${String(had.gift_until).slice(0, 10)}` : ''}`)

if (had) {
  await sql`
    UPDATE subscriptions SET gift_plan = ${plan}, gift_until = ${until}, updated_at = NOW()
    WHERE user_id = ${userId}`
} else {
  // stripe_customer_id is NOT NULL and this account has never been to Stripe,
  // so it is marked rather than faked: a made-up customer id would look real to
  // the next person reading the table, and to any code that tries to use it.
  await sql`
    INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status, gift_plan, gift_until)
    VALUES (${userId}, ${'gift-no-stripe'}, 'free', 'active', ${plan}, ${until})`
}

const after = await sql`SELECT plan, gift_plan, gift_until FROM subscriptions WHERE user_id = ${userId}`
const now = after[0]
console.log(`after:    plan=${now?.plan} gift=${now?.gift_plan}${now?.gift_until ? ` until ${String(now.gift_until).slice(0, 10)}` : ' (no expiry)'}`)
console.log(`\ngetSubscription will report "${plan}" — an active gift outranks Stripe and codes.`)
