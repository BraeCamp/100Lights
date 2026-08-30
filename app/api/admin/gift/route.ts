import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { logAdmin } from '@/lib/admin-audit'
import { PAID_PLANS, type Plan } from '@/lib/entitlements'
import { applyTierGrant } from '@/lib/credits'
import { CREDIT_TIERS, type CreditTier } from '@/lib/credit-tiers'

export const runtime = 'nodejs'

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
  if (plan === null || plan === undefined) {
    // Remove gift entirely
    rows = await sql`
      UPDATE subscriptions
      SET gift_plan = NULL, gift_until = NULL, updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING user_id
    `
  } else if (days === null || days === undefined) {
    // Indefinite gift
    rows = await sql`
      UPDATE subscriptions
      SET gift_plan = ${plan}, gift_until = NULL, updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING user_id
    `
  } else {
    // Timed gift — extend from the later of NOW() and the current gift_until
    rows = await sql`
      UPDATE subscriptions
      SET gift_plan  = ${plan},
          gift_until = GREATEST(NOW(), COALESCE(gift_until, NOW())) + (${days}::int * INTERVAL '1 day'),
          updated_at = NOW()
      WHERE user_id = ${userId}
      RETURNING user_id
    `
  }

  // No row updated → this user has no subscriptions record (e.g. the Clerk
  // signup webhook never created one). Surface it instead of a false success.
  if (rows.length === 0) {
    return Response.json({ error: 'No subscription record for this user yet — they need to sign in once so their account is provisioned.' }, { status: 404 })
  }

  await logAdmin(plan ? 'gift.grant' : 'gift.remove', userId, plan ? { plan, days: days ?? 'indefinite' } : undefined)
  return Response.json({ ok: true })
}
