import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { logAdmin } from '@/lib/admin-audit'
import { PAID_PLANS, type Plan } from '@/lib/entitlements'
import { applyTierGrant } from '@/lib/credits'
import { CREDIT_TIERS, type CreditTier } from '@/lib/credit-tiers'

export const runtime = 'nodejs'

/**
 * What a gifted account has instead of a Stripe customer.
 *
 * ⚠️ stripe_customer_id is NOT NULL with no default, so an INSERT that leaves it
 * out fails with 23502 — which reached the admin menu as a bare HTTP 500 and
 * said nothing at all. The Stripe webhook never hit this because it always has a
 * real customer id; a gift, by definition, does not.
 *
 * This exact string is already in the table on the accounts that were gifted
 * before, so it is the existing convention rather than a new one.
 *
 * ⚠️ ON INSERT ONLY. The DO UPDATE branches deliberately leave the column alone:
 * writing this over a REAL customer id would sever a paying subscriber from
 * their Stripe record, and the gift would have quietly broken their billing.
 */
const NO_STRIPE = 'gift-no-stripe'

export async function POST(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    userId?: string
    plan?: string | null
    days?: number | null
    tier?: string | null
  }
  const { userId, plan, days, tier } = body

  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

  // ── A credit tier is a different gift from a plan ────────────────────────
  //
  // Brae: "We also need to change the Admin menu so that I can gift any of the
  // existing paid Tiers."
  //
  // Two things are called a subscription in ordinary speech and they are
  // separate axes:
  //
  //   plan   free / pro / studio / max — what FEATURES are unlocked
  //   tier   Spark / Glow / Beam — how many LUMENS arrive each month
  //
  // Somebody can hold one without the other, and that is not a bug — it is how
  // this account was set up. Handled first because it is a different table and
  // shares nothing with the plan logic below.
  if (tier) {
    if (!Object.hasOwn(CREDIT_TIERS, tier) || tier === 'free') {
      return Response.json(
        { error: `tier must be one of ${Object.keys(CREDIT_TIERS).filter(t => t !== 'free').join(', ')}` },
        { status: 400 },
      )
    }
    await applyTierGrant(userId, tier as CreditTier)
    const t = CREDIT_TIERS[tier as CreditTier]
    await logAdmin('gift.tier', userId, { tier, label: t.label, credits: t.monthlyCredits })
    return Response.json({ ok: true, tier, label: t.label, credits: t.monthlyCredits })
  }

  // ── The plan ─────────────────────────────────────────────────────────────
  //
  // This used to accept 'pro' and nothing else, which quietly made three of the
  // four tiers ungiftable: the tier table has had Studio and Max for a while
  // and the only way to put anybody on one was a script. Validated against
  // PAID_PLANS rather than a literal, so a tier added there is giftable the
  // same day rather than the day somebody remembers this file exists.
  if (plan !== null && plan !== undefined && !(PAID_PLANS as readonly string[]).includes(plan)) {
    return Response.json(
      { error: `plan must be null or one of ${PAID_PLANS.join(', ')}` },
      { status: 400 },
    )
  }
  void (plan as Plan | null | undefined)

  let rows: Record<string, unknown>[]
  try {
  if (plan === null || plan === undefined) {
    // Remove gift entirely
    rows = await sql`
      UPDATE subscriptions
      SET gift_plan = NULL, gift_until = NULL, updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING user_id
    `
  } else if (days === null || days === undefined) {
    // ── Indefinite gift ───────────────────────────────────────────────────
    //
    // ⚠️ INSERT, not UPDATE. A plain UPDATE matches nothing when the account
    // has no subscriptions row, and plenty of real accounts have none: the row
    // is written by the Clerk signup webhook, so anybody who signed up while it
    // was misconfigured, or before it existed, or on a database restored
    // without it, simply has no row. Gifting them failed with "they need to
    // sign in once so their account is provisioned" — advice that cannot work,
    // because signing in again does not create it either. The gift is the
    // moment we know what the row should say, so it writes one.
    rows = await sql`
      INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status, gift_plan, gift_until, updated_at)
      VALUES (${userId}, ${NO_STRIPE}, 'free', 'active', ${plan}, NULL, NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET gift_plan = ${plan}, gift_until = NULL, updated_at = NOW()
      RETURNING user_id
    `
  } else {
    // Timed gift — extend from the later of NOW() and the current gift_until,
    // and create the row the same way if it is not there.
    rows = await sql`
      INSERT INTO subscriptions (user_id, stripe_customer_id, plan, status, gift_plan, gift_until, updated_at)
      VALUES (${userId}, ${NO_STRIPE}, 'free', 'active', ${plan}, NOW() + (${days}::int * INTERVAL '1 day'), NOW())
      ON CONFLICT (user_id) DO UPDATE
        SET gift_plan  = ${plan},
            gift_until = GREATEST(NOW(), COALESCE(subscriptions.gift_until, NOW())) + (${days}::int * INTERVAL '1 day'),
            updated_at = NOW()
      RETURNING user_id
    `
  }

  } catch (err) {
    // ⚠️ SAY WHAT WENT WRONG. This threw before and Next answered with a bare
    // 500, so the admin menu showed "HTTP 500" and there was nothing to act on —
    // the database had given a perfectly clear reason and nobody could see it.
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[gift] failed for', userId, msg)
    return Response.json({ error: `Could not write the gift: ${msg}` }, { status: 500 })
  }

  // Removing a gift from an account that has no row is already the state being
  // asked for; the two branches above can no longer come back empty.
  if (rows.length === 0 && plan != null) {
    return Response.json({ error: 'Could not write the gift for this user.' }, { status: 500 })
  }

  await logAdmin(plan ? 'gift.grant' : 'gift.remove', userId, plan ? { plan, days: days ?? 'indefinite' } : undefined)
  return Response.json({ ok: true })
}
