import { sql } from '@/lib/db'
import { PLANS } from '@/lib/stripe'

export type Plan = 'free' | 'pro'

export interface Subscription {
  /** Effective plan — already accounts for any active admin gift */
  plan: Plan
  status: string
  stripeCustomerId: string | null
  stripeSubId: string | null
  currentPeriodEnd: Date | null
  giftPlan: Plan | null
  giftUntil: Date | null
}

export async function getSubscription(userId: string): Promise<Subscription> {
  const rows = await sql`
    SELECT plan, status, stripe_customer_id, stripe_sub_id, current_period_end,
           gift_plan, gift_until
    FROM subscriptions
    WHERE user_id = ${userId}
  `
  if (rows.length === 0) {
    return { plan: 'free', status: 'active', stripeCustomerId: null, stripeSubId: null,
             currentPeriodEnd: null, giftPlan: null, giftUntil: null }
  }
  const r = rows[0]
  const giftPlan = r.gift_plan ? (r.gift_plan as Plan) : null
  const giftUntil = r.gift_until ? new Date(r.gift_until as string) : null
  const hasActiveGift = giftPlan && (giftUntil === null || giftUntil > new Date())
  return {
    plan: hasActiveGift ? giftPlan! : (r.plan as Plan),
    status: r.status as string,
    stripeCustomerId: r.stripe_customer_id as string | null,
    stripeSubId: r.stripe_sub_id as string | null,
    currentPeriodEnd: r.current_period_end ? new Date(r.current_period_end as string) : null,
    giftPlan,
    giftUntil,
  }
}

export function getPlanLimits(plan: Plan) {
  return plan === 'pro' ? PLANS.pro : PLANS.free
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
