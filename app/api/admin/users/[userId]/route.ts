import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { clerkClient } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

// The sql tag returns a composable thenable (no `.catch`), so guard optional
// queries — a table that doesn't exist yet shouldn't 500 the whole endpoint.
async function safe<T = Record<string, unknown>>(p: Promise<unknown>, fallback: T[]): Promise<T[]> {
  try { return (await p) as T[] } catch { return fallback }
}

// GET /api/admin/users/[userId] — everything about one account, so "why does
// this person have Pro / how much have they built" is answerable in one place.
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const [subRows, redemptions, projects, community, email] = await Promise.all([
    safe(sql`SELECT plan, status, stripe_customer_id, stripe_sub_id, current_period_end, gift_plan, gift_until, updated_at, created_at
        FROM subscriptions WHERE user_id = ${userId}`, []),
    safe(sql`SELECT code, kind, grant_days, grant_until, redeemed_at FROM code_redemptions WHERE user_id = ${userId} ORDER BY redeemed_at DESC`, []),
    safe<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM projects WHERE user_id = ${userId} AND deleted_at IS NULL`, [{ n: 0 }]),
    safe<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM community_items WHERE user_id = ${userId} AND removed_at IS NULL`, [{ n: 0 }]),
    (async () => {
      try { const u = await (await clerkClient()).users.getUser(userId); return u.emailAddresses?.[0]?.emailAddress ?? '' }
      catch { return '' }
    })(),
  ])

  const s = subRows[0] as Record<string, unknown> | undefined
  const now = new Date()
  const codeUntil = (redemptions as Record<string, unknown>[])
    .map(r => new Date(String(r.grant_until)))
    .filter(d => d > now)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null

  return Response.json({
    userId,
    email,
    hasRecord: !!s,
    subscription: s ? {
      plan: String(s.plan), status: String(s.status),
      stripeCustomerId: s.stripe_customer_id ? String(s.stripe_customer_id) : null,
      stripeSubId: s.stripe_sub_id ? String(s.stripe_sub_id) : null,
      currentPeriodEnd: s.current_period_end ? String(s.current_period_end) : null,
      giftPlan: s.gift_plan ? String(s.gift_plan) : null,
      giftUntil: s.gift_until ? String(s.gift_until) : null,
      createdAt: s.created_at ? String(s.created_at) : null,
      updatedAt: s.updated_at ? String(s.updated_at) : null,
    } : null,
    codeUntil: codeUntil?.toISOString() ?? null,
    redemptions: (redemptions as Record<string, unknown>[]).map(r => ({
      code: String(r.code), kind: String(r.kind), grantDays: Number(r.grant_days),
      grantUntil: String(r.grant_until), redeemedAt: String(r.redeemed_at),
    })),
    projectCount: Number((projects as { n: number }[])[0]?.n ?? 0),
    communityCount: Number((community as { n: number }[])[0]?.n ?? 0),
  })
}
