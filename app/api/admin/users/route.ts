import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { clerkClient } from '@clerk/nextjs/server'
import { LIFECYCLE_CTE, STAGE_CASE, STAGES, healthOf } from '@/lib/lifecycle'
import { getSegment, segmentPageRows } from '@/lib/saved-segments'

export const runtime = 'nodejs'

const PAGE = 50
const COLS = sql`user_id, stripe_customer_id, plan, status, current_period_end, gift_plan, gift_until, updated_at`
const SEGMENTS = ['paying', 'comped', 'free', 'power', 'upsell', 'atrisk'] as const
const STAGE_IDS = STAGES.map(s => s.id) as string[]

export async function GET(req: Request) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const url = new URL(req.url)
  const q = url.searchParams.get('q')?.trim() ?? ''
  const segment = url.searchParams.get('segment') ?? 'all'
  const stage = url.searchParams.get('stage') ?? ''
  const savedSegment = url.searchParams.get('savedSegment') ?? ''
  const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0)

  let idOrder: string[] = []
  let subRows: (Record<string, unknown> | null)[] = []
  let emailMap = new Map<string, string>()
  let hasMore = false

  if (q) {
    // Search email/name/id through Clerk, then attach any subscription rows.
    let clerkUsers: { id: string; emailAddresses: { emailAddress: string }[] }[] = []
    try { clerkUsers = (await (await clerkClient()).users.getUserList({ query: q, limit: 30 })).data }
    catch { /* Clerk unavailable */ }
    idOrder = clerkUsers.map(u => u.id)
    emailMap = new Map(clerkUsers.map(u => [u.id, u.emailAddresses[0]?.emailAddress ?? '']))
    const subs = idOrder.length ? await sql`SELECT ${COLS} FROM subscriptions WHERE user_id = ANY(${idOrder}::text[])` : []
    const m = new Map(subs.map(s => [String(s.user_id), s]))
    subRows = idOrder.map(id => m.get(id) ?? null)
  } else {
    // Segment filter (or the plain recent list). A single CASE keeps the
    // predicate parameterized — no conditional SQL fragments.
    let rows: Record<string, unknown>[] = []
    if (savedSegment) {
      // Saved smart segment — load its criteria and filter by it.
      const seg = await getSegment(Number(savedSegment))
      rows = seg ? await segmentPageRows(seg.criteria, PAGE + 1, page * PAGE) : []
    } else if (STAGE_IDS.includes(stage)) {
      // Lifecycle-stage filter — reuses the shared CTE + stage expression.
      try {
        rows = await sql`
          WITH ${LIFECYCLE_CTE}
          SELECT user_id, stripe_customer_id, plan, status, current_period_end, gift_plan, gift_until, updated_at
          FROM base WHERE ${STAGE_CASE} = ${stage}
          ORDER BY updated_at DESC LIMIT ${PAGE + 1} OFFSET ${page * PAGE}`
      } catch { rows = [] }
    } else if ((SEGMENTS as readonly string[]).includes(segment)) {
      try {
        rows = await sql`
          WITH base AS (
            SELECT s.user_id, s.stripe_customer_id, s.plan, s.status, s.current_period_end, s.gift_plan, s.gift_until, s.updated_at,
              (s.plan = 'pro' AND s.status = 'active' AND s.stripe_sub_id IS NOT NULL) AS paying,
              COALESCE(s.gift_plan = 'pro' AND (s.gift_until IS NULL OR s.gift_until > NOW()), false) AS gifted,
              (cg.code_until IS NOT NULL) AS coded,
              COALESCE(ps.pc, 0) AS pc, ps.last_saved
            FROM subscriptions s
            LEFT JOIN (SELECT user_id, COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS pc, MAX(saved_at) AS last_saved FROM projects GROUP BY user_id) ps ON ps.user_id = s.user_id
            LEFT JOIN (SELECT user_id, MAX(grant_until) AS code_until FROM code_redemptions WHERE grant_until > NOW() GROUP BY user_id) cg ON cg.user_id = s.user_id
          )
          SELECT user_id, stripe_customer_id, plan, status, current_period_end, gift_plan, gift_until, updated_at
          FROM base WHERE
            CASE ${segment}
              WHEN 'paying' THEN paying
              WHEN 'comped' THEN ((gifted OR coded) AND NOT paying)
              WHEN 'free'   THEN (NOT paying AND NOT gifted AND NOT coded)
              WHEN 'power'  THEN (pc >= 5 AND last_saved > NOW() - INTERVAL '14 days')
              WHEN 'upsell' THEN ((NOT paying AND NOT gifted AND NOT coded) AND pc >= 3)
              WHEN 'atrisk' THEN ((paying OR gifted OR coded) AND (last_saved IS NULL OR last_saved < NOW() - INTERVAL '30 days'))
              ELSE TRUE END
          ORDER BY updated_at DESC LIMIT ${PAGE + 1} OFFSET ${page * PAGE}
        `
      } catch { rows = [] }
    } else {
      rows = await sql`SELECT ${COLS} FROM subscriptions ORDER BY updated_at DESC LIMIT ${PAGE + 1} OFFSET ${page * PAGE}`
    }
    hasMore = rows.length > PAGE
    const pageRows = rows.slice(0, PAGE)
    idOrder = pageRows.map(r => String(r.user_id))
    subRows = pageRows
    if (idOrder.length > 0) {
      try {
        const cu = (await (await clerkClient()).users.getUserList({ userId: idOrder, limit: 200 })).data
        emailMap = new Map(cu.map(u => [u.id, u.emailAddresses[0]?.emailAddress ?? '']))
      } catch { /* Clerk unavailable */ }
    }
  }

  // Active Pro from redeemed codes, batched over the page.
  const codeMap = new Map<string, string>()
  if (idOrder.length > 0) {
    try {
      const codeRows = await sql`
        SELECT user_id, MAX(grant_until) AS until FROM code_redemptions
        WHERE user_id = ANY(${idOrder}::text[]) AND grant_until > NOW() GROUP BY user_id`
      for (const r of codeRows) codeMap.set(String(r.user_id), String(r.until))
    } catch { /* no code table yet */ }
  }

  // Per-row lifecycle stage + 0–100 health, so the table triages at a glance.
  const lc = new Map<string, { stage: string; health: number }>()
  if (idOrder.length > 0) {
    try {
      const nowMs = Date.now()
      const rows = await sql`
        WITH ${LIFECYCLE_CTE}, staged AS (SELECT base.*, ${STAGE_CASE} AS stage FROM base)
        SELECT user_id, stage, paying, gifted, coded, pc, last_saved, cc, status, stripe_sub_id, created_at
        FROM staged WHERE user_id = ANY(${idOrder}::text[])`
      for (const r of rows) {
        const lastSaved = r.last_saved ? new Date(String(r.last_saved)).getTime() : null
        const created = r.created_at ? new Date(String(r.created_at)).getTime() : nowMs
        const st = String(r.status)
        const health = healthOf({
          paying: !!r.paying, gifted: !!r.gifted, coded: !!r.coded,
          hasStripeSub: !!r.stripe_sub_id,
          statusHealthy: st === 'active' || st === 'trialing' || st === 'none',
          projectCount: Number(r.pc ?? 0),
          lastSavedDays: lastSaved ? Math.floor((nowMs - lastSaved) / 86_400_000) : null,
          signupDays: Math.floor((nowMs - created) / 86_400_000),
          communityCount: Number(r.cc ?? 0),
        })
        lc.set(String(r.user_id), { stage: String(r.stage), health })
      }
    } catch { /* enrichment is best-effort */ }
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
    const life = lc.get(id)
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
      stage: life?.stage ?? null,
      health: life?.health ?? null,
    }
  })

  return Response.json({ users, page, hasMore, searched: !!q, segment, stage, savedSegment })
}
