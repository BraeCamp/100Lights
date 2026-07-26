import { sql } from './db'

// Lifecycle stages + a 0–100 health score for a user account. One user maps to
// exactly one stage; the stages form a funnel (New → Activated → Engaged →
// Power → Paying) with At-risk and Churned as off-ramps. The SQL CASE below and
// the JS stageOf() must stay in lockstep — they encode the same rules, one for
// aggregate counts / list filtering, one for a single loaded record.

export type Stage = 'new' | 'activated' | 'engaged' | 'power' | 'paying' | 'at-risk' | 'churned'

export const STAGES: { id: Stage; label: string; color: string; hint: string; track: 'funnel' | 'off' }[] = [
  { id: 'new',       label: 'New',       color: '#94a3b8', hint: 'Signed up, nothing built yet',            track: 'funnel' },
  { id: 'activated', label: 'Activated', color: '#38bdf8', hint: 'Saved at least one project',              track: 'funnel' },
  { id: 'engaged',   label: 'Engaged',   color: '#22d3ee', hint: 'Active recently, a few projects',         track: 'funnel' },
  { id: 'power',     label: 'Power',     color: '#a78bfa', hint: '5+ projects and active in the last 2 wks', track: 'funnel' },
  { id: 'paying',    label: 'Paying',    color: '#34d399', hint: 'Active Stripe subscriber, engaged',        track: 'funnel' },
  { id: 'at-risk',   label: 'At-risk',   color: '#f59e0b', hint: 'Has Pro but gone quiet / payment failing', track: 'off' },
  { id: 'churned',   label: 'Churned',   color: '#ef4444', hint: 'Went cold — no activity in 60+ days',      track: 'off' },
]

export interface StageFacts {
  paying: boolean
  gifted: boolean
  coded: boolean
  hasStripeSub: boolean
  statusHealthy: boolean   // Stripe status is active/trialing (or no sub)
  projectCount: number
  lastSavedDays: number | null   // days since last project save, null = never
  signupDays: number             // days since signup
  communityCount: number
}

// Single-record classifier — mirror of STAGE_CASE below.
export function stageOf(f: StageFacts): Stage {
  const hasPro = f.paying || f.gifted || f.coded
  const d = f.lastSavedDays
  const paymentFail = f.hasStripeSub && !f.statusHealthy
  if (hasPro && (d === null || d >= 30 || paymentFail)) return 'at-risk'
  if (f.paying) return 'paying'
  if (f.projectCount >= 5 && d !== null && d <= 14) return 'power'
  if (d !== null && d <= 30 && f.projectCount >= 2) return 'engaged'
  if ((d !== null && d >= 60) || (d === null && f.signupDays >= 14)) return 'churned'
  if (f.projectCount >= 1) return 'activated'
  return 'new'
}

// 0–100 health: recency (40) + depth (25) + community (10) + money (15) + account (10).
export function healthOf(f: StageFacts): number {
  let s = 0
  if (f.lastSavedDays !== null) s += Math.max(0, 40 * (1 - f.lastSavedDays / 60))
  s += (Math.min(f.projectCount, 10) / 10) * 25
  s += (Math.min(f.communityCount, 5) / 5) * 10
  s += f.paying ? 15 : (f.gifted || f.coded) ? 8 : 0
  s += f.statusHealthy ? 10 : 0
  return Math.round(Math.max(0, Math.min(100, s)))
}

// ── Shared SQL ──────────────────────────────────────────────────────────────
// The `base` CTE — one row per user with the facts the stage rules need. Wrap
// it as `sql\`WITH ${LIFECYCLE_CTE} SELECT … FROM base …\``.
export const LIFECYCLE_CTE = sql`
  base AS (
    SELECT s.user_id, s.stripe_customer_id, s.plan, s.status, s.current_period_end,
           s.gift_plan, s.gift_until, s.updated_at, s.created_at, s.stripe_sub_id,
      (s.plan = 'pro' AND s.status = 'active' AND s.stripe_sub_id IS NOT NULL) AS paying,
      COALESCE(s.gift_plan = 'pro' AND (s.gift_until IS NULL OR s.gift_until > NOW()), false) AS gifted,
      (cg.code_until IS NOT NULL) AS coded,
      COALESCE(ps.pc, 0) AS pc, ps.last_saved,
      COALESCE(cm.cc, 0) AS cc
    FROM subscriptions s
    LEFT JOIN (SELECT user_id, COUNT(*) FILTER (WHERE deleted_at IS NULL)::int AS pc, MAX(saved_at) AS last_saved FROM projects GROUP BY user_id) ps ON ps.user_id = s.user_id
    LEFT JOIN (SELECT user_id, MAX(grant_until) AS code_until FROM code_redemptions WHERE grant_until > NOW() GROUP BY user_id) cg ON cg.user_id = s.user_id
    LEFT JOIN (SELECT user_id, COUNT(*) FILTER (WHERE removed_at IS NULL)::int AS cc FROM community_items GROUP BY user_id) cm ON cm.user_id = s.user_id
  )`

// The stage expression, evaluated over `base`. Mirror of stageOf().
export const STAGE_CASE = sql`
  CASE
    WHEN (paying OR gifted OR coded) AND (last_saved IS NULL OR last_saved < NOW() - INTERVAL '30 days' OR (stripe_sub_id IS NOT NULL AND status NOT IN ('active','trialing'))) THEN 'at-risk'
    WHEN paying THEN 'paying'
    WHEN pc >= 5 AND last_saved > NOW() - INTERVAL '14 days' THEN 'power'
    WHEN last_saved > NOW() - INTERVAL '30 days' AND pc >= 2 THEN 'engaged'
    WHEN (last_saved IS NOT NULL AND last_saved < NOW() - INTERVAL '60 days') OR (last_saved IS NULL AND created_at < NOW() - INTERVAL '14 days') THEN 'churned'
    WHEN pc >= 1 THEN 'activated'
    ELSE 'new'
  END`

// Counts per stage across the whole base. Best-effort — returns {} on error so
// the panel degrades to no pipeline rather than breaking.
export async function stageCounts(): Promise<Record<string, number>> {
  try {
    const rows = await sql`WITH ${LIFECYCLE_CTE} SELECT ${STAGE_CASE} AS stage, COUNT(*)::int AS n FROM base GROUP BY 1`
    const out: Record<string, number> = {}
    for (const r of rows) out[String(r.stage)] = Number(r.n)
    return out
  } catch { return {} }
}
