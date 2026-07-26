import { isAdmin } from '@/lib/admin-auth'
import { sql } from '@/lib/db'
import { clerkClient } from '@clerk/nextjs/server'
import { logAdmin } from '@/lib/admin-audit'

export const runtime = 'nodejs'

// The sql tag returns a composable thenable (no `.catch`), so guard optional
// queries — a table that doesn't exist yet shouldn't 500 the whole endpoint.
async function safe<T = Record<string, unknown>>(p: Promise<unknown>, fallback: T[]): Promise<T[]> {
  try { return (await p) as T[] } catch { return fallback }
}

// Admin CRM notes/tags — institutional memory that travels with an account,
// separate from anything the user sees.
let notesReady = false
async function ensureNotes() {
  if (notesReady) return
  await sql`CREATE TABLE IF NOT EXISTS user_notes (user_id TEXT PRIMARY KEY, note TEXT NOT NULL DEFAULT '', tags JSONB, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`
  notesReady = true
}

// GET /api/admin/users/[userId] — everything about one account, so "why does
// this person have Pro / how much have they built" is answerable in one place.
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })

  const [subRows, redemptions, projects, community, email, noteRows] = await Promise.all([
    safe(sql`SELECT plan, status, stripe_customer_id, stripe_sub_id, current_period_end, gift_plan, gift_until, updated_at, created_at
        FROM subscriptions WHERE user_id = ${userId}`, []),
    safe(sql`SELECT code, kind, grant_days, grant_until, redeemed_at FROM code_redemptions WHERE user_id = ${userId} ORDER BY redeemed_at DESC`, []),
    safe<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM projects WHERE user_id = ${userId} AND deleted_at IS NULL`, [{ n: 0 }]),
    safe<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM community_items WHERE user_id = ${userId} AND removed_at IS NULL`, [{ n: 0 }]),
    (async () => {
      try { const u = await (await clerkClient()).users.getUser(userId); return u.emailAddresses?.[0]?.emailAddress ?? '' }
      catch { return '' }
    })(),
    (async () => { await ensureNotes(); return safe(sql`SELECT note, tags FROM user_notes WHERE user_id = ${userId}`, []) })(),
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
    note: noteRows[0] ? String((noteRows[0] as Record<string, unknown>).note ?? '') : '',
    tags: (noteRows[0] as Record<string, unknown> | undefined)?.tags as string[] ?? [],
  })
}

// PATCH /api/admin/users/[userId] — save admin CRM notes + tags for the account.
export async function PATCH(req: Request, { params }: { params: Promise<{ userId: string }> }) {
  if (!await isAdmin()) return new Response('Unauthorized', { status: 401 })
  const { userId } = await params
  if (!userId) return Response.json({ error: 'userId required' }, { status: 400 })
  const b = await req.json().catch(() => ({})) as { note?: string; tags?: string[] }
  const note = (b.note ?? '').slice(0, 4000)
  const tags = Array.isArray(b.tags) ? b.tags.map(t => String(t).trim()).filter(Boolean).slice(0, 20) : []
  await ensureNotes()
  await sql`
    INSERT INTO user_notes (user_id, note, tags, updated_at)
    VALUES (${userId}, ${note}, ${tags.length ? JSON.stringify(tags) : null}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET note = EXCLUDED.note, tags = EXCLUDED.tags, updated_at = NOW()`
  await logAdmin('user.note', userId, { tags })
  return Response.json({ ok: true })
}
