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
  if (userIds.length > 0) {
    try {
      const client = await clerkClient()
      const result = await client.users.getUserList({ userId: userIds, limit: 200 })
      emailMap = new Map(
        result.data.map(u => [u.id, u.emailAddresses[0]?.emailAddress ?? ''])
      )
    } catch {
      // Clerk unavailable — degrade gracefully, show user IDs only
    }
  }

  const now = new Date()
  const users = rows.map(r => {
    const giftPlan = r.gift_plan ? String(r.gift_plan) : null
    const giftUntil = r.gift_until ? new Date(String(r.gift_until)) : null
    const hasActiveGift = giftPlan && (giftUntil === null || giftUntil > now)
    return {
      userId: String(r.user_id),
      email: emailMap.get(String(r.user_id)) ?? '',
      stripePlan: String(r.plan),
      effectivePlan: hasActiveGift ? giftPlan : String(r.plan),
      giftPlan,
      giftUntil: giftUntil?.toISOString() ?? null,
      stripeCustomerId: String(r.stripe_customer_id ?? ''),
      status: String(r.status),
      updatedAt: r.updated_at ? String(r.updated_at) : '',
    }
  })

  return Response.json({ users })
}
