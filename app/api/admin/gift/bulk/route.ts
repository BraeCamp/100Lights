import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

const SEGMENTS = ['paying', 'comped', 'free', 'power', 'upsell', 'atrisk'] as const
const CAP = 200 // safety ceiling — a single bulk gift can't touch more than this

// POST /api/admin/gift/bulk — grant N days of Pro to every user in a segment.
// Deliberately does NOT accept 'all'; capped and audit-logged.
export async function POST(req: Request) {
  if (!await isAdmin()) return Response.json({ error: 'Not signed in as admin' }, { status: 401 })
  const { segment, days } = await req.json().catch(() => ({})) as { segment?: string; days?: number }
  if (!segment || !(SEGMENTS as readonly string[]).includes(segment)) {
    return Response.json({ error: 'A specific segment is required (not "all")' }, { status: 400 })
  }
  const d = Number(days)
  if (!Number.isFinite(d) || d < 1 || d > 3650) return Response.json({ error: 'days must be 1–3650' }, { status: 400 })

  // Resolve the segment to its user_ids (same predicate as the Users list).
  const rows = await sql`
    WITH base AS (
      SELECT s.user_id,
        (s.plan = 'pro' AND s.status = 'active' AND s.stripe_sub_id IS NOT NULL) AS paying,
        COALESCE(s.gift_plan = 'pro' AND (s.gift_until IS NULL OR s.gift_until > NOW()), false) AS gifted,
        (cg.code_until IS NOT NULL) AS coded,
        COALESCE(ps.pc, 0) AS pc, ps.last_saved
      FROM subscriptions s
      LEFT JOIN (SELECT user_id, COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS pc, MAX(saved_at) AS last_saved FROM projects GROUP BY user_id) ps ON ps.user_id = s.user_id
      LEFT JOIN (SELECT user_id, MAX(grant_until) AS code_until FROM code_redemptions WHERE grant_until > NOW() GROUP BY user_id) cg ON cg.user_id = s.user_id
    )
    SELECT user_id FROM base WHERE
      CASE ${segment}
        WHEN 'paying' THEN paying
        WHEN 'comped' THEN ((gifted OR coded) AND NOT paying)
        WHEN 'free'   THEN (NOT paying AND NOT gifted AND NOT coded)
        WHEN 'power'  THEN (pc >= 5 AND last_saved > NOW() - INTERVAL '14 days')
        WHEN 'upsell' THEN ((NOT paying AND NOT gifted AND NOT coded) AND pc >= 3)
        WHEN 'atrisk' THEN ((paying OR gifted OR coded) AND (last_saved IS NULL OR last_saved < NOW() - INTERVAL '30 days'))
        ELSE FALSE END
    LIMIT ${CAP + 1}
  `
  const ids = rows.map(r => String(r.user_id))
  const capped = ids.length > CAP
  const target = ids.slice(0, CAP)
  if (target.length === 0) return Response.json({ ok: true, count: 0 })

  await sql`
    UPDATE subscriptions
    SET gift_plan = 'pro',
        gift_until = GREATEST(NOW(), COALESCE(gift_until, NOW())) + (${d}::int * INTERVAL '1 day'),
        updated_at = NOW()
    WHERE user_id = ANY(${target}::text[])`
  await logAdmin('gift.bulk', segment, { days: d, count: target.length })
  return Response.json({ ok: true, count: target.length, capped })
}
