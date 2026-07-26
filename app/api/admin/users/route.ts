import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { clerkClient } from '@clerk/nextjs/server'

export const runtime = 'nodejs'

const PAGE = 50
const COLS = sql`user_id, stripe_customer_id, plan, status, current_period_end, gift_plan, gift_until, updated_at`

export async function GET(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0)

  // `idOrder` is the display order; `subRows[i]` is that user's subscription row
  // (or null when a search matches a Clerk user who has no subscription row).
  let idOrder: string[] = []
  let subRows: (Record<string, unknown> | null)[] = []
  let emailMap = new Map<string, string>()
  let hasMore = false

  if (q) {
    // Search email/name/id through Clerk, then attach any subscription rows.
    let clerkUsers: { id: string; emailAddresses: { emailAddress: string }[] }[] = []
    try {
      const client = await clerkClient()
      clerkUsers = (await client.users.getUserList({ query: q, limit: 30 })).data
    } catch { /* Clerk unavailable — no matches */ }
    idOrder = clerkUsers.map(u => u.id)
    emailMap = new Map(clerkUsers.map(u => [u.id, u.emailAddresses[0]?.emailAddress ?? '']))
    const subs = idOrder.length ? await sql`SELECT ${COLS} FROM subscriptions WHERE user_id = ANY(${idOrder}::text[])` : []
    const m = new Map(subs.map(s => [String(s.user_id), s]))
    subRows = idOrder.map(id => m.get(id) ?? null)
  } else {
    const rows = await sql`SELECT ${COLS} FROM subscriptions ORDER BY updated_at DESC LIMIT ${PAGE + 1} OFFSET ${page * PAGE}`
    hasMore = rows.length > PAGE
    const pageRows = rows.slice(0, PAGE)
    idOrder = pageRows.map(r => String(r.user_id))
    subRows = pageRows
    if (idOrder.length > 0) {
      try {
        const client = await clerkClient()
        const cu = (await client.users.getUserList({ userId: idOrder, limit: 200 })).data
        emailMap = new Map(cu.map(u => [u.id, u.emailAddresses[0]?.emailAddress ?? '']))
      } catch { /* Clerk unavailable — show ids only */ }
    }
  }

  // Active Pro from redeemed codes, batched over the page (same signal as
  // getSubscription). Best-effort: the table may not exist on a fresh DB.
  const codeMap = new Map<string, string>()
  if (idOrder.length > 0) {
    try {
      const codeRows = await sql`
        SELECT user_id, MAX(grant_until) AS until
        FROM code_redemptions
        WHERE user_id = ANY(${idOrder}::text[]) AND grant_until > NOW()
        GROUP BY user_id
      `
      for (const r of codeRows) codeMap.set(String(r.user_id), String(r.until))
    } catch { /* no code table yet */ }
  }

  const now = new Date()
  const users = idOrder.map((id, i) => {
    const r = subRows[i]
    const giftPlan = r?.gift_plan ? String(r.gift_plan) : null
    const giftUntil = r?.gift_until ? new Date(String(r.gift_until)) : null
    const hasActiveGift = giftPlan && (giftUntil === null || giftUntil > now)
    const codeUntil = codeMap.get(id) ?? null
    const stripePlan = r ? String(r.plan) : 'free'
    const effectivePlan = hasActiveGift ? giftPlan : (codeUntil ? 'pro' : stripePlan)
    return {
      userId: id,
      email: emailMap.get(id) ?? '',
      stripePlan,
      effectivePlan,
      giftPlan,
      giftUntil: giftUntil?.toISOString() ?? null,
      codeUntil,
      stripeCustomerId: r ? String(r.stripe_customer_id ?? '') : '',
      status: r ? String(r.status) : 'none',
      updatedAt: r?.updated_at ? String(r.updated_at) : '',
      hasRecord: !!r,
    }
  })

  return Response.json({ users, page, hasMore, searched: !!q })
}
