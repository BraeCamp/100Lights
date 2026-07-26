import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { clerkClient } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })

  const rows = await sql`
    SELECT user_id, stripe_customer_id, plan, status, current_period_end,
           gift_plan, gift_until, updated_at
    FROM subscriptions
    ORDER BY updated_at DESC
    LIMIT 200
  `

  const userIds = rows.map(r => String(r.user_id)).filter(Boolean)
  let emailMap = new Map<string, string>()
  // Active Pro granted by a redeemed promo/starter code — the same signal
  // getSubscription() uses. Without this, anyone whose Pro comes only from a
  // code shows as `free` in the admin table. One batched query over the page.
  const codeMap = new Map<string, string>()
  if (userIds.length > 0) {
    const [emailResult, codeRows] = await Promise.all([
      (async () => {
        try {
          const client = await clerkClient()
          return (await client.users.getUserList({ userId: userIds, limit: 200 })).data
        } catch {
          return null // Clerk unavailable — degrade gracefully, show user IDs only
        }
      })(),
      sql`
        SELECT user_id, MAX(grant_until) AS until
        FROM code_redemptions
        WHERE user_id = ANY(${userIds}::text[]) AND grant_until > NOW()
        GROUP BY user_id
      `,
    ])
    if (emailResult) emailMap = new Map(emailResult.map(u => [u.id, u.emailAddresses[0]?.emailAddress ?? '']))
    for (const r of codeRows) codeMap.set(String(r.user_id), String(r.until))
  }

  const now = new Date()
  const users = rows.map(r => {
    const giftPlan = r.gift_plan ? String(r.gift_plan) : null
    const giftUntil = r.gift_until ? new Date(String(r.gift_until)) : null
    const hasActiveGift = giftPlan && (giftUntil === null || giftUntil > now)
    const codeUntil = codeMap.get(String(r.user_id)) ?? null
    const effectivePlan = hasActiveGift ? giftPlan : (codeUntil ? 'pro' : String(r.plan))
    return {
      userId: String(r.user_id),
      email: emailMap.get(String(r.user_id)) ?? '',
      stripePlan: String(r.plan),
      effectivePlan,
      giftPlan,
      giftUntil: giftUntil?.toISOString() ?? null,
      codeUntil,
      stripeCustomerId: String(r.stripe_customer_id ?? ''),
      status: String(r.status),
      updatedAt: r.updated_at ? String(r.updated_at) : '',
    }
  })

  return Response.json({ users })
}
