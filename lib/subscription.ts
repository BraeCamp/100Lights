import { currentUser } from '@clerk/nextjs/server'
import { isAdminAddress } from '@/lib/admin-email'
import { sql } from '@/lib/db'
import { ensureSchema } from '@/lib/schema-version'
import { PLANS } from '@/lib/stripe'
import { getCodeGrantUntil } from '@/lib/codes'

// Re-exported, not redeclared. Two copies of this union is how a third tier
// gets added in one file and silently ignored in the other.
export type { Plan } from '@/lib/entitlements'
import type { Plan } from '@/lib/entitlements'

// Ensure `created_at` exists so admin "new signups this week/month" can count
// real account creations rather than `updated_at` (which every gift, plan
// change, and webhook bumps). Added nullable + default (no table rewrite),
// then existing rows are backfilled to their `updated_at` — the best available
// proxy for pre-migration signups; new rows get NOW() via the default.
// This is the worst of the cold-start schema checks, because the third statement
// is not a catalog question at all — it is a scan and a write over the whole
// subscriptions table, run again on every cold start to backfill rows that were
// already backfilled the first time. Behind a version stamp it happens once per
// deploy instead. Bump the version if the backfill ever needs to run again.
export async function ensureSubscriptionsSchema() {
  await ensureSchema('subscriptions', 1, async () => {
    await sql`ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ`
    await sql`ALTER TABLE subscriptions ALTER COLUMN created_at SET DEFAULT NOW()`
    await sql`UPDATE subscriptions SET created_at = updated_at WHERE created_at IS NULL`
  })
}

export interface Subscription {
  /** Effective plan — already accounts for any active admin gift or redeemed code */
  plan: Plan
  status: string
  stripeCustomerId: string | null
  stripeSubId: string | null
  currentPeriodEnd: Date | null
  giftPlan: Plan | null
  giftUntil: Date | null
  /** End of Pro access granted by a redeemed code, or null if none active */
  codeUntil: Date | null
}

/**
 * Is this the owner's own account, asking about itself?
 *
 * ⚠️ Brae: "It now says that I have 0 Lumens and that I don't have the highest
 * tier. I should have that off the bat."
 *
 * Quite right, and the reason it was not true is worth keeping: the owner's
 * plan lived in a database ROW, granted by hand. A row is per-database, so it
 * is correct in whichever one it was written to and absent everywhere else —
 * and it is silently absent, because a missing row is indistinguishable from a
 * free account. Preview deployments, a restored branch, a new database: each
 * one starts the owner back at nothing.
 *
 * The owner's entitlement is not data, it is a fact about who is signed in. So
 * it is decided in code, where it is true in every environment at once.
 *
 * ⚠️ Compared against the SIGNED-IN user, never the argument alone. This is
 * also called for other people (the admin panel lists them), and an override
 * keyed only on the id being asked about would hand everyone the owner's plan.
 */
export async function isOwnerAccount(userId: string): Promise<boolean> {
  try {
    const u = await currentUser()
    return !!u && u.id === userId
      && isAdminAddress(u.emailAddresses?.[0]?.emailAddress)
  } catch {
    // No request context (a webhook, a script) — there is no signed-in owner.
    return false
  }
}

export async function getSubscription(userId: string): Promise<Subscription> {
  // Run the code-grant lookup concurrently so it adds no latency; it is
  // fault-tolerant (returns null if its table isn't provisioned yet).
  const [rows, codeUntil] = await Promise.all([
    sql`
      SELECT plan, status, stripe_customer_id, stripe_sub_id, current_period_end,
             gift_plan, gift_until
      FROM subscriptions
      WHERE user_id = ${userId}
    `,
    getCodeGrantUntil(userId),
  ])
  if (rows.length === 0) {
    // No Stripe/subscription row yet — a redeemed code can still grant Pro, and
    // the owner is on the top plan whether or not this database has heard of
    // them. THIS is the branch that was reporting the owner as free.
    const owner = await isOwnerAccount(userId)
    return { plan: owner ? 'max' : codeUntil ? 'pro' : 'free', status: 'active', stripeCustomerId: null,
             stripeSubId: null, currentPeriodEnd: null, giftPlan: null, giftUntil: null, codeUntil }
  }
  const r = rows[0]
  const giftPlan = r.gift_plan ? (r.gift_plan as Plan) : null
  const giftUntil = r.gift_until ? new Date(r.gift_until as string) : null
  const hasActiveGift = giftPlan && (giftUntil === null || giftUntil > new Date())
  // Precedence: an active admin gift, then an active redeemed code, then Stripe.
  // Gift and code both grant 'pro'; getCodeGrantUntil already filters to future.
  let plan: Plan = hasActiveGift ? giftPlan! : (codeUntil ? 'pro' : (r.plan as Plan))
  // The owner outranks every row, including a stale or missing one.
  if (await isOwnerAccount(userId)) plan = 'max'
  return {
    plan,
    status: r.status as string,
    stripeCustomerId: r.stripe_customer_id as string | null,
    stripeSubId: r.stripe_sub_id as string | null,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end as string) : null,
    giftPlan,
    giftUntil,
    codeUntil,
  }
}

export function getPlanLimits(plan: Plan) {
  // Per plan, not "pro or not". The binary version handed a Max subscriber the
  // FREE limits the moment a tier above pro existed.
  return PLANS[plan] ?? PLANS.free
}

export async function upsertSubscription(params: {
  userId: string
  stripeCustomerId: string
  stripeSubId?: string
  plan: Plan
  status: string
  currentPeriodEnd?: Date
}) {
  await sql`
    INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_sub_id, plan, status, current_period_end, updated_at)
    VALUES (
      ${params.userId},
      ${params.stripeCustomerId},
      ${params.stripeSubId ?? null},
      ${params.plan},
      ${params.status},
      ${params.currentPeriodEnd?.toISOString() ?? null},
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_customer_id = EXCLUDED.stripe_customer_id,
      stripe_sub_id      = EXCLUDED.stripe_sub_id,
      plan               = EXCLUDED.plan,
      status             = EXCLUDED.status,
      current_period_end = EXCLUDED.current_period_end,
      updated_at         = NOW()
  `
}
