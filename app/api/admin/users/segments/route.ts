import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'

export const runtime = 'nodejs'

// GET /api/admin/users/segments — live counts per segment for the Users chips.
// Best-effort: if projects/code tables aren't present, returns zeros.
export async function GET() {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  try {
    const [c] = await sql`
      WITH base AS (
        SELECT
          (s.plan = 'pro' AND s.status = 'active' AND s.stripe_sub_id IS NOT NULL) AS paying,
          COALESCE(s.gift_plan = 'pro' AND (s.gift_until IS NULL OR s.gift_until > NOW()), false) AS gifted,
          (cg.code_until IS NOT NULL) AS coded,
          COALESCE(ps.pc, 0) AS pc, ps.last_saved
        FROM subscriptions s
        LEFT JOIN (SELECT user_id, COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS pc, MAX(saved_at) AS last_saved FROM projects GROUP BY user_id) ps ON ps.user_id = s.user_id
        LEFT JOIN (SELECT user_id, MAX(grant_until) AS code_until FROM code_redemptions WHERE grant_until > NOW() GROUP BY user_id) cg ON cg.user_id = s.user_id
      )
      SELECT
        COUNT(*)::int AS all,
        COUNT(*) FILTER (WHERE paying)::int AS paying,
        COUNT(*) FILTER (WHERE (gifted OR coded) AND NOT paying)::int AS comped,
        COUNT(*) FILTER (WHERE NOT paying AND NOT gifted AND NOT coded)::int AS free,
        COUNT(*) FILTER (WHERE pc >= 5 AND last_saved > NOW() - INTERVAL '14 days')::int AS power,
        COUNT(*) FILTER (WHERE (NOT paying AND NOT gifted AND NOT coded) AND pc >= 3)::int AS upsell,
        COUNT(*) FILTER (WHERE (paying OR gifted OR coded) AND (last_saved IS NULL OR last_saved < NOW() - INTERVAL '30 days'))::int AS atrisk
      FROM base
    `
    return Response.json({ counts: {
      all: Number(c?.all ?? 0), paying: Number(c?.paying ?? 0), comped: Number(c?.comped ?? 0),
      free: Number(c?.free ?? 0), power: Number(c?.power ?? 0), upsell: Number(c?.upsell ?? 0), atrisk: Number(c?.atrisk ?? 0),
    } })
  } catch {
    return Response.json({ counts: { all: 0, paying: 0, comped: 0, free: 0, power: 0, upsell: 0, atrisk: 0 } })
  }
}
