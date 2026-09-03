#!/usr/bin/env node
// Give an account AI credits.
//
//   node scripts/grant-credits.mjs <email> <amount> [--reason="..."] [--local]
//
// Brae: "The balance is only empty from my account. Can you allow me some
// credits in braedancampbell@gmail.com, please?"
//
// Credits gate the assistant (CREDITS_ENABLED is on in production), so an empty
// balance means every AI-path voice command fails there regardless of the
// Anthropic key. There was no way to top an account up outside of Stripe, which
// is fine for customers and useless for the person who owns the studio and
// needs to test it.
//
// Writes to the PRODUCTION database by default, because that is where the
// account being tested lives — DATABASE_URL is the local one and granting there
// would look like it worked and change nothing. `--local` for the other.
//
// The write is the same one the Stripe webhook makes: add to user_credits and
// append a row to credit_ledger, so the grant is auditable next to every other
// movement rather than being an unexplained balance.

import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

const args = process.argv.slice(2)
const flag = n => args.find(a => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=')
const positional = args.filter(a => !a.startsWith('--'))
const email = positional[0]
const amount = Number(positional[1])
const local = args.includes('--local')
const reason = flag('reason') ?? 'manual grant (owner)'

if (!email || !Number.isFinite(amount) || amount <= 0) {
  console.error('usage: node scripts/grant-credits.mjs <email> <amount> [--reason="..."] [--local]')
  process.exit(2)
}

// Read secrets from .env.local rather than taking them on the command line,
// where they would end up in shell history and in session output.
const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter(l => /^[A-Z_]+=/.test(l))
    .map(l => {
      const i = l.indexOf('=')
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]
    }),
)

const clerkKey = env.CLERK_SECRET_KEY
const dbUrl = local ? env.DATABASE_URL : (env.PROD_DATABASE_URL || env.DATABASE_URL)
if (!clerkKey) { console.error('no CLERK_SECRET_KEY in .env.local'); process.exit(1) }
if (!dbUrl) { console.error('no database url in .env.local'); process.exit(1) }
console.log(`database: ${local ? 'LOCAL' : 'PRODUCTION'}`)

// ── Who is this? ────────────────────────────────────────────────────────────
// The credits table is keyed by Clerk user id, and an email is what a person
// knows. Resolving it here means the id never has to be looked up by hand and
// pasted, which is where a wrong-account grant would come from.
const res = await fetch(
  `https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`,
  { headers: { Authorization: `Bearer ${clerkKey}` } },
)
if (!res.ok) {
  console.error(`Clerk lookup failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
  process.exit(1)
}
const users = await res.json()
if (!Array.isArray(users) || !users.length) {
  console.error(`No Clerk user with the email ${email}`)
  process.exit(1)
}
if (users.length > 1) {
  console.error(`${users.length} users share that email — refusing to guess which.`)
  process.exit(1)
}
const user = users[0]
const userId = user.id
console.log(`user:     ${userId}  (${user.email_addresses?.[0]?.email_address ?? email})`)

// ── Grant ───────────────────────────────────────────────────────────────────
const sql = neon(dbUrl)

// The tables are created lazily by the app, so a brand-new database may not
// have them yet. Same shape as lib/credits.ts.
await sql`
  CREATE TABLE IF NOT EXISTS user_credits (
    user_id              TEXT PRIMARY KEY,
    balance              INTEGER NOT NULL DEFAULT 0,
    monthly_grant        INTEGER NOT NULL DEFAULT 0,
    cycle_start          TIMESTAMPTZ,
    free_transcribe_used INTEGER NOT NULL DEFAULT 0,
    free_cycle_start     TIMESTAMPTZ,
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`

const before = await sql`SELECT balance FROM user_credits WHERE user_id = ${userId}`
const had = before[0]?.balance ?? 0

await sql`
  INSERT INTO user_credits (user_id, balance) VALUES (${userId}, ${amount})
  ON CONFLICT (user_id) DO UPDATE
    SET balance = user_credits.balance + ${amount}, updated_at = NOW()`

// Audit row, best-effort exactly as the app treats it — a grant that lands but
// is not recorded is better than a grant that fails because the log did.
try {
  await sql`
    INSERT INTO credit_ledger (id, user_id, delta, reason)
    VALUES (${crypto.randomUUID()}, ${userId}, ${amount}, ${reason})`
} catch (e) {
  console.log(`  (ledger row not written: ${e.message.slice(0, 80)})`)
}

const after = await sql`SELECT balance FROM user_credits WHERE user_id = ${userId}`
console.log(`balance:  ${had} → ${after[0]?.balance ?? '?'}   (+${amount}, "${reason}")`)
