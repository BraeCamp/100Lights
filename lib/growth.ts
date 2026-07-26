import { sql } from './db'

// Growth analytics from the data we keep (Stripe/subscriptions + projects). The
// raw-visitor top of funnel lives in PostHog, not the DB, so the funnel here
// starts at Signup — the steps we can measure precisely and act on.

export interface FunnelStep { key: string; label: string; count: number }
export interface Cohort {
  cohort: string        // 'YYYY-MM'
  size: number
  activated: number     // saved ≥1 project
  activeNow: number     // saved in the last 30 days
  paying: number
}

// One row per user with the facts every growth metric needs.
const USERS_CTE = sql`
  u AS (
    SELECT s.user_id, s.created_at,
      (s.plan = 'pro' AND s.status = 'active' AND s.stripe_sub_id IS NOT NULL) AS paying,
      COALESCE(p.pc, 0) AS pc, p.last_saved
    FROM subscriptions s
    LEFT JOIN (SELECT user_id, COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS pc, MAX(saved_at) AS last_saved FROM projects GROUP BY user_id) p ON p.user_id = s.user_id
  )`

// Signup → Activated → Habitual → Paying, with the count surviving each step.
export async function buildFunnel(): Promise<FunnelStep[]> {
  try {
    const rows = await sql`
      WITH ${USERS_CTE}
      SELECT
        COUNT(*)::int AS signed_up,
        COUNT(*) FILTER (WHERE pc >= 1)::int AS activated,
        COUNT(*) FILTER (WHERE pc >= 3 OR last_saved > NOW() - INTERVAL '30 days')::int AS habitual,
        COUNT(*) FILTER (WHERE paying)::int AS paying
      FROM u`
    const r = rows[0] ?? {}
    return [
      { key: 'signed_up', label: 'Signed up',                 count: Number(r.signed_up ?? 0) },
      { key: 'activated', label: 'Activated (saved a project)', count: Number(r.activated ?? 0) },
      { key: 'habitual',  label: 'Habitual (3+ or active 30d)', count: Number(r.habitual ?? 0) },
      { key: 'paying',    label: 'Paying',                     count: Number(r.paying ?? 0) },
    ]
  } catch {
    return [
      { key: 'signed_up', label: 'Signed up', count: 0 },
      { key: 'activated', label: 'Activated (saved a project)', count: 0 },
      { key: 'habitual', label: 'Habitual (3+ or active 30d)', count: 0 },
      { key: 'paying', label: 'Paying', count: 0 },
    ]
  }
}

// Monthly signup cohorts and how they've held up.
export async function buildCohorts(): Promise<Cohort[]> {
  try {
    const rows = await sql`
      WITH ${USERS_CTE}
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS cohort,
        COUNT(*)::int AS size,
        COUNT(*) FILTER (WHERE pc >= 1)::int AS activated,
        COUNT(*) FILTER (WHERE last_saved > NOW() - INTERVAL '30 days')::int AS active_now,
        COUNT(*) FILTER (WHERE paying)::int AS paying
      FROM u
      WHERE created_at IS NOT NULL
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12`
    return rows.map(r => ({
      cohort: String(r.cohort),
      size: Number(r.size), activated: Number(r.activated),
      activeNow: Number(r.active_now), paying: Number(r.paying),
    }))
  } catch { return [] }
}
